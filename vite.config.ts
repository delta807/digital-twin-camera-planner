import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const exposedGeminiApiKey = env.EXPOSE_GEMINI_API_KEY_TO_BROWSER === 'true' ? env.GEMINI_API_KEY : '';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(exposedGeminiApiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(exposedGeminiApiKey)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          'mujoco_wasm': 'mujoco-js/dist/mujoco_wasm.js'
        }
      }
    };
});
