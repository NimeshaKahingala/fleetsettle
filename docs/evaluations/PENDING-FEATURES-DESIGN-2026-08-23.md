# Pending features — design and decisions

**Status: agreed, not built. Nothing in this document has been implemented.**

Four features worked through with the owner on 23 August 2026, evaluated one at a time against the specification and the existing schema before any code. This document records what was decided, what was deliberately declined, what must change in `docs/` before building, and what is still open.

It is a working note, not a specification. **`docs/` still decides.** When items 3 and 4 are built, their content moves into the owning documents (`use-cases.md` first, then the rest) and this note is retired the same way `PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md` was.

---

## Summary

| # | Feature | Scope | Blocked on |
|---|---|---|---|
| 1 | Late-fact period flag on reports | Read-side only, no migration | nothing — buildable now |
| 2 | Bell rows tappable, stateless | Client only, no migration | nothing — buildable now |
| 3 | Vehicle loans | New tables, new expense category, new payout kind, new capability | a `use-cases.md` change |
| 4 | Distribution + distributable cash | One new report; the rest is verification | a `use-cases.md` change |

---

## 1 · Late-fact period flag

**Closes GAP-173.** Read-side only — the write half has been correct all along.

### The problem

A day confirmed after its accounting period closed posts into the currently open period, carrying `belongs_to_period_id` as a reference to where it actually belongs. `business_date` never moves; only the period attribution does. [`resolvePeriodLinkage`](../../api/src/queries/accounting-period.ts) implements this correctly and is not in question.

FL F-8.1 makes **two** promises: *"reports for the closed month are unchanged; reports for the open month show the item flagged as belonging elsewhere."* Only the first is built. `belongsToPeriodId` appears in no report query in [reports.ts](../../api/src/queries/reports.ts) (every one filters on `postedPeriodId` alone), no API response schema, and nowhere in `web/src`. It is written and never read.

### The design

- Surface `belongsToPeriodId` and the period's label on the report row schemas that already carry `postedPeriodId`.
- Render a marker on the row: **"belongs to August"**.
- Split it out of the period total rather than blending it:

```
September                                    Rs 214,500
  of which late facts from earlier months       Rs 3,500
```

**The closed month must stay untouched.** F-8.1's first clause is already satisfied and is not part of this work — a "fix" that also surfaced late facts back into their closed month would reopen a settled month's reported total, which is the exact thing W-35 exists to prevent. Stated here because the symmetry is tempting.

**Applies to every late fact, not only day records** — a loan payment recorded late (item 3) gets the same W-35 linkage and inherits this flag with no extra work.

No migration, no data change, no document change — this makes an existing acceptance criterion true.

---

## 2 · Bell rows tappable, stateless

The bell is **already clickable** ([HomeScreen.tsx](../../web/src/features/home/HomeScreen.tsx)) and opens a summary sheet with a correctly-degrading badge. Two things are missing.

### Read/unread — declined, deliberately

Every bell row is **derived live** from current state: rent due, unconfirmed days, expiring paperwork, deposits to release, trips in progress. An item disappears when the underlying work is done — that *is* the read state, and it is self-correcting.

"Mark as read" would let a manager dismiss *"Rs 40,000 rent overdue"* without collecting it, leaving the badge confidently wrong. That is the exact failure mode W-56 exists to prevent, applied to the one widget people trust to tell them what they have missed.

If genuinely event-shaped notifications arrive later (a WhatsApp send failed — P14), **those** need read/unread, because a failed send is a past event that does not resolve itself. Two different things sharing one icon; only the second needs a read flag.

### Tappable rows

M-36a scoped rows as count-only *"rather than inventing a new destination"*. Two already have one:

| Row | Destination | Status |
|---|---|---|
| Paperwork | vehicle overview → paperwork | exists (`onSelectVehicle`) |
| Trips in progress | trip detail | exists (`onSelectTrip`) |
| Earlier days | unconfirmed days list | to wire |
| Rent due | receivables | to wire |
| Deposits to release | deposits list | to wire |

The last three are inert **on Home itself**, not only in the bell. So this is slightly wider than the bell: it gives those three sections a destination, and the bell reuses it.

