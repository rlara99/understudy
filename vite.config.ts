import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // Electron loads :5173; fail loudly instead of moving ports
    proxy: { "/api": "http://127.0.0.1:8787" }, // the API listens on loopback IPv4 only
  },
});
