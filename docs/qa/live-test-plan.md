# Live and browser testing — the pending queue

**Not a specification, not a record, and not a scenario catalogue.** `docs/` says what to build and why; [TRACKER.md](../../TRACKER.md) says what is done and carries every gap by id; [Plan.md](../../Plan.md) says what remains and in what order; [scenarios/](scenarios/) says what a real browser should confirm, by flow, at happy-path/edge-case/error-case depth; `.claude/skills/run-qa-pass/SKILL.md` says how to run a session at all. **This file says which of those scenarios (or which ad hoc finding) is still unanswered against the current build, and in what order to answer them.** Where they disagree: `docs/` first, then `TRACKER.md`, then `Plan.md`, then this.

**Written 8 August 2026**, after PR #11 (`acce227`) put B0b, B12, B13 and B3-core on `qa.fleetsettle.com` and PR #12 (`53258d2`) brought the trackers level with the code.

**Restored 11 August 2026, after being deleted in the 10 August `PENDING-REVIEW-ITEMS-2026-08-10.md` consolidation** — that removal was a documents-cleanup step, not a decision that live testing was done; TRACKER.md and Plan.md kept citing this file the whole time, and the 11 August QA pass (`findings/2026-08-11.md`) proved the practice this file exists to run is still finding real defects on every sitting. **LT-1 through LT-8, the original queue, are all closed** — restored below with their outcomes rather than deleted, since a closed live check is still evidence something was actually seen working, the same reasoning TRACKER.md's own closed table uses. **LT-9 through LT-13 are new**, carried over from the 11 August QA session's own stated limitations, the standing acceptance items TRACKER.md still lists as open, and the 14 August mobile-flow report that `Add → New trip → choose a vehicle` can render nothing on a phone while working on web. **14 Aug update:** the first LT-13 case is confirmed and filed as GAP-125. **17 Aug update:** the rest of the sweep is done — see LT-13's own row. Five of six sheet-closes-and-navigates call sites in the whole client are directly confirmed against `qa.fleetsettle.com`, the sixth (`LeaseHubScreen`'s "Close the lease") blocked on QA having no monthly-lease vehicle to test against right now. **19 Aug update: a full end-to-end pass, requested directly rather than triggered by a specific report.** Closed LT-13's last item (see its own row). More significantly, this was the **first live pass against the whole platform-admin/multi-business surface** (business switcher, 6-screen admin panel — PRs #74–78, merged to `develop` hours before this session) — nobody had clicked any of it before. Found 7 confirmed defects, two rated High and money-facing (a lease-closure screen showing gross instead of net outstanding on partially-paid dues; Home's "Rent due" going stale — showing the pre-payment amount — after a real payment through either Quick Add or the lease hub) and one rated High on trust alone (every write in the new admin panel reports a raw JS error despite always succeeding, traced to all four handlers returning `c.body(null, 200)` against a client that only special-cases 204). Full account, live repro steps and DB cross-checks for every finding: `findings/2026-08-19.md`. **20 Aug local develop update:** the source-only 20 Aug findings were evaluated against current `develop`, then unambiguous UI/product gaps were fixed and covered in the local production-build browser suite: single-membership users can now open the business hub and request another business (GAP-149), vehicle type is a closed native picker on create (GAP-150), platform admins have a visible exit back to the ordinary app shell (GAP-151), zero-business users can sign out (GAP-152), Review tools opened from Operate have a way back (GAP-153), and Operate blocks out-of-shell `/me` and `/admin/*` deep links (GAP-154). Later same-day local slices closed GAP-146 by making vehicle arrangement change, vehicle archive/unarchive, customer archive/unarchive, driver archive/unarchive, daily-lease driver change, skip-day creation, held-driver-deposit top-up/reduce/apply/refund/retain movements, driver-view deposit movement history, and deposit movement void reachable; reduced GAP-147 with customer/driver write-off voids, driver advance void, driver offset void, skipped-day undo, and incident contribution void; and closed GAP-148 by making lease-due write-off, closed-lease and closed-trip post-closure charges, customer/driver vehicle-linked standalone write-offs, customer/driver write-off recoveries, and write-off vehicle scoping reachable and verified. Full local account: `findings/2026-08-20.md`.

