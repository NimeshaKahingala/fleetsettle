/**
 * The Worker's error shape (IG §3.3) and the codes both sides agree on.
 *
 *   { "error": "Trip not found", "code": "NOT_FOUND", "requestId": "…" }
 *
 * This list is cross-cutting only — codes that mean the same thing regardless
 * of which flow hit them. A domain-specific 400/409 (an invariant like INV-1
 * double-booking) gets its own code added here when that phase lands; it is
 * not a free-form string, because the client's handler switches on this type
 * and a typo in a string literal is not a compile error.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "MISSING_TOKEN",
  "INVALID_TOKEN",
  "NOT_FOUND",
  "FORBIDDEN_CAPABILITY",
  "PERIOD_CLOSED",
  "RATE_LIMITED",
  "BUSINESS_ALREADY_EXISTS",
  "VEHICLE_ALREADY_EXISTS",
  "VEHICLE_DOUBLE_BOOKED",
  "DAILY_LEASE_OVERLAPS",
  "TRIP_ADVANCE_UNSETTLED",
  "OWNERSHIP_SHARES_INVALID",
  "MANAGEMENT_AGREEMENT_OVERLAPS",
  "INSURANCE_CLAIM_ALREADY_EXISTS",
  "PAYMENT_ALREADY_REVERSED",
  "EXPENSE_ALREADY_VOIDED",
  "OPENING_BALANCE_LOCKED",
  "LAST_OWNER_REQUIRED",
  "INVITE_CODE_INVALID",
  "VEHICLE_ARRANGEMENT_MISMATCH",
  "VEHICLE_ARRANGEMENT_CHANGE_BLOCKED",
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_TYPE_UNSUPPORTED",
  "ATTACHMENT_ALREADY_VOIDED",
  "ATTACHMENT_SUBJECT_UNSUPPORTED",
  "ATTACHMENT_ID_CONFLICT",
  "DAY_RECORD_VOIDED",
  "PARTY_HAS_OPEN_MONEY",
  "PARTY_ALREADY_ARCHIVED",
  "CAPITAL_CONTRIBUTION_ALREADY_VOIDED",
  "BANKING_EVENT_ALREADY_VOIDED",
  "PARTNER_PAYOUT_ALREADY_VOIDED",
  // GAP-12/W-61/INV-36: the nine remaining void-cascade tables. One
  // "already voided" code per table (matching Expense/CapitalContribution's
  // own precedent), plus one shared VOID_BLOCKED for every refusal that
  // names a separately-entered child row still standing in the way (§4).
  "ADJUSTMENT_ALREADY_VOIDED",
  "OBLIGATION_ALREADY_VOIDED",
  "DEPOSIT_MOVEMENT_ALREADY_VOIDED",
  "ADVANCE_ALREADY_VOIDED",
  "ADVANCE_SETTLEMENT_ALREADY_VOIDED",
  "WRITE_OFF_ALREADY_VOIDED",
  "WRITE_OFF_RECOVERY_ALREADY_VOIDED",
  "INCIDENT_RECOVERY_ALREADY_VOIDED",
  "OFFSET_RECORD_ALREADY_VOIDED",
  "VOID_BLOCKED",
  // GAP-60/D-16: the replacement writes `replaces_id`, not the void
  // (§4's own rule). Two ways that write can be wrong, shared across all
  // thirteen tables rather than duplicated per table like the codes above,
  // because neither names a table-specific fact the way "already voided"
  // does — both are about the referenced row's own state.
  "REPLACES_TARGET_NOT_VOIDED",
  "REPLACES_TARGET_ALREADY_REPLACED",
  // GAP-20: skippable individual daily-lease days.
  "LEASE_DAY_ALREADY_EXCEPTED",
  "LEASE_DAY_EXCEPTION_ALREADY_VOIDED",
  "LEASE_DAY_ALREADY_CONFIRMED",
  // GAP-26: off the road.
  "VEHICLE_UNAVAILABILITY_OVERLAPS",
  "VEHICLE_UNAVAILABILITY_ALREADY_VOIDED",
  // Not one of IG §3.3's documented rows — those are all deliberate AppError
  // throws. This is the fallback for the global handler when the exception
  // was not one, e.g. a database blip: a real 500 still needs a code on the
  // wire, and "there wasn't meant to be one" is not a valid response body.
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  error: string;
  code: ErrorCode;
  requestId: string;
  details?: unknown;
}

/**
 * GAP-44: `VEHICLE_DOUBLE_BOOKED`'s own `details` shape — the one error
 * code whose `details` a client actually reads (the others carry it but no
 * caller has needed it yet), so this is defined once here rather than
 * separately on each side, the same reason a Zod schema is (rule 2, the
 * five ordering rules TRACKER.md/Plan.md both cite): a hand-mirrored type
 * drifts, and what drifts here is which dates a Dialog offers to book.
 */
export interface VehicleDoubleBookedConflict {
  /** A lease's own occupancy is written by `generate-day-cards` (P13) out to its rolling horizon, not by `startLease` synchronously — so a new trip can still collide with one that was booked before the lease existed, not only with another trip or a daily lease. */
  sourceType: "lease" | "daily_lease" | "trip";
  /** The conflicting entity's own start — always present; a lease's, a trip's or a daily lease's occupancy all start on a real date. */
  from: string;
  /** `null` for an open-ended lease or an ongoing daily lease — a trip always has both. */
  to: string | null;
  /** Resolved server-side (the customer/driver's own name) so the client never needs a second round trip just to word the conflict. */
  holderLabel: string;
  /** Trip only. */
  destination: string | null;
}

export interface VehicleDoubleBookedDetails {
  conflict: VehicleDoubleBookedConflict;
  /** The first date, at or after the request's own start, that could hold a booking of the same length — `null` if none was found within the lookahead window. */
  nextFreeFrom: string | null;
}
