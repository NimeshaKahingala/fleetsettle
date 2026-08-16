import { type BusinessDate } from "@fleetsettle/shared";
import type { AgeingBucket } from "@fleetsettle/shared/schemas";
import type { BadgeProps } from "../design/primitives/Badge.js";

export const AGEING_BUCKET_LABEL: Record<AgeingBucket, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "over-90": "Over 90 days",
};

export const AGEING_BUCKET_VARIANT: Record<AgeingBucket, NonNullable<BadgeProps["variant"]>> = {
  current: "good",
  "1-30": "neutral",
  "31-60": "warning",
  "61-90": "serious",
  "over-90": "critical",
};

/**
 * §7.11's "due-age chips" for a customer's own dues list, bucketing off
 * `effectiveDueOn` — the same column `listAgeingBuckets` buckets off
 * (api/src/queries/reports.ts) — so a due read as "31–60 days" here never
 * disagrees with the same due on the ageing report *by construction*, not
 * by the coincidence that every obligation-insert path today happens to
 * set `effectiveDueOn` equal to `dueOn` (DM D-5: a driver's
 * `settlement_rhythm` is meant to license divergence here, filed as
 * GAP-135 since nothing currently implements it).
 */
// `effectiveDueOn` takes a plain string, not `BusinessDate` —
// `LeaseObligationRow`'s own wire schema
// (packages/shared/src/schemas/lease-billing.ts) never brands this field,
// the same way every call site of `dueOn` already treats it
// (`formatShortDate(due.dueOn)`, elsewhere).
export function computeAgeingBucket(effectiveDueOn: string, today: BusinessDate): AgeingBucket {
  const daysLate = (Date.parse(today) - Date.parse(effectiveDueOn)) / (1000 * 60 * 60 * 24);
  if (daysLate <= 0) return "current";
  if (daysLate <= 30) return "1-30";
  if (daysLate <= 60) return "31-60";
  if (daysLate <= 90) return "61-90";
  return "over-90";
}
