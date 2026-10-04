import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // Electron loads :5173; fail loudly instead of moving ports
    proxy: { "/api": "http://localhost:8787" },
  },
  // Both pages ship in a build (the hosted live demo): Understudy and the separate ERP work app.
  build: { rollupOptions: { input: { main: "index.html", erp: "erp/index.html" } } },
});
