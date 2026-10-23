import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@renderer": path.resolve(__dirname, "./crates/terminal-renderer/pkg"),
    },
  },

  // wasm-pack outputs a tree under crates/terminal-renderer/pkg.
  // It lives outside Vite's project root, so we whitelist it for fs access.
  // The .wasm asset is loaded via fetch(import.meta.url + '...'); allowing
  // it as an asset keeps Vite from trying to pre-bundle it.
  assetsInclude: ["**/*.wasm"],

  // Tauri expects a fixed port; fail if it's not available
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // The phone page under `tauri dev` (mobile.html): the same routes as
    // behind `tailscale serve`, to the debug build's server and gate.
    proxy: {
      "/ws": { target: "ws://127.0.0.1:47601", ws: true, changeOrigin: true },
      "/image": { target: "http://127.0.0.1:47601", changeOrigin: true },
      "/video": { target: "http://127.0.0.1:47601", changeOrigin: true },
      "/gate": {
        target: "http://127.0.0.1:47611",
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/gate/, ""),
      },
    },
  },

  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      // The phone companion page, served by Arkadia's own server (src-tauri remote).
      input: {
        main: path.resolve(__dirname, "index.html"),
        mobile: path.resolve(__dirname, "mobile.html"),
      },
    },
  },
}));
