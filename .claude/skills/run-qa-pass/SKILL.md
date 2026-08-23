---
name: run-qa-pass
description: Run a live chrome-devtools-MCP browser QA pass against qa.fleetsettle.com. Use whenever a change needs verifying against real Asgardeo auth, real Postgres, or a real touch device — it carries the preconditions that have each caught a real defect once, the write ordering, and the promotion rule from a finding to a tracked gap.
---

# Running a live QA pass

## Why this exists and not a Playwright project

`web/e2e/`'s stub token is unsigned by design — a real Worker returns 401 for it (`DEPLOYMENT.md:380`), so it structurally cannot run against a deployed environment. Real Asgardeo OIDC auth is only exercisable by an actual browser session against the real IdP. This is that session, and it is not new infrastructure — `docs/qa/live-test-plan.md` plus `docs/qa/findings/*.md` is a standing practice that has found a real defect on every pass run so far (GAP-49, GAP-50, GAP-104, GAP-125, GAP-134, GAP-145 among them). Four failure classes any amount of source-only reading would have missed: **mocked review is structurally blind to the auth boundary** (`VITE_AUTH_MODE=stub` skips past sign-in — `AuthGate`/`FirstRunGate`'s non-operate branches are exactly the code the mock replaces, GAP-49/GAP-50); **a flow that was never wireframed and never built has nothing for a source pass to check** (GAP-51, GAP-54); **a display-field bug reads locally correct and only looks wrong next to real data** (GAP-56, GAP-75); **a confirmed-looking write can still connect to nothing** (GAP-103/GAP-109 — opening balances committed pre-F3 materialised nothing, and no amount of reading `commitOpeningBalance` in isolation surfaced it). Every pass run so far has found something — budget for findings, not for confirmation.

`docs/qa/scenarios/` is the catalogue of *what* to check (happy path / edge case / error case per flow, cited back to `UC-`/`F-`/`INV-` ids) — pull scenarios from there rather than inventing coverage ad hoc. `docs/qa/live-test-plan.md`'s `LT-n` table is what's actually pending right now against the current build.

## Preconditions — each one closed a real miss

- **Confirm `deploy-qa` is green on the current `origin/develop` commit before starting.** A stale QA has twice produced a false "broken" reading.
- **Check both colour schemes, every time.** GAP-49 was invisible in one.
- **Open the console before the first navigation** and re-check it (`list_console_messages`) after every step. GAP-50 was found this way, in under a minute.
- **`resize_page` to 360×640 for every phase-1-gated flow** (M-1), plus a 320px reflow check.
- **Corroborate a post-click snapshot against `list_network_requests`**, not `take_snapshot` alone — a snapshot can render before its own async data resolves. Nearly produced a report of a driver record accidentally created by a `Close` button; the network log showed the row had been in the response all along.
- **Cross-check every money figure against the real QA Neon branch**, via `mcp__neon__run_sql`, read-only (or `npm run audit:ledger` — `api/scripts/ledger-audit.mjs`'s 25 read-only invariant checks, added after a real live pass). A display figure is only trusted once it agrees with the row that produced it.
- **For any assertion that works by watching for a browser warning, enable the accessibility tree first** (`Accessibility.enable` over CDP). Headless Chromium computes it lazily — without a client asking, the warning is never emitted and the assertion has nothing to see, failing silently in the passing direction. The first version of `e2e/sheet-a11y.spec.ts` passed against known-broken code this exact way.
- **If clicks stop registering mid-session, stop and note it** rather than reading a timeout as "the button doesn't work" — the in-app browser's click transport has silently stopped working mid-session before (GAP-113/QA-02 was confirmed against source for exactly this reason before being trusted).

## Ordering — read-only first, terminal writes last

Read-only observation, then reversible writes, then one-way writes (month close, lease closure) last — in that order, every session. A one-way write is real, permanent state on a shared environment other sessions rely on; only spend one once the read-only pass has confirmed it's worth spending. `docs/qa/live-test-plan.md`'s own LT-13 row is the model: verify the navigation lands correctly and stop before the terminal write, unless the write itself is what's being tested.

## Sign-in

Real Asgardeo auth only — there is no stub path against a deployed environment (see above). Credentials are in `testCred.md` (repo root, gitignored, not git-tracked — confirm this with `git check-ignore testCred.md` before relying on it, don't assume). Sign in as the account whose role matches what's being tested — `nimesha.isholi94@gmail.com` is an owner-manager on QA's test businesses and also its platform admin.

## Output

A new dated file at `docs/qa/findings/YYYY-MM-DD.md`, following the structure of the most recent existing file in that directory (precondition check → session type/tooling → summary table ranked by severity/money-accuracy → one section per finding). Update `docs/qa/live-test-plan.md`'s `LT-n` queue table for any item opened, closed, or worth re-opening.

## Promotion — a finding isn't tracked until it's a GAP

A confirmed defect gets filed as a new `GAP-n` row in `TRACKER.md` §4, matching the existing convention exactly (short title, live repro steps, root cause once traced, fix or explicit deferral). A findings doc on its own is evidence, not a tracked item — nothing downstream reads `docs/qa/findings/*.md` for open work, only `TRACKER.md` §4. A rejected finding — one that doesn't hold up against source — becomes a paragraph in `TRACKER.md` §6 instead of being silently dropped, the same validation every external review gets.

## Before calling it done

- [ ] Every precondition above actually ran, not just the ones convenient to the flow being checked.
- [ ] The findings doc exists at `docs/qa/findings/YYYY-MM-DD.md` and follows the existing structure.
- [ ] Every confirmed defect has a `GAP-n` row in `TRACKER.md` §4; every rejected one has a §6 paragraph.
- [ ] `docs/qa/live-test-plan.md`'s `LT-n` table reflects reality, not just what this session touched.
