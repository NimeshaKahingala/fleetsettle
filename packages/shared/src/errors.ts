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
