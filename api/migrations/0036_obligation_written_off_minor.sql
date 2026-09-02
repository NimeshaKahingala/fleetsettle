-- 0036_obligation_written_off_minor.sql
--
-- GAP-203/H-1, D2 (decided 30 Aug 2026: partial write-off is a real business
-- act — "he'll never pay the last bit" — mirroring how `waived_minor`
-- already works). `write_off.amount_minor` could already be less than an
-- obligation's outstanding balance, but nothing recorded that: `recordWriteOff`
-- flipped the *whole* obligation to `written_off` regardless, so a partial
-- write-off silently discarded the remainder with no row saying so, and a
-- second write-off against the same obligation was accepted on top of it.
--
-- `written_off_minor` mirrors `waived_minor`'s own shape exactly — same
-- default, same floor, same drop-and-add place in the sum CHECK (the same
-- drop-and-add pattern migrations 0009/0014/0033 already use).
ALTER TABLE obligation ADD COLUMN written_off_minor bigint NOT NULL DEFAULT 0 CHECK (written_off_minor >= 0);

-- Backfill, added 31 Aug 2026 reviewing this migration. `DEFAULT 0` alone is
-- wrong for any obligation that already carries a live `write_off` — that
-- table and `recordWriteOff` both predate this column by thirty-five
-- migrations, so an obligation written off yesterday would come out of this
-- migration reading `written_off_minor = 0` while still being `status =
-- 'written_off'` with a real `write_off.amount_minor` on record. `voidWriteOff`
-- then computes `written_off_minor - write_off.amount_minor` = a negative
-- number, the column CHECK above rejects it, and a void that worked before
-- this migration starts failing as an unmapped 500.
--
-- `LEAST(…, amount − settled − waived)` is load-bearing, not defensive. The
-- old `recordWriteOff` flipped the whole obligation to `written_off`
-- regardless of what had already been settled against it, so a legacy row
-- can legitimately carry a `write_off.amount_minor` larger than what was
-- actually outstanding. Backfilling that figure raw would break the very
-- sum CHECK being installed below. Capping at what genuinely remained is
-- also the true statement of the fact — "the rest of it was written off" —
-- and is exactly the ceiling `recordWriteOff` now enforces going forward.
UPDATE obligation o
SET written_off_minor = LEAST(sub.total, o.amount_minor - o.settled_minor - o.waived_minor)
FROM (
  SELECT obligation_id, SUM(amount_minor) AS total
  FROM write_off
  WHERE obligation_id IS NOT NULL AND voided_at IS NULL
  GROUP BY obligation_id
) sub
WHERE sub.obligation_id = o.id;

ALTER TABLE obligation DROP CONSTRAINT obligation_check; -- allow: the backfill above already caps written_off_minor at amount_minor - settled_minor - waived_minor, so every row satisfies the new clause by construction
ALTER TABLE obligation ADD CONSTRAINT obligation_check
  CHECK (settled_minor + waived_minor + written_off_minor <= amount_minor);
