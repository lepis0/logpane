import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Logpane frontend build config.
//
// In dev, the same-origin relative-URL client code (fetch("/api/v1/...")
// and the WebSocket at /api/v1/ws) is proxied to the Go backend so it works
// unchanged in both dev and prod (prod serves this build from the same
// origin as the API, embedded in the Go binary).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
