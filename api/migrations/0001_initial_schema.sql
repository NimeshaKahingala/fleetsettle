-- 0001_initial_schema.sql
--
-- The schema, extracted verbatim from data-model.md §3–§13. That document owns
-- it; this file is its executable form. Any change starts there.
--
-- Forward-only. If something here is wrong, the fix is 0003, never an edit.

-- DM §2. Required by the five exclusion constraints below: `EXCLUDE USING gist`
-- with a `uuid WITH =` operand has no default GiST operator class without it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

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

  litres         numeric(8,2),  -- allow: fuel volume, not an amount of money (UC-72)
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
  id           bigserial PRIMARY KEY,  -- allow: append-only log; never in a URL, and monotonic ordering is the point. The audited record is addressed by record_id
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

-- INV-10. Every table carrying posted_period_id.
--
-- `trip` is here even though its posted_period_id is nullable rather than
-- NOT NULL like the other 18 — a trip earns a period only when it closes
-- (W-41/INV-30), so an open trip legitimately has none yet. That is fine:
-- assert_period_open() checks `id = NEW.posted_period_id`, which simply finds
-- no match on NULL and lets the row through. The trigger only bites once the
-- period is actually set — i.e. exactly at close, which is where INV-30 needs
-- it to bite. Caught by the DM §13 drift assertion after this list shipped
-- without it; see api/scripts/assert-no-trigger-drift.sql.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'obligation','payment','expense','adjustment','write_off','write_off_recovery',
    'offset_record','deposit_movement','advance','advance_settlement','banking_event',
    'partner_payout','capital_contribution','day_record','mileage_assessment',
    'payment_correction','incident_recovery','insurance_claim','trip']
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
