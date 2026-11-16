import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // relative paths in the build, so it also runs from a sub-folder (GitHub Pages: /bsc-boardgame/)
  base: command === "build" ? "./" : "/",
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
      "/api": { target: "http://localhost:3001" },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
}));
