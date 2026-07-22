import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codeInspectorPlugin } from "code-inspector-plugin";

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/")) {
            return "react-vendor";
          }
          if (id.includes("@codemirror") || id.includes("/codemirror/")) {
            return "editor-vendor";
          }
          if (id.includes("/recharts/") || id.includes("/d3-")) {
            return "charts-vendor";
          }
          if (
            id.includes("@radix-ui") ||
            id.includes("/lucide-react/") ||
            id.includes("/framer-motion/")
          ) {
            return "ui-vendor";
          }
          if (id.includes("@tanstack")) return "query-vendor";
        },
      },
    },
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
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
}));
