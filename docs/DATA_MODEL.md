# Data Model

**Status:** v1.0
**Date:** 30 July 2026
**Derived from:** `vehicle-rental-use-cases-v1.md` v1.2 · `user-flows-v1.md` v1.1
**Platform:** Neon Postgres — see `TECH_STACK.md` §7 for the four constraints that shaped this

**Validation:** §9 checks every one of the 62 flows and 30 invariants against these tables. That section is the point of the document; the DDL is what it validates.

---

## 1. Design decisions taken here

Six choices that a reader should disagree with now rather than discover later.

### 1.1 Postgres enforces the invariants, not the Worker

Workers hold nothing between requests, so every rule guarded in application memory is guarded in exactly one code path and forgotten in the next. So the sharpest rules become schema:

| Rule | Enforced by |
|---|---|
| INV-1 one arrangement per vehicle-day | **Primary key** on `vehicle_day_allocation (vehicle_id, business_date)` |
| INV-11 one message per trigger | **Unique index** on `(business_id, trigger, subject, stage)` |
| INV-16 shares total 100%, effective-dated | **Exclusion constraint** + deferred sum trigger |
| INV-13 message log append-only | **Revoked UPDATE/DELETE grants** + trigger |
| INV-10 closed period immutable | **Trigger** on every money table |
| INV-29 lease boundary day | Falls out of the INV-1 primary key |

### 1.2 One `obligation` table, not six receivable tables

Rent, mileage excess, a daily lease amount, a driver's trip fee and a post-closure fine are all "someone owes someone an amount by a date". They differ in *origin*, not in *behaviour* — all of them age, get part-paid, get waived, get written off, and appear in UC-74.

So there is one `obligation` table with a polymorphic `source`, and `direction` distinguishes what we are owed from what we owe. **W-2 falls out for free:** a driver simply has rows in both directions, and nothing nets them without an `offset` row.

### 1.3 `day_record` stores `earned`; settlement lives on its obligation

INV-2 requires earned and received to be separate facts, never derived from one another. Two ways to do that:

- store both on `day_record` **and** create an obligation → two places hold "what he paid", and they drift
- store `earned_minor` on `day_record`, and let `obligation.settled_minor` be the received side

**The second.** They remain separate facts — `earned` is written when the day is confirmed, `settled` only ever by allocating a payment — and there is exactly one authority for each. A cheap day (`earned` reduced) and an unpaid day (`settled` short) stay fully distinguishable, which is all INV-2 asks.

*Flagged because it differs from the flows document*, which writes `DayRecord(earned, received, state)`. Same two facts, one of them stored one table over.

### 1.4 The allocation calendar is materialised

`vehicle_day_allocation` holds one row per vehicle per occupied day. Three vehicles is roughly 1,100 rows a year — nothing — and it buys two things that are otherwise hard: INV-1 becomes a primary key, and UC-95's calendar becomes a single indexed range scan.

A `hold` trip (ST-5) writes rows with `is_hold = true`, which the partial unique index ignores. That is precisely why a tentative enquiry does not suppress a week of expected income.

### 1.5 Effective-dated, never overwritten

Rates, ownership shares, arrangements and lease terms are all `(effective_from, effective_to)` rows with a GiST exclusion constraint preventing overlap. Recomputing any past month must give the answer it gave at the time (§10 of the flows document), and that is only true if nothing is edited in place.

### 1.6 Money is `bigint` minor units, direction is explicit

No `numeric`, no `float`, no negative amounts standing in for a refund. Every amount is `>= 0` with a `direction` or `movement_type` saying which way it goes. A negative number that means "the other way" is readable exactly once.

---

## 2. Conventions

