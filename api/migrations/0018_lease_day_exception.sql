-- 0018_lease_day_exception.sql
--
-- GAP-20 (data-model.md §7). Consulted by generate-day-cards *before* it
-- writes anything for a pattern day — an excepted date behaves exactly like
-- an off-pattern one: no row, ever, for that (daily_lease_id, date) pair.
-- Its absence is the record, the same principle §1.2 B already applies to
-- not_scheduled days.
--
-- Not a money table: no posted_period_id, so it stays outside
-- assert_period_open()'s array — the same reasoning attachment (§12)
-- already carries. It still takes the full W-58 void trio, because
-- un-skipping a date is a correction like any other and deserves the same
-- trace.
CREATE TABLE lease_day_exception (
  id             uuid PRIMARY KEY,
  business_id    uuid NOT NULL REFERENCES business(id),
  daily_lease_id uuid NOT NULL REFERENCES daily_lease(id),
  exception_date date NOT NULL,
  reason         text,
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz,
  voided_reason  text,
  voided_by      uuid REFERENCES app_user(id),
  UNIQUE (daily_lease_id, exception_date),

  CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
        AND voided_reason IS NOT NULL AND length(voided_reason) > 0)
  )
);

CREATE INDEX ON lease_day_exception (daily_lease_id, exception_date)
  WHERE voided_at IS NULL;
