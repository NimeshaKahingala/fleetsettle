# Flow-inventory audit — every phase-1 flow against both sides

**Run 7–8 August 2026, item 0.3 off the current queue.** Recommended by Plan.md (§"A full flow-inventory audit is recommended but not yet sized or scheduled") after GAP-51 (F-1.7) and GAP-54 (F-1.2) both reached production-adjacent QA fully unbuilt — neither had a wireframe in `ui-ux-guidelines.md` nor an implementation in `web/src`, so no prior screen-by-screen or route-def-by-route-def validation pass ever had two sides to diff. This is the top-down pass TRACKER.md §5 says hadn't been run: every phase-1 `F-x.y` in `user-flows.md`, checked against `docs/design/ui-ux-guidelines.md` (wireframed?) and `web/src` (built?), independent of what either tracker currently claims.

**Method.** 44 phase-1 flow ids (`F-0.1` through `F-10.1`, excluding the ones `user-flows.md` itself marks phase 2) were grepped against both targets. A zero/zero result was then checked by hand — read the flow's own spec text, check the relevant backend route-defs, check the relevant `web/src` feature directory, check whether TRACKER.md or Plan.md already schedules it under an existing B-item — before being called a finding. Most zero/zero results turned out to be already-tracked Track B items (B2 through B9) simply not tagged with the flow id in a code comment; those are listed but not re-argued. **Seven did not resolve that way.**

---

## Findings — unbuilt, and not claimed by any scheduled item

### AUDIT-1. F-0.2 — Go live mid-stream (opening balances). The largest finding.

*Actor: Owner-manager · Source: UC-09, W-51 · Phase: 1.* The flow's own text: *"Every real deployment starts on a Tuesday with a bus already leased, a car already rented, and a driver already 12,000 behind. Without this flow the first month is a lie and the whole ledger inherits it."*

- **Backend: fully built.** `api/src/route-defs/opening-balance.ts` — `PUT /api/opening-balance` (save/draft), `GET /api/opening-balance`, `POST /api/opening-balance/commit`. `api/src/domain/opening-balance.ts` exists.
- **`ui-ux-guidelines.md`: zero mentions of F-0.2.** Never wireframed.
- **`web/src`: zero references** to opening balance, the route, or the schema, by any spelling.
- **Not scheduled anywhere.** Not in TRACKER.md's gap tables, not in Plan.md's Track B item list (B0b/B2/B3/B4/B5/B6/B9), not in either B4 design document.

This is GAP-51/GAP-54's exact shape — backend ready, absent from both the wireframe and the client — but higher-stakes than either: F-1.7 blocked one arrangement's daily flow, F-1.2 blocked changing an arrangement after the fact. F-0.2 blocks **any business that isn't starting from zero** from ever having a correct ledger, which — per CLAUDE.md's own framing of who this product is for (a business "run by two partners," not a startup) — is close to all of them. A real deployment today can create a business and add vehicles, but cannot enter a driver's existing arrears, a customer's existing dues, or opening cash without going around the product entirely.

### AUDIT-2. F-4.7 — Change the driver (arrangement B). No backend, no client.

*Actor: Manager · Source: UC-36 · Phase: 1.* "New driver from a date; previous assignment ends. History stays attached to whoever was actually driving."

- `api/src/route-defs/dailyLease.ts` has exactly three routes: list, start (`POST`), get by id. No `PATCH`/reassign endpoint.
- `api/src/route-defs/lease.ts` (arrangement A) has renew/close/deposit endpoints, none of them a driver reassignment, and F-4.7 is scoped to arrangement B specifically (it sits under "F-4 — Arrangement B: the daily lease").
- Zero `web/src` hits.

A daily-lease driver is fixed for the life of the lease. The spec's own accept criterion about a driver's long downtime ("assign him to a spare vehicle... or pay a retainer with no trip attached") is the only workaround, and it only covers the *replacement* driver's situation, not the original lease's own record.

### AUDIT-3. F-6.1 — Pay the driver. Confirmed missing, and already self-documented in the code — but not a tracked gap.

*Actor: Manager · Source: UC-50, W-34 · Phase: 1.*

- Backend read (`GET /api/driver/{id}/view`, A5) and the underlying payment machinery exist.
- `QuickAddSheet.tsx`'s own doc comment states it outright: *"Payment made (F-6.1, 'pay the driver') has no frontend anywhere yet — not even from a driver's own page."* [QuickAddSheet.tsx:28-30](web/src/features/quick-add/QuickAddSheet.tsx#L28-L30)
- `DriverDetailScreen.tsx` wires only `OffsetSheet` (F-6.4); no pay/collect action.
- **Zero mentions of "F-6.1" or "pay the driver" in TRACKER.md or Plan.md.** The code knows about this gap; neither tracker does. Not claimed by B5's checklist (read-only: "days, trips, advances, deposit — §3.3's route map").