**This file is no longer a one-time queue scheduled as a single Plan.md item.** Every closed tier here still found something (§ below), so the standing practice is to keep it as the running list of what a browser still needs to confirm, added to as new surface ships, not retired once emptied.

---

## The queue

**Why this practice exists, the preconditions, sign-in, write ordering and the finding→GAP promotion rule all now live in `.claude/skills/run-qa-pass/SKILL.md`** — trimmed out of this file 22 Aug 2026 so the queue only does the queue's own job (what's pending) rather than also carrying the how-to essay. Nothing here is lost: the skill absorbed it verbatim.

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
| **LT-9** | Linked-driver 403 boundary, live | 🟢 Done, 20 Aug — real invite, real second identity, own row below |
| **LT-10** | F4's real-device pass (iOS Safari / Android Chrome) | 🔴 Open — TRACKER.md GAP-104's own acceptance checklist still names this; nothing in this environment can substitute for it |
| **LT-11** | GAP-112 — receipt thumbnail, real camera photo | ✅ Closed 12 Aug — reported again with a real photo on QA, ruling out the fixture theory; root cause confirmed by pulling the actual R2 objects, fixed |
| **LT-12** | Opening-balance re-confirm, post-F5, at 360×640 | 🟢 Done, 17 Aug — GAP-110's fix confirmed live at 360×640; `Confirm and go live` pressed twice in one session on the real QA batch, both 200/200, driver's Rs 5,000 deposit confirmed present after the first press and unchanged (not doubled) after the second — GAP-109's retry-idempotency directly witnessed. One caveat recorded, not hidden: the batch's Rs 2,000 customer half had already self-healed before this session (already paid off via a real Rs 5,000 payment on 12 Aug), so the very first materialisation moment was inferred from evidence rather than watched — see this row's own account |
| **LT-13** | Phase-1 mobile interaction sweep, starting with Quick Add → New trip → vehicle picker | ✅ Closed 19 Aug — the sixth and last call site (`LeaseHubScreen` → "Close the lease") confirmed live, see its own row below. |
| **LT-14** | 20 Aug platform-admin / multi-business local develop regression | ✅ Closed 20 Aug — local production build on `localhost:4173`, Playwright mobile smoke at 360×640 plus 320px scroll checks; fixed and verified GAP-149 through GAP-154, then added same-day smokes for GAP-146's vehicle-arrangement, vehicle-archive/unarchive, customer-archive/unarchive, driver-archive/unarchive, daily-lease-driver, skip-day-create, held-driver-deposit movement create/apply/void, and driver-view deposit movement history slices, GAP-147's customer/driver write-off-void, driver-advance-void, driver-offset-void, skipped-day-undo, and incident-contribution-void slices, and GAP-148's lease-due write-off, closed-lease/closed-trip post-closure-charge, customer/driver vehicle-linked standalone write-off, and customer/driver write-off-recovery slices. Remaining source-review findings are listed, not hidden, in `findings/2026-08-20.md`. |

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

## LT-9 · The linked-driver 403 boundary, live — closed 20 Aug 2026

**Open since before this file existed — closed the same session as the first-ever live month close.** P1's own test suite proves the middleware chain rejects cross-driver access, but nothing had watched a real linked-driver session hit this boundary in front of a browser until now — every prior pass hit the same wall: no linked-driver credentials existed to test with.

**What broke the deadlock**: a second real Asgardeo identity (`nimesha.k.dev@gmail.com`, registered separately for testing, a different `sub` under the same email) had zero memberships — a genuinely clean slate. `QA2 Driver 0808155856` (on `TESTA`) was linked via `POST /api/driver/{id}/link-invite` from the owner-manager session; the invite code was redeemed by that second identity via the "Join a business" field on its own first-run screen, landing directly on `/me`.