Badge behaviour is unchanged — still derived, still `"unknown"` rather than a false zero when a read fails. **New tap targets must meet M-1's minimum**: 44 × 44 CSS px, ≥ 8px apart. Sheet rows are currently `py-3` text rows and will not meet it without change.

---

## 3 · Vehicle loans

Currently **phase Third** in UC §9.1 (*"loan and lease schedules"*) and listed under `TRACKER.md`'s "Not in this tracker", which states plainly that promoting it *"is a `doc-change` to `use-cases.md`"*. That change comes first.

### What the owner knows at signing

All five numbers are on the leasing document. Illustrative, units immaterial:

| | |
|---|---|
| Vehicle cost | 3,000 |
| Down payment (by hand) | 2,000 |
| Loan principal | 1,000 |
| **Total repayable** | **1,500** |
| Term | 50 months |

Finance cost = `1,500 − 1,000` = **500** — interest, document charges and everything else, in one figure.

This is the fact the whole design turns on. The split is **not visible per payment** — no receipt breaks it out — but it **is** knowable for the loan as a whole. So the manager types one number per payment and the split is derived, never entered.

### Amortisation: flat only

Sri Lankan leasing companies quote a **flat rate** and hand over a level instalment. Reducing-balance is the accounting-standard allocation, but it appears on no document the owner holds, and a figure that reconciles against nothing is the wrong trade for a system whose promise is being believed about money.

`amortisation_method` exists as a column with `'flat'` as its only allowed value, so the assumption is explicit in the schema rather than buried in a formula, and adding `'reducing'` later is a CHECK change rather than a restructure.

**Immutable once a payment exists.** The finance portion posts as a real expense; money is append-only, so changing the method afterwards would mean rewriting posted records. Setup-time choice, fixed for the loan's life.

### The split: proportional, not per instalment

Each payment splits by a fixed ratio:

```
principal : finance  =  1,000 : 500  =  2 : 1
```

Every rupee paid is ⅔ principal, ⅓ finance — whatever the amount, whenever it arrives.

For a normal instalment this is identical to a per-month schedule (`30 → 20 + 10`). It is chosen over one because **arrears here are cumulative**, so a partial, late, or catch-up payment has no month to index into. Proportional allocation is the only version that survives them, and it removes the schedule array entirely.

Use the existing largest-remainder [`split()`](../../packages/shared/src/money.ts) so the two parts always add back to the payment.

**Final-payment true-up:** per-payment rounding can leave principal a rupee or two short of 1,000. When the loan closes — scheduled or settled — the closing payment assigns principal = whatever principal remains, finance = the rest. Totals then land exactly on 1,000 and 500 by construction.

### What each payment writes

One transaction:

- **principal (⅔)** — reduces what is owed. **Not an expense**, so it never touches profit.
- **finance (⅓)** — an `expense` row, category `'finance'`, `borne_by = 'us'`, attached to the vehicle.

The generated expense carries `spent_on = paid_on`, the **same** `posted_period_id` / `belongs_to_period_id` as its payment, and `created_by` = the actor. Because it is an ordinary expense, it flows into vehicle profit, owner shares and every existing report **with no report changes at all**.

### Displayed balance

**"Remaining to pay"** — starts at 1,500, falls by the full payment. That is the figure on the lender's letter and the one the owner can check. Principal outstanding is derived internally and not shown.

### Arrears

Cumulative, derived on read:

```
expected by today  =  instalments due since start
paid so far        =  sum of loan_payment rows
behind by          =  the difference
```

One subtraction answers *"am I behind, and by how much"*. A part-payment leaves a smaller gap and needs no extra field. **Not modelled:** which specific month was missed, and penalty interest. A late fee is recorded as another payment or an ordinary expense.

### Reminders

Derived on read, mirroring UC-92's paperwork warnings — computed against the loan's schedule, not stored. **No cron, no notification table**, satisfying "no cron is a prerequisite for a user action". Becomes a sixth source for item 2's bell, which means UI §3.2's item list gains an entry.

### Settle and close

The manager enters the figure the leasing company quoted, plus the date. One `loan_payment` with `is_settlement`:

```
Settlement amount (from the lender)          550
  − principal still outstanding              400
  = finance cost on this final payment       150
Loan closed.
```

