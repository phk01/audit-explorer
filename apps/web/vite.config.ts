import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const core = (p: string) => fileURLToPath(new URL(`../../packages/core/src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core/query': core('query/parse.ts'),
      '@core/sources': core('catalog/sources.ts'),
      '@core/workloads': core('catalog/workloads.ts'),
      '@core/known': core('catalog/known.ts'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: false,
        ws: false,
        // keep SSE streaming: no buffering, long timeouts
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.includes('/imports/stream')) proxyReq.setHeader('accept', 'text/event-stream');
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            if (req.url?.includes('/imports/stream')) proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
