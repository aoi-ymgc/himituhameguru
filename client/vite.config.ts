import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  publicDir: path.resolve(import.meta.dirname, "../public"),
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, "../dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/socket.io": "http://localhost:3002",
      "/health": "http://localhost:3002",
    },
  },
});
