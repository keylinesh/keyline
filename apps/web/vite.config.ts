import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The dashboard is served under /app on keyline.sh (vercel.json copies
// dist/ to public/app and rewrites unknown /app/* paths to its index.html).
// In dev, /api/* proxies to a local API server (which serves /v1 at root).
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.KEYLINE_API_URL ?? "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "node",
  },
});
