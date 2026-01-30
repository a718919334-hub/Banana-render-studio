import { AssetStatus } from '../types';
import { useAppStore } from '../store/useAppStore';

// SECURITY UPDATE: API Key is no longer stored here.
// It is managed by the Cloudflare Worker (Backend).

interface TripoResponse {
  code: number;
  data: any;
  message?: string;
}

// Points to the Cloudflare Worker path, dynamically retrieved from store
const getApiUrl = (endpoint: string) => {
  // Use the specific remote Worker URL as default
  let baseUrl = useAppStore.getState().backendUrl || 'https://soft-wave-9c83.a718919334.workers.dev';
  
  // Robustly handle trailing slashes in baseUrl
  baseUrl = baseUrl.replace(/\/+$/, '');
  
  // Robustly handle leading slashes in endpoint
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  
  return `${baseUrl}/${cleanEndpoint}`;
};

/**
 * Public helper to construct a proxy URL for any external resource.
 * Useful for passing URLs to SceneViewer that circumvent CORS.
 */
export const getProxyUrl = (originalUrl: string): string => {
    if (!originalUrl) return '';
    // If it's already a local blob, return as is
    if (originalUrl.startsWith('blob:') || originalUrl.startsWith('data:')) return originalUrl;
    
    return getApiUrl(`/proxy?url=${encodeURIComponent(originalUrl)}`);
};

const mapTripoStatus = (status: string): AssetStatus => {
  // Documentation: https://platform.tripo3d.ai/docs/task
  if (!status) return AssetStatus.PENDING;
  
  // Normalize status to handle case sensitivity issues (e.g. "Success" vs "success")
  const s = status.toLowerCase().trim();

  switch (s) {
    case 'queued': 
    case 'pending': 
    case 'created':
        return AssetStatus.PENDING;
    case 'running': 
    case 'starting':
    case 'processing':
    case 'initializing':
        return AssetStatus.PROCESSING;
    case 'success': 
    case 'succeeded':
    case 'finished':
    case 'completed':
        return AssetStatus.COMPLETED;
    case 'failed':
    case 'banned':
    case 'expired':
    case 'cancelled':
    case 'unknown':
    case 'unknown_error': 
        return AssetStatus.ERROR;
    default: 
        console.warn(`[TripoService] Unmapped status received: '${status}'. Defaulting to PENDING.`);
        // CAUTION: Defaulting to PENDING causes infinite loops if the status is actually a new "completed" variant.
        // But for safety, we assume it's still working unless explicitly failed.
        return AssetStatus.PENDING; 
  }
};

/**
 * Generic Fetch with Retry Logic
 */
const fetchWithRetry = async (url: string, options: RequestInit, retries = 3, timeout = 30000): Promise<Response> => {
    // DEBUG LOG: Show exactly where the request is going
    console.log(`[TripoService] 📡 Request: ${options.method || 'GET'} ${url}`);
    
    let lastError: any;
    
    for (let i = 0; i < retries; i++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            // If server error (5xx), retry. If client error (4xx), throw immediately.
            if (!response.ok && response.status >= 500) {
                console.warn(`[TripoService] Server Error ${response.status} on attempt ${i+1}`);
                throw new Error(`Server Error: ${response.status}`);
            }
            return response;
        } catch (error: any) {
            clearTimeout(timeoutId);
            lastError = error;
            console.warn(`[TripoService] ⚠️ Request failed (Attempt ${i + 1}/${retries}): ${error.message}`);
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
    }
    throw lastError;
};

export const testApiConnection = async (): Promise<{ success: boolean; message: string }> => {
  try {
    // FIX: Use a fake UUID to satisfy Tripo API validation format
    // This prevents 400 Bad Request errors caused by invalid ID formats
    const dummyId = '00000000-0000-0000-0000-000000000000';
    const url = getApiUrl(`/task/${dummyId}`);
    console.log(`[TripoService] Testing Connection URL: ${url}`);

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    }, 1, 10000); 

    // Check if we got an HTML response (Proxy/Worker misconfiguration)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
        console.error("[TripoService] Connection Test Failed: Received HTML. Worker might be down or URL is wrong.");
        return { 
            success: false, 
            message: '连接失败: 返回了 HTML。请检查后端 URL 是否正确。' 
        };
    }
    
    // 404 is the expected response from Tripo for a non-existent ID
    // 400 might be returned if the ID format is still rejected or other validation fails
    // Both statuses confirm we successfully reached the Tripo API via the Worker
    if (response.status === 404 || response.status === 400) {
        console.log(`[TripoService] Connection Test Success: Worker proxied request correctly (Status ${response.status})`);
        return { success: true, message: '后端服务连接正常' };
    }
    
    if (response.status === 401 || response.status === 403) {
      console.warn(`[TripoService] Connection Test: Auth Error (${response.status})`);
      return { success: false, message: 'Worker 配置错误: API Key 无效' };
    }

    if (response.ok) {
        return { success: true, message: '服务连接正常' };
    }

    return { success: false, message: `未知状态: ${response.status}` };

  } catch (error: any) {
    console.error("[TripoService] Connection Failed:", error);
    let msg = error.message;
    if (error.name === 'AbortError') msg = '连接超时';
    else if (msg.includes('Failed to fetch')) msg = '无法连接 (请检查 URL 格式/CORS)';
    return { success: false, message: msg };
  }
};

