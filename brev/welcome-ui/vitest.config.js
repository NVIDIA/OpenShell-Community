import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 10000,
  },
});
