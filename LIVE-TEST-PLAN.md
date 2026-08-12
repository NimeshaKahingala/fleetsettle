# Live and browser testing — the pending queue

**Not a specification, and not a record.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done and carries every gap by id; [Plan.md](Plan.md) says what remains and in what order. **This says what can only be answered by a real browser against a real environment, and is therefore still unanswered.** Where they disagree: `docs/` first, then `TRACKER.md`, then `Plan.md`, then this.

**Written 8 August 2026**, after PR #11 (`acce227`) put B0b, B12, B13 and B3-core on `qa.fleetsettle.com` and PR #12 (`53258d2`) brought the trackers level with the code.

**Restored 11 August 2026, after being deleted in the 10 August `PENDING-REVIEW-ITEMS-2026-08-10.md` consolidation** — that removal was a documents-cleanup step, not a decision that live testing was done; TRACKER.md and Plan.md kept citing this file the whole time, and the 11 August QA pass (`QA-FINDINGS-2026-08-11.md`) proved the practice this file exists to run is still finding real defects on every sitting. **LT-1 through LT-8, the original queue, are all closed** — restored below with their outcomes rather than deleted, since a closed live check is still evidence something was actually seen working, the same reasoning TRACKER.md's own closed table uses. **LT-9 through LT-12 are new**, carried over from the 11 August QA session's own stated limitations and the standing acceptance items TRACKER.md still lists as open.

**This file is no longer a one-time queue scheduled as a single Plan.md item.** Every closed tier here still found something (§ below), so the standing practice is to keep it as the running list of what a browser still needs to confirm, added to as new surface ships, not retired once emptied.

---

## Why this file exists at all

Four findings now, each of which cost real time, and none of which any amount of source reading would have produced:

- **Mocked review is structurally blind to the auth boundary.** `VITE_AUTH_MODE=stub` skips straight past sign-in, so `AuthGate` and `FirstRunGate`'s non-`renderOperate` branches are exactly the code the mock replaces. GAP-49 and GAP-50 shipped through it. **Standing rule (TRACKER §5): anything touching `AuthGate`, `FirstRunGate`'s non-operate branches, or a component that can render outside `AppShell` gets one real-browser check, both colour schemes, before being called done.**
- **A source-only pass cannot see a flow that was never wireframed *and* never built.** GAP-51 and GAP-54 each fell through every prior validation pass for that reason.
- **A display-field bug looks locally correct and only reads as wrong next to real data.** GAP-56 and GAP-75 were both found live, on two consecutive days, by two different passes.
- **A confirmed-looking write can still connect to nothing.** GAP-103/GAP-109 (opening balances committed pre-F3, materialising nothing) was live, wrong money on a real committed figure, and no amount of reading `commitOpeningBalance` in isolation surfaced it — it took a real balance on a real report disagreeing with itself.

Every live pass run so far has found something. Budget for findings, not for confirmation.

---

## Before any run — the preconditions

| | Why |
|---|---|
| **Confirm QA is current** — `git fetch && git log origin/develop -1`, and check `deploy-qa` went green on that commit | Twice now, a stale QA nearly produced a false "the product is broken" reading. `git fetch` updates the *remote-tracking* ref, not your local branch — diff against `origin/develop`, never `develop` |
| **Both colour schemes, every time** | GAP-49 was invisible in light mode by coincidence and illegible in dark. One scheme is half a test |
| **Open the browser console and read it** | It surfaced GAP-50 in under a minute. Nobody had been doing this before 6 August |
| **For any assertion that works by watching for browser warnings: enable the accessibility tree first** (`Accessibility.enable` over CDP) | Headless Chromium computes it lazily. Without a client asking, the warning is never emitted and the assertion has nothing to see — **it fails silently, in the passing direction.** The first version of `e2e/sheet-a11y.spec.ts` passed against known-broken code |
| **Never trust an accessibility snapshot taken immediately after a click** — corroborate against the network log | A snapshot can render before the async data it depends on resolves. This nearly produced a report of a driver record accidentally created by a `Close` button; the network log showed the row had been in the response all along |
| **In-app browser click transport can silently stop working mid-session** (11 Aug QA pass) | Sheet interactions occasionally timed out dispatching clicks after several actions. If a click stops registering, stop and note it rather than reading a timeout as "the button doesn't work" — GAP-113/QA-02's mobile-sheet finding was confirmed against source for exactly this reason before being trusted |

---

## The queue

Ordered so that no test contaminates the state a later one needs. **Read-only first, then reversible writes, then one-way writes, with the month close last** — closing a period makes every subsequent write land in its successor and makes opening balances refuse outright.

