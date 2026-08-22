# Code Audit — 2026-08-22

A file-by-file static/logical review of the repository, started after validating the open
review threads on PR #93. Findings are recorded here as they are found; **nothing in this
document has been fixed** — it is a read-only audit. Each finding cites `file:line` against
`develop` at commit `66a265f` and states the concrete failure scenario, not just a stylistic
objection, per the root `CLAUDE.md`'s own standard ("a number that is wrong, plausible, and
not noticed until someone argues about it months later").

Severity key: **Critical** (wrong money/tenancy leak/data loss), **High** (real bug, narrower
trigger), **Medium** (real but low-frequency or low-impact), **Low** (style/maintainability,
no behavioural effect), **Note** (observation, not a defect).

Status key: **Open** (unfixed, needs a decision or a fix), **Already fixed** (flagged by a
prior review, code has since moved on), **Accepted trade-off** (a deliberate, documented
choice — recorded so it isn't re-litigated).

## Executive summary

The backend (30 migrations, the full ~10,546-line domain layer, the money/date/split codec)
was read in full. It is exceptionally disciplined — most hypotheses formed while reading it
turned out to already be caught, fixed by a later migration, or explicitly accepted and
documented in-code (a level of self-review well above typical). Across that entire backend
pass, **one new bug** surfaced (#1 below) plus three minor notes already substantially
mitigated. The web client got a targeted read of its money/date/form primitives plus a
pattern-based sweep of all ~200 files, which surfaced **one substantial finding** (#2 below) —
a real, previously-undiscovered accessibility gap, larger in scope than the one the PR #93
bots already found and got fixed.

**Open items, ranked by what to act on first:**

1. **[High]** Six-plus shared UI primitives (`Screen`, `Sheet`, `Dialog`, `Toast`,
   `NotAvailable`, `AmountPad`, and two feature screens) have hand-rolled buttons with no
   keyboard focus indicator — see *`web/src` — findings* #1. Affects nearly every screen.
2. **[Medium]** `assessMileage` 500s instead of giving a clear error when a mileage reading is
   backdated to a lease's own start date — see *Domain layer — findings* #1.
3. **[Open, from PR #93]** `VehicleMonthReportScreen`'s "No activity this month yet" hint is
   keyed off the wrong figure — see Part 1, row 6.
4. Everything else recorded below is either already fixed, an accepted trade-off, or a Note
   with no required action.

---

## Part 1 — PR #93 review-thread validation

Six inline review comments exist on PR #93 (`develop` → `main`), from `gitar-bot`, two
Copilot passes, and SonarQube's Quality Gate. Checked against `develop`'s current tip
(`66a265f`), not the diff each bot originally commented on.

| # | Source | File | Verdict |
|---|--------|------|---------|
| 1 | gitar-bot | `api/scripts/ledger-audit.mjs` — loop aborts on first SQL error, leaks the pool | **Already fixed.** `ledger-audit.mjs:189-207` wraps each check in its own try/catch and calls `pool.end()` in a `finally`. |
| 2 | Copilot | `web/src/features/reports/ReportScreen.tsx:49` — Chart/Table toggle has no `focus-visible` ring | **Already fixed.** Line 45 applies the shared `rowButtonFocus` class. |
| 3 | Copilot | `web/src/design/primitives/AppShell.tsx` — business-switcher button has no `focus-visible` ring | **Already fixed.** `rowButtonFocus` applied at line 116, and consistently on the sibling `onExit` button (line 135). |
| 4 | Copilot | `web/src/components/SignOutRow.tsx` — sign-out button has no `focus-visible` ring | **Already fixed.** Line 28 has `rowButtonFocus` + `rounded-sm`. |
| 5 | Copilot | `web/src/lib/formatShortDate.ts:17` — parses in local time, can disagree with `DateField.tsx`'s UTC convention | **Already fixed.** Formatter now sets `timeZone: "UTC"` and parses `${date}T00:00:00Z`. |
| 6 | Copilot | `web/src/features/reports/VehicleMonthReportScreen.tsx:101` — "No activity this month yet" keyed off `profitMinor === 0n` | **Open — real bug.** `profit = earned − costs` (`toKpiTotals`, lines 38-40), so a vehicle with equal earned and costs nets to 0 and wrongly shows "no activity" despite a real month. `earnedMinor`/`costsMinor` are already on the row (used two lines below, 109/113). Shared by `VehicleYearReportScreen` via the same `VehicleRow`, so one fix covers both screens. |

**Also currently failing (independent of the six threads):** SonarCloud's Quality Gate on
the latest commit — 3.4% duplication on new code vs. the ≤3% requirement. `ledger-audit.mjs`
lines 23-41 document this as a deliberate trade-off (flattening the twelve tenancy checks
into a data table was tried and made the duplication metric worse, 13%→57%, so it was left
inline) — **Accepted trade-off**, but the check is still red and will block merge under
branch protection unless overridden or the gate config is adjusted.

---

## Part 2 — Full codebase audit

*In progress. Findings added as each area is completed; see the running log below.*

### Areas covered so far
- ✅ `api/migrations/0001` – `0030` (all 30 migration files, full schema history)
- ✅ `packages/shared/src/money.ts`, `split.ts`, `dates.ts` (the money/date codec — no defects found; the largest-remainder splitter, the money formatter, and the business-date/UTC-anchoring helpers are all correct by inspection)
- ✅ `api/src/domain/*` — **all 34 files, the full ~10,546-line domain layer**, read in full: `accounting-period`, `obligation`, `obligation-status`, `mileage`, `confirmDay`, `credit-forward`, `offset`, `payment`, `trip` (1130 lines), `advance`, `write-off`, `adjustment`, `deposit`, `incident` (755 lines), `partner` (635 lines), `dailyLease`, `day-card-generation`, `expense`, `lease-closure`, `opening-balance`, `membership`, `vehicles`, `management-fee`, `post-closure-charge`, `party-archive`, `home`, `business-creation`, `setup`, `invite-code`, `attachment`, `lease`, `billing-period`, `reports` (678 lines), `platform-admin`, `driver-view`
- ✅ (substantial, not exhaustive) `api/src/queries/*` (9,715 lines total) — full reads of
  `identity.ts`, `vehicle-scope.ts`, `obligation.ts` (642 lines), `driver-money.ts` (729 lines),
  and the first half of `trip.ts`; every remaining file's function-name inventory scanned for
  tenancy-scoping naming conventions. `getDriverOwnView`/`listDayRecordsForDriver` and
  `getDriverHistoryHandler` (the W-49 linked-driver boundary) verified in full and found
  correctly scoped and tested. `reports.ts` (1631 lines, the largest file in the repo) read
  through line ~1080 (all the per-vehicle earned/costs bulk-sum functions, the receivables/
  ageing/cash-position/banked/advances queries) — correct throughout, including one place
  (`findOwnershipSharesAsOfBulk`/`listOwnershipShareHistoryForVehicles`) where the code
  explicitly orders by `id` (UUIDv7 = insertion order) specifically because `splitInteger`'s
  remainder tie-break depends on row order, which an unordered `SELECT` would leave to the
  query planner — the exact class of subtle nondeterminism bug this audit was hunting for,
  already caught and fixed by the team. Not yet read: `reports.ts`'s last ~550 lines
  (lost-days, off-road/utilisation, transactions-CSV — the query side of domain files already
  read in full), `partner.ts`, `vehicle.ts`, `incident.ts`, `expense.ts`, `day-record.ts`,
  `dailyLease.ts`, `accounting-period.ts`, `business.ts`, `scheduled.ts`, and the smaller files.
- ⬜ `api/src/route-defs/*`, `api/src/routes/*` (only three `handlers/*.ts` files read directly, wiring-only, low intrinsic logic risk)
- ✅ `api/src/middleware/auth.ts`, `api/src/auth/context.ts`, `api/src/auth/policy.ts` — the
  full tenancy-resolution chain (JWT → membership → `businessId`) and the capability matrix,
  both read in full. No defects — this is the exact mechanism CLAUDE.md calls "the whole
  multi-tenancy bug" if done wrong, and it is done right: the `X-Business-Id` header only ever
  narrows a server-resolved membership set, `businessId` is set from the matched row rather
  than the header string, and a foreign business 404s rather than 403s. `policy.ts` documents
  its own known simplification (`managePartnerCapital`/`viewReports` are flat role checks, not
  yet per-vehicle-scoped) — already recorded in its own header comment, not a fresh finding.
- ⬜ `api/src/middleware/db.ts`, `logger.ts`, `platform-admin.ts`, `rate-limit.ts`
- ✅ (targeted, not exhaustive) `web/src/*` — full read of the shared money/date/form primitives
  (`Money`, `MoneyField`, `AmountPad`, `NotAvailable`, `TwoBalances`, `AllocationPreview`,
  `BorneByPaidBy`, `formatTimestamp`, `formatShortDate`, `Button`, `Screen`, `Sheet`, `Dialog`,
  `Toast`) plus several feature screens (`TripDetailScreen`, `VehicleOverviewScreen`,
  `VehicleMonthReportScreen`, `StartLeaseScreen`, `HomeScreen`); **and** a codebase-wide grep
  sweep of all ~200 `.tsx`/`.ts` files for known risk patterns (below). Not a line-by-line read
  of every feature screen — roughly 20 of ~200 files read directly, the rest covered only by
  the pattern sweep.
- ⬜ `api/scripts/*` beyond `ledger-audit.mjs` (already covered under PR #93)

Codebase-wide greps run for common bug classes across both `api/src` and `web/src`, no new
hits beyond what's listed below: raw `new Date()` outside sanctioned call sites (zero hits in
`web/src` — confirmed every date is threaded from `businessToday()`), `Number(...Minor)`
outside the two already-documented sanctioned display-ratio exceptions, `?? 0`/`?? 0n` on
money fields (all hits are legitimate zero-is-a-fact cases, not missing-data masks),
`type="number"` on an actual money field (all hits are km/day-count fields, correctly using
`MoneyField` for real money elsewhere on the same screens), `100vh` (zero hits — `100svh`
used throughout), U-2 "required" fields (every hit found is a documented level-1 field, none
a level-2/3 violation), and TODO/FIXME/HACK markers (none exist in `api/src`).

### Migrations — findings

This area is unusually well self-audited already: nearly every migration's header comment
documents a bug found by exactly this kind of reasoning (drift in `assert_period_open()`'s
array, a plain UNIQUE index blocking re-use of a voided row's key, a trigger CHECK written
with only a human actor in mind). Two things below were followed to ground; both turned out
to be already handled, recorded here so they aren't re-litigated as fresh findings later.

1. **[Note] `assert_period_open()`'s trigger attachment is hand-maintained, unlike
   `write_audit_log()`'s.** `0001`'s `FOREACH` block (lines 949-962) explicitly lists the 19
   tables needing the period-open trigger. `0002` (lines 65-91) made the *audit* trigger's
   attachment catalog-driven ("every table carrying `posted_period_id`") specifically
   *because* a hand-maintained list had already drifted once (the same lesson CLAUDE.md and
   `.claude/rules/sql.md` both cite). `assert_period_open()`'s own attachment was never given
   the same treatment — it is still exactly the kind of list that class of fix exists to
   eliminate. Every migration since has manually reasoned through whether a new table needs
   it (and so far, correctly, every one has) but the mechanism itself still depends on that
   diligence continuing forever, on every future migration, rather than being structurally
   impossible to forget. **Suggestion (not applied):** convert `assert_period_open()`'s
   attachment to the same `pg_attribute` walk `write_audit_log()` uses, removing the class of
   bug rather than continuing to rely on manual review catching it.

2. **[Already handled] `platform_admin` bootstrap trigger requires `fleetsettle.actor_id` to
   be set, or the very first insert 500s.** `write_platform_admin_audit()` (`0030`, lines
   110-122) inserts into `platform_audit_log(actor_id ...)` with `actor_id uuid NOT NULL`,
   reading the actor via `audit_actor()` — which returns `NULL` unless
   `fleetsettle.actor_id` was set on the session. The bootstrap path for the *first* platform
   admin is a manual SQL insert with no HTTP request behind it, so nothing sets that session
   variable unless the operator does it by hand. Checked whether this was really live: it is,
   and it is already known — `PLATFORM-ADMIN-AND-MULTI-BUSINESS-IMPLEMENTATION-PLAN-2026-08-17.md`
   §12 step 5 explicitly documents `SELECT set_config('fleetsettle.actor_id', …)` as a
   required first statement "**or the insert 500s**". Not a fresh finding — flagged here only
   because re-running that exact bootstrap in a future environment (DR, a new QA branch reset)
   depends on a human reading that runbook line correctly every time, with no code-level
   guard against skipping it.

### Domain layer — findings

1. **[Medium] `assessMileage` can throw a raw unhandled DB error instead of a validation
   message when a mileage reading is submitted for the same date as the lease's own handover
   reading.** `lease.ts:89-99` inserts the handover `odometer_reading` directly
   (`leaseId` + `readOn: input.startDate`), completely outside `assessMileage`'s own flow —
   it has no `mileage_assessment` pointing at it. `assessMileage`'s idempotency check
   (`mileage.ts:77-85`) assumes the opposite: that *any* existing `odometer_reading` row for
   `(leaseId, readOn)` must have come from a prior `assessMileage` call, so it looks up the
   assessment via `findMileageAssessmentByToReading` and returns early if found
   (`replayAssessment`, `mileage.ts:257-274`). If a mileage reading is ever submitted with
   `readOn` equal to the lease's `startDate` (a backdated/same-day entry — nothing validates
   against it, and CLAUDE.md itself requires backdating to be supported), the up-front replay
   check finds the handover reading, `findMileageAssessmentByToReading` correctly finds no
   assessment for it, and the function falls through to treat the handover reading as
   `previous` (`mileage.ts:87-97`, `findLatestOdometerReadingForLease` returns it since it's
   the only/latest reading for the lease) and then tries to insert a *second*
   `odometer_reading` row for the same `(lease_id, read_on)` pair — violating
   `odometer_reading_lease_id_read_on_key` (migration `0005`). The `catch` block
   (`mileage.ts:242-253`) re-runs the exact same replay lookup, which again finds no
   assessment, so `replayed` is `undefined` and the original Postgres unique-violation is
   re-thrown verbatim (`mileage.ts:253`) instead of being mapped to a `ValidationError`. Net
   effect: submitting a mileage reading dated on the lease's own start date 500s instead of
   giving a clear message, and retrying the identical request 500s again every time (it isn't
   a transient race — the same collision reproduces deterministically). No money is written
   incorrectly (the transaction rolls back cleanly), so this is a reliability/UX gap rather
   than a wrong-number bug, but it is a real, reproducible unhandled-error path.
   **Failure scenario:** create a lease with an odometer handover reading on 2026-08-01, then
   call `assessMileage` with `readOn: "2026-08-01"` (e.g. a same-day correction or a backfilled
   first reading) → 500 instead of "a reading already exists for this date" or similar.

2. **[Note] `generateInviteCode` (`invite-code.ts:18-24`) samples its alphabet via `byte % 30`,
   a slight modulo-biased draw** (256 isn't a multiple of 30 — 16 of the 30 characters are
   drawn with probability 9/256 and 14 with 8/256, versus a uniform 1/30 each). Negligible for
   this use case (a single-use, hashed, week-lived invite code, not a password or session
   token) — recorded because it's a real, previously-unnoted deviation from the "~49 bits of
   entropy" the code's own comment claims, not because it's exploitable.

3. **[Note] `requestOrCreateBusiness` (`business-creation.ts:39-52`) has an explicitly
   accepted, in-code-documented race** ("decision 20"): two concurrent requests at exactly the
   allowance threshold can both read the same `activeCount` and both create a business,
   landing an identity above its allowance with no queued request. Already a deliberate,
   reasoned trade-off recorded by the team — included here only for completeness, since it's
   the one place in the domain layer not backed by a DB constraint.

### `api/src/queries` — findings

1. **[Medium] The Lease Hub's "every obligation this lease has ever raised" is missing every
   incident-driven customer contribution.** `findObligationsForLease` (`queries/obligation.ts:593-642`)
   unions exactly three source paths — `sourceType='lease'` (post-closure charges),
   `sourceType='billing_period'` (rent), `sourceType='mileage_assessment'` (mileage excess) — and
   its own comment describes this as the complete set ("this is three source paths"). A fourth,
   real source is never included: `recordCustomerContribution` (`domain/incident.ts:236-335`)
   raises an `owed_to_us` obligation with `sourceType: "incident_recovery"` whenever an incident
   agrees a customer contribution — and by construction *every* such obligation belongs to a
   lease (the function requires `existing.leaseId` to exist at all, since "no lease means no
   customer, and a contribution nobody can be billed to is not a receivable"). `LeaseHubScreen.tsx`
   fetches only `GET /api/lease/{id}/obligation` (`handlers/lease.ts:216-242`, backed by this
   query) with nothing merging incident recoveries in — confirmed by reading the screen, which
   has no reference to incidents at all. The frontend is otherwise fully prepared to show one:
   `obligationStatusLabel.ts:35` already has a `"Customer contribution"` label mapped for exactly
   this `kind`. **Net effect: every incident-driven customer contribution obligation is invisible
   on the one screen ("Web-P6b's lease hub") whose own doc comment claims to list everything a
   lease has raised** — a manager working from that screen would see a shorter, more-collected-
   looking list of dues than the lease's real receivables, with no "not available"/gap indicator
   telling them something is missing. No money is mis-posted (the obligation is created and
   collectible correctly via the incident's own screen); this is a completeness gap on a
   specific aggregation view.
   **Fix shape (not applied):** add a fourth source clause to `findObligationsForLease` —
   `sourceType='incident_recovery'` filtered to incidents where `incident.leaseId = leaseId` (a
   join or a pre-resolved id list, the same two-round-trip shape the function already uses for
   `billingPeriod`/`mileageAssessment`).

### `web/src` — findings

1. **[High] Six core, app-wide UI primitives have hand-rolled icon buttons with no `focus-visible` ring — the same accessibility class PR #93 fixed in three narrow spots (`ReportScreen`, `AppShell`'s business-switcher, `SignOutRow`) is still missing from the shared components almost every screen renders through.** The codebase's own established convention is unambiguous: `Button.tsx` (`design/primitives/Button.tsx:16`) bakes
   `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-focus-ring`
   into every variant unconditionally, and `rowButtonFocus` (`lib/rowButtonFocus.ts`) exists specifically to give the same treatment to hand-rolled buttons that can't use `Button`. Six more hand-rolled buttons never got either:
   - `design/primitives/Screen.tsx:63-69` — the **back button** on every screen using this shell (i.e. nearly every screen in the app).
   - `design/primitives/Screen.tsx:76-83` — the header **action button** (e.g. every screen with a right-side icon action).
   - `design/primitives/Sheet.tsx:97-100` — the **close (✕) button on every bottom sheet** in the app (`Drawer.Close`).
   - `design/primitives/Dialog.tsx:36-40` — the **close (✕) button on every dialog**.
   - `design/primitives/Toast.tsx:106-110` — the **dismiss button on every toast**.
   - `components/NotAvailable.tsx:26-33` — the "why is this not available" info button, rendered anywhere a figure degrades to `NotAvailable` (W-56 — a common state).
   - `components/AmountPad.tsx:80-88` — every digit/backspace key on the money keypad used throughout the app's create/edit-amount flows.
   - `features/admin/AdminManagementScreen.tsx:92-98` — the **"Revoke admin access" button** (a destructive, security-sensitive action).
   - `features/costs/ReceiptSheet.tsx:347-349` — the close button on the full-screen receipt photo viewer.
   
   Each has `active:bg-brand-wash`/`active:brightness-90`/`active:bg-critical/10` for touch feedback (correct) but nothing for `:focus-visible` — a keyboard user tabbing to a screen's own back button, a sheet's or dialog's close button, a toast dismiss, a NotAvailable info icon, or any digit on the amount pad gets **no visible indication of focus at all**, failing WCAG 2.4.7 on every single screen that uses these primitives — which, since `Screen`/`Sheet`/`Dialog` are the app's own screen/sheet/dialog shells, is effectively every screen. This is a materially bigger instance of exactly the defect the two Copilot review passes on PR #93 already found and got fixed elsewhere; these six were simply outside the diff those reviews happened to run against.
   **Fix shape (not applied):** add `rowButtonFocus` (or an equivalent icon-button-sized ring) to the `className` on each of the seven button elements listed above.

---

## What a continued pass should cover next

This session read, in full: every migration, the entire domain layer, the money/date/split
codec, the full auth middleware/context/policy chain, and roughly two-thirds of `api/src/queries`
— the layers where a wrong number does the most damage per CLAUDE.md's own risk ordering. It
did not reach, at the same line-by-line depth:

- The remaining third of `api/src/queries` (`partner.ts`, the tail of `reports.ts`, `vehicle.ts`,
  `incident.ts`, `expense.ts`, `day-record.ts`, `dailyLease.ts`, `accounting-period.ts`,
  `business.ts`, `scheduled.ts`).
- `api/src/route-defs/*` and `api/src/routes/*` in full, and most of `api/src/handlers/*`
  (only three handler files were read directly) — lower intrinsic logic risk than `domain/`
  and `queries/` since this layer is mostly wiring, but still worth a pass for capability-gate
  mismatches.
- `api/src/middleware/db.ts`, `logger.ts`.
- The remaining ~180 of ~200 `web/src` files at a direct-read level — this session read the
  shared money/date/form primitives in full and ran a systematic pattern sweep (which is what
  surfaced the accessibility finding above) but did not read most individual feature screens
  line by line the way the backend was read.
- `api/scripts/*` beyond `ledger-audit.mjs`.
- Test files were not reviewed for coverage gaps (only read where they confirmed or refuted a
  specific hypothesis while investigating a finding).

Given how consistently the areas that *were* fully read turned out to be either correct or
already self-caught by the team's own process, the queries/handlers/web remainder is the most
plausible place left to find something new — worth a continued pass on the same terms as this
one: read a file, form a concrete failure scenario, verify it against the actual code before
recording it.

