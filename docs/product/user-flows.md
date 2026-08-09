# Key User Flows

**Status:** v1.1.4 — §2.3 gains a member-administration row (W-49); F-1.4 corrected to offer the passive `owner` role, not just manager/owner-manager; F-1.8's steps reconciled with its own OQ-2 resolution (code, never phone matching); INV-31 added — a business always keeps at least one active owner
**Date:** 7 August 2026
**Purpose:** the validation spine. Every entity, every screen and every test is checked against this file.

> **What changed in v1.1.** Every flow now cites a real use case — v1.0 had nine marked *(new)* because the behaviour existed only here. All nine open questions are resolved and carry the decision that settled them. Four invariants were added, two flows written, the report catalogue built out, and the phasing corrections in §11.2 became confirmations once v1.2 adopted them. §13 lists it all.

---

## 0. How to use this document

This document exists to be *checked against*, three times:

| Phase | What you check | How |
|---|---|---|
| **Data model** | Can every flow in §6 be executed, and every invariant in §5 enforced, on the schema you drew? | Walk each flow's **Writes** line. If a flow needs a fact the schema cannot hold, or an invariant the schema cannot enforce, the schema is wrong — not the flow |
| **Implementation** | Does the screen do the **Steps**, honour the **Defaults**, and offer the **Alternates**? | One flow ≈ one vertical slice. A flow is done when its **Accept** clauses pass |
| **Testing** | Do the **Accept** clauses pass, and do the §5 invariants hold under the §9 adversarial cases? | §9.1 golden fixtures are the regression suite; §5 invariants are property tests |

**Rule of precedence.** Where this document and the use-case document differ, the use-case document wins on *intent* and this one wins on *mechanics* — except for the items in §11, which are open and where neither document is authoritative yet.

**ID scheme.** `F-n.m` flows · `INV-n` invariants · `ST-x` state machines · `OQ-n` open questions. Every flow cites its source `UC-nn` / `W-nn` so traceability runs both ways (§10).

---

## 1. Conventions that must be settled before any table is created

These are not design decisions — they are the off-by-one bugs, and they belong at the top of the document rather than in a code review six weeks from now.

**Now settled as W-54 and §6.16 of the use-case document.** They were unsourced assertions in v1.0; the tables below are the working form of that decision.

### 1.1 Dates, periods, days

| Rule | Value |
|---|---|
| Business timezone | **Single fixed timezone for the whole business** (`Asia/Colombo`, UTC+05:30). Not per-user, not per-device |
| "Today" | The current **local business date**. The daily card, the sending window and period boundaries all use it |
| Storage | Timestamps in **UTC**; pure dates (due dates, period ends, lease start/end) as **date-only**, never as a timestamp — a timestamp date silently shifts under timezone conversion |
| A "day" | Midnight-to-midnight local. A charter departing 18:00 consumes the **whole** vehicle-day (INV-1) |
| Period boundaries | **Inclusive start, inclusive end.** `days_in_period = end − start + 1` |
| Worked check | `12 Jan – 11 Feb` = 31 days · `12 Feb – 11 Mar` = 28 · `12 Mar – 11 Apr` = 31 · `12 Apr – 11 May` = 30. These are the §7.3 figures and they must reproduce exactly |
| Adjacency | Period *n* ends the day before period *n+1* starts. Two periods never share a date |
| Back-dating | Every flow accepts a **past** date (U-8). No flow may hard-code "today" as the only option |
| Future-dating | Refused by default for money movements; allowed for schedules (lease start, trip dates, expiry dates) |

### 1.2 Money

| Rule | Value |
|---|---|
| Currency | **Single currency** (LKR). No multi-currency anywhere. If that ever changes it is a new project, not a column |
| Storage | **Integer minor units.** Never a float, never a language-level decimal that round-trips through JSON as a float |
| Display | Grouped thousands, no decimals where the minor unit is always zero |
| Rounding | **Half-up** to the minor unit |
| Splitting | Any split of an amount across parts (pro-rata rent, mileage excess across two periods, profit across owners) uses **largest-remainder**: compute exact shares, floor them, then hand the remaining minor units to the largest fractional parts. **The parts must sum to the whole, always.** This is the rule that keeps §7.3's `152 / 148` from being `152 / 147` |
| Signs | Amounts are stored positive with an explicit direction/type. No "negative payment" to mean a refund |

### 1.3 Distance

Kilometres, whole numbers. Odometer readings are **monotonic per vehicle** — a reading lower than a prior one is a warning, not a block (U-7), with the reason recorded, because clusters get replaced and readings get mistyped.

### 1.4 The two kinds of period (W-40)

The single most load-bearing distinction in the model, and the one v1.0 of this document inherited as ambiguous:

| | **Billing period** | **Accounting period** |
|---|---|---|
| Example | 12 Jan – 11 Feb | 1 Jul – 31 Jul |
| Comes from | The customer's agreement | The calendar |
| Drives | Rent charged, mileage allowance (INV-7, INV-8) | What is reported and closed (F-9.1, INV-10) |
| Ends | Automatically, when the cycle rolls | Only when somebody closes it |
| Reopens | n/a | **Never** |

**A billing period routinely spans two accounting periods.** Any code, column or variable named just `period` is a defect — it will eventually be read as the wrong one, and W-35's entire rule is written in terms of the accounting one.

### 1.5 Vocabulary that is reserved

The use-case document is right to guard this (§6.13, W-27). These words have exactly one meaning each, in the schema and in the UI:

| Word | Means | Never means |
|---|---|---|
| **Deposit** | Security money held from a customer or driver — a liability | Money moved to the bank (that is **banking**, F-7.4) |
| **Advance** | Money handed to a driver for road expenses, to be reconciled | A payment of his fee |
| **Earned** | What the other party owes for that day/period | What arrived |
| **Received** | What actually arrived | What was owed |
| **Waiver** | A discount you chose to give | A **write-off**, which is a loss you were handed (W-28) |
| **Lost day** | A lease-eligible day that did not run | A day the pattern never scheduled, or a day paused for a trip |
| **Borne by** | Who ultimately bears a cost | Who paid the money out (that is the **funding source**) |

> **Borne-by and paid-by are two different fields.** The manager can pay for the driver's fuel out of his own pocket and still record it as borne by the driver. Collapsing them into one column breaks both §6.1 and UC-60 at once.

---

## 2. Actors and the access model

### 2.1 Actors

| Actor | Logs in | Enters data | Sees |
|---|---|---|---|
| **Owner (passive)** | Yes | Rarely / never | His vehicles' monthly and yearly numbers, his share, his balances |
| **Owner-manager** | Yes | Everything | Everything for the vehicles he owns or manages |
| **Manager (non-owner)** | Yes | Everything operational | Operations for vehicles shared with him; **not** the ownership/capital block |
| **Driver** | Optional, **view-only** (W-13) | Never (W-3) | Only his own record — his two balances, his days, his trips, his advances, his deposit, his statement |
| **Customer** | No | Never | Nothing in-app. Receives messages and statements (Group I) |
| **The system** | — | Generates dues, day cards, reminders, warnings | — |

### 2.2 The scope unit *(now W-39, UC-08)*

The use-case document scopes almost everything to a vehicle, but three things have no vehicle and therefore no home: **costs belonging to no vehicle** (UC-66), **the cash position** (UC-75), and **partner current accounts** (Group G). They need a parent.

**Therefore: a `Business` exists above vehicles.** Every record belongs to exactly one business; `vehicle_id` is *nullable*, `business_id` never is (INV-24). A vehicle belongs to one business. Ownership shares are recorded per vehicle (UC-02), so a business can hold vehicles with different owner splits — which is exactly User A + User B's situation.

This is the smallest change that makes UC-66 and UC-75 expressible. **Settled as W-39**; one business holds vehicles with different ownership splits, since shares live on the vehicle (UC-02).

### 2.3 Permission model *(now W-49, UC-03)*

Not stated anywhere in v1.1 of the use-case document, and it blocked row-level design:

| Capability | Owner | Owner-manager | Manager | Driver (linked) |
|---|---|---|---|---|
| Daily cards, trips, expenses, collections | ✓ | ✓ | ✓ | — |
| Start/close a lease, close a trip | ✓ | ✓ | ✓ | — |
| Write-off, waiver above threshold | ✓ | ✓ | **✗** | — |
| Reverse a receipt (F-8.2) | ✓ | ✓ | **✗** | — |
| Close a period (F-9.1) | ✓ | ✓ | ✗ | — |
| Ownership shares, capital, payouts | ✓ | ✓ (own vehicles) | **✗** | — |
| Messaging config + kill switch | ✓ | ✓ | ✓ (kill switch only) | — |
| Invite, revoke or change a member's role (F-1.4) | ✓ | ✓ | **✗** | — |
| See another driver's data | ✓ | ✓ | ✓ | **✗ — hard boundary** |
| Any write at all | — | — | — | **✗ (W-3)** |

The driver boundary is the only one that is a security requirement rather than a preference: a linked driver account must be unable to read any record not tied to his own driver record, including via a report, an export or a shared link.

---

## 3. Entity state machines

Every state below must be *reachable* and *leavable* in the flows of §6. A state with no exit flow is a bug in this document.

### ST-1 Vehicle

```
draft ──► active ──► disposed
             │
             └─► archived        (kept for history, no new allocations)
```

`active` is a *lifecycle* state. **Availability is not stored — it is derived** from the allocation calendar (F-1.5), because a stored "available" flag and a booking table will disagree within a month. Derived day-state per vehicle-day:

```
not_scheduled | on_lease_A | on_daily_lease_B | on_trip_C | lost_day | off_road
```

Exactly one, always (INV-1).

### ST-2 Lease — arrangement A (monthly rental)

```
draft ──► active ──► closing ──► closed
                        │            │
                        │            └─► (may still receive post-closure charges — F-8.4)
                        └─► (early closure, UC-16)
```

`closing` exists because UC-16 is a six-step sequence that is routinely interrupted (the customer leaves before the odometer is read). It is not cosmetic: a lease in `closing` **generates no new dues** (step 1 already ran) but is **not yet settled**.

### ST-3 Deposit (customer or driver)

```
held ──► hold_window ──► released
  │           │
  │           ├─► applied (against an outstanding balance)
  │           └─► retained (partly or wholly, with reason)
  └─► topped_up / reduced ──► held
```

`hold_window` is W-29's fortnight-or-month after closure. It has an explicit **release date** and its own reminder (F-2.7).

### ST-4 Daily-lease day record — arrangement B

```
                    ┌─► ran_paid_full
generated ──► open ─┼─► ran_paid_short   (raises arrears)
                    ├─► ran_unpaid       (raises arrears)
                    └─► did_not_run      (reason; raises nothing — W-4)

paused_for_trip     ← set by the system when a trip covers the day (UC-30, UC-41)
not_scheduled       ← the pattern does not include this day (UC-05)
```

