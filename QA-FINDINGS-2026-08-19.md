# QA findings — 19 August 2026

**19 Aug 2026, later the same day — all 7 confirmed findings fixed, same session.** Branch `fix/qa-findings-2026-08-19` off `develop`. Every fix carries its own regression test; full account and gap ids in TRACKER.md's own 19 Aug "later still" §0 entry. Two things the fix pass itself found, beyond the original findings: `lease.final_period_treatment`'s CHECK constraint expects `full_period`/`agreed_figure`, not the domain layer's own `full`/`agreed` — caught before it shipped, would have thrown a raw constraint violation on 2 of 3 modes; F-5's own fix (`formatTimestamp`) had two bugs in its first draft (Invalid Date on Postgres's bare `+00` offset, then a missing `timeZone: BUSINESS_TIMEZONE` silently rendering in the device's zone — exactly CLAUDE.md's Time section), both caught by its own test suite before reaching a browser. See each finding's own **Fixed** line below for specifics.

**Session type**: full end-to-end live application testing, per user request — flows, UI/UX, and number-wise accuracy, against `https://qa.fleetsettle.com`. Follows the standing practice in [LIVE-TEST-PLAN.md](LIVE-TEST-PLAN.md); a confirmed finding here gets promoted to [TRACKER.md](TRACKER.md) §4 with a gap id.

**Precondition check**: `git fetch` confirmed `origin/develop` at `aa0fc3c` (PR #78 merged), `deploy-qa` workflow green on that commit before this session's first click. This is the first live pass since the platform-admin/multi-business initiative (PRs #74–78) landed on `develop` — that whole surface (business switcher, platform admin panel, 6 admin screens, `X-Business-Id` threading) has **never been live-tested** before this session.

Signed in as `nimesha.isholi94@gmail.com` (owner-manager on `TestBusinesByChamath` and `TESTA`, manager on... see membership table below). Dark mode, browser at default viewport unless noted; mobile emulation (360×640 / 390×844) used for phase-1-gated flows per M-1.

Tooling: chrome-devtools MCP against the live site, cross-checked against the QA Neon branch (`br-square-sound-afb68wft`, project `spring-sunset-96946055`) via read-only SQL for every money figure claimed below — the standing discipline this file's predecessors established (a display figure is only trusted once it agrees with the row that produced it).

---

## Businesses available to this account

| Business | id | My role | Vehicles | Drivers | Customers | Active members |
|---|---|---|---|---|---|---|
| TestBusinesByChamath | `01a0188a-5e27-75a8-bde6-1c4633cd341d` | owner_manager | 1 | 1 | 1 | 2 |
| TESTA | `019fd4c9-0360-7655-9e48-7451b488e818` | owner_manager | 6 | 3 | 2 | 1 |
| Nim | `01a018a7-5acb-7109-96cf-20b8d977992a` | — (not a member; owned by a different user) | 0 | 0 | 0 | 1 |

`platform_admin` was **empty on QA** at session start — no bootstrap admin row existed, so the platform admin panel (PRs #74–77, 6 screens) had never been reachable by anyone, live, since it shipped. **Bootstrapped this session, with explicit user approval** (the auto-mode classifier correctly blocked the first attempt as a real privilege-granting write and asked): ran DEPLOYMENT.md §12's own documented procedure (`set_config('fleetsettle.actor_id', …)` + `INSERT INTO platform_admin` in one transaction) against `nimesha.isholi94@gmail.com`'s own user id. Verified via `platform_audit_log`: one `admin_granted` row, `self_action = true`, matching the runbook's own expected verification exactly. **Left in place, deliberately** — self-attributed, fully auditable, revocable any time via the panel itself or a follow-up SQL statement — so the panel stays testable in future sessions without repeating this step.

---

## Summary — 7 confirmed findings, ranked by severity

| # | Finding | Severity | Money-accuracy? |
|---|---|---|---|
| F-6 | Every write in the admin panel (grant/revoke admin, set allowance, approve/reject request) shows a raw JS error despite always succeeding | **High** | No — trust/UX |
| F-7 | Home's "Rent due" goes stale after recording a payment via Quick Add *or* the lease hub — shows the pre-payment amount until a hard reload | **High** | **Yes** — wrong number shown, right number stored |
| F-3 | Lease closure summary shows the gross obligation amount, not net outstanding, for any partially-paid due | **High** | **Yes** — overstates what's owed on the one screen gating a deposit release |
| F-4 | A lease's `closed_at`, `final_period_treatment` and `closure_summary_shown_at` are solicited from the user then never written anywhere | Medium | No — audit-trail gap |
| F-2 | Business switcher shows no indication of which business is currently selected | Medium | No — UX |
| F-5 | Three of the admin panel's six screens show raw, unformatted Postgres timestamps | Low-medium | No — UX/polish |
| F-1 | Home's "Rent due" row says "Due since {date}" even when the date is in the future | Low-medium | No — factual/trust, not money itself |
| F-3b | `trip_fare` (and likely other obligation kinds) render as a raw enum string on the lease closure screen | Low | No — copy only |

**Read together, F-3 and F-7 are the two that matter most against this codebase's own stated promise** ("being believed about money"): both are cases where the *stored* figure is correct but the *displayed* figure is not, on two different high-stakes screens (a deposit-release gate, and the daily Home glance). F-6 is the most severe in absolute terms — it breaks user trust in the brand-new admin surface's every single action — but carries no money risk since nothing it touches is a ledger figure (INV-38: admins never see money).

---

## Findings

### F-1 · Home's "Rent due" row says "Due since {date}" even for a future due date

**Where**: `web/src/features/home/HomeScreen.tsx:509`, `Due since {formatShortDate(row.oldestDueOn)}` — unconditional, no past/future branch.

**Repro**: `TestBusinesByChamath` has one lease against customer "Madura" that starts **22 Aug 2026** (3 days from now, today being 19 Aug). Its first rent obligation (`obligation` id `01a0188f-5b86-…`, `due_on = 2026-08-22`, `amount_minor = 300000`) correctly appears in Home's "Rent due" list — F-4/§7's "Rent due and overdue" spec means *both* belong there, so surfacing it is correct. The row text, though, reads **"Due since 22 Aug"**, which asserts the due date is in the past. It is three days in the future. Cross-checked on `TESTA`, where the other two rent-due rows (14 Aug, 17 Aug) are genuinely in the past and the same label reads correctly there — this only misfires on a not-yet-due obligation.

**Why it matters**: this is a "believed about money" app; "Due since" on a future date tells the owner rent is already overdue when it is not, which could produce a premature follow-up with a customer whose lease has not even started yet. Not a money-accuracy bug (the Rs 3,000 figure and the decision to list it are both correct) — a factual/label bug.

**Suggested fix shape**: branch on whether `oldestDueOn` is on/before business-today — "Due on {date}" (or "Due in N days") for a future date, "Due since {date}" only once it has actually passed. Small, contained to this one call site.

**Severity**: Low-medium (cosmetic/trust issue, not a ledger error).

**Fixed 19 Aug 2026, filed as GAP-138.** `HomeScreen.tsx` gained `dueLabel(oldestDueOn, today)` — "Due since {date}" only when `oldestDueOn <= today`, "Due on {date}" otherwise. New test asserts both a future and a past due row render correctly on the same screen. `npm run check` clean; `web` 134 files/755 tests.

### F-2 · Business switcher sheet shows no indication of which business is currently selected

**Where**: `web/src/features/setup/BusinessSwitcherSheet.tsx:79-97` — `businesses.map(...)` renders every membership row identically; nothing compares `membership.businessId` to the active business, no `aria-current`, no check icon, no style difference (confirmed via DOM: both rows' `className` byte-identical, both `ariaCurrent`/`ariaPressed` null).

**Repro**: Signed in as `nimesha.isholi94@gmail.com`, app bar showed "TestBusinesByChamath" (the active business). Opened the switcher (tap the app-bar business name) — both "TESTA — Owner-manager" and "TestBusinesByChamath — Manager" render as plain equal-weight rows with no marker for the one already active.

**Why it matters**: this is the *only* screen whose entire job is to show and change which business is active — the one place a "you are here" marker is load-bearing. Without it, a user re-opening the sheet mid-session cannot tell whether tapping a row will actually change anything, and on a business list longer than two (a platform admin's own account, or an owner across several fleets) this gets worse, not better.

**Severity**: Medium (UI/UX gap on brand-new, never-before-tested surface — this is the first live pass since PR #76 shipped it). The switch mechanism itself works correctly (see Confirmed working below) — this is purely the missing "current" affordance.

**Fixed 19 Aug 2026, filed as GAP-139.** `useSelectedBusiness()` now also returns `businessId`; `BusinessSwitcherSheet` takes an optional `currentBusinessId` prop and marks the matching row with `aria-current="true"`, a check icon, and " · Current" appended to the role label — colour never carries the signal alone. All three voluntary-switcher call sites (`OperateLayout`/`ReviewLayout`/`MineLayout` in `router.tsx`) and `FirstRunGate`'s mandatory picker now pass it. New tests cover both the marked case and the no-match/undefined case.

### F-3 · Lease closure summary shows the gross obligation amount, not what's actually outstanding

**Where**: `web/src/features/leases/CloseLeaseScreen.tsx:366` — `<Money value={parse(row.amountMinor)} />` inside the "Unpaid dues" list, step 1 of Close the lease.

**Repro**: Created a real test lease on `TESTA` (`QC-0808160814-A`, customer "QA Customer 0808052656", Rs 350/month, 19 Aug 2026) specifically to exercise this never-live-tested flow, then closed it same-day. Step 1's "Unpaid dues" list — populated by `getLeaseClosureSummary` (INV-18: "show everything outstanding before releasing anything," deliberately every `owed_to_us` obligation against the customer, not just this lease's own — confirmed intentional by reading `api/src/domain/lease-closure.ts:194-204`, not a scoping bug) — showed:

- `trip_fare · 17 Aug 2026 · Rs 569.90`
- `Rent · 19 Aug 2026 · Rs 11.29`

Cross-checked the `trip_fare` obligation directly against `obligation` (id `01a00db1-…`): `amount_minor = 56990`, `settled_minor = 145`, `waived_minor = 0` → **actual outstanding = 56845 (Rs 568.45)**, not Rs 569.90. The screen's own `StatTile` total, one line above ("Total unpaid Rs 579.74"), *is* computed correctly — `568.45 + 11.29 = 579.74` matches exactly (`getLeaseClosureSummary`'s `totalUnpaidMinor` reducer at `lease-closure.ts:220-223` correctly does `amountMinor - settledMinor - waivedMinor`). Only the **per-row figure** in the itemized list uses the raw `row.amountMinor` straight off the wire, ignoring `settledMinor`/`waivedMinor` entirely — confirmed by reading the API response shape (`getLeaseClosureSummary` returns each obligation's raw fields, correctly leaving the netting to the caller) against the one client call site that renders it.

**Why it matters**: this is the screen whose entire documented purpose is "show everything outstanding before releasing anything" (INV-18) — it exists to gate a deposit-release decision. On any obligation that has received a partial payment, it overstates what the customer still owes, on exactly the screen where that number decides real money. This is the "numbers that go wrong quietly" category CLAUDE.md names directly — the total right next to it is correct, which makes the wrong line item read as more credible, not less.

**Fix shape**: `row.amountMinor - row.settledMinor - row.waivedMinor` at the one render site, matching what the total already does one line above it.

**Severity**: **High** — a live, confirmed money-display defect, not a UI polish item, on a screen that gates a real financial release decision.

**Fixed 19 Aug 2026, filed as GAP-140 (shared with F-3b below).** The one render site now computes `parse(row.amountMinor) - parse(row.settledMinor) - parse(row.waivedMinor)` instead of the raw `parse(row.amountMinor)`. New test reproduces the exact live figures (a `trip_fare` row, `amountMinor 56990`/`settledMinor 145`) and asserts the row shows Rs 568.45, never Rs 569.90, and that it agrees with the total.

### F-3b · `trip_fare` (and likely other obligation kinds) render as a raw enum string on the same screen

**Where**: `web/src/features/leases/CloseLeaseScreen.tsx:57-61`, `DUE_KIND_LABEL` — covers only `rent`, `mileage_excess`, `post_closure_charge`; falls back to `row.kind` unmapped (`{DUE_KIND_LABEL[row.kind] ?? row.kind}`).

**Repro**: Same closure summary as F-3 — the `trip_fare` row's kind rendered literally as **"trip_fare"**, the raw snake_case database enum value, not a human label. Since INV-18 deliberately pulls every outstanding obligation kind against the customer (not just lease-specific kinds), any kind outside the three mapped here will leak through the same way — this was simply the first live case to have one.

**Why it matters**: CLAUDE.md's interface rules are explicit that raw internal vocabulary must not reach the screen. A manager reading "trip_fare" has to guess what it means; "Rent" on the row below it reads fine because that kind happens to be mapped.

**Fix shape**: add `trip_fare: "Trip fare"` (and audit for any other obligation `kind` that can legitimately reach this list — `management_fee` is a candidate) to `DUE_KIND_LABEL`.

**Severity**: Low (copy-only, no money impact) — bundle with F-3 since they're the same render site and likely the same PR.

**Fixed 19 Aug 2026, filed as GAP-140 (with F-3).** `DUE_KIND_LABEL` gains `trip_fare: "Trip fare"`. `management_fee` deliberately not added — checked its own domain code (`management-fee.ts`): it is always `direction: "owed_by_us"`/`partyType: "partner"`, so it can never reach this customer-scoped `owed_to_us` list. New test asserts "Trip fare" renders and "trip_fare" never does.

### F-4 · A lease's close-out never records when it closed or which final-period treatment was chosen

**Where**: `api/src/queries/lease.ts:103-113` (`updateLeaseStatus`) — the only write path `closeLease` and `closeOutLease` (`api/src/domain/lease-closure.ts`) use to move a lease through `active → closing → closed`. It sets only `status` and, optionally, `endDate`.

**Repro**: Same real lease-close as F-3. The Close-the-lease wizard's step 1 explicitly asks the user to choose a final-period treatment (I chose "Charge the days used," the default) and a closing date (defaulted to today). After completing all 5 steps through to "Close out," queried the lease row directly:

```
status: 'closed', end_date: '2026-08-19'   -- correct
closing_date: null, closed_at: null, final_period_treatment: null   -- all three still null
```

`lease`'s own schema (`api/src/db/schema.ts:234-239`) defines `finalPeriodTreatment`, `closureSummaryShownAt` and `closedAt` as real columns — grepped every write to the `lease` table across `api/src` and none of the three is ever set by any code path. `getLeaseClosureSummaryHandler` reads via `c.get("reader")` (a read-only handle), so `closureSummaryShownAt` is structurally incapable of ever being written by the one handler whose name suggests it should be.

**Why it matters**: the choice a manager makes at step 1 — full period vs. days-used vs. an agreed figure — has real, one-way billing consequences (it already correctly resized this lease's billing period and its rent obligation to Rs 11.29), but nothing records *which* treatment produced that number, and nothing records *when* the lease was actually closed. If a later report, dispute, or audit ever needs to answer "how was this lease's final bill calculated" or "on what date did this close," that fact does not exist in the database — it was asked for, used once to compute the period, and discarded.

**Severity**: Medium — not a live wrong-money bug (the billing math itself is correct, confirmed against the DB), but a genuine audit-trail gap on a one-way, unrepeatable action, in a system whose stated promise is being believed about money months later.

**Contrast worth keeping**: closed a real trip live the same session (`trip` id `019fe444-…`, "Close trip") and checked its own row — `trip.status = 'closed'`, `trip.closing_date` correctly set to the real closing date. The pattern this finding asks for already exists and works correctly elsewhere in the same codebase; it simply wasn't followed for the lease-closure path specifically.

**Fixed 19 Aug 2026, filed as GAP-141.** `updateLeaseStatus` (`api/src/queries/lease.ts`) now writes `finalPeriodTreatment` when given one, and sets `closedAt: sql\`now()\`` automatically whenever `status` becomes `"closed"` — the same pattern `accounting-period.ts`'s own `closePeriodRow` already uses. **Caught before landing**: `lease.final_period_treatment`'s own CHECK constraint (verified directly against the live QA schema) only accepts `full_period`/`days_used`/`agreed_figure`, not `CloseLeaseInput`'s own `full`/`days_used`/`agreed` — a `FINAL_PERIOD_TREATMENT` map bridges them; without it, two of the three modes would have thrown a raw constraint violation on every real close. `closureSummaryShownAt` was left alone functionally — it turned out to be a genuine doc/code disagreement, not an oversight: `lease-closure.ts`'s own comment already recorded the deliberate, real mechanism (call ordering, not a stored flag), it just never made it back into `data-model.md`. Corrected there instead (v1.1.11, §13/§14), flagged, with the real consequence stated plainly: nothing server-side stops a direct API call from skipping the closure summary. New integration tests confirm `finalPeriodTreatment` lands at step 1 and `closedAt` lands only at step 7 (close-out), not before.

### F-5 · The platform admin panel shows raw Postgres timestamps, unformatted, on three of its six screens

**Where**: every date this brand-new surface displays is the API response string interpolated directly with no formatter — confirmed at three call sites:
- `web/src/features/admin/BusinessesListScreen.tsx:53` — `Created {business.createdAt}`
- `web/src/features/admin/AdminManagementScreen.tsx:85` — `Admin since {admin.grantedAt}`
- `web/src/features/admin/PlatformAuditLogScreen.tsx:54` — `{entry.actorName} · {entry.createdAt}`

**Repro** (this session bootstrapped the first-ever `platform_admin` row on QA to reach this surface at all — see header note): every one of the three screens above rendered a raw Postgres `timestamptz` string verbatim, e.g. **"Admin since 2026-08-19 13:14:25.253818+00"** and **"Created 2026-08-06 01:56:11.109882+00"** — microsecond precision, a bare UTC offset, no conversion to `Asia/Colombo`, nothing resembling the `formatShortDate` output every other screen in the client uses ("22 Aug", "12 Aug 2026").

**Why it matters**: CLAUDE.md's Time section is explicit and names this exact failure mode — a raw ISO/UTC string reaching the interface instead of the business timezone. Every other screen in the client gets this right; this one surface, being new and never live-tested, got shipped without it. Cosmetic, not a money bug, but systemic across the whole feature (3 of 6 screens) rather than a one-off typo.

**Fix shape**: route all three through the existing `formatShortDate` (or a timestamp-with-time variant if the extra precision is wanted for an audit log specifically) rather than raw string interpolation.

**Severity**: Low-medium (no money impact, but systemic and highly visible — the first thing every one of these three screens shows).

**Fixed 19 Aug 2026, filed as GAP-142.** New shared `web/src/lib/formatTimestamp.ts`, wired into all three screens. Two real bugs found and fixed in the first draft, both by the fix's own test suite before either reached a browser: `new Date()` returns Invalid Date for Postgres's bare `+00` offset (no `:00` minutes) unless normalised first — the exact live-observed shape; and the first draft omitted `timeZone: BUSINESS_TIMEZONE` entirely, which renders in the device's zone rather than Colombo (CLAUDE.md's own named failure mode) — caught only because the test machine's zone (`America/Chicago`) differs from Colombo enough to move the displayed calendar day. Fixed test fixtures use the real raw-Postgres shape rather than a pre-cleaned date, so they would have caught the original bug too.

### F-6 · Every write in the admin panel shows a raw JS parse error, even though the write always succeeds

**Where**: `api/src/handlers/admin.ts` — all four of the admin panel's write handlers return `c.body(null, 200)`, an **empty body with status 200**, not 204: `decideRequestHandler:71` (approve/reject a business creation request), `setAllowanceHandler:89`, `grantAdminHandler:109`, `revokeAdminHandler:116` (grep-confirmed: this exact pattern appears exactly 4 times in the whole API, all four in this one new file — every other write endpoint in the codebase gets this right). `web/src/lib/api.ts:100-101` (`request<T>`) only skips `res.json()` for `res.status === 204`; a 200 with an empty body falls through to `await res.json()`, which throws a `SyntaxError` on empty input. `UsersListScreen.tsx` renders `{mutation.error.message}` directly for each of these three sheets, so the raw JS engine string reaches the screen verbatim.

**Repro, three of the four, live, real writes, each cross-checked against the database**:
1. **Grant admin** — granted platform admin to a second real user ("Chamath Silva"). Dialog stayed open, showed **"Unexpected end of JSON input"** in red where a success close was expected. `platform_admin` directly: the grant **had already landed** (`revoked_at IS NULL`).
2. **Revoke admin** — revoked the same grant (cleanup). Identical failure, fuller message: **"Failed to execute 'json' on 'Response': Unexpected end of JSON input"**. Queried again: the revoke **had already landed** (`revoked_at` set to the exact click timestamp).
3. **Set business allowance** — changed Chamath Silva's allowance 5 → 6 → back to 5 to leave no net change. Both saves showed the identical error. `app_user.business_allowance` directly: both writes **had already landed** each time, confirmed 6 then 5 in the database.

The fourth (`decideRequestHandler`, approve/reject a business creation request) shares the exact same `c.body(null, 200)` pattern and the exact same client render path — confirmed by source, not separately live-exercised this session (QA's request queue was empty; forcing one open requires a second, non-owner signup through F-0.x, out of scope for confirming a pattern already proven three other ways).

In every case `onSuccess` (which invalidates the relevant query cache and closes the sheet) never ran, because the mutation's promise rejected before reaching it — the on-screen list did **not** reflect the change until a full page reload independently re-fetched it.

**Why it matters**: this is the panel's entire write surface — every single mutating action it offers currently ends in a raw stack-trace-shaped error message on a screen that just did exactly what was asked. A real admin doing any of this for the first time has no way to tell "it failed" from "it worked but the confirmation is broken" without checking somewhere else, and the natural response to an apparent failure — clicking the button again — costs nothing here only because all four underlying domain functions happen to be idempotent-safe, not because the UI told them that.

**Fix shape**: two independent, compatible fixes — change all four handlers to `c.body(null, 204)` (matching every other empty-body write in this API, and matching what the client already special-cases), and/or make `request<T>()` treat any empty response body as `undefined` regardless of status code rather than only for exactly 204. Either alone fixes this; both together closes the contract gap for any future empty-body 200 anywhere in the API.

**Severity**: **High** — literally every write action in a brand-new admin surface currently ends in a visible error on success, on a feature that (per F-5 above) has now had its very first live pass.

**Fixed 19 Aug 2026, filed as GAP-143.** All four route-defs and handlers changed from 200 to 204 (grep-confirmed: this was the only occurrence of the empty-body-200 pattern anywhere in the API — every other write endpoint returns a real JSON body). No client change needed — `request<T>()` already handled 204 correctly, it just never received one from this file. Six existing integration-test assertions updated from `toBe(200)` to `toBe(204)` for the four endpoints. **Found and fixed a real, unrelated pre-existing bug along the way**: re-running the full suite surfaced 4 stray active `platform_admin` rows on the shared `test-parallel` Neon branch, traced to a test whose own failing assertion aborted before its `ctx.cleanup()` ran — cleaned up (with explicit approval, since it's a DB write) so INV-40's "last admin" test is reliable again; not a regression from this fix.

### F-7 · Home's "Rent due" figure goes stale after recording a payment through Quick Add

**Where**: `web/src/features/quick-add/QuickPaymentSheet.tsx:75-86`, the mutation's `onSuccess` — invalidates `["payment"]`, `["home"]`, and (for a customer) `["customer", partyId]`. `HomeScreen.tsx:222-224`'s "Rent due" list reads `queryKey: ["reports", "receivables"]` — a key that starts with neither `"home"` nor `"customer"`, so none of the three invalidations above ever touch it. TanStack Query's `invalidateQueries` matches by key-array prefix, so `["home"]` only reaches queries actually keyed under `["home", …]` (`paperwork-warnings`, `deposit-releases`) — it does not reach `["reports", "receivables"]` by name resemblance alone.

**Repro, live, real money**: on `TESTA`, recorded a real Rs 20 payment from "QA Customer 0808052656" via Quick Add → Payment received. The sheet closed normally, no error. Home's "Rent due" row for this customer **still read Rs 579.74 — completely unchanged** from before the payment. Checked the database directly: the payment posted correctly (`payment` row, Rs 20, `direction = 'received'`) and allocated correctly to the oldest outstanding obligation first, exactly per F-2.2 (the 17 Aug `trip_fare` obligation, `settled_minor` 145 → 2145) — the true new outstanding is Rs 559.74, exactly Rs 20 less. A full page reload (forcing every query to re-fetch from cold) immediately showed the correct **Rs 559.74** — confirming this is purely a client-side cache-staleness bug, not a computation error; the money itself was never wrong, only what the screen kept showing.

**Why it matters**: this is Home — "everything outstanding appears here" (U-4) — showing a stale, overstated due amount immediately after the exact action that was supposed to reduce it, with no visible sign that anything is wrong (no error, no stale-data indicator, the sheet closes as if everything succeeded, which it did — just not on screen). A manager who just collected Rs 20 and glances back at Home sees the old, higher number and has no way to know it's stale rather than actually still owed, right up until they happen to reload.

**Not isolated to Quick Add — four call sites, all four fixed.** `CollectPaymentSheet` has three other callers beyond `QuickPaymentSheet` (found via the GitNexus dependency graph while fixing this, not by further live-clicking): `LeaseHubScreen.tsx` (invalidated only `["lease", leaseId, "obligation"]`), `CustomerDetailScreen.tsx` (invalidated `["customer", …]`/`["payment"]`/`["home"]` but not `["reports"]`), and `TripDetailScreen.tsx` (invalidated only `["trip", tripId]` — narrower even than the other two, missing `["payment"]`/`["home"]` as well). All four now also invalidate `["reports"]` on a successful payment. Each fix has its own regression test (`QuickAddSheet.test.tsx`, `LeaseHubScreen.test.tsx`, `CustomerDetailScreen.test.tsx`, `TripDetailScreen.test.tsx`), asserting `queryClient.getQueryState(["reports", "receivables"])?.isInvalidated` flips to `true` after the mutation.

**Fix shape**: add `["reports"]` (or the specific `["reports", "receivables"]`) to the invalidation list in both `QuickPaymentSheet.tsx`'s `onSuccess` and `LeaseHubScreen.tsx`'s `CollectPaymentSheet` usage. Given the same gap independently exists in two unrelated components, worth checking whether Home's own query keys should instead be invalidated from one shared place (e.g. a `["home"]`-and-`["reports"]` bundle exported alongside the `/api/payment` call) rather than re-enumerated at every call site.

**Severity**: **High** — a live, confirmed "the number on screen disagrees with the number that's true" defect, on Home, immediately after the single most common money-recording action in the app, and reproducible from at least two independent entry points.

**Fixed 19 Aug 2026, filed as GAP-144.** `["reports"]` invalidation added at all four `CollectPaymentSheet`/`QuickPaymentSheet` call sites (`QuickPaymentSheet.tsx`, `LeaseHubScreen.tsx`, `CustomerDetailScreen.tsx`, `TripDetailScreen.tsx` — the last also gained the `["payment"]`/`["home"]` invalidations it was missing entirely). Each site's own test asserts `queryClient.getQueryState(["reports", "receivables"])?.isInvalidated` flips to `true` after the payment mutation completes.

---

## Confirmed working (no defect)

- **Business switcher — the actual switch.** TESTA ↔ TestBusinesByChamath switch correctly updates the app-bar label, clears cached data (`queryClient.clear()`), and Home re-renders with the new business's real figures — no stale-business data observed, no reload-loop, no console error from the switch itself.
- **Membership scoping.** The switcher lists exactly the 2 businesses this account has active membership in (`TESTA` owner-manager, `TestBusinesByChamath` manager) and correctly excludes `Nim`, a third business on this QA branch this account has no membership row for — confirmed against `business_member` directly.
- **Home "Rent due" figures, both businesses, cross-checked against `obligation` directly**: `TestBusinesByChamath` Rs 3,000 = one `obligation` row, `300000` minor, exact. `TESTA` Rs 1,157.33 = `58888 + 56845` (one `pending` trip_fare row for "QA2 Customer 0808155856" at full `58888`, one `part_paid` row for "QA Customer 0808052656" — `56990` amount minus `145` already settled = `56845` outstanding) — UI sum matches to the cent.
- **Day-card confirm ("Paid in full"), TESTA, `NC-1234`, 19 Aug** — a real, one-way confirm exercised live. `day_record` landed as `state = 'ran_paid_full'`, `earned_minor = 300000`, `expected_minor = 300000`; a separate `payment` row (`direction = 'received'`, `amount_minor = 300000`, same date) was created in the same action — `earned` and `received` correctly stored as two independent facts (never collapsed), matching the four-inserts-one-transaction rule. UI updated to "Confirmed / Earned Rs 3,000" instantly, no console error.
- **LT-13's last open item — `LeaseHubScreen` → "Close the lease" → navigate to `/leases/:id/close` — closed.** Created a fresh test lease (`QC-0808160814-A`, Rs 350/month, no prior lease had ever existed on this vehicle — resolving the 17 Aug note that it "shows no lease-history row") specifically to exercise this, since QA had no real monthly-lease vehicle available on any prior session. Navigation landed cleanly at 360×640, zero reversion to Home — **GAP-134's fix now confirmed live on the sixth and final sheet-closes-and-navigates call site in the whole client.** LT-13 can close as fully done in TRACKER/LIVE-TEST-PLAN.
- **Lease close economics, walked end to end live for the first time** (`active → closing → closed`, all 5 wizard steps, real test lease, 360×640 throughout): billing-period truncation on early closure computed correctly (Rs 11.29 for a same-day close of a Rs 350/month period — days-used pro-ration, matching W-25/P5+'s spec); Back removed once step 0 succeeds (the lease reads as a posted fact, not a draft, per Web-P6d); `GET /api/lease/{id}/deposit` correctly returned `null` for a lease that took no deposit, rendered as "No deposit was taken," never a false `Rs 0` (W-56); "Close out" correctly freed the vehicle and the lease now shows in the vehicle's own History timeline. See F-3/F-3b/F-4 for the three defects this same walk-through found.
- **Platform admin panel — every read screen, both colour schemes.** All 6 screens (`/admin`, `/admin/requests`, `/admin/businesses`, `/admin/users`, `/admin/admins`, `/admin/audit-log`) render as a standalone shell with no Operate/Review/Mine bottom nav bleeding through (UI §3.1's "never a fourth role shell," confirmed). Empty states are real answers, not spinners ("No requests yet."). Renders cleanly in light mode too. "1 of 5 businesses" on the Users screen is `activeBusinessCount`/`businessAllowance` — a real per-user quota, not a miscounted total (checked source before treating it as a finding).
- **`GET /api/reports/vehicle-year` ("How was the year," GAP-18/UC-73)** — both chart and table views checked; the six per-vehicle profit figures sum exactly to the reported total (Rs 18,503.53), and the new test vehicle's own −Rs 585.37 matches its recorded costs minus its prorated rent to the cent.
- **CSV export (`GET /api/reports/export`)** — returns `200`, correct `Content-Disposition: attachment; filename="fleetsettle-transactions-…"` and `Content-Type: text/csv; charset=utf-8`. Byte-level cell content not independently re-verified this session (the CWE-1236 formula-injection regression is already covered by the automated integration suite per TRACKER.md's 17 Aug entry).
- **Quick Add → Expense** — level-1-fields-only save confirmed again live (Amount, Category, Date; Vehicle correctly optional per UC-66's no-vehicle-cost case), matching U-2.
- **Light mode** — Home and the full admin panel both re-checked in light scheme; no contrast or layout regressions found.
- **CSP eval-block console issue noted on TESTA's Home** (`Content Security Policy of your site blocks the use of \`eval\``) — logged once, no network CSP-violation-report request captured, not yet isolated to a specific script. Flagged for follow-up, not confirmed as a defect yet — see Open questions.

---

## Open questions — logged, not yet run to ground

- **CSP `eval` block, recurring.** Seen at least twice this session (TESTA Home on first load, and again mid-session on a fresh page load), always exactly once, source location `https://qa.fleetsettle.com/assets/index-CAfDjwsB.js:11:19370` (Chrome's own CSP-issue panel, `contentSecurityPolicyViolationType: "kEvalViolation"`). No `eval(`/`new Function(` found anywhere in `web/src` — this is a bundled dependency, not application code. `script-src` is actively blocking it (not report-only), so whatever depends on it is silently failing every time. Not isolated to a specific feature or trigger this session; worth someone bisecting the bundle (likely `recharts` or a transitive dependency) with sourcemaps.
- **"No label associated with a form field" DevTools issue, recurring.** Seen on at least three different sheets (Close-the-lease step 1, Quick Add → Payment received, Quick Add → Expense), always exactly once per sheet. Chrome's own issue reporting gave an empty `violatingNodeAttribute` both times it was checked, so the specific element couldn't be pinned down from outside. Manually audited every `<input>`/`<textarea>` on the one sheet checked in detail (Close-the-lease step 1) — the date field (`DateField.tsx`, both a `<label for>` and an `aria-label`), the note `<textarea>` (`<label for>` present) and the checkbox (properly nested inside a `<label>`) were all correctly associated by direct DOM inspection, so the true culprit is still unidentified. Given it recurs across otherwise-unrelated sheets, the common denominator is more likely a shared primitive (`Sheet`, `Field`, or the numeric `AmountPad`) than any one screen's own markup — worth a proper CDP `DOM.getFrameOwner`/backend-node-id trace rather than static reading next time.
- **LT-9, still open — unchanged by this session.** The linked-driver 403 boundary has never been exercised against a real browser (open since before `LIVE-TEST-PLAN.md` existed). `driver.linked_user_id` is `NULL` for every driver on this QA branch (checked directly) — no linked-driver account exists to test with, and creating one for real requires a second genuine Google/Asgardeo identity to redeem the invite as, which this session did not have. Not attempted via a forged token either: QA verifies against Asgardeo's real JWKS, so no signature this session could produce would pass. Still the single most important thing this repository's live-testing practice has never actually watched happen.
- **The fourth admin write handler (`decideRequestHandler` — approve/reject a business creation request)** shares F-6's exact `c.body(null, 200)` pattern by source (100% certain — same file, same line shape) but was not independently live-exercised, since QA's request queue was empty and populating it needs a second, non-owner signup through F-0.x. Treat as confirmed by the same evidence as the other three, not as a separate open question.

---

## What this session did not cover

Time-boxed against the size of this application — not exhaustive. In rough priority order for a follow-up pass:

- **LT-9** (linked-driver 403, above) — needs a second real account.
- **LT-10** (F4's real-device pass, iOS Safari / Android Chrome) — structurally can't be done from Chromium emulation; unchanged from every prior session's note.
- **Driver-side flows** (advance issue/settle, offset, deposit) — read-only confirmed (`QA2 Driver`'s Rs 5,000 held deposit, Sunil Perera's day history), no new write exercised this session.
- **Trip booking and cancel** — closing one real trip was exercised (see below); booking a new trip and the cancel/refund-vs-keep-as-fee path were not.
- **Incident flow** (open/off-road/repair/claim/recovery) — not touched this session; last confirmed live 16-17 Aug (`ReportIncidentSheet`, GAP-134 sweep).
- **Partners/banking/cash, vehicle sharing, members invite** — not exercised this session.
- **Business creation request queue and threshold auto-approval (F-11.1)** — brand new, zero live coverage; needs a second signup to populate.
- **CSV export byte-level content** (beyond headers/status) and **WhatsApp messaging (P14)** — out of scope (P14 is phase 2, blocked on Meta approvals regardless).

---

## Session actions on QA data — for the record

Everything below was a deliberate, real write against QA, left in place unless noted, matching this repository's own standing practice of leaving clearly-attributed test artifacts rather than deleting them:

- **`platform_admin` bootstrap** for `nimesha.isholi94@gmail.com` — left in place (see header note).
- **Real lease created and closed same-day** on `TESTA`'s `QC-0808160814-A` (customer "QA Customer 0808052656", Rs 350/month, 19 Aug 2026 – 19 Aug 2026) — left closed; this is what resolved LT-13's last open item and gave this vehicle its first-ever lease history row.
- **Real Rs 3,000 day-card confirm** ("Paid in full") on `TESTA`'s `NC-1234`, 19 Aug — left as recorded.
- **Real Rs 20 payment received** from "QA Customer 0808052656" on `TESTA` — left as recorded (this is the write that surfaced F-7).
- **Real Rs 5 office expense** on `TESTA` (no vehicle) — left as recorded.
- **Real trip closed** on `TESTA` (`019fe444-…`, "QA Customer 0808052656", 9 Aug, Rs 1,500 already paid in full, no costs) — left closed; confirmed `trip.closing_date` writes correctly, the contrast that sharpens F-4.
- **Platform admin grant + revoke round-trip** on a second real user ("Chamath Silva") — granted, then revoked in the same session as cleanup; net state unchanged (not an admin).
- **Business allowance round-trip** on the same user, 5 → 6 → 5 — net state unchanged.

None of the above touched `main`/production — QA only, per CLAUDE.md's standing separation.
