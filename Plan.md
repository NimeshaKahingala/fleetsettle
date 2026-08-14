# Implementation plan — the remaining build, in two parallel tracks

**Not a specification, and not a record.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done and carries every open gap by id; this says what remains, in what order, and who can build it at the same time as whom. Where the three disagree: `docs/` first, then `TRACKER.md`, then this.

**Written 4 August 2026**, from `b2cf367` — backend complete through P13, frontend complete through Web-P8b. Validated route-def by route-def against `api/src/route-defs/` and screen by screen against `web/src/`.

**What changed from the previous edition.** It was a single serial queue of nine phases, each opening with its own backend increment and then building screens against it — so the frontend idled through every read increment and the backend idled through every screen. This splits the same work into **Track A (Worker + shared schemas)** and **Track B (React client)**, which is legal because of one rule the project already runs on, restated below. The old `Web-P8c…P12` numbering is retired; every item here carries a gap id from [TRACKER.md](TRACKER.md) §4 instead.


**Build log compacted 9 August 2026.** Sixteen dated entries covering 4–7 August became the summary below; the full prose is in git history, what each item *did* is in its own section further down this file, and what each item *taught* is in [TRACKER.md](TRACKER.md) §5.

**5 August** — CI's integration workflow configured (`e7efa71`) · A2/A3/B2/B3 validated against the code before building, three corrections (`2822193`) · **A2** (6 endpoints), **A3** (4), **A4** (2), **A5** (1) — Track A's read backlog finished, every handoff to Track B made · **B8** real Asgardeo auth, mis-sized here as "ten minutes of console work" when its entire client half was unbuilt and on the critical path · **B0** the `/more` hub · **A9a** migration `0008` · both environments deployed.
**6 August** — **GAP-3** fixed out of sequence, ahead of A6: `confirmDay` had been silently discarding real confirmations in production · **A6** the trip receivable · `UI-UX-REVIEW.md` validated into GAP-44…GAP-48 (**B9**) · **the first real browser round trip**, which found GAP-49, GAP-50 and GAP-51 — none of them reachable by any review method used until then.
**7 August** — the merge landed and a second live pass confirmed B10/B11 · **GAP-54** found by `grep`, GAP-51's exact shape · `MUST-FIX-FINDINGS.md` validated in both its editions, adding GAP-56…GAP-60, of which **GAP-56 was the one real money defect** (a back-dated cost billed to whoever holds the vehicle today) and shipped the same day as **A12**.

---

## The rule that makes two tracks legal

> **The schema is the synchronisation point, and the main lever for parallelism.** Once a resource's Zod schema lands in `packages/shared`, the two tracks separate: the Worker builds against a real Neon branch, the client against mocks derived from *the same schema object*. Hand-mirrored types drift silently and what drifts is a money field (IG §2). So the schema is always a phase's first task, never its last.
>
> — TRACKER.md §1, rule 2

**The contract between the tracks, stated once:**

1. **Track A lands the Zod schema first**, in `packages/shared/src/schemas/`, in its own commit, before the query or handler exists. That commit is the handoff.
2. **Track B imports that schema object and mocks against it.** Never a hand-written interface mirroring it. The one exception already in the tree is `MeResponse` in `FirstRunGate.tsx`, and it is documented as one.
3. **Neither track edits the other's files.** `packages/shared` is Track A's to write and Track B's to read. If Track B needs a schema change, it asks; it does not add a field.
4. **Money is `string` on the wire in every schema either track writes.** Non-negotiable, and the reason clause 2 exists at all.

**Where the tracks actually contend:** `packages/shared/src/schemas/` (A writes, B reads — serialise via clause 1) and `web/src/app/router.tsx` (B only, but every B item touches it — expect merge conflicts there and nowhere else).

---

## Nobody could use the product at all — 6 August 2026

**Kept as a one-paragraph scar, compacted 9 August.** Reported from the deployed app: *"when I log into the application I actually cannot do anything, I just see Review — Not built yet."* That was every user, not one misconfiguration: `createBusiness` hardcoded the creator to `role: "owner"`, UI §1.1 maps `owner` to the Review shell, Review was unbuilt, and no endpoint existed that could add a member or change a role. Months of built Operate screens were unreachable in production by anybody. Fixed by A0 (one word), then A11 (the invite/redeem endpoints), then B0b (the shells), then B4 (content inside them). **The lesson this repository keeps relearning:** the tracker recorded the Operate shell as "Complete" and it was — for a role no real user could hold. *Built* and *reachable* are different claims, and only one of them was ever tested. Full chain in git history.

---

## Start here