| Situation | Treatment |
|---|---|
| Settlement **≥** principal outstanding | Excess is finance cost. Normal case. |
| Settlement **<** principal outstanding | Finance 0; the difference goes to `waived_minor`. **No money record.** |

**Why a waiver is not money here.** Principal repayment is not an expense in this design, so principal forgiveness is not income — symmetric and consistent. The lender forgiving 50 means 50 less cash left the building; profit is untouched because that 50 was never a cost. Only the fact is stored, so the numbers stay explainable, and so a future depreciation feature can correct the asset's cost basis.

**Not a W-28 waiver.** W-28 governs *your receivables* — a discount you chose versus a loss you were handed. A lender forgiving *your* debt is a third thing, on the payable side, and must not be forced into either bucket.

Prior months' finance cost stands as posted. Closed periods are never rewritten; the closing payment absorbs the truth. Because the full 500 is never pre-booked, settling early simply means total finance lands below it — nothing to unwind.

### Loan lifecycle edges

| Case | Behaviour |
|---|---|
| Payment recorded against a **closed** loan | Refused. |
| Payment exceeding remaining-to-pay | Refused, pointing at "Settle and close" — an overpayment is either a settlement or a mistake, and guessing which one silently is worse than asking. |
| **Voiding a settlement** | Clears `closed_on` and **reopens the loan**, alongside voiding its finance expense. Otherwise a mistaken settlement leaves a loan permanently closed with a live balance. |
| Retiring a vehicle with an open loan | **Warns, never blocks.** The debt outlives the vehicle. Disposal itself stays phase Third. |

### Liability owner

| `liability_owner` | Payment behaviour |
|---|---|
| `business` | Reduces the balance, writes the finance expense. |
| a named owner | The whole payment is a drawing → `partner_payout` kind `'loan_on_behalf'`, landing in that owner's "Taken out" line (UC-67). **No finance expense** — it is not the business's cost. The balance is tracked as a memo. |

### Down payment

Always funded by **one named owner**, never split. Writes a single `capital_contribution` at registration, so someone who funded a third of the fleet does not show as having contributed nothing (W-52).

### Who pays an instalment — v1 restriction

**Instalments must come from business cash.** A personal payer is refused in v1.

The reason is a real hole rather than simplicity: if a partner pays 30 personally, only the finance third is an expense, and reimbursement flows through `expense.paid_by_user_id` — so he would be reimbursed 10 of the 30 he paid. Silent, and wrong in the direction that costs him money.

