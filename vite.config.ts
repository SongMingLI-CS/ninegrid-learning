import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) return 'react-vendor';
  } } } },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
});
