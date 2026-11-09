import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite configuration for the @pf2e/client package.
 *
 * In development the app runs on the Vite dev server (5173 by default) while
 * the HTTP API and WebSocket endpoint live on the Node backend (3000 by
 * default). Proxying both `/api` and `/ws` means client code can always use
 * same-origin relative URLs: no CORS setup and no hard-coded backend port.
 *
 * The proxy target can be overridden with PF2E_SERVER_URL, e.g.
 *   PF2E_SERVER_URL=http://192.168.1.20:3000 npm run dev:client
 */
const backendUrl = process.env.PF2E_SERVER_URL || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true,
      },
      "/ws": {
        target: backendUrl,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
