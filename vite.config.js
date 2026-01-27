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
        // GCP/Firebase Ecosystem Standard:
        // Map '/api/tripo' to the real API. 
        // In Production, this path is handled by Firebase Hosting Rewrites pointing to Cloud Functions.
        '/api/tripo': {
          target: 'https://api.tripo3d.ai/v2/openapi',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/tripo/, ''),
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