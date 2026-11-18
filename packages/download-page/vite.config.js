import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { previewVersion } from "./src/previewRelease.js";
const repository =
  process.env.VITE_RELEASE_REPOSITORY ||
  process.env.GITHUB_REPOSITORY ||
  "tuziapi/tuzi-switch";
if (!["tuziapi/tuzi-switch", "AiW520/tuzi-switch"].includes(repository))
  throw Error("Unsupported download repository");
if (
  process.env.VITE_DOWNLOAD_CHANNEL === "preview" &&
  repository !== "AiW520/tuzi-switch"
)
  throw Error("Preview downloads may only be deployed to the test repository");
export default defineConfig({
  define: {
    "import.meta.env.VITE_RELEASE_REPOSITORY": JSON.stringify(repository),
  },
  base: "./",
  plugins: [
    react(),
    {
      name: "preview-page-title",
      transformIndexHtml(html) {
        return process.env.VITE_DOWNLOAD_CHANNEL === "preview"
          ? html.replace(
              "<title>兔子助手 · 下载</title>",
              `<title>兔子助手 · ${previewVersion} 测试版下载</title>`,
            )
          : html;
      },
    },
  ],
  css: { postcss: { plugins: [] } },
  build: { rollupOptions: { input: "tuzi-switch.html" } },
});
