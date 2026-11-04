/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@contracts": fileURLToPath(new URL("../contracts/generated/ts", import.meta.url)) },
  },
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: { "/api": { target: "http://localhost:8000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["tests/setup.ts"], include: ["tests/**/*.test.tsx", "tests/**/*.test.ts"] },
});
