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

/**
 * Every `kind` an `obligation` row is ever written with (checked against
 * every insert site in `api/src/domain/*.ts`, not guessed): `rent`
 * (billing-period.ts), `daily_amount` (confirmDay.ts — arrangement B's
 * driver debt, reserved wording "Daily lease amount"), `mileage_excess`
 * (mileage.ts), `post_closure_charge` (post-closure-charge.ts),
 * `trip_fare` (trip.ts), `driver_fee` (trip.ts — a trip's own driver fee,
 * reserved wording "Driver trip fee"), `customer_contribution`
 * (incident.ts), `opening_balance` (opening-balance.ts), `management_fee`
 * (management-fee.ts). `daily_amount` was the gap that mattered most —
 * `DepositMovementSheet`'s own arrears list is a driver's `owed_to_us`
 * obligations, and that kind is the ordinary case there, not an edge one.
 */
export const OBLIGATION_KIND_LABEL: Record<string, string> = {
  rent: "Rent",
  daily_amount: "Daily lease amount",
  mileage_excess: "Mileage excess",
  post_closure_charge: "Late charge",
  trip_fare: "Trip fare",
  driver_fee: "Driver trip fee",
  customer_contribution: "Customer contribution",
  opening_balance: "Opening balance",
  management_fee: "Management fee",
};

/** Tappable only while genuinely outstanding — the same rule every obligation list in this client uses. */
export const OPEN_OBLIGATION_STATUSES = new Set(["pending", "part_paid"]);