The correct treatment, if lifted later, is two records: finance → `expense` with `paid_by_user_id` set, principal → `capital_contribution` by him (he paid down the business's debt with personal money, which *is* putting capital in). Both reach his UC-67 "Put in" line and he is owed the full 30. **Deferred, not rejected** — refusing is honest and enforceable, and avoids writing a capital contribution the manager did not knowingly create.

### Roles and capabilities

[`policy.ts`](../../api/src/auth/policy.ts) holds a single capability matrix; loans need entries in it rather than ad-hoc role checks.

| Action | Capability | Roles |
|---|---|---|
| Create / edit a loan, set the down payment | **new** `manageVehicleLoans` | `OWNERS` — it is a capital commitment, sitting beside `managePartnerCapital` |
| Record a payment, settle and close | existing `dailyOperations` | `STAFF` — the manager pays it |
| See balance, remaining-to-pay, arrears | existing `viewReports` | `STAFF` |

**The manager seeing the balance is a classification decision, recorded so it is not "fixed" back.** UC-03's matrix denies a manager *"Ownership, capital, payouts (UC-02, UC-67)"* — those are **partner-level** facts: who owns what, who put in what, who is owed what. A vehicle loan is a **business liability**, none of the three, and it sits with the operating facts W-59 already calls a manager's working set. The owner's reason, to be recorded in `use-cases.md` alongside the rule: *the manager pays it, so he must see what is left.*

An earlier draft of this note called it a deliberate departure from UC-03. That overstated it — the matrix was never reaching this far.

**A linked `driver` sees nothing here, by any route** — report, export, or crafted request (W-49). Cross-tenant access returns **404, never 403**; a capability the role lacks returns 403. `business_id` comes from the verified JWT via `business_member`, never from a request body or query param.

### Schema deltas

```
vehicle
  + purchase_cost_minor            nullable (U-2: never required to save a vehicle)

vehicle_loan                        scoped via vehicle_id, like ownership_share
  vehicle_id, lender
  liability_owner                   'business' | a named owner
  principal_minor
  total_repayable_minor
  term_months, monthly_payment_minor, payment_day
  amortisation_method               'flat' (immutable once a payment exists)
  down_payment_minor, down_payment_by_user_id
  started_on, closed_on

loan_payment                        a money table
  business_id, loan_id
  amount_minor, paid_on
  is_settlement, waived_minor, note
  posted_period_id / belongs_to_period_id
  voided_at / voided_reason / voided_by / replaces_id
```

Also:

- `expense.category` gains `'finance'` — a CHECK-constraint migration — plus its row in the UC §6.7 borne-by matrix, **always `us`**, for all three arrangements.
- `partner_payout.kind` gains `'loan_on_behalf'` — also a CHECK migration; the current constraint allows only `'payout'` and `'partner_settlement'`.
- Validation: `total_repayable_minor >= principal_minor`, `term_months > 0`, `monthly_payment_minor > 0`, `amount_minor > 0`.

### Two hand-maintained lists, both required

**This is the part most likely to be missed, so it is stated separately.** `loan_payment` carries `posted_period_id`, and that alone is not enough to protect it.

1. **`assert_period_open()`'s array** (migration 0001, revised 0006) is hand-maintained. CLAUDE.md: *"a new money table is not finished until it is in the `assert_period_open()` array"* — DM §13 carries a CI assertion for exactly this, and the list has drifted once already.

2. **`write_audit_log()`'s trigger must be created explicitly.** Migration 0002 attaches the audit trigger by a `DO` block that discovers *"every table carrying `posted_period_id`"* — but **that block ran once, in 0002, and does not re-run.** A table created afterwards gets no trigger. Precedent: migration 0010 had to write `CREATE TRIGGER business_member_audit` by hand for exactly this reason, and migration 0030 reasons about it explicitly for the platform tier's three tables.

So the loan migration must contain **both** an `assert_period_open()` array update **and** a literal `CREATE TRIGGER loan_payment_audit AFTER INSERT OR UPDATE ON loan_payment FOR EACH ROW EXECUTE FUNCTION write_audit_log()`. Missing the first silently accepts writes into closed periods; missing the second silently loses the audit trail. Neither fails loudly.

**Stated limitation:** one loan, one vehicle. A single lease covering two vehicles is not supported and is recorded as a limitation rather than built for.

### Interface vocabulary

U-6 bans accounting vocabulary outright, and [`check-forbidden.mjs`](../../scripts/check-forbidden.mjs) enforces a hard list at write time: *accrual, accrued, receivable, payables account, current account, allocation, debtor, creditor, reconciliation.* None of the loan words hit that regex, but several are jargon a bus owner would not use, so the wording is fixed here rather than invented per screen.

| Concept | Interface says | Never says |
|---|---|---|
| Remaining balance | **Remaining to pay** | outstanding principal, balance outstanding |
| The finance portion | **Interest and charges** | finance cost, interest expense |
| Principal portion | *not shown at all* | principal, capital portion |
| `amortisation_method` | *never shown* | amortisation, flat rate, reducing balance |
| Arrears | **Behind by Rs X** | arrears, overdue balance |
| Settlement | **Settle and close** | early settlement, foreclosure |
| Waived amount | **Waived by the lender** | debt forgiveness, write-back |

`'finance'` is a database category value, not interface copy; it is mapped to **"Interest and charges"** at the edge like every other category label. GAP-158/159 were exactly this shape — a raw enum reaching the interface unmapped — so the mapping is a requirement, not a nicety.

### Conformance checklist

Every one of these is a project rule that applies to this feature and is easy to miss.

| Rule | Applies how |
|---|---|
| **Money codec** | `bigint` in the database and in domain code, **string** on the wire, never `number`. All of `principal_minor`, `total_repayable_minor`, `amount_minor`, `waived_minor`. |
| **Rounding** | Half-up, whole minor units, via the existing `split()` — parts always add back to the whole. |
| **One transaction** | A payment writes the `loan_payment` **and** its finance expense (or its `partner_payout`) atomically. A partial write leaves a balance reduced with no cost recorded. |
| **Append-only** | No updates to a posted `loan_payment`. Corrections void and replace via `replaces_id`. |
| **Void respects closed periods** | Voiding a payment whose finance expense sits in a closed period is refused with `PERIOD_CLOSED` (migration 0008) — the same answer every other money record gives. |
| **Period trigger is the truth** | No pre-check in application code. Catch the violation, map to `PERIOD_CLOSED`. |
| **Business timezone** | "Due today", "behind by" and every schedule comparison use the `Asia/Colombo` business date, passed to SQL **as a parameter**. Never `CURRENT_DATE`. |
| **W-56 degradation** | Arrears and remaining-to-pay show **"not available"** if a source read fails — never zero, and never a confident wrong balance. |
| **U-2** | The loan form saves on **lender + principal + total repayable + term** alone. Down payment, purchase cost, payment day and liability owner are level 2+ and must not be required. This is an automated test. |
| **M-1** | The whole loan flow completes on 360 × 640, one thumb, no horizontal scroll. Setup has enough fields to need a real check. |
| **Golden fixtures** | **134,000 / 15,000 / 7,500 must not move.** Loans add new tables and a new expense category; no existing money path changes. If a fixture shifts, something is wrong — that is the tripwire, not a rebaseline. |

### Testing

Beyond the golden fixtures staying still: the two-list omission above (period array, audit trigger) needs a test each, because neither fails loudly. The driver-isolation class (W-49) gains loan endpoints. The U-2 level-1-only save is an existing automated test that the new form joins.

---

## 4 · Distribution

**No schema change.** Settled by the owner: an owner **always has a login**, so `ownership_share.user_id → app_user` stands as built, and W-57's code-based invite is how a second owner gets an account. This was the only thing gating item 4.

Everything else already exists and needs verifying, not building: `ownership_share`, `capital_contribution`, `management_fee_agreement`, `partner_payout`, `banking_event`, and the UC-67 four-line statement in [PartnerDetailScreen.tsx](../../web/src/features/cash/PartnerDetailScreen.tsx).

### The scenario, in the system's own terms

The owner's worked example, corrected:

```
Earn                 10,000   income
Repair                2,000   expense (borne_by = us)
                    --------
Profit                8,000   ← not 3,000
Loan finance portion    500   expense
Loan principal        4,500   reduces the balance, not profit
Owner payout          2,000   partner_payout — a distribution, never a cost
Remaining             1,000   just cash. Nothing to record.
```

Paying down a loan and paying an owner both consume **cash**; neither consumes **profit**. UC-63's *"never a cost of the vehicle"* is already this rule, which is why item 3 respects the same boundary.

A manager who is also a partner takes a `partner_payout` against his own share. A manager who is **not** an owner takes the management fee (W-53) plus reimbursement of out-of-pocket costs — surplus cash beyond that is either an unrecorded fee or business cash he is holding (`banking_event`), and the two must not be mixed.

Undistributed surplus needs **no record at all** — it is the gap between the cash position and what has been paid out, and falls out of existing reports.

### The one addition: distributable cash

Because loan payments do not touch profit, profit is no longer the right number to read before sending money to an owner:

```
Cash on hand and in bank
  −  security deposits held        money you hold, never yours
  −  loan instalments due
  =  Distributable
```

Excluding held deposits matters: distributing a customer's security deposit as profit only surfaces when they ask for it back.

**Degrades to "not available", never to zero** (W-56) — a distributable figure computed from a partial read is the single most expensive wrong number in this document, because someone acts on it by moving money.

**Seen by `viewReports` — owner, owner-manager and manager alike**, not `viewOwnerOnlyReports`. Two reasons, and the second is the decisive one:

1. It is a **cash** report, not a capital one. UC-03's owners-only row covers partner-level facts (UC-02, UC-67); UC-75's cash position is already in a manager's working set (W-59).
2. **Every input is already visible to him** — cash position, deposits held, and (per item 3) loan instalments due. Withholding the total while showing all three components restricts nothing except convenience.

**Seeing is not acting.** Recording a `partner_payout` remains `managePartnerCapital`, owners only. The manager sees how much is free; the owner decides where it goes.

---

## Document changes required before building

Intent changes before mechanics. Items 3 and 4 start in `docs/`, not in a migration.

| Document | Change |
|---|---|
| `product/use-cases.md` | Promote loans from phase Third · add `'finance'` to the §6.7 borne-by matrix (always `us`) · state that UC-03's owners-only capital row covers **partner-level** facts, so business liabilities and cash sit with a manager's working set **with its reason** · add the distributable-cash report, visible to a manager · a `W-n` decision for the flat-only amortisation choice |
| `product/user-flows.md` | Flows for loan setup, payment, settle-and-close, arrears · the lifecycle edges table above · acceptance criteria · new `INV-n` for "principal is never an expense" |
| `engineering/data-model.md` | The two new tables, the two CHECK migrations, `purchase_cost_minor`, the `assert_period_open()` entry and the explicit audit trigger |
| `design/ui-ux-guidelines.md` | §3.2 gains a loan item so the bell counts it · the three new bell/Home destinations from item 2 · the interface vocabulary table |
| `engineering/implementation-guidelines.md` | IG §16's rule-to-mechanism table gains the two hand-maintained-list checks |

Items 1 and 2 need no document change — item 1 makes an existing acceptance criterion true, and item 2 completes what M-36a explicitly left for a later pass.

---

## Decisions declined, and why

Kept per the project convention that what was *not* taken is written down, so the same argument is not had twice.

| Declined | Why |
|---|---|
| Entering the interest/principal split per payment | Not visible on any receipt the business receives. Deriving it from loan-level numbers gets the same answer with no data entry. |
| Booking the whole instalment as an expense | Understates profit badly and permanently — principal is most of the instalment — then profit jumps the month the loan ends, looking like performance that is not. |
| No finance cost at all, memo line only | Proposed while total repayable was assumed unknowable. Reversed once it turned out to be on the leasing document. |
| Front-loaded / reducing-balance amortisation | Correct accrual treatment, but needs a rate solve and produces monthly figures that reconcile against nothing the owner holds. Revisitable — the column exists. |
| A per-instalment finance schedule | Breaks on partial, late and catch-up payments, which cumulative arrears make ordinary rather than exceptional. |
| Recording a lender's waiver as an `adjustment` | `adjustment.obligation_id` is `NOT NULL` and obligations are money owed **to** you. Wrong direction, and a loan has no obligation row. |
| Making `adjustment.obligation_id` nullable to fit | Weakens a system-wide invariant for one edge case. |
| Read/unread on the bell | Rows are derived state; dismissing one would hide unpaid money behind a badge that then reads wrong. |
| An owner without a login | Owner's decision, 23 Aug 2026. Keeps `ownership_share` as built. |
| Splitting a down payment across owners | Owner's decision — always one funder. |
| Partner-paid instalments in v1 | Reimbursement would cover only the finance third. Deferred with a correct design recorded above, not rejected. |
| Modelling penalty interest on arrears | Reintroduces exactly the split that was removed. A late fee is an ordinary payment or expense. |
| Accepting an overpayment silently | It is either a settlement or a mistake; guessing is worse than refusing and pointing at "Settle and close". |
| Surfacing late facts into their closed month as well | Would reopen a settled month's reported total — the exact thing W-35 prevents. |
| Restricting distributable cash to owners | Every input is already visible to a manager, so it would restrict arithmetic, not information. Owner's decision, 23 Aug 2026. |
| Attaching the leasing document | `attachment.kind`'s CHECK list has no loan value and gains none. Owner's decision, 23 Aug 2026 — not required for now. The agreement lives outside the system. |
| One loan covering multiple vehicles | Recorded as a limitation. |

---

## Open questions

**One remains, and it does not block anything.**

**How far ahead does "instalments due" reach in distributable cash?** Only instalments already overdue, or overdue plus the next one falling due? This changes how conservative the figure is — a judgment about the business's own cash habits rather than an accounting rule. It affects one subtraction in one report and can be settled while item 4 is being built.

Everything else is settled. Items 1 and 2 can start immediately; item 3 needs its `use-cases.md` change drafted first; item 4 is verification plus one small report.
