import { z } from "zod";

/**
 * F-8.6/UC-97/W-50: mirrors migration 0002's own coverage rule ("every table
 * carrying `posted_period_id`", DM §13's array) rather than a hand-written
 * second list — the same lesson that array's own comment already carries:
 * two hand-maintained lists of the same thing are two chances to drift.
 */
export const auditedTableNameSchema = z.enum([
  "obligation",
  "payment",
  "expense",
  "adjustment",
  "write_off",
  "write_off_recovery",
  "offset_record",
  "deposit_movement",
  "advance",
  "advance_settlement",
  "banking_event",
  "partner_payout",
  "capital_contribution",
  "day_record",
  "mileage_assessment",
  "payment_correction",
  "incident_recovery",
  "insurance_claim",
]);

export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: z.enum(["insert", "update", "void"]),
  changedBy: z.string().uuid().nullable(),
  changedAt: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
});

export const auditLogResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
});