**`paused_for_trip` and `not_scheduled` are system-set and are not pickable reasons.** See §4.2 — this resolves a contradiction in the source document.

### ST-5 Trip — arrangement C (charter and short hire)

```
hold ──► booked ──► in_progress ──► closed
  │         │            │
  └─────────┴────────────┴─► cancelled  (daily cards restored — UC-45)
```

`hold` is an addition. UC-40 creates a trip on enquiry, and creating it immediately suppresses lease income for those days. A `hold` reserves the calendar **without** suppressing the daily cards, so a tentative enquiry cannot quietly erase a week of expected income. It expires or is confirmed.

### ST-6 Incident

```
open ──► repairs_recorded ──► recovery_pending ──► closed
   └────────────────────────────────────────────────┘   (may close with no recovery)
```

An incident may stay open across a lease closure (UC-16 variation) and across a period close (§6.14). It closes only when repairs are final and every expected recovery has either arrived or been abandoned.

### ST-7 Due (rent, daily amount, driver fee, post-closure charge)

```
pending ──► part_paid ──► paid
   │           │            │
   │           │            └─► reversed ──► back to pending / part_paid (F-8.2)
   ├─► waived (in part or full)
   └─► written_off ──► recovered (links back — INV-15)
```

### ST-8 Message

```
queued ──► suppressed          (condition no longer true at dispatch — INV-12)
   └────► sending ──► sent ──► delivered ──► read
                        └────► failed ──► retried | sent_by_other_channel | handled_manually
```

### ST-9 Period

```
open ──► closed
```

**One direction only.** A closed period is never reopened (W-35). Late facts post to the currently open period with a back-reference (F-8.1).

---

## 4. Two contradictions, resolved

**Both are now fixed in the use-case document at §1.2** — this section is kept for provenance, because the reasoning is what stops either being reintroduced, and because the acceptance criteria in §6 depend on it.

### 4.1 Charter days must not be a pickable lost-day reason

UC-06 lists `on charter` among the reasons a day was lost. UC-30 says the system *"never shows days when the bus was on a charter — those are paused, not missing"*, and UC-41 says those days are *excused*. §7.1's metrics then count `lost 4` from 31 days while 3 days were on charter — so charter days are counted as **operated**, not lost.

If `on charter` stays in the pickable list, a manager confirming a backlog will select it, and the same day will be both `paused_for_trip` (system) and `lost_day` (manual). The lost-days report — described in UC-06 as *"your only protection"* — is then wrong in the one direction that matters.

**Resolution.** `paused_for_trip` is system-set only. The pickable reasons are: breakdown, driver's day off, driver ill, public holiday, no passengers, other. The month decomposes as:

```
days_in_month = not_scheduled + paused_for_trip + ran + lost
lease_eligible_days = ran + lost              ← the denominator for the lost-days report
```

§7.1 check: `31 = 0 + 3 + 24 + 4` ✓ · lease-eligible 28, ran 24, lost 4, lost value `4 × 5,000 = 20,000` ✓.

### 4.2 The pattern must not inflate lost days

UC-05 allows a pattern (every day / alternate days / chosen weekdays). §7.1 assumes every day. If a pattern is set, days outside it must be `not_scheduled` — generating **no card**, counting as **neither operated nor lost**. Otherwise an alternate-day arrangement reports ~15 lost days a month and the report becomes noise the manager learns to ignore.

---

## 5. Invariants — the test backbone

Each is a property test, not a unit test. Each cites its source.

| ID | Invariant | Source |
|---|---|---|
| **INV-1** | A vehicle-day has exactly one earning arrangement. Creating an overlap is warned at the moment of conflict and refused if confirmed anyway would double-count income | §6.3, UC-20, UC-40 |
| **INV-2** | `earned` and `received` are stored as separate facts on every day and every due. No code path writes one from the other | §6.8, W-1 |
| **INV-3** | A driver's two balances never move together except via an `Offset` record carrying a date, an amount and an actor | §6.4, W-2, UC-56 |
| **INV-4** | Deposits and advances never appear in income, in any period, in any report | §6.13, W-8, UC-58 |
| **INV-5** | A cost with `borne_by ≠ us` is excluded from profit and appears only below the line | §6.1, UC-34 |
| **INV-6** | A `did_not_run` day raises `earned = 0`. No configuration can make it non-zero | W-4, UC-33 |
| **INV-7** | Rent for a period is the agreed amount regardless of days or kilometres. Mileage only ever **adds** | W-25, §6.12 |
| **INV-8** | `allowance = daily_limit × days_in_period`, recomputed per period, never carried forward | W-24 |
| **INV-9** | For any two adjacent periods, `excess(combined) ≤ excess(p1) + excess(p2)`. A missing boundary reading can never increase the bill | UC-14 |
| **INV-10** | No write ever mutates a closed period. A late fact posts to the open period carrying `belongs_to_period` | W-35, §6.14 |
| **INV-11** | At most one message exists per `(trigger, record_id, stage)`. Enforce with a unique constraint, not with application logic | §6.10 |
| **INV-12** | A queued message re-evaluates its condition at dispatch; failing that check produces `suppressed` **with a logged reason**, never a silent drop | §6.10, UC-87 |
| **INV-13** | The message log is append-only. No update, no delete, at the database level | UC-87 |
| **INV-14** | Waivers and write-offs never share a category, a total or a report line | W-28, UC-90 |
| **INV-15** | Every recovery links to the write-off it reverses and nets against it; it is never income | UC-90, §9.2 |
| **INV-16** | Ownership shares total exactly 100% and are effective-dated. Recomputing an old month never yields a different split | UC-02, §9.2 |
| **INV-17** | A trip cannot reach `closed` while a driver advance against it is unreconciled | UC-44 |
| **INV-18** | A deposit cannot be settled until the closure summary of outstandings has been rendered | UC-16 |
| **INV-19** | Every odometer reading stores its source: `photo` / `in_person` / `reported` / `at_return` | W-18, §9.2 |
| **INV-20** | All amounts are integer minor units. No float touches a money value at any layer, including the API | §1.2 |
| **INV-21** | Money records are append-only; a correction writes a new record referencing the original. Nothing is destructively edited | U-5, W-36 |
| **INV-22** | Reversing a receipt restores the due, restores the arrears, restores the party balance, **and re-arms the reminder** | UC-93 |
| **INV-23** | An unattributable banking shortfall attaches to the banking event, never to a guessed receipt | W-37, UC-65 |
| **INV-24** | Every record carries `business_id`. `vehicle_id` is nullable; `business_id` is not | §2.2, UC-66 |
| **INV-25** | A linked driver account can read only records tied to its own driver record | §2.3, W-13 |
| **INV-26** | Any split of an amount sums exactly to the original (largest-remainder) | §1.2, W-54 |
| **INV-27** | `borne_by` and `paid_by` are separate fields on every cost and are never derived from one another | W-48, §6.1 |
| **INV-28** | Every money-bearing record carries an audit trail readable from the record itself, not only from a global log | W-50, UC-97 |
| **INV-29** | A lease ends the day before the next begins; a vehicle-day is never claimed by two leases | W-46 |
| **INV-30** | Trip income recognises on the trip's closing date, in exactly one accounting period | W-41 |
| **INV-31** | A business always retains at least one active `owner` or `owner_manager`. Revoking or demoting the last one is refused, never merely warned | §2.3, W-49, W-57 |

---

## 6. The flows

**Template.** *Actor · Source · Phase* → **Pre** → **Steps** → **Defaults** → **Writes** → **Alternates** → **Accept**.

**Phase** follows §9.1 of the source document, with three corrections argued in §11.2.

---

### F-0 — Getting started

#### F-0.1 Create the business and the first user
*Actor:* Owner · *Source:* UC-08, W-39, W-54 · *Phase:* 1
**Pre** none.
**Steps** 1. Sign up. 2. Name the business, confirm timezone and currency. 3. Land on an empty home screen with one action: *Add a vehicle*.
**Writes** `Business`, `User`, `UserBusinessRole`, **`BusinessSettings`**, **the first `AccountingPeriod` (open)**.
**Accept**
· A new business has exactly one owner
· Currency and timezone are set once and are not editable from any operational screen
· **The settings row and the first accounting period are created in the same transaction.** Neither is optional and neither defaults itself into existence: settings is a one-row-per-business table keyed on the business, and *every money record requires an open period to post to*. Without both, the first expense the user records fails on a constraint and the app appears broken on day one
· Defaults applied: auto-waive threshold **zero** (W-43), send window 08:00–20:00, paperwork warning 30 days.

#### F-0.2 Go live mid-stream — opening balances
*Actor:* Owner-manager · *Source:* UC-09, W-51 · *Phase:* 1

Every real deployment starts on a Tuesday with a bus already leased, a car already rented, and a driver already 12,000 behind. Without this flow the first month is a lie and the whole ledger inherits it.

