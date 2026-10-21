import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on MCP_DISCOVERY_PORT (default 5310) and Vite on VITE_PORT (default 5330); /api is proxied.
const api = { target: `http://127.0.0.1:${Number(process.env.MCP_DISCOVERY_PORT) || 5310}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5330, strictPort: true, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});
