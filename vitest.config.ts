import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const { resolveReleaseRepository } =
  require("./scripts/release-repository.cjs") as {
    resolveReleaseRepository: () => string;
  };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@aitu/utils": path.resolve(__dirname, "packages/creative-workspace/upstream/packages/utils/src/index.ts"),
    },
  },
  define: {
    __RELEASE_REPOSITORY__: JSON.stringify(resolveReleaseRepository()),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setupGlobals.ts", "./tests/setupTests.ts"],
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "packages/creative-workspace/**",
      // This vendored runtime uses node:test and is verified by its own runner.
      "src-tauri/vendor/**",
    ],
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
