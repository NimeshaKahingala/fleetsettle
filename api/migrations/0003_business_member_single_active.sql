-- 0003_business_member_single_active.sql
--
-- DM §3. This product has no multi-business membership (nothing in
-- use-cases.md or user-flows.md describes one user across two businesses,
-- or a switcher) — the sub → app_user → business_member resolution
-- (IG §7.1, api/src/queries/identity.ts) assumes at most one active row per
-- user and takes it on faith. The plain UNIQUE(business_id, user_id) already
-- on this table only stops the same pair twice; it does not stop the same
-- user acquiring a second business_id, which a double-submitted "create
-- business" request (F-0.1) or a client retry after a timeout can otherwise
-- do silently — resolveMembership's LIMIT 1 would then pick one of two
-- businesses with nothing to say the choice was consistent.
--
-- Partial, not a plain UNIQUE(user_id): revoked rows are excluded so a
-- revoked manager (F-1.4) can be re-granted, or someone start a second
-- business after leaving the first, without this index in the way.
CREATE UNIQUE INDEX one_active_business_per_user
  ON business_member (user_id)
  WHERE revoked_at IS NULL;
