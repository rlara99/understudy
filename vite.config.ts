import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // Electron loads :5173; fail loudly instead of moving ports
    proxy: { "/api": "http://localhost:8787" },
  },
});
