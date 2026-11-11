import { mergeConfig } from "vite";
import path from "node:path";
import base from "./vite.config";

// Exercise the same second Vite bundle pass used by the desktop host.
export default mergeConfig(base, {
  base: "./",
  worker: { format: "es" },
  build: {
    outDir: "/tmp/tuzi-text-attachments-production",
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, "ui04.html") },
  },
});
