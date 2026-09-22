import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5173,
    /* Same-origin in development, so the front end never needs the API's host written down
       twice. In production the two are served from one origin by the reverse proxy. */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
});
