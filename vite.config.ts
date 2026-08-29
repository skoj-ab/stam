import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
