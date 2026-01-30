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
        // Google Cloud Functions Local Emulator Proxy
        // Forward requests to local Functions Framework (port 8080)
        // Run: npx @google-cloud/functions-framework --target=tripoProxy --port=8080
        '/api/tripo': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: true,
          // We preserve the prefix so the function can detect it if needed,
          // or rely on the function logic to strip it.
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