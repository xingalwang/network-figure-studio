import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 300,
      ignored: [
        '**/.superpowers/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/examples/exports/**',
        '**/docs/**',
      ],
    },
  },
  build: { target: 'es2022' },
});
