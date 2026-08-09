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
