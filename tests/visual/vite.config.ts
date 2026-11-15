import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
  css: { postcss: path.resolve(__dirname, "../..") },
  server: {
    host: "127.0.0.1",
    port: 5191,
    strictPort: true,
    hmr: process.env.CREATIVE_QA_NO_HMR ? false : undefined,
  },
  define: {
    __APP_VERSION__: JSON.stringify("visual-fixture"),
    __RELEASE_REPOSITORY__: JSON.stringify("tuziapi/tuzi-switch"),
  },
});
