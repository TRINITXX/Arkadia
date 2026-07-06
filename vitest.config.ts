import { defineConfig } from "vitest/config";
import path from "node:path";

// Kept separate from vite.config.ts so unit tests run under plain Node without
// pulling in the React/Tailwind/Tauri plugin chain. durableStore.ts is
// deliberately Tauri-free, so an in-memory fake store is all the tests need.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
