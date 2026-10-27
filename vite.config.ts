import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the same build runs in the Tauri desktop app, on GitHub Pages
// (served from /<repo>/) and from any static file server.
export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
