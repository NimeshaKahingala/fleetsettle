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
-- default, same floor, same drop-and-add place in the sum CHECK. Every
-- existing row already satisfies `written_off_minor = 0`, so no row can fail
-- the new clause (the same drop-and-add pattern migrations 0009/0014/0033
-- already use).
ALTER TABLE obligation ADD COLUMN written_off_minor bigint NOT NULL DEFAULT 0 CHECK (written_off_minor >= 0);

ALTER TABLE obligation DROP CONSTRAINT obligation_check; -- allow: widening a CHECK is additive — every existing row has written_off_minor = 0, so no row can fail the new clause
ALTER TABLE obligation ADD CONSTRAINT obligation_check
  CHECK (settled_minor + waived_minor + written_off_minor <= amount_minor);
