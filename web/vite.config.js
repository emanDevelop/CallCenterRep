import { defineConfig } from "vite";

// The bot serves the build at /client/, so assets use relative paths.
// `npm run dev` proxies the bot's API to a bot running on port 7860.
export default defineConfig({
  base: "./",
  build: {
    outDir: "../server/ui",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/start": "http://localhost:7860",
      "/sessions": "http://localhost:7860",
      "/api": "http://localhost:7860",
    },
  },
});
