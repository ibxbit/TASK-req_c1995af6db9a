import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const apiTarget = process.env.VITE_API_PROXY || 'http://localhost:4000';
const port      = Number(process.env.VITE_PORT || 5173);

export default defineConfig(() => ({
  plugins: [svelte({ hot: !process.env.VITEST })],
  server: {
    host: '0.0.0.0',
    port,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
    globals: true,
    include: ['src/**/*.test.{js,ts}'],
    alias: [
      { find: /^svelte$/, replacement: resolve(__dirname, 'node_modules/svelte/src/runtime/index.js') }
    ]
  }
}));
