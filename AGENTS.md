# FleetSettle Codex Instructions

This file is the Codex entrypoint. It does not replace `CLAUDE.md`; it tells
Codex how to use the project documents that already exist.

## Read Order

Before changing behavior, read the smallest set that owns the change:

1. `CLAUDE.md` for project-wide rules.
2. `docs/README.md` for the document map and citation prefixes.
3. The owning document in `docs/`:
   - Product behavior: `docs/product/use-cases.md`
   - Exact flows and acceptance criteria: `docs/product/user-flows.md`
   - Schema, constraints, and report queries: `docs/engineering/data-model.md`
   - Stack constraints: `docs/engineering/tech-stack.md`
   - Implementation and testing rules: `docs/engineering/implementation-guidelines.md`
   - Screens, components, and tokens: `docs/design/ui-ux-guidelines.md`
   - Brand, icons, and voice: `docs/design/brand-guidelines.md`
4. `TRACKER.md` for what is done and every open gap.
5. `Plan.md` for the current sequencing of remaining work.
6. Source code and tests.

When documents disagree, use this priority:

`docs/` first, then `TRACKER.md`, then `Plan.md`, then source code.

If a behavior change requires changing intent, update the owning document first
and record the reason. Do not silently make the implementation become the spec.

## Core Rules

- Money is `bigint`/minor units in storage and domain code, `string` on the
  wire, never `number`.
- Every money write is transactional and append-only; corrections void and
  replace rather than overwrite.
- Reports degrade to not-available, never a confident zero, unless zero is the
  real fact.
- Business identity comes from the verified token and resolved membership,
  never from a request body or query parameter.
- Cross-tenant rows return 404; missing capability returns 403.
- "Today" means the business timezone's today, not device/server UTC.
- No cron job is a prerequisite for a user action.
- Phase-1 UI must work at 360 x 640, one thumb, no horizontal scroll.
- Interface copy must use the reserved vocabulary in `CLAUDE.md` and the UI
  guidelines. Do not introduce accounting words into the UI.
- Colors come from `--color-*` tokens. Do not add raw hex values.

## What Counts As Done

- The owning docs, `TRACKER.md`, and `Plan.md` are consistent with the change.
- The relevant unit/integration/e2e tests are updated or added.
- Money and security changes include regression coverage for the exact failure.
- Golden fixtures remain unchanged unless the owning document deliberately
  changes the expected business result.
- The relevant gate is run, or the reason it could not be run is recorded.
- Hosted QA or browser behavior is verified for user-facing fixes when the bug
  was found live.

## Working Style

- Keep edits narrow and follow existing patterns.
- Prefer shared schemas from `packages/shared`; do not hand-mirror wire types.
- Prefer fixing the primitive or root cause over patching every call site.
- Do not revert unrelated working-tree changes.
- If an item is out of scope or deliberately deferred, record why so it is not
  rediscovered as new work.
