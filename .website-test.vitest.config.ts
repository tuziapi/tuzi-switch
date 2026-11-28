import { mergeConfig } from "vitest/config";
import base from "./vitest.config";
import path from "node:path";
export default mergeConfig(base, { resolve: { alias: [
  { find: /^@tuzi\/creative-workspace$/, replacement: path.resolve("packages/creative-workspace/dist/creative.js") },
  { find: "@tuzi/creative-workspace/style.css", replacement: path.resolve("packages/creative-workspace/dist/creative-workspace.css") },
] }});
