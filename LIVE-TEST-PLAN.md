# Live and browser testing — the pending queue

**Not a specification, and not a record.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done and carries every gap by id; [Plan.md](Plan.md) says what remains and in what order. **This says what can only be answered by a real browser against a real environment, and is therefore still unanswered.** Where they disagree: `docs/` first, then `TRACKER.md`, then `Plan.md`, then this.

**Written 8 August 2026**, after PR #11 (`acce227`) put B0b, B12, B13 and B3-core on `qa.fleetsettle.com` and PR #12 (`53258d2`) brought the trackers level with the code. Everything below was scattered across two documents as prose; collecting it here is what makes it runnable in one sitting instead of rediscovered one at a time.

**Plan.md schedules this whole file as a single item, `V1`, at the head of the Track B queue.**

---

## Why this file exists at all

Three findings, each of which cost real time, and none of which any amount of source reading would have produced:

- **Mocked review is structurally blind to the auth boundary.** `VITE_AUTH_MODE=stub` skips straight past sign-in, so `AuthGate` and `FirstRunGate`'s non-`renderOperate` branches are exactly the code the mock replaces. GAP-49 and GAP-50 shipped through it. **Standing rule (TRACKER §5): anything touching `AuthGate`, `FirstRunGate`'s non-operate branches, or a component that can render outside `AppShell` gets one real-browser check, both colour schemes, before being called done.**
- **A source-only pass cannot see a flow that was never wireframed *and* never built.** GAP-51 and GAP-54 each fell through every prior validation pass for that reason.
- **A display-field bug looks locally correct and only reads as wrong next to real data.** GAP-56 and GAP-75 were both found live, on two consecutive days, by two different passes.

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

---

## The queue

Ordered so that no test contaminates the state a later one needs. **Read-only first, then reversible writes, then one-way writes, with the month close last** — closing a period makes every subsequent write land in its successor and makes opening balances refuse outright.

| id | What | Writes to live data | Blocked by |
|---|---|---|---|
| **LT-1** | B0b's Review and Mine shells, both colour schemes | Yes — one `business_member` row and one driver link | A second real Asgardeo identity |
| **LT-2** | B14's fixed receivable amount, against real data | No | — |
| **LT-3** | The 360px trip-form layout claim | No | A real device |
| **LT-4** | The nested `Sheet`/`AmountPad` question | No | — |
| **LT-5** | B12 — opening balances, draft and resume | Draft only: safe. **Commit: one-way** | — |
| **LT-6** | B13 — pay the driver, advance, deposit | **Yes, and not undoable from the product** | — |
| **LT-7** | GAP-3 — the day-card confirm loop | Yes | **A cron run in between** |
| **LT-8** | B3 — close the month | **Irreversible** | Run last |

---

## LT-1 · The Review and Mine shells (B0b)

**Open since:** 8 August, the day B0b shipped. **Why it is first:** it is the boundary the standing rule names, on code that has already shipped two bugs.

`owner` and `driver` accounts have been *obtainable* since A11 and have never been *held* by anyone. Both land on `NotBuiltYetScreen` inside their own real shell — that placeholder is B4's and B5's job, so **the test is the shell, not the content**: does the right role reach the right shell, does the tab bar match the spec, does the redirect-to-default-tab fire, is the page background solid in both schemes.

