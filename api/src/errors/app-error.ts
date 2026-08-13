import type { ErrorCode } from "@fleetsettle/shared";

/**
 * One base, typed subclasses, one global `app.onError` (IG §3.3). Handlers
 * throw; they never hand-roll an error response, so the shape on the wire is
 * identical no matter which flow produced it.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}

export class MissingTokenError extends AppError {
  constructor(message = "Authorization header is required") {
    super(401, "MISSING_TOKEN", message);
  }
}

export class InvalidTokenError extends AppError {
  constructor(message = "Token is invalid or expired") {
    super(401, "INVALID_TOKEN", message);
  }
}

// Cross-tenant access returns 404, never 403 — a 403 confirms the row exists
// (CLAUDE.md → Tenancy). This class covers both "does not exist" and
// "exists, but not in this business" for exactly that reason.
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class ForbiddenCapabilityError extends AppError {
  constructor(message = "This role cannot perform that action") {
    super(403, "FORBIDDEN_CAPABILITY", message);
  }
}

// The period-open trigger is the truth (IG §4.2). This class exists so a
// caught trigger violation maps to one code, never a pre-check in application
// code duplicating the trigger's own logic.
export class PeriodClosedError extends AppError {
  constructor(message = "That accounting period is closed") {
    super(409, "PERIOD_CLOSED", message);
  }
}

// IG §13: the Workers rate-limiting binding, never a database row per
// request — that is two round trips and unbounded growth for the one thing
// rate limiting exists to bound.
export class RateLimitedError extends AppError {
  constructor(message = "Too many requests") {
    super(429, "RATE_LIMITED", message);
  }
}

// F-0.1: this product has no multi-business membership (DM §3's
// `one_active_business_per_user` index). A second "create business" call
// for the same identity — a double-submit, a client retry — is a conflict
// with the caller's own existing business, not a validation error.
export class BusinessAlreadyExistsError extends AppError {
  constructor(message = "This account already belongs to a business") {
    super(409, "BUSINESS_ALREADY_EXISTS", message);
  }
}

// F-1.1: DM §4's `UNIQUE(business_id, registration)` — the same registration
// entered twice for the same business, most plausibly a double-submit.
export class VehicleAlreadyExistsError extends AppError {
  constructor(message = "A vehicle with this registration already exists") {
    super(409, "VEHICLE_ALREADY_EXISTS", message);
  }
}

// INV-1 (UC-20: "the car cannot also be on a monthly rental for those dates,
// and it says so before you can create the conflict"). DM §4.1's
// `one_arrangement_per_vehicle_day` unique index is the truth — this class
// exists so a caught violation maps to one code, the same pattern as
// PeriodClosedError.
export class VehicleDoubleBookedError extends AppError {
  constructor(message = "This vehicle is already allocated for one or more of these dates") {
    super(409, "VEHICLE_DOUBLE_BOOKED", message);
  }
}

// DM §7's `daily_lease_vehicle_id_daterange_excl` exclusion constraint — a
// second daily lease for the same vehicle over an overlapping date range.
export class DailyLeaseOverlapsError extends AppError {
  constructor(message = "This vehicle already has a daily lease over one or more of these dates") {
    super(409, "DAILY_LEASE_OVERLAPS", message);
  }
}

// GAP-84/F1: neither `startLease` nor `startDailyLease` read the vehicle's
// own standing arrangement before writing one — a deep link (or any crafted
// request) could start a real monthly lease on a charter vehicle. The
// message names the vehicle's actual arrangement so the client can render
// something more useful than a bare refusal.
export class VehicleArrangementMismatchError extends AppError {
  constructor(message: string) {
    super(409, "VEHICLE_ARRANGEMENT_MISMATCH", message);
  }
}

// F-1.2/UC-94/GAP-54: "no open lease/trip conflicting with the effective
// date." A daily lease (arrangement B) is bookkeeping-only — nothing money-
// committing happens by leaving it open — so F-1.2 closes it automatically
// on the way past (§4.1's "daily cards stop"); a lease (arrangement A)
// carries a deposit/mileage/billing commitment F-2.6's own multi-step flow
// exists to unwind deliberately, so this refuses instead of silently
// closing one.
export class VehicleArrangementChangeBlockedError extends AppError {
  constructor(message: string) {
    super(409, "VEHICLE_ARRANGEMENT_CHANGE_BLOCKED", message);
  }
}

// INV-17 (F-5.4: "will not close while a driver advance against it is
// unreconciled — this is the one place friction is correct, because
// unreconciled advances turn trip profit into fiction"). F-5.5 reuses the
// same block on cancel: an advance still open needs a disposition before the
// trip can leave the books.
export class TripAdvanceUnsettledError extends AppError {
  constructor(message = "An advance against this trip is not yet reconciled") {
    super(409, "TRIP_ADVANCE_UNSETTLED", message);
  }
}

// INV-16 (UC-02: shares must total exactly 100% on any date they are in
// force). `assert_shares_total()`'s deferred constraint trigger is the
// truth; this class exists so a caught violation maps to one code, the same
// pattern as PeriodClosedError.
export class OwnershipSharesInvalidError extends AppError {
  constructor(message = "Ownership shares for this vehicle and date must total exactly 100%") {
    super(400, "OWNERSHIP_SHARES_INVALID", message);
  }
}

// DM §6.1's `management_fee_agreement_vehicle_id_manager_user_id_datera_excl`
// exclusion constraint — a second agreement for the same vehicle and manager
// over an overlapping date range.
export class ManagementAgreementOverlapsError extends AppError {
  constructor(
    message = "This vehicle already has a management agreement with this manager over one or more of these dates",
  ) {
    super(409, "MANAGEMENT_AGREEMENT_OVERLAPS", message);
  }
}

// F-3.4/UC-12/W-11: one insurer recovery per incident — an app-level guard
// (there is no exclusion constraint for it) against submitting a second claim
// for the same accident.
export class InsuranceClaimAlreadyExistsError extends AppError {
  constructor(message = "An insurance claim has already been submitted for this incident") {
    super(409, "INSURANCE_CLAIM_ALREADY_EXISTS", message);
  }
}

// F-8.2/UC-93: `payment.status = 'reversed'` means the whole amount has
// already been undone — nothing left for a further correction to touch.
export class PaymentAlreadyReversedError extends AppError {
  constructor(message = "This payment has already been fully reversed") {
    super(409, "PAYMENT_ALREADY_REVERSED", message);
  }
}

// F-8.5/UC-96: an expense already carrying `voided_at` — a second void would
// silently overwrite the first correction's own reason and actor.
export class ExpenseAlreadyVoidedError extends AppError {
  constructor(message = "This expense has already been voided") {
    super(409, "EXPENSE_ALREADY_VOIDED", message);
  }
}

// F-0.2's own Alternates clause: "an opening figure stays editable until the
// first accounting period is closed... after that it is an ordinary
// adjustment like any other" (UC-09). P2 left this unenforced because no
// business could reach that state; P9 is what makes it reachable.
export class OpeningBalanceLockedError extends AppError {
  constructor(
    message = "The first accounting period has closed; correct this through an ordinary adjustment instead",
  ) {
    super(409, "OPENING_BALANCE_LOCKED", message);
  }
}

// INV-31/A11: `assert_business_has_owner()` (migration 0010) is the truth —
// a revoke or role change that would leave a business with no active
// owner/owner-manager is refused rather than merely warned, because nothing
// could ever undo it once it happened.
export class LastOwnerRequiredError extends AppError {
  constructor(
    message = "This business must always have at least one active owner or owner-manager",
  ) {
    super(409, "LAST_OWNER_REQUIRED", message);
  }
}

// W-57/W-42: a code that does not match any live, unexpired, unconsumed
// business_member_invite or driver_link_invite row. One message regardless
// of which of "never existed", "expired" or "already redeemed" is true —
// distinguishing them would let an attacker enumerate which reason applied.
export class InviteCodeInvalidError extends AppError {
  constructor(message = "This code is invalid or has expired") {
    super(400, "INVITE_CODE_INVALID", message);
  }
}

// A7/GAP-16: the server backstop against the path where the client's own
// 200KB encoder never ran (photo-pipeline.ts's no-2D-context fallback
// returns the original, undownscaled File). 5 MiB, not 200KB — the two
// caps govern different things (A7's plan, "Domain and storage").
export class AttachmentTooLargeError extends AppError {
  constructor(message = "This file is larger than the 5 MiB upload limit") {
    super(413, "ATTACHMENT_TOO_LARGE", message);
  }
}

// Migration 0013's content_type allowlist CHECK, enforced here first for a
// field-level message rather than a raw constraint violation reaching a user.
export class AttachmentTypeUnsupportedError extends AppError {
  constructor(message = "Only JPEG, PNG or WebP images are accepted") {
    super(400, "ATTACHMENT_TYPE_UNSUPPORTED", message);
  }
}

// W-50: void, never delete — a second void would silently overwrite the
// first correction's own reason and actor, the same pattern as
// ExpenseAlreadyVoidedError.
export class AttachmentAlreadyVoidedError extends AppError {
  constructor(message = "This attachment has already been voided") {
    super(409, "ATTACHMENT_ALREADY_VOIDED", message);
  }
}

// A7's plan, decision 5: "legal in the database" (migration 0013's
// kind/subject_type CHECK) and "supported by this branch's API" are two
// separate gates. A subjectType this branch does not build yet fails here,
// predictably, rather than by an unhandled dispatch-map lookup.
export class AttachmentSubjectUnsupportedError extends AppError {
  constructor(message = "Uploads for this subject type are not available yet") {
    super(400, "ATTACHMENT_SUBJECT_UNSUPPORTED", message);
  }
}

// A7's plan, "Idempotency": the client-minted id already names a different
// kind/subjectType/subjectId — the same id is being reused for a different
// fact, not a retry of the same one.
export class AttachmentIdConflictError extends AppError {
  constructor(message = "This attachment id is already in use for a different upload") {
    super(409, "ATTACHMENT_ID_CONFLICT", message);
  }
}

// GAP-118/Wave 2: a driver or arrangement change voids a stale future
// day_record rather than mutating it (migration 0022, W-58) — a client
// still holding the superseded lease id for this date (a stale calendar
// fetch from before the change) must not be able to confirm it and write
// real money against a day nobody actually covers any more. Same "already
// voided" shape as ExpenseAlreadyVoidedError/AttachmentAlreadyVoidedError.
export class DayRecordVoidedError extends AppError {
  constructor(message = "This day's schedule has changed; refresh and try again") {
    super(409, "DAY_RECORD_VOIDED", message);
  }
}
