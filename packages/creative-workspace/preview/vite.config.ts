import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import creativeConfig from "../vite.config";

export default mergeConfig(
  creativeConfig,
  defineConfig({
    root: __dirname,
    optimizeDeps: { entries: [path.resolve(__dirname, "ecommerce-plan.html")] },
    server: {
      host: "127.0.0.1",
      port: 5199,
      strictPort: true,
      fs: { allow: [path.resolve(__dirname, "../../..")] },
    },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
  }),
);
