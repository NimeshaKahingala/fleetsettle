import type { LostReason } from "@fleetsettle/shared/schemas";

/**
 * Shared rather than copied — `ConfirmDayCard`'s own `ReasonPicker` needed
 * the ordered list, and GAP-71's lost-days reason chart needed a lookup by
 * key; both grew from the same F-4.4 list (`on_charter` deliberately absent,
 * FL §4.1). One source rather than the drift `ARRANGEMENT_LABEL` was
 * already extracted to prevent.
 */
export const LOST_REASON_OPTIONS: { key: LostReason; label: string }[] = [
  { key: "breakdown", label: "Breakdown" },
  { key: "driver_day_off", label: "Driver's day off" },
  { key: "driver_ill", label: "Driver ill" },
  { key: "public_holiday", label: "Public holiday" },
  { key: "no_passengers", label: "No passengers" },
  { key: "other", label: "Other" },
];

export const LOST_REASON_LABEL: Record<LostReason, string> = Object.fromEntries(
  LOST_REASON_OPTIONS.map((o) => [o.key, o.label]),
) as Record<LostReason, string>;
