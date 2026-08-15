-- 0026_vehicle_day_allocation_void_by_optional.sql
--
-- GAP-7: `release-expired-holds` (scheduled.ts) is the first cron unit in
-- this schema to void a row rather than only insert. It has no user actor —
-- `releaseExpiredHolds`'s own `voidedBy` parameter is `undefined` for the
-- nightly sweep by design, the same "no cron is a prerequisite for a user
-- action" shape every other cron unit here follows, just run in reverse.
-- Migration 0022's `vehicle_day_allocation_void_check` (W-58/D-11) required
-- `voided_by IS NOT NULL` whenever `voided_at` is set, written with only a
-- human actor in mind — every void until this one had a real user behind
-- it, so the gap was invisible until the first system-driven void actually
-- ran. Never exercised against real Postgres before 15 Aug 2026 (recorded
-- in TRACKER.md's GAP-7 row); the 500 this produced was found by finally
-- running `trip.test.ts`/`scheduled.test.ts` against a real branch.
--
-- `voided_reason` stays required either way — "why" is always knowable and
-- always recorded ("Hold expired"); "who", for a cron sweep, has no one to
-- name. Every other table's own void trio is untouched — this is the one
-- table where a non-human actor was ever a real possibility.
ALTER TABLE vehicle_day_allocation DROP CONSTRAINT vehicle_day_allocation_void_check; -- allow: relaxing a CHECK is additive — every existing voided row already has voided_by set, so it still satisfies the new, looser constraint; same drop-and-readd pattern 0014 used for obligation_kind_check
ALTER TABLE vehicle_day_allocation ADD CONSTRAINT vehicle_day_allocation_void_check CHECK (
  (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
  OR (voided_at IS NOT NULL AND voided_reason IS NOT NULL AND length(voided_reason) > 0)
);
