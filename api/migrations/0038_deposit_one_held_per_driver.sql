-- 0038_deposit_one_held_per_driver.sql
--
-- M-10, 31 Aug 2026. `takeDriverDeposit` minted a new `deposit` row on
-- every call, with nothing refusing a second one for a driver who already
-- has one `held` — no unique index, no pre-check. A driver handing over
-- 20,000, then topped up 10,000 through the *take* endpoint rather than
-- the *movement* endpoint (both plausible taps), ended up with two `held`
-- deposits. `findHeldDepositForDriver` returns only the newest
-- (`ORDER BY created_at DESC LIMIT 1`), so his own statement
-- (`getDriverOwnView`, F-6.8/UC-59) showed 10,000 when he had actually
-- handed over 30,000 — INV-25's own promise ("every figure here must
-- match F-6.5 exactly, since it's two people looking at one number instead
-- of two memories") broken on exactly the surface where it matters most.
--
-- The business-side figures were already fine: `sumDepositsHeld` and
-- `findOpenDepositsForParty` (the archive guard) both sum every deposit
-- regardless of count. Only the driver's own single-deposit read was wrong.
--
-- `WHERE status = 'held' AND party_type = 'driver'` is not a refinement,
-- it is the constraint — the same reasoning `incident_recovery_one_live_per_source`
-- (migration 0031/B19) already states: a deposit that has moved to
-- `hold_window`/`released`/`applied`/`retained` is no longer "held", so a
-- new one starting there is a different fact, not a duplicate of this one.
-- Scoped to `party_type = 'driver'` only — DM §10.4 makes no equivalent
-- one-per-party promise for a customer deposit, and this fix's own finding
-- (M-10) is specifically the driver's own statement.
CREATE UNIQUE INDEX deposit_one_held_per_driver
  ON deposit (party_driver_id)
  WHERE party_type = 'driver' AND status = 'held';
