/**
 * U-6's vocabulary lock, shared rather than copied: `LeaseHubScreen` and
 * `TripDetailScreen` both show an `obligation.status` and must use the same
 * five words for it, or the same fact reads differently depending which
 * screen it's viewed from.
 */
export const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  pending: "Due",
  part_paid: "Part paid",
  paid: "Paid",
  waived: "Waived",
  written_off: "Written off",
};

export const OBLIGATION_KIND_LABEL: Record<string, string> = {
  rent: "Rent",
  mileage_excess: "Mileage excess",
  post_closure_charge: "Late charge",
};

/** Tappable only while genuinely outstanding — the same rule every obligation list in this client uses. */
export const OPEN_OBLIGATION_STATUSES = new Set(["pending", "part_paid"]);
