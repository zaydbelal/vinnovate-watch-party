import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from other devices on the LAN for multi-user testing
    port: 5173,
    proxy: {
      '/api': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
