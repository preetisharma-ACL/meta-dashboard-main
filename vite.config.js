import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://142.93.211.38',
        changeOrigin: true,
        rewrite: (path) => path  // keeps /api/auth/login/ as-is
      }
    }
  }
});