**Cost worth naming up front: this needs a second real Asgardeo identity**, and there is no in-app invite screen yet (A11 built `POST /api/business-member/invite` and `POST /api/driver/{id}/link-invite` deliberately without callers — that screen needs B0b's shell to live in, and is still unlettered in Plan.md). So the invite code comes from a direct API call as the existing owner-manager, and the second identity redeems it in the browser.

1. As the current `owner_manager`, `POST /api/business-member/invite` with role `owner`; note the code.
2. Sign in as the second identity in a clean profile → `FirstRunGate` should offer **two equally first-class options**, create a business *and* redeem a code.
3. Redeem → expect the **Review** shell: four tabs (`This month`, `Vehicles`, `My money`, `Reports`), no `＋`, no Operate tabs.
4. Navigate to an Operate URL directly (`/vehicles`) → expect the redirect to Review's default tab, not a dead route.
5. Repeat 1–4 with `POST /api/driver/{id}/link-invite` → expect the **Mine** shell at `/me`, **no tab bar at all**, and **zero write affordances**.
6. Both schemes, both roles. Console clean.
7. **Sign out from each** — `<Can>` was fixed during B0b to degrade to "hide" rather than crash when the query cache clears before navigation completes. That window is narrow and only exists live.

**Do not invite a `manager`.** GAP-1: `viewReports` is a business-wide stand-in, so a manager reads every vehicle's reports against UC-70/71/72. The guard stands until GAP-1 is scoped.

## LT-2 · The trip receivable's amount (B14)

**Open since:** 8 August. **Read-only.** GAP-75 was found live and fixed the same day; the fix has never been seen against real data, which is precisely how the bug got in.

Open a trip that has a customer and a nonzero agreed amount and is **unpaid**. The receivable row must read the **amount owed**, not `Rs 0`. Then collect a partial payment and confirm the row still reads the amount owed with a `part_paid` status — the field that was wrong (`settledMinor`) is only obviously wrong while nothing has been collected.

## LT-3 · The trip form at 360px

**Open since:** 8 August, filed unresolved rather than guessed at. `Screen.tsx:83-91` implements a proper `position: sticky` CTA per M-24, the same pattern every other form uses correctly — so either the report was about something else, or it is a device-only rendering issue a source read cannot confirm or rule out. **Needs a real device, not a resized desktop window.**

## LT-4 · The nested `Sheet` / `AmountPad` question

**Open since:** 6 August. B11 fixed `Sheet`'s focus handling at the cause and `ActionSheet` is built on `Sheet`, so the nested case *should* be covered — but the original finding was about the interaction, not only the focus, and B9's own checklist still requires this verified manually before B9 is called done. Two minutes: open a sheet that opens another sheet containing an `AmountPad`, enter an amount, close both.

## LT-5 · Opening balances (B12)

**Open since:** 8 August. **The draft path is safe and is most of the test.**

Enter a go-live date and entries across several kinds, **save as a draft, leave, come back**. F-0.2 calls a complete-in-one-sitting form "the highest-friction moment in the product," so resume is the load-bearing alternate, not a nicety. Check the re-hydrated entries show real party and vehicle **names**, not raw ids.

**Confirm and go live is one-way** — it writes a real dated batch. Do it only on a business you are willing to leave in that state, and verify afterwards that the figures appear as opening positions and **never as income** (W-56/INV-4). That last assertion is only fully checkable once B4 exists; until then, read the row back through the API.

## LT-6 · Driver money actions (B13)

**Open since:** 8 August. **These write real money rows, and they cannot be undone from the product** — void-and-replace exists for `expense` only (GAP-12), so a mistaken advance or deposit on QA stays there.

Pay a driver, record an advance, take a deposit — each from `DriverDetailScreen`'s "Driver money" action sheet, each on its own, since none requires the other two. Then check the two balances: **never netted** (W-2). The deposit must appear as **held, not owned**, and never as income in any month (INV-4).

The payment path is the one to watch: B13 generalised `recordPayment` to carry a direction, and `"paid"` settles `owed_by_us` only. Confirm a payment to a driver **never touches his arrears**, and that a retainer with nothing owed is held as credit rather than silently dropped.

## LT-7 · The day-card confirm loop (GAP-3)

**Open since 6 August — the oldest item here, and the one the fix is actually waiting on.**

GAP-3 was live data loss on F-4.2, "the flow the product is optimised around": `confirmDay` treated the cron's pre-inserted `open` placeholder as an already-confirmed row and discarded the user's tap, writing no obligation, no payment, no allocation. The fix is in, verified by an integration test that seeds the exact shape the cron leaves behind. **What has never happened is the real cron producing the real placeholder and a real tap confirming it.**

**This is a two-visit test, and that is why it has stalled.** `generate-day-cards` runs on `30 20 * * *` — 20:30 UTC, **02:00 Asia/Colombo the following day** — and generates placeholders 90 days out. Confirming a day *before* the cron has run exercises the create path, not the bug's path, so the wait is the test.

1. **Visit one:** start a daily lease on QA's bus through B10's flow (`/vehicles/$vehicleId/daily-lease/new`), effective from today or earlier, with a pattern that includes tomorrow.
2. **Wait for one cron run.**
3. **Visit two:** open Home. The day card must offer its three real buttons — **not** the label "Confirmed" with no buttons, which was the client half of the same bug.
4. Confirm it. Assert the row leaves `open`, and that an obligation, a payment and an allocation all exist — four writes, one transaction.
5. Confirm the same day again → an ordinary no-op, not an error.

## LT-8 · Close the month (B3)

**Run this last, on purpose.** The confirm says it plainly: *"This cannot be undone. The next month opens in the same action, and every later write lands there instead."* Closing QA's open period locks every write into it and moves everything after into a successor — which breaks LT-5's commit, LT-6's writes and LT-7's confirm if it runs before them.

Check that all five checklist counts render with real numbers, that **the close button stays enabled regardless of what they say** (U-7 — it warns and lists, it never blocks), that the confirm label states the consequence rather than the word "Confirm" (M-10), and that success names the newly opened successor period.

Then, as a `manager` rather than an owner: the close action must be **absent, not disabled** (M-22), both on `/more` and inside the screen — and the recent-payments rows must render as information without being tappable into a correction the Worker would only 403.

---

## What this file deliberately does not cover

- **The automated e2e suites** — `npm run test:e2e` (`e2e/smoke.spec.ts`, `e2e/sheet-a11y.spec.ts`) run locally and in CI against a built client and need no session. They are a gate, not a queue.
- **Production.** `fleetsettle.com` has never had a signup (checked 7 August: `business_member`, `app_user` and `business` all at zero rows). There is nothing to test there and no reason to write anything into it.
- **GAP-58, the 178-case test manifest** — `docs/testing/test-manifest.yaml` declares an acceptance spine mapping use cases to evidence, every case `not_started`, never run. Related, larger, and a different shape from this file: that is the systematic version of what this document does by hand for eight specific debts.
- **P14 messaging** — twelve Meta template approvals outstanding.

## When one of these finds something

The convention this repository runs on, unchanged: **validate it against source before scheduling it.** Every external review absorbed so far — `UI-UX-REVIEW.md`, both `MUST-FIX-FINDINGS.md` editions, `QA-BROWSER-TEST-FINDINGS-2026-08-08.md` — has had findings that did not hold up, and recording which ones and why is what stops the same argument happening twice. A confirmed finding becomes a row in [TRACKER.md](TRACKER.md) §4 with a gap id and a track; a rejected one becomes a paragraph in §6.