### AUDIT-4. F-6.3 — Advance before a trip, settle after. Recording has no caller.

*Actor: Manager · Source: UC-53 · Phase: 1.*

- `api/src/route-defs/advance.ts` — `POST /api/advance` (record) and `POST /api/advance/{id}/settle` both exist.
- `web/src` references F-6.3 only in `CloseTripSheet.test.tsx`, as the *enforcement* copy ("An advance against this trip must be settled (F-6.3) before it can be closed") — settling is gated on, but nothing ever records one, because nothing calls `POST /api/advance`.
- GAP-29 (closed, A5) is a different claim — it's about the *list* endpoint being unnecessary once A5's composed driver-view read covers advances. It says nothing about the write side, and the write side has no caller either way.

### AUDIT-5. F-6.6 — The printed slip. The spec's "not optional" clause is entirely unbuilt.

*Actor: Manager · Source: UC-57, W-3 · Phase: 1.* **"Not optional. You chose to be the single source of truth; that works only if the other party can see what you see."** Accept: same figures as F-6.5, *"printable, and shareable without a login via a signed link that expires — it carries someone's financial position, so it is not a guessable URL."*

- Zero hits anywhere in `api/src` or `web/src` for a signed/expiring/shareable link mechanism of any kind.
- B5's checklist item — *"Statement link producing the same content as the printed slip"* — is the **driver's own authenticated in-app view** (`/me`, `MineScreen`). That is not the same requirement: F-6.6 is explicitly for sharing *without a login*, to someone who is not the linked driver (a driver with no account at all, or anyone the manager wants to show the figures to). B5, as scoped, does not build this even once it ships.

### AUDIT-6. F-6.7 — The driver's deposit. Recording it has no caller.

*Actor: Manager · Source: UC-58, W-8 · Phase: 1.*

- `api/src/route-defs/deposit.ts` — `POST /api/deposit` (take) and `POST /api/deposit/{id}/movement` both exist.
- B5's checklist reads the *held* deposit (driver's own view, read-only). B2's checklist has no deposit item at all. **Nothing anywhere calls `POST /api/deposit`.**

### AUDIT-7. F-1.9 — Mileage packages. The write half has no caller.

*Actor: Manager · Source: UC-18, W-19 · Phase: 1.*

- `api/src/route-defs/mileage-package.ts` — create, list, archive all exist.
- `web/src`'s only reference is `StartLeaseScreen.tsx`, which **selects** from existing packages via `GET /api/mileage-package` — there is no screen to name a package or set its terms. A real business can never create a mileage package through the product; one would have to be inserted directly.

---

## Smaller, partial finding — not a missing flow, a missing half of one

### AUDIT-8. F-3.5 — Scheduled maintenance. Recording works; the predictive half doesn't exist.

*Actor: Manager · Source: UC-13 · Phase: 1.* "Vehicle cost, not tied to an incident, optional odometer. **System** uses history + odometer to prompt next time."