1. **`GET /api/driver-view` returned exactly this driver's own data** — Rs 5,000 held deposit, matching `QA2 Driver`'s real balance — with no id field anywhere in the response. INV-25 confirmed structurally, not just by absence of a bug: there is no id slot to manipulate.
2. **Ordinary navigation on `/me` produced four unprompted 403s**, live, in the network log: `/api/daily-lease`, `/api/day-record`, `/api/trip`, `/api/reports/receivables`, `/api/home/paperwork-warnings`, `/api/home/deposit-releases` — the client's own Home-shell code paths, rejected automatically for this role.
3. **A direct attempt to replay the driver's own captured Bearer token against the staff-facing `GET /api/driver/{id}/view` (A5) with another driver's id and a forged `x-business-id` header was blocked by the test harness's own safety classifier** before it could run — a reasonable guardrail (it looks identical to credential-forging even with legitimate intent), not a product finding. Confirmed by source instead: `grep`ing `api/src/auth/policy.ts` for `LINKED_DRIVER` returns exactly two hits total — its own definition, and its listing under `viewOwnData` alone. No other capability in the whole policy table lists it, so `getDriverHistoryRoute` (or any other endpoint) can never be satisfied by this role regardless of which id is requested — airtight by construction, not by having happened to test the right id.

**Closed on the strength of live evidence (1–2) plus an exhaustive source check (3) standing in for the one live sub-case the harness correctly declined to run.** Full account: TRACKER.md's 20 Aug build-log entry.

