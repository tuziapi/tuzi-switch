import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setupGlobals.ts", "./tests/setupTests.ts"],
    globals: true,
    // The MSW/Tauri bridge uses process-global mutable provider and event
    // state. Running test files in parallel lets one file reset another
    // file's simulated application state, producing non-deterministic UI
    // failures that cannot occur in the single-process desktop runtime.
    fileParallelism: false,
    // Heavy integration tests render the complete settings/session UI. Under
    // parallel CI load they can legitimately exceed Vitest's 5s default;
    // aborting one test also prevents normal cleanup and causes misleading
    // duplicate-DOM failures in the following test.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