| id | What | Status |
|---|---|---|
| **LT-1** | B0b's Review and Mine shells, both colour schemes | ✅ Closed — B0b/B4/B5 shipped and verified live 8–11 Aug |
| **LT-2** | B14's fixed receivable amount, against real data | ✅ Closed 8 Aug |
| **LT-2a** | The B9 copy batch (GAP-76/78/79/80) | ✅ Closed 8 Aug |
| **LT-3** | The 360px trip-form layout claim | ✅ Closed — no defect found, see §ended below |
| **LT-4** | The nested `Sheet`/`AmountPad` question | ✅ Closed — became GAP-104/F4, fixed 11 Aug |
| **LT-5** | B12 — opening balances, draft and resume | ✅ Closed 8 Aug — see LT-12 for the F3-era gap this did not cover |
| **LT-6** | B13 — pay the driver, advance, deposit | ✅ Closed 8 Aug |
| **LT-6a** | GAP-81 — void an expense | ✅ Closed 8 Aug, re-verified 11 Aug (fresh receipt void test) |
| **LT-7** | GAP-3 — the day-card confirm loop | ✅ Closed 6 Aug |
| **LT-8** | B3 — close the month | ✅ Closed 8 Aug |
| **LT-9** | Linked-driver 403 boundary, live | 🔴 Open — no linked-driver credentials created yet |
| **LT-10** | F4's real-device pass (iOS Safari / Android Chrome) | 🔴 Open — TRACKER.md GAP-104's own acceptance checklist still names this; nothing in this environment can substitute for it |
| **LT-11** | GAP-112 — receipt thumbnail, real camera photo | 🔴 Open — 11 Aug pass used a generated PNG; broken preview could be the fixture, not the app |
| **LT-12** | Opening-balance re-confirm, post-F5, at 360×640 | 🔴 Open — the 11 Aug pass hit GAP-109/GAP-110 mid-attempt; both are now fixed, but the actual re-confirm (QA2 Customer Rs 2,000 / QA2 Driver Rs 5,000 materialising into the reports) has never been watched succeed |

---

## LT-1 · The Review and Mine shells (B0b) — closed

`owner` and `driver` accounts landed inside real shells and were confirmed live 8–11 Aug across B0b, B4 Wave 1/2, B5 core and B6. No open item remains from the original checklist below; kept for the record.

**Original scope:** does the right role reach the right shell, does the tab bar match the spec, does the redirect-to-default-tab fire, is the page background solid in both schemes, `<Can>` degrades to "hide" rather than crash on sign-out.

**Do not invite a `manager`.** GAP-1: `viewReports` is a business-wide stand-in, so a manager reads every vehicle's reports against UC-70/71/72. The guard stands until GAP-1 is scoped — unchanged, still live, not something LT-1's closure touches.

## LT-2 / LT-2a — closed

GAP-75 (trip receivable) and the B9 copy batch (GAP-76/78/79/80) were both confirmed live 8 Aug against real data, no defect found beyond what was already fixed.

## LT-3 · The trip form at 360px — closed, no defect found

`Screen.tsx`'s `position: sticky` CTA held up under a real device check. The original report was either about something else or a resized-desktop artifact; nothing reproduced.

## LT-4 · Sheet interaction — closed, became GAP-104/F4

The nested `Sheet`/`AmountPad` question, and the two claims from the 8 Aug comprehensive pass (tappable action sheet at short viewports, Enter-key navigation on a vehicle row), led to the real finding: `useMobileHistoryDismiss`'s per-`Sheet` history race, filed as GAP-104/F4 and fixed 11 Aug. Full account in TRACKER.md's closed row. **What LT-4 did not close: LT-10**, the real iOS Safari / Android Chrome pass — every fix here was verified under Chromium touch emulation, never a real device.

## LT-5 · Opening balances (B12) — closed, with a gap LT-12 now covers

The draft/resume path and the one-way commit were both verified live 8 Aug, against a business that had never confirmed a batch before F3 existed. **What this could not have caught**: F3 (11 Aug) changed what commit *does* — batches confirmed under the pre-F3 code path never materialised into any report, which is GAP-103/GAP-109, found by the 11 Aug pass against a QA business that predates F3. LT-5 is closed as "the flow works"; LT-12 is the open question "does a stranded pre-F3 batch actually self-heal now."

## LT-6 / LT-6a — closed

B13's driver-money actions and GAP-81's void-an-expense were both verified live 8 Aug. LT-6a was re-run 11 Aug (a fresh fuel-fill receipt created and voided) with the identical outcome: row stays visible struck through, reason recorded, total decreases.

## LT-7 · The day-card confirm loop (GAP-3) — closed

Both visits completed 6 Aug: the cron ran, the real placeholder appeared, a real tap confirmed it, and a second confirm was a clean no-op.

## LT-8 · Close the month (B3) — closed

Verified 8 Aug: checklist counts render, the close button stays enabled regardless of what they say (U-7), the confirm names the consequence (M-10), a `manager` sees the action absent rather than disabled (M-22).

---

## LT-9 · The linked-driver 403 boundary, live

