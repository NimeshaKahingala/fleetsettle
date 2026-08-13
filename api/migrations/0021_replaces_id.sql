-- 0021_replaces_id.sql
--
-- GAP-60/D-16 (data-model.md §17). A void and its replacement were not
-- linked anywhere in the schema — the corrected row and its correction were
-- two unrelated rows that happened to be near each other in time. Shape
-- decided 9 Aug 2026, recorded in data-model.md 12 Aug 2026: a nullable,
-- self-referencing replaces_id uuid on each money table that already
-- carries the full W-50 voided_* trio, not one shared polymorphic
-- correction table — typed, indexable, and enforceable as a real per-table
-- FK. payment is deliberately excluded: it already has its own correction
-- mechanism (payment_correction, DM §10.2) and never adopted the voided_*
-- trio in the first place.
--
-- data-model.md's own prose says "the twelve money tables"; the schema
-- actually carries the voided_* trio on thirteen (capital_contribution,
-- expense, incident_recovery, obligation, adjustment, write_off,
-- write_off_recovery, offset_record, deposit_movement, advance,
-- advance_settlement, banking_event, partner_payout) — a one-table
-- undercount in the doc's own prose, not a scope question; every one of
-- the thirteen gets replaces_id here for consistency with the trio it
-- already carries.
ALTER TABLE capital_contribution   ADD COLUMN replaces_id uuid REFERENCES capital_contribution(id);
ALTER TABLE expense                ADD COLUMN replaces_id uuid REFERENCES expense(id);
ALTER TABLE incident_recovery      ADD COLUMN replaces_id uuid REFERENCES incident_recovery(id);
ALTER TABLE obligation             ADD COLUMN replaces_id uuid REFERENCES obligation(id);
ALTER TABLE adjustment             ADD COLUMN replaces_id uuid REFERENCES adjustment(id);
ALTER TABLE write_off              ADD COLUMN replaces_id uuid REFERENCES write_off(id);
ALTER TABLE write_off_recovery     ADD COLUMN replaces_id uuid REFERENCES write_off_recovery(id);
ALTER TABLE offset_record          ADD COLUMN replaces_id uuid REFERENCES offset_record(id);
ALTER TABLE deposit_movement       ADD COLUMN replaces_id uuid REFERENCES deposit_movement(id);
ALTER TABLE advance                ADD COLUMN replaces_id uuid REFERENCES advance(id);
ALTER TABLE advance_settlement     ADD COLUMN replaces_id uuid REFERENCES advance_settlement(id);
ALTER TABLE banking_event          ADD COLUMN replaces_id uuid REFERENCES banking_event(id);
ALTER TABLE partner_payout         ADD COLUMN replaces_id uuid REFERENCES partner_payout(id);
