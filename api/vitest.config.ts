import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests round-trip a real Neon branch (IG §8.1) — slower
    // than the default 5s, and worth it: this schema's correctness is
    // largely its constraints, and a mock has none of them.
    testTimeout: 20_000,
  },
});
