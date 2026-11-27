import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import base from "./vite.config";
export default defineConfig(env => mergeConfig(typeof base === "function" ? base(env) : base, {
  resolve: { alias: [
    { find: /^@tuzi\/creative-workspace$/, replacement: path.resolve("packages/creative-workspace/dist/creative.js") },
    { find: "@tuzi/creative-workspace/style.css", replacement: path.resolve("packages/creative-workspace/dist/creative-workspace.css") },
    { find: "@tuzi/creative-workspace/connection-guide", replacement: path.resolve("packages/creative-workspace/dist/connection-guide.js") },
    { find: "@tuzi/creative-workspace/model-sync", replacement: path.resolve("packages/creative-workspace/dist/model-sync.js") },
  ] }
}));
