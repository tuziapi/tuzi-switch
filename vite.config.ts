import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";
import packageJson from "./package.json";

const require = createRequire(import.meta.url);
const { resolveReleaseRepository } =
  require("./scripts/release-repository.cjs") as {
    resolveReleaseRepository: () => string;
  };
const releaseRepository = resolveReleaseRepository();

export default defineConfig(({ command }) => ({
  root: "src",
  plugins: [
    command === "serve" &&
      codeInspectorPlugin({
        bundler: "vite",
      }),
    react(),
  ].filter(Boolean),
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __RELEASE_REPOSITORY__: JSON.stringify(releaseRepository),
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
}));
