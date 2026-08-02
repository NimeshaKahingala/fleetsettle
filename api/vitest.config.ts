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
    // `fileParallelism` is a root-only option (Vitest rejects it inside a
    // project's own `test` block) — set globally rather than only for
    // "integration", the project that actually needs it. Every integration
    // file opens its own `Pool` (support/client.ts's `writer()`) that stays
    // open until its own `afterAll`, so running every file's suite
    // concurrently opens all of them at once — past ~14 files that exceeds
    // the test branch's connection limit and queued queries start timing
    // out at 20s, in files unrelated to whatever change added the file that
    // tipped it over (P7 was the one that did, growing the suite to 17).
    // One file at a time avoids the pile-up; it costs wall-clock time, not
    // correctness, and "unit" (three small, DB-free files) pays a
    // negligible share of that cost for the same setting.
    fileParallelism: false,
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
