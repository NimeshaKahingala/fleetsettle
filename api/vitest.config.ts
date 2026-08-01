import { defineConfig } from "vitest/config";

// IG §8.1's "two Vitest projects": unit needs no database and belongs in the
// plain `npm run check` gate; integration drives the real Hono app against a
// real Neon branch and only runs where one has been provisioned — locally
// against .dev.vars, or in CI against a per-PR ephemeral branch.
export default defineConfig({
  test: {
    // "No test files found" is checked against the root config even when
    // running a single --project, so this has to be set here too, not just
    // on the "unit" project below — nothing exists in src/**/*.test.ts
    // before domain/ does (P3).
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.test.ts"],
          // Round-trips a real Neon branch (IG §8.1) — slower than the
          // default 5s, and worth it: this schema's correctness is largely
          // its constraints, and a mock has none of them.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
