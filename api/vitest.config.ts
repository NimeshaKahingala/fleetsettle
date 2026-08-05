import { defineConfig } from "vitest/config";

// IG §8.1's "two Vitest projects": unit needs no database and belongs in the
// plain `npm run check` gate; integration drives the real Hono app against a
// real Neon branch and only runs where one has been provisioned — locally
// against .dev.vars, or in CI against a per-PR ephemeral branch.

// Opt-in, TEST_PARALLEL=1: every integration file opens its own `Pool`
// (support/client.ts's `writer()`, pg's own default max: 10 connections)
// held open until its own `afterAll` — past ~14 concurrent files that
// exceeds a Neon branch's connection limit and queued queries start timing
// out at 20s (P7's own discovery, at 17 files, against the shared branch
// every session before this one also used). Uncapped `fileParallelism`
// would run all ~29 files at once and hit the identical wall on *any*
// branch, personal or shared — 4 concurrent files stays comfortably under
// that ceiling while still being a real wall-clock win over one at a time.
// Only turn this on against a branch dedicated to it (a fresh
// TEST_DATABASE_URL, not the one other sessions or CI also point at) —
// otherwise this just relocates the same contention, it doesn't remove it.
const parallel = process.env["TEST_PARALLEL"] === "1";

export default defineConfig({
  test: {
    // "No test files found" is checked against the root config even when
    // running a single --project, so this has to be set here too, not just
    // on the "unit" project below — nothing exists in src/**/*.test.ts
    // before domain/ does (P3).
    passWithNoTests: true,
    // `fileParallelism`/`poolOptions` are root-only options (Vitest rejects
    // them inside a project's own `test` block) — set globally rather than
    // only for "integration", the project that actually needs bounding.
    // "unit" (three small, DB-free files) pays a negligible share of
    // either setting, parallel or not.
    fileParallelism: parallel,
    ...(parallel ? { poolOptions: { threads: { minThreads: 1, maxThreads: 4 } } } : {}),
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
