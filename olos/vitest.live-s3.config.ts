import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["live/**/*.test.ts"],
    testTimeout: 30_000,
    watch: false,
  },
});
