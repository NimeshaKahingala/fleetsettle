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
