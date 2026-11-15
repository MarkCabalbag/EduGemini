import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser sees one origin: Vite proxies /api to the local API (TRD §4.1).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