**Pre** business exists.
**Steps**
1. Set a **go-live date**. Everything before it is opening balance; everything after is transactional.
2. Per vehicle: current arrangement, current odometer, current lease/daily-lease terms with their **original start date** (so period boundaries land correctly — §7.3's cycle runs the 12th because the lease started the 12th).
3. Per driver: opening arrears, opening amount owed to him, deposit held, advances outstanding.
4. Per customer: opening unpaid dues with their original due dates (so ageing is truthful from day one), deposit held.
5. Opening cash held by each partner.
6. Confirm. The system writes one dated `OpeningBalance` batch.
**Writes** `OpeningBalanceBatch` + one entry per party/vehicle.
**Alternates**
· **Save as a draft and come back.** The batch is draft until committed, so the go-live date can be set, a vehicle or two entered, and the rest finished after a day of real use. This matters more than it looks: a twenty-field form at first launch, before the user has seen the app do anything, is the highest-friction moment in the product. Nothing needs to be complete on day one — only correct by the time the first month closes.
· Correct an opening balance later — allowed until the first period is closed, then it becomes an ordinary adjustment.
**Accept** · Opening entries never appear as income or expense in any P&L · a driver statement (F-6.5) starting before go-live shows one "brought forward" line, not fabricated days · the ageing report dates opening dues from their **real** due dates.

---

### F-1 — Setup

#### F-1.1 Add a vehicle
*Actor:* Owner or manager · *Source:* UC-01, UC-92 · *Phase:* 1
**Steps** 1. Registration, type. 2. Default arrangement (A / B / C). 3. *While the documents are in your hand:* insurance and registration expiry.
**Defaults** arrangement drives which cards the vehicle shows later.
**Writes** `Vehicle`, `VehicleDocument[]`.
**Accept** · A vehicle set to `daily lease` produces daily cards; one set to `lease out` does not · blank expiry dates produce a home-screen prompt, not an error.

#### F-1.2 Change a vehicle's arrangement
*Actor:* Owner or manager · *Source:* UC-94 · *Phase:* 1
**Pre** no open lease/trip conflicting with the effective date.
**Steps** 1. Pick the new arrangement and an **effective date**. 2. System lists what ends on that date (daily cards stop / lease must be closed first). 3. Confirm.
**Writes** `VehicleArrangement` (effective-dated, never overwritten).
**Accept** · History before the effective date keeps its old arrangement, including its borne-by defaults (§6.7) · a report for a past month uses the arrangement that was in force then, not the current one.

#### F-1.3 Record ownership and contributions
*Actor:* Owner · *Source:* UC-02 · *Phase:* 1
**Steps** 1. Add co-owners with percentage shares. 2. Record what each actually paid toward the purchase.
**Writes** `OwnershipShare` (effective-dated — INV-16), `CapitalContribution`.
**Accept** · Shares not totalling 100% are refused · a share change dated today does not alter last year's profit split · the gap between contribution and share persists and never nags.

#### F-1.4 Bring in a partner or a manager
*Actor:* Owner or owner-manager · *Source:* UC-03, W-57 · *Phase:* 1
**Pre** none — the invitee need not have signed in before.
**Steps** 1. Choose the role — **owner** (reports only), **owner-manager** (a second person entering everything), or **manager** (operational, no ownership/capital block). 2. System generates an **invite code**, scoped to that role and this business. 3. Hand it over out of band — the same "however you'd normally reach them" as a driver's own code (F-1.8). 4. Invitee signs in and enters the code: joins the business in that role, creating their account if this is their first time. 5. **If the role is manager:** grant manage rights on the vehicle and, optionally, a monthly fee — the owner/owner-manager roles skip this step, since they are not scoped to a vehicle at all.
**Alternates** · Revoke — access ends, everything they entered stays · a code not yet redeemed can be reissued, which invalidates the old one.
**Accept** · **A second owner-manager is possible, not just a manager** — F-0.1 grants the *creator* the role; this is how anyone after the first person gets in · **a plain `owner` is reachable too, and it is the more common of the two for a real two-partner business** (⚑, corrected 7 Aug 2026 — v1.2.3's own text named only manager/owner-manager and left the passive partner this project is built around with no way in at all, the same shape of bug A0 fixed for the creator) · a revoked manager's records remain attributed to them · the management fee appears in UC-64's "managed" block, not as a vehicle cost of the owner's block · redeeming a code never lets the invitee pick their own role.

#### F-1.5 See a vehicle's calendar
*Actor:* Manager · *Source:* UC-95 · *Phase:* 1
**Steps** Open a vehicle → month view, each day coloured by its derived state (ST-1). Booking any new allocation starts here.
**Accept** · Every day shows exactly one state · a `hold` (ST-5) is visually distinct from a `booked` trip · the calendar is the screen that answers "is the bus free on the 12th" without opening the trip form · **tapping a free day opens F-5.1 or F-2.1 with that date filled in** — otherwise the calendar answers the question and then makes you go somewhere else to act on it.

#### F-1.6 Add a driver
*Actor:* Manager · *Source:* UC-04 · *Phase:* 1
**Steps** Name, phone, default per-day rate, default per-trip rate, licence expiry. Optionally assign as default driver for a vehicle for a date range.
**Accept** · Rates pre-fill trips and daily cards (U-3) · licence expiry joins the paperwork warnings (F-10.1).

#### F-1.7 Set up the daily lease
*Actor:* Manager · *Source:* UC-05, W-7 · *Phase:* 1
**Steps** 1. Driver. 2. Pattern (every day / alternate / chosen weekdays), with individual days skippable. 3. Amount owed per operating day. 4. Effective date, optional end date.
**Writes** `DailyLeaseArrangement`, `DailyRate` (effective-dated).
**Accept** · Cards generate from the effective date forward, on pattern days only (§4.2) · borne-by defaults come from W-7 with no per-vehicle configuration · setting an end date stops generation without deleting past cards.

#### F-1.8 Link a driver's own account
*Actor:* Manager · *Source:* UC-07, W-13, W-42 · *Phase:* 1 *(moved from 2 in v1.1.3 — §11.2)*
**Pre** none — the driver need not have signed in before, the same shape F-1.4 uses (W-57).
**Steps** 1. On the driver's page, *Link account*. 2. System generates a **linking code**, scoped to this driver record and this business. 3. Hand it over out of band — however you'd normally reach him. 4. Driver enters the code at his own sign-in: linked, creating his account if this is his first time. 5. Driver's view opens read-only.
**Alternates** · Unlink — his access ends, his record and history are untouched · a code not yet redeemed can be reissued, which invalidates the old one (the same alternate F-1.4 offers).
**Accept** · **INV-25 holds** · the driver record works identically whether or not it is ever linked · an unlinked driver loses nothing but sight · redeeming a code never lets the driver pick which driver record it links to — that comes from the code.

> **OQ-2 — resolved as W-42, reconciled with the steps above 7 Aug 2026.** An earlier draft of this flow still described matching by the driver's phone number; that was never the resolution — W-42 rejected phone matching outright, because it lets anyone who knows a number attach himself to a balance. The manager generates a linking code on the driver's page; the driver enters it at his own sign-in. Manager-initiated only, same reasoning as F-1.4's invite code (W-57), which is why the two now share one mechanism rather than two.

#### F-1.9 Keep the mileage packages
*Actor:* Manager · *Source:* UC-18, W-19 · *Phase:* 1
**Steps** Name a package, set kilometres per day and excess rate per km. Selected at F-2.1 step 4.
**Writes** `MileagePackage`; `Lease.mileage_terms` as an **independent copy**.
**Accept** · Editing a package never reprices an existing lease — the terms belong to the rental from the moment it starts, which is also what the customer was told in writing (UC-80) · a rental matching no package is normal, not an exception · deleting a package leaves every lease using it untouched.

---

### F-2 — Arrangement A: car on monthly rent

#### F-2.1 Start a monthly rental
*Actor:* Manager · *Source:* UC-10, W-15/16/19/24/30 · *Phase:* 1
**Pre** vehicle active, arrangement A, free for the start date (F-1.5, INV-1).
**Steps**
1. **Customer** — pick existing or create: name, NIC, mobile, address.
2. **Money** — monthly amount, due day-of-month, deposit.
3. **Term** — start date; fixed term or open-ended.
4. **Mileage** — daily km limit + excess rate per km, from a saved package or custom; **odometer at handover** with source (INV-19). *Leaving the limit blank means unlimited and suppresses every mileage prompt thereafter.*
5. **Reminders** — days before due (default 3) and on the day.
6. **Condition photos** — optional paired set (W-30).
7. Confirm.
**Defaults** due day = start day-of-month · rate package = last used · reminder settings = business default.
**Writes** `Customer`, `Lease`, `MileageTerms`, `PaymentSchedule` (generated), `OdometerReading`, `Deposit(held)` **+ `DepositMovement(taken)`**, `ConditionPhotoSet(handover)`.
**System** generates the billing periods; marks the car allocated; queues the confirmation message (UC-80) carrying the **daily** limit and rate, plus the condition photos.
**System, monthly thereafter — the step that was invisible.** A billing period on its own owes nobody anything. The scheduled job that rolls each new billing period **also raises its rent due**, and *that* is what appears on the home screen and what F-2.2 taps. Without it the lease exists, the schedule exists, and no money is ever asked for.
*The deposit is two records, not one:* the deposit itself, which tracks the lifecycle, and the movement that records the money arriving. Every later change — a top-up, a part-application after an accident (W-44), a refund — is another movement, and the balance is their sum. There is no stored balance to disagree with the history.
**Alternates** · Repeat customer — everything pre-fills from his last rental · no deposit taken · no photos.
**Accept**
· A 12 Jan start bills the 12th of each month and each period runs 12th→11th (§1.1)
· First period's allowance = `daily_limit × days_in_first_period`, never a typed monthly number
· Blank limit ⇒ no odometer prompt anywhere in the lease
· The confirmation message states km **per day**, not per month (UC-80)
· Creating this while the car is on a trip for those dates is refused (INV-1).

#### F-2.2 Collect the month's rent
*Actor:* Manager · *Source:* UC-11 · *Phase:* 1
**Steps** Tap the due → confirm amount and date → record who received the cash.
**Defaults** amount = full due · date = today · received-by = whoever is tapping (U-3).
**Writes** `Receipt`, `DueAllocation`, `HeldCash(+)` for the receiver.
**Alternates**
· **Part payment** — balance stays outstanding and ages
· **Late** — appears on the home screen from the due date
· **Two months together** — one receipt covering both dues, oldest first with a preview (§6.5)
· **Overpayment** — surplus held as customer credit against the next due.
**System** stops the reminder (UC-81) — INV-12.
**Accept** · Recording payment cancels a queued reminder and logs the cancellation with its reason · a part payment leaves the due `part_paid` and the reminder armed · the receiver's held cash increases (feeds UC-75 and F-7.4).

#### F-2.3 Read the odometer and charge excess
*Actor:* Manager · *Source:* UC-14, W-12/16/18/24 · *Phase:* 1
**Steps** 1. Enter reading + **source**. 2. System shows km used, allowance, excess at the agreed rate. 3. Charge, waive (F-2.4) or let the auto-waive threshold absorb it.
**Writes** `OdometerReading(source)`, `MileageAssessment(period, provisional|final)`, `Due(excess)` if any.
**Alternates — the one that will actually happen: no boundary reading.**
· Periods either side are assessed **together** against their combined allowance
· The per-period split is shown **estimated**, apportioned by days, using largest-remainder (INV-26)
· When a later reading arrives, prior provisional assessments are **reconciled**, not rewritten (INV-10, INV-21).
**Accept**
· §7.3 reproduces exactly: `3,500` · `nothing` · combined `7,500` split `152 / 148` marked estimated
· **INV-9 as a property test:** for random `d1, d2, A1, A2`, combined excess ≤ separate excess
· Unused km never reduce rent and never carry forward (INV-7, INV-8)
· A rental extended by 12 days (F-3.4/UC-12) gains `12 × daily_limit` with no recalculation
· A final period cut short is allowed only the days actually used.

#### F-2.4 Adjust or waive
*Actor:* Manager · *Source:* UC-15, W-17, §6.11 · *Phase:* 1
**Steps** On any due: adjustment ± with a reason (goodwill / rounding / agreed discount / late fee / extra charge), or waive in full or part.
**System** an excess below the auto-waive threshold **never surfaces** — and is still recorded as waived.
**Accept** · A waiver is a recorded adjustment, never a deletion — the month shows the 340 charged and the 340 waived · auto-waived amounts appear in the annual "goodwill given" total (the number this feature exists to produce) · **INV-14**: a waiver never lands in the write-off bucket.

> **OQ-3** — the auto-waive threshold has no default (§8). It must be filled on day one. A blank threshold must mean *zero* (waive nothing), never *unbounded*.

#### F-2.5 Renew at a new rate
*Actor:* Manager · *Source:* UC-17 · *Phase:* 1
**Steps** Same customer, new agreed amount from a date.
**Accept** · Old periods keep their old figure · the period cycle does not shift unless the start day is deliberately changed.

#### F-2.6 Close the lease
*Actor:* Manager · *Source:* UC-16, W-26/29/30 · *Phase:* 1
**The order is the feature.** Implement it as a wizard; do not let steps be skipped forward past step 4.

1. **Stop the clock** — set the closing date. No further dues generate. Lease → `closing`.
2. **Decide the final period** — charge the full period / charge the days used (pro-rated, largest-remainder) / an agreed figure with a note.
3. **Final mileage** — closing odometer, allowance on days actually covered, excess billed or waived.
4. **Closure summary** — unpaid dues from earlier periods, this period's amount, excess, **and any open incident** (F-3.4) still awaiting a repair bill or recovery.
5. **Return condition set** — the paired return photos, shown side by side with the handover set.
6. **Settle the deposit** — refund in full / apply against what is owed / retain part with a reason / **hold** for the configured window (ST-3).
7. **Close out** — vehicle available, final statement, closing message (UC-83).

**Writes** `Lease(closed)`, `Due(final period)`, `MileageAssessment(final)`, `ConditionPhotoSet(return)`, `DepositSettlement`, `Statement`.
**Alternates**
· **Extend instead** — schedule continues, each added period brings its own allowance (W-24)
· **He disappears owing money** — close, apply deposit, leave the remainder outstanding **against the customer** (not the lease), mark the vehicle recovered or missing
· **Incident still open** — closure allowed, incident stays open, summary says so.
**Accept**
· **INV-18** — the deposit cannot be settled until step 4 has been rendered. It does not block; it refuses to let you do it blind
· A lease in `closing` generates no dues
· Missing handover photos ⇒ step 5 explains that there is nothing to compare against, and records that the return set was taken anyway
· A held deposit produces a dated release reminder (F-2.7).

#### F-2.7 Release a held deposit when the window expires
*Actor:* System → manager · *Source:* UC-16 step 6, W-29 · *Phase:* 2
**Steps** On the release date, the deposit appears on the home screen. Release, or apply against a charge that arrived in the meantime (F-8.4).
**Accept** · A deposit in `hold_window` is still a liability, still in the cash position, and still not income (INV-4) · releasing it is not an expense (§6.13).

#### F-2.8 Customer statement
*Actor:* Manager · *Source:* UC-19 · *Phase:* 2
**Steps** From the customer or the lease: every due, every receipt, adjustments, mileage assessments, deposit movements, closing balance. Printable and shareable.
**Accept** · Mirrors the driver slip (F-6.6) in structure · reconciles to the same figures the customer was messaged.

---

### F-3 — Costs, incidents, paperwork

#### F-3.1 Record an expense
*Actor:* Any partner or manager · *Source:* UC-60, §6.1, §6.7 · *Phase:* 1
**Steps** Amount, vehicle *(optional)*, category, date, photo. **Two owner fields, both defaulted:** *paid by* (whoever is entering) and *borne by* (derived from arrangement + category per §6.7).
**Writes** `Expense(paid_by, borne_by, vehicle_id nullable, business_id)`.
**Accept** · **§6.7 matrix reproduces exactly**, including tolls flipping between B (driver) and C (us) · `borne_by = us` is the only case that touches profit (INV-5) · out-of-pocket spend increases what the business owes that person, with no extra step.

#### F-3.2 Record a cost belonging to no vehicle
*Actor:* Any partner or manager · *Source:* UC-66, W-32 · *Phase:* 1
Same screen as F-3.1 with the vehicle blank.
**Accept** · Appears as a **separate block beneath** per-vehicle totals, never spread across vehicles · consolidated vehicle profit reads as *vehicle* profit; business profit is stated beneath it after overheads · optional allocation across vehicles exists but is **off by default** · **INV-24** — this is the record that proves `vehicle_id` must be nullable.

#### F-3.3 Log a fuel fill
*Actor:* Manager · *Source:* UC-34, W-20 · *Phase:* 1
**Steps** Litres, odometer, amount if known, borne-by (defaulted).
**Accept** · Arrangement B with `borne_by = driver`: cost excluded from profit, litres and odometer still recorded, shown below the line as "costs borne by the driver" · arrangement B **never prompts** for a reading (W-20) · arrangement C computes km/l per trip · a report with no litres says **"not available"**, never `0`.

#### F-3.4 An accident — the incident container
*Actor:* Manager · *Source:* UC-12, W-9/10/11 · *Phase:* 1
The incident is a **container** that stays open for weeks and gathers everything (§6.6).

1. **Open it** — date, description, photos.
2. **Off-road days and the rent** — enter the dates, then choose *for this incident only*: **rent continues** (default) / **credit the days** pro-rata / **extend the rental** by the lost days.
3. **Repairs** — one cost or several, added as invoices arrive over following weeks, all attached.
4. **Customer contribution** — negotiated *after* the repair cost is known: agreed amount + note; payable in one go, in instalments, or from the deposit.
5. **Insurance** — hidden unless enabled (major damage only): amount claimed, excess borne, status, amount received. Until it arrives it is **pending recovery, not income**.
6. **Bottom line** — total repairs, total recovered, still expected, **net cost to you**.

**Writes** `Incident`, `IncidentCost[]`, `IncidentRecovery[]`, `RentTreatment`, `InsuranceClaim?`, `LeaseExtension` when the treatment is *extend*.
*Not a wizard.* The incident is created at step 1 and everything after it is a separate edit, days or weeks apart — a repair invoice in three weeks, an insurance settlement in three months. A six-step form that must be completed in one sitting would be the wrong shape for a record whose entire purpose is to stay open (§6.6).
*Why the extension is its own record:* choosing *extend* moves the lease end date, and a year later "why does this lease run twelve days long" has exactly one answer. Leaving that to be inferred from two timestamps is leaving it unanswered.
**Accept**
· §7.2 reproduces: 95,000 spent, 80,000 recovered, **net 15,000**, spread July/August/September with `60,000 pending recovery` visible in July and August — *verified end-to-end against live Postgres*
· Pending recovery **never** enters profit (INV-4-adjacent — money expected is not money earned)
· **A recovery carries two dates, not one**: the month it was agreed and became expected, and the month the money actually arrived. They are routinely different — the customer's contribution was agreed and paid in August, the insurer's settled in September. With a single date the two collapse into one month and the *pending recovery* line, which is what makes a bad month visibly temporary, cannot be produced at all
· Costs and recoveries land in different months and the incident still answers "what did this crash cost" years later (§9.2)
· Choosing *extend* adds the days to the lease term and the allowance follows automatically (F-2.3)
· Claims-per-vehicle-per-year is derivable (useful at renewal).

#### F-3.5 Scheduled maintenance
*Actor:* Manager · *Source:* UC-13 · *Phase:* 1
Vehicle cost, not tied to an incident, optional odometer. **System** uses history + odometer to prompt next time.

---

### F-4 — Arrangement B: the daily lease

#### F-4.1 See what's pending
*Actor:* Manager · *Source:* UC-30, U-1, U-4 · *Phase:* 1
Home screen: today's card, then earlier unhandled days oldest-first, then everything else outstanding (rent due, driver balances, trips in progress, paperwork expiring, failed messages).
**Accept** · `paused_for_trip` days never appear (§4.1) · `not_scheduled` days never appear (§4.2) · **nothing about successful messaging appears** — only failures (UC-87).

#### F-4.2 Confirm the day
*Actor:* Manager · *Source:* UC-31, W-1/W-5, §6.8 · *Phase:* 1

```
Bus — Tue 30 Jul
Expected from [driver]: 5,000

   [ Paid in full ]      ← one tap, 90% of days
   [ Something else ]    ← received less / different rate / note
   [ Didn't run ]        ← pick a reason (F-4.4)
```

**Steps** One tap for the normal case. *Something else* opens **both** figures — earned and received — and any shortfall becomes arrears automatically.
**Writes** `DayRecord(earned, state)`, the day's `Obligation`, and — on the one-tap path — a `Payment` and its `Allocation`.
**Accept**
· **INV-2** — a cheap day (`earned` reduced) and an unpaid day (settled short) are distinguishable in storage and in reports forever
· One tap writes all of it **in a single transaction**. This is four inserts, and it is the most frequent operation in the product (U-1); a partial write here leaves a day that is confirmed but unpaid, which is a debt the driver does not owe
· The card is reachable without navigating (U-1).

**If today's card does not exist, confirming creates it.** The cards are generated by a scheduled job, and a job that fails or runs late would otherwise leave the manager with nothing to tap and no way to record the day — the single most-used screen in the app, dark, for a reason he cannot see or fix.
So the day is derivable rather than dependent: the arrangement, the pattern and the rate in force are all known for any date, and confirming a day with no card generates it first. The scheduled job stops being a prerequisite and becomes an optimisation, which is the only safe relationship to have with something that runs unattended.
*Same rule for the catch-up stack* (U-8): a week of missing cards is generated on demand when the week is opened.

#### F-4.3 Adjust the amount, and change it going forward
*Actor:* Manager · *Source:* UC-32, §6.2 · *Phase:* 1
**Steps** Adjust for that day. Optional: **"make this the new daily amount from …"**.
**Accept** · Past days keep their figure; future cards use the new one · **the effective date is editable, not hard-coded to today** — during a week's catch-up (U-8) the change usually took effect days ago · expected-vs-actual variance survives the change (§6.2).

#### F-4.4 Didn't run
*Actor:* Manager · *Source:* UC-33, W-4, UC-06 · *Phase:* 1
**Steps** Pick a reason, done.
**Accept** · **INV-6** — `earned = 0`, no configuration can change it · the day counts as a **lost day** against `lease_eligible_days` (§4.1) · `on charter` is **not** in the pickable list (§4.1) · repeated reasons per driver per month are reportable — the "quietly not running on Fridays" detection UC-06 calls the only protection.

#### F-4.5 He settles several days at once
*Actor:* Manager · *Source:* UC-37, UC-35, §6.5 · *Phase:* 1
W-5 says daily handover; UC-31 admits weekly payers. It is now a first-class use case rather than a variation.
**Steps** Enter the amount → preview of which days it settles, **oldest first** → confirm or change allocation.
**Writes** `Receipt`, `DayAllocation[]`, driver arrears movement.
**Accept**
· Preview before save, always (§6.5) — the arrears figure is what he is most likely to dispute, and "which days did that 30,000 cover" must be answerable weeks later
· Surplus becomes credit against his coming days, not an unexplained overpayment
· **A weekly settler is not in arrears on Thursday.** The arrangement records his agreed rhythm and ageing measures from that point (UC-78), or a perfectly reliable driver sits permanently in a late bucket and the report stops being read.

#### F-4.6 Confirm a week in one pass
*Actor:* Manager · *Source:* UC-38, U-8, §4.3 · *Phase:* 1
§4.3 promises "days missed while away appear as a stack; bulk-confirm at the expected amount" and a two-minute weekly catch-up. Per-day confirmation (F-4.2) cannot deliver that — seven cards at one tap each, with a round trip between them, is not two minutes.
**Steps** 1. The stack shows every open day, oldest first, each at its expected amount. 2. **Confirm all** — one action. 3. Any day needing a different answer is adjusted individually first, then excluded from the bulk action.
**Writes** one `Payment` covering the batch (or one per day, if he paid daily), `DayRecord` + `Obligation` per day, allocations oldest-first.
**Accept**
· Days already adjusted are **not** overwritten by the bulk action
· A single confirmation step shows the list and the total before writing — the same preview discipline as §6.5, for the same reason
· One transaction; a partial failure confirms nothing
· A `did_not_run` day cannot be bulk-confirmed — it needs a reason, and a reason is a decision (W-4).

#### F-4.7 Change the driver
*Actor:* Manager · *Source:* UC-36 · *Phase:* 1
**Steps** New driver from a date; previous assignment ends.
**Accept** · History stays attached to whoever was actually driving · **long downtime** needs no new machinery: assign him to a spare vehicle for a date range (a second arrangement while the first idles), or pay a retainer with no trip attached (F-6.1).

---

### F-5 — Arrangement C: trips (bus charter **and** short car hire)

> UC-20 is the highest-leverage decision in the source document: a short car hire *is* a trip. One screen, not two. Every flow below applies to both.

#### F-5.1 Book a trip
*Actor:* Manager · *Source:* UC-20, UC-40, UC-41, W-6 · *Phase:* 1
**Steps** 1. Vehicle, dates, customer, destination, agreed amount. 2. Driver — **the lease driver is pre-selected**, his default trip rate fills in; change either. 3. System warns what those dates cost: the daily lease pauses and its expected income disappears. 4. Confirm → `booked`, or **hold** (ST-5) if the enquiry is tentative.
**Writes** `Trip` (driver and fee are columns on it — W-47 means no junction table), `VehicleDayAllocation` for the whole range, and day records → `paused_for_trip` *where they exist*.

**The trap: a future trip has no day records to pause.** Cards are generated on a rolling horizon, so a charter booked three months out has nothing to mark. Booking therefore does one of two things depending on the date, and both end in the same place:

| Trip dates | What booking does |
|---|---|
| Inside the horizon | Takes the allocation from the daily lease and sets the existing day records to `paused_for_trip` |
| Beyond the horizon | Writes only its allocation. Card generation later reaches that date, finds it already taken, and creates no card at all |

A developer who assumes booking always updates day records will write code that silently does nothing for future trips — and the daily cards will surface weeks later as though the charter had never been booked, quietly re-claiming income that belongs to the trip.
**Accept**
· **INV-1** — a car on a monthly rental for those dates is refused, stated before the conflict can be created
· A `hold` reserves the calendar but does **not** suppress daily cards
· Lease days covered are **excused** for the regular driver — his statement shows them as excused, not as debt (UC-41)
· If someone else drives, the regular driver simply loses those earning days
· The fee is recorded as money owed to the driver whether or not it is paid now.

#### F-5.2 Costs and advances during the trip
*Actor:* Manager · *Source:* UC-42, UC-21 · *Phase:* 1
Fuel (litres + odometer), tolls, permits, crew food, en-route repairs. Money handed to the driver up front is an **advance, not a cost** (§1.5).
**Accept** · An advance never appears as a trip cost · it appears in the cash position as money he holds (UC-75) · borne-by on a trip defaults to **us** for everything including tolls (§6.7 — note the flip from arrangement B).

#### F-5.3 Customer money
*Actor:* Manager · *Source:* UC-43 · *Phase:* 1
Advance at booking, balance at the end, or the whole thing afterwards. Partial payments accumulate as owed by the customer.

#### F-5.4 Close the trip
*Actor:* Manager · *Source:* UC-44, UC-22 · *Phase:* 1
**Steps** Closing odometer → remaining costs → close. Trip shows income, costs by type, profit, distance, km/l, profit per km.
**Accept** · **INV-17** — will not close while a driver advance against it is unreconciled. *This is the one place friction is correct*, because unreconciled advances turn trip profit into fiction · km/l shows "not available" if litres are missing, never `0`.

#### F-5.5 Cancel a trip
*Actor:* Manager · *Source:* UC-45 · *Phase:* 1
**Accept** · Daily cards for those dates **come back automatically** · any advance is refunded or retained as income (a choice, recorded) · a cancelled trip's costs already incurred remain as vehicle costs.

> **OQ-4** — a trip spanning a month end (28 Jul – 3 Aug): does its income and profit belong to July, August, or split by days? §6.12 sets a recognition rule for rent and is silent on trips. **Blocks monthly reporting.** Recommendation: recognise on the **closing date**, with the trip's own P&L unaffected — simplest, and matches "the trip shows its own profit".

---

### F-6 — Driver money, both directions

#### F-6.1 Pay the driver
*Actor:* Manager · *Source:* UC-50, W-34 · *Phase:* 1
One tap on the trip's driver fee → paid. **Not everything is a trip:** a retainer during a long repair, a bonus, or goodwill is entered the same way with **no trip attached**, categorised for what it is.
**Accept** · No invented trips — forcing every payment onto a trip corrupts trip profitability, the one report you most want to trust · a no-trip payment is visible as such in the statement.

#### F-6.2 Pay part / pay a lump across trips
*Actor:* Manager · *Source:* UC-51, UC-52, §6.5 · *Phase:* 1

```
Paying 15,000 to [driver]
   Trip #14  12 Jun   8,000   → settled in full
   Trip #17  28 Jun  10,000   → 7,000 paid, 3,000 still pending
                              [Confirm]  [Change allocation]
```

**Accept** · Preview **before** saving, always · manual re-allocation available · overpayment held as credit against his next trip · history answers "which trips did that payment cover" months later.

#### F-6.3 Advance before a trip, settle after
*Actor:* Manager · *Source:* UC-53 · *Phase:* 1
Record the advance → afterwards: what he spent, what he returned, anything agreed to keep as fee. **The advance closes at zero.**
**Accept** · Feeds INV-17 · an unclosed advance is visible on the home screen and in the cash position.

#### F-6.4 Offset what he owes against what you owe him
*Actor:* Manager · *Source:* UC-56, W-2, §6.4 · *Phase:* 1

```
[Driver]
   He owes you        8,000    (6 days of shortfalls, oldest 14 Jul)
   You owe him       12,000    (Trip #21 fee, unpaid)
   ─────────────────────────
   Net: you owe him   4,000            [ Offset... ]
```

**Accept** · **INV-3** — the net is *information*; both balances move only through an explicit `Offset` record with date, amount and note · nothing nets automatically anywhere in the system, including in reports · partial offsets allowed.

#### F-6.5 Driver statement
*Actor:* Manager (or driver, read-only) · *Source:* UC-55, UC-59 · *Phase:* 1
Every day owed and paid, every excused day, every lost day, trips and fees, advances, offsets, deposit, and **both balances** at the bottom.
**Accept** · §7.1's driver ends the month at `he owes 2,000 / you owe 9,000`, with the four lost days and the three excused days both visible and distinguishable.

#### F-6.6 The printed slip
*Actor:* Manager · *Source:* UC-57, W-3 · *Phase:* 1
**Not optional.** You chose to be the single source of truth; that works only if the other party can see what you see.
**Accept** · Same figures as F-6.5 · printable, and shareable without a login via a **signed link that expires** — it carries someone's financial position, so it is not a guessable URL.

#### F-6.7 The driver's deposit
*Actor:* Manager · *Source:* UC-58, W-8 · *Phase:* 1
Record it. Later: refund in full, apply against arrears he leaves behind (**deliberate, recorded, never automatic**), or top up.
**Accept** · **INV-4** — never income, in any month · appears in the cash position as money held that is not yours · §7.1: the deposit stays untouched while he owes 2,000, because it is not a debt-collection tool unless he leaves.

#### F-6.8 The driver's own view
*Actor:* Driver (linked) · *Source:* UC-59, W-13 · *Phase:* 2
Both balances, days owed and paid, trips, fees, advances, offsets, deposit, excused days. **Read only, no entry anywhere.**
**Accept** · **INV-25** · every figure matches F-6.5 exactly — two people looking at one number instead of two memories.

---

### F-7 — Partner money and cash

#### F-7.1 What each vehicle made and my share
*Actor:* Owner · *Source:* UC-62, §4.5 · *Phase:* 1
One screen per vehicle: earned, spent, profit, my share. **60 seconds, no entry, no navigation.**
**Accept**
· Uses the ownership share **in force for that month** (INV-16)
· Below-the-line costs (INV-5) are visible but outside profit
· A vehicle with patchy odometer data shows "not available", never a confident wrong number
· **"Spent" is not one table.** A month's costs are the expenses borne by us **plus** the driver fees and management fees owed for that month, which are obligations rather than expenses. Reading only the expense table under-reports every month containing a charter by exactly the driver's fee — 9,000 of 46,000 in the §7.1 walkthrough, which would make the month read 9,000 more profitable than it was. The query is in `data-model.md` §15 and is verified against that fixture.

#### F-7.2 Payouts and partner settlement
*Actor:* Owner · *Source:* UC-63 · *Phase:* 1
**Accept** · A payout is never a cost of the vehicle · settlement between partners moves the current account, not the P&L.

#### F-7.3 Owned vs managed
*Actor:* Owner-manager · *Source:* UC-64 · *Phase:* 1
Two blocks: profit from vehicles I own; fees from vehicles I only manage.

#### F-7.4 Bank the cash you are holding
*Actor:* Manager or partner · *Source:* UC-65, W-27/W-37 · *Phase:* 1
**Why phase 1 despite looking like an afterthought:** every handover and every rent collection adds to held cash. Without this, the cash position climbs forever and the one report answering "where is our money" is the first one people stop believing.
**Steps** Amount, date, where it went, reference.
**Alternates — the bank counts less than you recorded.** Days later, after a week of handovers is pooled into one bag, **you generally cannot tell which handover was short.** So:
· Record the discrepancy against the **banking event** (INV-23), with the same two choices as F-8.2 about who bears it
· Correct at source **only** when the receipt is genuinely identifiable — one payment banked alone, a cheque that bounced.
**Accept** · Banking is not income, not an expense, not a payout — the same money in a different place · it is **never** called a deposit (§1.5) · attributing a pooled shortfall to a remembered driver is refused by design.

#### F-7.5 Where is our cash
*Actor:* Owner or manager · *Source:* UC-75 · *Phase:* 1
Held by each partner, in each account, plus advances outstanding with drivers.
**Accept** · Deposits held appear as a liability against the cash, so the report distinguishes *cash we have* from *cash that is ours* (§6.13) · **a driver's unpaid arrears are a receivable, not held cash** — UC-75's phrasing "held by each driver" means **advances only**; fares he collected on a daily lease were never yours (W-1) and must never appear here.

---

#### F-7.6 What each partner put in and is owed
*Actor:* Owner · *Source:* UC-67, W-52, W-53 · *Phase:* 1
**Steps** Per partner: put in (contributions + out-of-pocket spend) · taken out (payouts, settlements) · earned (profit share + management fee) · holding (business cash in his pocket).
**Writes** read-only; derived from `CapitalContribution`, `Expense.paid_by`, `Payout`, `OwnershipShare`, `HeldCash`.
**Accept**
· **W-52** — paying in more than your share creates a **claim, not a bigger slice**. A owns half and paid 70% ⇒ owed the extra 20%, profit share stays at half. Silently adjusting the split would rewrite last year's profit every time somebody paid an invoice, which is what INV-16's effective dating exists to prevent
· **W-53** — the management fee reduces the owner's vehicle profit before shares, and nets to zero across the business when the manager is also a partner
· This is the line the passive owner actually reads in his 60 seconds (§4.5 of the use cases).

### F-8 — Corrections, late facts, losses

#### F-8.1 A fact arrives after its period closed
*Actor:* Manager · *Source:* W-35, §6.14 · *Phase:* 1 (rule) / 2 (period close)
**The general rule, applied everywhere:** a late fact posts to the **currently open period**, carrying `belongs_to_period` as a reference. It never silently reopens a settled month.
**Accept** · **INV-10** · the record it belongs to shows it inline, dated correctly · reports for the closed month are unchanged; reports for the open month show the item flagged as belonging elsewhere.

#### F-8.2 A payment that turned out not to have arrived
*Actor:* Owner / owner-manager · *Source:* UC-93, W-36/W-37 · *Phase:* 1
**Steps** Open the receipt → correct the amount (partial is the normal case: a 50,000 handover counting out at 48,000 needs **2,000** undone, not 50,000) → choose where the difference lands:

| Choice | When it fits |
|---|---|
| **Back to his arrears** | The count was wrong and he still owes it |
| **Absorbed as a cash-handling loss** | A bad note, or you cannot fairly push a weeks-old discrepancy onto him |

**Accept**
· **INV-22 — all of it undoes:** due returns to unpaid/part-paid, arrears reappear, the party balance returns, **and the reminder re-arms**. The stateful rule running in reverse — the direction nobody remembers to build, so it gets its own test
· **INV-21** — the original receipt is not edited away; a correction record references it (§9.2)
· There is **no silent default** to "his arrears" — defaulting there quietly turns every counting error into the driver's debt, which is how you lose a good driver over 2,000
· **The one thing it cannot undo:** if a receipt message already went out (UC-82), the log is append-only (INV-13) and the message stands. The reversal records that a correction is owed and the next message says so plainly.

#### F-8.3 Write off what you will not collect
*Actor:* Owner / owner-manager · *Source:* UC-90, W-28 · *Phase:* 2
**Steps** Amount, party, reason, date.
**Accept** · **INV-14** — never pooled with waivers, never in the same report line · clears the balance from the home screen and receivables · records the loss against the vehicle it arose from · party history stays intact, and a written-off customer returning next year **arrives with that visible at F-2.1 step 1** · **INV-15** — later payment is a **recovery** linked to the write-off, netting against it, never fresh income.

#### F-8.4 Charge something after everything has closed
*Actor:* Manager · *Source:* UC-91, W-29 · *Phase:* 2
A camera fine or toll arrives three weeks after the car went back.
**Steps** Log the charge against the **closed** lease or trip → it creates an outstanding balance for that party even though nothing is active → optionally send it with a photo of the ticket.
**Accept** · Who bears it follows the arrangement (§6.7): customer's on a lease, driver's on a daily lease, ours on a charter with one tap to deduct from his fee · survivable because of **the deposit hold window** (F-2.7) and **a route to write-off** (F-8.3) · posts per F-8.1.

#### F-8.5 Correct an ordinary data-entry mistake
*Actor:* Manager · *Source:* UC-96, W-50 · *Phase:* 1
Wrong vehicle, duplicate day confirm, fuel logged against the wrong trip, a day confirmed that never ran.
**Steps** Open the record → edit or void → reason (optional for non-money fields, required for money).
**Accept**
· **INV-21** — money records are voided-and-replaced, not overwritten. Every money-fact table carries `voided_at` / `voided_reason` / `voided_by`; payments use their status field for the same purpose
· **Two tables correct differently, deliberately.** A day record is not voided — it moves state, because a day that was confirmed and did not run is still a day, and `did_not_run` is the honest record of it. A duplicate day cannot arise at all: one record per lease per date is a uniqueness constraint
· Allocation rows are voided with their parent, never on their own
· Non-money fields may be edited with the change captured in the audit trail (F-8.6)
· A voided record never disappears from the audit trail.

#### F-8.6 See who changed what
*Actor:* Owner / owner-manager · *Source:* UC-97, W-50 · *Phase:* 1
Two partners share this ledger and one of them does all the entry. An edit history is not a nicety here — it is the thing that makes the arrangement in §2.1 workable.
**Steps** From any money record: who created it, who changed it, when, from what to what.
**Accept** · Every money-bearing table has an audit trail · the trail is append-only and readable from the record, not only from a global log · a passive owner can answer "why is this month different from what I saw last week" without asking.

---

### F-9 — Period close and reporting

#### F-9.1 Close the month
*Actor:* Owner / owner-manager · *Source:* UC-98, W-35, W-40 · *Phase:* 1
**Steps**
1. **Pre-close checklist** — unconfirmed days, trips still open, unreconciled advances, dues with no decision, incidents awaiting a bill.
2. Review each vehicle's month (F-7.1).
3. Close → the period becomes read-only (ST-9), **and its successor is created as open, in the same transaction**.
4. Settle with the other partner (F-7.2).
**Writes** `AccountingPeriod(closed)` **and** `AccountingPeriod(next, open)`.
**Accept**
· **INV-10** — after close, no write touches the period. Late facts go to F-8.1
· Closing is **one-way**. There is no reopen, because a month that can change after everyone agreed it is not a settlement
· The checklist **warns and lists**; it does not block (U-7) — except where closing would leave money unaccounted for
· A period cannot close while an earlier one is open
· **A period cannot close without creating its successor.** Two reasons, and the second is the one that matters: every money record requires an open period to post to, so a close with no successor stops the business dead — *and* W-35 needs somewhere to put a late fact. A close that leaves nowhere to post is a close that breaks the rule it exists to serve.

#### F-9.2 The report catalogue
*Actor:* Owner or manager · *Source:* UC-70…UC-79, W-56 · *Phase:* 1–2

| Report | Counts | Degrades to "not available" when | Phase |
|---|---|---|---|
| **UC-70** this month | Rent by billing period, daily amounts by day, trips by closing date (INV-30). Excludes below-the-line costs, deposits, advances, pending recoveries and opening balances | never | 1 |
| **UC-71** trips that made money | Profit, and profit per km | no closing odometer — the trip leaves the ranking rather than ranking at zero | 1 |
| **UC-72** fuel efficiency | Only fuel **you** bought | no complete fill-to-fill pair; always for arrangement B lease days | 1 |
| **UC-73** the year | As UC-70, with overheads (UC-66) beneath vehicle profit, never spread across it | never | 2 |
| **UC-74** who owes us | Customers, drivers, trip balances, post-closure charges. Excludes write-offs | never | 1 |
| **UC-75** where is our cash | Held by partner and account, **plus driver advances only** — not arrears, not his fares | never | 1 |
| **UC-76** lost days | `lost` out of `ran + lost`, valued at the rate in force each day, with reasons and weekday distribution | never | 1 |
| **UC-77** goodwill given | Waivers and adjustments including auto-waived ones, **never pooled with write-offs** (INV-14) | never | 2 |
| **UC-78** ageing | Buckets from the **agreed settlement point**, not the calendar; opening balances from their real due dates | never | 2 |
| **UC-79** utilisation | Days earning / idle / off-road, revenue per available day | distance-based figures without odometer readings | 2 |

**Accept**
· **INV-19/W-56** — every report degrades to "not available", never to zero. A testable rule, not a sentiment: assert it per report with empty and partial fixtures
· **UC-76's denominator excludes not-scheduled and charter days** (§4). This is the single assertion that keeps the lost-days report honest
· **UC-78 ages from the agreed rhythm** — a weekly settler is not late on Thursday (F-4.5)
· Below-the-line costs never enter profit but are always reachable (INV-5).

#### F-9.3 Export
*Actor:* Owner · *Source:* UC-99, W-49 · *Phase:* 2
A year of transactions to CSV, a statement to PDF, for an accountant or a tax filing.
**Accept** · Exports respect §2.3 permissions · a driver can export only his own statement.

---

### F-10 — Paperwork and notifications

#### F-10.1 Keep the paperwork alive
*Actor:* Owner or manager · *Source:* UC-92, W-31 · *Phase:* **1** (see §11.2)
Insurance, registration, revenue licence, permits, emissions, plus the driver's licence.
**Accept**
· Warns 30 days ahead on the home screen and **keeps warning until the new date is entered**
· **Warns again where it counts** — at F-2.1 and F-5.1, when you are about to send out a vehicle whose insurance or registration has lapsed. A home-screen widget is easy to scroll past on the one morning it matters
· Per U-7 it warns, records that you proceeded anyway, and does not block
· *Why it is the cheapest feature here:* an expired insurance converts the next accident from a claim into an absorbed loss, and F-3.4 will show exactly what the oversight cost.

#### F-10.2 Configure messaging
*Actor:* Owner or manager · *Source:* UC-86, W-14/22/23 · *Phase:* 2
Per vehicle or per person: which messages are on, days before a due date, the sending window.
**Accept** · Window **08:00–20:00** business timezone; a reminder generated at 23:00 waits until 08:00 · **confirmations are exempt** — a message confirming money that just moved is worth nothing an hour later · language per recipient, English default, every template a matched pair · **verification before money**: a number is proven by a first successful delivery before any amount is sent to it · **the kill switch** stops everything immediately, globally or per person.

#### F-10.3 Automatic sends
*Actor:* System · *Source:* UC-80…UC-85 · *Phase:* 2
Lease confirmation (with terms and condition photos) · rent reminder (and the odometer photo request) · receipt · closing figures · driver paid · driver settlement summary.
**Accept**
· **INV-11** — exactly one send per `(trigger, record, stage)`, enforced by a **unique constraint**, not by application logic. A retry, a restart, or two overlapping schedules must not produce two money messages
· **INV-12** — the condition is re-checked **at dispatch**: rent arriving an hour before the reminder cancels it, and the cancellation is logged with its reason
· The confirmation states km **per day**, never a monthly total
· Reminders stop the moment payment is recorded — getting this wrong is worse than sending nothing.

#### F-10.4 The message log
*Actor:* Manager · *Source:* UC-87, W-33, §6.10 · *Phase:* 2
Recipient and their number **at the time** · template name, language code and the **final rendered text** · which transport carried it (W-21) · queued/sent/status changes · outcome · the trigger and who configured it.
**Accept** · **INV-13** — append-only at the database level · readable **two ways**: down the log, and from any due, driver or trip (§9.2) · **only failures** surface on the home screen; success is invisible by design · a failed message can be retried, sent by another channel, or marked handled by hand (W-33) · **the record never depended on WhatsApp** — the statement, the slip and the log hold it regardless; an outage costs timeliness, not evidence.

---

## 7. Screen-to-flow map

Because the source document's usability contract is about *where* things live, not just what they do.

| Screen | Flows | U-rule it must satisfy |
|---|---|---|
| **Home** | F-4.1, F-4.2, F-4.4, F-2.2, F-2.7, F-10.1, failed messages from F-10.4 | U-1 (30-second day), U-4 (all truth here), U-7 |

**The home screen aggregates seven flows, so its order is a design decision, not an accident.** U-4 says everything outstanding appears here; without a priority it becomes a list nobody scans to the bottom of:

1. **Failed messages** — someone was told nothing when they should have been told something (UC-87)
2. **Expired paperwork** — an uninsured day is the largest unbudgeted loss available (UC-92)
3. **Today's day card** — the 30-second obligation, and the reason the app is opened at all (U-1)
4. **Earlier unconfirmed days**, oldest first
5. **Rent due and overdue**
6. **Deposits whose hold window has expired** (F-2.7)
7. **Trips in progress**

The ordering principle: *things that are silently getting worse* come before *things that are merely waiting*. A failed message and a lapsed insurance both degrade while unattended; an open trip does not.
| **Vehicle** | F-1.5 calendar, F-3.x costs, F-7.1 month | U-2 (three levels) |
| **Lease** | F-2.1 → F-2.8 | U-5, U-8 |
| **Trip** | F-5.1 → F-5.5 | U-2, U-7 (INV-17 is the one hard block) |
| **Driver** | F-6.1 → F-6.8 | U-6 (no accounting vocabulary) |
| **Incident** | F-3.4 | §6.6 container |
| **Money/cash** | F-7.2, F-7.4, F-7.5 | U-6 |
| **Reports** | F-9.2, F-9.3 | degradation rule §6.9 |
| **Settings** | F-10.2, thresholds (OQ-3), packages | U-2 level 3, set once |

**The level rule is testable:** *nothing at level 2 or 3 is ever required to save a record* (U-2). Every create form must be savable with only level-1 fields. Make it an automated test over every form, not a design intention.

---

## 8. Traceability

| Flow | Use cases | Decisions |
|---|---|---|
| F-0.1, F-0.2 | UC-08, UC-09 | W-39, W-51, W-54 |
| F-1.1–F-1.8 | UC-01…UC-07, UC-92 | W-3, W-13, W-31, W-42, W-57 |
| F-1.2, F-1.5 | UC-94, UC-95 | §6.3, W-46 |
| F-2.1–F-2.8 | UC-10…UC-17, UC-80…UC-83 | W-9…W-11, W-15…W-19, W-24…W-26, W-29, W-30, W-38 |
| F-2.8 | UC-19 | W-44, W-55 |
| F-3.1–F-3.5 | UC-12, UC-13, UC-34, UC-60, UC-66 | W-7, W-32, §6.1, §6.7 |
| F-4.1–F-4.7 | UC-06, UC-30…UC-36, UC-38 | W-1, W-4, W-5, W-20, W-34 |
| F-4.5 | UC-35 variation | §6.5 |
| F-5.1–F-5.5 | UC-20…UC-22, UC-40…UC-45 | W-6, §6.3, §6.6 |
| F-6.1–F-6.8 | UC-50…UC-59 | W-2, W-8, W-13, W-34, §6.4 |
| F-7.1–F-7.5 | UC-60…UC-66, UC-75 | W-27, W-32, W-37, §6.13 |
| F-8.1–F-8.4 | UC-90, UC-91, UC-93 | W-28, W-29, W-35, W-36, W-37, §6.14 |
| F-8.5, F-8.6 | UC-96, UC-97 | U-5, W-50 |
| F-9.1 | UC-98 | W-35, W-40 — **it is the precondition for W-35** |
| F-9.2, F-9.3 | UC-70…UC-75 | §6.9 |
| F-10.1–F-10.4 | UC-80…UC-87, UC-92 | W-14, W-21…W-23, W-31, W-33, §6.10 |

| F-1.9 | UC-18 | W-19 |
| F-4.5 | UC-37 | §6.5 |
| F-7.6 | UC-67 | W-52, W-53 |
| F-9.2 | UC-70…UC-79 | W-56 |

**Use cases with no flow:** none.
**Flows with no use case:** none. In v1.0 there were nine; v1.2 of the use-case document wrote them all up, so both directions now close.

---

## 9. Test plan

### 9.1 Golden fixtures — §7 becomes the regression suite

The three walkthroughs are already fully specified with real figures. **Encode them verbatim as fixtures.** Any change that alters one of these numbers is a breaking change and should fail loudly.

**G-1 — One month of the bus (§7.1).** Seed: bus, driver, 5,000/day, July, 25,000 deposit.

| Assertion | Expected |
|---|---|
| Days decomposition | `31 = 0 not_scheduled + 3 paused + 24 ran + 4 lost` |
| Driver owed / received | `120,000 / 118,000` |
| Arrears | `2,000`, arising from a day that **ran** and was underpaid — not from a lost day |
| Charter | income `60,000`, costs `22,000 + 3,000 + 9,000`, profit `26,000` |
| Bus July earned | `180,000` |
| Bus July costs | `46,000` (incl. the 12,000 breakdown repair) |
| Bus July net profit | `134,000` |
| Driver's fuel and tolls across his 24 operating days | **below the line, never inside the 46,000** |
| Deposit | in cash position, **not** in any of the above |
| Two balances | `he owes 2,000 / you owe 9,000`, net shown but **not applied** until Offset |
| Lost-day value | `20,000` |
| Fuel efficiency, lease days | **"not available"**, not `0` |

**G-2 — One accident (§7.2).** Car at 70,000/month, accident 8 July, 12 days off road, treatment = **extend**.

| | July | August | September |
|---|---|---|---|
| Repairs | 70,000 | 25,000 | — |
| Recovered | — | 20,000 | 60,000 |
| Pending recovery shown | 60,000 | 60,000 | — |
| Rent | normal | normal | normal, term now ends 12 days later |

Net cost `15,000`, findable as a single number a year later. Insurance: claimed `75,000`, excess `15,000`, received `60,000`. **No revenue lost** — days given back as time.

**G-3 — Mileage on an open-ended rental (§7.3).** From 12 Jan, 100 km/day, 25/km excess.

| Period | Days | Rent | Allowance | Driven | Expected |
|---|---|---|---|---|---|
| 12 Jan–11 Feb | 31 | 70,000 | 3,100 | 3,240 | **3,500** |
| 12 Feb–11 Mar | 28 | 70,000 | 2,800 | 2,650 | **nothing**, 150 km forfeited |
| 12 Mar–11 Apr | 31 | 70,000 | 3,100 | *no reading* | assessed with next |
| 12 Apr–11 May | 30 | 70,000 | 3,000 | 6,400 combined | **7,500**, split `152 / 148`, marked estimated |

The last row is fully derivable and every step is an assertion: combined allowance `3,100 + 3,000 = 6,100` · driven `6,400` · over by `300` · at 25 per km = **`7,500`** · apportioned by days `300 × 31/61 = 152` and `300 × 30/61 = 148`, which **must sum to 300** (INV-26).

**The rent column never moves.** That is the assertion that catches anyone who "fixes" the inconsistency in §6.12.

### 9.2 Property tests

| Test | Property |
|---|---|
| **Mileage inequality** | ∀ `d1,d2,A1,A2 ≥ 0`: `max(0,d1+d2−A1−A2) ≤ max(0,d1−A1) + max(0,d2−A2)` — INV-9. *Verified analytically; the test guards the implementation, not the maths* |
| **Split closure** | Any split of `X` into `n` parts sums to exactly `X` — INV-26 |
| **Period tiling** | Generated periods for any start date and frequency are contiguous, non-overlapping, and cover every date — §1.1 |
| **Allowance** | `allowance = limit × (end − start + 1)` for every generated period — INV-8 |
| **Balance separation** | No sequence of operations moves both driver balances except an Offset — INV-3 |
| **Closed-period immutability** | No operation changes any figure inside a closed period — INV-10 |
| **Message uniqueness** | Concurrent dispatch attempts produce exactly one send — INV-11 |
| **No floats** | Static check: no float type reaches a money field, including through JSON — INV-20 |

### 9.3 Adversarial scenarios — the ones that will actually break it

| # | Scenario | Must produce |
|---|---|---|
| A-1 | Book a trip on a car already on a monthly rental for those dates | Refusal **before** the conflict exists (INV-1) |
| A-2 | Confirm 9 days of backlog in one pass, with a rate change 5 days ago | Correct per-day rates via effective dating (F-4.3), not today's rate applied to all |
| A-3 | Reverse a receipt whose confirmation message already went out | Payment reversed, arrears restored, reminder re-armed, message log untouched, correction flagged as owed (F-8.2) |
| A-4 | Close a lease with an incident still open and a deposit held | Closure allowed, incident stays open, summary says so, deposit enters `hold_window` |
| A-5 | Fine arrives 3 weeks after closure, during the hold window | Charge lands on the closed lease, offsets the held deposit (F-8.4 + F-2.7) |
| A-6 | Fine arrives after the deposit was released and the customer has vanished | Outstanding balance, then write-off (F-8.3), no phantom on receivables |
| A-7 | Bank 300,000 that counts as 297,000, from a week of pooled handovers | Discrepancy on the **banking event**, unattributed, with the bearer chosen (INV-23) |
| A-8 | Driver quits owing 30,000 with a 25,000 deposit | Deposit applied deliberately, 5,000 written off, recovery link retained if he ever pays (INV-15) |
| A-9 | Odometer reading missing for two consecutive periods, then one arrives | Three-period combined assessment, estimated split, prior provisional reconciled not rewritten |
| A-10 | Two managers confirm the same day simultaneously | One record; the second sees the first's result, not a duplicate |
| A-11 | Insurance expired, manager starts a rental anyway | Warned at F-2.1, proceeds, and the override is **recorded** (U-7) |
| A-12 | Charter cancelled after the daily cards were already paused | Cards restored for those dates, advance refunded or retained as a recorded choice |
| A-13 | Alternate-day bus, full month | Lost-days report counts only pattern days (§4.2) |
| A-14 | Linked driver opens the app | Sees only his own record; a crafted request for another driver's data is refused (INV-25) |
| A-15 | Same driver: 6 shortfall days and an unpaid charter fee | Two balances, net shown, nothing moves until Offset (INV-3) |
| A-16 | Month closed, then a repair invoice for that month arrives | Posts to the open period with `belongs_to_period` back-reference; closed month unchanged (INV-10) |
| A-17 | Customer pays two months in one transfer, one of them part-paid already | Oldest-first preview, correct residuals, confirm before save (§6.5) |
| A-18 | Excess of 10 km with the auto-waive threshold set | Never surfaces, and still appears in the annual goodwill total (UC-77) |
| A-19 | Go live mid-month with a live lease started the 12th, a driver 12,000 behind and 40,000 in a pocket | Billing periods land on the 12th, arrears age from their real dates, nothing appears in any P&L (W-51) |
| A-20 | One lease ends and another begins on the same date | The changeover day belongs to the incoming lease; neither double-booked nor lost (INV-29) |
| A-21 | Charter runs 28 Jul – 3 Aug, closed 5 Aug | Whole income in August, undivided; the trip's own P&L unchanged (INV-30) |
| A-22 | Manager fills the bus from his own pocket on a lease day | Business owes him the money **and** the cost stays out of profit as borne by the driver (INV-27) |
| A-23 | Auto-waive threshold left blank | Nothing is waived. A forgotten setting must not forgive every excess (W-43) |
| A-24 | Manager attempts a write-off, a receipt reversal and a period close | All three refused; each is an owner action (W-49) |
| A-25 | Mileage package edited after a lease was agreed under it | The lease keeps its own terms — the ones the customer was messaged (F-1.9) |
| A-26 | Driver settling weekly by agreement, checked on a Thursday | Not in arrears; ageing runs from the agreed settlement point (UC-78) |

---

## 10. What the data model must not lose

§9.2 of the source document lists seven links. All seven, plus what this document adds:

| Link | Breaks if dropped |
|---|---|
| Recovery ↔ write-off | A loss and an unrelated windfall in different months (INV-15) |
| Correction ↔ original receipt | Two unrelated amounts in the audit trail (INV-21) |
| Discrepancy ↔ banking event | A pooled shortfall guessed onto a driver (INV-23) |
| Message ↔ the record it concerned | "What was this person actually told" becomes unanswerable (F-10.4) |
| Incident ↔ its costs and recoveries | The net cost of one crash is unrecoverable (F-3.4) |
| Ownership share ↔ effective dates | Last year's split changes when someone buys in (INV-16) |
| Reading ↔ how it was obtained | A photo and a spoken number carry equal weight in a dispute (INV-19) |
| **Late fact ↔ the period it belongs to** | W-35 collapses; the open month is silently wrong (INV-10) |
| **Cost ↔ borne-by *and* paid-by, separately** | The manager paying for the driver's fuel becomes either his expense or the business's (§1.5, W-48) |
| **Day record ↔ both earned and received** | A cheap day and an unpaid day become indistinguishable forever (INV-2) |
| **Every record ↔ business_id** | Costs with no vehicle have no home (INV-24) |
| **Rate/terms ↔ effective dates** | Recomputing any past month gives a different answer than it did |

---

## 11. Resolved questions and phasing

### 11.1 The nine open questions — all resolved

Every one carried a recommendation in v1.0. All nine were adopted as decisions in use-cases v1.2 and are marked ⚑ proposed there — reversible, but no longer blocking.

| ID | Was blocking | Resolved as |
|---|---|---|
| **OQ-1** | Schema root, permissions | **W-39** — one business, shares per vehicle. `business_id` never blank, `vehicle_id` is |
| **OQ-2** | Sign-up and linking | **W-42** — manager issues a linking code; the driver enters it. Never driver-initiated |
| **OQ-3** | F-2.4, day one | **W-43** — a blank threshold means **zero**, waive nothing |
| **OQ-4** | Monthly reporting | **W-41** — trip income recognises on the closing date (INV-30) |
| **OQ-5** | F-2.1, F-3.4 | **W-44** — customer deposits top up and part-apply like the driver's, with the top-up offered at the moment it is drawn down |
| **OQ-6** | Template submission | **Closed 31 Jul 2026 — Sinhala.** The second template language, supplied by the owner (W-22) |
| **OQ-7** | F-10.3 scope | **W-45** — replies out of scope, with an auto-reply saying so and giving a number that is monitored |
| **OQ-8** | INV-1 | **W-46** — a lease ends the day before the next begins; a same-day handover belongs to the incoming lease (INV-29) |
| **OQ-9** | F-5.1 | **W-47** — one driver per trip in v1. A second is paid as a driver payment with no trip attached |

**Nothing is outstanding.** OQ-6 closed on 31 July 2026: the second language is **Sinhala**. The excess-mileage threshold was never open in the dangerous sense — W-43 gives it a safe default of zero, so a forgotten setting waives nothing rather than everything.

### 11.2 Phasing — corrections adopted

The four corrections proposed in v1.0 were **adopted in use-cases v1.2 §9.1**. They are recorded here because the reasoning is what stops them drifting back:

| Item | Was | Now | Why it could not wait |
|---|---|---|---|
| **Period close (F-9.1)** | Phase 2 | **Phase 1** | W-35 is written in terms of "the currently open period" and "a settled month". Phase 1 had both concepts and no mechanism |
| **Paperwork expiry (F-10.1)** | Phase 2 | **Phase 1** | The use-case document already argued this in its own closing note, then scheduled it second anyway |
| **Condition photo capture (F-2.1, F-2.6)** | Phase 3 | **Phase 1** | UC-80 in phase 2 sends the photos with the confirmation. Only capture moves; side-by-side comparison stays in phase 3 |
| **Audit trail (F-8.6)** | absent | **Phase 1** | Retrofitting audit onto money tables holding live data is materially harder than building it in, and §2's arrangement needs it from the first month |
| **Link a driver's own account (F-1.8)** | Phase 2 | **Phase 1** *(v1.1.3)* | Not a change of mind about the driver's own screen — it moved because **F-1.4 did**. UC §9.1 found that UC-03 (share a vehicle with a manager, always phase one) and UC-07 (a driver's own view, phase two) are the same unanswered question: how does a second person get an account at all. W-57 answers it once, for both, so building one without the other leaves half a mechanism live and the other half stubbed |

## 12. Change control

This document and `use-cases.md` move together. Any change to a **decision** (`W-nn`) or an **invariant** (`INV-n`) requires:

1. The decision updated in the use-case document with its rationale.
2. The affected flows updated here.
3. The affected golden fixture in §9.1 updated — **and if a fixture number changes, that is the signal to stop and re-read why it was that number.**

The three walkthroughs exist to prove the model reconciles. They are the closest thing this project has to a specification that cannot argue back.

---

## 13. What changed in v1.1

Driven entirely by `use-cases.md` reaching v1.2. Nothing here originates in this document.

**Nine flows gained a real use case.** v1.0 marked them *(new)* because the behaviour existed only here:

`F-0.1`→UC-08 · `F-0.2`→UC-09 · `F-1.2`→UC-94 · `F-1.5`→UC-95 · `F-2.8`→UC-19 · `F-8.5`→UC-96 · `F-8.6`→UC-97 · `F-9.1`→UC-98 · `F-9.3`→UC-99

Traceability now closes in both directions: no use case without a flow, no flow without a use case.

**All nine open questions resolved** (§11.1), each as a ⚑ proposed decision in the use-case document. One value remains genuinely open — the second template language — and it blocks nothing in the build.

**Added**

| | |
|---|---|
| §1.4 | The two kinds of period. Any bare `period` identifier is now a defect (W-40) |
| INV-27…INV-30 | borne-by ≠ paid-by · audit trail on money tables · lease boundary day · trip recognition |
| F-1.9 | Mileage packages, with the rule that a lease keeps its own copy of the terms |
| F-7.6 | Partner current account — the page that finally consumes UC-02's stored contribution gap |
| §9.1 G-3 | The combined-allowance derivation spelled out, so every step of the 7,500 is an assertion rather than a result |
| A-19…A-26 | Eight adversarial cases covering opening balances, the boundary day, month-spanning trips, the borne-by/paid-by split, the blank threshold, manager permissions, package edits and weekly settlers |

**Changed**

| | |
|---|---|
| F-4.5 | Was a variation of UC-35; now cites UC-37 as a first-class use case, with the weekly-settler ageing rule |
| F-9.2 | Six one-line reports became the full catalogue, UC-70…UC-79, each with what it counts and when it degrades |
| §4 | Reframed as provenance — both contradictions are fixed at §1.2 of the use-case document |
| §11.2 | Phasing corrections became confirmations; v1.2 adopted all four |
| §1, §2.2, §2.3 | Unsourced assertions now cite W-54, W-39 and W-49 |

**Unchanged: every figure in §9.1.** The three golden fixtures still hold the numbers they held in v1.0, which is the check that all of the above was safe.

---

## 14. What changed in v1.1.1 — independent review

An independent validation pass against the data model found three blockers, six schema-vs-flow gaps and three usability risks. All were valid. What changed here:

**Blockers — the system could not have run without these**

| | Fix |
|---|---|
| No accounting period existed at setup | F-0.1 creates the first period **and** the settings row. Every money record requires an open period; without one the first expense fails on a constraint |
| Closing a month left no open period | F-9.1 creates the successor in the same transaction. A close with nowhere to post next is a close that breaks W-35 |
| Rent dues were never raised | F-2.1 gained the monthly system step that raises each period's due — the invisible step between "lease created" and "tap the due" |

**Gaps**

`F-2.1` deposit writes a movement, not just a deposit · `F-5.1` future trips have no day records to pause, and the two paths are now spelled out · `F-8.5` void coverage stated per table, including why day records move state instead · `F-4.2` the one-tap confirm is four inserts in one transaction.

**Usability**

`F-4.2` a missing day card is created on confirm, so an unattended job stops being a prerequisite for the most-used screen · **`F-4.6` is new** — §4.3 promised a two-minute weekly catch-up that per-day confirmation could not deliver · `F-0.2` opening balances can be saved as a draft and finished later.

**Also** the home screen has a stated priority order (§7), the calendar links into booking, and the printed slip shares via an expiring signed link.

The review's one recommendation not taken: it suggested tracing incident-driven lease extensions through the audit log. A `lease_extension` record was added instead — "why does this lease run twelve days long" is a dispute question, and inferring it from two timestamps is not an answer.