- The base action is genuinely covered: `expenseCategorySchema` includes `servicing` and `repairs` ([expense.ts:5-21](packages/shared/src/schemas/expense.ts#L5-L21)), and `RecordExpenseSheet.tsx` (F-3.1's generic form) logs a cost against a vehicle with any category. The odometer link is `GET /api/expense.odometer_reading_id`, already tracked as **GAP-30 → A8**.
- What's missing is the second sentence: nothing anywhere computes "next time" from history + odometer and prompts for it. This is a real feature, not a form — closer to GAP-19-class unbuilt-analytics than to GAP-51's shape, since the base flow it describes does work end to end. Flagging it rather than filing it as equal-weight to AUDIT-1 through 7.

---

## Checked and already correctly tracked (no new finding)

For completeness — these had zero or low hits in one or both sides on the first pass, and each resolved to an existing, already-scheduled B-item on inspection:

| Flow | Resolves to |
|---|---|
| F-1.2 (change arrangement) | **GAP-54 → A13**, already scheduled |
| F-1.3 write (ownership shares, capital) | **B2** (`OwnershipSharesForm`, `CapitalContributionSheet`) |
| F-1.4 (bring in a partner/manager) | **A11**, done; in-app invite screen still needs B0b, already noted in Plan.md |
| F-4.1 (see what's pending) | Built — `HomeScreen.tsx` via `ConfirmDayCard`, just untagged with the flow id |
| F-5.2/F-5.3 (trip costs, customer money) | F-5.3 closed by **A12/GAP-57** (`TripDetailScreen`'s receivable row); F-5.2 uses the same generic expense/trip-linked flow F-3.1 already provides |
| F-6.2, F-6.4, F-6.5 | Built (`AllocationPreview` shared across F-4.5/F-4.6/F-6.2; `OffsetSheet` for F-6.4); F-6.5 (driver statement) is **B5**'s scope |
| F-7.1 – F-7.6 reads | **B4**, unbuilt but scheduled, and the subject of the separate `B4-REPORTS-DESIGN.md`/`-REVIEW.md` pass (0.2) |
| F-8.1 (period-linkage rule) | A system rule (`resolvePeriodLinkage`), not a UI flow — correctly has no screen |
| F-8.2, F-8.6, F-9.1 | **B3**'s scope (`CorrectPaymentSheet`, `Timeline`, `CloseMonthScreen`) |
| F-9.2 (report catalogue) | **B4**'s scope |
| F-10.1 (paperwork alive) | Built — referenced live in `web/src` |

**One partial exception inside that list, worth carrying forward rather than re-opening:** **F-7.2 (payouts and partner settlement)** — `POST /api/partner-payout` exists ([partner.ts:185](api/src/route-defs/partner.ts#L185)) with zero `web/src` callers, and unlike the rest of F-7.x it is **not named in B2's implementation checklist** (`PartnerDetailScreen`, `OwnershipSharesForm`, `CapitalContributionSheet`, `ShareVehicleForm`, `BankingEventForm`, `CashPositionScreen` — no payout screen among them) nor in B4's read-only scope. Filed here as **AUDIT-9**, same shape as AUDIT-3/4/6/7 — a write endpoint nothing currently claims.

---

## What this changes

**Nine findings, all the same shape: a phase-1 flow whose backend was built and whose client caller was not, discovered because nothing until now diffed the full flow list against both sides at once rather than screen-by-screen.** Eight of nine (all but AUDIT-1 and AUDIT-2, which have no backend either) are "endpoint shipped ahead of screen" — the same pattern GAP-33 (`GET /api/expense`) and GAP-29 (`GET /api/advance`) already established as sometimes-deliberate in this codebase. The difference here: GAP-33/29 were **read** endpoints kept deliberately callerless because no screen needed them yet, and that was recorded. AUDIT-3 through 7 and AUDIT-9 are **write** endpoints for phase-1 flows with no screen scheduled to call them at all, in either tracker — not a deliberate deferral, an unrecorded one.

**Proposed provisional numbering (GAP-61 through GAP-69), pending absorption into TRACKER.md:**

| Provisional id | Finding | Suggested track |
|---|---|---|
| GAP-61 | AUDIT-1 — opening balances (F-0.2) has no screen | New Track B item — sizeable; a multi-step draft-then-commit form per §"Steps" 1-6, likely comparable to B10 |
| GAP-62 | AUDIT-2 — no way to change a daily lease's driver (F-4.7) | New Track A + B item — needs a backend endpoint first |
| GAP-63 | AUDIT-3 — pay the driver (F-6.1) has no frontend | Belongs with B5 or a small standalone item — the code already names it |
| GAP-64 | AUDIT-4 — record a driver advance (F-6.3) has no caller | Pairs naturally with GAP-63 |
| GAP-65 | AUDIT-5 — the printed slip's signed/expiring share link (F-6.6) doesn't exist | New Track A (signing/expiry mechanism) + B item |
| GAP-66 | AUDIT-6 — record a driver deposit (F-6.7) has no caller | Pairs with GAP-63/64 |
| GAP-67 | AUDIT-7 — create/manage a mileage package (F-1.9) has no screen | Small; fits naturally alongside B2 or B10-adjacent vehicle setup |
| GAP-68 | AUDIT-8 — scheduled maintenance's predictive prompt (F-3.5) unbuilt | Low priority, deliberately smaller than the others |
| GAP-69 | AUDIT-9 — record a partner payout (F-7.2) has no caller | Add to B2's checklist |

**Not assigned numbers or scheduled here.** That's this session's own standing rule (`doc-change` convention): a finding gets recorded, not silently absorbed into a plan as a side effect of the audit that found it. TRACKER.md and Plan.md are the documents that decide scheduling, and 0.2 (the B4 scope decision) is running in parallel — GAP-61 in particular overlaps it not at all, but GAP-69 (partner payout) touches B2, which the B4 review didn't touch, so no conflict there either.

**One meta-observation.** Six of nine findings (AUDIT-3, 4, 6, 7, 9, and half of AUDIT-8) are the identical shape: a manager-facing *write* action whose backend shipped in P2–P9 and whose screen was never scheduled by name in any B-item's checklist, only implied by the B-item's general description ("B2: partners, banking, cash" doesn't say "and payouts"; "B5: Mine shell" doesn't say "and the manager pays from here"). The pattern worth naming for future planning: **a Plan.md checklist that names screens by noun ("partners, banking, cash") rather than by flow id (F-7.1 through F-7.6) will quietly under-scope**, because nothing forces every flow under that noun to get its own line. B2's and B5's checklists should be re-cut against the actual F-x.y list before either item starts, not discovered mid-build the way F-1.7 was.
