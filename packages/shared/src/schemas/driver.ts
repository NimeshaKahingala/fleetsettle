import { z } from "zod";
import { businessDateSchema, moneyWireSchema } from "./common.js";

/** DM §5's `driver.settlement_rhythm` CHECK. */
export const settlementRhythmSchema = z.enum(["daily", "weekly"]);
export type SettlementRhythm = z.infer<typeof settlementRhythmSchema>;

/**
 * GAP-135/UC-78. 0=Sunday..6=Saturday — `weekdayOf`'s own convention, not
 * ISO 8601's 1..7, matching the one other weekday column this schema
 * already has (`daily_lease_pattern.pattern_weekdays`, migration 0001).
 */
// eslint-disable-next-line no-restricted-syntax -- a weekday index (0..6), not money
export const settlementWeekdaySchema = z.number().int().min(0).max(6);

/**
 * UC-04. Only `name` is required (U-2 / M-6) — DM §5's `driver` table makes
 * every other column nullable for exactly this: the fee figures and licence
 * expiry are real fields on the same form, not a separate step, but none of
 * them blocks the save.
 *
 * `settlementRhythm` defaults to `'daily'` server-side (the column's own
 * DEFAULT), so an ordinary driver never has to answer this — a manager who
 * needs weekly settlement opts in, and `settlementWeekday` becomes
 * required only then, mirroring migration 0040's own CHECK rather than
 * duplicating a second, possibly-drifting copy of it in application logic.
 * There is no driver-edit endpoint at all yet (any field), so this is
 * settable at creation only — recorded here as scope, not discovered
 * later: matches how driverDayFeeMinor/driverTripFeeMinor/licenceExpiry
 * already work.
 */
export const createDriverRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    mobile: z.string().trim().min(1).max(30).optional(),
    driverDayFeeMinor: moneyWireSchema.optional(),
    driverTripFeeMinor: moneyWireSchema.optional(),
    licenceExpiry: businessDateSchema.optional(),
    settlementRhythm: settlementRhythmSchema.optional(),
    settlementWeekday: settlementWeekdaySchema.optional(),
  })
  .refine(
    (v) => (v.settlementRhythm ?? "daily") === "weekly" || v.settlementWeekday === undefined,
    {
      message: "settlementWeekday is only meaningful when settlementRhythm is 'weekly'",
      path: ["settlementWeekday"],
    },
  )
  .refine((v) => v.settlementRhythm !== "weekly" || v.settlementWeekday !== undefined, {
    message: "settlementWeekday is required when settlementRhythm is 'weekly'",
    path: ["settlementWeekday"],
  });
export type CreateDriverRequest = z.infer<typeof createDriverRequestSchema>;

export const driverResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mobile: z.string().nullable(),
  driverDayFeeMinor: z.string().nullable(),
  driverTripFeeMinor: z.string().nullable(),
  licenceExpiry: z.string().nullable(),
  // Optional, not just nullable, the same treatment `archivedAt` already
  // gets and for the same reason: every screen built before GAP-135 mocks
  // this response with no knowledge of settlement rhythm at all, and none
  // of them needs to be taught the field just to keep compiling.
  settlementRhythm: settlementRhythmSchema.optional(),
  settlementWeekday: settlementWeekdaySchema.nullable().optional(),
  archivedAt: z.string().nullable().optional(),
});
export type DriverResponse = z.infer<typeof driverResponseSchema>;

/** F-1.11/UC-100/W-50: a reason is required — migration 0023's own CHECK on `driver` refuses `voided_at` with an empty or absent `voided_reason`, the same audit requirement every other void table in this schema carries. */
export const archiveDriverRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ArchiveDriverRequest = z.infer<typeof archiveDriverRequestSchema>;

/** F-1.8/W-42/A11: no request body — the driver comes from the route, matching F-1.8's "on the driver's page" step. */
export const driverLinkInviteResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
});
export type DriverLinkInviteResponse = z.infer<typeof driverLinkInviteResponseSchema>;
