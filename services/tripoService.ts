import { AssetStatus } from '../types';

// NOTE: In a real GCP environment, use Secret Manager or Firebase Environment Configuration.
// Do not commit actual keys to version control.
const TRIPO_API_KEY = 'tsk_dgUck16euLxZwpQWdZxx6ZJUOwm6WkBteCp-44gETVO'; 

interface TripoResponse {
  code: number;
  data: any;
  message?: string;
}

// Unified API Path for GCP Ecosystem
// Local (Dev): Handled by Vite Proxy (configured in vite.config.js)
// Production: Handled by Firebase Hosting Rewrites -> Cloud Functions
const API_BASE_PATH = '/api/tripo';

const getApiUrl = (endpoint: string) => {
  return `${API_BASE_PATH}${endpoint}`;
};

const mapTripoStatus = (status: string): AssetStatus => {
  switch (status) {
    case 'queued': return AssetStatus.PENDING;
    case 'running': return AssetStatus.PROCESSING;
    case 'success': return AssetStatus.COMPLETED;
    case 'failed':
    case 'cancelled':
    case 'unknown_error': return AssetStatus.ERROR;
    default: return AssetStatus.PENDING;
  }
};

export const testApiConnection = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const url = getApiUrl('/task/connection_test_dummy_id');
    console.log(`[TripoService] Testing Connection: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TRIPO_API_KEY}`,
        'Content-Type': 'application/json' 
      }
    });

    // Check if we got an HTML response (Common Vite Proxy failure mode)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
        return { 
            success: false, 
            message: '代理配置未生效 (返回了 HTML)。请重启开发服务器。' 
        };
    }
    
    // 401/403: Reached server, but auth failed (Connection OK)
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: 'API Key 无效或过期' };
    }
    
    // 404: Reached server, endpoint/id not found (Connection OK)
    // For a dummy ID, 404 is the EXPECTED valid response from the backend.
    if (response.status === 404) {
        return { success: true, message: '服务连接正常' };
    }

    if (response.status >= 500) {
        return { success: false, message: `服务器内部错误 (${response.status})` };
    }
    
    if (response.ok) {
        return { success: true, message: '服务连接正常' };
    }

    return { success: false, message: `未知状态: ${response.status}` };

  } catch (error: any) {
    console.error("[TripoService] Connection Failed:", error);
    
    // Helper to distinguish CORS/Network errors
    let msg = error.message;
    if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
        msg = '网络错误 (可能是 CORS 或 代理未启动)';
    }

    return { success: false, message: msg };
  }
};

/**
 * 1. Upload Image
 */
export const uploadImageToTripo = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(getApiUrl('/upload'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TRIPO_API_KEY}` },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Upload Failed: ${response.status}`);
    }

    const res: TripoResponse = await response.json();
    
    if (res.code !== 0) {
        throw new Error(`API Error (${res.code}): ${res.message}`);
    }
    return res.data.image_token;
};

/**
 * 2. Create Image-to-3D Task
 */
export const createImageTo3DTask = async (imageToken: string, fileExtension: string = 'png'): Promise<string> => {
    const ext = fileExtension.replace('.', '') || 'png';
    const response = await fetch(getApiUrl('/task'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TRIPO_API_KEY}`
        },
        body: JSON.stringify({
            type: 'image_to_model',
            file: { type: ext, file_token: imageToken }
        })
    });

    if (!response.ok) {
        throw new Error(`Task Creation Failed: ${response.status}`);
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
  const response = await fetch(getApiUrl('/task'), {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TRIPO_API_KEY}`
    },
    body: JSON.stringify({
        type: 'text_to_model',
        prompt: prompt
    })
  });

  if (!response.ok) {
    throw new Error(`Text Task Failed: ${response.status}`);
  }

  const res: TripoResponse = await response.json();
  
  if (res.code !== 0) {
    throw new Error(`API Error (${res.code}): ${res.message}`);
  }

  return res.data.task_id;
};

/**
 * Poll Task Status
 */
export const pollTripoTask = (
  taskId: string, 
  onUpdate: (status: AssetStatus, modelUrl?: string | null, progress?: number) => void
) => {
  const intervalId = setInterval(async () => {
    try {
      const response = await fetch(getApiUrl(`/task/${taskId}`), {
        headers: { 'Authorization': `Bearer ${TRIPO_API_KEY}` }
      });

      if (!response.ok) {
           clearInterval(intervalId);
           onUpdate(AssetStatus.ERROR);
           return;
      }

      const res: TripoResponse = await response.json();
      
      if (res.code !== 0) {
        clearInterval(intervalId);
        onUpdate(AssetStatus.ERROR);
        return;
      }

      const { status, output, progress } = res.data;
      const appStatus = mapTripoStatus(status);

      if (appStatus === AssetStatus.PENDING || appStatus === AssetStatus.PROCESSING) {
        onUpdate(appStatus, null, progress);
      }

      if (appStatus === AssetStatus.COMPLETED) {
        clearInterval(intervalId);
        
        // Check for model URL
        const modelUrl = output?.model || output?.pbr_model || output?.base_model || output?.glb;
        
        if (modelUrl) {
            onUpdate(AssetStatus.COMPLETED, modelUrl);
        } else {
            console.error("Task completed but no model URL found:", output);
            onUpdate(AssetStatus.ERROR);
        }
      }

      if (appStatus === AssetStatus.ERROR) {
        clearInterval(intervalId);
        onUpdate(AssetStatus.ERROR);
      }

    } catch (error) {
      console.error('Polling error:', error);
      clearInterval(intervalId);
      onUpdate(AssetStatus.ERROR);
    }
  }, 2000);
};