/**
 * 1. Upload Image
 */
export const uploadImageToTripo = async (file: File): Promise<string> => {
    const MAX_SIZE = 15 * 1024 * 1024; // 15MB
    if (file.size > MAX_SIZE) {
        throw new Error(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)。请上传小于 15MB 的图片。`);
    }

    console.log(`[TripoService] Uploading image via Worker: ${file.name}`);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetchWithRetry(getApiUrl('/upload'), {
            method: 'POST',
            headers: { 
                'Accept': 'application/json' 
            },
            body: formData,
        }, 3, 120000); 

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Upload Failed: ${response.status} - ${errorText.substring(0, 100)}`);
        }

        const res: TripoResponse = await response.json();
        
        if (res.code !== 0) {
            console.error(`[TripoService] API Error in Upload:`, res);
            throw new Error(`API Error (${res.code}): ${res.message || 'Unknown upload error'}`);
        }
        
        if (!res.data || !res.data.image_token) {
             throw new Error("Invalid response: missing image_token");
        }

        console.log(`[TripoService] Image uploaded successfully. Token: ${res.data.image_token}`);
        return res.data.image_token;
    } catch (error: any) {
        console.error("[TripoService] Upload Exception:", error);
        throw error;
    }
};

/**
 * 2. Create Image-to-3D Task
 */
export const createImageTo3DTask = async (imageToken: string, fileExtension: string = 'png'): Promise<string> => {
    const ext = (fileExtension.replace('.', '') || 'png').toLowerCase();
    
    console.log(`[TripoService] Creating Image-to-3D task. Token: ${imageToken}`);

    const response = await fetchWithRetry(getApiUrl('/task'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            type: 'image_to_model',
            file: { 
                type: ext, 
                file_token: imageToken 
            }
        })
    }, 2, 30000); 

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Task Creation Failed: ${response.status} - ${errorText.substring(0, 100)}`);
    }

    const res: TripoResponse = await response.json();
    
    if (res.code !== 0) {
        throw new Error(`API Error (${res.code}): ${res.message}`);
    }
    
    return res.data.task_id;
};

/**
 * Create Text-to-3D Task
 */
export const createTextTo3DTask = async (prompt: string): Promise<string> => {
  console.log(`[TripoService] Creating Text-to-3D task.`);

  const response = await fetchWithRetry(getApiUrl('/task'), {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    },
    body: JSON.stringify({
        type: 'text_to_model',
        prompt: prompt
    })
  }, 2, 30000);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Text Task Failed: ${response.status}`);
  }

  const res: TripoResponse = await response.json();
  
  if (res.code !== 0) {
    throw new Error(`API Error (${res.code}): ${res.message}`);
  }

  return res.data.task_id;
};

/**
 * Helper to download the model to a local Blob
 * Uses the Worker Proxy to bypass CORS issues with the remote storage.
 */
export const downloadTripoModel = async (url: string): Promise<Blob> => {
    console.log(`[TripoService] Downloading model: ${url}`);
    
    // If it's already a blob or data URI, just fetch it directly
    if (url.startsWith('blob:') || url.startsWith('data:')) {
        const r = await fetch(url);
        return r.blob();
    }

    try {
        // Use the Worker Proxy to fetch the file
        // The getApiUrl helper handles the base worker URL
        // We append /proxy?url=...
        const proxyUrl = getProxyUrl(url);
        
        console.log(`[TripoService] Using Proxy URL: ${proxyUrl}`);
        
        const response = await fetch(proxyUrl);
        
        // Handle case where remote worker lacks /proxy endpoint (returns 404 from upstream)
        // OR the worker returns 9404 JSON (Tripo API "Not Found")
        if (response.status === 404) {
             throw new Error(`Proxy endpoint not found (404). Worker code might be outdated.`);
        }
        
        if (!response.ok) {
             throw new Error(`Proxy download failed with status: ${response.status}`);
        }
        
        // Validation: Check if we got an error object/JSON instead of a file
        const contentType = response.headers.get('content-type');
        if (contentType && (contentType.includes('application/json') || contentType.includes('text/html'))) {
            // It might be a proxied error from the upstream or the worker itself
            const text = await response.text();
            
            // If it's the 9404 error from Tripo ("Cannot GET /proxy")
            if (text.includes('"code":9404') || text.includes('Cannot GET /proxy')) {
                throw new Error("Proxy endpoint not found on worker (Tripo 9404).");
            }

            // Try to parse as JSON to give a better error message
            try {
                const errJson = JSON.parse(text);
                throw new Error(`Proxy returned error: ${errJson.message || errJson.error || text.substring(0, 100)}`);
            } catch (e) {
                 if (e instanceof Error && e.message.startsWith('Proxy returned')) throw e;
                 // If we are desperate, we could try to treat it as a blob anyway if it starts with 'glTF', but risky.
                 throw new Error(`Proxy returned non-binary data: ${text.substring(0, 100)}`);
            }
        }

        const blob = await response.blob();
        if (blob.size < 100) {
             console.warn("Downloaded blob is suspiciously small:", blob.size);
        }

        return blob;
    } catch (e) {
        console.warn(`[TripoService] Proxy download failed (${e.message}). Falling back to direct download.`);
        // FALLBACK: Try fetching directly (CORS might block this, but it's the only option if proxy is dead)
        try {
            const directResponse = await fetch(url);
            if (!directResponse.ok) throw new Error(`Direct fetch failed: ${directResponse.status}`);
            return await directResponse.blob();
        } catch (directErr) {
            // If direct fetch also fails, throw the original proxy error as it's more descriptive for setup issues
            console.error(`[TripoService] Direct download also failed:`, directErr);
            throw e; 
        }
    }
};