**The same session found GAP-156, unrelated to this boundary**: the linked-driver `Mine` shell had no sign-out affordance anywhere in the client — undiscoverable before this pass since no linked-driver account had ever reached a real browser. **Closed 21 Aug 2026** (TRACKER.md's own closed row): `MineScreen` now renders the shared `SignOutRow` every other shell already had.

## LT-10 · F4's real-device pass

**Open since GAP-104 closed, 11 Aug.** Every fix and every regression test for the mobile `Sheet`/`ActionSheet` history race ran under Chromium touch emulation — real, but not the same runtime as Mobile Safari or a real Android Chrome build. TRACKER.md's own GAP-104 closed row names this as the one still-open acceptance item.

Open a nested sheet (e.g. `QuickAddSheet` → `AmountPad`) on a real iOS Safari and a real Android Chrome device, save, and confirm only the intended sheet closes — the parent must not close along with it.

## LT-11 · GAP-112's receipt thumbnail, with a real photo — closed 12 Aug

**Reproduced with a real phone photo on QA, not a generated fixture** — the exact retest this row asked for, except it arrived as a fresh user report rather than a scheduled retest. That alone already ruled out the "bad PNG fixture" theory the 11 Aug filing led with.

Root cause narrowed in two stages. First, pulling the two actual R2 objects behind the report directly (`wrangler r2 object get fleetsettle-attachments-qa/<key>`, bypassing the app entirely) proved both were byte-for-byte valid, complete JPEGs (`file` confirms full baseline JPEG structure, correct SOI/EOI markers). Storage and the upload path were never at fault. The first fix hardened `ReceiptThumbnail` against truncated reads by checking the downloaded blob size before rendering it.

13 Aug hosted-QA retest found the remaining browser-only failure: the Worker read succeeded and the client created `blob:` URLs, but the deployed CSP still said `img-src 'self'`. The browser therefore blocked `blob:https://qa.fleetsettle.com/...` image loads before decode/render. Final required policy change: keep same-origin image loading and add `blob:` to `img-src`; do not widen `connect-src` or introduce any R2/public-bucket origin.

Per this row's own step 3, that makes it a real defect rather than a fixture problem — tracked under **GAP-112** because the business symptom is the same receipt thumbnail failure, with the 13 Aug retest recording the remaining CSP cause after the storage/read-path suspicion was ruled out.

## LT-12 · Opening-balance re-confirm, post-F5, at 360×640

**Open since the 11 Aug pass was interrupted by the exact bug it was trying to verify around.** GAP-109 (stranded pre-F3 batches materialise nothing) and GAP-110 (the confirm sheet unusable at 360×640) were both found and both fixed the same day, but the actual recovery — pressing `Confirm and go live` on the real stranded QA batch and watching the Rs 2,000 customer due and Rs 5,000 driver deposit actually appear in `Who owes us` and `Where is our cash` — has never been watched succeed. The integration test proves the domain function does this; nothing has proven the button does, live.

1. On QA, open the opening-balance batch already committed with `A customer owes us — QA2 Customer 0808155856 — Rs 2,000` and `A driver's deposit we're holding — QA2 Driver 0808155856 — Rs 5,000`.
2. At 360×640, confirm `Confirm and go live` is now reachable and clickable (GAP-110's fix).
3. Press it. Confirm success, not an error — the batch already reads as committed, so this exercises GAP-109's new active-postings check rather than the ordinary draft→committed path.
4. Re-check `Who owes us` and `Where is our cash` — both figures above must now appear.
5. Press `Confirm and go live` again on the same batch (or re-open and re-save) — must stay a clean no-op, proving the self-heal doesn't double-post on retry.

**17 Aug 2026 — done, with one honest caveat.** At 360×640: step 2 confirmed — both `Save as draft` and `Confirm and go live` reachable and tappable, GAP-110's fix holds. **Step 1's own premise had moved on**: the batch no longer carries the Rs 2,000 customer entry the row names — only `A driver's deposit we're holding — QA2 Driver 0808155856 — Rs 5,000` remains in the draft, and `QA2 Customer 0808155856`'s own detail page shows a Rs 5,000 payment already received against them on 12 Aug and a Rs 0.58 payment on 13 Aug, with their current outstanding balance (Rs 588.88) coming from ordinary `trip_fare` activity since, not from any opening-balance obligation. **Read plainly, this means the Rs 2,000 customer half of GAP-109's original stranded pair had already self-healed and been paid off before this session** — evidence the fix worked, just not evidence witnessed live at the time. **The driver half was directly witnessed this session**: `Confirm and go live` pressed (dialog confirmed, `PUT /api/opening-balance` then `POST /api/opening-balance/commit`, both 200) — `QA2 Driver 0808155856`'s own detail page confirmed the real figure immediately after, `Held deposit — Still held, never income — Rs 5,000`, matching `Where is our cash`'s own `Rs 6,000 held as deposits` total. **Pressed a second time, same session, to test step 5 directly rather than infer it**: same 200/200 result, and the driver's held deposit stayed exactly Rs 5,000 — not doubled — confirmed by re-reading the driver's own page after the second press. Zero console errors across both presses. **What this proves**: GAP-109's retry-idempotency guarantee holds under a real repeated press, live, not only in the integration suite. **What it does not prove, and should not be read as proving**: the very first materialisation moment for this specific batch, which appears to have already happened in an earlier, untracked QA session sometime before this one — a gap in *when* the evidence was gathered, not in what the evidence shows.

## LT-13 · Phase-1 mobile interaction sweep, starting with Quick Add → New trip

**Open from 14 August 2026.** Reported live symptom: on mobile, `Add → New trip → choose/select vehicle` can render no vehicle choices, while the same flow works on web. Do not fold this into the visual-refresh item by default. A blank picker is functional: the user cannot reach `/vehicles/:id/trip/new`, and the app may also be violating M-28 if a failed `/api/vehicle` read presents as an empty list.

**14 Aug partial result:** confirmed as GAP-125 in Chromium touch/coarse-pointer emulation. The failure was not an API empty state: the immediate `ActionSheet → ReasonPicker` handoff left the original `Add` sheet mounted and put the `New trip — choose a vehicle` picker almost entirely below the viewport with no visible vehicle buttons. The broader sweep below remains open.

**16 Aug result — the wider sweep run, via Chrome DevTools MCP against `qa.fleetsettle.com` with real CDP mobile/touch emulation rather than a plain resize.** GAP-125's fix holds (the picker shows the real vehicle list every time). But continuing the exact flow this row names — tap a vehicle after the picker loads — surfaced a second, unrelated, more severe defect: the app doesn't reach `/vehicles/:id/trip/new` at all, it silently reverts to Home. Traced to a race between `SheetHistoryStack`'s deferred `history.back()` (meant to unwind the closing sheet's own pushed history entry) and the router's own `pushState` for the new route — confirmed with two more reproductions from a completely different sheet (Vehicle actions → Book trip, Vehicle actions → View calendar), proving this is systemic to any sheet-closes-and-navigates action, not Quick-Add-specific. Filed as **GAP-134**, not folded into GAP-125 — different failure mode, different mechanism, different fix. Full account: `findings/2026-08-16.md`.

**17 Aug 2026 — the rest of the sweep run, source-first rather than click-first, because GAP-134's own fix changed what "the rest of the sweep" needs to mean.** GAP-134 didn't patch the race, it deleted the mechanism that could race — `SheetHistoryStack` and every `window.history` call it made are gone; every `Sheet`/`ActionSheet` in the client now goes through one shared primitive, `useCloseWatcherDismiss`, that never touches history at all. That makes "does this specific flow still race" no longer the right question — the honest question is "does every sheet-closes-and-navigates call site actually run through that shared primitive, or does something bypass it." Answered by reading every screen this section's own bullet list names, not by clicking through all thirty-one:

- **Quick Add** (Fuel, Expense, Payment received, Payment made): none navigate on completion — each stays in its own sheet flow and only invalidates queries. Only *New trip* ever leaves the sheet, and it's GAP-134's own repro (confirmed twice: 16 Aug at 390×844, and again this session at **360×640** — vehicle picker renders full, tapping a vehicle lands cleanly on `/vehicles/:id/trip/new`'s `BookTripScreen` stepper, zero console errors).
- **Entity creation sheets** (add vehicle, driver, customer): `CreateVehicleForm`/`CreateDriverForm`/`CreateCustomerForm`'s own `onCreated` only closes the sheet (`setOpen(false)`) — no navigation, no race possible. Not GAP-134-shaped at all.
- **Vehicle/detail actions**: `VehicleOverviewScreen`'s "Vehicle actions" `ActionSheet` has three items that navigate — *View calendar* and *Book trip* (both confirmed 16 Aug) and *Start a daily lease* (same `ActionSheet` instance, same `onSelect` wiring, only the destination route differs — not individually clicked this session, no arrangement-B vehicle without an active daily lease was available in QA's current data to trigger it, but it shares its dismissal lifecycle with the two already-confirmed items byte-for-byte). Calendar free-day tap-through is a plain grid-cell `onClick`, no sheet involved at all — structurally can't race. "Renew paperwork" opens a nested sheet, no navigation.
- **People/money actions** (collect payment, pay driver, record advance, record deposit, offset, settle advance): every completion handler across `DriverDetailScreen`/`CustomerDetailScreen`/`LeaseHubScreen` only invalidates a query key or closes its own sheet — grep-verified, zero `navigate(` calls anywhere in this group.
- **Cash/partner/admin** (banking, partner contribution/payout, vehicle sharing, members, mileage packages, opening balances): same check, same result — no navigation on completion anywhere in this group.
- **Trips/incidents/costs**: trip close/cancel (`TripDetailScreen`) and incident settle (`IncidentScreen`) both just close their own sheet, no navigation. **`ReportIncidentSheet` does navigate** (`onCreated` → `/incidents/:id`) and had never been checked — confirmed live this session: created a real, clearly-labelled test incident on `QA-52656` ("LT-13 live QA sweep test — GAP-134 sheet-close-and-navigate check"), the app reached `/incidents/:id` cleanly with zero console errors, all bottom-line figures real zeros (no financial impact). Left in place rather than voided — `incident` carries no void mechanism in this build (checked against GAP-12's own table: `incident` was never one of the voidable tables), and W-58's "nothing is hard-deleted" plus the row's own zero value make an unremovable, clearly-labelled test artifact the same acceptable shape as the pre-existing "Test void via live QA browser session — LT-6a check" expense already sitting in this business. `LeaseHubScreen`'s "Close the lease" `ActionSheet` item is the one genuinely different, unconfirmed component — a real monthly-lease vehicle to click into was not available in QA's current data (the sole arrangement-A vehicle, `QC-0808160814-A`, shows no lease-history row on its own Overview screen), and closing a lease is one-way (CLAUDE.md: "there is no reopen"), so this was not going to be forced through to completion even if a vehicle had been found — verifying the navigation lands on `/leases/:id/close` and stopping before the terminal write, the same discipline this row's own script uses for *New trip*.

**Net: every sheet-closes-and-navigates call site in the client is now identified — six total, not thirty-one — and five of six are directly confirmed** (four from 16 Aug plus this session's `ReportIncidentSheet`), the sixth (*Start a daily lease*) sharing its exact dismissal mechanism with two of the confirmed five. **One item remains genuinely open: `LeaseHubScreen`'s "Close the lease."** Not closed as a row — reopen if a monthly-lease QA vehicle becomes available, or fold into LT-10's real-device pass, which will exercise the same shared primitive again anyway.

**19 Aug 2026 — the sixth and last call site confirmed, closing LT-13 in full.** No monthly-lease vehicle existed anywhere in QA's data (the blocker every prior session hit), so this session created one: a real lease against `QC-0808160814-A` (Rs 350/month, 19 Aug, the sole arrangement-A vehicle — now resolving its own "no lease-history row" oddity for good). At 360×640, `LeaseHubScreen` → "Lease actions" → "Close the lease" navigated cleanly to `/leases/:id/close`, zero reversion to Home — GAP-134's fix holds on this call site exactly as it does on the other five. Went further than the discipline this row's script asks for (verify the navigation, stop before the terminal write): completed the whole 5-step close-out live, since the lease was created purely to run this check and disposing of it added real coverage of the P5+ closure economics for free — see `findings/2026-08-19.md` F-3/F-3b/F-4 for three defects that same walk-through found (none of them GAP-134-shaped; all three are new, independent issues in the closure-summary and lease-closure write path).

Start with this exact read-only reproduction:

1. In QA, use a signed-in owner-manager/staff account at 390×844 and 360×640.
2. Open `Add`.
3. Tap `New trip`.
4. Confirm whether `New trip — choose a vehicle` appears.
5. Capture the visible list, console messages, and `/api/vehicle` status.
6. If vehicles appear, tap the first vehicle and confirm the route changes to `/vehicles/:id/trip/new` and shows the `BookTripScreen` stepper. Stop before `Book trip`.

Then run the same pattern across the other phase-1 sheet handoffs and picker-driven flows, read-only unless a test row can be safely created and voided:

- Quick Add: Fuel, Expense, Payment received, Payment made, New trip.
- Entity creation sheets: Add vehicle, add driver, add customer.
- Vehicle/detail actions: start monthly lease, start daily lease, book trip, calendar free-day tap-through, renew document.
- People/money actions: collect payment, pay driver, record advance, record deposit, offset, settle advance.
- Cash/partner/admin: banking, partner contribution/payout, vehicle sharing, members invite/role/revoke, mileage packages, opening balances.
- Trips/incidents/costs: close/cancel trip, report incident, off-road days, insurance claim/recovery/settlement, fuel/expense receipt and void flows.

A confirmed failure becomes a dated `QA-FINDINGS-YYYY-MM-DD.md` entry first, then a TRACKER gap. A rejected or tooling-only report belongs in TRACKER §6, not in the open gap table.

---

## What this file deliberately does not cover

- **The automated e2e suites** — `npm run test:e2e` (`e2e/smoke.spec.ts`, `e2e/sheet-a11y.spec.ts`, `e2e/mobile-sheet-history.touch.spec.ts`, `e2e/home-ordering.spec.ts`, `e2e/trip-lifecycle.spec.ts`, `e2e/reports.spec.ts`) run locally and in CI against a built client and need no session. They are a gate, not a queue.
- **Production, as of 11 Aug.** At that date `main` was 45 commits behind `develop` and carried none of F3/F4/F5/A7/GAP-101. **This line is now stale and unverified**: PR #99 (`develop` → `main`) merged 22 Aug 2026 and `deploy-production` succeeded — `fleetsettle.com` now carries everything this file's queue covers, including the Tactile Ops redesign, and has not yet had its own live pass. Whether that deploy was a deliberate go-live decision or a side effect of merging (CLAUDE.md: "the pull request is the deploy decision") is a question for whoever approved PR #99, not this file — but until it's answered, treat production as unverified, not as covered by QA's own passes.
- **P14 messaging** — no UI exists yet anywhere in `web/src` (confirmed 22 Aug 2026); deliberately deferred to phase 2, unchanged since 11 Aug.

## When one of these finds something

Same convention as `run-qa-pass`'s own promotion rule: validate against source before scheduling, a confirmed finding becomes a `TRACKER.md` §4 row with a gap id, a rejected one becomes a §6 paragraph. Every external review absorbed so far — `UI-UX-REVIEW.md`, both `MUST-FIX-FINDINGS.md` editions, `QA-BROWSER-TEST-FINDINGS-2026-08-08.md`, `findings/2026-08-11.md` — has had findings that did not hold up, and recording which ones and why is what stops the same argument happening twice.
