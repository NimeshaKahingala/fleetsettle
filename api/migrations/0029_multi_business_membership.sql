-- Phase 1 of the platform-admin/multi-business design
-- (PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md, decisions 6/19).
--
-- Not a money table, not period-scoped — nothing here touches
-- posted_period_id, assert_period_open()'s array, or write_audit_log()'s
-- discovery loop. Say so explicitly per this repository's own convention
-- (data-model.md §3.2), so a reviewer doesn't read the absence as a miss.
--
-- Drops the one thing standing between today's single-business-per-identity
-- product and multi-business membership. business_member_active_pair
-- (migration 0010) survives unchanged — it enforces a different rule ("not
-- the same business twice") that this migration does not touch.

DROP INDEX one_active_business_per_user;

-- W-66: one login may now be a linked driver in one business while holding
-- a different membership in another, so "this identity links to at most one
-- driver record, anywhere" (the old global UNIQUE) is the wrong shape — it
-- becomes "at most one per business". Confirmed against the live QA branch
-- rather than assumed (design doc §6.2's own instruction): the generated
-- name is driver_linked_user_id_key.
ALTER TABLE driver DROP CONSTRAINT driver_linked_user_id_key; -- allow: replaced by the business-scoped index below in the same migration, not removed

CREATE UNIQUE INDEX driver_linked_user_per_business
  ON driver (business_id, linked_user_id) WHERE linked_user_id IS NOT NULL;
