export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    // Handle Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // 2. Routing Logic
    // Normalize path: remove /api/tripo prefix if present, and remove trailing slashes
    let targetPath = url.pathname;
    if (url.pathname.startsWith('/api/tripo')) {
      targetPath = url.pathname.replace('/api/tripo', '');
    }
    targetPath = targetPath.replace(/\/+$/, ''); // Remove trailing slash

    // --- PROXY ENDPOINT FOR FILES ---
    // Matches '/proxy'
    if (targetPath === '/proxy') {
        const fileUrl = url.searchParams.get('url');
        if (!fileUrl) {
            return new Response(JSON.stringify({ error: "Missing 'url' query parameter" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json", ...corsHeaders } 
            });
        }
        try {
            // Fetch the external resource
            // IMPORTANT: Add User-Agent to mimic a browser, otherwise S3/CloudFront might return 403/404
            const response = await fetch(fileUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "*/*"
                }
            });
            
            // Handle Upstream Errors (404/403) specifically
            if (!response.ok) {
                // Return a JSON error so the frontend can distinguish upstream 404 vs worker route 404
                return new Response(JSON.stringify({ 
                    error: `Upstream fetch failed: ${response.status} ${response.statusText}`,
                    url: fileUrl 
                }), {
                    status: response.status,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            // RECONSTRUCT HEADERS (Crucial Fix)
            // Do NOT use `new Response(response.body, response)` because it copies "Content-Encoding" 
            // and upstream CORS headers which causes browser "Failed to fetch" errors.
            const newHeaders = new Headers();
            
            // 1. Enforce our CORS
            Object.keys(corsHeaders).forEach(key => {
                newHeaders.set(key, corsHeaders[key]);
            });

            // 2. Pass through only safe/necessary headers
            const safeHeaders = [
                "content-type", 
                "content-length", 
                "content-disposition", 
                "cache-control", 
                "etag", 
                "last-modified"
            ];
            
            for (const key of safeHeaders) {
                const value = response.headers.get(key);
                if (value) {
                    newHeaders.set(key, value);
                }
            }

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
            });

        } catch (e) {
            return new Response(JSON.stringify({ error: `Proxy Internal Error: ${e.message}` }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }
    }

    // --- TRIPO API PROXY ---
    // Basic security check to ensure we aren't proxying random stuff if used as a generic worker
    // The Tripo API endpoints start with /task or /upload
    if (!targetPath.startsWith('/task') && !targetPath.startsWith('/upload') && !targetPath.startsWith('/v2')) {
       return new Response("Not Found (Invalid Route)", { status: 404, headers: corsHeaders });
    }
      
    // Construct the target URL (Tripo V2 OpenAPI)
    const targetUrl = `https://api.tripo3d.ai/v2/openapi${targetPath}${url.search}`;

    // Create a new request based on the original
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
      redirect: 'follow',
    });

    // 3. Security: Inject the API Key from Environment Variables
    newRequest.headers.delete("Host");
    newRequest.headers.delete("Origin");
    if (env.TRIPO_API_KEY) {
        newRequest.headers.set("Authorization", `Bearer ${env.TRIPO_API_KEY}`);
    }
      
    try {
      const response = await fetch(newRequest);
      
      // For API JSON responses, standard proxying is usually fine, but we reconstruct headers just to be safe
      const newResponse = new Response(response.body, response);
      Object.keys(corsHeaders).forEach(key => {
          newResponse.headers.set(key, corsHeaders[key]);
      });
        
      return newResponse;
    } catch (e) {
      return new Response(JSON.stringify({ code: 500, message: `Worker API Error: ${e.message}` }), {
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
  },
};