**Compacted 9 August 2026, and again 10 August 2026** — both times this section had accumulated a run of superseded "do this next" paragraphs, every one of them either completed or overtaken by the next. The current order is one line, and it lives in ["The order, end to end"](#the-order-end-to-end).

**Where the three roles actually stand:**

| Role | Today | Can anyone be this? |
|---|---|---|
| `owner_manager` / `manager` | **Complete and in use.** Home, vehicles, calendar, leases, trips, incidents, costs, quick-add, people, opening balances, close the month | **Yes** — the business creator (A0), and a second one can be invited (A11) |
| `owner` — reads the reports | **Real shell, real content since B4 Wave 1.** Four Review tabs and all six phase-1 reports render. **Wave 2 finishes two of them** (UC-75's account/advance breakdown, UC-76's reason/month grouping) | **Yes, since A11** |
| `driver` — the linked driver | **Real shell, still no content.** Lands at `/me` with no tab bar, correctly. `GET /api/driver-view` ready since P12 — **B5**, the largest thing still owed to a whole role | **Yes, since A11** |

**The two tracks are fully independent** — every Track A → Track B handoff has happened (A2 → B2, A3 → B3, A4 → B6, A5 → B5+), and every schema Track B needs is already in `packages/shared`.

**Three standing rules this queue keeps proving:**

1. **Live-and-silently-wrong outranks unbuilt.** GAP-3, GAP-56, GAP-75, GAP-90 and now GAP-103 each jumped the queue on it. A missing screen is visible; a wrong number is not — and GAP-103 is the starkest instance yet, since the screen actively confirms a number that then goes nowhere.
2. **When two owning documents disagree, the documents move first.** GAP-10, GAP-70/71 and GAP-88 are all this shape, and building any of them from the code alone would edit a specification by accident.
3. **Validate an external review before scheduling it.** Eleven passes so far (TRACKER §6), the eleventh a live browser session rather than a source read; every one has found claims that did not survive a check, including three re-raised after being declined once.

**How the order got here, compacted from eleven dated updates spanning 8–10 August.** The queue was re-sequenced twice on explicit instruction (finish B4 first, then B9/B15/B6) and re-ranked five more times as validation passes and one live QA session found things that outrank whatever they landed next to — every re-ranking followed the same rule: **live-and-silently-wrong jumps the queue; a documents-disagreement gets the documents fixed first; everything else validates before it schedules.** In order: the flow-inventory audit (GAP-61…69) shipped B12/B13/A14/A15 · F1 (GAP-84) and B4 both waves shipped, with two `doc-change`s (12a) between them · F2's server half (GAP-90) and A17 (GAP-92/93) jumped ahead of B9 as live defects · GAP-88 got its `doc-change` (D-9) before `startDailyLease` was touched, alongside four other standing decisions asked and answered the same day (GAP-10/A10b, GAP-87, GAP-60, GAP-1) · GAP-101 (the read-error contract) turned out to be B9's largest item and was pulled out and built on its own, closing F2's client half in the process · a live browser pass then found **GAP-103** (opening balances confirm and connect to nothing — the most severe gap this project has recorded) and **GAP-104** (a mobile `Sheet` history race that disables Quick Add on any real phone), filed as **F3**/**F4** ahead of everything, plus GAP-105/106 riding with B9 · B9's own two decision-gated rows, GAP-44 and GAP-89, were then asked and answered (TRACKER.md carries the reasoning) · and `feature/image-upload` (A7) turned out to be a complete seven-commit build rather than "not started," verified and fixed this session (its own section below has the account). **Full dated prose for all of this is in git history and in TRACKER.md §0/§6**, which is where "why" belongs; this file keeps "what's next."

**Superseded 12 August 2026 — this paragraph's own ordering rule no longer has a referent.** It read "GAP-44 → GAP-1 → A14 → A8 → A9b → [the 18 newly-promoted phase-1 rows, mostly unsized]" and was built on "live-and-silently-wrong outranks unbuilt," the rule that put GAP-3, GAP-56, GAP-75, GAP-90 and F3/F4/F5 ahead of their own queues in turn. **Checked directly against production 12 Aug 2026: every table on `main`'s Neon branch holds zero rows**, confirmed 7 Aug and unchanged five days later, and the owner set the premise that nothing goes live until every phase-1 gap is fixed and tested, with no near-term plan to onboard a real business. Nothing is live, so nothing can be silently wrong — the rule that decided every ordering choice in this file so far has no case left to decide. **["The ten-wave plan"](#the-ten-wave-plan--12-august-2026) below replaces this section's forward-looking content.** Everything below this point in "The order, end to end" and the Track A/B tables that follow it stays as the historical record of what shipped 5–11 Aug — none of it is rewritten, since it is still exactly what it says it is.

**Updated 10–11 August 2026 — A7 merged, `PENDING-REVIEW-ITEMS-2026-08-10.md` evaluated, and B9 shrank to a third of its own row.** A7/GAP-16 merged (PR #20, into `develop`, not yet `main`) — Track A's remaining queue is A8, A14, A9b. The seventeen accumulated review docs were consolidated and validated (TRACKER §6's twelfth pass); nine of B9's rows built the same sitting, and GAP-106 followed the next day: **GAP-45, GAP-46, GAP-55, GAP-89, GAP-91, GAP-96, GAP-97, GAP-99, GAP-106 all closed** (plus M-25, riding with GAP-97) — TRACKER §4's closed table has each. **What's left in B9 at that point: GAP-44, GAP-47, GAP-48, GAP-83, GAP-105** — none a same-pass extension of what just closed (GAP-44 needs the wire-schema change its own decision requires; GAP-47/48/83 each touch a shared primitive or need a new one). **F3 was untouched and still led** — this work built the smallest, least-ambiguous items ready regardless of sequence, not a re-ordering past GAP-103's own undecided fork.

**11 August 2026 — F4 closed, out of its own queue position, on the same reproduce-before-you-plan discipline this session applied throughout.** A review claimed GAP-104's fix was "designed, not built" and cited the exact source lines still showing the old behaviour — checked against source and confirmed accurate. Root-caused, planned (`EnterPlanMode`), then re-validated once more before writing code: `useMobileHistoryDismiss` rebuilt as a single stack manager in place of independent per-`Sheet` history push/pop (full mechanism in TRACKER.md's closed row). Verification did not stop at "the new tests pass" — the old implementation was reinstated and driven through real Chromium touch emulation with logging, which found the actual bug (a ~150–300ms non-deterministic delay before the target sheet closes itself) and, in the process, caught that the first e2e attempt at a regression spec passed against the *broken* code by accident (its wait was shorter than the observed delay). Every new test was confirmed to fail against the pre-fix code and pass against the fix, not just written and trusted; one jsdom-level assertion that could not be made to fail against the old code either way is labelled as a sanity check rather than left implying coverage it doesn't have.

**11 August 2026 — F3 closed, the last item ahead of B9.** GAP-103's own fork was put to the user and came back **materialise**: each opening-balance entry becomes a real row, on first commit, in the exact table its own report already reads — `obligation` for the three balance kinds (`customer_due`/`driver_arrears`/`owed_to_driver`, a new `kind: 'opening_balance'`, migration `0014`), `deposit`+`deposit_movement` for `deposit_held`, `advance` for `advance_outstanding`, and — the one kind with no table of its own, `listPartnerCashPositions`'s `heldMinor` being pure derived arithmetic — an unallocated `payment` for `cash_held`. F-0.2's own "editable until the first period closes" clause meant a correction after commit had to reverse the prior generation before reposting, not leave it standing beside the new one: a new non-money tracking table, `opening_balance_posting`, links each entry to what it produced, so `obligation`/`advance` void by id, `payment` flips to `reversed`, and `deposit_movement` — the one table whose own sum turned out to never consult `voided_at` at all, confirmed by reading it rather than assumed — gets a real offsetting entry instead of a flag. Two new integration tests prove it against the actual reports GAP-103 named, not just against the rows: all six kinds materialise and are readable by `GET /api/reports/receivables`, `GET /api/driver/{id}/balances` and `GET /api/reports/cash-position`, and a post-commit correction leaves exactly the corrected figure behind. Full API suite 490/490 across 33 files, golden fixtures unmoved (134,000/15,000/7,500), DM §13's drift assertion clean. **B9 is now the head of the queue.**

**11 August 2026 — started on B9, closed its first item: GAP-83 and GAP-105, `DateField`'s own rebuild.** Both were the same component's two defects, fixed by the same change: the native `<input type="date">` is now the real click/tap/Tab target — absolutely positioned, full-size, `opacity-0`, directly over a decorative weekday display — rather than a visible decoy button with a separately-focusable `sr-only` input behind it. That single change closes GAP-83 (only one focusable element now exists, confirmed by a real Chromium tab-order trace and screenshot) and GAP-105 (a direct click on a real date input opens the browser's own native picker with no dependency on `showPicker()`, which is now only a same-tap enhancement). A temporary `showShortcuts` prop made Today/Yesterday opt-out at first, then GAP-108 removed the chips everywhere. Verified against a pre-existing, unrelated e2e flake (`smoke.spec.ts`'s daily-lease test) by reverting `DateField.tsx` to `HEAD` and confirming the same failure, ruling this change out as the cause before moving on. **Not done**: MP-06's real-Safari confirmation, same limitation as GAP-104's own real-device gap. **What's left in B9: GAP-44** — it needs the wire-schema change its own decision requires.

**11 August 2026 — GAP-108 followed immediately as a product/design correction to that same component.** The first DateField rebuild still kept Today/Yesterday shortcut chips on ordinary single-date fields and only suppressed them on report ranges. A follow-up design decision removes the chips everywhere: M-17 now says one native date picker with weekday display, not three adjacent date-setting controls. The code deletes `showShortcuts`, the report-screen opt-outs disappear, and the focused tests now assert no Today/Yesterday buttons render and a From/To pair is two date inputs, not six controls.

**11 August 2026 — GAP-47 closed next, in the shared chrome rather than per screen.** `AppShell` now gives the tab bar M-26's 44px below-`md` landscape height and hides tab labels visually while preserving accessible names; `Screen` now gives the app bar the matching 44px landscape height, tighter padding, smaller title text and adjusted scroll padding. Root cause matched the filed row exactly: hardcoded portrait `h-14` in both primitives made every screen inherit the 640×360 squeeze. Focused primitive run passed, although Vitest's filename filters matched a broader 28-file/215-test slice. **What's left in B9: GAP-44 and GAP-48.**

**11 August 2026 — GAP-48 closed as a primitive and host, with undo call sites deliberately left to their own domain checks.** `ToastProvider`, `useToast` and `ToastViewport` now exist, `App` wraps the router in the provider, `renderWithProviders` matches it, and `AppShell` renders the live host above the tab bar instead of the old inert `<div id="toast-root" />`. The primitive defaults to M-11's 5 seconds, is dismissible, uses a polite live region, and supports an optional action. No screen was wired to pretend it has undo: M-11 still allows only writes that sent no message and settled no obligation, so each call site must opt in deliberately. **What's left in B9: GAP-44.**

**11 August 2026 — B15 closed.** Quick Add now matches M-4's fixed five-action set: Fuel, Expense, Payment received, Payment made, New trip. The two payment actions add the missing party pickers in front of the already-built `/api/payment` contract: received payments choose a customer or driver; made payments choose a driver. Partner payouts stay in B2/F-7.2, because the product treats those as partner settlement rather than a generic payment. Focused `QuickAddSheet` tests cover the order, both directions and picker-read failures. **B6 is now the frontend head of the low-API queue.**

**11 August 2026 — the low-API UI branch closed B6, B5's core, GAP-100, and the B2 UI callers.** B6 replaced `/people/customers/:id` with a real customer detail over A4's reads and added the small vehicle-paperwork renewal sheet that closes GAP-102. B5 now has the driver's own `/me` screen over `GET /api/driver-view`, a shared read-only driver activity section, and the staff-side `DriverDetailScreen` history read over `GET /api/driver/{id}/view`; A14's signed printed-slip link is still separate backend work, so the statement-link line remains there. B2 now has `/cash`, `/partners/:userId`, partner capital contribution, partner payout/settlement, banking events, the owner-facing Members screen, the driver access sheet on driver detail, GAP-67's mileage-package create/archive screen, GAP-31's paid-by picker in `RecordExpenseSheet`, and `/vehicle-sharing` for initial ownership-share setup plus management-agreement create/revoke. GAP-100 now has both client halves: trip-scoped advance issue from Trip detail and advance settlement from staff Driver detail. **Not closed by this branch:** GAP-1's per-vehicle access scoping, ownership-share replacement after an existing current split, richer settlement context until driver-view advances expose `settledMinor`/`tripId`, and the management-agreement API's role hardening.

**11 August 2026, later — an independent validation of that same branch, and a phase-model decision that resizes this whole file.** Four parallel reviewers plus one adversarial spot-check covered the low-API branch (money/tenancy rules first); the branch itself came back clean — 113 files / 564 web tests, 0 lint errors, no money/tenancy/W-49 violation anywhere. Every claim was independently re-checked against source before being trusted (TRACKER.md §6's own standing rule), and all of it held. The one finding that changes the queue: **GAP-109/F5** — `commitOpeningBalance`'s materialisation (F3, closed the same day) only fires on a `draft → committed` transition, so an opening balance confirmed *before* F3 shipped is stranded, live-confirmed on QA and against source (full account: TRACKER.md's F5 rows and its 11 Aug build-log entry). Filed with **GAP-110** (its own remedy, a re-save, is blocked by a confirm sheet unusable at 360×640) as **F5**, now the head of the queue — the same "live-and-silently-wrong outranks unbuilt" rule that put F3/F4 there before it. Five smaller findings (GAP-111–116: a report empty-state gap, a colour-alone M-15 violation, an unverified receipt-thumbnail claim, a schema-change with no test, six under-tested screens, and a stale doc version table) are recorded in TRACKER.md but don't reorder anything — none is money- or tenancy-shaped.

**The same sitting, the owner set a phase model that resizes everything below.** Full text in TRACKER.md ("The phase model — set 11 August 2026"). **Phase 1 now covers every open gap TRACKER.md §4 carries** — including the eighteen rows this file's own queue never scheduled because TRACKER had them parked as "correct to leave." Two changes fall out of it directly: **P14 (WhatsApp messaging) moves to phase 2**, and **B7 (offline/PWA) moves to phase 3** — both drop out of this file's phase-1 queue below, not because either shrank, but because the owner re-scoped what phase 1 means. **Five of the eighteen newly-promoted rows (GAP-6/15 paired, GAP-18, GAP-19, GAP-73/98 paired) conflicted with `use-cases.md`'s own phase table — resolved the same day.** `use-cases.md` → v1.2.5 and `user-flows.md` → v1.1.6 landed 11 Aug 2026, one edit covering all five, before any of them were treated as buildable. All five are startable now; none is sized into a queue slot yet. **GAP-68 looked like a sixth and isn't** — checked 11 Aug and found `F-3.5`/`UC-13` already phase 1 in both `use-cases.md` and `user-flows.md`, corrected before it could sit wrong in this file too.

---

## The ten-wave plan — 12 August 2026

**Replaces this file's forward-looking queue.** Everything from here to ["The order, end to end"](#the-order-end-to-end) is the current plan; that section and everything after it is the historical record of what shipped 5–11 Aug and stays unedited. Full reasoning for every decision below is in TRACKER.md's 12 Aug build-log entry; this section carries "what's next," the same division of labour this file has always kept with TRACKER.md.

### Why the order changed

Plan.md has run on one rule since GAP-3: **live-and-silently-wrong outranks unbuilt.** It has no referent now. **Checked directly against production, 12 Aug 2026: every table on `main`'s Neon branch holds zero rows** — no business, no user, no money record, confirmed 7 Aug and unchanged five days later. The owner set the premise the same day: **nothing goes live until every phase-1 gap is fixed and tested, and there is no near-term plan to onboard a real business.** Nothing is live, so nothing can be silently wrong.

Three rules replace it, in order of leverage:

1. **Decisions before code.** Twenty-one open questions across the phase-1 queue were put to the owner in one sitting and all twenty-one are now answered — nothing below is blocked on a fork.
2. **Schema while the database is empty.** Migrations here are forward-only, and every one carrying a backfill question — `adjustment.occurred_on`, `replaces_id` on twelve tables, soft-delete columns everywhere — is free against zero rows and gains an argument the moment a business signs up. This saving expires exactly once.
3. **What makes later work bigger if deferred.** GAP-60 before A9b, or fifteen void endpoints get built without linkage and revisited later. GAP-59 before A8, or A8 ships the cost-misattribution path GAP-59 describes.

### Two live defects, found validating the decisions against source

Neither was in either tracker before this sitting. **Both confirmed by reproduction against real endpoints, Wave 0, 12 Aug 2026** — see that wave's own note below for the transcript.

- **GAP-119** — a charter cannot be booked on a vehicle already on daily lease, the mixed-use case this product opens with. `startDailyLease`'s own rolling horizon (D-9) materialises `vehicle_day_allocation` rows synchronously; `bookTrip` inserts its own with no release first, and the unique index refuses it as `VEHICLE_DOUBLE_BOOKED`. **`data-model.md` §4.1 already specified the correct behaviour** — this is an implementation gap against a correct spec, not a design question, and the fix is now written into `data-model.md` v1.1.6 (§4.1, D-12) and `user-flows.md` v1.1.8 (F-5.1, F-5.5).
- **GAP-118** — the mirror case: closing a daily-lease assignment (a driver change, F-4.7, or an arrangement change off B, F-1.2) never frees its own future occupancy, because arrangements A and C both have the cleanup primitive and B never got one. A driver change inside the horizon leaves tomorrow's card carrying yesterday's driver.

### The twenty-one decisions

Full reasoning in TRACKER.md's 12 Aug entry; the shape each landed on:

| Gap | Landed on |
|---|---|
| GAP-73 | `adjustment.occurred_on date`, driving `belongs_to_period_id` |
| GAP-59 | Composite FK `expense → (trip.id, vehicle_id)` / `(incident.id, vehicle_id)`, `MATCH SIMPLE`, backstopped by two `CHECK`s |
| GAP-20 | `lease_day_exception` — an excepted date never becomes a `day_record`, so it can't reach the lost-day denominator |
| GAP-26 | `vehicle_unavailability` — reason-mapped, so a breakdown still reaches the denominator and a routine outage doesn't; does not duplicate `incident.off_road_from/to` |
| GAP-7 | `trip.hold_expires_on`, 7-day business default, released synchronously by the next booking attempt, never only by cron; `in_progress` derived from the business date, never written |
| GAP-60 | `replaces_id uuid` on the twelve money tables (shape reconfirmed; now actually recorded in `data-model.md` §17 D-16) |
| GAP-36 | Soft-delete columns on `driver` and `customer` |
| GAP-5 | Forward allocation as a fresh `payment_allocation` — **found already fully specified**; only `SELECT … FOR UPDATE` was missing |
| GAP-2 | Rate change closes and reopens the `daily_lease` row, reusing `changeDailyLeaseDriver`'s own mechanism — roughly halves the item |
| GAP-8 | Postgres advisory lock on the period id, matching the migration runner's own mechanism |
| GAP-14 | Stacked partial corrections stay allowed, and get tested |
| GAP-65 | 30-day signed link |
| — | `post_closure_charge` gets a handler-level cross-check — it writes an `obligation`, not a table, so it can't take a composite FK |
| **Soft-delete policy** | **No hard deletes anywhere in `api/src`**, wider than W-50's money-tables-only scope — `use-cases.md` **W-58**. Full trio on every table, not a timestamp only. `day_record` joins them; stale cards are voided, never mutated in place. A soft-deleted parent keeps all its history rendering exactly as before. GAP-28 (error monitoring) reclassified to capture-and-query, no paging — the same forensic motivation, satisfiable on Workers Logs alone |

### ~~Wave 0 · Prove the two live defects~~ (S) — ✅ done, 12 Aug 2026

No fixes in this wave — reproduction only, against a dedicated Neon test branch (`test`, brought current to migration `0014`), never `qa` or `main`. Both confirmed exactly as filed: `GAP-119` — booking a trip inside a daily lease's own materialised horizon returns `409 VEHICLE_DOUBLE_BOOKED`. `GAP-118` — after `POST /api/daily-lease/{id}/change-driver` returns `201` and opens a genuine new `daily_lease` row, the future date's `day_record` is unchanged: still the old driver, still the closed `dailyLeaseId`, still `open`; no row for the new driver exists at all. Both reproductions were throwaway integration tests, run once and deleted rather than committed red — TRACKER.md's 12 Aug addendum carries the full transcript.

### ~~Wave 1 · The schema series, while it's free~~ (L) — ✅ done, 13 Aug 2026

Nine migrations, `0015`–`0023`, against the doc-change (`use-cases.md` v1.2.7, `user-flows.md` v1.1.8, `data-model.md` v1.1.6): plain FK `expense.incident_id → incident(id)` (`0015`) · `UNIQUE (id, vehicle_id)` on `trip` and `incident`, composite FKs from `expense` (`0016`, GAP-59) · `adjustment.occurred_on` (`0017`, GAP-73), backfilled from `created_at::date` · `lease_day_exception` (`0018`, GAP-20) and `vehicle_unavailability` (`0019`, GAP-26), both soft-deletable · `trip.hold_expires_on` + a `business_settings.hold_expiry_days` default of 7 (`0020`, GAP-7) · `replaces_id` on the money tables carrying the W-50 trio (`0021`, GAP-60) — **thirteen, not twelve**: the doc's own count was one short (`payment` correctly excluded, it already has `payment_correction`) · the void trio on `vehicle_day_allocation`, `payment_allocation`, `day_record`, `opening_balance_entry`, both live partial-unique indexes moved to `voided_at IS NULL` (`0022`) · soft-delete columns on `driver`/`customer`, plus the schema's last two `ON DELETE CASCADE` hard-delete vectors closed to plain FKs (`0023`, GAP-36). The four hard-delete ESLint exemptions are gone because the call sites no longer call `.delete(...)` at all, not because the rule was relaxed. **GAP-28 stays out of this wave** — flagged, not tracked, per TRACKER.md's own phase-model note: it needs an on-call person before it needs code.

**The two checks this wave named ran clean:** DM §13's drift assertion confirms neither new table joined `assert_period_open()`'s array; `listAllocatedDatesForVehicle` and `findVehicleCalendar` both got the `voided_at IS NULL` filter that stops GAP-118 reproducing in a new form. Full account, including the two real test regressions this wave's own constraints surfaced and fixed, is in TRACKER.md's 13 Aug entry.

### ~~Wave 2 · The two live defects~~ (M) — ✅ done, 13 Aug 2026

Two release primitives, not one shared signature — `releaseDailyLeaseAllocationsAfter` (queries/dailyLease.ts, mirrors `deleteLeaseAllocationAfter`/`deleteAllocationDaysForTrip`'s own shape, scoped by a specific `dailyLeaseId` with an open-ended `afterDate`) and `releaseDailyLeaseAllocationsForRange` (queries/trip.ts, scoped by `vehicleId` + a bounded range, since `bookTrip` has no lease id to key off). A vehicle-day's live uniqueness means the two never need reconciling against each other. `voidFutureOpenDayRecordsForLease` (queries/day-record.ts) is the `day_record` half of `GAP-118`'s own fix — deliberately `state = 'open'` only, leaving a card genuinely `paused_for_trip` untouched as a separate, unaddressed question rather than guessing at it.

**A prerequisite this wave's own migration created and Wave 1 didn't close**: `day_record` gained the void trio in `0022` "ahead of Wave 2, which is what actually needs it" — but nothing filtered `voided_at` on eight read/write sites (`confirmOpenDayRecord`'s idempotency guard, the close checklist, all three lost-day reports, the driver/unconfirmed views). Closed first, with a new `check-forbidden.mjs` rule (`money/void-table-unfiltered`) scoped to the four tables this wave actually put a live void behind — not all twenty-two W-58 tables, most of which have no void endpoint yet (Wave 5's own job) and would have failed the gate on pre-existing reads this wave never touched. One sharper case than a missing filter: `confirmOpenDayRecord`'s own `WHERE state = 'open'` could still confirm a voided card and post real money against it — closed with a new domain-level check (`DayRecordVoidedError`, 409) rather than filtering that specific query, since filtering it would have broken `confirmDay.ts`'s own unique-violation-as-race-recovery path.

**GAP-118**: `changeDailyLeaseDriver` and `changeVehicleArrangement` (moving off B) both release the closed lease's future allocations and void its future `open` cards before the replacement lease (if any) materialises — reproduced end to end against the real endpoints (not just the read-side prerequisite): a future date inside the old lease's own horizon is voided under the old driver, then refilled under the new one. **GAP-119**: `bookTrip` releases the vehicle's daily-lease occupancy for the trip's own range before `insertAllocationDays`, so D-12's "REPLACED, not refused" now holds — booking a charter over an active daily lease returns `201`, not `409 VEHICLE_DOUBLE_BOOKED`; `cancelTrip` re-materialises whatever the vehicle's *current* daily lease would occupy (not necessarily the one active at booking time, if GAP-118 superseded it in between).

Both fixes proven against the real Neon `test` branch, not just unit-level: the exact Wave 0 reproductions, now passing. Full API suite green (497 tests across 33 files, one pre-existing file's own unscoped-cron tests slow on this heavily-accumulated shared branch — confirmed a timeout/scale artefact, not a regression, by re-running with a longer ceiling and watching every assertion pass). Golden fixtures unmoved (134,000/15,000/7,500). Full account in TRACKER.md's 13 Aug entry.

**GAP-44 sequences after this wave** — until it lands, that Dialog would be explaining a conflict that should never have occurred.

### ~~Wave 3 · Tenancy~~ (M–L) — ✅ done, 13 Aug 2026

The only open item that is a security requirement rather than a feature. **Resequenced 13 Aug 2026** after auditing GAP-1 before building it found two prerequisite gaps and the mechanism decision needed its own doc-change first — `use-cases.md` v1.2.8 (**W-59**), `user-flows.md` v1.1.9 (**INV-34**), `data-model.md` v1.1.7 (**D-17**), landed before any of the six steps below. Four decisions taken the same pass: the manager-invite refusal (step 1) is a stopgap, lifted in step 6, not permanent; UC-70's "shared vehicles" binds to whether `management_fee_agreement` **overlapped the reported period**, never the agreement's status today or at period end; an explicit `?vehicleId=` request for a vehicle outside a manager's scope returns **403**, not 404, since `manageEntities` already lets him list it; UC-71/72/74/76/78 stay whole-business for a manager **by decision**, pinned with tests, not left unscoped by oversight.

**Step 0 · The role-check cluster (S), GAP-121/GAP-122 — a prerequisite, not a follow-up.** `setOwnershipSharesHandler`, `recordCapitalContributionHandler`, `recordPartnerPayoutHandler` (`partner.ts`) each resolve a user id via `findBusinessMemberUserId` — membership, never role — and let an owner name a `manager` as a partner today; `grantManagementHandler` is the mirror, letting an owner be granted a management agreement. All four contradict UC-03's matrix and are latent only because `MembersScreen` has never offered `manager` in the picker — step 1 removes that cover. Same shape as GAP-120 ahead of Wave 2: fix before the capability that makes it reachable lands. GAP-122 (a manager reading capital tables via `getAuditLogHandler`'s arbitrary `tableName`) rides along, lower priority — defence-in-depth, not a live leak.

**Step 1 · The guards (S).** Reject `manager` server-side at the invite endpoint (stopgap, see above) · the `MembersScreen` assertion GAP-115 found missing, making the "do not invite a manager" guard real rather than an honour system.

**Step 2 · The scoping primitive (M).** A DB-backed resolver returning the vehicle ids a user may reach — `ownership_share` for owner/owner-manager (as of the write), `management_fee_agreement` for manager (as of period overlap, D-17). **Kept out of `auth/policy.ts`** — that file is a pure synchronous matrix mirrored client-side by `capabilities.ts`; making it async/DB-backed breaks the mirror. A new sibling module; `can()`/`requireCapability` unchanged.

**Step 3 · UC-70 (M).** Thread the vehicle-id restriction through `getVehicleMonthReport`, resolved at the handler — **never inside the domain function itself**, which `sumAllTimeEarnedForUser` (partner.ts) also calls for the unrelated partner-summary figure; scoping inside it would silently change that money. 403 on an explicit out-of-scope `?vehicleId=`.

**Step 4 · Owner-manager capital scoping (M–L).** ~12 handlers in `partner.ts` gated `managePartnerCapital`. **As built, narrower than planned on two counts, both checked against UC-03's matrix text rather than assumed**: the `(own vehicles)` qualifier reads *reads only* — scoping a *write* (`setOwnershipShares`, `recordCapitalContribution`) would leave a solo owner-manager business unable to ever set up its first vehicle's split, since nobody owns anything yet to be in scope; put to the user, decided reads-only. And management agreements turned out not to be covered by the qualifier at all — UC-03's own row names only "ownership shares, capital, payouts" (UC-02, UC-67), so `listManagementFeeAgreementsHandler`/`grantManagementHandler` stay flat. `listOwnershipSharesHandler` and `listCapitalContributionsHandler` are the two handlers actually scoped; `listPartnerPayoutsHandler` (no vehicle dimension at all) and `getPartnerSummaryHandler` (per-subject, not per-viewer, per UC-67's own "reachable by any owner") stay flat too.

**Step 5 · Tests (M).** **As built: no new test file.** W-49's isolation class in `payment.test.ts`/`write-off.test.ts` is the *linked-driver* boundary, a different concern with no vehicle-ownership dimension — GAP-1's actual surface is exactly UC-70 (Step 3's own tests, `reports.test.ts`) and the two capital reads (Step 4's own tests, `partner.test.ts`), so pinning landed there instead.

**Step 6 · Lift the stopgap.** `INVITABLE_BUSINESS_MEMBER_ROLES` regains `manager`; the three tests adapted for the stopgap reverted to their permanent shape. **As built: no client mirror code was needed** — checked, not assumed: `ReviewVehiclesScreen` and `VehicleMonthReportScreen` both already source their vehicle list from the same `vehicle-month` endpoint Step 3 scopes, so a manager's own navigation can never reach an out-of-scope vehicle; the direct-URL case is already caught by GAP-101's generic 403 handling.

**Verification, full account in TRACKER.md's 13 Aug entry:** every touched file green in isolation, each new assertion confirmed red against the pre-fix code first, golden fixture reproduced exactly at 134,000, full gate clean. The one full-suite run hit this branch's own documented Neon-contention flake (108 failures, all `Connection terminated` on a basic insert, after 81 minutes of sustained load) — confirmed environmental by re-running an affected, untouched file alone, clean.

### ~~Wave 4 · Money correctness~~ (M–L) — ✅ done, 14 August 2026

GAP-94 · GAP-73 · GAP-5 · GAP-8 · GAP-14 · GAP-59. **Sized against source rather than off its own row**, and three things moved before any code was written.

**GAP-59 is two defects in the same three lines, and the second was never filed.** [handlers/post-closure-charge.ts:44](api/src/handlers/post-closure-charge.ts#L44) passes `body.vehicleId` into the obligation with **no business check at all** — not merely no cross-check against the named lease or trip. Every sibling id on that handler (`sourceId`, `partyCustomerId`, `partyDriverId`) is proven against the business first; this one is not, and `obligation.vehicle_id` is a plain `REFERENCES vehicle(id)` ([0001:500](api/migrations/0001_initial_schema.sql#L500)), so another business's vehicle id satisfies the FK and lands in this business's money row. Filed as **GAP-123**. Not a leak — the handler never branches on the lookup, so there is no existence oracle — but an unvalidated foreign key written into a money table, and the fix is one call beside the four already there.

**GAP-8's premise has not been reproduced and may not survive one.** Its row says "status-based idempotency only." [`closePeriodRow`](api/src/queries/accounting-period.ts#L118-L122) is `UPDATE … WHERE id = ? AND status = 'open' RETURNING`: under READ COMMITTED a second concurrent close blocks on that row lock, re-evaluates against the committed version, matches nothing, and raises `NotFoundError`. That is a real guard. The advisory lock may be solving a race the conditional update already closes — **Step 0 decides, not a source reading**, the same discipline Wave 0 applied to GAP-118/119.

**GAP-5 is two items and only one is a defect.** [domain/payment.ts:113](api/src/domain/payment.ts#L113) reads outstanding obligations with no row lock, then loops allocating, so two concurrent payments to one party can both settle the same obligation past its own `amount_minor`. That is live money, and small. Applying surplus *forward* is a feature, and larger. Split into **GAP-5a** (the lock) and **GAP-5b** (forward allocation); 5a sequences ahead of items sized smaller than it, on the one rule that outranks size.

**The wave needs no migration, checked rather than assumed.** `payment_allocation` has no `posted_period_id`, is deliberately absent from `assert_period_open()`'s array, carries `UNIQUE (payment_id, obligation_id)`, and its own DDL comment says `allocated_on` "may be later than payment.occurred_on" ([0001:549-556](api/migrations/0001_initial_schema.sql#L549-L556)) — GAP-5b is what that table was shaped for. `adjustment.occurred_on` landed in Wave 1 (`0017`) and is populated on all three write paths (`applyAdjustmentTx`, `mileage.ts`, and `lease-closure.ts` through the former), so GAP-73 is a query rewrite over a column already correct.

**Step 0 · Reproduce the two premises (S).** Throwaway integration tests against the `test` Neon branch, run once and deleted, never committed red — Wave 0's own shape. **GAP-8**: two concurrent `POST /api/accounting-period/close`. **GAP-5a**: two concurrent `POST /api/payment` for one party against one outstanding obligation; confirm `settled_minor` exceeds `amount_minor`. Only what survives gets built.

**Step 1 · Two decisions (S).** *GAP-94 — what shape is the warning?* The checklist's own docstring ([accounting-period.ts:163-166](api/src/queries/accounting-period.ts#L163-L166)) already argues it "under-reports honestly, which is exactly what U-7 permits"; GAP-94 disputes that at the irreversible step. **(a)** a coverage warning — "day cards generated through *date*; this period ends *date*" — cheap, exact, W-56's own idiom, no pattern replay; or **(b)** replay each active lease's pattern and count the days that should exist, which is complete and is a second implementation of `generate-day-cards`' own logic, the trap CLAUDE.md names directly. **(a) is the recommendation.** *GAP-5b — when does a surplus apply forward?* On-write (an obligation's create path checks for party credit) or on-read (a sweep over unallocated payments). This decides which files the item touches at all.

**Step 2 · GAP-59 + GAP-123 (S).** One handler, no schema. `findVehicleForBusiness` on `body.vehicleId` → 404, matching its four siblings; then `vehicleId` cross-checked against the resolved `lease.vehicleId`/`trip.vehicleId` → 400. **Handler-level by the 12 Aug decision** — this writes an `obligation`, not a table that can take migration `0016`'s composite-FK treatment.

**Step 3 · GAP-73 (S–M).** **Schema commit first and alone**, per this file's clause 1 — `goodwillResponseSchema` is `{ totalMinor }` today ([schemas/reports.ts:187](packages/shared/src/schemas/reports.ts#L187)) and gains the by-type breakdown UI §11.1 asks for; Wave 6's GAP-98 is what consumes it. Then [`sumGoodwillGiven`](api/src/queries/reports.ts#L689-L706) windows on `occurred_on`, groups by `adjustment_type`, and honours `sign`. **The `::timestamp AT TIME ZONE` reasoning in that docstring gets deleted, not kept** — it exists only because the column was a `timestamptz`; against a plain `date` it is dead reasoning that would mislead the next reader. Golden fixtures are the gate here, not the suite.

**Step 4 · GAP-94 (S, once decided).** Whatever Step 1 lands on. Under (a): one query for the furthest generated `business_date` in the period, one checklist field, one response-schema change.

**Step 5 · GAP-5a — the row lock (S).** `findOutstandingObligationsForParty` gains `SELECT … FOR UPDATE`. **It has two callers** — [payment.ts:113](api/src/domain/payment.ts#L113) and [offset.ts:90](api/src/domain/offset.ts#L90) — so confirm both are inside a transaction before locking in the shared query rather than adding a locking variant. Step 0's reproduction becomes the committed regression test.

**Step 6 · GAP-5b — forward allocation (M).** The largest item here. One design constraint worth stating before it is built: **the surplus payment may sit in a closed period and that is fine** — nothing touches the payment row; `assert_period_open()` guards `obligation`, and an obligation being settled forward is in the open period by definition. `UNIQUE (payment_id, obligation_id)` is the idempotency, in the constraint rather than in code.

**Step 7 · GAP-8 (S, or nothing).** Contingent on Step 0. If the race reproduces: `pg_advisory_xact_lock` on the period id inside `closeAccountingPeriod`'s transaction, matching the migration runner's own mechanism. If it does not: a regression test pinning the conditional UPDATE's guarantee, and GAP-8 closes in TRACKER.md as *not the gap it was filed as* — recorded, never silently dropped.

**Step 8 · GAP-14 — coverage only (S).** No code change. `payment-correction.test.ts` has nine cases and none stacks. The one that matters: two sequential `back_to_arrears` corrections against one payment, the second unwinding allocations the first already reduced — assert the obligation's `settled_minor` and the party's arrears after each, and that the `payment_correction` rows sum to the total corrected.

**Order:** `0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`. Reproductions and decisions first because two items change size on their outcome; then ascending by size, with **GAP-5a jumped ahead of items smaller than it** because a live over-settlement outranks a feature. **Risks:** GAP-5b is the one item that can overrun the wave if Step 1 chooses the on-read sweep, which brings its own retry-safety surface; and Step 3 moves a report query, so 134,000 / 15,000 / 7,500 is the check that matters, not a green suite.

**Both premises settled by Step 0, exactly as written above: GAP-8 did not reproduce (closed as a regression test, not a lock), GAP-5a did.** GAP-5b landed on-write, the lower-risk of the two options this section named — one shared helper (`domain/credit-forward.ts`), seven call sites. **The wiring itself surfaced two bugs neither this plan nor GAP-5b's own row anticipated**: `bookTrip` and `recordPostClosureCharge` both hardcoded their HTTP response's `status`/`settledMinor` fields, true before credit-forward existed and false after — both domains now return the real post-credit state, both handlers report it, and two end-to-end tests pin it. Golden fixtures unmoved; full account in TRACKER.md's 14 Aug entry.

### Wave 5 · Finish the half-built flows (XL) — planned 14 August 2026, **split into two tracks**

The largest wave, and the first one this project has deliberately sized for **two people working at once**. Planned in its own sitting before any code moved, sourced against the tree rather than off the gap rows — **five of the eleven rows turned out to be stale in the same direction**, because Wave 1 built the schema they each say is missing and nobody went back to correct the text.

Base branch: `wave5/plan-2026-08-14`, cut from Wave 4's head so it carries Waves 1–4 in full. **Wave 5 merges after Wave 4** (PRs #39/#40) — 5B touches `domain/payment.ts` and `domain/offset.ts`, both of which Wave 4 moved.

#### What the source check corrected

Every one of these was found by grepping `api/src` for the thing the row says does not exist, not by re-reading the row:

| Row says | Actually |
|---|---|
| **GAP-7** "needs a `doc-change` (hold-expiry mechanism) before it can size" | **The `doc-change` landed 12 Aug** — `user-flows.md` v1.1.8 (ST-5, INV-32/33) — and migration `0020` shipped `trip.hold_expires_on` plus `business_settings.hold_expiry_days DEFAULT 7`. **GAP-7 is startable and has been since Wave 1.** `trip.status` has defaulted to `'hold'` in the CHECK since `0001` ([:361](api/migrations/0001_initial_schema.sql#L361)); `bookTrip` writes `'booked'` outright and no code in `api/src/domain` mentions `hold` at all |
| **GAP-20** "has no column to hold an exception" | `lease_day_exception` exists (`0018`). **Referenced by nothing but [db/schema.ts:390](api/src/db/schema.ts#L390)** |
| **GAP-26** "no write path marks a vehicle-day unavailable" | Half true — `vehicle_unavailability` exists (`0019`), same state: declared at [db/schema.ts:312](api/src/db/schema.ts#L312), read and written nowhere |
| **GAP-36** "`driver` and `customer` have no soft-delete column at all" | `0023` added the full void trio to both. **No endpoint sets them** |
| **GAP-60** "there is no `replaces_id` column anywhere in the schema" | `0021` put it on **thirteen** tables. Nine `replacesId` declarations in `db/schema.ts`, **zero writes** |

**One migration comment is wrong and should be corrected by whoever takes 5A-1.** `0020`'s own header says release-on-conflict lands in "Wave 2". Wave 2 was GAP-118/119/120 and built no hold code; that work is this wave's 5A-1.

**Wave 5 needs no migration, checked rather than assumed.** Every column the eleven items write landed in Wave 1 — including the two nobody expected: `deposit_movement` has carried `movement_type = 'applied'` and `obligation_id uuid REFERENCES obligation(id)` since `0001` ([:670-675](api/migrations/0001_initial_schema.sql#L670-L675)), so **GAP-6 is a domain gap over a schema that already anticipated it**, not a schema change. The single exception is A14's share link, which is 5B's one open decision (below).

#### The split, and why it falls here

Not by size and not by track letter — **by the fact each cluster reasons about**. Split any other way and two people independently re-derive the same denominator or the same void convention, which is the divergence trap CLAUDE.md names.

---

### Track 5A · Occupancy and lease lifecycle — *"when is a vehicle earning, and when is it not"*

**GAP-7 · GAP-25 · GAP-20 · GAP-26 · GAP-2.** One track because all five move the **lost-day denominator (`ran + lost`)** and the day-card horizon. Branch: `wave5a/occupancy-2026-08-14`.

**5A-1 · GAP-7 — trip `hold` and `in_progress`, end to end (M).** Goes first: it is the only item here whose absence makes a *specified* UI unreachable — `VehicleCalendarScreen`'s hold-outline cell and `T?` glyph render and are tested and cannot occur. Schema is ready. Three decided mechanics, from 12 Aug, not to be re-litigated: **`hold_expires_on` is the only truth** (never duplicated onto `vehicle_day_allocation.is_hold`, one hold spanning several rows); **release is synchronous** — `bookTrip`/`startDailyLease`/`startLease` each void the vehicle's own expired holds *before* checking for a conflict, with the nightly sweep releasing only what nobody booked around (CLAUDE.md, "no cron is a prerequisite for a user action"); **`in_progress` is derived from the business date, never written**. Note the ordering trap Wave 2 already paid for once: the release must land before the conflict check, the same reason `releaseDailyLeaseAllocationsForRange` precedes `insertAllocationDays`.

**5A-2 · GAP-25 — end a daily lease (S).** `endDailyLeaseRow` exists with two callers ([domain/vehicles.ts:172](api/src/domain/vehicles.ts#L172), [domain/dailyLease.ts:158](api/src/domain/dailyLease.ts#L158)); this is an endpoint and a screen, not a mechanism. **It must reuse Wave 2's `releaseDailyLeaseAllocationsAfter` + `voidFutureOpenDayRecordsForLease`** — the third caller of the pair `changeDailyLeaseDriver` and `changeVehicleArrangement` already have. Skip it and this silently reintroduces GAP-118 on a new path, which is exactly how GAP-118 got there.

**5A-3 · GAP-20 — skippable individual days, F-1.7 (S–M).** `day-card-generation.ts` consults `lease_day_exception` *before* it writes; an excepted date behaves exactly like an off-pattern one — **no row, ever, the absence is the record**. The write path also needs the un-skip, which is a void, not a delete (W-58). **Confirm against UC-76 before writing the query**: an excepted day must land in neither `ran` nor `lost`, or the report overstates.

**5A-4 · GAP-26 — off the road, F-1.10 (M).** Write path over `vehicle_unavailability`, calendar rendering, and the UC-79 utilisation bucket that has always named it. The reason mapping was decided 12 Aug and is the whole point of the item: **a breakdown still reaches UC-76's lost-day denominator; a routine outage does not.** Deliberately does not duplicate `incident.off_road_from/to`.

**5A-5 · GAP-2 — effective-dated rate change (F-4.3) + bulk week-confirm (F-4.6) (M).** The rate-change mechanism already exists: close the row and open a new one, exactly what `changeDailyLeaseDriver` does — roughly halving this item (12 Aug). Last in the track because several screens' "current rate" simplifications are safe only while it is unbuilt, so it wants the other four settled around it.

**Order:** `5A-1 → 5A-2 → 5A-3 → 5A-4 → 5A-5`. **The gate for this track is UC-76, not a green suite** — every item can move the lost-day denominator, and moving it is silent.

---

### Track 5B · Corrections, costs and attribution — *"how do we take it back, and whose is it"*

**A9b (GAP-12/36/60) · A8 (GAP-30/32/34) · GAP-6 · GAP-15 · GAP-68 · A14 (GAP-65).** One track because all of it either writes a void or decides who bears a cost. Branch: `wave5b/corrections-2026-08-14`.

**5B-1 · A9b — the void endpoints (XL, the largest item in the wave).** GAP-12 + GAP-36 + GAP-60 together, because they are one pass over the same fifteen-odd tables and doing them separately means three. Schema is entirely ready and entirely unused. **The reference pattern is [`voidExpense`](api/src/domain/expense.ts#L170) + [`voidExpenseRow`](api/src/queries/expense.ts#L71)** — replicate it, do not reinvent it: existence check → already-voided check → `writer.transaction` (`withActor` only attributes inside a real one) → catch `isPeriodClosedViolation` → `PeriodClosedError`. Three things to get right once, at the start, rather than fifteen times: **`replaces_id` is written by the *replacement*, not the void** (GAP-60 is void-*and-replace*, so the correction row carries the pointer); **`voidedReason` is a parameter, never hardcoded** (`voidExpenseRow`'s own comment, and Wave 2's reason for it); and **`driver`/`customer` are soft-deletes, not voids** — a soft-deleted parent must keep every past record rendering exactly as before, so a closed month's totals never move because someone archived a driver later (12 Aug). **Widening `check-forbidden.mjs`'s `money/void-table-unfiltered` rule to the tables this item puts a live void behind is part of the item**, not a follow-up — Wave 2 scoped it to four tables precisely because the rest had no void endpoint yet, and this is what changes that.

**5B-2 · A8 — fuel-fill odometer, borne-by, prefill (M).** GAP-30: **a fuel fill writes its own `odometer_reading` row in the same transaction** — decided 11 Aug, not fuzzy-matched to a nearby reading and not stored on the expense alone. `expense.odometer_reading_id` has been a column since P3 and is read by [queries/reports.ts:234](api/src/queries/reports.ts#L234) with nothing ever writing it. GAP-32: borne-by override to a *specific* driver or customer, which needs the "who currently holds this vehicle" lookup — [`resolveBorneByDefault`](api/src/domain/expense.ts#L52) already resolves as of `spentOn` (GAP-56), so the preview reuses it rather than adding a second answer. GAP-34: prefill, the smallest of the three.

**5B-3 · GAP-6 + GAP-15 — deposit-apply and deduct-from-fee (M).** Paired: both are F-8.3/F-8.4's sheets and both settle an obligation from money that is already somewhere. **GAP-6's whole difficulty is one sentence** — applying a held deposit must **not** mint a `payment` row for money already held, so `allocateAgainstOldest` cannot be reused verbatim; `recordDepositMovement` takes an `obligationId` it currently ignores, and the obligation's `settled_minor` moves with the `applied` movement in the same transaction. GAP-15: `createOffset` exists ([domain/offset.ts:35](api/src/domain/offset.ts#L35)) and is applied afterward; this is the combined one-tap path. **Read Wave 4's `credit-forward.ts` first** — it solved the adjacent problem of settling an obligation from money held elsewhere, and a second implementation of that arithmetic is the trap.

**5B-4 · GAP-68 — the predictive maintenance prompt (S–M).** F-3.5's predictive half; the recording action already ships. **Sequenced after 5B-2** because it reads the odometer history 5B-2 is what finally writes.

**5B-5 · A14 — the signed share link, GAP-65 (M).** F-6.6's "not optional" mechanism: a signed, expiring, **no-login** link, 30 days (11 Aug). Fully independent of everything else in either track — the natural filler when something blocks. **The one open decision in Wave 5, and it is 5B's**: a stateless signed token (no table, no migration, but no revocation) or a stored link row (revocable, and the only migration Wave 5 would need). **Recommendation: stateless**, matching this wave's no-migration shape; take it to the owner before building, not after. **W-49 is the acceptance criterion, not a nice-to-have** — a share link is a route that bypasses the JWT, so it gets the linked-driver isolation test class by construction.

**Order:** `5B-1 → 5B-2 → 5B-3 → 5B-4`, with `5B-5` floating. 5B-1 first because it is the largest and because the void convention it settles is one every later item inherits.

---

### The seam between the tracks

Stated explicitly so two people do not discover it in a merge. **The tracks share no domain file and no schema file.** What they do touch in common:

| Shared surface | Rule |
|---|---|
| `api/src/errors/app-error.ts` | Both append error codes. **Append only, never reorder** — conflicts stay trivial |
| `scripts/check-forbidden.mjs` | **5B owns it** (widening the void rule is 5B-1's own work). 5A's two new void-trio tables get filed to 5B rather than edited in |
| `api/src/db/schema.ts` | **Read-only for both.** Wave 1 landed every column; a Wave 5 migration means a fact nobody planned for — stop and say so |
| `packages/shared/src/schemas/` | Disjoint: 5A owns `trip-lifecycle.ts`/`vehicle.ts`, 5B owns `expense.ts`/`driver.ts`/`customer.ts` |
| Web screens | Disjoint: 5A owns `VehicleCalendarScreen`/lease screens, 5B owns `RecordExpenseSheet`/`FuelFillSheet`/the void sheets |
| The `test` Neon branch | **Shared, and it is the real contention risk** — §5's documented connection-pool exhaustion is worse with two people. Run touched-file-alone, not the full suite, and coordinate before any full run |

**Both tracks clear the same gate independently before merging**: `npm run check`, golden fixtures unmoved at 134,000 / 15,000 / 7,500, and DM §13's drift assertion. **Neither track merges to `develop` before Wave 4 does.**

### Wave 6 · Reports (M)

GAP-18 (UC-73's yearly view, UC-99's export) · GAP-19 (UC-79's revenue per available day) · GAP-98 — three phase-2 routes are mounted and incomplete; now that they're phase 1, finish them rather than annotate them as unfinished.

### Wave 7 · Client remainder (M)

GAP-44 (the enriched `VehicleDoubleBookedError`, its catch sites, the wire schema, the Dialog — after Wave 2) · GAP-111 (the table view's missing empty state) · GAP-113 (M-15 colour-alone violation) · GAP-27 (arrangement C's orange gets a real token) · GAP-17 (photo pipeline off the main thread) · B16 Phase 2/3 (component variants, catalogue grouping, money-direction consistency).

### Wave 8 · Verification debt (S–M)

GAP-114 (the assertion that passes either way) · GAP-115 (five thinner-tested screens) · GAP-86 (suite noise) · LT-9 (needs a linked driver created first — QA has none) · LT-10 (real iOS Safari / Android Chrome) · LT-11 (real photo, then decides GAP-112) · LT-12 (watch a stranded batch's re-confirm render in the reports — the data path itself already checked live: three postings seconds apart, first two reversed, third live, real offsetting movements).

### Wave 9 · Release (S)

Full gate, golden fixtures unmoved at 134,000 / 15,000 / 7,500, `develop` → `main`, post-deploy verification before anyone onboards.

### Corrections this pass found

- **GAP-25 is smaller than filed** — `endDailyLeaseRow` exists with two callers; missing is an endpoint and a screen.
- **GAP-2 roughly halves** — the rate-change mechanism already exists.
- **GAP-5 needs no new table** — sized as a credit ledger before `payment_allocation` existed to draw on.
- **GAP-12's "expense only" is stale** — A7 added a void route for attachments, mirroring the expense one.
- **The unlettered "in-app invite a member screen"** (§ below) is done — `MembersScreen.tsx` ships it, role picker and one-time code included.

---

## The order, end to end

Every remaining item on both tracks, sequenced. **Sizes are relative to each other, not calendar estimates** — S is a sitting, XL is the largest thing left on either track.

### The two tracks are independent

There are **no Track A → Track B handoffs left**. A2 → B2, A3 → B3, A4 → B6 and A5 → B5+ have all happened, and every schema Track B needs is already in `packages/shared`. So if two people are working, they never block each other:

| | Order | Note |
|---|---|---|
| **Track F** | ~~F1~~ → ~~F2~~ → ~~F4~~ → ~~F3~~ → ~~F5 (GAP-110 → GAP-109)~~ | The live-and-silently-wrong queue, named because it keeps jumping every other one. **F5 done 11 Aug, both halves, same day it was found** — GAP-110's sticky-CTA fix landed first since GAP-109's own remedy (a re-save) runs through it; GAP-109 then moved `commitOpeningBalance`'s idempotency check off `status` onto whether the batch actually has postings, so every batch stranded before F3 materialises on its next ordinary `Confirm`. Nothing currently on either track outranks this rule's next instance, whenever one turns up |
| **Track A** | ~~A9a~~ → ~~A6~~ → ~~GAP-74~~ → ~~GAP-41~~ → ~~GAP-72~~ → ~~F1~~ → ~~F2 (server half)~~ → ~~A17~~ → ~~A10a~~ → ~~A10b~~ → ~~A13~~ → ~~A15~~ → ~~A16~~ → ~~A7~~ → A8 → A14 → A9b → *[GAP-2/5/6/7/8/11/14/17/20/25/26/27/34, mostly unsized]* | A9a done 5 Aug, A6 done 6 Aug, **the three report-query gaps and F1 done 8 Aug** — F1 closed GAP-84 and found one sibling (GAP-87, then correctly unscheduled pending a decision). **F2, A17, A10a, A13, A15 and A16 all done 9 Aug** — F2's server half closed the revoked-member 500 (GAP-90), A17 closed two route-def validation holes (GAP-92, GAP-93), A10a shipped the management-fee generator (GAP-39, migration `0011`), A13/A15/A16 closed GAP-54/GAP-62/GAP-77. **A10b and GAP-87 also done, later the same day** — A10b once `user-flows.md` settled GAP-10 (F-3.4 v1.1.5), GAP-87 once its use-cases question turned out already answered by the client's own gate. GAP-88 closed alongside them (D-9, DM §4.1/§17), outside Track A's own numbering but riding with this batch. **A7 merged 10 Aug** (PR #20, into `develop`, not yet `main`), closing GAP-16 for expense receipts. **What's left after A8/A14/A9b is the 11 Aug phase-1 promotion batch** — TRACKER.md §4 has each row's own reasoning; none is sized into a Plan.md item yet. GAP-6/15/18/19/73 (and Track B's GAP-98) needed the `use-cases.md`/`user-flows.md` doc-change first — **landed 11 Aug 2026** (v1.2.5/v1.1.6), so all are startable; GAP-68 never needed it |
| **Track B** | ~~B0~~ → ~~B11~~ → ~~B10~~ → ~~B14~~ → ~~B0b~~ → ~~B12~~ → ~~B13~~ → ~~B3 (core)~~ → ~~GAP-81~~ → ~~B4 Wave 1~~ → ~~12a `doc-change`~~ → ~~GAP-85~~ → ~~B4 Wave 2~~ → ~~F2 (client half)~~ → ~~F4~~ → ~~F3~~ → ~~B9 low-API primitives~~ → ~~B15~~ → ~~B6~~ → ~~B5 core~~ → ~~B2 UI callers~~ → GAP-44 → *[GAP-111/113/114/115/116, GAP-27/34 ride-alongs]* | **B14, B0b, B12, B13, B3-core, GAP-81, B4 (both waves), 12a's `doc-change`, GAP-85, F2's client half (GAP-101), F4 (GAP-104), F3 (GAP-103), B9's low-API primitive remainder (GAP-108, GAP-47, GAP-48), B15 (GAP-82), B6 (GAP-22/GAP-102), B5's core screens, GAP-100, and the B2 UI callers are done.** GAP-44 remains from B9 but needs the wire-schema change its own decision requires. GAP-1 is now the sharpest non-UI policy item. **B7 moved to phase 3 (11 Aug) and is no longer this track's tail** — nothing in Track B sequences after it today except the unsized 11 Aug promotion batch. **V1 is not code**, does not block any of this, and can run in parallel whenever picked up |
| **Phase 2** | P14 (messaging) | Still externally blocked (12 Meta template approvals) **and** now phase 2 by the 11 Aug decision — two independent reasons it isn't in the phase-1 queue above |
| **Phase 3** | B7 (offline/PWA) | Moved here 11 Aug. Unchanged in substance — still cross-cutting, still correct to build last — only its phase label changed |

### One person, one queue

If it is one person, this is the order, and the reasoning is *what breaks first in real use* rather than what is most interesting to build.

**Rows 1–19c are all done** (5–9 Aug) and compacted to one line each — full accounts are in git history, each item's own section further below, and TRACKER.md's closed table by gap id. **Rows from 20 on are what's actually pending**, kept in full detail on purpose.

| # | Item | Size | Status |
|---|---|---|---|
| 1 | ~~B0 · `/more` hub~~ | S | ✅ 5 Aug — unblocked B2/B3/B6, GAP-40 |
| 2 | ~~A9a · void/period trigger~~ | S | ✅ 5 Aug — unblocked A6, A10 |
| 3 | ~~A6 · trip receivable~~ | M | ✅ 6 Aug — GAP-23 |
| 3a | ~~A0 · the creator's role~~ | XS | ✅ 6 Aug — GAP-42, one word, unblocked every real signup |
| 4 | ~~Merge `build/p0-foundation` → `develop`~~ | XS | ✅ Done repeatedly, 7–10 Aug. **Standing rule this row became**: nothing is verifiable on QA until merged |
| 5 | ~~Production data fix~~ | — | ✅ Checked 7 Aug, moot — production had zero signups, nothing to fix |
| 6 | ~~B11 · structural render fixes~~ | S | ✅ 7 Aug — GAP-49, GAP-50 |
| 7 | ~~B10 · set up the daily lease~~ | M | ✅ 7 Aug — GAP-51 |
| 8 | ~~A11 · member and driver access~~ | L | ✅ 7 Aug — GAP-43/52/53, migration `0010`, 6 endpoints |
| 8a | ~~A12 · borne-by date bug + trip-receivable UI~~ | S–M | ✅ 7 Aug — GAP-56/57, the one real new money defect either external review produced |
| 8b | ~~B14 · trip receivable's wrong field~~ | XS | ✅ 8 Aug — GAP-75 |
| 9 | ~~B0b · three shells + capability gate~~ | S | ✅ 8 Aug — `<Can>`, `useMe()`, Review/Mine shell routing |
| 9a | ~~B12 · opening balances~~ | L | ✅ 8 Aug — GAP-61 (see F3/row 12d: the screen works, what it writes doesn't) |
| 9b | ~~B13 · driver money — pay/advance/deposit~~ | M | ✅ 8 Aug — GAP-63/64/66, found `POST /api/payment` had no `"paid"` direction at all |
| 10 | ~~B3 · close the month (core)~~ | M | ✅ 8 Aug — checklist, `Dialog`-confirmed close, `CorrectPaymentSheet` |
| 9c | ~~**V1** · the live-test queue~~ — [LIVE-TEST-PLAN.md](LIVE-TEST-PLAN.md) | S | ✅ **LT-1–8, and now LT-11, all closed** (6–12 Aug) — every one found something no source read did. **Restored 11 Aug 2026** after being swept into the 10 Aug consolidation by mistake; **no longer a one-time item** — LT-9, LT-10 and LT-12 (linked-driver 403 live, F4's real-device pass, the post-F5 opening-balance re-confirm) are still open and the file stays as the standing live-test practice, added to as new surface ships rather than retired once emptied |
| 10a | ~~B3 remainder · `WriteOffSheet`/`PostClosureChargeSheet`~~ | — | **Withdrawn 8 Aug** — F-8.3/F-8.4 and UC-90/91 are phase 2 in their own owning documents; `docs/` outranks this file |
| 10b | ~~GAP-81 · void an expense from the client~~ | S | ✅ 8 Aug — shared `ExpenseCostRow`, `VoidExpenseSheet` |
| 11 | ~~GAP-74 · partner's all-time balance~~ | M | ✅ 8 Aug |
| 11a | ~~GAP-41 · overheads with no vehicle~~ | S | ✅ 8 Aug |
| 11b | ~~GAP-72 · goodwill window's dropped last day~~ | XS | ✅ 8 Aug — `AT TIME ZONE` overload trap, TRACKER §5 |
| 11c | ~~Merge `build/p0-foundation` → `develop`~~ | XS | ✅ (see row 4) |
| 11d | ~~F1 · arrangement validated on neither side~~ | S | ✅ 8–9 Aug — GAP-84, then GAP-87 the same shape on `bookTrip` |
| 12 | ~~B4 Wave 1 · Review shell + phase-1 six~~ | L | ✅ 8 Aug |
| 12a | ~~`doc-change` · DM §15 + UI §11.1~~ | S | ✅ 9 Aug — GAP-70/71's documents half |
| 12b | ~~B4 Wave 2 · what the doc-change unblocked~~ | S–M | ✅ 10 Aug — GAP-70/71 built. **B4 fully done, both waves** |
| 12c | ~~F2 · review-money 500 + close-month tone~~ | S | ✅ 9–10 Aug — GAP-90 (both halves, client half via GAP-101) + GAP-91. **F2 fully closed** |
| 12d | ~~F3 · opening balances confirm live, connect to nothing (GAP-103)~~ | M | ✅ 11 Aug — the undecided fork asked and answered (**materialise**, not a parallel ledger); `commitOpeningBalance` now turns each of the six entry kinds into a real `obligation`/`deposit`+`deposit_movement`/`advance`/`payment` row on first commit, with a new `opening_balance_posting` table (migration `0014`) making a post-commit correction reverse-and-repost rather than double. Full account: TRACKER.md's closed row for GAP-103 |
| 12e | ~~F4 · mobile `ActionSheet`/`Sheet` history race (GAP-104)~~ | M | ✅ 11 Aug — `useMobileHistoryDismiss` rebuilt as one stack manager (`Sheet.tsx`'s sole caller), replacing independent per-`Sheet` history push/pop. Verified against the live symptom under real Chromium touch emulation, not only in theory; new coverage at the manager, primitive (real nested `Sheet`s) and e2e (`mobile-360x640-touch` Playwright project) levels — see TRACKER.md GAP-104's closed row for the full account, including the one still-open acceptance item (a real iOS Safari/Android Chrome pass) |
| 13 | **B9** · the remaining UI fixes | M | **GAP-44 and GAP-89 decided 10 Aug** (TRACKER.md carries the reasoning). **Fourteen items closed 10–11 Aug** (TRACKER §6's twelfth pass, plus GAP-83/GAP-105, GAP-108, GAP-47 and GAP-48 the day after): GAP-45, GAP-46, GAP-55, GAP-89, GAP-91, GAP-96, GAP-97, GAP-99, GAP-106, GAP-83, GAP-105, GAP-108, GAP-47, GAP-48 (plus M-25, riding with GAP-97). **What's left: GAP-44** — it needs the wire-schema change its own decision requires |
| 14 | ~~**B15** · quick-add's two payment actions (GAP-82)~~ | S–M | ✅ 11 Aug — Quick Add renders all five M-4 actions; received payments choose customer/driver, made payments choose driver, both post `/api/payment` |
| 15 | ~~**B6** · customer detail (+ vehicle paperwork write, GAP-102)~~ | S | ✅ 11 Aug — `/people/customers/:id` reads customer/dues/payments, can collect a payment, and vehicle paperwork can be renewed from Vehicle Overview |
| 16 | ~~A10a · management fee that never fires~~ | M | ✅ 9 Aug — GAP-39, migration `0011` |
| 16a | ~~A10b · incident contribution that is not a receivable~~ | M + `doc-change` | ✅ 9 Aug — GAP-10, `user-flows.md` v1.1.5 first, migration `0012` |
| 17 | ~~A13 · change a vehicle's arrangement~~ | S–M | ✅ 9 Aug — GAP-54 |
| 18 | ~~A15 · change a daily lease's driver~~ | S–M | ✅ 9 Aug — GAP-62 |
| 19 | ~~A16 · a vehicle's trip history~~ | S–M | ✅ 9 Aug — GAP-77 |
| 18a | ~~**B13 remainder** · settle an advance (GAP-100)~~ | S | ✅ 11 Aug — Trip detail can issue a trip-scoped advance; staff Driver detail can settle open/part-settled advances. Mine remains read-only |
| 19a | **GAP-86** · the test suite's own noise | XS | Non-failing `scrollTo`/`RouterProvider` warnings that could hide a real regression. Ride-along, not its own sitting |
| 19b | ~~A17 · two API validation holes~~ | S | ✅ 9 Aug — GAP-92/93 |
| 19c | ~~`doc-change` · DM §4.1 vs CLAUDE.md's cron rule~~ | S + M | ✅ 9 Aug — GAP-88 (D-9), GAP-94 stays open (shares the root, not the fix) |
| 20 | ~~**B5 core** · Mine shell (+ the staff driver-history read)~~ | M | ✅ 11 Aug — `/me` over `GET /api/driver-view`; `DriverDetailScreen` now calls `GET /api/driver/{id}/view`; both share the read-only activity sections. The statement/share-link line remains A14 |
| 21 | ~~**B2 UI callers** · ownership/share setup and scoping-safe partner admin~~ | M | ✅ 11 Aug — `/cash`, `/partners/:userId`, capital contribution, banking, partner payout, mileage packages, paid-by picker, `/vehicle-sharing` initial ownership split, and management-agreement create/revoke. Remaining work is no longer a low-API UI caller: GAP-1 policy scoping, ownership-share replacement, and API role hardening |
| 22 | **A14** · the printed slip's share link (F-6.6, GAP-65) | M | A signed, expiring, no-login link — no backend mechanism, no client button. Travels with B5 |
| 23 | **A8** · odometer + borne-by preview | S | Completes a shipped form (GAP-30, GAP-32). Blocks nothing |
| 24 | **A7** · R2 upload (expense receipts only) | M | **Implementation complete, verification substantially done this session** — see A7's own section below for the full account (two real bugs found and fixed: an unapplied migration, a test-cleanup gap). GAP-16 closes for expense receipts once merged; the other four photo call sites and GAP-17 stay unbuilt on purpose |
| 25 | **A9b** · the rest of soft delete | L | ~15 void endpoints (GAP-12, GAP-36) + GAP-60's `replaces_id` (shape decided 9 Aug: a nullable self-referencing column per table, not one polymorphic table) |
| 26 | **B7** · offline and the PWA | L | Cross-cutting, sequenced last on purpose |
| — | **In-app "invite a member" screen** | S | Unlettered, no longer blocked (B0b landed). Needed for LT-1. Size it and give it a letter |
| — | **GAP-7** · trip `hold`/`in_progress`, end to end | ? | **Decided 11 Aug 2026: build it**, not a wording fix — `VehicleCalendarScreen`'s hold-outline cell and `T?` glyph stay, and start being reachable. **Blocked on a `doc-change` first**: ST-5 (`user-flows.md:201`) says a hold "expires or is confirmed" with no duration or mechanism specified anywhere. Cannot be sized or lettered until that lands |

### The 8 August re-sequence — what it prioritises, and what it gives up

**The queue above was re-ordered on an explicit instruction: finish B4, then B9, B15 and B6, then A10 and the A13/A15/A16 trio, plus the outstanding fixes.** It is a coherent priority and most of it matches what a severity read would have produced anyway — but it is a *choice*, and this section records the choice rather than presenting it as a derivation.

**What the validation pass changed before the order was written down.** Every item on the instruction list was re-checked against source first, the same pass that preceded A2/A3, A6–A10 and Track B — twice before, that pass has found items marked "ready" that could not start. Six findings, four of which moved something:

1. **A10 is two items, not one, and only one of them can be built.** GAP-39 (the management fee that never becomes an obligation) is a straight generator with `generate-billing-periods` as its precedent and W-53 as its unambiguous instruction. **GAP-10 is not**: `recordCustomerContribution` leaving `obligation_id` NULL is *faithful to F-3.4*, whose own **Writes** line names `IncidentRecovery[]` and no obligation, while `0001`'s column comment says the opposite. That is a documents-disagree question, and it gets settled in `user-flows.md` before any code moves — the same rule that keeps GAP-70/71 in Wave 2. Split into **A10a** and **A10b**.
2. **B4's two `doc-change`s are now scheduled items (12a), not preconditions mentioned inside a Wave 2 paragraph.** GAP-72 is the standing proof that this matters: it sat "outside both orderings… whenever someone is next in `queries/reports.ts`", which read as flexibility and functioned as *never* for two days. An unscheduled prerequisite is a deferred one.
3. **GAP-55 is wider than filed.** It was recorded as the Add-a-driver form's Name field; `grep` finds **no `autoComplete` attribute anywhere in the client**. Same shape as GAP-83, which was filed against one screen and turned out to be `DateField` itself.
4. **B15 is smaller than its row read.** B13 already generalised `recordPaymentRequestSchema` to carry `direction` *and* `partyType: customer | driver | partner`, so neither quick-add payment action needs an endpoint or a form — only a party picker in front of writes that exist and are tested.
5. **F1 (GAP-84) is new, and it is the only item on this list that writes a contradiction into the ledger** rather than displaying one or omitting a screen. It goes ahead of the instruction list on the rule this queue already runs on — the one that put GAP-3 ahead of A6, GAP-56 ahead of everything unbuilt, and B14 immediately after it.
6. **One stale claim corrected in passing:** TRACKER's GAP-44 row says `Dialog` has "exactly one" real call site (`CloseTripSheet`). It has three now — B3's `CloseMonthScreen` and B12's `OpeningBalanceScreen` both added one. The gap itself is unchanged and confirmed: `VEHICLE_DOUBLE_BOOKED` still has zero references anywhere in `web/src`.

**What this re-sequence gives up, stated plainly: B5, and with it A14.** A linked driver can obtain a real account (A11) and lands in a real Mine shell (B0b) that renders `NotBuiltYetScreen` — deferring B5 means **that stays true for the whole of this pass**, and it is the same "reachable, not usable" state that was the top complaint about `owner` before B4 was scheduled. The counter-argument for the order as chosen is real and is why it stands: **B4 serves the partner who is already waiting with data on screen to read, while B5 serves a role nobody has been invited into yet** (LT-1 will be the first time a driver account is ever held), and B4 is the item that has been ranked first-and-not-started twice. If a driver is about to be given a login, B5 moves back up — that is a product call, not a build one.

**One thing deliberately not moved.** GAP-1 stays unscheduled — it needed a design decision (which table decides "his" vehicles) before it needed a slot; **decided 9 Aug 2026** — split by role, `ownership_share` for an owner/owner-manager, `management_fee_agreement` for a manager, no new table — but still not built, so the operational guard still stands: **do not invite a `manager` to a real business**. **GAP-58, the 178-case test manifest that never ran, closed 11 Aug 2026 rather than staying parked** — decided not to adopt it (TRACKER.md's closed row), so it no longer sits here as a deferred queue item; [LIVE-TEST-PLAN.md](LIVE-TEST-PLAN.md) is the standing live-test practice instead.

### Two orderings worth arguing with

**10 before 12 (B3 before B4).** B3 has a hard date and B4 does not — but B4 is far larger, so starting B4 first risks month end arriving mid-item. If the business is not yet running real months, swap them: B4's value compounds with every day of data it can show. **Both now sit behind B0b either way**, which is small and shared.

**11, 11a and 11b are Track A items inside the Track B queue, deliberately — and they are now one visit to one file.** Each is small report-query work whose only consumer is B4; scheduling them on Track A's own list would put them behind A10/A8/A7, and B4 would arrive at three separate blocks with nothing to call. They are listed where their consumer needs them, not where their code lives. **The grouping is new (8 Aug) and is the point**: GAP-74, GAP-41 and GAP-72 all live in `queries/reports.ts`, so one context load covers all three instead of three. **GAP-70 and GAP-71 sit the same way but stay in Wave 2**, because both need a `doc-change` (DM §15, UI §11.1) before their query moves — the owning document is where each requirement went missing, not the code.

**GAP-72's row corrects a scheduling failure in this document, not a change of severity.** It was written as belonging "to neither queue's ordering… whenever someone is next in `queries/reports.ts`" — which sounds like flexibility and functions as *never*, and did, for two days. **A one-predicate fix with no owner is not scheduled; it is deferred without saying so.** Nothing renders the goodwill report today (UC-77 is phase 2), so it does not outrank anything on the live-wrong-money rule — it is here because the neighbouring rows make it free.

**10a is withdrawn, and 10b takes its slot, on the owning documents rather than on judgment.** `user-flows.md` marks F-8.3 and F-8.4 *Phase: 2* in their own headers; `use-cases.md` §9.1 names UC-90 and UC-91 under **Second**. B3's checklist in this file asked for both sheets regardless — the third time this document has treated a shipped backend as evidence of phase ownership (P10's write-off endpoints here, P11's nine report endpoints in the B4 scope decision, P2's `opening-balance` in B12's own step list). **The tell is the same every time: the endpoint exists, so the screen feels due.** Meanwhile F-8.5 — *Phase: 1*, UC-96 under **First** — had its client half sitting in B9's small-fixes bucket at rank 15. Correcting the phase reading swaps them, and the swap is the whole refinement: **the correction path a manager needs in week one now outranks two sheets for a phase nobody has started.**

**A7 low (row 24, renumbered from 19 by the 8 August re-sequence).** Now fully planned — see the row's own note — and scoped down to expense receipts only, with its own receipt-viewing surface, so it is closer to shipped product than earlier editions of this row assumed. It stays low anyway: the other four photo call sites (condition sets, incident damage) are the ones that were "unblocked surface, no screen calling it," and this item deliberately does not build them. Promote the second branch the moment a condition-photo or incident-photo screen is scheduled — not before.

**6 and 7 (B11, B10) jumped ahead of A11, which itself was the top of the queue as of yesterday.** The reasoning is a straight severity comparison, not a change of philosophy: A11's absence means two roles have no possible user, which is severe but static — it has been true since before A0 and nothing makes it worse by waiting a few more items. GAP-49/50/51's absence means the **one role that already works is actively broken today**, in production-adjacent QA, for anyone who opens the app in dark mode or tries to run a bus on a daily-fee driver — both ordinary, not edge cases. A live bug in shipped surface outranks a missing plumbing layer for surface that doesn't exist yet, which is the same reasoning that put GAP-3 ahead of A6 on 6 August. **This is now the second time a live/production signal has reordered this queue on arrival** (GAP-3 was the first) — worth noticing as a pattern: nothing about reading source or mocks surfaced either one.

**8a jumps almost everything, and it is the only money defect either external review has produced that this plan did not already have.** The rule this queue has run on since GAP-3 is that live, wrong money on a real person's balance outranks missing surface — GAP-56 is exactly that, it is small, and it is on the path *every* expense takes. It sits behind the two non-code items and B10/B11/A11 only because those are already done; against everything unbuilt it goes first. **A13 (GAP-54) deliberately does not join it**, despite arriving in the same review and the same paragraph of it: a wall you meet when a vehicle changes purpose is a real limitation, but nothing about waiting makes it worse, and no number is wrong while you wait.

**8b (B14) jumps to right behind 8a, on the identical rule, one day later.** GAP-75 is the same shape as GAP-56: live, wrong money on shipped surface, found by a live pass rather than a source read. It is smaller than 8a — one field name in one file — so there's no real case for ranking it anywhere but immediately next in line. Worth naming as a pattern now that it's happened twice from two different live-testing passes on two consecutive days: **a source-only validation pass reliably misses exactly this class of bug**, because the code that's wrong (a display field, not a computation) looks locally correct in isolation and only reads as wrong next to real data.

**9a/9b (B12, B13) ahead of B3, and it's the least settled call in this pass.** The reasoning is that B3 closing a month is only meaningful once a business's *starting point* is honestly on record, and nothing today can enter one — so a real two-partner business going live mid-stream (the running example CLAUDE.md opens with) hits B12's absence before it ever reaches B3's deadline. B13 rides along because it has the identical shape (no dependency, a core Operate-role gap, self-documented missing in one case) and is smaller. **The counter-argument, stated plainly: B3 has an external deadline and B12/B13 don't** — nothing about waiting makes either one worse, the same test that kept A13 out of 8a's jump. Production currently has zero signups (checked 7 Aug), so there is no live month at risk of closing without opening balances *yet* — but the first one that does sign up needs this before their first month, not after. Swap 9a/9b behind 10 if a live business is closer to month-end than to onboarding when this is next picked up.

**GAP-1 is now the sharpest thing in "correct to leave", and it should probably not stay there.** A11 made a `manager` invitable for the first time, and a manager holds `viewReports` across the whole business against UC-70/71/72's "only shared vehicles". The gap itself has not changed — it is still real design work (which table decides "his" vehicles) — but its *reason for being unscheduled* was reachability, and that expired on 7 August. **It is not scheduled here** because it needs a design decision before it needs a queue slot, and this document should not pretend otherwise; the operational guard in the meantime is one line, recorded against B0b: **do not invite a `manager` to a real business yet.**

**Design decided 9 Aug 2026, still not scheduled.** Asked directly rather than left to keep drifting: `ownership_share` (effective-dated since P7) scopes an owner/owner-manager's own vehicles by equity; `management_fee_agreement` (effective-dated since A10a's migration `0011`) scopes a manager's by operational assignment. Split by role, `auth/policy.ts` queries whichever table matches the acting role — no new table, no new migration, both facts already exist exactly where they're needed. What's still missing is the actual wiring into `auth/policy.ts` and every `viewReports`/`viewOwnerOnlyReports`/`managePartnerCapital` call site, which is real work and still wants its own Plan.md slot rather than riding in on a day it wasn't the priority. The operational guard is unchanged: **do not invite a `manager` to a real business** until it lands.

**A full flow-inventory audit is recommended but not yet sized or scheduled.** GAP-51 (F-1.7) fell through every prior validation pass because those passes compare what's built against what's specced *for the same flow* — they can't notice a flow with nothing on either side. The natural moment to run this is alongside B10, since building it means reading `user-flows.md`'s F-1.x block closely anyway: while there, check every phase-1 flow id (F-0.1 through F-9.x) against both `ui-ux-guidelines.md` (wireframed?) and `web/src` (built?) and file anything else that's missing on both sides the way F-1.7 was. Cheap relative to what it might find; TRACKER.md §5 has the reasoning for why this is now a standing practice, not a one-off.

### What is deliberately not in this list

**Superseded 11 Aug 2026 by the owner's phase model — kept below for the reasoning, not as current status.** All three bullets described an 8 Aug scope decision that the phase model directly reversed: P14 is phase 2 by explicit decision now (not just externally blocked), GAP-15/6 are phase 1 and startable — the `use-cases.md`/`user-flows.md` doc-change landed the same day as the phase model itself — and the "18 gaps" bucket they were withdrawn into no longer exists — see [The order, end to end](#the-order-end-to-end) for where each one actually sits today.

- **P14 messaging** — twelve Meta approvals outstanding. Fire them now regardless; they queue, and `dispatch-messages` plus six templates are unsized work behind a label that says "external" ([TRACKER.md](TRACKER.md) → Blocked).
- **`WriteOffSheet` and `PostClosureChargeSheet`, and GAP-15 with them** — **withdrawn 8 Aug**, F-8.3/F-8.4 and UC-90/UC-91 are all phase 2 in their own owning documents. The backends shipped at P10 and stay callable; no screen is due. Revisit with the rest of phase 2, or sooner if a real business needs to write off a debt before then — that is a product call, not a build one.
- **The 18 gaps in [TRACKER.md](TRACKER.md) §4's "recorded, unowned, and correct to leave"** (corrected from a stale 19, 8 Aug — a plain miscount, not a dropped item) — each unreachable, unbacked by the schema, or out of scope. Three worth re-reading before a real user arrives: **GAP-25** (nothing ever ends a daily lease — the closing half of the same arrangement B10 starts), **GAP-1** (per-vehicle capability scoping is a business-wide stand-in — do not build UI implying it exists), and **GAP-68** (F-3.5's predictive maintenance prompt — the base recording action already works; only the "prompt next time" half is missing).

---

## Track A — the Worker and shared schemas

| id | Item | Gaps | Endpoints | Blocks |
|---|---|---|---|---|
| **A0** | ✅ **The creator's role** — `owner` → `owner_manager` | GAP-42 | 0 | **everything** |
| **A11** | ✅ **Member and driver access** — done 7 Aug | GAP-43 ✅, GAP-52 ✅, GAP-53 ✅ | 6 + a migration | B4, B5 (get an audience; still need their own screens) |
| **A1** | ✅ Web-P8b's `GET /api/expense` | GAP-33 | 1 | — |
| **A2** | ✅ Partner, banking and cash reads | GAP-9, GAP-4, GAP-31 | 6 | B2 |
| **A3** | ✅ Period, write-off and payment reads | GAP-13, GAP-38 | 4 | B3 |
| **A4** | ✅ Customer-scoped reads | GAP-22 | 2 | B6 |
| **A5** | ✅ Driver history reads | GAP-24, GAP-29 | 1 | B5 (partly) |
| **A9a** | ✅ The void/closed-period hole | GAP-35 | 0 + a migration | — |
| **A6** | ✅ The trip receivable | GAP-23 | 0 + a migration | — |
| **A12** | ✅ **Borne-by by date + the trip receivable's UI** — done 7 Aug | GAP-56 ✅, GAP-57 ✅ | 0 new + 2 changed | — |
| **F1** | ✅ **The arrangement is validated on neither side** — done 8 Aug | GAP-84 ✅ | 0 new + 2 changed handlers + 2 screen guards | — |
| **F2** | ✅ **The review-money 500, server half** — done 9 Aug | GAP-90 ✅ | 0 new + 1 changed query | — |
| **A17** | ✅ **Two API validation holes** — done 9 Aug | GAP-92 ✅, GAP-93 ✅ | 0 new + 2 changed | — |
| **A13** | ✅ **Change a vehicle's arrangement (F-1.2)** — done 9 Aug | GAP-54 ✅ | 1 | F1's refusal (an honest wall needs a way through it) |
| **A15** | ✅ **Change a daily lease's driver (F-4.7)** — done 9 Aug | GAP-62 ✅ | 1 | — |
| **A16** | ✅ **A vehicle's trip history** — done 9 Aug | GAP-77 ✅ | 1 | — |
| **A10a** | ✅ The management fee that never fires — done 9 Aug | GAP-39 ✅ | 0 + a generator + a migration | — |
| **A10b** | ✅ The incident contribution that is not a receivable — done 9 Aug, after `user-flows.md` F-3.4 (v1.1.5) decided it | GAP-10 ✅ | 1 endpoint changed + 1 migration (`0012`) | a `doc-change` on `user-flows.md` F-3.4 |
| *(unnumbered)* | ✅ **`bookTrip`'s own arrangement gate** — done 9 Aug, riding with the above | GAP-87 ✅ | 0 new + 1 changed handler | F1's own GAP-84 fix |
| **A14** | **The printed slip's signed share link (F-6.6)** — **new 8 Aug, flow-inventory audit** | GAP-65 | 1–2 + client | — |
| **A7** | R2 upload (expense receipts only) — independent, fully planned but not started | GAP-16 | 4 + a migration (`0013`) | B-photos |
| **A8** | Odometer wiring + borne-by preview, independent | GAP-30, GAP-32 | 1 | — |
| **A9b** | The rest of soft delete | GAP-12, GAP-36 | ~15 + a migration | — |

**Endpoint counts are lower than the previous edition's** because validation moved work out of handlers: A6 and A10 add **no new endpoints at all** — they change what existing writes do inside their existing transactions — and A9a is a migration with no endpoint. What is left on this track is mostly domain-layer and SQL, which is also why it is the half that needs the golden fixtures re-run rather than a new screen.

### A0 · Done — the creator's role, and why one word hid the whole product

`createBusiness` assigned `role: "owner"`; it now assigns `owner_manager`. Full chain and reasoning at the top of this document. One word, one test assertion inverted (`business.test.ts` had *pinned* `owner`, so the suite was green while the product was unreachable — the same shape as A9a's own regression test asserting the bug it was meant to catch), and `npm run check` clean.

**Why this was invisible for so long:** every integration test mints its users with `mintUser(db, ctx, businessId, "owner")` — an explicit role argument — so no test ever exercised the role `POST /api/business` actually assigns. The one that did assert it asserted the wrong value. And the web test covering `FirstRunGate`'s `owner` → Review branch was *correct*: the routing was never the bug.

**It does not fix the deployed account.** A0 governs new signups; an existing `business_member` row still reads `owner`. That is a live-data decision (queue item 3b), and it is the difference between "the code is right" and "the user can work."

### A11 · Done — member and driver access

**Shipped 7 August 2026, everything below built as specified except two corrections found along the way** (recorded where they land, further down): migration `0010` (the partial unique index, the audit trigger, `business_member_invite`, INV-31 — `AFTER UPDATE` only, not `INSERT OR UPDATE` as first drafted), six endpoints, `FirstRunGate`'s redeem option. 39 new integration tests; full suite 32 files / 406 tests, 406/406 green against a fresh ephemeral Neon branch; web 81 files / 306 tests. `npm run check` clean. The rest of this section is the plan as it stood going in, kept as the record of what was decided and why — TRACKER.md carries the finished item as one row.

**No second person could exist in a business.** `business-member` was GET-only — no `POST`, no `PATCH`, no revoke. `driver.linked_user_id` was read by `queries/identity.ts` and written by nothing at all. So:

- The passive owner partner — the second of CLAUDE.md's *two* partners, and B4's entire audience — **could not get an account**.
- A `manager` could not be added, so W-49's manager column and every `<Can>` gate B0b builds would have been untestable against a real user.
- No driver could ever sign in, so **B5's Mine shell would have shipped with no possible user**, exactly as Review did until A0.

All three are fixed now — see the "done" summary above.

**The mechanism is now settled — `docs/product/use-cases.md` W-57, `user-flows.md` F-1.4/F-1.8 (v1.2.3/v1.1.3), done the same day this gap was found.** It reuses W-42's driver-linking shape rather than inventing a second one: the owner/owner-manager generates an **invite code** scoped to a role and this business, hands it over out of band, the invitee redeems it at their first sign-in — creating their `app_user` if they've never signed in before, exactly the just-in-time provisioning `createBusiness` already does for the first user. One mechanism, three destinations (`owner_manager`/`manager` via `business_member`, `driver` via `driver.linked_user_id`), which is also why F-1.8 moved to phase one alongside F-1.4 rather than staying a phase-two nicety.

#### What was proposed for this, and settled — 7 August 2026

A design pass asked whether users should hold **multiple roles**, with a **role switcher**, a **super-admin** role that assigns roles, and a **"no role yet"** empty state. **Settled: one role per user per business, no switcher, no fourth role — but yes to the empty state, and yes to real member administration**, which is the need underneath "super admin". Three facts in the code decided it, each checked against the source rather than against this plan's own account:

1. **`owner` and `owner_manager` have identical capabilities.** Every entry in `MATRIX` (`auth/policy.ts`) resolves to `STAFF`, `OWNERS` or `LINKED_DRIVER`, and both owner variants sit in both `STAFF` and `OWNERS`. Nothing separates them but which shell UI §1.1 renders — which is exactly what made A0/GAP-42 a production outage.
2. **`driver` is not a membership role.** `business_member.role`'s CHECK admits only `owner`/`owner_manager`/`manager` (`0001:34`); the driver role is synthesised in `queries/identity.ts` by which row matched. **A partner who also drives is already representable** — a membership row plus `driver.linked_user_id` — with no multi-role machinery at all.
3. **One user belongs to at most one business.** `one_active_business_per_user` (`0003`) is a partial unique index on `user_id`, and `resolveMembership` runs one `LIMIT 1` query per request on that assumption.

**Recorded as declined, per this repository's convention:**

- **Multiple roles per user.** The capability lattice is a total order — `OWNERS ⊃ manager`, staff strictly dominates driver — so the union of any two staff roles collapses to the higher one: `{manager, owner}` *is* `owner`. The one non-degenerate pair, staff + driver, is worse than useless: a staff token already reads every driver's data through A5's `GET /api/driver/{id}/view`, so `viewOwnData` is a **restriction, not a grant**, and unioning it in would make W-49's one hard security boundary depend on which roles happen to be attached. Additive later if a real case appears (a `business_member_role` child table seeded from today's column), so waiting costs nothing.
- **A role switcher.** If the selection reaches the server it is a client-supplied privilege claim — the exact bug class CLAUDE.md bans by name for `business_id`. And `audit_log.changed_by` comes from the token's `sub` via `withActor`: either the audit row is identical whichever role was picked, so the switch is cosmetic and must not gate anything, or it differs and **"who did this" becomes something the client asserted.** In a ledger whose whole promise is being believed about money, that is the last field to make ambiguous.
- **A super-admin role.** `owner` already is one. A fourth staff role above owner, in a two-partner business, has one holder and nobody to administer. What is genuinely missing is not a role but **revoke and re-grant**.
- **Collapsing `owner` into `owner_manager`.** Correct in principle — identical capabilities, and the split has already cost one outage — but it changes UI §1.1, W-49 and DM §3's CHECK, so it is its own `doc-change` pass, not something smuggled into A11. **If a switcher is ever genuinely wanted, this is where it lives honestly: one role, two views, never an authorization input.**

#### What building it needed — done, checked off against what actually shipped

**Migration `0010` — four things, one file** (a fourth, `business_member_invite`, was always implied by "Worker" below but is worth listing with its prerequisites):
- ✅ **Replaced `UNIQUE (business_id, user_id)` with a partial unique index `WHERE revoked_at IS NULL`.** **GAP-52** — without it F-1.4's own alternate (revoke, then re-invite the same person) failed on a unique violation. Proven both ways against a real branch: same role and a different role.
- ✅ **`CREATE TRIGGER business_member_audit` explicitly.** **GAP-53** — `write_audit_log()` reads `NEW.business_id` and `NEW.id`, both present, so nothing else changed. Verified rows land in `audit_log` for both an insert and a revoke.
- ✅ **A deferred constraint trigger, INV-31: every business retains at least one active `owner`/`owner_manager`.** **Shipped narrower than first drafted** — `AFTER UPDATE` only, not `AFTER INSERT OR UPDATE` the way `assert_shares_total`'s shape was copied at first. An `INSERT` can only ever add a row, so it can never by itself zero out the active-owner count; every real removal path (`revokeBusinessMember`, and `changeBusinessMemberRole`'s revoke half) is an `UPDATE`. The `INSERT OR UPDATE` draft broke roughly a dozen existing test fixtures that mint a manager as a business's sole member — TRACKER.md §5 carries the general lesson (don't copy a trigger's statement-type list without re-deriving which statements can actually violate the *new* invariant).
- ✅ **`business_member_invite`** — the F-1.4 counterpart to the pre-existing, previously-unused `driver_link_invite`. Same shape: a hashed code, the plaintext returned once.

**No change to the role CHECK** — all three roles were already admitted, which mattered more than planned: see the UC-03 correction below.

**Worker — six endpoints, one new capability:**
- ✅ `manageMembers: OWNERS` — not `managePartnerCapital`. `W-49` gained the member-administration row this needed (`user-flows.md` v1.1.4).
- ✅ `POST /api/business-member/invite` — reissuing invalidates the prior unredeemed code for the same (business, role).
- ✅ `POST /api/business-member/{id}/revoke` — sets `revoked_at`, guarded in the `WHERE` clause, not read-then-write.
- ✅ `POST /api/business-member/{id}/change-role` — revoke-and-grant, two rows, one call. Never an in-place `UPDATE`.
- ✅ `POST /api/invite/redeem` — no capability gate, one mechanism for both `business_member` and `driver_link` destinations, decided by the code alone. Creates `app_user` just-in-time. The role/driver never comes from the request.
- ✅ `POST /api/driver/{id}/link-invite` + `.../unlink` — **`manageEntities`, not `manageMembers`**, corrected before shipping: F-1.8's own actor is "Manager" (the same as F-1.6, add a driver), and neither ever touches `business_member`. The original plan's assumption that this shared F-1.4's gate didn't survive re-reading the flow doc it cited.
- ✅ Both writes open a transaction (`c.get("writer")` is already wrapped in `withActor`, so this fell out of using it rather than needing a separate reminder).
- ✅ Cross-tenant 404, never 403, proven for every endpoint.

**Client** — `FirstRunGate` gained a second action alongside `CreateBusinessForm`: `RedeemInviteForm`, one field (the code), never a role or business picker. Not distinguishing "brand new" from "revoked", as planned. Copy carries no "admin", no "role". **The `["me"]`-on-403 invalidation landed globally**, not per-screen — a `QueryCache.onError` in `main.tsx`, so every mutation gets it for free rather than each one remembering.

**The one open question this pass didn't resolve got resolved in the docs pass that came first:** F-1.8's steps read *"Match by phone number, confirm identity"* against OQ-2's own resolution rejecting phone matching — `user-flows.md` v1.1.4 rewrote F-1.8's steps to the code mechanism before any code was written, so the endpoint was never built against the stale text.

**A third correction, found reading UC-03 itself while writing the migration:** v1.2.3's invite-role list named only "manager, or a second owner-manager" — the plain, passive `owner` role this project's own two-partner example is built around had no invite path at all, the identical shape of bug A0 fixed for the creator. Fixed in `use-cases.md` v1.2.4 and `user-flows.md` v1.1.4 (F-1.4) before the endpoint shipped — `business_member_invite.role` and `business_member.role` both already admitted `owner`, so this cost no schema change, only the flow text and confirming the endpoint's accepted values matched.

**Do the `doc-change` skill's remaining half — data-model.md — before the migration**, since W-57/F-1.4/F-1.8 are now real enough to need the invite-code table in DM §16's own DDL, not just a description here. The full list of documents this owes is in the [A11 checklist](#a11--member-and-driver-access).

### A1 · Done

`GET /api/expense` shipped in `b2cf367` — every filter optional, newest first, voided rows included, `dailyOperations`. `expense.test.ts` at 20/20.

**It has no caller** (GAP-33), and that is deliberate: §3.3's route map has no business-wide costs route, so the plan's `ExpenseListScreen` was withdrawn rather than built. The endpoint keeps real value — report-adjacent, and every other list endpoint here has shipped ahead of its screen at some point. **Do not add a screen for it without a spec change.**

### A2 · Done

Six endpoints, all shipped: `GET /api/business-member` (GAP-31, `dailyOperations`) · `GET /api/ownership-share`/`capital-contribution`/`management-fee-agreement`/`banking-event`/`partner-payout` (`managePartnerCapital`, except banking-event which shares the write's `dailyOperations` gate) · the composed `GET /api/partner/{userId}` (F-7.6/F-7.3), closing GAP-9 and GAP-4 by derivation, never a write. 25 new integration tests (business-member 4, partner +16, partner-summary 5) in two new files; full suite 31/353, all green. TRACKER.md §2 carries the row.

**One design correction worth carrying forward:** `listOwnershipShares` filters `effective_to IS NULL` alone, not a "latest set per vehicle" grouping — `assert_shares_total`'s deferred trigger structurally forbids two open sets ever coexisting for one vehicle, so the simple filter is provably sufficient. A first draft over-built this; TRACKER §5 has the reasoning.

**One new gap, recorded rather than fixed: GAP-39.** `sumVehicleCostsForPeriod` already reads `obligation WHERE kind = 'management_fee'`, but nothing has ever written one — W-53's "management fee reduces vehicle profit" has been silently a no-op since P7. `GET /api/partner/{userId}` works around it correctly (reading `management_fee_agreement` directly), but UC-70's vehicle-profit figure is still wrong wherever a management fee applies. Unowned; needs a generator, not a read-side fix.

### A3 · Done

Four endpoints/changes, all shipped: `GET /api/accounting-period` (list, newest first, `viewReports`) · `GET /api/write-off` (list, every filter optional, `writeOffOrWaiveAboveThreshold` — the same gate as recording one) · **`GET /api/payment`** (GAP-38, `dailyOperations` — the same gate as recording one; carries the W-49 linked-driver 403 class since a payment names the driver it moved against) · the close checklist's **`unconfirmedDays`** row (GAP-13 — one `COUNT(*)` on `day_record.state = 'open'` scoped to the open period, the same scoping `pendingObligations` already used, cheap and exact since P13). No new table, no new write, no domain layer — four straight filtered reads. 13 new integration tests across the three existing files; full suite 31/366, all green. TRACKER.md §2 carries the row.

**Explicitly out of scope, unchanged: GAP-12.** Void-and-replace stays `expense`-only — that is A9's job, not this one's.

### A4 · Done

Two endpoints, both shipped: `GET /api/customer/{id}/obligation` (outstanding dues only, oldest due first — reuses `findOutstandingObligationsForParty` rather than a second party-scoped query, exactly the trap this item was written to avoid, so this screen can never disagree with what `recordPayment` actually allocates against) and `GET /api/customer/{id}/payment` (reuses `listPaymentsForBusiness` scoped by `partyCustomerId`). Both `dailyOperations`, 404 cross-tenant, both proven against the W-49 linked-driver 403 class. No new table, no new write, no domain layer. 8 new integration tests in the existing `customer.test.ts`; full suite 31/374, all green. TRACKER.md §2 carries the row.

**GAP-22 closes on its backend half only.** `/people/customers/:id` itself still renders `NotBuiltYetScreen` — that placeholder is B6's own item, not a backend gap, and B6 is now ready (B0 done).

**One shortcut this item confirmed rather than avoided:** `obligation` carries `party_customer_id` directly (set at insert, even for a rent due whose `source_type` is `billing_period`), so a customer's dues never needed the lease hub's three-way source reassembly — one direct filter was enough, as the plan predicted.

### A5 · Done

One endpoint: `GET /api/driver/{id}/view`, gated `dailyOperations`, returning both balances, days (excused ones included), closed trips and fees, advances, offsets and the held deposit. 4 new integration tests in the existing `driver.test.ts` (10 total). TRACKER.md §2 carries the row.

**The previous edition said the driver's own view "cannot be reused." That was half right, and the half it got wrong saved the work.** What cannot be reused is the *route* — its gate, and `requireDriverId` as the only source of the id. The **domain function** reuses perfectly: `getDriverOwnView(db, businessId, driverId, from, to)` never read the caller's identity, it took a `driverId` argument all along. So A5 is a new route-def, a new handler and a shared wire mapper (`toDriverViewResponse`, lifted out of the driver-view handler) over an unchanged domain function — which is also what guarantees the manager's screen and the driver's own screen can never print different numbers for the same driver.

**INV-25 is untouched, and worth restating because it reads like a contradiction.** INV-25 forbids a caller-supplied `driverId` on *the linked driver's own* route — and that route still has no such slot. This is a different route with a different gate, and the boundary is proven in both directions: a linked-driver token 403s it for **any** id, including their own.

**GAP-29 closed without building `GET /api/advance`.** The composed read already returns the driver's advances, so a separate advance list would have been a second way to reach the same rows with no screen asking for it — the same reasoning that withdrew B1. Revisit only if a screen ever needs advances *without* the rest of a driver's history.

### What the A6–A10 validation pass found — 5 August 2026

Re-validated against the code, not against this file, the same way the A2/A3 pass was. **Three of the four remaining items were wrong in ways that change the work**, one whole item was missing, and the ordering changed as a result.

1. **A6 makes `bookTrip` period-dependent for the first time.** `bookTrip` never calls `resolvePeriodLinkage` today — booking a charter works regardless of whether an accounting period covers the date. Posting an obligation inside that transaction requires `posted_period_id`, so **booking starts being refusable with `PERIOD_CLOSED` where it currently always succeeds.** That is a behaviour change to a shipped endpoint, not an addition, and it needs its own test.
2. **A trip need not have a customer.** `trip.customer_id` is nullable and `BookTripInput.customerId` is optional, but `obligation` has a CHECK forcing exactly one party. A trip fare therefore cannot always be posted — the branch is real and the plan never mentioned it.
3. **A8's "real decision" is already decided, four times over.** Whether a fuel fill writes its own `odometer_reading` row transactionally is settled by precedent: `lease.ts`, `mileage.ts` and `trip.ts` (twice) all insert one inside their own transaction, and **there is no standalone odometer endpoint at all.** A8 follows the convention rather than opening the question.
4. **A8's borne-by lookup already exists.** `resolveBorneByDefault` already calls `findActiveLeaseForVehicle`/`findCurrentDailyLeaseForVehicle`. What is missing is not a lookup but a way for the form to *show* what the server would decide — a preview read, which is why the client currently has to omit `borne_by` entirely rather than display a default it is forbidden to compute.
5. **GAP-35's fix cannot be a straight revert of `0006`, and cannot reference `NEW.voided_at` unguarded.** `assert_period_open()` is one function shared by **19** tables; only **13** of them have a `voided_at` column. A function reading `NEW.voided_at` raises `record "new" has no field` on the other six. The fix is a column-presence-safe test — ✅ shipped as migration `0008`, A9a below.
6. **GAP-23 is not the only silent zero — it is one of three, and the other two are unowned.** GAP-39 (management fee) is marked `—`, and GAP-10 (an incident's customer contribution) is filed under "correct to leave." All three are the same defect: **an amount somebody has agreed to owe never becomes an obligation, so it reads as zero everywhere.** `incident_recovery.obligation_id` even carries the comment `-- customer contributions become receivable`. They are now **A10**, and A6 is the first of the family rather than a one-off.

---

### A9a · Done — closed GAP-35

Migration `0008` is exactly what was sketched above: `0006`'s exception narrowed to exclude the `voided_at` `NULL → NOT NULL` transition, tested via `to_jsonb(OLD/NEW) ->> 'voided_at'` rather than a direct field reference so the six trigger tables with no such column (`payment`, `day_record`, `mileage_assessment`, `payment_correction`, `insurance_claim`, `trip`) stay legal. `voidExpense` gained the same `isPeriodClosedViolation` → `PeriodClosedError` mapping every other write already had — it was the one gap the sketch called out and the only place it could be observed today, since GAP-12/A9b's other twelve void-and-replace paths don't exist yet.

**Its own regression test previously asserted the bug.** `expense.test.ts` had "succeeds even after the expense's own period has closed (migration 0006)" — written correctly against `0006`'s actual behaviour at the time, which is exactly the problem: the behaviour it was pinning was wrong. Inverted to assert 409 `PERIOD_CLOSED`, named for GAP-35/migration `0008` instead.

**Two stale comments corrected in the same commit.** Both `domain/expense.ts`'s and `queries/expense.ts`'s doc comments described voiding-after-close as the intended design ("which is what lets this land even after the expense's own period has closed") — accurate when written, wrong now, and exactly the kind of comment that outlives the code it described if nobody reads it against the fix.

**Verified on a fresh ephemeral Neon branch, not the shared dev one** — created via the Neon MCP tools, migrated from `0001` through `0008`, DM §13 drift check clean, then the full suite: **378/378, one pass, no connection flakiness.** That absence is itself informative: every documented flaky run this project has had was on the long-lived shared branch multiple sessions contend for; a branch nobody else touches had none of that. Also surfaced that TRACKER's `api` integration count had drifted to a stale `388` before this item touched anything — corrected there, not a regression here.

**Done means, all met:** voiding an expense posted into a closed period returns `PERIOD_CLOSED`; voiding one in the open period still works; settling a closed-period obligation with a current-period payment still works (the existing `0006` regression tests, unaffected — they never touch `voided_at`); the golden fixtures still land on 134,000 / 15,000 / 7,500 (their own integration tests are part of the 378, all green).

### A6 · The trip receivable — ✅ Done 6 Aug 2026, closed GAP-23

**The design is settled** (post at booking, `kind: 'trip_fare'`, `source_type: 'trip'`, `source_id: tripId`, `due_on`/`effective_due_on` = the trip's end date, void on cancel). The reasoning is recorded in TRACKER §4 and is not reopened here. What follows is only what validating it against the code changed.

**It is a behaviour change to `bookTrip`, not an addition.** `bookTrip` has never touched `accounting_period` — no `resolvePeriodLinkage`, no `posted_period_id`. An obligation needs one, so **booking a charter becomes refusable with `PERIOD_CLOSED` when no period is open**, exactly as `closeTrip` and `recordPayment` already are. Say so in the route-def's responses and test it; a shipped endpoint quietly gaining a new failure mode is how a screen ends up with an unhandled error path.

**`resolvePeriodLinkage` takes a date, but `postedPeriodId` is always the currently open period** — the date only decides `belongs_to_period_id` (W-35). Pass the **booking date**, not the trip's start or end: booking is the fact being posted. `BookTripInput` has no date field today, so it gains one, supplied by the handler from `businessToday()` (never `new Date()`, never `CURRENT_DATE`).

**Only post the obligation when there is a customer and an amount.** `trip.customer_id` is nullable, `BookTripInput.customerId` is optional, and `obligation`'s CHECK demands exactly one party — so an owner-driven charter with no customer row simply raises no receivable. Mirror `closeTrip`'s own guard on the driver-fee side, which already writes nothing when `driverFeeMinor` is 0:

```ts
if (input.customerId !== undefined && input.agreedAmountMinor > 0n) { … }
```

**The migration widens a CHECK, which the guard treats as destructive.**

- The constraint is **unnamed in `0001`** (`kind text NOT NULL CHECK (kind IN (…))`), so Postgres generated the name. **Look it up on the live branch before writing the migration** (`SELECT conname FROM pg_constraint WHERE conrelid = 'obligation'::regclass AND contype = 'c'`) rather than assuming `obligation_kind_check` — `0006`'s header records that this project confirms against the live branch instead of reading the schema, and that is why it was right.
- `DROP CONSTRAINT` matches the `migration/destructive` guard pattern. It needs an inline `-- allow: widening a CHECK is additive; the old set stays valid` — the exemption is the point, so it shows up in the diff.
- Number it after whatever A9a takes. Forward-only, hand-written, one number per migration.

**On cancel, void the obligation — and mind the idempotent path.** `cancelTrip` returns early when `trip.status === 'cancelled'`; that early return must not re-void. Voiding is an `UPDATE` setting `voided_at`, so **it is subject to A9a's new rule** — cancelling a trip booked in a now-closed month will return `PERIOD_CLOSED`. That is correct (it changes a closed month's receivables) and it is exactly why A9a comes first.

**Done means** — booking a charter for a customer raises a `trip_fare` receivable that `listReceivables` shows and `POST /api/payment` allocates against; cancelling voids it; a charter with no customer raises nothing; income still recognises only at close, off `trip.posted_period_id`, and **G-1 still lands on 134,000**.

**What shipped, and the one place it narrowed the sketch above:** everything here landed as written, except the period requirement is scoped to the `customerId !== undefined && agreedAmountMinor > 0n` guard rather than the top of the transaction — an owner-driven charter with no customer touches no period-scoped table at all (the allocation and day-record pause carry no `posted_period_id`), so it stays bookable with no accounting period open, which this section's "booking a charter becomes refusable" line reads more broadly than the actual behaviour turned out to need. `voidObligationBySource` (`queries/obligation.ts`) is source-scoped rather than `trip`-specific, so A9b's remaining void endpoints can likely reuse it. **The one thing this section didn't anticipate:** fixing it broke two *tests*, not the code under test — `accounting-period.test.ts`'s G-1 fixture and `trip.test.ts`'s §7.1 close test both had an ad-hoc `WHERE source_type = 'trip' AND source_id = tripId` query that implicitly meant "the driver-fee obligation" only because nothing else ever shared that source; `trip_fare` now does, and both queries needed the same `direction`/`kind` scoping `sumVehicleCostsForPeriod` (the real report query) already used. Full account in TRACKER.md (GAP-23); 7 new tests, `trip.test.ts` 26→33, G-1 unmoved at 134,000.

### F1 · The arrangement is validated on neither side — closes GAP-84, goes first

**New 8 August 2026, from the comprehensive QA pass, and it is the only open item that writes a contradiction into the ledger rather than displaying one.**

**Both halves are genuinely absent, which is what makes it more than a route guard.** The client's arrangement gating lives entirely in the menus that *link to* the start flows — `canStartLease` requires `A` ([VehicleCalendarScreen.tsx:166](web/src/features/vehicles/VehicleCalendarScreen.tsx#L166)), `canStartDailyLease` requires `B` or none ([VehicleOverviewScreen.tsx:163](web/src/features/vehicles/VehicleOverviewScreen.tsx#L163)) — and neither `StartLeaseScreen` nor `StartDailyLeaseScreen` reads `vehicle.arrangement` at all, so a direct URL renders the full form. **The Worker does not backstop it either**: `startLeaseHandler` ([handlers/lease.ts:79-80](api/src/handlers/lease.ts#L79-L80)) loads the vehicle **only to prove it belongs to this business** and then discards the row — the same fetch-then-discard shape GAP-59 already names on `expense` — and `startDailyLease` never loads one at all.

**The write that results is completely real**, which is the part that matters: `vehicle_day_allocation` rows, a first `billing_period`, a `deposit`. The vehicle is then occupied by an arrangement the client refuses to manage, because every action that would close, renew or bill it is gated on the arrangement it doesn't have.

**Build both halves, and put the refusal in the Worker first.** A new `VEHICLE_ARRANGEMENT_MISMATCH` in `app-error.ts` mapped to 409, raised by both start handlers after the existing tenancy lookup — reusing the row already fetched, not adding a query. Then a screen-level guard on each: render a plain message with a back action, never the form. **The route itself stays** (deep links are legitimate; what is not legitimate is the form appearing) and the client never pre-checks what the server decides — the same `PERIOD_CLOSED` discipline every other write already follows, surfaced as an ordinary outcome.

**Done means** — a `POST /api/lease` naming an arrangement-C vehicle 409s with a code the client can read, the two screens refuse before rendering, and both are asserted in the direction that fails today. **Paired with A13 (row 17)**: a refusal is only honest once there is a way to change a vehicle's arrangement — **A13 landed 9 August 2026**, so a mismatch's fix now has somewhere to send the user; the client-side copy still says only what went wrong, not what to do about it, which is a small follow-up for whichever B9 sitting next touches this screen's copy.

**Done 8 August 2026, as scoped, with one deliberate asymmetry kept and one sibling found and left unfixed.** `startLeaseHandler` requires `arrangement === "A"` exactly — `null` refused too, since `canStartLease`'s own client check never accepted "no arrangement yet" the way daily lease's does. `startDailyLeaseHandler` requires `"B"` or `null`, matching `canStartDailyLease` verbatim. Both screens' guard fires once `vehicleQuery.data` resolves to a mismatch, rendering `<Screen title onBack><p>…</p></Screen>` in place of the form — no new fetch, since both screens already loaded the vehicle for its registration.

**The fix's real cost turned out to be in the test fixtures, not the handlers.** `TestContext.createVehicle()` has never written an arrangement row — a deliberate simplification recorded in its own doc comment ("P2's own bare factory does not assume any particular test needs one") that was harmless while nothing read the column. Making `startLease` strict meant six of `lease.test.ts`'s `POST /api/lease` call sites would otherwise 409 on the new check before reaching whatever they were actually testing; each gained `await ctx.setVehicleArrangement(vehicleId, "A")`. `dailyLease.test.ts` needed **zero** changes — its lenient "B or none" rule already matched every existing bare-vehicle fixture, which is itself confirmation the asymmetry was the right call rather than an invented one. 3 new integration tests, 4 new web tests; `lease.test.ts` 11/11, `dailyLease.test.ts` 12/12 (one pre-existing test's connection flake on the shared branch, ruled out by an isolated re-run — 3.5s clean), web 8/8 and 6/6, `npm run check` clean throughout.

**Found while fixing it, and deliberately not folded in: `bookTrip` has the identical hole.** `domain/trip.ts:133` writes `arrangement: "C" as const` directly onto `vehicle_day_allocation`, never reading the vehicle's own standing arrangement the way `canBookTrip`'s client gate does. This wasn't in F1's scope as filed — the original QA finding named only the two start screens — and fixing it isn't a mechanical copy of this same patch: unlike a lease or a daily lease, a charter might be legitimately bookable on *any* vehicle regardless of standing arrangement (an opportunistic one-off hire), which is a `use-cases.md` question this pass didn't answer. Recorded as **GAP-87**, correctly unscheduled rather than silently expanded into.

**✅ Closed 9 Aug 2026, same day as A10b/D-9.** The `use-cases.md` question turned out to already be answered, just not enforced server-side: `VehicleCalendarScreen.tsx`'s own `canBookTrip` gate (`arrangement === "B" || arrangement === "C"`) had encoded "no, a charter is not bookable on any vehicle regardless of standing arrangement" since before this row was filed — the client already refused it, the server just didn't. `bookTripHandler` now enforces the identical rule, unlike the lease/daily-lease pair `null` is refused here too (a car with no standing arrangement yet is not charter-eligible). The test cost was the real work: **35 `ctx.createVehicle()` call sites across `trip.test.ts`, `vehicle.test.ts`, `accounting-period.test.ts` and `post-closure-charge.test.ts`** had never set a standing arrangement, all needing `await ctx.setVehicleArrangement(vehicleId, "C")` (or `"B"` where a trip runs alongside an active daily lease on the same vehicle). Done by a subagent given explicit scope and a self-verification loop, then independently re-run end to end before being trusted — all four files green (94/94 across the batch), G-1's 134,000 untouched.

### A10a / A10b · The other two silent zeros — closes GAP-39 and, now, GAP-10

**Split 8 August 2026.** One of these is a build and the other is a question; they were filed as one item because they fail identically from the outside, and that is exactly what hid the difference.


**New item, and it exists because A6 turned out to have siblings.** Three places in this system take an amount somebody has agreed to owe and never turn it into an obligation. A6 fixes the first. These are the other two, and they fail the same way: a real receivable reads as zero, in a report, forever, with nothing on screen to suggest anything is missing.

**GAP-39 — the management fee that has never reduced anything.** `sumVehicleCostsForPeriod` reads `obligation WHERE kind = 'management_fee'`. The enum value exists; the query is written; **nothing has ever inserted one.** W-53's "a management fee reduces that vehicle's profit" has been a no-op since P7, so every managed vehicle's profit has been overstated by exactly the fee. Needs a **generator**, not a read-side fix — the same shape as `generate-billing-periods`, turning a live `management_fee_agreement` into one obligation per period. Decide deliberately whether it runs on the existing billing-period cron or at period close, and record which; A2's `GET /api/partner/{userId}` reads `monthly_amount_minor` directly and must keep agreeing with whatever this writes.

**GAP-10 — the incident contribution nobody can pay. Re-validated 8 August 2026, and this half does not start where the paragraph below assumed.** `recordCustomerContribution` inserts an `incident_recovery` row with `source: 'customer'` and an `agreedAmountMinor`, and leaves `obligation_id` NULL. The customer has agreed to pay toward the damage and it appears in no receivable, no ageing bucket, and no payment allocation — **so there is nothing for `POST /api/payment` to allocate against, and the customer cannot pay it through the product at all.** `0001` documents the opposite intent on the column itself — `obligation_id uuid, -- customer contributions become receivable`.

**But the code is not ignoring that comment; it is following a different document.** [domain/incident.ts:203-212](api/src/domain/incident.ts#L203-L212) records the NULL as deliberate and cites F-3.4, and F-3.4's **Writes** line ([user-flows.md:540](docs/product/user-flows.md#L540)) really does name `Incident`, `IncidentCost[]`, `IncidentRecovery[]`, `RentTreatment`, `InsuranceClaim?` and `LeaseExtension` — **and no obligation.** F-3.4's Accept criteria are satisfiable without one (`60,000 pending recovery` visible across July and August, pending recovery never entering profit — both computable from `incident_recovery` alone), which is exactly why **G-2 reproduces at 15,000 with the receivable missing** and why nobody caught this from the fixtures.

**So this is a `doc-change` before it is a build**, the same standing as GAP-70 and GAP-71: the question is whether an agreed contribution is a receivable the customer can pay against, or a recovery tracked only on the incident, and `user-flows.md` is where that gets answered. **Do not post the obligation until F-3.4 says to** — the schema comment is not a specification, and this repository does not let a build settle a documents-disagree question as a side effect. Once decided that way, the build is small: post in the same transaction (`kind: 'customer_contribution'` already exists in the CHECK, no migration), set `obligation_id`, and mind that `incident_recovery` separates `posted_period_id` from `received_period_id` deliberately — agreeing and receiving are different months and §7.2 reports both.

**✅ Decided and built 9 Aug 2026, same day.** `user-flows.md` v1.1.5 answered it: agreeing a customer contribution opens an obligation, an insurer's never does (an insurer is never a `POST /api/payment` party). The build was almost exactly as small as predicted above, plus one thing the prediction missed: migration `0012` had to give `incident_recovery.obligation_id` a real FK (it had none since `0001` — a bare `uuid`, not `REFERENCES obligation(id)`), and `recordRecoveryReceived` needed extending, not just `recordCustomerContribution` — without also settling the new obligation when a recovery is marked received, the obligation would have sat "pending" forever after the money actually arrived, a second fact about the same payment silently disagreeing with the first. Now it settles the obligation and posts a real `payment`/`payment_allocation` pair in the same transaction, which is also why this endpoint can newly return `PERIOD_CLOSED` (a real money-table write now happens there) where it never could before.

**Trap shared by both, and by A6:** these each add a place a void can now happen against a closed period, which is why all three sit behind A9a.

**Done means** — **A10a:** a managed vehicle's profit drops by its management fee in UC-70, and `GET /api/partner/{userId}`'s directly-read `monthly_amount_minor` still agrees with what the generator writes. **✅ A10b:** F-3.4 said which way it goes, and an agreed customer contribution now shows up as a receivable a payment can settle. **Both:** G-2 still lands on 15,000.

### A7 · R2 upload (expense receipts only) — closes GAP-16 for one call site, independent of everything else

**Built and verified, on `feature/image-upload` — updated 10 Aug 2026.** [ATTACHMENT-UPLOAD-IMPLEMENTATION-PLAN-2026-08-09.md](ATTACHMENT-UPLOAD-IMPLEMENTATION-PLAN-2026-08-09.md)
is the implementation plan; every decision below is recorded there in full, and this section is a summary of
it. Built as its own seven-commit sequence exactly as sequenced there: schema, contract, server, server tests,
the `PhotoCapture` fix, client upload infrastructure, then the receipt surface — GAP-16 stays open in
`TRACKER.md` until a real PR merges, since neither the API accepting uploads nor a clean diff was ever the bar.
**The 26-case integration suite ran for real this session** (the branch's own `ATTACHMENT-UPLOAD-PENDING-2026-08-10.md`
correctly flagged it as never having run — no `TEST_DATABASE_URL` in the authoring session) and found two real
bugs, neither in the attachment feature's own logic: migration `0013` had never been applied to the test
database, and `TestContext.createBusiness()` had no cleanup for `attachment` rows, breaking teardown via the
FK. Both fixed; **26/26 green**, including the concurrency and row/object-corruption cases. The full suite
then confirmed the golden fixtures unmoved (134,000/15,000/7,500) and nothing else regressed (the 9 unrelated
failures were the documented Neon-contention flake, confirmed by a different subset failing on retry).
`wrangler.jsonc`'s placeholder bucket name is renamed. **What's still open**: manual QA on a real viewport, and
the PR — #18 was opened, then closed by the owner without merging; a fresh one is pending.

**Narrower than the row above once implied.** `attachment` (DM §12) is already generic and polymorphic, and
one endpoint's *design* unblocks all five recorded gaps eventually — but this item builds and ships **exactly
one** call site, expense receipts, not all five at once. Condition photos (lease start/close), incident damage
photos and the handover/return comparison stay unbuilt, on purpose: four of the five call sites only learn
their `subject_id` after the record saves, and the lease wizard's post-save ordering is the risky part of
that, deliberately left for a second branch. `PhotoCapture` + the tested `photo-pipeline.ts` are built with
**0 real callers** today; this item gives them their first one, plus a small **receipt-viewing surface** on
`ExpenseCostRow` — GAP-16 does not honestly close for expenses until a user can see what they uploaded, not
only until the API can accept it.

**Decided, not merely proposed: upload through the Worker binding (`env.R2.put()`), presign nothing, in
either direction.** IG §10 requires objects be *served* through presigned expiring URLs; the plan amends that
line instead — reads go through the Worker too, re-authorised on every request, which serves W-49's own reason
better than a URL that outlives its own check. Presigned PUT was rejected on four counts (routine orphans, a
bearer capability replacing a per-request check, two new secrets with no rotation story, and a stated client
invariant against any direct fetch) — full argument in the plan's Decisions §1–2.

**The bucket exists now.** `api/wrangler.jsonc` carries the real `fleetsettle-attachments` / `-qa` buckets;
that dependency has landed.

**What the deep review changed, in one line each** (full account in the plan's own revision log): migration
number is `0013`, not `0012` (`0012` was taken in the meantime); the idempotent-retry compensation logic was
rewritten to close an orphan-object race the first draft still allowed; the migration now also constrains
`content_type` and the `kind`/`subject_type` pair, and adds a tenant-scoped live-subject index; a linked
driver gets 403 on both upload and read this branch, not a subject-specific 404, because drivers get no
attachment read path at all yet; and a receipt-viewing surface is now part of this item's own scope rather
than assumed to exist already.

**Traps, built against and confirmed, not merely watched for:**
- **`business_id` on the `attachment` row comes from the token**, re-checked on every read via the same
  subject-ownership lookup the write path uses. The `r2_key` is an opaque `crypto.randomUUID()`, unrelated to
  the attachment id (UUIDv7, partly predictable).
- **A void marks the row; the object stays** — no hard delete. Migration `0013`'s void trio plus its
  void-consistency `CHECK` are live and verified against real Postgres; `voidAttachmentHandler` mirrors
  `voidExpenseHandler` exactly.
- **The idempotency race is covered by its own test, and it passes**: two requests carrying the same
  client-minted id, fired without awaiting either, resolve to exactly one row and one R2 object.
- **GAP-17 stays open** — the pipeline still runs on the main thread with no Web Worker or 3s timeout.
  Unchanged by this item; `TRACKER.md`'s own GAP-16 row says so explicitly, so it can't be read as closed by
  association.

**Done means** — a fuel fill recorded with two receipt photos closes its sheet before either finishes
uploading; reopening it via `ExpenseCostRow`'s new receipt indicator shows both, fetched as blobs through the
Worker; a linked-driver token gets 403 on both upload and read of any attachment (decision 4 — this branch
gives drivers no attachment read path at all); voiding one leaves it 404 on read, its R2 object untouched.

**Verification, both halves now proven.** The client half: `npm run typecheck`, `npm run lint` and the full
`web` test suite green, including the sheet/uploader/receipt-surface tests. **The server half, run for the
first time this session**: `api/tests/integration/attachment.test.ts`'s 26 cases (standard matrix, idempotent
replay, concurrent-same-id race, row/object corruption, linked-driver class) — 26/26, after fixing the
migration-not-applied and cleanup-FK bugs described above. The full integration suite then confirmed the
golden fixtures unmoved and nothing else regressed. `wrangler.jsonc`'s placeholder bucket name is renamed.
**What remains**: manual QA on a real 360×640 viewport, and a PR (#18 opened then closed without merging by
the owner; a fresh one is pending). **One thing flagged as genuinely undecided, not merely unbuilt**: no
document states how long an `attachment` row or its R2 object should live — worth its own gap before anyone
builds a purge job on the strength of an assumption.

### A8 · Expense odometer wiring and the borne-by preview — independent

Two small gaps Web-P8b surfaced and recorded rather than guessed at. **Neither blocks anything**, both make a shipped form more complete, and validation shrank both.

**GAP-30 — wire `expense.odometer_reading_id`.** A DB column since P3, never referenced by any schema, query or domain function. The plan called "does a fuel fill create its own `odometer_reading` row transactionally?" the real decision; **the codebase has answered it four times** — `lease.ts`, `mileage.ts` and `trip.ts` (opening and closing) each insert one inside their own transaction, and no standalone odometer endpoint exists at all. Follow the convention: `createExpense` inserts the reading and the expense in one transaction and links them. Its doc comment currently says "a single insert" — update it, since that stops being true. Note the `0005` unique index is partial (`WHERE lease_id IS NOT NULL`), so a fuel-fill reading carries no one-per-day constraint; two fills in a day are two readings, which is correct.

**GAP-32 — a borne-by *preview*, not a second lookup.** The lookup already exists: `resolveBorneByDefault` calls `findActiveLeaseForVehicle` and `findCurrentDailyLeaseForVehicle` today. What the form cannot do is **show** the user what the server will decide, because the client is forbidden from computing §6.7's matrix itself — which is why it omits `borne_by` unless overriding to "Us". One small read (`GET /api/expense/borne-by-preview?vehicleId=&category=`, or the same shape folded onto the vehicle read) returns the resolved default and the party's name, and the form can then display it and offer a real override. **Do not copy the matrix into the client** — Web-P8b's trap list forbids exactly that, and it is the reason this gap exists rather than having been quietly closed.

### A9b · The rest of soft delete — closes GAP-12 and GAP-36

**With A9a's hole fixed, this is ordinary breadth-first work:** ~15 endpoints and one migration. **Nothing in this system is ever hard-deleted, and that must not change** — but a record created by mistake (a test expense, a duplicate driver, a vehicle typed twice) currently has no way out of most tables.

**The rule, stated once:** soft delete only. A money record is **voided** (`voided_at`/`voided_reason`/`voided_by`, with a reason always required — W-50). An entity is **archived** (hidden from pickers and lists, still resolvable by id so historical records that reference it keep rendering). `audit_log` stays undeletable by its own `DO INSTEAD NOTHING` rule, and `accounting_period` is not soft-deletable at all — closing is a structural transition, not a record.

**Where things actually stand, verified table by table:**

| Layer | Mechanism | State |
|---|---|---|
| 13 money tables | the `voided_*` trio | structural on all 13; only `expense` has a domain function and endpoint (GAP-12) |
| the other 6 period-guarded tables | — | `payment`, `day_record`, `mileage_assessment`, `payment_correction`, `insurance_claim`, `trip` have **no `voided_at`**; `payment`'s undo is `POST /api/payment/{id}/correct` (P9) and `trip`/`lease`/`incident` use `status` transitions. Not gaps — do not add the column |
| `mileage_package` | `archived_at` + endpoint | built — the reference implementation for an entity |
| `business_member` | `revoked_at` | built |
| `vehicle` | `lifecycle` column exists | **no endpoint ever sets it** — hardcoded `"active"` at creation, read-only thereafter |
| `driver`, `customer` | — | **no column at all** (GAP-36); a test row is permanent |
| `attachment` | — | no column either, and **not covered by this item** — see A7 |
| `audit_log` | `DO INSTEAD NOTHING` | correct as-is; never make this deletable |

**In order:**
1. **`archived_at` on `driver` and `customer`** (GAP-36), plus archive/unarchive endpoints. `mileage_package`'s "archive, never delete" is the pattern — copy it rather than inventing a second one.
2. **A `POST /api/vehicle/{id}/archive`** driving the `lifecycle` column that has existed since `0001` and never moved.
3. **Void endpoints for the remaining twelve money tables** (GAP-12), each mirroring `voidExpense`'s proven shape: find-scoped-to-business → 404, already-voided → its own error, then a `writer.transaction` (never a bare update, or `changed_by` records `NULL`).

**Traps:**
- **A void is a money write.** It must open a transaction even though nothing needs atomicity, or `withActor` cannot attribute it (TRACKER.md §5).
- **Voiding a parent does not void its children.** Voiding a `payment` leaves its `payment_allocation` rows, and the obligations they settled, exactly as they were — cascading is a second rule that will diverge from the first. Decide per table whether the domain function unwinds, and record the decision; `correctPayment` (P9) already solved this shape for payments and should be reused rather than duplicated.
- **A voided row stays visible, struck through, with its reason** (W-50) — `VehicleOverviewScreen`'s costs section and the vehicle/trip/incident expense lists already do exactly this. Reuse the treatment.
- **An archived entity must still resolve by id.** A voided expense that references an archived driver has to keep rendering his name; archiving hides him from pickers, it does not orphan history.
- **Never offer this as "Delete."** U-6's reserved vocabulary applies — the interface says "Void" for a money record and "Archive" for an entity, and says which one it means.

**Done means** — a test expense, driver, customer and vehicle each created by mistake can all be reversed out of every list they appear in, none of them leaves the database, a void into a closed period is refused by the trigger, and every one of those reversals names who did it in `audit_log`.

**Track B's half** is small and can follow whenever: a void/archive action on the existing detail screens, using the struck-through treatment that already exists. Not a separate B item — it belongs to whichever screen owns the record.

---

## Track B — the React client

| id | Item | Needs | Status |
|---|---|---|---|
| **B0** | ✅ **The `/more` hub** (GAP-37, GAP-40) | — | done 5 Aug 2026 |
| ~~**B11**~~ | **Structural render fixes** — live-tested 6 Aug, GAP-49/50 | — | ✅ **done 7 Aug 2026** — both closed, plus `color-scheme`, focus restore, and A0's broken typecheck |
| ~~**B10**~~ | **Set up the daily lease (F-1.7)** — GAP-51 | — | ✅ **done 7 Aug 2026** — arrangement B can be started at last; live confirmation pending the `develop` merge |
| ~~**B14**~~ | **Fix the trip receivable's wrong field** — GAP-75 | — | ✅ **done 8 Aug 2026** |
| ~~**B0b**~~ | **The three shells and the capability gate** | — | ✅ **done 8 Aug 2026** — Review/Mine still render placeholders inside the real shells; B4/B5 fill them in |
| ~~**B12**~~ | **Opening balances (F-0.2)** — GAP-61 | — | ✅ **done 8 Aug 2026** |
| ~~**B13**~~ | **Driver money actions — pay, advance, deposit** — GAP-63/64/66 | — | ✅ **done 8 Aug 2026** — needed a backend fix (`recordPayment`'s missing `direction`), not just a screen |
| **B3** | Close the month, corrections | — | ✅ **core done 8 Aug 2026** — `WriteOffSheet`/`PostClosureChargeSheet` deferred, see the "one queue" table's 10a |
| **B4** | Review shell + phase-1 reports | — | the largest item left; scope settled 8 Aug, B0b's shell now exists to build into |
| **B5** | Mine shell | — | ▶ ready now — B0b's shell exists to build into |
| **B6** | Customer detail | — (A4 ✅, B0 ✅) | ▶ ready now, no B0b needed |
| **B2** | Partners, banking, cash | — (A2 ✅, B0 ✅) | ▶ ready now, no B0b needed |
| **B9** | `UI-UX-REVIEW.md` fixes, GAP-44–48 + GAP-55 (GAP-49/50 moved to B11), + GAP-76/78/79/80/81 (8 Aug, live QA browser pass) | — | ▶ ready now, no B0b needed |
| **B7** | Offline and the PWA | **nothing** | ▶ startable, sequence last |
| **B8** | ✅ Real Asgardeo | — | done 5 Aug 2026 |
| ~~B1~~ | ~~`ExpenseListScreen`~~ | — | **withdrawn** — see below |

### What the Track B validation pass found — 6 August 2026

Read screen by screen and route-def by route-def against `web/src/` and `api/src/route-defs/`, the same kind of pass that preceded A2/A3 and A6–A10. **The headline finding is structural and it is the same shape as GAP-37**: three items depend on plumbing that does not exist and none of them owns it.

1. **There is no way to render anything but the Operate shell.** `RootLayout` (`router.tsx`) hardcodes `shell="operate"`, and `FirstRunGate` takes exactly one render prop, `renderOperate` — `owner` and `driver` both fall through to `NotBuiltYetScreen` with no branch to fill. `AppShell` itself is ready (`shell="review"` renders `REVIEW_TABS`, `shell="mine"` renders no tab bar, both tested), but nothing can reach either. **B4 and B5 are each blocked on the same missing branch**, and the Review shell additionally needs its four tabs wired to routes that do not exist yet.
2. **The role is not available anywhere outside `FirstRunGate`'s own local query.** `MeResponse` is a local interface in that file (documented as the one deliberate exception to the shared-schema rule). B3's close action must be **absent for a `manager`** (M-22/W-49) and B4's catalogue must not offer a card the role cannot fetch — neither can be built without reading the role somewhere else.
3. **`lib/capabilities.ts` and `<Can>` do not exist**, though UI §12.4 specifies both concretely, down to the signature. B3 and B4 are their first two callers. This is the third leg of the same prerequisite.
4. **§7.8's "Overheads (no vehicle)" block cannot be built from any endpoint that exists.** `GET /api/reports/vehicle-month` returns `{ period, vehicles[] }` — per-vehicle only, no overheads row. `GET /api/expense`'s `vehicleId` filter is *optional-means-unfiltered* (`filters.vehicleId !== undefined ? eq(…) : undefined`, `queries/expense.ts`), so there is no way to ask it for "expenses with **no** vehicle" — omitting the filter returns every expense including the vehicle-attributed ones. W-32 makes this block load-bearing (overheads are never spread across vehicles), so it is not droppable. **New gap, GAP-41**, and it needs a small Track A increment, not a client workaround — summing a full expense list client-side to derive a report figure is aggregation outside SQL.
5. **The chart palette in UI §11.2 is eight raw hex pairs, and raw hex is forbidden.** CLAUDE.md is unambiguous ("No raw hex anywhere… colour comes from `--color-*` tokens"), and §11.2's values are validated for CVD contrast against this project's own surfaces, so they are correct values in a form the rules refuse. They become `--color-chart-1…8` tokens in `tokens.css` with both light and dark values, **and each one must also be added to `cn.ts`** or tailwind-merge silently drops it. Not a gap — a conversion step B4 must not skip.
6. **`GET /api/audit-log/{tableName}/{recordId}` is per-record, not a feed.** B3's line "`Timeline` finally wired to real `audit_log` data" is buildable for *one record's* history (a corrected payment's trail, which is what F-8.6/UC-97 actually asks for) but not for a "what happened this month" list on the close screen. Wire it to the record, not the month.
7. **Two of the nine reports are owner-only and three need parameters the catalogue must collect before it can fetch.** Detail in B4 below — this is the one place where "nine tested endpoints, no interface" understates the work, because a catalogue of nine links is not sufficient for four of them.

### B11 · Done — structural render fixes, and two bugs that were not what they looked like

**✅ Done 7 August 2026.** Both closed, and both turned out to be one layer deeper than the write-up below said — the original text is kept as-is underneath, because the difference between what a live session *observes* and what is actually *causing it* is the point.

**What actually shipped:**
- **GAP-49** — a `@layer base` block in `tokens.css` paints `--color-page` and `--color-ink-primary` on `html` itself. `AppShell`'s own `bg-page` is now redundant and was left alone. It also surfaced that **`color-scheme` was declared nowhere in the client**, so the UA canvas, scrollbars and native controls stayed light under a dark theme — the same bug one layer down, fixed in the same block, with the two-selector shape that lets the in-app toggle beat OS dark. Verified in a real browser both ways: dark `#0d0d0c`/`#f5f5f0`, light `#f1f1ec`/`#14140f`. `tokens.test.ts` asserts the rule stays.
- **GAP-50** — **the violation fires on open, not close.** `vaul` ships `autoFocus: false` and preventDefaults Radix's open-auto-focus (so a drawer does not summon a phone keyboard), which leaves focus on the trigger — inside the background Radix has just marked `aria-hidden`. `autoFocus` on `Drawer.Root` closes it. Testing that then exposed **a second bug nobody had reported: focus restore had never worked at all.** Radix's modal `DialogContent` always redirects close-focus to its own `triggerRef`, set only by a `Dialog.Trigger`; every sheet here is driven by an external button, so closing one dropped a keyboard user at `<body>`. Fixed with an `onCloseAutoFocus` restoring to the opener, tracked via a `focusin` listener because React runs a child's effects before its parent's. `ActionSheet` is built on `Sheet`, so the nested case came free.
- **Three tests in `e2e/sheet-a11y.spec.ts`, each verified to fail without the fix.** The first version of that spec was a **false green** — headless Chromium computes the a11y tree lazily, so without `Accessibility.enable` over CDP the warning is never emitted and the assertion has nothing to see. TRACKER §5 carries this as a standing trap; it is the kind of test failure that hides in the passing direction.
- **Not in scope, fixed in passing: `npm run typecheck` had been broken since A0.** `NewBusinessMember.role` was typed as the literal `"owner"`, so A0's one-word change did not compile. Now `BusinessMemberRole` from `packages/shared`.

---

**Two bugs, found the same way, twenty minutes apart, on 6 August: driving a real browser against `qa.fleetsettle.com` instead of reasoning from source or mocks.** Both are already shipped and already broken; neither needs anything else to land first.

**GAP-49 — `AuthGate` and `FirstRunGate`'s fallback screens render with no page background anywhere in their DOM.** Confirmed by walking computed styles from `<h1>` to `<html>`: every ancestor is `background-color: rgba(0,0,0,0)`. `Screen.tsx` sets no background of its own — only `AppShell.tsx`'s root div carries `bg-page` — and `AuthGate`'s loading/sign-in states plus `NotBuiltYetScreen` (`FirstRunGate`'s `owner`/`driver` fallback) all render `Screen` directly, never nested in `AppShell`. Invisible by coincidence in light mode; in dark mode `--color-ink-primary` (`#f5f5f0`) renders straight onto the browser's default white canvas — the sign-in screen's own heading and body text are functionally illegible. **Fix structurally, not per call site** — this project's own established pattern (TRACKER §5's three form bug classes: fixed once each, not per-form). A baseline rule on `html`/`body` (or on whatever wraps the router at its very root) setting `background: var(--color-page)` closes the whole defect class, including any future screen that forgets to nest in `AppShell` the same way these two did. Verify both colour schemes after.

**GAP-50 — closing a `Sheet` can leave `aria-hidden` on an ancestor of a still-focused element.** Reproduced twice live: closing "Add a vehicle" (single sheet) and closing "Add a driver" from within the "Add" chooser (nested sheet, the second case naming a Radix-generated dialog-content div as the offending ancestor). `Sheet.tsx` is built on `vaul`'s `Drawer`, credited in its own doc comment for "focus trap, `aria-modal` and focus restore" — this is that mechanism's inert/`aria-hidden` background technique racing focus return, worse when sheets stack. **This supersedes B9's own "low confidence" nested-`Sheet`/`AmountPad` note** (below) — it is not one nested interaction, it is the primitive itself. Needs investigating `Sheet.tsx`'s close sequencing (does `aria-hidden` get applied before or after focus is confirmed to have left the subtree) rather than a per-screen workaround, since every sheet in the product shares this one component.

**Traps:**
- **Don't patch this per screen.** Both bugs are one-line-of-cause, many-screens-of-symptom — `NotBuiltYetScreen`/`AuthGate` today, any future screen built outside `AppShell` tomorrow for GAP-49; every `Sheet` caller for GAP-50. Fix where the cause is.
- **Re-verify GAP-49 in both colour schemes** — the bug is invisible in light mode by coincidence, so a light-mode-only check will pass and ship it again.
- **GAP-50's fix should be verified against a stacked-sheet close specifically**, not just a single sheet — that's the case that named the Radix content div rather than a plain button, suggesting the depth of nesting matters to when the warning fires.

**Done means** — the sign-in screen and both `NotBuiltYetScreen` placeholders are legible in a dark-mode browser; closing any single or nested sheet produces no `aria-hidden`/focus console warning.

### B10 · Done — set up the daily lease (F-1.7)

**✅ Done 7 August 2026, closing GAP-51.** `StartDailyLeaseScreen.tsx` + a `/vehicles/$vehicleId/daily-lease/new` route + a "Start a daily lease" row in the vehicle-actions menu, offered for arrangement B or no active arrangement and hidden for A and C. Built to F-1.7's four steps with **no vehicle field** — the flow is entered from a vehicle, so `vehicleId` comes from the route exactly as `StartLeaseScreen` takes it. The amount starts empty and is **never pre-filled from `driverDayFeeMinor`**, for the reason recorded at length below. 409 `DAILY_LEASE_OVERLAPS` surfaces as an ordinary outcome. 4 unit tests, 5 gating tests, and a full-flow e2e in a real Chromium at 360×640 and 320px.

**One checklist item is deliberately still open: the live-environment confirmation.** Creating a daily lease and watching `generate-day-cards` produce a real day-record placeholder, confirmable through F-4.2, is the check **GAP-3's own fix has been waiting on** — and it needs `build/p0-foundation` merged to `develop` first, which is queue item 4 and a deploy decision rather than a build step.

---

**The backend has been ready since P2/P5 and nothing has ever called it.** `api/src/route-defs/dailyLease.ts`'s own doc comment names the flow outright — *"F-1.7 / UC-05 — starting arrangement B"* — and `startDailyLeaseRequestSchema` (`packages/shared/src/schemas/arrangement.ts:46-56`) is a complete, validated shape: `vehicleId`, `driverId`, `patternType` (`every_day` / `alternate` / `weekdays`), `patternWeekdays` (required exactly when `patternType` is `weekdays`), `effectiveFrom`, `effectiveTo` (optional), `dailyLeaseAmountMinor`. `POST /api/daily-lease` returns 201 with the lease and its first rate, 404 for a vehicle/driver outside the business, 409 for an overlapping daily lease on the same vehicle (`DM §7`'s exclusion constraint — catch it, don't pre-check).

**Confirmed missing three independent ways, live on 6 August**, so this isn't a guess about where the gap is: the vehicle-actions menu offers only View calendar / Record expense / Report incident; the calendar's free-day tap-through is correctly scoped to F-2.1/F-5.1 only (arrangement A/C — F-1.5's own spec says exactly this, so the calendar was never supposed to host F-1.7 and isn't a candidate fix location); "Add a driver"'s only level-2 section is "Fees and mobile" (day/trip fee defaults for prefill, not an assignment). `docs/design/ui-ux-guidelines.md` has zero mentions of F-1.7 — it was never wireframed, which is almost certainly why it was never built; there's nothing in §7's screen-by-screen inventory to build against.

**No wireframe exists in §7, but F-1.7 itself specifies the steps and they are fewer than a first read suggests — four, not five, and *no vehicle step at all*:**

> **Steps** 1. Driver. 2. Pattern (every day / alternate / chosen weekdays), with individual days skippable. 3. Amount owed per operating day. 4. Effective date, optional end date. — `user-flows.md` F-1.7

1. **Driver** — `EntityPicker` over `GET /api/driver`, already in the inventory and already used by `StartLeaseScreen` for customers.
2. **Pattern** — `every_day` / `alternate` / `weekdays` as `aria-pressed` chips (`chipClass`, the pattern `StartLeaseScreen` uses for term and mileage), the last revealing a weekday multi-select (`patternWeekdays`) exactly when chosen.
3. **Daily lease amount** (`dailyLeaseAmountMinor`) — a `MoneyField`, **with no prefill** (see below).
4. **Effective date**, optional end date — `DateField`s, `effectiveFrom` defaulting to today.

**The vehicle is context, not a field** — F-1.7 has no vehicle step because the flow is entered *from a vehicle*, exactly as F-2.1 is. `StartLeaseScreen` already models this precisely: `vehicleId` is a prop from the route, never a picker. Mirror it (`/vehicles/$vehicleId/daily-lease/new`) rather than inventing a picker the spec does not ask for and the entry point makes redundant.

**U-2 applies as always**, and with only four steps the split is nearly forced: driver, pattern and amount are level 1; an effective date defaulting to today with the end date behind a `More` disclosure matches how `StartLeaseScreen` already splits this exact kind of field list.

**One copy decision to make deliberately, not by default.** F-1.7's own step 3 reads "Amount owed per operating day", but §9.6's vocabulary lock reserves **"Daily lease amount"** for this exact figure ("Never say: rate, daily rate") and says the UI uses the reserved words "and only them". The two do not conflict — one is the flow doc describing a step, the other is the on-screen label — but the label should be **"Daily lease amount"** and the descriptive phrase, if wanted, belongs in helper text beneath it.

**And a correction this plan's previous edition got wrong, which is worth stating plainly because it is the exact bug the vocabulary rule exists to prevent.** That edition said the amount should be "prefilled from the driver's own default per-day rate if F-1.6 set one (U-3)". **It must not be.** The field F-1.6 writes is `driverDayFeeMinor` (`packages/shared/src/schemas/driver.ts:23`) — the **driver day fee**, money *you pay him* on a charter. `dailyLeaseAmountMinor` is money *he pays you*. They are the two opposite directions CLAUDE.md names outright as the pair that must never both shorten to "rate", and prefilling one from the other would seed a plausible, wrong, unnoticed figure into every daily lease created — a number that is wrong in the direction that costs money and that nothing downstream would flag. **The driver record carries no default for the daily lease amount and should not be made to; this field starts empty.** If a prefill is wanted later, the only defensible source is the same vehicle's previous daily lease, not anything on the driver.

**Traps:**
- **GAP-20 is already-recorded, correct-to-leave, and this item doesn't need to fix it**: `isPatternDay`'s "alternate" reference point is a judgment call, and F-1.7's own "individual days skippable" has no column to hold an exception yet. Build against `patternType`/`patternWeekdays` as specified; don't invent a skip-days field the schema doesn't have.
- **A 409 on overlap is expected, not exceptional** — a vehicle already mid-daily-lease refuses a second one over the same dates. Surface it, don't pre-check by fetching the vehicle's existing leases client-side first.
- **This is the create half only.** GAP-25 (nothing ever ends a daily lease) is the close half, already recorded, unowned, and explicitly out of scope here — don't scope-creep this item into building that too.
- **Where this screen is entered from is itself a decision** — a vehicle's own "Vehicle actions" menu (alongside View calendar / Record expense / Report incident, where this session went looking for it and found nothing) is the most discoverable candidate, but confirm against whatever a design pass produces rather than assuming.

**Done means — F-1.7's own three Accept criteria, which are all testable:** cards generate from the effective date forward **on pattern days only** (§4.2 — days outside the pattern are `not_scheduled`, generating no card and counting as neither operated nor lost, `user-flows.md:260`); borne-by defaults come from W-7 with no per-vehicle configuration; **setting an end date stops generation without deleting past cards.** Practically: a manager opens a vehicle, starts a daily lease, and from that point forward `generate-day-cards` produces real day-record placeholders for it, confirmable through F-4.2 exactly as GAP-3's fix expects. **This is also the item that unblocks verifying GAP-3 against a live environment** — which this session set out to do and could not, because no daily lease could be created to test it with.

### B14 · Done — fix the trip receivable's wrong field, GAP-75

**✅ Done 8 Aug 2026.** Fixed exactly as scoped below: `receivableRow` now renders `amountMinor`. Both tests that had pinned the bug (asserting `/Due.*Rs 0/` as correct) inverted to assert the real figure (`/Due.*Rs 60,000/` in the fixture's own numbers) — the same "regression test pins the bug" shape this repo has hit twice before. `commit 853c916`.

---

**Found by the live QA browser pass, not by any source read.** [TripDetailScreen.tsx:132-138](web/src/features/trips/TripDetailScreen.tsx#L132-L138) renders `Money value={parse(receivable.settledMinor)}` next to the obligation's status label. `settledMinor` is the amount **collected so far** — for a `pending` receivable that is `0` by construction, so every unpaid trip with a real customer and a real agreed amount shows "Due · Rs 0", indistinguishable from nothing being owed at all.

**The fix is one field, and the correct pattern already ships elsewhere in the same codebase.** [LeaseHubScreen.tsx:247](web/src/features/leases/LeaseHubScreen.tsx#L247) renders `due.amountMinor` for the identical `leaseObligationRowSchema` shape — the full agreed amount beside the status label, so "Due · Rs 555" reads correctly. Change `TripDetailScreen`'s `receivableRow` to the same field.

**Why this is 8b and not further down: it is a regression inside A12's own work, found the day after A12 shipped.** A12 (GAP-57) fixed the *status* logic — before it, this row was a hardcoded `NotAvailable`. The amount next to that status was never right; A12's own tests asserted the row rendered *something*, not that the something was the correct figure. Add a regression test for a booked trip with a customer, an agreed amount and nothing yet collected, asserting the rendered amount is the agreed amount, not `0`.

**Done means** — a trip with `Rs 555` agreed and `Rs 0` collected shows `Due · Rs 555`; a part-paid trip shows the full agreed amount beside `Part paid`, matching `LeaseHubScreen`'s own convention exactly.

### B0b · Done — the three shells and the capability gate

**✅ Done 8 Aug 2026.** Shipped close to plan, three corrections worth recording:

- **`/api/me` is a real route-def now** (`route-defs/me.ts` + `handlers/me.ts`), and `meResponseSchema` lives in `packages/shared`. `requireRole()` added to `auth/context.ts` alongside the existing `requireBusinessId`/`requireUserId`, rather than a non-null assertion in the handler.
- **`<Can>` reads the `["me"]` cache directly, not through `useMe()`.** `useMe()` throws if called before the cache is populated (a real bug signal everywhere else it's used) — but sign-out (GAP-40) clears the query cache *before* the real navigation completes, and in that narrow window a still-mounted `<Can>` must degrade to "hide," not crash the screen it's gating. Found live, testing the interaction, not planned.
- **Review's four tabs are four flat routes** (`/review`, `/review/vehicles`, `/review/money`, `/reports`), each redirecting a mismatched URL to `/review` via an effect — not a nested tab-route tree. Mine is one route, `/me`. Both render `NotBuiltYetScreen` placeholders; B4/B5 fill in real content.
- **"Owner-manager reaches Review through More → My share" was not built here** — no such row exists yet. That's B4's own entry point to build when it lands, not B0b's plumbing.

`commit cd14d5d`. The original plan below is kept as the record of what was scoped going in.

---

**Small, and it unblocks three items.** Exactly the B0 situation: two or more items need it, none owns it, and each would otherwise build its own half-version. Nothing here is a screen; it is the plumbing every role-aware screen after it assumes.

**What lands:**

1. **`meResponseSchema` in `packages/shared`**, replacing `FirstRunGate`'s local `MeResponse` interface. That interface is documented as the one exception to clause 2 of the two-track contract, and the exception only held while exactly one screen read it — B3 and B4 make it three. `/api/me` is a plain Hono route with no route-def; giving it one is a Track A commit, and it is the only backend work B0b needs.
2. **A `useMe()` hook over the existing `["me"]` query key**, so role is read the same way from anywhere without a second fetch. `FirstRunGate` already populates that cache entry.
3. **`lib/capabilities.ts` — the W-49 matrix, client-side**, exactly as UI §12.4 specifies: `can(role, cap)`, one entry per row. Copy the rows from `api/src/auth/policy.ts` and say in the file that it is convenience only and the Worker re-checks every one.
4. **`<Can cap="…">`** — renders nothing when the role lacks it. **Absent, never disabled** (M-22): a disabled control tells a manager the feature exists and he is untrusted, which is a different message from the one the product intends.
5. **`FirstRunGate` gains `renderReview` and `renderMine`**, and `RootLayout` stops hardcoding `shell="operate"`. Review renders `AppShell shell="review"` with its four tabs (`This month · Vehicles · My money · Reports`) wired to real routes; Mine renders `shell="mine"` with no tab bar at all.
6. **The Mine shell is a different component tree, not a filtered Operate** (§7.9: "not disabled, not hidden behind a role check in a shared component"). B0b establishes that boundary; B5 fills it in.

**Traps:**

- **`REVIEW_TABS` already exists and is already tested** — do not add a fifth or reorder it. `AppShell` takes `activeTab`/`onTabChange`; the work is routes and a `tabForPathname` equivalent, not a new shell component.
- **The owner-manager is not a fourth shell** (§3.1, M-3). He gets Operate, and reaches the Review screens through **More → My share** as the same components rendered read-only. Do not branch him into `shell="review"`.
- **`can()` is never the security boundary.** Every capability is re-checked in the Worker and the driver boundary is `driver_id` scoping in the data layer (§12.4, TS §2). A test asserting the client matrix must not read as if it were proving access control.

**Done means** — an `owner` token lands in the Review shell with four working tabs, a `driver` token lands in a tab-less Mine shell, a `manager` sees no close-month affordance anywhere, and `can()` has a unit test per W-49 row.

### B0 · Done — closed GAP-37 and GAP-40, and three B items no longer wait on anything

`/more` is a real screen now (`MoreScreen.tsx`), not `NotBuiltYetScreen` — the door §3.3 gives `/cash`, `/partners/:id`, `/reports` and `/period/close` exists, even though none of them has anything on the other side of it yet. **Rows for what exists only**, as planned: today it is one row, sign-out; Reports arrives with B4, Cash with B2, Close the month with B3, each adding its own row rather than the hub pointing at a placeholder.

**Sign-out (GAP-40) needed a second piece of plumbing, not just a button.** `useAuthContext().signOut` is a hook value, and B8 had already solved the same problem once for `getAccessToken` — a module-level slot in `auth-asgardeo.ts` that `AuthGate` fills on mount, read by code built before React exists. `registerAsgardeoSignOutSource`/`createAsgardeoSignOutGetter` is the same shape, added alongside it. A new `AuthActionsContext` (mirrors `ApiContext` exactly — same `createContext`/`useX`/"throws if called outside its provider" shape) is what lets `MoreScreen` reach `signOut()` without importing the SDK, and it is the layer that owns the trap below: `useAuthActions().signOut()` calls `queryClient.clear()` **before** the raw sign-out, never after, because the raw call is a real navigation in real auth mode and nothing queued behind it would run.

**The confirm is a `Sheet`, not `Dialog`.** `Dialog.tsx`'s own docstring reserves it to INV-1, INV-17 and M-10 — three call sites, never a general "are you sure" — and sign-out is reversible (sign back in) and not one of them. Worth recording since this plan's own earlier wording ("one row, one call, one confirm") could have been read as calling for the reserved component.

**The close-month row trap (M-22/W-49: absent for a `manager`, not disabled) doesn't apply yet** — there is no close-month row until B3 lands. Carried forward to B3's own section rather than dropped.

20 new tests across 5 files (2 new: `AuthActionsContext.test.tsx`, `MoreScreen.test.tsx`); web 79 files / 290 tests, `npm run check` clean.

### B1 · Withdrawn, and why

The previous edition named an `ExpenseListScreen` for Web-P8b. **It was not built, correctly.** UI §3.3's route map has no business-wide costs route at all: `/vehicles/:id` already covers costs per-vehicle (Web-P5, read-only), and §3.1 puts F-3.1/F-3.3 under the **`＋` Add** tab — "not a destination, no route change" — never under a list screen. `docs/` outranks the plan.

Recorded rather than quietly dropped, so the same screen is not proposed a third time. `GET /api/expense` keeps its own value and its own gap id (GAP-33).

### B4 · The Review shell and phase-1 reports — B0b done, ready

**Nine tested endpoints and no interface. The partner whose entire use of this product is reading reports has nothing until this ships** — `FirstRunGate` sends the `owner` role to `NotBuiltYetScreen` today.

**Scope settled 8 August (0.2). B4 builds the phase-1 six: UC-70, 71, 72, 74, 75, 76.** FL §9.2's report catalogue carries an explicit per-row **Phase** column tagging UC-73, UC-77, UC-78 and UC-79 as phase 2; `use-cases.md` §9.1 and UI §15 agree. P11 shipped nine endpoints ahead of that gate and this plan's title took the endpoint count for a scope. Two of the three excluded reports cannot satisfy their use case today regardless of phase (UC-77 → GAP-73, UC-79 → GAP-19). **Full design, all eleven decisions and the report-by-report evidence: `B4-REPORTS-DESIGN.md`.**

**Backend increments: five, and all five that belonged to B4 are done.** §7.8's overheads block had none (**GAP-41**, ✅ done 8 Aug) and the verification pass found four more — **GAP-70** (cash position loses banked money, ✅ done 10 Aug), **GAP-71** (lost-day reasons, phase 1, and UI §11.1 dropped it too, ✅ done 10 Aug), **GAP-72** (goodwill's window math, ✅ done 8 Aug) with **GAP-73** (goodwill's date basis and missing breakdown — distinct, still open, but UC-77 is phase 2 and not part of B4) alongside it, and **GAP-74** (✅ done 8 Aug).

**GAP-74 shipped 8 Aug, and it is worth reading what it actually built.** §7.8's "What I'm owed" row is **UC-67's partner balance, all-time** — confirmed by the owner 8 Aug. UC-67's own closing line: *"the passive owner's real question is not 'what did the cars make' but 'what am I owed, and by whom'. §4.5 gives him sixty seconds a month, and **this is the line he actually reads**"* — and §4.5 is §7.8. `earned.profitShareMinor` stayed *derived from the open period only*, unchanged; a new, separate `balanceMinor` on `GET /api/partner/{userId}` is what closed the gap — a bounded loop over every period the business has run, summing the same per-period read `earned` already made, once per period instead of once. Not the eventual shape (a snapshot at period close, still deliberately deferred), but it does not gate anything now.

**Two waves, cut by contract completeness — not by shell-versus-catalogue.** The design review proposed a Review-core slice then a catalogue slice; that ordering put the blocked work first, because the Review shell's `This month` tab was what GAP-41 gated while the catalogue's UC-71 and UC-74 were unblocked from day one.

| Wave | What | Gated on |
|---|---|---|
| **1** | Shell routing, four tabs, catalogue, all shared infrastructure, **all six reports** (UC-75 retitled, UC-76 without reasons), `My money`, read-only vehicle screen, `This month` **with** overheads (GAP-41 done), **owner-manager's More → My share** | B0b only — **GAP-41 and GAP-74 both done, neither gates Wave 1 any more** |
| **2** | UC-75 completed and retitled back (GAP-70) · UC-76's reason chart (GAP-71) | two Track A increments, **both still needing a `doc-change` first** — GAP-73 (goodwill's breakdown/date-basis) is a third open item in this family but was never scoped as a B4 blocker |

**Two Wave 1 screens ship honestly short, and one of them needs a defensive title.** **UC-75** is titled **"Cash partners are holding"** until GAP-70 lands — `heldMinor = received − banked − advanced` is arithmetically right but the response has no field for either subtrahend, so banked cash leaves the partner figure and appears nowhere; calling that "Where is our cash" is the confident-wrong-number failure W-56 exists to prevent. **UC-76** needs no qualifier — every figure it shows is complete, and the missing piece is a second chart.

**Screens** — `web/src/features/reports/` and `web/src/features/review/`: the Review shell's four tabs, a report catalogue, one screen per report. New routes `/reports`, `/reports/:key`, and whatever the three non-Reports tabs resolve to.

**The nine, with what each one actually needs from the caller** — the three phase-2 rows kept for reference, marked, because whichever item picks them up needs the same table. **Six of the nine, not four, need parameters the catalogue must collect first** (UC-70, 72, 76, 77, 78, 79); the earlier "four" contradicted this table's own rows. Of B4's six, only three need any.

| Report | Endpoint | Caller must supply | Gate | Form (§11.1) |
|---|---|---|---|---|
| UC-70 this month | `/reports/vehicle-month` | **`periodId`** (+ optional `vehicleId`) | `viewReports` | KPI row + horizontal bar per vehicle |
| UC-71 trips that made money | `/reports/trips` | — | `viewReports` | Ranked horizontal bar, direct-labelled |
| UC-72 fuel efficiency | `/reports/fuel-efficiency` | **`vehicleId` + `from` + `to`** | `viewReports` | Line, single series |
| UC-74 who owes us | `/reports/receivables` | — | `viewReports` | **Table**, not a chart |
| UC-75 **cash partners are holding** | `/reports/cash-position` | — | `viewReports` | Stat tiles + stacked bar (held vs ours) — **retitled until GAP-70** |
| UC-76 lost days | `/reports/lost-days` | **`from` + `to`** | `viewReports` | Column per month + weekday distribution — **reasons missing, GAP-71** |
| ~~UC-77 goodwill given~~ *(phase 2)* | `/reports/goodwill` | **`from` + `to`** — a **year**, per UC-77's own first line | **`viewOwnerOnlyReports`** | Single number + table by reason — **not buildable, GAP-73** |
| ~~UC-78 ageing~~ *(phase 2)* | `/reports/ageing` | **`asOfDate`** | `viewReports` | Stacked bar of buckets + table — the only phase-2 report whose contract is complete |
| ~~UC-79 utilisation~~ *(phase 2)* | `/reports/utilisation` | **`vehicleId` + `from` + `to`** | **`viewOwnerOnlyReports`** | Stacked bar per vehicle — **endpoint is one vehicle per call**; GAP-19 still open |

**`periodId` comes from `GET /api/accounting-period`** (A3), which is also §7.8's own `July 2026 ▾` picker — one query serving both. **A vehicle picker is needed for one report in B4** (UC-72; UC-79 would be the second) and `EntityPicker` already exists. **UC-73 (the year) is not in this list and must not be built** — it is GAP-18, product-phase Second, even though §11.1's table has a row for it.

**Parameters live in the URL** (`/reports/:key?…`), not only in component state — a report someone is looking at should survive a refresh and be sendable to the other partner, which is the exact situation this product exists for. `/reports/:key` validates its search params and renders the parameter form when they are missing, so the route is never dead.

**Both owner-only reports are phase 2, so `viewOwnerOnlyReports` has no caller in B4.** Every card in the catalogue is gated by `viewReports` alone. The trap below is still the right rule and still how the catalogue is built, but in B4 nothing exercises it — it is dormant, not wrong, and it re-arms the moment either report lands. **Replace the planned "a `manager` never sees the owner-only cards" test with the one that has teeth: a `driver` cannot reach `/reports` at all** (route-level, a W-49 boundary rather than a convenience).

**§7.8's hero comparison is two fetches, and the delta is a percentage of money.** `▲ 12% vs June` needs `vehicle-month` for the current period *and* the one before it, then a ratio. That ratio is a `number` derived from two `bigint`s — legitimate, and it needs the same treatment `profitPerKm`/`kmPerLitre` already carry: an explicit lint disable with the reason recorded, computed in one place, never a `Number()` on either operand independently.

**The one hard problem, and it needs deciding before any chart is drawn:** money is `bigint` in the client and **must never become a `number`, "not even for a chart axis"** ([web/CLAUDE.md](web/CLAUDE.md)). Recharts wants numbers. Resolve it deliberately — scale to a display unit at the very edge, in one place, isolated and tested exactly as the money codec is. Do not let a `Number(minor)` leak into a component. The backend already solved this twice for *ratios*; follow that precedent rather than inventing a third convention.

**Traps:**
- **The catalogue must not render a card the role cannot fetch** — a 403 the user could have been spared is a bug. `<Can>` from B0b is how, not an inline role check. **Dormant in B4** (both owner-only reports are phase 2, so all six cards share one gate) but the pattern goes in now rather than being retrofitted around a special-cased card later.
- **The §11.2 palette becomes tokens before any chart uses it** (finding 5). Eight `--color-chart-*` pairs in `tokens.css`, light and dark, **and every one added to `cn.ts`** or tailwind-merge drops it silently. Three light-mode slots sit below 3:1 on the surface, which **obligates direct labels or a table view** on any chart using them — §11.2 states that as a requirement, not a preference.
- **Every chart has a table view, one tap away** (§11.3). It is also the accessibility relief for those three slots, so it is not optional polish.
- **Degrade to "not available", never zero** (W-56). `profitPerKm`, `kmPerLitre` and `litres` all come back `null` **by design**; §11.4 makes this a *visual* rule — `NotAvailable` in place of the mark, reason in the caption. A zero-height bar and a missing bar must never look the same.
- **The lost-day denominator is `leaseEligible`** — the endpoint returns `ran`, `lost` and `leaseEligible` as separate counts. Display what it computed; never recompute a percentage client-side.
- **No accounting vocabulary reaches the interface** (U-6) — no "accrual", "receivable", "allocation" in any title or axis label. UC-74's own screen title cannot be the word the use case is named after.
- **W-52: paying in *creates* what a partner is owed** — `putIn` is a positive term in UC-67's balance, never excluded from it. *"Paying in more than your share buys you a claim, not a bigger slice… he is owed the extra twenty back."* An earlier draft of the B4 design had this exactly backwards and would have understated the row by every rupee a partner ever contributed.
- **`partyName`, `displayName` and `driverName` are all `.nullable()`** across these schemas. **Decided:** one shared `<PartyName>` falling back to the party type — "Unnamed driver" / "Unnamed customer" / "Unnamed partner", muted, row always rendered. Type-derived rather than a bare dash because the same component is a chart direct-label, where no adjacent type column carries the meaning.
- **Empty is not the same as unknown, and the codebase has already ruled on it.** `queries/reports.ts`'s own lint exemption says it: *"a real zero cost, not a missing figure (W-56 governs an unknown, not an absent one)"*. So no receivables is **"No one owes us anything"**, no closed trips is **"No closed trips yet"** — and only no fill-to-fill pair is `NotAvailable`. The checklist line below is corrected for this.
- **Enum values never render raw** — a label map per enum (`partyType`, `lostReason`, ageing bucket, `docType`, arrangement), colocated with the feature. U-6 already forbids accounting vocabulary; `over-90` or `auto_waiver` on screen is that rule broken sideways.
- **The `This month` warning strip is `GET /api/home/paperwork-warnings`, one business-wide call** — not N+1 per-vehicle document fetches, and not a client-side selector. It already applies F-10.1's 30-day window, already keeps warning past expiry (`isExpired` is a field), and already computes `today` from the business timezone. Filter to `subjectType === "vehicle"`; **driver licences do not appear in the Review shell** (§7.8 attaches a warning to the vehicle it concerns, and the passive owner cannot act on a licence anyway).
- **On a business's first accounting period, omit the delta line entirely** — not `0%`, and not `NotAvailable`. No prior period is a fact, not patchy data; `NotAvailable` would imply something failed.
- **No pie charts, never a dual axis, one chart per viewport** (§11.3).

**Done means** — **Wave 1:** an `owner` lands in the Review shell with four working tabs; the `owner_manager` reaches the same screens through **More → My share**; the catalogue renders **six** cards and no phase-2 route resolves; all six reports render from real data in both themes at 360×640, each with a table view; a `driver` cannot reach `/reports`; UC-75 is titled "Cash partners are holding"; and **no `Number()` touches a money value anywhere in the feature** outside the one axis codec. **Wave 2, ✅ done 10 Aug 2026:** the overheads block is real (done 8 Aug), UC-75 carries its title back to "Where is our cash" with `banked`/`driverAdvances` given their own tables, and UC-76 has both its reason chart and the "column per month" primary chart. **B4 is fully done, both waves.**

**Two acceptance constraints, carried not resolved:**
- **Until GAP-1 lands, nothing in B4 claims or implies per-vehicle manager scoping** — `viewReports` is a flat business-wide check and the UI cannot fix that by hiding cards. The standing operational guard holds: do not invite a `manager` to a real business.
- **Desktop is out.** Responsive where it is free (max-widths, grid reflow); nothing from UI §14 — no sortable columns, no small multiples, no side-by-side comparison. §15 puts that dashboard in phase Third, and §14's baseline changes being undated is not a licence to pull them into the largest item on the board. Reports must be *usable* at `lg`, not optimised for it.

### B5 · The Mine shell — B0b's `renderMine` branch done, ready

**Backend increment: none.** `GET /api/driver-view` has been ready since P12, and `driverViewResponseSchema` already carries days, trips, advances, offsets and the deposit in one response.

**Screens** — `web/src/features/mine/`: `MineScreen` on `/me` — `TwoBalances`, his days including excused ones, closed trips and fees, advances, offsets, the held deposit, a Statement link. `AppShell` already accepts `shell="mine"` and renders no tabs for it; B0b supplies the branch that reaches it.

**Traps:**
- **There is no `driverId` anywhere in this route, by construction** (INV-25). The client must never introduce one — not as a prop, not as a query param, not "for testing". The endpoint has no slot for it; keep it that way on this side too.
- **A different component tree, not a filtered Operate** (§7.9): "no write affordance exists in this shell at all — not disabled, not hidden behind a role check in a shared component." Reusing an Operate screen with actions conditionally hidden is the one implementation this explicitly forbids.
- **`TwoBalances` never nets** (W-2), and this is the screen where a driver would most want it to.
- **Excused days are included** (§7.9) — they are the thing he would otherwise argue about. Do not filter them out to tidy the list.

**Note the overlap with A5, which has now landed.** This screen and `DriverDetailScreen` render nearly the same facts from two endpoints under two gates — and A5 deliberately made them one domain function and one wire mapper server-side, so the *figures* already cannot disagree. Factor the shared presentation only if it falls out naturally; the two screens have different affordances (Mine has none) and forcing one component to serve both reintroduces exactly the shared-tree risk §7.9 forbids.

**Done means** — a linked driver's token renders exactly his own data, and no request shape exists that could return anyone else's.

### B2 · Partners, banking and cash — A2 done, B0 done, UI callers done

**Screens** — `web/src/features/cash/`: `CashScreen`, `PartnerDetailScreen`, `PartnerSetupScreen`, `CapitalContributionSheet`, `RecordPayoutSheet`, `BankingEventSheet`, `MileagePackagesScreen`. Routes `/cash`, `/partners/:id`, `/vehicle-sharing`, and `/mileage-packages`.

**`PartnerListScreen` is a section on `/cash`, not a route.** §3.3 has `/partners/:id` and deliberately no `/partners` — and `GET /api/reports/cash-position` already returns every partner with a name and a held figure, which *is* the list. A separate list route would be a second way to reach the same rows, and the route map is the document that decides.

**Traps:**
- **The shares form submits the whole set at once, never row by row.** The client shows an immediate 100% total guard for the human, but the deferred `assert_shares_total()` trigger remains the truth and any `OWNERSHIP_SHARES_INVALID` response still surfaces as the mutation error. The current UI only creates an initial split for a vehicle with no current split; changing an existing split needs a backend close-and-replace operation first.
- **Capital is not ownership** (W-52). Never render one as the other; never show a derived gap.
- **An overlapping management agreement is a 409** from an `EXCLUDE` constraint. Catch it; do not pre-check.
- **The banking discrepancy's bearer is required exactly when recorded ≠ counted**, and the form must **only ever offer `absorbed` / `unattributed`**. The third enum value means the shortfall was traced to a receipt and corrected there instead (F-8.2) — it can never arrive through this form, and the request schema already refuses it.
- **GAP-1 again: do not build UI that implies per-vehicle scoping exists.** `/vehicle-sharing` records the ownership/management facts; it does not claim the policy layer uses them yet.

**Done means** — a 60/40 initial split saves in one write and reads back; a shared vehicle with a monthly fee grants and revokes; a direct manager visit sees no owner-only setup affordance, while the Worker remains the actual 403 boundary.

### B3 · Done (core) — close the month, and correct a payment

**✅ Core done 8 Aug 2026: `CloseMonthScreen` + `CorrectPaymentSheet` + `Timeline`.** `WriteOffSheet` and `PostClosureChargeSheet` deliberately not built here — both need a specific obligation/lease/trip as their entry point, which this screen has no context for; see the "one queue" table's **10a**. `commit 5ddadad` (plus `d0e3e82` for the `/more` row and router wiring).

**One gap found and fixed before it shipped, not after:** `CorrectPaymentSheet`'s trigger wasn't originally gated — `POST /api/payment/{id}/correct` requires `reverseReceipt` (owners only), narrower than the `dailyOperations` that gates reading the payments list, so a `manager` who reached `/period/close` by direct URL could have opened the sheet and hit a 403 on submit instead of never seeing the option. Fixed: the row renders as plain (non-tappable) information for a role without `reverseReceipt`, a button for one with it — M-22 applied to the affordance, not the information it sits on top of.

**`auditEntryToTimeline.ts` is the one translation this needed and the plan below didn't anticipate.** `Timeline`'s own contract is a pre-composed `description`; `auditLogEntrySchema` gives raw `before`/`after` row snapshots and a bare `changedBy` user id instead. Scoped to `payment`'s own two fields (`amountMinor`, `status`) rather than a generic before/after differ across all eighteen `assert_period_open()` tables — real, separate work if a second table ever needs its own `Timeline`.

The plan below is kept as the record of what was scoped going in.

---

**Screens** — `web/src/features/period/`: `CloseMonthScreen` on `/period/close`, `CorrectPaymentSheet`, `WriteOffSheet`, `PostClosureChargeSheet`, plus **`Timeline` wired to real `audit_log` data** — it has one caller today and was built for exactly this.

**`CorrectPaymentSheet` needs a payment row to open from**, which is `GET /api/payment` (GAP-38, shipped in A3). Where that row lives is this item's own decision — the lease hub's dues section and the driver/customer detail screens are all candidates; §7.10 only says "open the receipt."

**`Timeline` attaches to a record, not to the month** (finding 6). The endpoint is `GET /api/audit-log/{tableName}/{recordId}` — per-record by design, which is exactly what F-8.6/UC-97 asks for ("readable from the record itself, not only down a global log"). A corrected payment's own trail is the caller. There is no month-wide feed endpoint and the close screen must not imply one.

**The checklist is five counts and they are all live now** — `unconfirmedDays`, `openTrips`, `unreconciledAdvances`, `pendingObligations`, `openIncidents` (`closeChecklistSchema`). Each is a row with a count and a link that goes and fixes it (§7.7).

**Traps:**
- **The checklist warns and lists; it never blocks** (U-7). The close button stays enabled.
- **The close action is absent for a `manager`, not disabled** (M-22/W-49) — `<Can>` from B0b, and the same gate on `MoreScreen`'s row pointing here. This is B3's single hardest dependency and the reason B0b exists.
- **The primary action states the consequence** — `Close July permanently`, never `Confirm` (M-10). `DialogConfirmFooter`'s `confirmLabel` **defaults to the forbidden word**, so it must be passed explicitly here; this is one of the three call sites `Dialog` is actually reserved for.
- **`unconfirmedDays` is the checklist's first row** (§7.7) and is now in the response (A3). Render all five rows — none is missing any longer, so there is no "state plainly which is missing" fallback to reach for.
- **Closing opens the successor period in the same transaction.** The screen must make clear that this happened, since every later write depends on it.
- **A correction's `bearer` is the whole decision.** `back_to_arrears` puts the party back in arrears (INV-22); `absorbed_loss` leaves their due settled and the business eats it. Two outcomes from one form, and the copy must say which is which **without using the word "allocation"** (U-6).
- **A waiver and a write-off never share a bucket** (W-28). Separate entry points, separate reporting, never one combined "reduce this due" control.
- **`PERIOD_CLOSED` comes from the trigger**, never a client pre-check. Catch it and explain it.
- **GAP-15**: "deduct it from his fee" is `POST /api/offset` applied afterward. Either wire it as two explicit steps or leave it out — do not imply a combined endpoint exists.
- **B0's trap, carried forward:** once `MoreScreen` gains a close-month row pointing here, that row is **absent for a `manager` role, not disabled** (M-22/W-49 — the same rule this screen's own close action must already honour). Gate the row the same way the action itself is gated, not by hiding the destination and leaving the door open.

**Done means** — a month closes end to end with its successor open; a correction moves a party back into arrears and the audit trail shows who did it.

### B6 · Customer detail — A4 done, B0 done, ready, closes GAP-22

`/people/customers/:id` replaces `PlaceholderDetailRoute`. §3.3: dues, payments, statement.

**Reuse `LeaseHubScreen`'s dues section wholesale** — same rows, same "tappable only while `pending`/`part_paid`" rule, same `ActionSheet` into `CollectPaymentSheet`/`AdjustObligationSheet`. This screen is the party-scoped twin of one that already exists; building it a second way would be the drift.

### B9 · `UI-UX-REVIEW.md` fixes — independent, ready now

**Four small, unrelated fixes on screens that already ship**, found by an independent Playwright-driven review of the built client and each confirmed against source before being scheduled here (TRACKER.md §6 records the two claims from the same review that did *not* hold up, so they aren't repeated below). None blocks another item and nothing blocks these; pick them up in any order, together or split.

**GAP-44 — INV-1 has no blocking `Dialog` anywhere.** `Dialog.tsx`'s own doc comment reserves it to three call sites (INV-1, INV-17, M-10); only `CloseTripSheet.tsx` actually renders one, for INV-17. A double-booking conflict in `StartLeaseScreen.tsx` or `BookTripScreen.tsx` today surfaces as a bare `mutation.error.message` line, not the modal-plus-inline-fix §9.3 requires. **This needs a product decision before it needs code**: §9.3 requires "the fix offered inline," but doesn't wireframe what that fix says for a double-booked vehicle-day the way INV-17's confirm is wireframed in §7.5. Write that copy first, catching `VEHICLE_DOUBLE_BOOKED` specifically rather than rendering the raw error message.

**GAP-45 — trip detail's title truncates at 360px.** `formatShortDate` (`TripDetailScreen.tsx`) sets `year: "numeric"` unconditionally on both dates in the title; at 360px it clips mid-digit next to the cancel icon. Fix: show the year only where the range crosses one (§8.3's own rule), and consider leading with an identifier the way §7.5's wireframe does ("Trip #21 · Bus · 28–30 Jul") rather than two dates alone.

**GAP-46 — vehicle calendar's occupied-day cells fail a screen reader.** The occupied-day branch (`VehicleCalendarScreen.tsx`) renders a plain `<div>` with the state glyph inside `aria-hidden` and no `aria-label` — colour and glyph are the only channel, which §10 forbids. The free-day branch already does this correctly (`aria-label="Start a rental from …"` etc.); mirror that pattern with a label naming the state ("On a lease", "Ran", "Lost", "On a trip").

**GAP-47 — M-26 (landscape) is wholly unbuilt, and it's the one genuinely new scope in this batch.** `AppShell.tsx`'s tab bar and `Screen.tsx`'s app bar are hardcoded to the 56px portrait height with no orientation variant at all, against a deliberate, specified requirement (WCAG 2.1 SC 1.3.4 forbids locking orientation instead — the spec's own §16.4 records that option being rejected). At 640×360, Home's day-card action buttons sit below the fold. **The largest item here**: it touches two shared primitives every screen sits on top of, so size and test it like a small feature, not a one-line fix. Collapse the app bar to 44px and the tab bar to icon-only at 44px below `md` in landscape; verify against Home first, since that's the screen the spec's own 192px budget was sized around.

**GAP-48 — M-11's undo toast has no host.** `AppShell.tsx`'s `<div id="toast-root" />` has a comment stating nothing renders into it yet. M-11 requires a 5-second undo toast for any write that "sent no message and settled no obligation." Needs a `Toast` primitive plus a deliberate, recorded decision about which existing mutations qualify — likely a short list (an entity created with no downstream money effect yet), not "every write."

**Moved out, not left unresolved:** the review also flagged a nested-`Sheet`/`AmountPad` interaction as "low confidence, needs a human." Live testing on 6 August found something closely related and confirmed it hard — closing a nested sheet can leave `aria-hidden` on an ancestor of a focused element, reproducibly, via console warning rather than guesswork. That's **GAP-50**, now in **B11**, since it turned out to be `Sheet.tsx`'s own focus/inert handling rather than one specific nested interaction. Worth re-checking the original `AmountPad`-in-`MoneyField` case specifically once B11 lands, in case it's a distinct third issue rather than the same root cause.

**GAP-55 — 7 August, live: the "Add a driver" form's Name field has no `autocomplete` attribute.** Flagged by Chrome's own accessibility check. Add `autoComplete="name"`.

**Six more, 8 August — a live QA browser pass against `qa.fleetsettle.com`, each confirmed against source before being scheduled here** (`QA-BROWSER-TEST-FINDINGS-2026-08-08.md`, itself validated the way this repo validates every external review — its P0 finding turned out to be serious enough to become its own item, **B14**, not folded in here):

- **GAP-76 — generic `Invalid input` on required fields.** [CreateDriverForm.tsx:30](web/src/features/people/CreateDriverForm.tsx#L30) and [CreateVehicleForm.tsx:41-42](web/src/features/vehicles/CreateVehicleForm.tsx#L41-L42) give `name`/`registration`/`vehicleType` no custom Zod message. `CreateCustomerForm`'s contact validation is the pattern to match — specific, field-named copy.
- **GAP-78 — driver detail shows the driver's name twice.** `Screen title` and `TwoBalances`'s own `<h2>` both render it. Use the second slot for something else, or drop it.
- **GAP-79 — a blank incident description gives no other context**, just "No description recorded." Add type/cost/recovery status where available, or a more operationally useful fallback.
- **GAP-80 — three places show internal phase references as end-user copy**, all via `NotAvailable`'s `reason` prop: `"no advance list read exists yet (Web-P8b)"` (`TripDetailScreen.tsx`) and `"photo capture needs upload support, not built yet"` (`RecordExpenseSheet.tsx`, `FuelFillSheet.tsx`, twice). Rewrite as product copy — the reason a figure is unavailable is legitimate to state; which internal phase will build it is not.
- **GAP-81 — `voidExpense` has a working backend endpoint (since A9a) and no client caller anywhere.** A manager who mis-enters an expense cannot correct it from the product — only the API. Add a void action to the expense rows already rendered on `VehicleOverviewScreen`/`TripDetailScreen`/`IncidentScreen` (reason required, W-50), reusing the existing struck-through display convention those screens already use for a voided row. This is the client half of the one money table (of thirteen) that already has a backend void path — the other twelve wait on A9b.

**Done means** — each of the eleven, independently: a double-booking shows a `Dialog` with copy that says what to do next; the trip-detail title never clips at 360px; every calendar cell (occupied or free) is nameable by a screen reader; the app bar and tab bar both collapse correctly below `md` in landscape with no content below the fold on Home; at least one qualifying write offers a working 5-second undo; the driver/vehicle forms' required-field errors are field-specific, not generic; driver detail shows the name once; a blank incident description reads as operationally useful, not just absent; no `NotAvailable` reason names an internal phase; and a manager can void a mis-entered expense from the screen that shows it, with a reason, still visible struck through afterward.

### B16 · Visual semantics pass (UI-LF) — independent, Phase 1 done 9 Aug 2026

**A code-and-live-QA visual review** (`UI-LOOK-FEEL-REQUIRED-CHANGES-2026-08-09.md` / `UI-LOOK-FEEL-IMPLEMENTATION-PLAN-2026-08-09.md`) found the client visually correct but under-differentiated: arrangement, incident status, voided-expense reason and the tab bar's active state all carried no signal beyond plain muted text or colour alone. Validated against source before scheduling, per this repo's standing rule for external reviews — two of its recommendations did not survive that check, corrected below rather than repeated.

**Two corrections, recorded rather than silently dropped:**
1. **"Tighten repeated-card radius to 8px" contradicts the spec, not an oversight.** UI §5.3 states the scale explicitly — `sm 8 (controls) · md 12 (cards) · lg 16 (sheets) · full (chips, avatars)`. `Card`'s 12px is the deliberate value; this recommendation is declined outright, not deferred.
2. **The proposed status words ("Pending", "Settled") don't match U-6's locked vocabulary.** `obligationStatusLabel.ts` (A12) already centralises the real words — "Due", "Part paid", "Paid", "Waived", "Written off". Any future status `Badge` reuses that constant rather than inventing new copy.

**Phase 1, done:** `Badge` (new primitive, `rounded-full` per §5.3's chip/avatar value, not the review's suggested `rounded-sm`; added to UI §6.1's component inventory, v1.2.4) · `Card` gained an optional `accent` left-border prop (radius untouched) · `AppShell`'s active tab gained a `before:` pill beyond text colour · `VehicleListScreen`/`VehicleOverviewScreen`/`PeopleListScreen` gained `ChevronRight` on navigating rows, and the two vehicles screens' duplicate `ARRANGEMENT_LABEL` maps were consolidated into `lib/arrangementLabel.ts` (the same drift GAP-81 already fixed once for `EXPENSE_CATEGORY_LABEL`) alongside a new `lib/incidentStatusLabel.ts` · `ExpenseCostRow`'s voided state gained a `Badge variant="critical"` and the reason moved to `text-critical-ink` (its destructive confirm button was already done, GAP-81) · `MoreScreen` gained `ChevronRight` on every navigating row and a `warning` accent/icon tint on "Close the month" so it no longer looks equivalent to "Opening balances" · `VehicleCalendarScreen`'s six states each gained a distinct token (`ran` → `good`, `not yet confirmed` → `warning`, `lost` → `critical`, lease/trip unchanged) — previously `ran` and `not yet confirmed` shared the brand wash, told apart only by glyph. 10 new tests, `web` 97 files/414 tests; `npm run check` clean across all three workspaces.

**Deliberately not done this pass:** Phase 2 (Section header treatment, EmptyState/NotAvailable variants) and Phase 3 (reports/review catalogue grouping, money-direction consistency across Review) — both lower-severity and independent, pick up any time. Phase 3's reports-catalogue polish also still needs the outstanding `build/p0-foundation` → `develop` merge before it's visible on hosted QA to verify against.

### B7 · Offline and the PWA — startable, sequence last, **now phase 3**

**Moved to phase 3, 11 Aug 2026**, by the owner's phase model — everything else previously in this file's phase-1 queue is phase 1 now, and B7 is the one item that moved the other way. Nothing about the item itself changed.

Cross-cutting: it wraps every screen, so building it before the screens exist means rebuilding it per screen. **Startable at any time, correct to finish last.**

**What lands** — TanStack Query persistence; the paused-mutation queue (M-12) replaying with a **fresh token per attempt**; a 401 on replay pausing and re-authenticating rather than discarding; the eviction warning while the queue is non-empty; the iOS "Add to Home Screen" hint; runtime caching (stale-while-revalidate reads), deferred from P0's shell-precache-only PWA.

**Traps:**
- **A discarded mutation is a lost money record.** Pause and re-authenticate; never drop.
- **`HomeScreen`'s skeleton branch becomes reachable for the first time.** Web-P3 built it correctly and recorded that its one trigger condition — a warm cache — could not occur before this item exists. **Verify it now rather than assuming it works.**
- **`Provisional` has 0 real callers** and is the one inventory component no item claims. If it belongs anywhere it is here; if it doesn't, say so and record it.
- Side-by-side condition comparison needs photos, which need A7.

**Done means** — four days confirmed on a Sunday with no signal replay silently on Monday, and the money lands once.

### B8 · Done

**Shipped 5 August 2026** (`96301f8`), and it was larger than this plan said. The previous edition costed B8 at "about ten minutes of console work" — true of the console half only. The client half was **unbuilt and unscoped**: no SDK in `web/package.json`, no PKCE flow, no login screen, no real `TokenGetter`. `auth-stub.ts` issues an unsigned token that `verifyAccessToken` was always going to refuse, so until this landed **nobody could log in to a deployed build at all.**

What shipped: `@asgardeo/auth-react` ^5.6.2 (the SDK UI § settled on in July) · `lib/auth-asgardeo.ts` — config from `VITE_*`, PKCE on, redirect derived from the serving origin · `app/AuthGate.tsx` — completes the code exchange on `/auth/callback`, offers sign-in otherwise, blocks until there is a session. 12 new tests.

**§12.1's contract paid for itself.** Because the token getter is *injected* into `createApiClient` rather than imported, swapping the stub for the real thing changed `main.tsx` and nothing else — no screen, no query, no test of either.

**Three defects it surfaced, none of which were auth code:**
- **The client id in `api/wrangler.jsonc` was stale in all three environments.** It is checked as `aud`, so every token from the real apps would have 401'd with nothing in the message to say why (IG §10.6's undifferentiated 401, working exactly as designed and costing an afternoon to diagnose if it had reached QA).
- **`deploy:qa` ran plain `vite build`**, whose default mode is `production` — QA would have silently shipped production's client id. Now `--mode qa`, proven by building both and grepping each bundle for the other's id.
- **The callback cannot use `history.replaceState`.** The router is built once at module scope over browser history, so rewriting the URL underneath it leaves it resolving the callback path it captured at creation.

**Verified against the live tenant, not assumed:** the OIDC discovery document's `issuer` and `jwks_uri` match `ASGARDEO_ISSUER`/`ASGARDEO_JWKS_URL` exactly, `authorization_code` + S256 PKCE are supported, and the JWKS serves one RS256 key. The console now has JWT token type, PKCE mandatory, hybrid flow off, and all four redirect URLs — both `/auth/callback` paths and both bare origins, the latter because `signOutRedirectURL` is the origin.

**Not yet done: one real browser round trip.** Everything either side of it is verified; the flow itself needs a human with a password.

---

## Step 0 — the two things that were not code — both resolved 7 August 2026

**Queue items 4 and 5. Neither was a build, both gated believing anything that came after.** They lived here rather than in the Track B checklist because no diff proves them — one was a merge, the other was believed to be a row in a live money database.

### 0a · Merge `build/p0-foundation` → `develop` — done

- [x] Five PRs (#5–#9), `deploy-qa` green on each, `origin/develop` at `ba389ff`. This session's own first check of it was wrong — it diffed against a stale *local* `develop` ref instead of `origin/develop`; corrected by fast-forwarding local `develop` to match (TRACKER §5 carries the trap)
- [x] Live-verified against `qa.fleetsettle.com` in a real browser, both colour schemes: GAP-49, GAP-50, GAP-51 all hold; `role: "owner_manager"` lands on Operate correctly for the account this fix governs
- [x] Every environment-dependent fix since A0 is now verifiable on QA

### 0b · The existing production `business_member` row — checked, and moot

- [x] **Checked directly against Neon `main` (`br-odd-cherry-afx5394i`), 7 Aug 2026, read-only:** `business_member`, `app_user` and `business` are all at **zero rows**. Confirmed as the live production branch by its own `_migrations` table — `0001` through `0007`, applied 5 Aug 2026, timestamps matching `DEPLOYMENT.md` exactly.
- [x] **Nobody has ever signed up in production.** The premise this item was written under — "the account already stuck on `owner`" — was stated as fact and never actually verified against the database. It does not hold.
- [x] **No `UPDATE` was written.** There is no row to correct, and this item's own rule (scope to one row by `id`, never a bare `WHERE role = 'owner'`) forbids guessing at one that doesn't exist.
- Nothing further to do here unless and until a real production signup happens and gets stuck the way A0 describes — at which point this item's original checklist (read the row, scope by `id` and `business_id`, verify by sign-in) is still the right procedure.

---

## A11 · Member and driver access — done 7 August 2026

Written 7 August 2026 from the access design pass above; built the same day. **The migration came first, as planned.** Two boxes shipped differently from how they were written here — both noted inline, both already recorded in TRACKER.md and in the A11 section above.

*Documents, before the code*
- [x] `docs/product/user-flows.md` — W-49 gained a **member administration** row (owner ✓, owner-manager ✓, manager ✗) — v1.1.4
- [x] `docs/product/user-flows.md` — F-1.8's steps reconciled with its own OQ-2 resolution (code, never phone matching) — v1.1.4
- [x] `docs/engineering/data-model.md` — DM §3 (partial index, `business_member_invite`), §12 (audit trigger), §13/§13.1 (INV-31), §14 (enforcement map), §16 (flow table) — v1.1
- [x] **Not originally boxed, found reading UC-03 while doing the above:** `use-cases.md` v1.2.4 — UC-03's invite-role list corrected to include the passive `owner`, not just manager/owner-manager

*Migration `0010` — one file*
- [x] `UNIQUE (business_id, user_id)` dropped, replaced by a partial unique index `WHERE revoked_at IS NULL` (**GAP-52**)
- [x] `CREATE TRIGGER business_member_audit … AFTER INSERT OR UPDATE ON business_member` written **explicitly** (**GAP-53**)
- [x] A `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` asserting at least one active `owner`/`owner_manager` per business (INV-31) — **shipped as `AFTER UPDATE` only, not `AFTER INSERT OR UPDATE` as written here.** `assert_shares_total`'s shape was copied without re-deriving which statement type can actually violate *this* invariant; an `INSERT` can only add a row, so it can never by itself zero the owner count, and the `INSERT`-covering draft broke a dozen test fixtures that mint a manager as a business's sole member for reasons unrelated to A11. TRACKER.md §5 carries this as a general rule for the next trigger
- [x] `business_member_invite` — the F-1.4 counterpart to the pre-existing, previously-unused `driver_link_invite`; same shape (hashed code, plaintext returned once), not the standalone "invite-code table" this section first sketched
- [x] No change to the role CHECK
- [x] DM §13's drift assertion re-run clean against the migrated branch

*Worker — six endpoints*
- [x] `manageMembers: OWNERS` added to `MATRIX` — gates `business-member`'s three endpoints only
- [x] `POST /api/business-member/invite` — reissuing invalidates the prior unredeemed code for the same role
- [x] `POST /api/business-member/{id}/revoke`
- [x] `POST /api/business-member/{id}/change-role` — revoke-and-grant, two rows, never an in-place `UPDATE`
- [x] `POST /api/invite/redeem` — no capability gate; `app_user` created just-in-time; the role/driver comes from the code, never the request body
- [x] `POST /api/driver/{id}/link-invite` + `.../unlink` — **gated `manageEntities`, not `manageMembers` as this section first assumed.** F-1.8's own actor is "Manager", the same as F-1.6 (add a driver), and neither endpoint touches `business_member` — corrected before shipping, not after
- [x] Both writes open a transaction (free: `c.get("writer")` is already `withActor`-wrapped)
- [x] Full per-endpoint matrix: happy · 401 · 403 · 404 for another business · 409 · a test that the last remaining owner cannot revoke or demote themselves (both endpoints) · a test that a revoked member's records stay attributed (redeem-twice → second gets `INVITE_CODE_INVALID`, first redemption's row is untouched)

*Client*
- [x] `FirstRunGate`'s `/api/me` 404 branch offers **create a business** *or* **redeem a code** (`RedeemInviteForm`) — one screen, deliberately not distinguishing never-had-access from revoked
- [x] Copy carries no "admin" and no "role" (U-6)
- [x] `["me"]` invalidated on a 403 — shipped as a global `QueryCache.onError` in `main.tsx` rather than per-screen, so it covers every future mutation for free
- [x] `npm run check` clean; integration suite 32 files / 406 tests green against a fresh ephemeral Neon branch

## Track B implementation checklist

Written 6 August 2026 from the validation pass above. **Order matters within an item; items are in build order.** Every box is something a reviewer can check by reading a diff or running a test — "understand the spec" is not a box.

**B11 and B10 name their files.** The two newest items were sized from a live session and then a source pass, so unlike the older items below they can say exactly which file changes and what the surrounding precedent is — that detail is deliberate, not inconsistency.

### B11 · Structural render fixes

**GAP-49 — the missing page background.** The whole defect is that `web/src/design/primitives/AppShell.tsx:50` is the *only* place in the client that paints `bg-page`, and three screens render outside it.

- [x] A base rule in `web/src/design/tokens.css` — `html { background: var(--color-page); color: var(--color-ink-primary); }` — set **once**, not patched into `AuthGate` and `NotBuiltYetScreen` individually. It lands on `:root`, which is where both dark selectors already redefine `--color-page`, so **the OS media query and the in-app `[data-theme="dark"]` toggle are both covered with no second rule**
- [x] `color-scheme: light dark` declared alongside it — **currently declared nowhere** (grepped: only `prefers-color-scheme` media queries exist). Without it the UA canvas, scrollbars and native form controls stay light under a dark theme, which is the same bug one layer down
- [x] `AppShell.tsx:50`'s own `bg-page` left alone — it becomes redundant, not wrong, and removing it is churn on the one file that has always been correct
- [x] A case added to `web/src/design/tokens.test.ts` asserting the base rule is present. That file already reads `tokens.css` as text via `readFileSync` for the dark-parity check, so this is one more regex against a string it already has — no new mechanism
- [x] Verified **in a real browser in dark mode** on `AuthGate`'s loading state, `AuthGate`'s sign-in state, and `NotBuiltYetScreen`. jsdom has no rendering, so no unit test can prove this one; the previous verification pass is exactly what missed it

**GAP-50 — `aria-hidden` on an ancestor of a focused element.** One primitive, `web/src/design/primitives/Sheet.tsx`, so one fix.

- [x] Cause confirmed before the fix: `Sheet` renders `vaul`'s `Drawer.Content`, which wraps Radix Dialog, whose background-`aria-hidden` is cleared on close **after** focus returns to the trigger. The likely lever is `onCloseAutoFocus` on `Drawer.Content` — prevent the default restore, then return focus explicitly once the attribute is gone
- [x] **Focus restore must survive the fix.** `Sheet.tsx`'s own doc comment credits vaul for "focus trap, `aria-modal` and focus restore" (M-23); a fix that silences the warning by dropping focus to `<body>` trades a console message for a real keyboard-navigation regression
- [x] A test asserting focus returns to the triggering control after close — this is the part jsdom *can* prove, and it is the part most at risk from the fix
- [x] Verified in a real browser against a **stacked** sheet close (Add → Add a driver), not only a single one — the stacked case is what named a Radix content div rather than a plain button, so nesting depth appears to matter to when it fires
- [x] Zero `aria-hidden`/focus console warnings across a pass of every sheet-opening screen
- [x] `npm run check` clean; axe-core clean, **both themes**

### B10 · Set up the daily lease (F-1.7)

**Four files, one of them new. `StartLeaseScreen.tsx` is the working precedent for every structural decision here** — same folder, same entry shape, same `Screen`-with-`primaryAction` skeleton — so this is closer to following a pattern than designing one.

*The screen*
- [x] `web/src/features/vehicles/StartDailyLeaseScreen.tsx` — takes `vehicleId`, `today`, `onBack`, `onCreated` as props, exactly as `StartLeaseScreen` does. **`vehicleId` is a prop from the route, never a picker** (F-1.7 has no vehicle step)
- [x] Driver — `EntityPicker` over `GET /api/driver`, `onAddNew` opening `CreateDriverForm` in a `Sheet`, mirroring how `StartLeaseScreen` handles a missing customer. A daily lease for a driver who isn't in the system yet is the ordinary case, not the edge one
- [x] Pattern — `every_day` / `alternate` / `weekdays` as `aria-pressed` chips; the weekday multi-select renders **only** when `weekdays` is chosen, and `patternWeekdays` is sent only then (the schema's `superRefine` requires exactly that pairing)
- [x] **"Daily lease amount"** — `MoneyField`, **no prefill from `driverDayFeeMinor`** (that is the opposite direction of money; the write-up above records why at length). Label is the reserved §9.6 word, not F-1.7's descriptive phrase
- [x] `effectiveFrom` defaults to `today`; `effectiveTo` behind a `More` disclosure
- [x] Money crosses the wire through `toWire(...)`, and the request is typed `satisfies` `z.input<typeof startDailyLeaseRequestSchema>` — `z.input`, not the inferred output type, the same fix `StartLeaseScreen` and `OffsetSheet` both carry in their own comments

*Wiring*
- [x] `web/src/app/router.tsx` — a `StartDailyLeaseRoute` component beside `StartLeaseRoute`, and a route at **`/vehicles/$vehicleId/daily-lease/new`**, parallel to `startLeaseRoute`'s `/vehicles/$vehicleId/lease/new`. Added to the route-tree array (nothing resolves if that step is missed)
- [x] `web/src/features/vehicles/VehicleOverviewScreen.tsx` — a fourth entry in the `vehicleActions` array, alongside View calendar / Record expense / Report incident, plus the `onStartDailyLease` prop it needs. **This is the menu this session opened looking for the flow and found nothing in**
- [x] The action is offered when `vehicle.arrangement` is `"B"` **or `undefined`**, and hidden for `"A"`/`"C"` — a vehicle with no active arrangement is precisely the one you'd start a daily lease on. `VehicleCalendarScreen.tsx:166-171`'s `canStartLease`/`canBookTrip` is the existing precedent for gating on arrangement this way; match its shape
- [x] `POST /api/daily-lease` wired; **409 (overlapping daily lease) caught and shown as an ordinary outcome**, never pre-checked by fetching existing leases first — DM §7's exclusion constraint is the authority, and a client pre-check is a second implementation of one rule
- [x] 404 handled, though it should be structurally unreachable — the vehicle comes from the route and the driver list is already business-scoped

*Proving it*
- [x] `StartDailyLeaseScreen.test.tsx` — U-2 test worded to match the others ("saves with driver, pattern and amount alone"); a test that `patternWeekdays` is absent from the request unless `weekdays` is chosen; a test that the 409 surfaces rather than throwing
- [x] `VehicleOverviewScreen.test.tsx` gains the arrangement gating both ways — shown for `B`/absent arrangement, **not offered** for `A` and `C`
- [x] **Confirmed against a real environment, not only jsdom:** create a daily lease, let `generate-day-cards` run, confirm a real day-record placeholder appears and is confirmable through F-4.2. **This is the verification GAP-3's fix has been waiting on since 6 Aug** and the reason that fix is still technically unproven in a live environment
- [x] `npm run check` clean

### B0b · Done — the three shells and the capability gate

- [x] `meResponseSchema` in `packages/shared/src/schemas/me.ts`, exported from `index.ts` — role, `userId`, `businessId`, optional `driverId`
- [x] `api/src/route-defs/me.ts` + handler validating against it — the only Track A commit B0b needed
- [x] Delete `FirstRunGate`'s local `MeResponse` interface and its "one documented exception" comment; import the shared type
- [x] `web/src/lib/useMe.ts` — reads the existing `["me"]` query key, no second fetch
- [x] `web/src/lib/capabilities.ts` — `can(role, cap)` over a `MATRIX` copied row-for-row from `api/src/auth/policy.ts`, with the "convenience only, the Worker re-checks" comment §12.4 requires
- [x] `web/src/components/Can.tsx` — renders `null` when the role lacks the capability. **Never renders a disabled child.** Reads `["me"]` directly rather than through `useMe()`'s throw — found necessary testing the sign-out race (queryClient cleared before navigation completes)
- [x] `capabilities.test.ts` — one assertion per W-49 row, and one asserting a `driver` has no STAFF capability
- [x] `FirstRunGate` gains `renderReview` / `renderMine`; `RootLayout` stops hardcoding `shell="operate"`
- [x] Review shell renders `AppShell shell="review"` — as four flat routes with a redirect-to-default effect, not a nested tab-route tree, but the same `REVIEW_TABS`/`AppShell` underneath, unreordered
- [x] Mine shell renders `shell="mine"` (no tab bar) over its own component tree
- [x] `owner_manager` still routes to **Operate**, not Review (M-3) — asserted in `App.test.tsx`
- [x] Tests: one per role → correct shell; `<Can>` absent-not-disabled; `npm run check` clean

### B12 · Done — opening balances (F-0.2)

**✅ Done 8 Aug 2026, closing GAP-61.** `commit 12eefa3`.

- [x] An entry point reachable by `owner_manager` — a new `/more` row, gated `<Can cap="manageOpeningBalances">`
- [x] Multi-step form: go-live date · six entry kinds via `AddOpeningBalanceEntrySheet` (customer due, driver arrears, owed to driver, deposit held, advance outstanding, cash held) · confirm. **Per-vehicle setup (arrangement, odometer, lease terms) deliberately not built** — the request schema has no such fields; F-1.1/F-2.1/F-1.7 already carry an original start date and are where that belongs, mid-stream or not. The original plan's own six-step reading of F-0.2 conflated the flow's *narrative* with the endpoint's actual *schema*; the schema is narrower and correctly so
- [x] **Save as a draft and resume** — every save is a full `PUT` replace of the accumulated entry list, matching `domain/opening-balance.ts`'s own shape; an existing batch's entries are re-hydrated with real party/vehicle names on load, not raw ids
- [x] `POST .../commit` writes the batch; a `409 OPENING_BALANCE_LOCKED` after the first period closes is caught and explained, not pre-checked
- [ ] **Never posts as income or expense** — not yet verified against a real report, since B4 doesn't exist yet. The write path itself only ever touches `opening_balance_entry`, never `obligation`/`payment`, so this holds structurally; a P&L cross-check is B4's to make once it can
- [ ] A driver statement showing a "brought forward" line — depends on B5, unbuilt
- [x] U-2: saves with just a go-live date and zero entries, asserted directly in a test

**Done means** — a business with a bus already leased, a car already rented, and a driver already in arrears can have all three entered honestly in one sitting or several, and the first month it closes reflects a true starting point.

### B13 · Done — driver money actions: pay, advance, deposit (F-6.1/F-6.3/F-6.7)

**✅ Done 8 Aug 2026, closing GAP-63/64/66.** `commit 6736e62`. **One correction to what this checklist assumed going in: `POST /api/payment` was not "the same endpoint in the paying direction" — it had no paying direction at all.** `recordPayment` was hardcoded to `direction: "received"`/`owed_to_us`; "pay the driver" needed `owed_by_us`, which nothing wrote. `createOffset` can't substitute — it requires the driver already owing something on both sides, and fails outright for a clean bonus or retainer with nothing to net against. Generalised `RecordPaymentInput`/`recordPaymentRequestSchema` to carry `direction`, defaulting to `"received"` so every existing caller is unaffected; two new integration tests prove a `"paid"` payment settles `owed_by_us` only and a no-trip payment is held entirely as unallocated credit.

- [x] Reached from `DriverDetailScreen` via a new "Driver money" `ActionSheet` — not folded into `TwoBalances`, whose own doc comment reserves it to the one action (`Offset…`) it already has
- [x] **Pay the driver (F-6.1, GAP-63)** — `PayDriverSheet`, a straight amount+date form, not a `CollectPaymentSheet` reuse: no allocation preview, since F-6.2's multi-trip breakdown-and-choose is separate, larger scope F-6.1's own single-tap shape doesn't need
- [x] **Advance before a trip (F-6.3, GAP-64)** — `AdvanceSheet`; no trip picker, since F-6.3's own text doesn't require one and `tripId` is optional on the schema
- [x] **The driver's deposit (F-6.7, GAP-66)** — `DepositSheet`, take only; no movement (refund/apply/top-up) action, matching "never automatic"
- [x] **INV-4** — a deposit write never touches `obligation`/`payment`, only `deposit`
- [x] `PERIOD_CLOSED` caught and explained for all three, never pre-checked
- [x] U-2 on each: saves with amount + date alone, asserted directly in tests

**Done means** — a manager can pay a driver, record an advance, and take a deposit, all from the driver's own page, with none of the three requiring the other two.

### B3 · Done (core) — close the month and correct a payment

**✅ Core done 8 Aug 2026.** `commit 5ddadad` + `d0e3e82`. Two naming corrections against the real implementation: the checklist endpoint is `GET /api/accounting-period/checklist`, not `.../close-checklist`; the capability is `closePeriod`, not `closeAccountingPeriod`.

- [x] Route `/period/close` + `CloseMonthScreen` in `web/src/features/period/`
- [x] `GET /api/accounting-period/checklist` wired; **all five counts rendered** as rows with a count — no per-row link to "go and fix it" yet, since each count's own fix lives on a screen (a trip, an incident, a day) this item doesn't otherwise touch
- [x] Close action wrapped in `<Can cap="closePeriod">` — **absent for `manager`**, asserted in a test
- [x] `MoreScreen` gains a close-month row under the **same** `<Can>` — not a hidden destination behind a visible door
- [x] Confirm is `Dialog` (one of its three reserved call sites) with `confirmLabel="Close August permanently"` (the open period's own month) — never the default `"Confirm"` (M-10)
- [x] Confirm states that closing cannot be undone **and** that the next period opens in the same action (§7.7) — one combined `description`, not a second confirm step
- [x] Success surfaces the newly opened successor period — every later write depends on it
- [x] The close button stays **enabled** regardless of checklist counts (U-7)
- [x] `CorrectPaymentSheet` over `GET /api/payment` + `POST /api/payment/{id}/correct`; `bearer` is an explicit two-outcome choice, worded without "allocation" (U-6) — **and gated separately on `reverseReceipt`** (narrower than the `dailyOperations` that gates reading the list), found and fixed before this shipped
- [ ] `WriteOffSheet` and `PostClosureChargeSheet` — **deliberately not built**, not merely deferred. Both need a specific obligation/lease/trip as their entry point; "opened from the close screen with no context" was never the right shape. See the plan's "one queue" table, item 10a
- [x] `Timeline` wired to `GET /api/audit-log/{tableName}/{recordId}` for a corrected payment — **per record, not per month**
- [x] `PERIOD_CLOSED` caught and explained; no client-side pre-check anywhere
- [x] U-2 test on every new form: saves with level-1 fields alone

### B4 · Review shell + phase-1 reports

**Do the palette, the money-to-axis codec and the table primitive before the first chart, not after.**

**Wave 1 — infrastructure**
- [ ] `--color-chart-1…8` in `tokens.css`, light **and** dark, from §11.2's validated values — no raw hex in any component
- [ ] Every new token added to `theme` in `cn.ts` (tailwind-merge drops unknown tokens silently) + a `cn.test.ts` case
- [ ] One isolated money→axis scaling module, unit-tested like the money codec; **no `Number(minor)` outside it**. Tests cover positive, **zero, negative profit, mixed-sign domains**, and a value past `MAX_SAFE_INTEGER` (scale as `bigint` or throw — never a silent lossy convert)
- [ ] A lint-visible reason on the one legitimate ratio (§7.8's `▲ 12% vs June`), following `profitPerKm`'s precedent
- [ ] **Normalised report view-model + shared table primitive first, charts second** — each report defines response → view model → table columns → chart marks, in that order. This is what makes the table view nearly free instead of nine bespoke tables
- [ ] One shared `<PartyName>` — falls back to the party type ("Unnamed driver"), row always rendered
- [ ] A label map per enum (`partyType`, `lostReason`, ageing bucket, `docType`, arrangement) — no raw enum text on screen

**Wave 1 — screens**
- [ ] `/reports` catalogue — **six** cards, gated by `<Can>`, **no phase-2 route registered**
- [ ] Parameter collection before fetch, **URL-backed**: `/reports/:key?…` validates its search params and renders the parameter form when they are missing, so the route is never dead and a report is linkable between partners. `from > to` caught at parse, before any fetch
- [ ] Parameters needed: **`periodId`** (from `GET /api/accounting-period`, defaulting to the open period), **vehicle picker** (`EntityPicker`, UC-72), **date window** (UC-72 → last 90 days; UC-76 → the open period)
- [ ] `/reports/:key` — **six** screens, each in §11.1's specified form
- [ ] UC-75 titled **"Cash partners are holding"** until GAP-70 lands (a test asserts the narrow title while the response has no `banked` field) — **GAP-70 landed 10 Aug 2026 (item 12b); the title is "Where is our cash" now**
- [ ] Review shell's other three tabs — `This month` (§7.8's layout, minus overheads), `Vehicles` (**one vehicle × all periods**, sharing `VehiclePerformanceCard` with `This month`), `My money` (`GET /api/partner/{userId}`, read-only)
- [ ] `This month`'s **"What I'm owed"** row — UC-67's all-time balance, now `balanceMinor` on `GET /api/partner/{userId}` (GAP-74, ✅ done 8 Aug), **`holdingMinor` never netted in** (W-2's shape). Keep the label: U-6 names "what you're owed" as the approved wording
- [ ] Warning strip from `GET /api/home/paperwork-warnings`, filtered to `subjectType === "vehicle"` — one call, not N+1, and no client-side threshold logic
- [ ] Read-only `ReviewVehicleScreen` — **not `VehicleOverviewScreen` with actions gated off** (§7.8: no entry affordance anywhere)
- [ ] **Owner-manager's `More → My share`** — one row, one route, the same components read-only (UI line 148)

**Wave 1 — rules and tests**
- [ ] **Every chart has a table view one tap away** (§11.3) — required, not polish
- [ ] Direct labels on any chart using the three low-contrast light slots (§11.2)
- [ ] `NotAvailable` **in place of the mark** with the reason in the caption wherever a value is `null` (§11.4) — never a zero-height bar
- [ ] A test per report against an **empty** and a **partial** fixture asserting **the right thing**: `NotAvailable` only where the metric cannot be computed (UC-72's missing fill pair), and a true-zero message where it can ("No one owes us anything", "No closed trips yet"). **Not `NotAvailable` for every empty response** — W-56 governs an unknown, not an absent one
- [ ] A `driver` cannot reach `/reports` at all (route-level). *`viewOwnerOnlyReports` has no caller in B4 — both owner-only reports are phase 2*
- [ ] First accounting period: **omit the delta line**, not `0%` and not `NotAvailable`
- [ ] Negative profit renders correctly in a bar **and** a table
- [ ] Golden fixture: the per-vehicle card reads **134,000** (`180,000 − 46,000`) — that is the vehicle's *profit*, not the hero's *share*
- [ ] No pie charts, no dual axis, one chart per viewport, charts scroll in their own container (§11.3)
- [ ] No accounting vocabulary in any title, axis label or caption (U-6)

**Wave 2 — after three Track A increments — ✅ done 10 Aug 2026**
- [x] **GAP-41** — `GET /api/reports/overheads?periodId=`, then the overheads block as **its own block** beneath vehicle totals (W-32) — done 8 Aug, ahead of this wave
- [x] **GAP-70** — cash position gains `banked` + `driverAdvances`; UC-75's title reverts to "Where is our cash". `listBankedByDestination`/`listAdvancesOutstandingByDriver` (`queries/reports.ts`), kept arithmetically consistent with `heldMinor`'s own simplification rather than a corrected version of it
- [x] **GAP-71** — lost-day reasons; UC-76 gains its reason chart, plus the "column per month" primary chart UI §11.1 actually asked for. `lostDaysResponseSchema` restructured to `{ byWeekday, byMonth, byReason }` — a breaking wire change, absorbed in one pass

**Not in B4** — UC-73 (GAP-18), UC-77, UC-78, UC-79: all phase 2 per FL §9.2's own per-row column. **GAP-72 is the exception and does not wait for its screen** — a live wrong number in `sumGoodwillGiven`, one predicate, unblocked by anything here.

### B5 · Mine shell

- [x] Route `/me` + `MineScreen` in `web/src/features/mine/` — **its own component tree**, sharing no screen with Operate (§7.9)
- [x] `GET /api/driver-view` wired; `TwoBalances` at the top, never netted (W-2)
- [x] Days rendered **including excused ones** (§7.9)
- [x] Trips and fees, advances, offsets, held deposit
- [ ] Statement link producing the same content as the printed slip (UC-57)
- [x] **Zero write affordances** — asserted by a test that fails if any mutation button appears in the success tree
- [x] **No `driverId` anywhere in the driver-view call** — `/me` reads `GET /api/driver-view`, with no id prop or route param (INV-25)
- [x] Staff driver history read — `DriverDetailScreen` calls `GET /api/driver/{id}/view` and reuses the same activity sections without adding Mine's read-only boundary to Operate

### B6 · Customer detail

- [x] `/people/customers/:id` replaces `PlaceholderDetailRoute`
- [x] `GET /api/customer/{id}/obligation` + `/payment` wired (both A4), plus `GET /api/customer/{id}` for the heading/details
- [x] Collect-payment path reuses `CollectPaymentSheet` and invalidates customer dues/payments after success
- [x] Vehicle paperwork write (GAP-102) — `VehicleOverviewScreen` opens `RenewVehicleDocumentSheet`, posts `PUT /api/vehicle/{id}/document`, and refreshes paperwork/home warnings
- [ ] Statement view

### B2 · Partners, banking, cash

- [x] Routes `/cash` and `/partners/:id`; **no `/partners` list route** — the partner list is a section on `/cash`, fed by `cash-position`
- [x] `PartnerDetailScreen` over `GET /api/partner/{userId}` (A2)
- [x] Initial `OwnershipSharesForm` — submits the **whole set in one write**, shows the 100% total before save, and leaves `OWNERSHIP_SHARES_INVALID` to surface as the server truth if it still occurs
- [x] `CapitalContributionSheet` — capital rendered as capital, never as ownership (W-52)
- [x] `ShareVehicleForm` (F-1.4) — creates and revokes management agreements; overlap is still the API's `EXCLUDE`/409 truth, not client-side date math
- [x] `BankingEventForm` — bearer required exactly when recorded ≠ counted, offering **only** `absorbed` / `unattributed`
- [x] `CashPositionScreen` — deposits held shown **beside** partner cash, never netted into it
- [x] `BorneByPaidBy`'s paid-by picker wired to `GET /api/business-member` (GAP-31's remaining half)
- [ ] **No UI implying per-vehicle capability scoping exists** (GAP-1)
- [x] **`MileagePackageForm` (F-1.9, GAP-67)** — create/list/archive are now reachable under More. Archiving a package never reprices an existing lease — terms are copied onto `Lease.mileage_terms` at selection, independent thereafter
- [x] **`RecordPayoutSheet` (F-7.2, GAP-69)** — `PartnerDetailScreen` records payout/settlement through `POST /api/partner-payout`; never a vehicle cost

### B9 · `UI-UX-REVIEW.md` fixes

- [ ] GAP-44 — copy decided for the double-booking inline fix, then `Dialog` wired to `VEHICLE_DOUBLE_BOOKED` in both `StartLeaseScreen` and `BookTripScreen` (not the raw error message)
- [x] GAP-45 — `formatShortDate`/trip-detail title show the year only when the range crosses one; verified not to clip at 360px
- [x] GAP-46 — occupied calendar cells get an `aria-label` naming the state, matching the free-day cells' existing pattern
- [x] GAP-47 — app bar collapses to 44px and tab bar goes icon-only at 44px below `md` in landscape; primitive tests pin the shared chrome classes, with browser/device verification still useful before release
- [x] GAP-48 — `Toast` primitive built, wired into `#toast-root`; no fake undo call sites were added, and qualifying writes still need per-flow domain decisions
- [x] GAP-55 — `autoComplete="name"` on the "Add a driver" form's Name field
- [x] GAP-76 — field-specific Zod messages on `CreateDriverForm`'s `name` and `CreateVehicleForm`'s `registration`/`vehicleType`, matching `CreateCustomerForm`'s existing pattern
- [x] GAP-78 — `DriverDetailScreen`/`TwoBalances` render the driver's name once, not as both `Screen` title and body `<h2>`
- [x] GAP-79 — incident row fallback copy carries more than "No description recorded" where type/cost/recovery status is available
- [x] GAP-80 — the three `NotAvailable reason=` strings naming "Web-P8b" or "not built yet" rewritten as product copy, in `TripDetailScreen.tsx`, `RecordExpenseSheet.tsx`, `FuelFillSheet.tsx`
- [x] GAP-81 — a "Void expense" action (reason required) added to the expense rows on `VehicleOverviewScreen`, `TripDetailScreen`, `IncidentScreen`, calling the existing `POST /api/expense/{id}/void`; voided row stays visible, struck through, with its reason
- [ ] The nested-`Sheet`/`AmountPad` question manually verified on a real browser before this item is called done — filed as a new gap only if it reproduces
- [ ] `npm run check` clean; axe-core clean on the calendar and any new Dialog, both themes

### B16 · Visual semantics pass (UI-LF)

- [x] `Badge` primitive (`brand`/`good`/`warning`/`serious`/`critical`/`neutral`), `rounded-full`, added to UI §6.1
- [x] `Card` gains an optional `accent` left-border prop; radius unchanged (12px, per spec)
- [x] `AppShell` active tab gains a visual marker beyond text colour
- [x] Vehicle/People list + overview: `Badge` for arrangement/incident status, `ChevronRight` on nav rows, `ARRANGEMENT_LABEL` consolidated
- [x] `ExpenseCostRow`: `Badge variant="critical"` for a voided row, reason in `text-critical-ink`
- [x] `MoreScreen`: `ChevronRight` on nav rows, `warning` accent on "Close the month"
- [x] `VehicleCalendarScreen`: all six states get their own token; legend matches
- [ ] Phase 2 — `Section` header treatment, `EmptyState`/`NotAvailable` variants
- [ ] Phase 3 — reports catalogue grouping, Review-shell money-direction consistency (needs the outstanding merge to verify on hosted QA)
- [x] `npm run check` clean

### B7 · Offline and the PWA — last

- [ ] TanStack Query persistence + the paused-mutation queue (M-12)
- [ ] Replay with a **fresh token per attempt**; a 401 on replay pauses and re-authenticates, **never discards** — a discarded mutation is a lost money record
- [ ] Eviction warning while the queue is non-empty
- [ ] `OfflineBanner` finally given a caller (it has zero today)
- [ ] Runtime caching, stale-while-revalidate reads, short TTL on money reads (§12.5)
- [ ] iOS "Add to Home Screen" hint, dismissible forever
- [ ] **Verify `HomeScreen`'s skeleton branch**, reachable for the first time once a warm cache exists
- [ ] Decide `Provisional`'s fate — 0 callers, and this is the only item that could claim it. Record either way

### The gate every one of these clears

- [ ] 360 × 640, one thumb, no horizontal scroll; reflows at 320px
- [ ] 44 × 44 minimum, ≥ 8px apart, ≥ 16px when one is destructive
- [ ] Money `string` on the wire, `bigint` in the client, **never `number`**
- [ ] `Rs 0` and `NotAvailable` visibly different
- [ ] `--color-*` tokens only; colour never carries meaning alone
- [ ] Reserved vocabulary, never abbreviated; no accounting words
- [ ] New token → `cn.ts`; new form → the three structural fixes (TRACKER §5)
- [ ] `npm run check` clean; axe-core clean, both themes
- [ ] TRACKER.md updated: the item becomes a **row**, its leftovers become **gap rows with a track**

---

## How the tracks run

```
        Track A (Worker + shared schemas)          Track B (React client)
        ─────────────────────────────────          ──────────────────────
done    A1  GET /api/expense ✅                     ~~B1 ExpenseListScreen~~ withdrawn
        A2  partner/banking/cash + members ✅        B0  the /more hub + sign-out ✅
        A3  period/write-off/payment ✅              B8  real Asgardeo ✅
        A4  customer reads ✅                        B2  partners, banking, cash — ready (A2 ✅, B0 ✅)
        A5  driver history ✅                        B3  close the month, corrections — ready (A3 ✅, B0 ✅)
        A9a the void/period trigger ✅                B6  customer detail — ready (A4 ✅, B0 ✅)
        A6  trip receivable ✅                        B2  partners, banking, cash — ready (A2 ✅, B0 ✅)
        A11 member and driver access ✅               ~~B11 structural render fixes~~ ✅ done 7 Aug
        A12 borne-by by date + trip receivable ✅     ~~B10 set up the daily lease~~ ✅ done 7 Aug
now     A10 the other two silent zeros                 B0b three shells + capability gate  ← first
        A13 change arrangement (GAP-54, F-1.2)
        GAP-41 overheads filter (B4 needs it)
        A7  R2 upload (expense receipts only;          B3  close the month  (needs B0b)
            planned, own branch; independent)
        A8  odometer wiring, borne-by preview          B4  Review shell + 9 reports (needs B0b, GAP-41)
        A9b the rest of soft delete                    B5  Mine shell      (needs B0b)
        —   in-app "invite a member" screen             B9  UI-UX-REVIEW fixes — ready (GAP-44–48, GAP-55)
            (unsized, needs B0b — A11 built the API)
        —   GAP-1 per-vehicle scoping — reachable
            since A11; needs a design call, not a slot
        —   GAP-58 test manifest: 178 cases, 0 run
last                                                B7  offline and the PWA
```

**Track B's "first" item changed three times now, each time because of a live or build-time signal, not a design read.** B0b held that slot from the 6 August validation pass until a live browser session the same day found two shipped bugs (B11) and one wholly unbuilt core flow (B10) that outranked it. Both are done (7 Aug), and **A11 shipping the same day hands the slot back to B0b** — the newly-reachable `owner`/`driver` accounts have nowhere to land without it. **B3, B4 and B5 still queue behind B0b**, which is small; B6, B2 and **B9** need neither B0b nor anything on Track A, so they are the items a second person can start on immediately without waiting on B0b either.

**Track A's remaining items are now all independent again.** A9a (the GAP-35 trigger fix) gated A6 and A10, because both add new places the defect could have fired — it shipped 5 August, so A6, A10, A7 and A8 can all be picked up in any order.

**One Track A → Track B handoff reopened, briefly: A11 → B0b.** Every other handoff (A2 → B2, A3 → B3, A4 → B6, A5 → B5+) has happened, and B0 shipped 5 August — every other item in Track B's column above is buildable right now. A10, A7, A8 and A9b change what *existing* endpoints return or add a batch of near-identical writes, rather than unblocking a new screen — A7 is the closest to an exception, and its dependent screens are photo work no B item currently claims.

---

## The bar every item clears

Unchanged, restated so no session goes looking:

- **360 × 640, one thumb, no horizontal scroll**, and it still reflows at 320px.
- **Every create form saves with level-1 fields only** (U-2) — an automated test, not an intention. Every existing form has one; match the wording ("saves with X alone") so they stay greppable.
- **44 × 44 minimum**, ≥ 8px apart, ≥ 16px when one is destructive.
- **Money is `string` on the wire, `bigint` in the client, never `number`.**
- **`Rs 0` and `NotAvailable` are visibly different things.**
- **No raw hex** — `--color-*` tokens only, and colour never carries meaning alone.
- **Reserved vocabulary, never abbreviated**, and no accounting words at all.
- **New token → add it to `theme.text`/`theme.spacing` in `cn.ts`**, or tailwind-merge silently drops it (TRACKER.md §5).
- **New form → inherit the three structural fixes** (TRACKER.md §5): domain-typed form state with `toWire()` only in `mutationFn`, `blankToUndefined` on optional text, `Disclosure forceOpen` on a level-2 error.
- **A new money table is not finished until it is in the `assert_period_open()` array** (Track A only).
- **A new write to a `posted_period_id`-carrying table must open a transaction**, or its audit row records `changed_by` as `NULL` (Track A only).
- `npm run check` clean across all three workspaces — **and, for Track A, the touched integration file re-run locally** (`check` does not include the integration suite at all, by design). **Do not chase the full local suite past that.** It runs against the long-lived shared branch every session contends for and has produced repeated, undiagnosable flakiness (TRACKER.md §5); `integration.yml` provisions a fresh ephemeral branch per PR and has none of that contention — A9a's own verification (5 Aug) ran 378/378 clean in one pass on a throwaway branch, no flakes, where the shared branch has needed re-runs before. Push the touched-file-verified commit, open the PR into `develop`, and let CI carry the full-suite cost while the next item starts — don't block on a local run CI is about to do anyway.
- **a11y is axe-core in Playwright**, not `eslint-plugin-jsx-a11y` — its peer range caps at ESLint 8/9 and this repo is on 10.
- [TRACKER.md](TRACKER.md) updated: the item becomes a **row**, its leftovers become **gap rows with a track**.

---

## Skipped by decision

**R2 presigned uploads** — carried as **A7** rather than dropped, because the previous edition skipped it and the cost has compounded: five recorded gaps, a built-and-tested `photo-pipeline.ts`, and a `PhotoCapture` component with 0 callers, all waiting on one endpoint against an already-polymorphic `attachment` table.

**Per-vehicle capability scoping (GAP-1)** — backend hardening, out of scope on both tracks. Until it lands, an `owner_manager` shared one vehicle reaches every vehicle's capital, payouts and reports. It blocks no screen and closing it later forces no rework, since endpoint shapes do not change — **but B2 must not imply the scoping exists.**

**Error monitoring (GAP-28)** — deferred deliberately, not forgotten. Workers Logs stays the only observability until there is an on-call person and a channel to page.

**Also out, and recorded in [TRACKER.md](TRACKER.md) §4:** UC-73 (yearly) and UC-99 (export), both product-phase Second · UC-79's `revenuePerAvailableDayMinor` (GAP-19) · F-8.4's deposit-apply (GAP-6) · void-and-replace for the other twelve W-50 tables (GAP-12) · everything under "Not in this tracker".

---

## The things that were not code — all of them now done

This section listed the external work that gated something real. **It is empty.** Kept as a record, because two of the three cost far more than their entry said they would.

1. ✅ **Asgardeo's console change** — 5 August 2026. JWT token type, PKCE mandatory, hybrid flow off, four redirect URLs. **This entry read "ten minutes, blocks nothing else" and both halves were wrong**: it blocked every deployed login, and the client work behind it was unbuilt and unsized. See B8.
2. ✅ **Deployment** — 5 August 2026. Both environments live, both Neon branches migrated, deploy-on-merge for each. It needed **no application code at all**, because every route already sat under `/api/*` and the client already defaulted its base URL to `""`.
3. ✅ **CI's integration workflow** — below.

**The one still outstanding is P14's twelve Meta template approvals**, and it is the only thing on either track waiting on anybody else. Worth firing now regardless of when P14 runs — each approval is minutes to two days, and they queue.

**Done, 5 August 2026: CI's integration workflow.** Was blocked on `secrets.NEON_API_KEY`/`vars.NEON_PROJECT_ID`, absent from the repo — no endpoint had ever been tested by CI at all. Configured via the Neon GitHub App and verified with a real PR run: all seven migrations applied from scratch, the DM §13 drift check, and all 328 integration tests, green, in 12m49s. One live bug surfaced and fixed along the way — Neon's Free plan rejects an explicit `suspend_timeout` on branch creation outright, even at the value it already defaults to — recorded in [TRACKER.md](TRACKER.md) §5 so it isn't rediscovered. Nothing on either track depended on this, but it was the single highest-value non-code fix available, and it's done.

---

## When an item here is finished

Write it up in [TRACKER.md](TRACKER.md) as **one row**, not a section — what it delivers, its proof with real test counts, and a gap id for anything it did not build. Tick the row off here and move on. This file is a plan and goes stale; that one is the record.
