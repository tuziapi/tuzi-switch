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
    },
  },
  define: {
    __RELEASE_REPOSITORY__: JSON.stringify(resolveReleaseRepository()),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setupGlobals.ts", "./tests/setupTests.ts"],
    globals: true,
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
