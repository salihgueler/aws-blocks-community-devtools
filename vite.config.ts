import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Console UI dev server. Binds localhost only; API calls are proxied to the
// local console backend (server/main.ts) which also binds 127.0.0.1.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4400,
    proxy: {
      "/console-api": {
        target: "http://127.0.0.1:4401",
        changeOrigin: false,
      },
    },
  },
});
