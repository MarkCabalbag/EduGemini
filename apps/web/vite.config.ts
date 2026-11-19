import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser sees one origin: Vite proxies /api to the local API (TRD §4.1). The end-to-end tests run their own API on
// another port, so they can run while `pnpm dev:api` is up, and point the proxy at it with API_PROXY_TARGET.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': process.env['API_PROXY_TARGET'] ?? 'http://localhost:4000' } },
});