| | |
|---|---|
| Primary keys | `uuid`, UUIDv7 generated in the app (time-ordered, index-friendly) |
| Money | `bigint`, suffix `_minor`, `CHECK (>= 0)` |
| Business dates | `date` — never `timestamptz`. A date that round-trips through a timezone shifts |
| Event times | `timestamptz`, always UTC |
| Tenancy | `business_id uuid NOT NULL` on every business-scoped table |
| Soft delete | None. Records are voided with a reason (W-50), never hidden |
| Enums | `text` + `CHECK`, not PG enums — adding a value to a PG enum is a migration lock |
| Naming | singular table names, `snake_case` |

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- required by the exclusion constraints below
```

### 2.1 Glossary — flow-document names to tables

`user-flows-v1.md` names entities in the language of the flow; the schema names them in the language of storage. Neither is wrong, but reading both without a map is confusing.

| Flow document says | Schema | Note |
|---|---|---|
| `Receipt` | `payment` | One table, both directions (`direction`) |
| `DayAllocation[]` | `payment_allocation` | Generic; the day-ness comes from `obligation.source_type = 'day_record'` |
| `DriverArrears` | `obligation` where `direction='owed_to_us'` | **No arrears table.** Arrears are outstanding obligations |
| `HeldCash(+)` | derived (§15) | **No stored balance.** Computed from payments minus banking minus advances |
| `MileageTerms` | columns on `lease` | Inline, and deliberately copied rather than referenced (§1.5) |
| `PaymentSchedule` | `billing_period` | The generated schedule |
| `ConditionPhotoSet` | `attachment` with `kind IN ('condition_handover','condition_return')` | Grouped by `subject_type` + `subject_id`; the *pair* is a convention, not a table |
| `UserBusinessRole` | `business_member` | |
| `TripDriver(fee)` | `trip.driver_id`, `trip.driver_fee_minor` | Inline. W-47 (one driver per trip) is what makes a junction table unnecessary |
| `OpeningBalanceBatch` | `opening_balance_batch` | |

Four of these are the same idea under two names; the other six are places where the flow implies an entity that turned out not to need a table. **None is a structural gap** — every fact is representable.

---

## 3. Identity, tenancy and periods

```sql
CREATE TABLE business (
  id              uuid PRIMARY KEY,
  name            text NOT NULL,
  currency_code   char(3) NOT NULL,              -- W-54: one currency, fixed at creation
  timezone        text    NOT NULL,              -- W-54: one timezone, e.g. 'Asia/Colombo'
  go_live_date    date,                          -- W-51, set by UC-09
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id              uuid PRIMARY KEY,
  asgardeo_sub    text UNIQUE NOT NULL,          -- the OIDC subject; the only link to the IdP
  email           text,
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- W-49. Role is a business fact, not an identity-provider fact.
CREATE TABLE business_member (
  id              uuid PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES business(id),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  role            text NOT NULL CHECK (role IN ('owner','owner_manager','manager')),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,                   -- UC-03: revoke without losing their records
  UNIQUE (business_id, user_id)
);

CREATE TABLE business_settings (
  business_id             uuid PRIMARY KEY REFERENCES business(id),
  auto_waive_threshold_minor bigint NOT NULL DEFAULT 0 CHECK (auto_waive_threshold_minor >= 0),
                                                 -- W-43: blank means ZERO, waive nothing
  deposit_hold_days       int  NOT NULL DEFAULT 30,      -- W-29
  paperwork_warn_days     int  NOT NULL DEFAULT 30,      -- UC-92
  second_language         text,                          -- W-22, the one value still open
  messaging_kill_switch   boolean NOT NULL DEFAULT false,-- UC-86
  send_window_start       time NOT NULL DEFAULT '08:00', -- W-23
  send_window_end         time NOT NULL DEFAULT '20:00'
);

-- W-40 / UC-98. The ACCOUNTING period. Billing periods are a different table (§5).
CREATE TABLE accounting_period (
  id            uuid PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES business(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,                   -- inclusive, W-54
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at     timestamptz,
  closed_by     uuid REFERENCES app_user(id),
  UNIQUE (business_id, period_start),
  CHECK (period_end >= period_start)
);

-- Only one open period at a time (UC-98: "cannot close while an earlier one is open").
CREATE UNIQUE INDEX one_open_period ON accounting_period (business_id) WHERE status = 'open';
```

**Every money-bearing table carries these two columns:**

```sql
  posted_period_id     uuid NOT NULL REFERENCES accounting_period(id),  -- where it lands
  belongs_to_period_id uuid REFERENCES accounting_period(id),           -- W-35: where it belongs
```

`belongs_to_period_id` is null for ordinary records and set for late facts. That single pair is what makes W-35 real rather than aspirational.

### 3.1 The accounting-period lifecycle — who creates a period

`posted_period_id` is `NOT NULL` on every money table, so **a business with no open accounting period cannot record anything at all.** Two rules close that:

| When | What |
|---|---|
| **At business creation** (UC-08) | The first `accounting_period` is created covering the month of the go-live date, `status = 'open'`. Along with the `business_settings` row, which is a `PRIMARY KEY` reference and will not default itself into existence |
| **At period close** (UC-98) | Closing creates its successor as `open`, **in the same transaction** |

```sql
-- At close. The successor is not optional: the one_open_period index permits at
-- most one open period, and every money table requires one to exist.
WITH closed AS (
  UPDATE accounting_period SET status='closed', closed_at=now(), closed_by=$2
   WHERE id=$1 AND status='open'
  RETURNING business_id, period_end
)
INSERT INTO accounting_period (id, business_id, period_start, period_end, status)
SELECT $3, business_id, period_end + 1,
       (date_trunc('month', (period_end + 1)::timestamp)
         + interval '1 month - 1 day')::date, 'open'
  FROM closed;
```

Without the successor, a close leaves zero open periods and the next write — a day confirmation, an expense, anything — fails on a `NOT NULL`. It is also what gives W-35 somewhere to put a late fact: **a period cannot close without a successor to post late facts into.**

#### Which tables carry a period, and which correctly do not

Not every table holding an amount is a posting. The test is: **does this row represent money moving or an obligation arising?**

| Carries `posted_period_id` | Does not, and should not |
|---|---|
| `obligation`, `payment`, `expense`, `adjustment`, `write_off`, `write_off_recovery`, `offset_record`, `deposit_movement`, `advance`, `advance_settlement`, `banking_event`, `partner_payout`, `capital_contribution`, `day_record`, `mileage_assessment`, `payment_correction`, `incident_recovery`, `insurance_claim` | **Terms and rates:** `lease`, `billing_period`, `daily_lease_rate`, `mileage_package`, `driver`, `management_fee_agreement`, `business_settings` — an agreed figure is not a posting; the obligation it generates is |
| | **Child rows:** `payment_allocation`, `offset_allocation`, `mileage_assessment_split` — the period comes from the parent, and duplicating it invites the two to disagree |
| | **Opening balances:** `opening_balance_entry` — W-51 puts these outside every P&L by definition |

#### There is no backfilling a closed period

`assert_period_open()` is a trigger, and on Neon the application role **cannot** `SET session_replication_role = replica` to bypass it — that requires superuser. Combined with the one-way close (ST-9), this means:

**History must be written in period order, or not at all.** A migration or import that wants to place records in June must do so while June is open. Once closed, the only route in is W-35's — post to the open period with `belongs_to_period_id` pointing back.

This is the intended behaviour rather than a limitation, and it is worth knowing before writing an importer: there is no admin override, no `--force`, and no way to reopen. The seed for the §16.1 fixtures therefore walks the real lifecycle — open July, write July, close July and open August, and so on — which is also the most honest test of UC-98 available.

---

## 4. Vehicles

```sql
CREATE TABLE vehicle (
  id            uuid PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES business(id),
  registration  text NOT NULL,
  vehicle_type  text NOT NULL,
  -- ST-1 lists a 'draft' state; it is deliberately absent. UC-01 creates a vehicle
  -- in one step with two required fields, so there is nothing to save a draft of.
  lifecycle     text NOT NULL DEFAULT 'active'
                  CHECK (lifecycle IN ('active','archived','disposed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, registration)
);

-- UC-94. §1 of the use cases: "every vehicle can move between them over time."
CREATE TABLE vehicle_arrangement (
  id             uuid PRIMARY KEY,
  vehicle_id     uuid NOT NULL REFERENCES vehicle(id),
  arrangement    char(1) NOT NULL CHECK (arrangement IN ('A','B','C')),
  effective_from date NOT NULL,
  effective_to   date,                                   -- null = current
  EXCLUDE USING gist (
    vehicle_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);

-- UC-92, W-31
CREATE TABLE vehicle_document (
  id           uuid PRIMARY KEY,
  vehicle_id   uuid NOT NULL REFERENCES vehicle(id),
  doc_type     text NOT NULL CHECK (doc_type IN
                 ('insurance','registration','revenue_licence','permit','emissions')),
  expiry_date  date NOT NULL,
  reference    text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, doc_type)
);

-- UC-02, INV-16. Basis points so 1/3 splits are expressible; must total 10000.
CREATE TABLE ownership_share (
  id             uuid PRIMARY KEY,
  vehicle_id     uuid NOT NULL REFERENCES vehicle(id),
  user_id        uuid NOT NULL REFERENCES app_user(id),
  share_bp       int  NOT NULL CHECK (share_bp > 0 AND share_bp <= 10000),
  effective_from date NOT NULL,
  effective_to   date,
  EXCLUDE USING gist (
    vehicle_id WITH =, user_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);

-- UC-02 + W-52: what he PAID, as distinct from what he OWNS.
CREATE TABLE capital_contribution (
  id              uuid PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES business(id),
  vehicle_id      uuid REFERENCES vehicle(id),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  contributed_on  date NOT NULL,
  note            text,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),  -- W-35
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);
```

### 4.1 The allocation calendar — where INV-1 lives

```sql
-- INV-1: exactly one earning arrangement per vehicle-day.
CREATE TABLE vehicle_day_allocation (
  business_id   uuid NOT NULL REFERENCES business(id),
  vehicle_id    uuid NOT NULL REFERENCES vehicle(id),
  business_date date NOT NULL,
  arrangement   char(1) NOT NULL CHECK (arrangement IN ('A','B','C')),
  source_type   text NOT NULL CHECK (source_type IN ('lease','daily_lease','trip')),
  source_id     uuid NOT NULL,
  is_hold       boolean NOT NULL DEFAULT false,   -- ST-5: tentative trip, does not occupy
  id            uuid PRIMARY KEY
);

-- The invariant itself. A hold is excluded, so an enquiry never suppresses income.
CREATE UNIQUE INDEX one_arrangement_per_vehicle_day
  ON vehicle_day_allocation (vehicle_id, business_date)
  WHERE is_hold = false;

CREATE INDEX ON vehicle_day_allocation (vehicle_id, business_date);  -- UC-95 calendar
```

**W-46 (the boundary day) needs no rule of its own.** A lease writes allocations through `end_date` inclusive; the next lease starts the following day. If someone tries to start one on the same day the last ended, the unique index refuses — which is the behaviour W-46 describes, enforced rather than remembered.

#### How far ahead the calendar is materialised

An open-ended daily lease has no end date, so "one row per occupied day" cannot mean *every* day. The rule:

| Source | Materialised |
|---|---|
| **Trip** (C) | The full date range, **at booking**. Always bounded, and it must claim the days immediately or two trips could take the same day |
| **Lease** (A) | Through `end_date`; for an open-ended lease, to a **rolling 90-day horizon**, extended daily by the same cron that rolls billing periods |
| **Daily lease** (B) | To the same rolling horizon, written by `generate-day-cards` alongside each `day_record` |

**This is what makes trip booking work for future dates**, and it is the trap worth naming: a trip booked three months out has *no* `day_record` rows to mark as `paused_for_trip`, because they do not exist yet. So booking does two different things depending on the date:

```
Trip booked for a date …
├─ inside the horizon   → the daily-lease allocation row is REPLACED by the trip's,
│                         and the existing day_record is set to 'paused_for_trip'
└─ beyond the horizon   → only the trip's allocation row is written. Later, when
                          generate-day-cards reaches that date, it finds the day
                          already allocated to a trip and generates no card at all
```

Both paths end in the same place: the day earns from the trip, not the lease. But **a developer who assumes booking always updates `day_record` rows will silently do nothing for future trips**, and the daily cards will appear weeks later as if the charter had never been booked. The cron must check `vehicle_day_allocation` before generating, and that check is not optional.

`generate-day-cards` therefore reads: *for each pattern day inside the horizon with no allocation row, insert an allocation and a `day_record`.* Idempotent by the unique index, and correct for trips booked at any distance.

---

## 5. Parties

```sql
-- W-55: a person has an NIC; a school chartering the bus does not.
CREATE TABLE customer (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  customer_type  text NOT NULL CHECK (customer_type IN ('person','organisation')),
  name           text NOT NULL,
  nic            text,               -- person
  registration_no text,              -- organisation
  contact_person text,               -- organisation
  mobile         text,
  address        text,
  language       text NOT NULL DEFAULT 'en',        -- W-22
  opted_in_at    timestamptz,                       -- Group I: nothing sends without this
  number_verified_at timestamptz,                   -- §6.10: proven by first delivery
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (customer_type = 'organisation' OR nic IS NOT NULL OR mobile IS NOT NULL),
  CHECK (customer_type = 'person' OR registration_no IS NOT NULL)
);

CREATE TABLE driver (
  id                    uuid PRIMARY KEY,
  business_id           uuid NOT NULL REFERENCES business(id),
  name                  text NOT NULL,
  mobile                text,
  driver_day_fee_minor  bigint CHECK (driver_day_fee_minor >= 0),   -- UC-04: we PAY him
  driver_trip_fee_minor bigint CHECK (driver_trip_fee_minor >= 0),  -- UC-04: we PAY him
  licence_expiry        date,
  linked_user_id        uuid UNIQUE REFERENCES app_user(id),        -- W-13, nullable
  language              text NOT NULL DEFAULT 'en',
  opted_in_at           timestamptz,
  number_verified_at    timestamptz,
  settlement_rhythm     text NOT NULL DEFAULT 'daily'
                          CHECK (settlement_rhythm IN ('daily','weekly')),
                          -- UC-78: a weekly settler is not overdue on Thursday
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- W-42: manager-initiated linking only. Never driver-initiated search.
CREATE TABLE driver_link_invite (
  id          uuid PRIMARY KEY,
  driver_id   uuid NOT NULL REFERENCES driver(id),
  code_hash   text NOT NULL,                    -- hashed; the plaintext is shown once
  created_by  uuid NOT NULL REFERENCES app_user(id),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES app_user(id)
);
```

> **Note the two fee columns on `driver`.** They are money *we pay him* (UC-04). The amount he pays *us* lives on `daily_lease_rate` (§7) and is called `daily_lease_amount_minor`. v1.1 of the use cases called both a "per-day rate"; the schema keeps them apart by name so no query can confuse the direction.

---

## 6. Arrangement A — monthly rental

```sql
-- UC-18. A typing shortcut; the lease keeps its own copy.
CREATE TABLE mileage_package (
  id                     uuid PRIMARY KEY,
  business_id            uuid NOT NULL REFERENCES business(id),
  name                   text NOT NULL,
  daily_limit_km         int NOT NULL CHECK (daily_limit_km > 0),
  excess_rate_minor_per_km bigint NOT NULL CHECK (excess_rate_minor_per_km >= 0),
  archived_at            timestamptz
);

CREATE TABLE lease (
  id                uuid PRIMARY KEY,
  business_id       uuid NOT NULL REFERENCES business(id),
  vehicle_id        uuid NOT NULL REFERENCES vehicle(id),
  customer_id       uuid NOT NULL REFERENCES customer(id),
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','active','closing','closed')),
  start_date        date NOT NULL,
  end_date          date,                       -- null = open-ended
  billing_day       int  NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  rent_amount_minor bigint NOT NULL CHECK (rent_amount_minor >= 0),

  -- W-19/UC-18: COPIED from the package, never referenced. Editing a package
  -- must not reprice a lease agreed under it.
  mileage_daily_limit_km   int,                 -- NULL = unlimited, suppresses all prompts
  mileage_excess_rate_minor bigint CHECK (mileage_excess_rate_minor >= 0),

  reminder_days_before int NOT NULL DEFAULT 3,  -- UC-81
  closing_date      date,
  final_period_treatment text CHECK (final_period_treatment IN
                      ('full_period','days_used','agreed_figure')),
  closure_summary_shown_at timestamptz,         -- INV-18: gate on deposit settlement
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- W-24, W-40. The BILLING period. Allowance is derived, never typed.
CREATE TABLE billing_period (
  id                uuid PRIMARY KEY,
  lease_id          uuid NOT NULL REFERENCES lease(id),
  seq               int  NOT NULL,
  period_start      date NOT NULL,
  period_end        date NOT NULL,              -- inclusive both ends, W-54
  days_count        int  GENERATED ALWAYS AS (period_end - period_start + 1) STORED,
  rent_amount_minor bigint NOT NULL,            -- W-25: fixed, regardless of days
  allowance_km      int,                        -- W-24: daily_limit × days_count
  UNIQUE (lease_id, seq),
  CHECK (period_end >= period_start)
);
```

> `days_count` is a **generated column**, so `12 Jan – 11 Feb = 31` is arithmetic the database does, not arithmetic anyone can get wrong. It is the single line that makes §7.3's 31 / 28 / 31 / 30 reproducible.

```sql
-- INV-19, W-18. How a reading was obtained is part of the reading.
CREATE TABLE odometer_reading (
  id            uuid PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES business(id),
  vehicle_id    uuid NOT NULL REFERENCES vehicle(id),
  reading_km    int  NOT NULL CHECK (reading_km >= 0),
  read_on       date NOT NULL,
  source        text NOT NULL CHECK (source IN ('photo','in_person','reported','at_return')),
  lease_id      uuid REFERENCES lease(id),
  trip_id       uuid,
  attachment_id uuid,                            -- the photo, when source = 'photo'
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- UC-14. One assessment may span two billing periods when a boundary reading is missing.
CREATE TABLE mileage_assessment (
  id                    uuid PRIMARY KEY,
  lease_id              uuid NOT NULL REFERENCES lease(id),
  from_reading_id       uuid REFERENCES odometer_reading(id),
  to_reading_id         uuid NOT NULL REFERENCES odometer_reading(id),
  driven_km             int  NOT NULL CHECK (driven_km >= 0),
  combined_allowance_km int  NOT NULL,
  excess_km             int  NOT NULL CHECK (excess_km >= 0),   -- W-25: one-directional
  excess_amount_minor   bigint NOT NULL CHECK (excess_amount_minor >= 0),
  is_estimated          boolean NOT NULL DEFAULT false,          -- missing boundary reading
  status                text NOT NULL DEFAULT 'final'
                          CHECK (status IN ('provisional','final','superseded')),
  superseded_by_id      uuid REFERENCES mileage_assessment(id),  -- reconcile, never rewrite
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id)   -- W-35
);

-- The per-period split when combined. Largest-remainder; must sum to the parent (INV-26).
CREATE TABLE mileage_assessment_split (
  id                 uuid PRIMARY KEY,
  assessment_id      uuid NOT NULL REFERENCES mileage_assessment(id) ON DELETE CASCADE,
  billing_period_id  uuid NOT NULL REFERENCES billing_period(id),
  apportioned_km     int  NOT NULL,
  apportioned_excess_minor bigint NOT NULL CHECK (apportioned_excess_minor >= 0),
  UNIQUE (assessment_id, billing_period_id)
);
```

**`excess_km >= 0` is W-25 as a constraint.** Mileage can only ever add. A schema that allowed a negative excess would permit the refund the decision explicitly forbids.

---

## 7. Arrangement B — daily lease

```sql
CREATE TABLE daily_lease (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  vehicle_id     uuid NOT NULL REFERENCES vehicle(id),
  driver_id      uuid NOT NULL REFERENCES driver(id),
  pattern_type   text NOT NULL CHECK (pattern_type IN ('every_day','alternate','weekdays')),
  pattern_weekdays smallint[],                   -- 0..6 when pattern_type = 'weekdays'
  effective_from date NOT NULL,
  effective_to   date,
  EXCLUDE USING gist (
    vehicle_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);

-- UC-32. Effective-dated and BACK-DATEABLE: during a week's catch-up the change
-- usually took effect days ago, so the date is a field, not "today".
CREATE TABLE daily_lease_rate (
  id                       uuid PRIMARY KEY,
  daily_lease_id           uuid NOT NULL REFERENCES daily_lease(id),
  daily_lease_amount_minor bigint NOT NULL CHECK (daily_lease_amount_minor >= 0),
                           -- what he pays US. Not driver_day_fee.
  effective_from           date NOT NULL,
  effective_to             date,
  EXCLUDE USING gist (
    daily_lease_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);

-- ST-4. §4.1 of the flows: days = not_scheduled + paused_for_trip + ran + lost
CREATE TABLE day_record (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  daily_lease_id uuid NOT NULL REFERENCES daily_lease(id),
  vehicle_id     uuid NOT NULL REFERENCES vehicle(id),
  driver_id      uuid NOT NULL REFERENCES driver(id),
  business_date  date NOT NULL,
  state          text NOT NULL DEFAULT 'open' CHECK (state IN
                   ('open','ran_paid_full','ran_paid_short','ran_unpaid',
                    'did_not_run','paused_for_trip')),
  earned_minor   bigint NOT NULL DEFAULT 0 CHECK (earned_minor >= 0),  -- INV-2, INV-6
  expected_minor bigint NOT NULL CHECK (expected_minor >= 0),          -- §6.2: variance
  lost_reason    text CHECK (lost_reason IN
                   ('breakdown','driver_day_off','driver_ill','public_holiday',
                    'no_passengers','other')),   -- §1.2 A: 'on_charter' deliberately absent
  trip_id        uuid,                           -- set when state = 'paused_for_trip'
  note           text,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  UNIQUE (daily_lease_id, business_date),        -- idempotent card generation

  -- W-4 / INV-6: a day that did not run raises nothing. No setting can change it.
  CHECK (state <> 'did_not_run' OR earned_minor = 0),
  CHECK (state <> 'paused_for_trip' OR earned_minor = 0),
  CHECK (state <> 'did_not_run' OR lost_reason IS NOT NULL)
);
```

**Two things this table deliberately does not hold.**

`not_scheduled` is not a state — off-pattern days simply have **no row** (§1.2 B). Generating them would mean a row per skipped day and a report that has to filter them out; their absence says the same thing and cannot be miscounted.

`received_minor` is not a column — it is `obligation.settled_minor` for the day's obligation (§1.3).

---

## 8. Arrangement C — trips

```sql
-- Bus charter AND short car hire. UC-20's decision: one flow, not two.
CREATE TABLE trip (
  id                  uuid PRIMARY KEY,
  business_id         uuid NOT NULL REFERENCES business(id),
  vehicle_id          uuid NOT NULL REFERENCES vehicle(id),
  customer_id         uuid REFERENCES customer(id),
  driver_id           uuid REFERENCES driver(id),      -- W-47: exactly one in v1
  status              text NOT NULL DEFAULT 'hold' CHECK (status IN
                        ('hold','booked','in_progress','closed','cancelled')),
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  destination         text,
  agreed_amount_minor bigint NOT NULL DEFAULT 0 CHECK (agreed_amount_minor >= 0),
  driver_fee_minor    bigint NOT NULL DEFAULT 0 CHECK (driver_fee_minor >= 0),
  opening_odometer_id uuid REFERENCES odometer_reading(id),
  closing_odometer_id uuid REFERENCES odometer_reading(id),
  closing_date        date,
  cancel_reason       text,
  advance_disposition text CHECK (advance_disposition IN ('refunded','retained')), -- UC-45
  -- W-41 / INV-30: recognised on the CLOSING date, in exactly one accounting period.
  posted_period_id    uuid REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (status <> 'closed' OR (closing_date IS NOT NULL AND posted_period_id IS NOT NULL))
);
```

The final `CHECK` is INV-30 made structural: a trip cannot be closed without landing in exactly one accounting period, so a charter running 28 July to 3 August can never be half in each.

---

## 9. Costs

```sql
-- UC-60, UC-66, W-48. vehicle_id is NULLABLE; business_id is not (INV-24).
CREATE TABLE expense (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  vehicle_id     uuid REFERENCES vehicle(id),        -- NULL = overhead (UC-66)
  trip_id        uuid REFERENCES trip(id),
  incident_id    uuid,
  -- The borne-by default matrix (§6.7) is keyed on this. An unconstrained free-text
  -- category means a typo silently falls through to no default.
  category       text NOT NULL CHECK (category IN (
                   'fuel','tolls','fines','cleaning','tyres','servicing','repairs',
                   'insurance','licence','crew_food','permits','office','legal',
                   'messaging','other')),
  amount_minor   bigint NOT NULL CHECK (amount_minor >= 0),
  spent_on       date NOT NULL,

  -- W-48 / INV-27. TWO questions, two answers. Never derived from each other.
  borne_by       text NOT NULL CHECK (borne_by IN ('us','driver','customer')),
  borne_by_driver_id   uuid REFERENCES driver(id),
  borne_by_customer_id uuid REFERENCES customer(id),
  paid_by_user_id      uuid REFERENCES app_user(id),  -- whose money left the room

  litres         numeric(8,2),                        -- fuel efficiency, UC-72
  odometer_reading_id uuid REFERENCES odometer_reading(id),
  attachment_id  uuid,
  note           text,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  voided_at      timestamptz,                         -- W-50: voided, never deleted
  voided_reason  text,
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),

  CHECK (borne_by <> 'driver'   OR borne_by_driver_id   IS NOT NULL),
  CHECK (borne_by <> 'customer' OR borne_by_customer_id IS NOT NULL)
);

-- INV-5: only 'us' reaches profit. This index is what makes that cheap.
CREATE INDEX expense_profit ON expense (business_id, posted_period_id, vehicle_id)
  WHERE borne_by = 'us' AND voided_at IS NULL;
```

### 9.1 Incidents — the cost container

```sql
CREATE TABLE incident (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  vehicle_id     uuid NOT NULL REFERENCES vehicle(id),
  lease_id       uuid REFERENCES lease(id),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN
                   ('open','repairs_recorded','recovery_pending','closed')),
  occurred_on    date NOT NULL,
  description    text,
  off_road_from  date,
  off_road_to    date,
  rent_treatment text CHECK (rent_treatment IN ('continue','credit_days','extend')), -- W-9
  closed_at      timestamptz
);

-- W-9 'extend'. The incident pushes lease.end_date forward and generates further
-- billing periods. Without this row, the audit log records THAT the end date moved
-- and never why — and "why does this lease run 12 days long" is exactly the question
-- asked a year later, when the incident is the only answer.
CREATE TABLE lease_extension (
  id           uuid PRIMARY KEY,
  lease_id     uuid NOT NULL REFERENCES lease(id),
  incident_id  uuid NOT NULL REFERENCES incident(id),
  days_added   int  NOT NULL CHECK (days_added > 0),
  applied_on   date NOT NULL,
  previous_end_date date,
  new_end_date date NOT NULL,
  created_by   uuid REFERENCES app_user(id)
);

CREATE TABLE insurance_claim (                    -- W-11: optional, off by default
  id                    uuid PRIMARY KEY,
  incident_id           uuid NOT NULL REFERENCES incident(id),
  claimed_amount_minor  bigint NOT NULL CHECK (claimed_amount_minor >= 0),
  excess_borne_minor    bigint NOT NULL DEFAULT 0,
  status                text NOT NULL CHECK (status IN
                          ('submitted','in_progress','settled','rejected')),
  received_amount_minor bigint DEFAULT 0,
  received_on           date,
  -- Claimed in one month, settled in another. Two periods, or §7.2's
  -- month-by-month table cannot be produced.
  posted_period_id      uuid NOT NULL REFERENCES accounting_period(id),
  received_period_id    uuid REFERENCES accounting_period(id)
);

-- W-10 / W-11. Until it arrives it is money EXPECTED, never money earned.
CREATE TABLE incident_recovery (
  id                    uuid PRIMARY KEY,
  incident_id           uuid NOT NULL REFERENCES incident(id),
  source                text NOT NULL CHECK (source IN ('customer','insurer')),
  agreed_amount_minor   bigint NOT NULL CHECK (agreed_amount_minor >= 0),
  received_amount_minor bigint NOT NULL DEFAULT 0,
  obligation_id         uuid,                     -- customer contributions become receivable
  note                  text,
  -- The month it was agreed and the month the money arrived are different
  -- months, and §7.2 reports both. One column cannot say both.
  posted_period_id      uuid NOT NULL REFERENCES accounting_period(id),
  received_period_id    uuid REFERENCES accounting_period(id),
  belongs_to_period_id  uuid REFERENCES accounting_period(id),   -- W-35
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);
```

`received_amount_minor` separate from `agreed_amount_minor` is what keeps §7.2's `60,000 pending recovery` visible in July and August without ever entering profit.

**And the two period columns are what let the report say *which* month.** `posted_period_id` is when the recovery was agreed and became expected; `received_period_id` is when the money actually landed, null until it does. §7.2's month-by-month table falls straight out:

| Row | Query |
|---|---|
| **Recovered** | `SUM(received_amount_minor)` grouped by `received_period_id` |
| **Pending recovery shown** | `SUM(agreed_amount_minor)` where `received_period_id IS NULL` |

With a single period column the customer's 20,000 in August and the insurer's 60,000 in September collapse into whichever month the recovery was first written down, and the "pending" line — the one that makes a bad month visibly temporary — cannot be computed at all.

---

## 10. Money

### 10.1 Obligations — everything anyone owes anyone

```sql
CREATE TABLE obligation (
  id            uuid PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES business(id),
  direction     text NOT NULL CHECK (direction IN ('owed_to_us','owed_by_us')),
  party_type    text NOT NULL CHECK (party_type IN ('customer','driver','partner')),
  party_customer_id uuid REFERENCES customer(id),
  party_driver_id   uuid REFERENCES driver(id),
  party_user_id     uuid REFERENCES app_user(id),

  kind          text NOT NULL CHECK (kind IN
                  ('rent','mileage_excess','daily_amount','driver_fee',
                   'post_closure_charge','customer_contribution','management_fee','other')),
  source_type   text NOT NULL,       -- 'billing_period' | 'day_record' | 'trip' | …
  source_id     uuid,
  vehicle_id    uuid REFERENCES vehicle(id),

  amount_minor  bigint NOT NULL CHECK (amount_minor >= 0),
  settled_minor bigint NOT NULL DEFAULT 0 CHECK (settled_minor >= 0),
  waived_minor  bigint NOT NULL DEFAULT 0 CHECK (waived_minor >= 0),
  due_on        date NOT NULL,
  effective_due_on date NOT NULL,    -- UC-78: weekly settler is not late on Thursday
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN
                  ('pending','part_paid','paid','waived','written_off')),

  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_at    timestamptz NOT NULL DEFAULT now(),

  CHECK (settled_minor + waived_minor <= amount_minor),
  CHECK ((party_customer_id IS NOT NULL)::int
       + (party_driver_id   IS NOT NULL)::int
       + (party_user_id     IS NOT NULL)::int = 1),
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

CREATE INDEX obligation_outstanding ON obligation
  (business_id, direction, effective_due_on)
  WHERE status IN ('pending','part_paid');       -- UC-74, UC-78
```

**W-2 needs no special machinery.** A driver's two balances are two `SUM`s over this table filtered by `direction`. Nothing nets them, because nothing in the schema can — only an `offset` row moves both.

### 10.2 Payments and allocation

```sql
CREATE TABLE payment (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  direction      text NOT NULL CHECK (direction IN ('received','paid')),
  party_type     text NOT NULL CHECK (party_type IN ('customer','driver','partner')),
  party_customer_id uuid REFERENCES customer(id),
  party_driver_id   uuid REFERENCES driver(id),
  party_user_id     uuid REFERENCES app_user(id),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  occurred_on    date NOT NULL,
  method         text,
  handled_by_user_id uuid REFERENCES app_user(id),   -- who held the cash (UC-61, UC-75)
  reference      text,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','corrected','reversed')),
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- §6.5: oldest-first with a preview. The preview is what gets written here.
CREATE TABLE payment_allocation (
  id            uuid PRIMARY KEY,
  payment_id    uuid NOT NULL REFERENCES payment(id),
  obligation_id uuid NOT NULL REFERENCES obligation(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  allocated_on  date NOT NULL,          -- may be later than payment.occurred_on
  UNIQUE (payment_id, obligation_id)
);
```

**Overpayment and credit — the convention.** F-2.2 holds a surplus "as customer credit against the next due"; F-4.5 does the same for a driver. There is **no credit table and no credit balance column**. A credit is simply a payment that is not yet fully allocated:

```
credit = payment.amount_minor − SUM(payment_allocation.amount_minor)
```

It is consumed by allocating that same payment to an obligation raised later — which is why `allocated_on` exists separately from `payment.occurred_on`. A payment made in June can settle a due raised in July, and the allocation records when that happened.

*Why not a credit obligation in the other direction:* it would be a second representation of money already recorded, and the two would drift the first time one was corrected. An unallocated remainder cannot drift — it is arithmetic over rows that already exist.

The oldest-first preview (§6.5) must therefore surface **pre-existing credit** before proposing new allocations, or a customer in credit will be asked to pay twice.

```sql
-- Unapplied credit per party. Feeds the allocation preview and UC-74.
SELECT p.id, p.amount_minor - COALESCE(SUM(a.amount_minor), 0) AS credit_minor
  FROM payment p LEFT JOIN payment_allocation a ON a.payment_id = p.id
 WHERE p.business_id = $1 AND p.status = 'active'
 GROUP BY p.id
HAVING p.amount_minor - COALESCE(SUM(a.amount_minor), 0) > 0;
```

```sql
-- UC-93, W-36/W-37. A correction references the original; it never edits it (INV-21).
CREATE TABLE payment_correction (
  id                uuid PRIMARY KEY,
  payment_id        uuid NOT NULL REFERENCES payment(id),
  difference_minor  bigint NOT NULL CHECK (difference_minor > 0),  -- partial is the norm
  bearer            text NOT NULL CHECK (bearer IN ('back_to_arrears','absorbed_loss')),
                    -- W-37: a DECISION, never a silent default
  reason            text NOT NULL,
  receipt_message_id uuid,        -- if a receipt already went out, a correction is owed
  corrected_on      date NOT NULL,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_by        uuid REFERENCES app_user(id)
);
```

### 10.3 Adjustments, write-offs, offsets

```sql
-- UC-15, W-17. A waiver is a recorded adjustment, never a deletion.
CREATE TABLE adjustment (
  id              uuid PRIMARY KEY,
  business_id     uuid NOT NULL REFERENCES business(id),
  obligation_id   uuid NOT NULL REFERENCES obligation(id),
  adjustment_type text NOT NULL CHECK (adjustment_type IN
                    ('goodwill','rounding','agreed_discount','late_fee',
                     'extra_charge','waiver','auto_waiver')),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  sign            smallint NOT NULL CHECK (sign IN (-1, 1)),
  reason          text,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

-- W-28 / INV-14. A SEPARATE TABLE, not an adjustment_type. They must never
-- share a bucket, and the surest way to guarantee that is to not share a table.
CREATE TABLE write_off (
  id            uuid PRIMARY KEY,
  business_id   uuid NOT NULL REFERENCES business(id),
  obligation_id uuid REFERENCES obligation(id),
  party_type    text NOT NULL,
  party_customer_id uuid REFERENCES customer(id),
  party_driver_id   uuid REFERENCES driver(id),
  vehicle_id    uuid REFERENCES vehicle(id),      -- the loss belongs to a vehicle
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  reason        text NOT NULL,
  written_off_on date NOT NULL,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_by    uuid REFERENCES app_user(id),
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

-- INV-15. A later payment is a RECOVERY against the write-off, not fresh income.
CREATE TABLE write_off_recovery (
  id            uuid PRIMARY KEY,
  write_off_id  uuid NOT NULL REFERENCES write_off(id),
  payment_id    uuid NOT NULL REFERENCES payment(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),  -- W-35
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

-- W-2 / UC-56. The ONLY thing that moves both driver balances.
CREATE TABLE offset_record (
  id           uuid PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES business(id),
  driver_id    uuid NOT NULL REFERENCES driver(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  occurred_on  date NOT NULL,
  note         text,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_by   uuid NOT NULL REFERENCES app_user(id),   -- an agreement between two people
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

CREATE TABLE offset_allocation (
  id            uuid PRIMARY KEY,
  offset_id     uuid NOT NULL REFERENCES offset_record(id) ON DELETE CASCADE,
  obligation_id uuid NOT NULL REFERENCES obligation(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0)
);
```

### 10.4 Held money — deposits and advances

```sql
-- §6.13. Money you hold is not money you earned. W-8 (driver), W-44 (customer).
CREATE TABLE deposit (
  id                uuid PRIMARY KEY,
  business_id       uuid NOT NULL REFERENCES business(id),
  party_type        text NOT NULL CHECK (party_type IN ('customer','driver')),
  party_customer_id uuid REFERENCES customer(id),
  party_driver_id   uuid REFERENCES driver(id),
  lease_id          uuid REFERENCES lease(id),
  daily_lease_id    uuid REFERENCES daily_lease(id),
  status            text NOT NULL DEFAULT 'held' CHECK (status IN
                      ('held','hold_window','released','applied','retained')),
  hold_release_date date,                          -- W-29: the fortnight after closure
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The balance is the SUM of movements. There is no stored balance to drift.
CREATE TABLE deposit_movement (
  id            uuid PRIMARY KEY,
  deposit_id    uuid NOT NULL REFERENCES deposit(id),
  movement_type text NOT NULL CHECK (movement_type IN
                  ('taken','topped_up','reduced','applied','refunded','retained')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  occurred_on   date NOT NULL,
  reason        text,
  obligation_id uuid REFERENCES obligation(id),    -- when applied against what is owed
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_by    uuid REFERENCES app_user(id),
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

-- UC-53. Not a cost. Reconciled to zero, and INV-17 blocks trip closure until it is.
CREATE TABLE advance (
  id           uuid PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES business(id),
  driver_id    uuid NOT NULL REFERENCES driver(id),
  trip_id      uuid REFERENCES trip(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  issued_on    date NOT NULL,
  -- Whose pocket it came out of. Without this the cash position (§15) cannot
  -- tell which partner is down the money.
  issued_by_user_id uuid REFERENCES app_user(id),
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','part_settled','settled')),
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),  -- W-35
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

CREATE TABLE advance_settlement (
  id            uuid PRIMARY KEY,
  advance_id    uuid NOT NULL REFERENCES advance(id),
  kind          text NOT NULL CHECK (kind IN ('spent','returned','kept_as_fee')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  occurred_on   date NOT NULL,
  expense_id    uuid REFERENCES expense(id),
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);
```

### 10.5 Cash movement and partner money

```sql
-- UC-65, W-27, W-37. NOT called a deposit — that word is reserved (§1.4 of the flows).
CREATE TABLE banking_event (
  id                    uuid PRIMARY KEY,
  business_id           uuid NOT NULL REFERENCES business(id),
  from_user_id          uuid NOT NULL REFERENCES app_user(id),
  amount_recorded_minor bigint NOT NULL CHECK (amount_recorded_minor > 0),
  amount_counted_minor  bigint NOT NULL CHECK (amount_counted_minor >= 0),
  banked_on             date NOT NULL,
  destination           text NOT NULL,
  reference             text,
  -- INV-23: a pooled shortfall belongs HERE, not guessed onto a receipt.
  discrepancy_minor     bigint GENERATED ALWAYS AS
                          (amount_recorded_minor - amount_counted_minor) STORED,
  discrepancy_bearer    text CHECK (discrepancy_bearer IN
                          ('absorbed','unattributed','attributed_to_receipt')),
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),   -- W-35
  created_by            uuid REFERENCES app_user(id),
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

-- UC-63. Never a cost of the vehicle.
CREATE TABLE partner_payout (
  id           uuid PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES business(id),
  user_id      uuid NOT NULL REFERENCES app_user(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  kind         text NOT NULL CHECK (kind IN ('payout','partner_settlement')),
  occurred_on  date NOT NULL,
  posted_period_id uuid NOT NULL REFERENCES accounting_period(id),
  belongs_to_period_id uuid REFERENCES accounting_period(id),  -- W-35
  voided_at    timestamptz,                  -- W-50: voided, never deleted
  voided_reason text,
  voided_by    uuid REFERENCES app_user(id)
);

-- UC-03, W-53. A vehicle operating cost to the owner; income to the manager.
CREATE TABLE management_fee_agreement (
  id                uuid PRIMARY KEY,
  vehicle_id        uuid NOT NULL REFERENCES vehicle(id),
  manager_user_id   uuid NOT NULL REFERENCES app_user(id),
  monthly_amount_minor bigint NOT NULL CHECK (monthly_amount_minor >= 0),
  effective_from    date NOT NULL,
  effective_to      date,
  EXCLUDE USING gist (
    vehicle_id WITH =, manager_user_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);
```

### 10.6 Opening balances

```sql
-- W-51 / UC-09. Never income, never an expense. A starting position.
CREATE TABLE opening_balance_batch (
  id           uuid PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES business(id) UNIQUE,   -- exactly one, ever
  go_live_date date NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','committed')),
  committed_at timestamptz
);

CREATE TABLE opening_balance_entry (
  id                uuid PRIMARY KEY,
  batch_id          uuid NOT NULL REFERENCES opening_balance_batch(id),
  kind              text NOT NULL CHECK (kind IN
                      ('customer_due','driver_arrears','owed_to_driver',
                       'deposit_held','advance_outstanding','cash_held')),
  party_customer_id uuid REFERENCES customer(id),
  party_driver_id   uuid REFERENCES driver(id),
  party_user_id     uuid REFERENCES app_user(id),
  vehicle_id        uuid REFERENCES vehicle(id),
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  original_due_date date        -- UC-78: ageing must be truthful from day one
);
```

---

## 11. Messaging

```sql
CREATE TABLE message_template (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  name           text NOT NULL,
  language_code  text NOT NULL,                   -- W-22: matched pairs
  category       text NOT NULL DEFAULT 'utility',
  variable_count int NOT NULL,
  approved_at    timestamptz,
  UNIQUE (business_id, name, language_code)
);

CREATE TABLE message (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  trigger_type   text NOT NULL,     -- 'lease_confirmation' | 'rent_reminder' | …
  subject_type   text NOT NULL,     -- 'lease' | 'obligation' | 'payment' | 'trip'
  subject_id     uuid NOT NULL,
  stage          text NOT NULL,     -- 'before_3d' | 'on_due' | 'overdue' | 'once'
  recipient_type text NOT NULL CHECK (recipient_type IN ('customer','driver')),
  recipient_customer_id uuid REFERENCES customer(id),
  recipient_driver_id   uuid REFERENCES driver(id),
  recipient_number_at_time text NOT NULL,         -- UC-87: the number AT THE TIME
  template_id    uuid REFERENCES message_template(id),
  rendered_text  text,                            -- the final text, not a reference
  transport      text NOT NULL DEFAULT 'whatsapp',-- W-21: swappable
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN
                   ('queued','suppressed','sending','sent','delivered','read','failed')),
  suppressed_reason text,                         -- INV-12: never a silent drop
  scheduled_for  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- INV-11. THE constraint. One send per trigger, enforced by the database so that a
-- retry, a restart or two overlapping schedules cannot produce two money messages.
CREATE UNIQUE INDEX one_message_per_trigger
  ON message (business_id, trigger_type, subject_type, subject_id, stage);

-- UC-87 / INV-13. Append-only. This is the audit log.
CREATE TABLE message_event (
  id          uuid PRIMARY KEY,
  message_id  uuid NOT NULL REFERENCES message(id),
  event       text NOT NULL CHECK (event IN
                ('queued','sending','sent','delivered','read','failed',
                 'suppressed','retried','sent_other_channel','handled_manually')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  detail      text
);

CREATE RULE message_event_no_update AS ON UPDATE TO message_event DO INSTEAD NOTHING;
CREATE RULE message_event_no_delete AS ON DELETE TO message_event DO INSTEAD NOTHING;
REVOKE UPDATE, DELETE ON message_event FROM PUBLIC;

-- C-5 precedence: business default → rental/vehicle override → recipient opt-in.
CREATE TABLE messaging_config (
  id           uuid PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES business(id),
  scope_type   text NOT NULL CHECK (scope_type IN ('business','vehicle','lease','recipient')),
  scope_id     uuid,
  message_type text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  days_before  int,
  UNIQUE (business_id, scope_type, scope_id, message_type)
);
```

---

## 12. Attachments and audit

```sql
CREATE TABLE attachment (
  id           uuid PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES business(id),
  kind         text NOT NULL CHECK (kind IN
                 ('condition_handover','condition_return','expense_receipt',
                  'odometer','incident','ticket')),
  r2_key       text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes   int NOT NULL,
  subject_type text NOT NULL,          -- W-30: the handover/return SET is one artefact
  subject_id   uuid NOT NULL,
  uploaded_by  uuid REFERENCES app_user(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

-- W-50 / INV-28 / UC-97. Readable FROM the record, not only down a global log.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  business_id  uuid NOT NULL,
  table_name   text NOT NULL,
  record_id    uuid NOT NULL,
  action       text NOT NULL CHECK (action IN ('insert','update','void')),
  changed_by   uuid REFERENCES app_user(id),
  changed_at   timestamptz NOT NULL DEFAULT now(),
  before_json  jsonb,
  after_json   jsonb
);

CREATE INDEX audit_by_record ON audit_log (table_name, record_id, changed_at DESC);
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
```

---

## 13. Triggers that carry the remaining invariants

Four rules cannot be expressed as a constraint and need a trigger. They are listed together because they are the places where the schema stops defending itself.

```sql
-- INV-10. No write may touch a closed accounting period.
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_period
             WHERE id = NEW.posted_period_id AND status = 'closed') THEN
    RAISE EXCEPTION 'accounting period % is closed; post to the open period with '
                    'belongs_to_period_id set (W-35)', NEW.posted_period_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
-- Attached below. A function with no trigger enforces nothing.

-- INV-16. Shares must total exactly 100% on any date they are in force.
CREATE OR REPLACE FUNCTION assert_shares_total() RETURNS trigger AS $$
DECLARE total int;
BEGIN
  SELECT COALESCE(SUM(share_bp),0) INTO total FROM ownership_share
   WHERE vehicle_id = NEW.vehicle_id
     AND daterange(effective_from, effective_to, '[]') @> NEW.effective_from;
  IF total <> 10000 THEN
    RAISE EXCEPTION 'ownership shares total % bp on %, must be 10000',
                    total, NEW.effective_from;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
-- CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED, so a multi-row change is legal.

-- INV-17. A trip cannot close with an unreconciled advance against it.
CREATE OR REPLACE FUNCTION assert_advances_settled() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'closed' AND EXISTS (
       SELECT 1 FROM advance WHERE trip_id = NEW.id AND status <> 'settled') THEN
    RAISE EXCEPTION 'trip % has an unreconciled driver advance (INV-17)', NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- INV-26. Any split must sum exactly to its parent.
CREATE OR REPLACE FUNCTION assert_split_sums() RETURNS trigger AS $$
DECLARE parent bigint; parts bigint;
BEGIN
  SELECT excess_amount_minor INTO parent FROM mileage_assessment WHERE id = NEW.assessment_id;
  SELECT COALESCE(SUM(apportioned_excess_minor),0) INTO parts
    FROM mileage_assessment_split WHERE assessment_id = NEW.assessment_id;
  IF parts <> parent THEN
    RAISE EXCEPTION 'split total % <> assessment % (INV-26)', parts, parent;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
```

### 13.1 Attaching them — the step that is easy to skip

**A function with no trigger enforces nothing.** An earlier draft of this document defined all four functions and attached none of them, listing the attachments as a prose comment instead. Every table was created, every check passed, and four invariants that §14 claimed as database-enforced were silently inert. It was invisible until the schema was executed and `pg_trigger` was counted.

```sql
-- INV-10. Every table carrying posted_period_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'obligation','payment','expense','adjustment','write_off','write_off_recovery',
    'offset_record','deposit_movement','advance','banking_event','partner_payout',
    'capital_contribution','day_record','mileage_assessment','payment_correction']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_period_open BEFORE INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION assert_period_open()', t, t);
  END LOOP;
END $$;

-- INV-16. Deferred, so a 60/40 change lands as one legal transaction.
CREATE CONSTRAINT TRIGGER ownership_shares_total
  AFTER INSERT OR UPDATE ON ownership_share
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_shares_total();

-- INV-17.
CREATE TRIGGER trip_advances_settled
  BEFORE UPDATE ON trip
  FOR EACH ROW EXECUTE FUNCTION assert_advances_settled();

-- INV-26. Deferred, so the parts may be inserted one at a time.
CREATE CONSTRAINT TRIGGER split_sums
  AFTER INSERT OR UPDATE ON mileage_assessment_split
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_split_sums();
```

**Both deferred triggers must be `DEFERRABLE INITIALLY DEFERRED`, and that is not a detail.** Shares are checked at commit because a 60/40 split is two inserts that are individually invalid — a non-deferred trigger would reject the first one and make a legal change impossible. The same holds for a mileage split across two periods.

**Verification, after any migration:**

```sql
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;  -- expect 18
```

**INV-18 (deposit not settled before the closure summary is shown)** is the one deliberately left to the application: `lease.closure_summary_shown_at` is set when the summary renders, and the deposit-settlement handler refuses while it is null. It is a workflow-ordering rule, not a data rule, and a trigger would enforce it against imports and fixtures too.

---

## 14. The invariant enforcement map

Every invariant in `user-flows-v1.md` §5, and where it actually lives.

| INV | Enforced by | Level |
|---|---|---|
| 1 one arrangement per vehicle-day | `one_arrangement_per_vehicle_day` unique index | **DB** |
| 2 earned ≠ received | `day_record.earned_minor` vs `obligation.settled_minor` (§1.3) | **Schema shape** |
| 3 two driver balances, offset only | `obligation.direction` + `offset_record` | **Schema shape** |
| 4 held money never income | `deposit`, `advance` are separate tables, absent from every P&L query | **Schema shape** |
| 5 borne-by ≠ us excluded from profit | `expense_profit` partial index; every P&L filters `borne_by='us'` | **Query + index** |
| 6 did-not-run raises zero | `CHECK (state <> 'did_not_run' OR earned_minor = 0)` | **DB** |
| 7 rent fixed, mileage one-directional | `CHECK (excess_km >= 0)`; rent on `billing_period` | **DB** |
| 8 allowance = limit × days | `days_count` generated column; allowance written at generation | **DB** |
| 9 combined ≤ separate excess | Property test — arithmetic, not storage | **Test** |
| 10 closed period immutable | `assert_period_open()` trigger + `belongs_to_period_id` | **DB** |
| 11 one message per trigger | `one_message_per_trigger` unique index | **DB** |
| 12 re-check at dispatch | `message.suppressed_reason` + dispatch job | **App + audit** |
| 13 message log append-only | RULEs + revoked grants on `message_event` | **DB** |
| 14 waiver ≠ write-off | Two separate tables, never unioned | **Schema shape** |
| 15 recovery links to write-off | `write_off_recovery.write_off_id` NOT NULL | **DB** |
| 16 shares total 100%, dated | Exclusion constraint + `assert_shares_total()` | **DB** |
| 17 no close with open advance | `assert_advances_settled()` trigger | **DB** |
| 18 outstandings before deposit | `lease.closure_summary_shown_at` gate | **App** (§13) |
| 19 reading records its source | `odometer_reading.source NOT NULL` + CHECK | **DB** |
| 20 integer minor units | `bigint` columns; codec at both edges | **DB + app** |
| 21 append-only money records | `voided_at`/`voided_reason`/`voided_by` on all 13 money-fact tables; `payment.status`; `payment_correction` | **Schema shape** |
| 22 reversal restores everything | Transaction in `payment_correction` handler | **App + test** |
| 23 pooled shortfall on the event | `banking_event.discrepancy_minor` generated | **DB** |
| 24 every record has a business | `business_id NOT NULL` everywhere; `vehicle_id` nullable | **DB** |
| 25 driver sees only his own | `driver.linked_user_id` scoping in the data layer | **App** |
| 26 splits sum to the whole | `assert_split_sums()` trigger | **DB** |
| 27 borne_by ≠ paid_by | Two columns on `expense` | **DB** |
| 28 audit trail on money tables | `audit_log` table + index exist; **the writer is not yet built** (D-8) | **Pending** |
| 29 lease boundary day | Falls out of INV-1's unique index | **DB** |
| 30 trip in exactly one period | `CHECK (status <> 'closed' OR (closing_date IS NOT NULL AND posted_period_id IS NOT NULL))` | **DB** |

**22 of 30 are enforced by Postgres.** The eight that are not are either arithmetic (9), workflow ordering (18, 22), scoping (25), or cross-cutting discipline (5, 12, 20, 28) — and each has a named test in `user-flows-v1.md` §9.

---

## 15. The queries that must be cheap

The report definitions in UC-70…UC-79, as the shape they take against this schema. These are the access patterns the indexes above exist for.

**UC-76 lost days — the report UC-06 calls the only protection**

```sql
SELECT driver_id,
       COUNT(*) FILTER (WHERE state = 'did_not_run')                   AS lost,
       COUNT(*) FILTER (WHERE state LIKE 'ran_%')                      AS ran,
       COUNT(*)                                                        AS lease_eligible,
       SUM(expected_minor) FILTER (WHERE state = 'did_not_run')        AS lost_value_minor,
       EXTRACT(dow FROM business_date)                                 AS weekday
  FROM day_record
 WHERE business_id = $1 AND business_date BETWEEN $2 AND $3
   AND state <> 'paused_for_trip'          -- §1.2 A: charter days are not lost
 GROUP BY driver_id, weekday;
```

Off-pattern days have no row (§7), so `not_scheduled` is excluded by construction — the denominator is `ran + lost` and cannot be inflated by either exclusion. That is §1.2 of the use cases expressed as a `WHERE` clause.

**UC-74 / UC-78 who owes us, and by how long**

```sql
SELECT party_type, COALESCE(party_customer_id, party_driver_id) AS party_id,
       SUM(amount_minor - settled_minor - waived_minor) AS outstanding_minor,
       MIN(effective_due_on)                            AS oldest,
       CASE WHEN CURRENT_DATE - MIN(effective_due_on) <= 0  THEN 'current'
            WHEN CURRENT_DATE - MIN(effective_due_on) <= 30 THEN '1-30'
            WHEN CURRENT_DATE - MIN(effective_due_on) <= 60 THEN '31-60'
            WHEN CURRENT_DATE - MIN(effective_due_on) <= 90 THEN '61-90'
            ELSE 'over-90' END AS bucket
  FROM obligation
 WHERE business_id = $1 AND direction = 'owed_to_us'
   AND status IN ('pending','part_paid')
 GROUP BY 1,2;
```

`effective_due_on` rather than `due_on` is UC-78's rule in one column: a driver who settles every Friday by agreement is not overdue on Thursday.

**UC-56 the driver's two balances, unmerged**

```sql
SELECT direction, SUM(amount_minor - settled_minor - waived_minor) AS balance_minor
  FROM obligation
 WHERE party_driver_id = $1 AND status IN ('pending','part_paid')
 GROUP BY direction;
```

Two rows out. There is no query in this system that returns one netted number, because W-2 says the net is information and only an `offset_record` may move both.

**UC-75 where is our cash — held per partner**

The join is across four tables and the arithmetic is not obvious, so it belongs here rather than being reinvented three times.

```sql
SELECT u.id, u.display_name,
       COALESCE(r.total,0) - COALESCE(b.total,0) - COALESCE(a.total,0) AS held_minor
  FROM app_user u
  LEFT JOIN (SELECT handled_by_user_id uid, SUM(amount_minor) total
               FROM payment
              WHERE direction='received' AND status='active' AND voided_at IS NULL
              GROUP BY 1) r ON r.uid = u.id
  LEFT JOIN (SELECT from_user_id uid, SUM(amount_counted_minor) total
               FROM banking_event WHERE voided_at IS NULL GROUP BY 1) b ON b.uid = u.id
  LEFT JOIN (SELECT issued_by_user_id uid, SUM(amount_minor) total
               FROM advance
              WHERE status <> 'settled' AND voided_at IS NULL
              GROUP BY 1) a ON a.uid = u.id
 WHERE u.id IN (SELECT user_id FROM business_member
                 WHERE business_id = $1 AND revoked_at IS NULL);
```

Three things this query encodes that prose kept getting wrong:

- It subtracts `amount_counted_minor`, not `amount_recorded_minor` — when the bank counted less, the partner is still holding the difference until `discrepancy_bearer` decides otherwise (INV-23)
- It subtracts **unsettled advances**, because that cash is with a driver, not the partner — which is why `advance.issued_by_user_id` had to exist at all
- **Deposits held are not in this figure.** They are cash the business holds but does not own (§6.13), reported as a liability *beside* the cash position, never netted into it

**UC-70 what a vehicle cost this month — the query most likely to be written wrong**

A month's costs are **not** `SELECT SUM(amount_minor) FROM expense`. A charter's driver fee is money owed to a person, so it lives on `obligation`, and a cost query that reads only the expense table under-reports every month containing a trip by exactly that fee. In §7.1 that is 9,000 of a 46,000 total — the month would read 9,000 more profitable than it was.

```sql
SELECT COALESCE(SUM(amount_minor), 0) AS costs_minor
  FROM (
    SELECT amount_minor FROM expense
     WHERE vehicle_id = $1 AND posted_period_id = $2
       AND borne_by = 'us' AND voided_at IS NULL        -- INV-5
    UNION ALL
    SELECT amount_minor FROM obligation
     WHERE vehicle_id = $1 AND posted_period_id = $2
       AND direction = 'owed_by_us' AND kind IN ('driver_fee','management_fee')
       AND voided_at IS NULL                            -- W-53
  ) c;
```

Verified against G-1: `37,000` of expenses + `9,000` of driver fee = **`46,000`**, giving `180,000 − 46,000 = 134,000`.

**UC-98 pre-close checklist — unconfirmed days**

```sql
SELECT vehicle_id, business_date, expected_minor
  FROM day_record
 WHERE business_id = $1 AND state = 'open'
   AND business_date BETWEEN $2 AND $3
 ORDER BY business_date;
```

The other four checklist items are the same shape: open trips, unsettled advances, obligations with no decision, and incidents with no bill.

---

## 16. Validation against the user flows

Every flow in `user-flows-v1.md` §6, and the tables it reads or writes. A flow with no home in the schema is a schema defect.

| Flow | Tables |
|---|---|
| F-0.1 create business | `business`, `app_user`, `business_member`, `business_settings`, `accounting_period` (§3.1) |
| F-0.2 opening balances | `opening_balance_batch`, `opening_balance_entry`, `obligation`, `deposit`, `advance` |
| F-1.1 add vehicle | `vehicle`, `vehicle_arrangement`, `vehicle_document` |
| F-1.2 change arrangement | `vehicle_arrangement` (exclusion constraint prevents overlap) |
| F-1.3 ownership | `ownership_share`, `capital_contribution` |
| F-1.4 share with manager | `business_member`, `management_fee_agreement` |
| F-1.5 vehicle calendar | `vehicle_day_allocation` |
| F-1.6 add driver | `driver` |
| F-1.7 set up daily lease | `daily_lease`, `daily_lease_rate` |
| F-1.8 link driver account | `driver_link_invite`, `driver.linked_user_id` |
| F-1.9 mileage packages | `mileage_package`, copied to `lease` |
| F-2.1 start rental | `lease`, `customer`, `billing_period`, `odometer_reading`, `deposit`, `attachment`, `vehicle_day_allocation` |
| F-2.2 collect rent | `payment`, `payment_allocation`, `obligation`, `message` |
| F-2.3 odometer & excess | `odometer_reading`, `mileage_assessment`, `mileage_assessment_split`, `obligation` |
| F-2.4 adjust / waive | `adjustment` |
| F-2.5 renew | `lease`, `billing_period` |
| F-2.6 close lease | `lease`, `billing_period`, `mileage_assessment`, `attachment`, `deposit_movement` |
| F-2.7 release held deposit | `deposit`, `deposit_movement` |
| F-2.8 customer statement | `obligation`, `payment`, `adjustment`, `mileage_assessment`, `deposit_movement` |
| F-3.1 record expense | `expense` |
| F-3.2 no-vehicle cost | `expense` (`vehicle_id` NULL) |
| F-3.3 fuel fill | `expense` (`litres`), `odometer_reading` |
| F-3.4 incident | `incident`, `expense`, `incident_recovery`, `insurance_claim`, `lease_extension` |
| F-3.5 maintenance | `expense`, `odometer_reading` |
| F-4.1 pending | `day_record`, `obligation`, `vehicle_document`, `message` |
| F-4.2 confirm day | `day_record`, `obligation`, `payment`, `payment_allocation` |
| F-4.3 adjust + going forward | `day_record`, `daily_lease_rate` |
| F-4.4 didn't run | `day_record` (CHECK forces `earned = 0`) |
| F-4.5 settle several days | `payment`, `payment_allocation`, `obligation` |
| F-4.6 confirm a week in one pass | `day_record`, `obligation`, `payment`, `payment_allocation` — one transaction |
| F-4.7 change driver | `daily_lease` |
| F-5.1 book trip | `trip`, `vehicle_day_allocation`, `day_record` → `paused_for_trip` (inside the horizon only — §4.1) |
| F-5.2 trip costs / advances | `expense`, `advance` |
| F-5.3 customer money | `payment`, `obligation` |
| F-5.4 close trip | `trip`, `odometer_reading`, `advance` (INV-17) |
| F-5.5 cancel trip | `trip`, `vehicle_day_allocation`, `day_record` |
| F-6.1 pay driver | `payment`, `obligation` |
| F-6.2 part / lump | `payment`, `payment_allocation` |
| F-6.3 advance | `advance`, `advance_settlement` |
| F-6.4 offset | `offset_record`, `offset_allocation` |
| F-6.5 driver statement | `obligation`, `payment`, `advance`, `offset_record`, `deposit_movement`, `day_record` |
| F-6.6 printed slip | same as F-6.5 |
| F-6.7 driver deposit | `deposit`, `deposit_movement` |
| F-6.8 driver's own view | same as F-6.5, scoped by `driver.linked_user_id` |
| F-7.1 vehicle month | `expense`, `obligation`, `ownership_share` |
| F-7.2 payouts | `partner_payout` |
| F-7.3 owned vs managed | `ownership_share`, `management_fee_agreement` |
| F-7.4 bank cash | `banking_event` |
| F-7.5 where is our cash | `payment.handled_by_user_id`, `banking_event`, `advance.issued_by_user_id`, `deposit` — query in §15 |
| F-7.6 partner account | `capital_contribution`, `expense.paid_by_user_id`, `partner_payout`, `ownership_share` |
| F-8.1 late fact | `belongs_to_period_id` on every money table |
| F-8.2 payment reversal | `payment_correction`, `payment`, `obligation`, `message` |
| F-8.3 write off | `write_off`, `write_off_recovery` |
| F-8.4 post-closure charge | `obligation` (`kind='post_closure_charge'`) |
| F-8.5 fix a mistake | `voided_at` on 13 money tables, `payment.status`, `audit_log` |
| F-8.6 who changed what | `audit_log` |
| F-9.1 close the month | `accounting_period` — close **and create the successor** (§3.1) |
| F-9.2 reports | §15 queries |
| F-9.3 export | all, filtered by `business_member.role` |
| F-10.1 paperwork | `vehicle_document`, `driver.licence_expiry` |
| F-10.2 messaging config | `messaging_config`, `business_settings` |
| F-10.3 automatic sends | `message`, `message_template` |
| F-10.4 message log | `message_event` |

**Result: 62 of 62 flows have a home. No flow requires a fact the schema cannot hold.**

### 16.0 What has been verified

**The schema has been executed against Neon Postgres 17** on a disposable branch, and the invariants were then tested behaviourally — not by reading the DDL, but by attempting the writes each one is supposed to refuse.

**Structural:** all 74 statements execute clean on an empty database, in document order — no reordering needed, so the document reads in dependency order. What lands:

| | |
|---|---|
| Tables | 53 |
| Foreign keys | 177 |
| Check constraints | 107 |
| Indexes | 79 |
| Exclusion constraints | 5 |
| Triggers | 18 |
| Rewrite rules (append-only) | 4 |

**Behavioural — each of these was attempted and correctly refused:**

| Invariant | Test |
|---|---|
| INV-1 | A second allocation for the same vehicle-day → rejected. A **hold** on that same day → accepted (ST-5) |
| INV-6 / W-4 | `did_not_run` with `earned > 0` → rejected · with no reason → rejected · `on_charter` as a reason → **rejected**, so §1.2 A is enforced rather than merely documented |
| INV-7 | `excess_km = -50` → rejected |
| INV-10 | A write to a closed period → rejected. The same write to the open period with `belongs_to_period_id` set → accepted. W-35 works in both directions |
| INV-11 | A duplicate `(trigger, subject, stage)` → rejected |
| INV-13 | `UPDATE` and `DELETE` on `message_event` → silently ignored, row unchanged |
| INV-16 | An overlapping share → rejected by the exclusion constraint. A lone 60% share → **rejected at commit**. 60 + 40 in one transaction → accepted |
| INV-17 | Closing a trip with an open advance → rejected; after settling it → accepted |
| INV-23 | `discrepancy_minor` computed 300,000 from 30,000,000 − 29,700,000 |
| INV-24 | An expense with `vehicle_id` NULL → accepted |
| INV-26 | Split 380,000 + 370,000 = 750,000 → accepted; 380,000 + 369,000 → **rejected** |
| INV-27 | `borne_by = 'driver'` with no driver → rejected |
| Categories | `category = 'diesel'` → rejected (R-3) |
| One open period | A second open period → rejected |

**§7.3's arithmetic reproduces against real Postgres.** The generated `days_count` column returns **31, 28, 31, 30** for the four billing periods from 12 January, and the allowances derive as 3,100 / 2,800 / 3,100 / 3,000. That was the number most at risk from an unstated convention, and it is now checked by the database rather than by agreement.

**One gap was found and fixed: the triggers were never attached** (§13.1). Four functions existed, zero triggers referenced them, and four invariants that §14 called database-enforced were inert. Executing the schema is what surfaced it; no amount of reading would have.

**Still unproven:** the audit-log triggers (§12) have no implementation here — `audit_log` is a table with no writer. That is application work, tracked as D-8.

### 16.1 Golden fixtures against real Postgres

The three walkthroughs seed a Neon preview branch (`TECH_STACK.md` §9) and assert against SQL, not a mock:

**All three have been run against the live schema. 39 of 39 assertions pass.**

| Fixture | Asserts | Result |
|---|---|---|
| **G-1** §7.1 | Days decompose `31 = 0 + 3 + 24 + 4`; lease-eligible `28`; lost-day value `20,000`; driver earned `120,000` / received `118,000`; arrears `2,000` **from a day that ran**; both balances `2,000` / `9,000` unmerged; charter profit `26,000`; costs `46,000`; driver's own fuel `40,000` below the line; **net profit `134,000`**; deposit `25,000` in no P&L | 19/19 |
| **G-2** §7.2 | Spent `95,000`, recovered `80,000`, **net `15,000`**; repairs split July `70,000` / August `25,000`; recoveries land August `20,000` / September `60,000`; pending `60,000` visible in July *and* August, zero by September; lease extended 12 days | 12/12 |
| **G-3** §7.3 | `days_count` `31/28/31/30`; allowances `3,100/2,800/3,100/3,000`; excesses `3,500`, nothing, `7,500` on a combined allowance of `6,100`; rent never moves; split sums to `300` | 8/8 |

**The seed walks the real period lifecycle** — open July, write July, close July and open August, write August, and so on — because there is no way to write into a closed period (§3.1). So the fixtures test UC-98's close-and-succeed as a side effect of testing the figures.

**What running G-2 exposed.** The month-by-month table in §7.2 was not computable as the schema stood: `incident_recovery` had no accounting period at all, so "recovered `20,000` in August, `60,000` in September" collapsed into whichever month the recovery was first written down, and the *pending recovery* line — the one that makes a catastrophic month visibly temporary — could not be produced. Two columns fixed it (§9.1). This was invisible to every structural check; only building the fixture surfaced it.

**One correction to this document's own claim.** An earlier draft asserted these fixtures were "derivable from the schema". Two of the figures are not derivable from any single table: **July's `46,000` of costs is `expense` plus the trip's driver fee**, which lives on `obligation`, not `expense`. A cost query that reads only the expense table under-reports every month containing a charter by exactly the driver's fee. The report definitions in §15 must union the two, and UC-70's implementation should be checked against this fixture before it is trusted.

---

## 17. Open items

| # | Item | Recommendation |
|---|---|---|
| **D-1** | Should a posting ledger sit under the domain tables? | **Not yet.** The obligation/payment/deposit tables answer every question UC-70…UC-79 asks. Add a derived ledger when a real accountant needs a trial balance, not before |
| **D-2** | Postgres RLS as a second line behind app-level `business_id` scoping | **Worth doing** — `SET LOCAL app.business_id` per transaction. Note Hyperdrive resets `SET` between queries (`TECH_STACK.md` §3), so this requires the Neon pool path |
| **D-3** | `pattern_weekdays smallint[]` vs a child table | Array is fine at this scale; revisit if patterns need per-date exceptions beyond skipping |
| **D-4** | Retention for `audit_log` and `message_event` | Both grow forever. Partition by month once either passes ~1M rows |
| **D-5** | `obligation.effective_due_on` maintenance | Derived from `driver.settlement_rhythm` at creation. If the rhythm changes, existing rows keep their original value — deliberate, but worth confirming |
| **D-6** | Allocation horizon length (§4.1) | 90 days is a guess. Long enough that a trip booked "next quarter" is inside it; short enough that an open-ended lease does not materialise years. Revisit once real booking lead times are known |
| **D-8** | `audit_log` has no writer (INV-28) | The table and its index exist; nothing populates them. Either a generic `AFTER INSERT OR UPDATE` trigger over the money tables writing `to_jsonb(NEW)`, or the application writes the row inside the same transaction. **The trigger is the safer choice** — it cannot be forgotten in a new code path, which is the whole argument of §1.1 |
| **D-7** | `lease_extension` vs the audit log | An independent review argued the audit log plus `incident.rent_treatment` was sufficient traceability. A table was chosen instead because "why does this lease run 12 days long" is a dispute question, and inferring the answer from two timestamps is not an answer |

---

## 18. Change control

This document follows `vehicle-rental-use-cases-v1.md` and `user-flows-v1.md`, never the reverse. A schema change that is not traceable to a `W-nn` decision or an `INV-n` invariant is a schema change without a reason.

When a decision changes: update the use cases, update the flows, update §14 and §16 here, and re-run the §16.1 fixtures. **If a fixture number moves, stop** — that is the signal the model changed rather than the schema.
