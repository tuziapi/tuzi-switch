import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const repository =
  process.env.VITE_RELEASE_REPOSITORY ||
  process.env.GITHUB_REPOSITORY ||
  "tuziapi/tuzi-switch";
if (!["tuziapi/tuzi-switch", "AiW520/tuzi-switch"].includes(repository))
  throw Error("Unsupported download repository");
export default defineConfig({
  define: {
    "import.meta.env.VITE_RELEASE_REPOSITORY": JSON.stringify(repository),
  },
  base: "./",
  plugins: [react()],
  css: { postcss: { plugins: [] } },
  build: { rollupOptions: { input: "tuzi-switch.html" } },
});