/**
 * Poll Task Status
 */
export const pollTripoTask = (
  taskId: string, 
  onUpdate: (status: AssetStatus, modelUrl?: string | null, progress?: number) => void
) => {
  console.log(`[TripoService] Start polling for Task ID: ${taskId}`);
  
  let attempts = 0;
  let consecutiveErrors = 0;
  const maxAttempts = 150; // Max ~5 minutes

  const intervalId = setInterval(async () => {
    attempts++;
    
    // Safety break
    if (attempts > maxAttempts) {
        clearInterval(intervalId);
        onUpdate(AssetStatus.ERROR);
        console.error('[TripoService] Polling timed out (5 minutes).');
        return;
    }

    try {
      // ADDED: cache: 'no-store' to ensure we get fresh status, not cached 'queued' state
      const response = await fetch(getApiUrl(`/task/${taskId}`), {
        headers: { 
            'Accept': 'application/json'
        },
        cache: 'no-store'
      });

      if (!response.ok) {
           console.error(`[TripoService] Polling HTTP Error: ${response.status}`);
           consecutiveErrors++;

           // Fail fast on 500s or auth errors or consecutive failures
           if(response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 404 || consecutiveErrors > 3) {
               console.error('[TripoService] Aborting poll due to persistent errors');
               clearInterval(intervalId);
               onUpdate(AssetStatus.ERROR);
           }
           return;
      }
      
      // Reset error count on success
      consecutiveErrors = 0;

      const res: TripoResponse = await response.json();
      
      // FIX: Do NOT use JSON.stringify on the entire payload to avoid stack overflow on large/circular objects
      // Only log the status for debugging
      console.log(`[TripoService] Poll #${attempts} Status: ${res?.data?.status}`);

      if (res.code !== 0) {
        console.error(`[TripoService] Polling API Error (Code ${res.code}):`, res.message);
        clearInterval(intervalId);
        onUpdate(AssetStatus.ERROR);
        return;
      }

      if (!res.data) {
          console.error(`[TripoService] Invalid Response: 'data' field missing`, res);
          clearInterval(intervalId);
          onUpdate(AssetStatus.ERROR);
          return;
      }

      const { status: rawStatus, output, progress } = res.data;
      const appStatus = mapTripoStatus(rawStatus);
      
      // console.log(`[TripoService] Mapped Status: '${rawStatus}' -> '${appStatus}'`);

      if (appStatus === AssetStatus.PENDING || appStatus === AssetStatus.PROCESSING) {
        onUpdate(appStatus, null, progress);
      } else if (appStatus === AssetStatus.COMPLETED) {
        clearInterval(intervalId);
        
        // Robust extraction of Model URL
        let modelUrl: string | undefined = undefined;

        // Try pbr_model (Refined)
        if (output?.pbr_model) {
            if (typeof output.pbr_model === 'string') modelUrl = output.pbr_model;
            else if (output.pbr_model.url) modelUrl = output.pbr_model.url;
        }
        
        // Try base_model (Draft) if no PBR
        if (!modelUrl && output?.base_model) {
            if (typeof output.base_model === 'string') modelUrl = output.base_model;
            else if (output.base_model.url) modelUrl = output.base_model.url;
        }

        // Try generic model or glb
        if (!modelUrl) {
             if (typeof output?.model === 'string') modelUrl = output.model;
             else if (typeof output?.glb === 'string') modelUrl = output.glb;
        }

        if (modelUrl) {
            console.log(`[TripoService] Task Success! Model URL: ${modelUrl}`);
            onUpdate(AssetStatus.COMPLETED, modelUrl);
        } else {
            console.error('[TripoService] Task completed but NO model URL found in output:', output);
            // Don't fail silently, tell the UI it failed
            onUpdate(AssetStatus.ERROR);
        }
      } else if (appStatus === AssetStatus.ERROR) {
        clearInterval(intervalId);
        console.error(`[TripoService] Task Failed with status: ${rawStatus}`);
        onUpdate(AssetStatus.ERROR);
      }

    } catch (error) {
      console.error('[TripoService] Polling Exception:', error);
      consecutiveErrors++;
      if (consecutiveErrors > 3) {
           console.error('[TripoService] Too many exceptions, stopping.');
           clearInterval(intervalId);
           onUpdate(AssetStatus.ERROR);
      }
    }
  }, 2000);
};