import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    },
    server: {
      proxy: {
        // Cloudflare Worker Proxy
        // Forward all requests from /api/tripo to the local Wrangler instance
        // You must run `npx wrangler dev workers/index.js` (on port 8787) for this to work.
        '/api/tripo': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
          // Note: We do NOT rewrite path here because the Worker expects /api/tripo prefix 
          // to determine routing logic inside workers/index.js
          secure: false,
        }
      }
    },
    resolve: {
      dedupe: ['three', 'react', 'react-dom', '@react-three/fiber', '@react-three/drei'],
      alias: {
        'three': path.resolve(process.cwd(), 'node_modules/three'),
      },
    },
    optimizeDeps: {
      include: ['three', '@react-three/fiber', '@react-three/drei']
    }
  };
});