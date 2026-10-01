/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

// The game server (src/server) listens on 8787; Vite proxies the HTTP API and the WebSocket to it in dev.
const GAME_SERVER = process.env.GAME_SERVER ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [preact()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: GAME_SERVER, changeOrigin: true },
      '/ws': { target: GAME_SERVER, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html') } },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
