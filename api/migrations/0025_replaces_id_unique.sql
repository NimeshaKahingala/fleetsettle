-- 0025_replaces_id_unique.sql
--
-- GAP-60/D-16. Migration 0021 gave every W-50 money table a nullable
-- replaces_id, but wrote no constraint alongside it — nothing stopped two
-- concurrent "record the correct one" requests from both pointing at the
-- same voided row, which would leave "what corrected this?" with two
-- answers instead of one. A partial unique index closes that the same way
-- migration 0023's `WHERE voided_at IS NULL` guards close the void race:
-- in the constraint, not in application code (CLAUDE.md → Writes). NULL is
-- exempt everywhere a normal create (no replacesId) still needs to insert
-- freely.
CREATE UNIQUE INDEX capital_contribution_replaces_id_key ON capital_contribution (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX expense_replaces_id_key             ON expense (replaces_id)             WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX incident_recovery_replaces_id_key    ON incident_recovery (replaces_id)    WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX obligation_replaces_id_key           ON obligation (replaces_id)           WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX adjustment_replaces_id_key           ON adjustment (replaces_id)           WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX write_off_replaces_id_key            ON write_off (replaces_id)            WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX write_off_recovery_replaces_id_key   ON write_off_recovery (replaces_id)   WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX offset_record_replaces_id_key        ON offset_record (replaces_id)        WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX deposit_movement_replaces_id_key     ON deposit_movement (replaces_id)     WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX advance_replaces_id_key              ON advance (replaces_id)              WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX advance_settlement_replaces_id_key   ON advance_settlement (replaces_id)   WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX banking_event_replaces_id_key        ON banking_event (replaces_id)        WHERE replaces_id IS NOT NULL;
CREATE UNIQUE INDEX partner_payout_replaces_id_key       ON partner_payout (replaces_id)       WHERE replaces_id IS NOT NULL;
