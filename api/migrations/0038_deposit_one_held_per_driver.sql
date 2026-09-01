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
-- The repair below is load-bearing, not defensive: without it this migration
-- fails on the first environment that has ever been clicked through. QA had
-- six `held` deposits for one driver and 0038 died there with 23505,
-- `Key (party_driver_id)=(019fe21a-…) is duplicated` — the integration
-- workflow could not have caught it, because it builds every branch from
-- empty and a data-shaped violation needs data.
--
-- Five of those six were `taken 500,000` *and* `refunded 500,000` — netted to
-- nothing, yet still flagged `held`. That is not a duplicate deposit, it is a
-- deposit whose status was never moved on: `recordDepositMovement`'s TERMINAL
-- map (`refunded` → `released`, domain/deposit.ts) has set exactly that since
-- 1 August 2026, so these rows cannot have come through it — every movement
-- shares `occurred_on = 2026-08-09` while its parent spans 11–17 August, the
-- signature of rows hand-inserted around the domain layer during testing.
--
-- So this restores an invariant the application already maintains rather than
-- inventing a new rule, and it is the reason the fix is an UPDATE and not a
-- merge: no money moves, no row is deleted, no amount is summed. Customer
-- deposits are deliberately untouched — theirs are already consistent (the
-- one live refund is correctly `released`), and DM §10.4 makes no
-- one-per-party promise for a customer anyway.
--
-- What this deliberately does NOT do: reconcile two genuinely `held`,
-- unrefunded deposits for one driver. There is no non-guessing answer to
-- which survives or how their movements combine, and guessing inside a
-- forward-only migration would bake an invented money decision into
-- permanent history. That case still fails this migration loudly, which for
-- money is the correct outcome.
-- The net-zero test is the second half of the condition, and it is not
-- belt-and-braces (Copilot's review of this PR, and it was right). "Has a
-- refunded movement" is not "is empty": a deposit taken at 20,000, topped up
-- by 10,000 and then refunded its original 20,000 still physically holds
-- 10,000. `sumDepositsHeld` filters `status IN ('held','hold_window')`, so
-- releasing that row would drop real money out of the cash position and
-- `recordDepositMovement` would refuse to touch it again — a silent
-- understatement, which is the one failure mode this system exists to
-- prevent. Only a deposit that nets to nothing is released; anything
-- ambiguous still fails the index below, loudly.
--
-- The sign rule is `sumDepositMovements`'s own (queries/driver-money.ts):
-- `taken` and `topped_up` add, every other movement type subtracts.
UPDATE deposit d
   SET status = 'released'
 WHERE d.party_type = 'driver'
   AND d.status = 'held'
   AND EXISTS (
     SELECT 1
       FROM deposit_movement m
      WHERE m.deposit_id = d.id
        AND m.movement_type = 'refunded'
        AND m.voided_at IS NULL
   )
   AND COALESCE((
     SELECT SUM(CASE WHEN m.movement_type IN ('taken', 'topped_up')
                     THEN m.amount_minor
                     ELSE -m.amount_minor END)
       FROM deposit_movement m
      WHERE m.deposit_id = d.id
        AND m.voided_at IS NULL
   ), 0) <= 0;

CREATE UNIQUE INDEX deposit_one_held_per_driver
  ON deposit (party_driver_id)
  WHERE party_type = 'driver' AND status = 'held';