**Open since before this file existed — never once exercised against a real browser.** P1's own test suite proves the middleware chain rejects cross-driver access; nothing has watched a real linked-driver session hit another driver's data and get a real 404 (cross-tenant) or 403 (missing capability) in front of a browser. The 11 Aug QA pass hit the same wall the 8 Aug one did: no linked-driver credentials exist to test with.

1. Create a linked-driver account via `POST /api/driver/{id}/link-invite` + redeem, the same mechanism LT-1 used for a second owner.
2. As that driver, attempt to reach another driver's `GET /api/driver-view`-backed screen by manipulating any id the client exposes.
3. Confirm 404, not 403 — W-49/CLAUDE.md's own rule: a 403 would leak that the row exists.
4. Confirm the Mine shell itself never exposes another driver's id anywhere reachable (INV-25 — `driverId` is never a request parameter, so this should be structurally unreachable, not just blocked).

## LT-10 · F4's real-device pass

**Open since GAP-104 closed, 11 Aug.** Every fix and every regression test for the mobile `Sheet`/`ActionSheet` history race ran under Chromium touch emulation — real, but not the same runtime as Mobile Safari or a real Android Chrome build. TRACKER.md's own GAP-104 closed row names this as the one still-open acceptance item.

Open a nested sheet (e.g. `QuickAddSheet` → `AmountPad`) on a real iOS Safari and a real Android Chrome device, save, and confirm only the intended sheet closes — the parent must not close along with it.

## LT-11 · GAP-112's receipt thumbnail, with a real photo

**Open since 11 Aug, deliberately filed unverified.** The 11 Aug pass uploaded a generated PNG; the thumbnail rendered as a broken image (`naturalWidth: 0`). A7's own 26-case suite is green, which argues for a bad fixture over a real defect — **reproduce with a real camera photo before spending anything on a fix.**

1. Attach a real phone-camera JPEG (not a generated fixture) to a fuel fill or expense.
2. Open Receipts and confirm the thumbnail renders — a real image, not a broken icon.
3. If it still breaks, this is a real defect in upload/retrieval/content-type handling, not a fixture problem, and gets a proper gap id of its own (GAP-112 stays filed as the unverified predecessor).

## LT-12 · Opening-balance re-confirm, post-F5, at 360×640

**Open since the 11 Aug pass was interrupted by the exact bug it was trying to verify around.** GAP-109 (stranded pre-F3 batches materialise nothing) and GAP-110 (the confirm sheet unusable at 360×640) were both found and both fixed the same day, but the actual recovery — pressing `Confirm and go live` on the real stranded QA batch and watching the Rs 2,000 customer due and Rs 5,000 driver deposit actually appear in `Who owes us` and `Where is our cash` — has never been watched succeed. The integration test proves the domain function does this; nothing has proven the button does, live.

1. On QA, open the opening-balance batch already committed with `A customer owes us — QA2 Customer 0808155856 — Rs 2,000` and `A driver's deposit we're holding — QA2 Driver 0808155856 — Rs 5,000`.
2. At 360×640, confirm `Confirm and go live` is now reachable and clickable (GAP-110's fix).
3. Press it. Confirm success, not an error — the batch already reads as committed, so this exercises GAP-109's new active-postings check rather than the ordinary draft→committed path.
4. Re-check `Who owes us` and `Where is our cash` — both figures above must now appear.
5. Press `Confirm and go live` again on the same batch (or re-open and re-save) — must stay a clean no-op, proving the self-heal doesn't double-post on retry.

---

## What this file deliberately does not cover

- **The automated e2e suites** — `npm run test:e2e` (`e2e/smoke.spec.ts`, `e2e/sheet-a11y.spec.ts`, `e2e/mobile-sheet-history.touch.spec.ts`) run locally and in CI against a built client and need no session. They are a gate, not a queue.
- **Production.** `fleetsettle.com` is live but `main` is 45 commits behind `develop` (checked 11 Aug) and carries none of F3/F4/F5/A7/GAP-101 — there is nothing on production this file's newer items could test yet, and the deploy decision is CLAUDE.md's, not this file's.
- **`docs/testing/test-manifest.yaml`** — retired 11 Aug 2026 (GAP-58). 178 cases, never run, kept as reference design rather than adopted; this file remains the actual running live-test practice. See `docs/testing/README.md`.
- **P14 messaging** — twelve Meta template approvals outstanding, phase 2 by the owner's 11 Aug phase model.

## When one of these finds something

The convention this repository runs on, unchanged: **validate it against source before scheduling it.** Every external review absorbed so far — `UI-UX-REVIEW.md`, both `MUST-FIX-FINDINGS.md` editions, `QA-BROWSER-TEST-FINDINGS-2026-08-08.md`, `QA-FINDINGS-2026-08-11.md` — has had findings that did not hold up, and recording which ones and why is what stops the same argument happening twice. A confirmed finding becomes a row in [TRACKER.md](TRACKER.md) §4 with a gap id and a track; a rejected one becomes a paragraph in TRACKER.md §6.
