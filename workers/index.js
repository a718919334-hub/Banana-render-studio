/**
 * Google Cloud Function (HTTP)
 * Entry point: tripoProxy
 * Runtime: Node.js 18+
 * 
 * To run locally:
 * npx @google-cloud/functions-framework --target=tripoProxy --port=8080
 */

exports.tripoProxy = async (req, res) => {
  // 1. CORS Headers - Allow all for demo purposes
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range, Accept');
  res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Content-Disposition');

  // Handle Preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // 2. Routing Logic
  // Normalize path: remove /api/tripo prefix if present (from Vite proxy)
  let targetPath = req.path;
  if (targetPath.startsWith('/api/tripo')) {
    targetPath = targetPath.replace('/api/tripo', '');
  }
  // Remove trailing slashes
  targetPath = targetPath.replace(/\/+$/, '');

  // --- PROXY ENDPOINT FOR FILES ---
  // Matches '/proxy'
  if (targetPath === '/proxy') {
      const fileUrl = req.query.url;
      if (!fileUrl) {
          return res.status(400).json({ error: "Missing 'url' query parameter" });
      }

      try {
          // Fetch the external resource
          const response = await fetch(fileUrl, {
              headers: {
                  // Mimic browser to avoid 403s from some CDNs
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  "Accept": "*/*"
              }
          });
          
          if (!response.ok) {
              return res.status(response.status).json({ 
                  error: `Upstream fetch failed: ${response.status}`,
                  url: fileUrl 
              });
          }

          // Pass through safe headers
          const safeHeaders = [
              "content-type", "content-length", "content-disposition", 
              "cache-control", "etag", "last-modified"
          ];
          
          safeHeaders.forEach(header => {
              const value = response.headers.get(header);
              if (value) res.set(header, value);
          });

          // Stream the response back
          const reader = response.body.getReader();
          const streamResponse = async () => {
              while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(value);
              }
              res.end();
          };
          
          await streamResponse();
          return;

      } catch (e) {
          console.error("Proxy Error:", e);
          return res.status(500).json({ error: `Proxy Internal Error: ${e.message}` });
      }
  }

  // --- TRIPO API PROXY ---
  if (!targetPath.startsWith('/task') && !targetPath.startsWith('/upload') && !targetPath.startsWith('/v2')) {
     return res.status(404).send("Not Found (Invalid Route)");
  }
    
  // Construct the target URL (Tripo V2 OpenAPI)
  // Reconstruct query string from req.query object
  const queryString = new URLSearchParams(req.query).toString();
  const targetUrl = `https://api.tripo3d.ai/v2/openapi${targetPath}${queryString ? `?${queryString}` : ''}`;

  // Prepare Headers
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  
  // Inject API Key from Environment (Google Cloud Functions Env Var)
  if (process.env.TRIPO_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.TRIPO_API_KEY}`;
  }

  const fetchOptions = {
    method: req.method,
    headers: headers,
    redirect: 'follow',
  };

  // Handle Body
  // GCF uses body-parser by default. For JSON it's parsed into req.body.
  // For multipart (uploads), we might need the raw buffer.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.is('application/json')) {
          fetchOptions.body = JSON.stringify(req.body);
      } else if (req.rawBody) {
          // Use rawBody if available (standard in GCF)
          fetchOptions.body = req.rawBody;
      } else {
          // Fallback
          fetchOptions.body = req.body;
      }
  }
    
  try {
    const apiRes = await fetch(targetUrl, fetchOptions);
    
    // Set Status
    res.status(apiRes.status);
    
    // Forward Headers
    apiRes.headers.forEach((val, key) => {
        // Skip encoding/CORS headers to avoid issues
        const lowerKey = key.toLowerCase();
        if (
            lowerKey !== 'content-encoding' && 
            lowerKey !== 'transfer-encoding' &&
            !lowerKey.startsWith('access-control-')
        ) {
            res.set(key, val);
        }
    });

    // Send Body
    const arrayBuffer = await apiRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));

  } catch (e) {
    console.error("GCP Proxy Error:", e);
    res.status(500).json({ code: 500, message: `GCP Worker Error: ${e.message}` });
  }
};