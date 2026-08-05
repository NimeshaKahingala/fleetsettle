import { z } from "zod";
import { accountingPeriodSummarySchema } from "./accounting-period.js";
import { uuidSchema } from "./common.js";

/** Shared across UC-74/UC-78 — the three party kinds a receivable can be against. */
export const reportPartyTypeSchema = z.enum(["customer", "driver", "partner"]);

export const ageingBucketSchema = z.enum(["current", "1-30", "31-60", "61-90", "over-90"]);

/** UC-70/DM §15: one row per vehicle for a given accounting period — "combined" is the caller summing this array, the same pre-computed-lines convention `AllocationPreview` already uses (UI §6). */
export const vehicleMonthOwnerShareSchema = z.object({
  userId: uuidSchema,
  displayName: z.string().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- a basis-point share (INV-16), not money
  shareBp: z.number().int().nonnegative(),
  profitShareMinor: z.string(),
});
export type VehicleMonthOwnerShare = z.infer<typeof vehicleMonthOwnerShareSchema>;

export const vehicleMonthRowSchema = z.object({
  vehicleId: uuidSchema,
  registration: z.string(),
  earnedMinor: z.string(),
  costsMinor: z.string(),
  profitMinor: z.string(),
  ownerShares: z.array(vehicleMonthOwnerShareSchema),
});
export type VehicleMonthRow = z.infer<typeof vehicleMonthRowSchema>;

export const vehicleMonthResponseSchema = z.object({
  period: accountingPeriodSummarySchema,
  vehicles: z.array(vehicleMonthRowSchema),
});
export type VehicleMonthResponse = z.infer<typeof vehicleMonthResponseSchema>;

/** UC-71: ranked by profit; profit-per-km degrades to `null` (and that trip is excluded from a per-km ranking) for any trip with no closing odometer — a ranking ratio, never a stored/allocated amount, the same treatment `kmPerLitre` already gets. */
export const rankedTripRowSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  registration: z.string(),
  agreedAmountMinor: z.string(),
  costsMinor: z.string(),
  driverFeeMinor: z.string(),
  profitMinor: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  distanceKm: z.number().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- a ranking ratio, not a stored monetary amount (W-56 "not available" when there's no distance to divide by)
  profitPerKm: z.number().nullable(),
});
export type RankedTripRow = z.infer<typeof rankedTripRowSchema>;

export const rankedTripsResponseSchema = z.array(rankedTripRowSchema);
export type RankedTripsResponse = z.infer<typeof rankedTripsResponseSchema>;

/** UC-72: only fuel *you* bought (W-20). `kmPerLitre` needs the previous fill's own odometer reading, so the first fill in any window — or any fill missing a reading — is `null`, never a misleading zero. */
export const fuelEfficiencyPointSchema = z.object({
  spentOn: z.string(),
  amountMinor: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- litres, a fuel volume, not money
  litres: z.number().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- a fuel-efficiency ratio, not money
  kmPerLitre: z.number().nullable(),
});
export type FuelEfficiencyPoint = z.infer<typeof fuelEfficiencyPointSchema>;

export const fuelEfficiencyResponseSchema = z.object({
  vehicleId: uuidSchema,
  points: z.array(fuelEfficiencyPointSchema),
});
export type FuelEfficiencyResponse = z.infer<typeof fuelEfficiencyResponseSchema>;

/** UC-74/DM §15: one row per party, largest outstanding first — `written_off` obligations are already excluded (that's the entire point of writing one off, UC-90). */
export const receivableRowSchema = z.object({
  partyType: reportPartyTypeSchema,
  partyId: uuidSchema,
  partyName: z.string().nullable(),
  outstandingMinor: z.string(),
  oldestDueOn: z.string(),
});
export type ReceivableRow = z.infer<typeof receivableRowSchema>;

export const receivablesResponseSchema = z.array(receivableRowSchema);
export type ReceivablesResponse = z.infer<typeof receivablesResponseSchema>;

/** UC-78/DM §15: the UC-74 list, bucketed by age from each obligation's own `effective_due_on` (UC-37) — never from the calendar, and never one bucket per party's summed balance (DM §15's own stated reason). */
export const ageingRowSchema = z.object({
  partyType: reportPartyTypeSchema,
  partyId: uuidSchema,
  partyName: z.string().nullable(),
  bucket: ageingBucketSchema,
  outstandingMinor: z.string(),
});
export type AgeingRow = z.infer<typeof ageingRowSchema>;

export const ageingResponseSchema = z.array(ageingRowSchema);
export type AgeingResponse = z.infer<typeof ageingResponseSchema>;

/** UC-75/DM §15: what each partner holds, plus deposits held shown *beside* it as a liability — never netted in (§6.13). */
export const partnerCashRowSchema = z.object({
  userId: uuidSchema,
  displayName: z.string().nullable(),
  heldMinor: z.string(),
});
export type PartnerCashRow = z.infer<typeof partnerCashRowSchema>;

export const cashPositionResponseSchema = z.object({
  partners: z.array(partnerCashRowSchema),
  depositsHeldMinor: z.string(),
});
export type CashPositionResponse = z.infer<typeof cashPositionResponseSchema>;

/** UC-76/DM §15: per driver, per weekday — "four days lost" and "four Fridays lost" are different conversations. The denominator is `ran + lost` (`leaseEligible`); off-pattern and charter days never enter it (§1.2). */
export const lostDaysRowSchema = z.object({
  driverId: uuidSchema,
  driverName: z.string().nullable(),
  // eslint-disable-next-line no-restricted-syntax -- a day-of-week index (0=Sunday), not money
  weekday: z.number().int().min(0).max(6),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  lost: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  ran: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  leaseEligible: z.number().int().nonnegative(),
  lostValueMinor: z.string(),
});
export type LostDaysRow = z.infer<typeof lostDaysRowSchema>;

export const lostDaysResponseSchema = z.array(lostDaysRowSchema);
export type LostDaysResponse = z.infer<typeof lostDaysResponseSchema>;

/** UC-77: every waiver/auto-waiver/goodwill adjustment given in the window — never pooled with a write-off (W-28, reported separately by UC-90/UC-74). */
export const goodwillResponseSchema = z.object({
  totalMinor: z.string(),
});
export type GoodwillResponse = z.infer<typeof goodwillResponseSchema>;

/**
 * UC-79: day-based figures for one vehicle in a window — always computable
 * (W-56). `revenuePerAvailableDayMinor`, the "which arrangement earns more"
 * comparison the use case also describes, is not built this pass — a real,
 * separate figure needing its own date-range-scoped earned calculation,
 * disproportionate to a phase "Second" item (recorded in TRACKER.md).
 */
export const utilisationResponseSchema = z.object({
  vehicleId: uuidSchema,
  from: z.string(),
  to: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  earningDays: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  idleDays: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  offRoadDays: z.number().int().nonnegative(),
  // eslint-disable-next-line no-restricted-syntax -- a day count, not money
  totalDays: z.number().int().nonnegative(),
});
export type UtilisationResponse = z.infer<typeof utilisationResponseSchema>;
