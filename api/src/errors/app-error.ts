import type { ErrorCode, VehicleDoubleBookedDetails } from "@fleetsettle/shared";

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

// Renamed from BusinessAlreadyExistsError, Phase 1 (18 Aug 2026, decision
// 19/21): one_active_business_per_user is dropped — an identity may now
// hold more than one business (W-63 to W-67). What survives is
// business_member_active_pair, a narrower rule: the same identity cannot
// join the *same* business twice (a double-submitted invite redemption is
// the one live path that still hits this). No longer thrown by
// createBusiness at all — a second business is legal, gated by the
// allowance/threshold (Phase 2), not by this constraint.
export class AlreadyAMemberError extends AppError {
  constructor(message = "This account already belongs to this business") {
    super(409, "BUSINESS_ALREADY_MEMBER", message);
  }
}

// IG §7.5 step 4b: more than one resolved membership and no X-Business-Id
// header to pick between them. Never guessed — the client must show the
// switcher (user-flows.md F-0.4).
export class BusinessNotSelectedError extends AppError {
  constructor(message = "Select which business this request is for") {
    super(400, "BUSINESS_NOT_SELECTED", message);
  }
}

// INV-41, Phase 2: business_creation_request_one_pending — a rejected
// requester may request again; a pending requester may not queue a second.
export class RequestAlreadyPendingError extends AppError {
  constructor(message = "A request is already being reviewed") {
    super(409, "REQUEST_ALREADY_PENDING", message);
  }
}

// F-11.1: a request already approved or rejected cannot be decided again —
// the same "already voided" shape as ExpenseAlreadyVoidedError, applied to
// a decision rather than a void.
export class RequestAlreadyDecidedError extends AppError {
  constructor(message = "This request has already been decided") {
    super(409, "REQUEST_ALREADY_DECIDED", message);
  }
}

// INV-40/migration 0030: assert_platform_has_admin() is the truth — a
// revoke that would leave the platform with no active admin is refused
// rather than merely warned, the same shape as LastOwnerRequiredError one
// level up.
export class LastPlatformAdminRequiredError extends AppError {
  constructor(message = "The platform must always have at least one active admin") {
    super(409, "LAST_PLATFORM_ADMIN_REQUIRED", message);
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
// PeriodClosedError. GAP-44: `details` is optional because the enrichment
// query (domain/trip.ts's own `buildDoubleBookedError`) is a best-effort
// read after the constraint violation already happened — if it somehow
// finds no occupying row (a race with a concurrent void, in principle) or
// one of its reads itself throws (a transient DB error), the 409 still
// fires with the plain message rather than failing to error at all.
export class VehicleDoubleBookedError extends AppError {
  constructor(
    message = "This vehicle is already allocated for one or more of these dates",
    details?: VehicleDoubleBookedDetails,
  ) {
    super(409, "VEHICLE_DOUBLE_BOOKED", message, details);
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

// GAP-135/DM D-5. F-4.5 promises "a weekly settler is not in arrears on
// Thursday": `obligation.effective_due_on` is meant to be derived from
// `driver.settlement_rhythm`, and that derivation was never built —
// `confirmDay` sets `effective_due_on = due_on` unconditionally. Harmless
// while every driver is `'daily'` (where the two genuinely are equal), and
// silently wrong the moment one is `'weekly'`: his day fee would read as
// overdue on every day before the agreed settlement point, in the ageing
// report and the driver-money screens alike, with nothing announced.
//
// So the write path refuses rather than computing a date it knows is wrong.
// This is W-56's rule ("reports degrade to 'not available', never to a
// confident wrong number") applied to a write: an admitted refusal a person
// can act on, instead of a plausible figure nobody would question. It is
// deliberately *not* a CHECK constraint pinning the column to `'daily'` —
// that would contradict UC-31, UC-37 and F-4.5, which all describe weekly
// settlement as a real arrangement this business has. The rhythm stays
// licensed; only the unbuilt computation is blocked.
export class SettlementRhythmUnsupportedError extends AppError {
  constructor(rhythm: string) {
    super(
      409,
      "SETTLEMENT_RHYTHM_UNSUPPORTED",
      `This driver settles ${rhythm}, and due dates for that rhythm are not calculated yet — confirming the day would record a due date that reads as overdue when it is not. Set the driver to daily settlement, or record this day once the rhythm is supported.`,
    );
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

// INV-35/W-60/UC-100: a receivable (or a driver's unpaid fee) must never
// leave a report because someone archived the party it belongs to — refused,
// not merely warned, and every open figure is named separately (INV-3: a
// driver's two balances are never netted into one number).
export interface OpenMoneyItem {
  kind: "due" | "payable" | "deposit_held" | "advance";
  amountMinor: string;
}
export class PartyHasOpenMoneyError extends AppError {
  constructor(message: string, openItems: OpenMoneyItem[]) {
    super(409, "PARTY_HAS_OPEN_MONEY", message, { openItems });
  }
}

// GAP-178/B13/W-60: money inserted against a driver or customer that has
// already been archived, refused by migration 0031's trigger rather than by
// an application check — the write paths are too many to guard one at a time,
// and a new one added later would reopen the race in silence.
//
// The remedy is a real one and the message says it: unarchive, record the
// fact, archive again. A party still receiving charges is not gone.
export class PartyArchivedError extends AppError {
  constructor(
    message = "That driver or customer has been archived — restore them first, " +
      "record this, then archive them again",
  ) {
    super(409, "PARTY_ARCHIVED", message);
  }
}

// GAP-178/B19: a second live recovery against the same (incident, source).
// Migration 0031's unique index is the enforcement; before it, a re-submitted
// form or a manager re-entering a revised figure without voiding the first
// silently left the incident carrying two claims against one source.
export class RecoveryAlreadyRecordedError extends AppError {
  constructor(
    message = "A recovery from this source is already recorded against this incident — " +
      "void it first, then enter the corrected figure",
  ) {
    super(409, "RECOVERY_ALREADY_RECORDED", message);
  }
}

// F-1.11: a driver or customer already carrying `voided_at` — a second
// archive would silently overwrite the first one's own reason and actor,
// the same shape as ExpenseAlreadyVoidedError/AttachmentAlreadyVoidedError.
export class PartyAlreadyArchivedError extends AppError {
  constructor(message = "This driver or customer has already been archived") {
    super(409, "PARTY_ALREADY_ARCHIVED", message);
  }
}

// GAP-12/A9b: void-and-replace lands on the remaining twelve W-50 tables,
// one table at a time — the reference pattern is `voidExpense`/
// `ExpenseAlreadyVoidedError`. Same "already voided" shape, one class per
// table (matching Expense/Attachment/DayRecord's own precedent) so each
// carries its own message and wire code.
export class CapitalContributionAlreadyVoidedError extends AppError {
  constructor(message = "This capital contribution has already been voided") {
    super(409, "CAPITAL_CONTRIBUTION_ALREADY_VOIDED", message);
  }
}

export class BankingEventAlreadyVoidedError extends AppError {
  constructor(message = "This banking event has already been voided") {
    super(409, "BANKING_EVENT_ALREADY_VOIDED", message);
  }
}

export class PartnerPayoutAlreadyVoidedError extends AppError {
  constructor(message = "This payout has already been voided") {
    super(409, "PARTNER_PAYOUT_ALREADY_VOIDED", message);
  }
}

// GAP-12/W-61/INV-36: the nine remaining void-cascade tables — the same
// "already voided" shape as CapitalContributionAlreadyVoidedError etc.,
// one class per table so each carries its own message and wire code.
export class AdjustmentAlreadyVoidedError extends AppError {
  constructor(message = "This adjustment has already been voided") {
    super(409, "ADJUSTMENT_ALREADY_VOIDED", message);
  }
}

export class ObligationAlreadyVoidedError extends AppError {
  constructor(message = "This obligation has already been voided") {
    super(409, "OBLIGATION_ALREADY_VOIDED", message);
  }
}

export class DepositMovementAlreadyVoidedError extends AppError {
  constructor(message = "This deposit movement has already been voided") {
    super(409, "DEPOSIT_MOVEMENT_ALREADY_VOIDED", message);
  }
}

export class AdvanceAlreadyVoidedError extends AppError {
  constructor(message = "This advance has already been voided") {
    super(409, "ADVANCE_ALREADY_VOIDED", message);
  }
}

export class AdvanceSettlementAlreadyVoidedError extends AppError {
  constructor(message = "This settlement has already been voided") {
    super(409, "ADVANCE_SETTLEMENT_ALREADY_VOIDED", message);
  }
}

export class WriteOffAlreadyVoidedError extends AppError {
  constructor(message = "This write-off has already been voided") {
    super(409, "WRITE_OFF_ALREADY_VOIDED", message);
  }
}

export class WriteOffRecoveryAlreadyVoidedError extends AppError {
  constructor(message = "This recovery has already been voided") {
    super(409, "WRITE_OFF_RECOVERY_ALREADY_VOIDED", message);
  }
}

export class IncidentRecoveryAlreadyVoidedError extends AppError {
  constructor(message = "This recovery has already been voided") {
    super(409, "INCIDENT_RECOVERY_ALREADY_VOIDED", message);
  }
}

export class OffsetRecordAlreadyVoidedError extends AppError {
  constructor(message = "This offset has already been voided") {
    super(409, "OFFSET_RECORD_ALREADY_VOIDED", message);
  }
}

// GAP-12/W-61/INV-36 §2/§4: the governing principle's refuse half — a parent
// whose void would touch a row someone entered separately, in its own
// right (a live settlement, recovery, or receipt), refuses and names every
// blocking row, the same `details` shape PartyHasOpenMoneyError already
// uses — U-5's "every figure can be corrected later" must be true in the
// client's hand, not only in the API.
export interface VoidBlockingItem {
  kind: string;
  id: string;
  amountMinor?: string;
}
export class VoidBlockedError extends AppError {
  constructor(message: string, blocking: VoidBlockingItem[]) {
    super(409, "VOID_BLOCKED", message, { blocking });
  }
}

// GAP-60/D-16: "the replacement writes replaces_id, not the void" — these
// two guard that write. Shared across all thirteen tables, unlike the
// per-table AlreadyVoided classes above, because neither is a table-specific
// fact: both describe the referenced row's own state, checked the same way
// regardless of which table it lives in. Existence and tenancy for the
// referenced row reuse the plain NotFoundError every other cross-id lookup
// in this codebase already throws (CLAUDE.md → Tenancy: cross-tenant is 404,
// not a table-specific code).
export class ReplacesTargetNotVoidedError extends AppError {
  constructor(message = "The record being replaced must be voided first") {
    super(409, "REPLACES_TARGET_NOT_VOIDED", message);
  }
}

export class ReplacesTargetAlreadyReplacedError extends AppError {
  constructor(message = "That record has already been replaced by another") {
    super(409, "REPLACES_TARGET_ALREADY_REPLACED", message);
  }
}

// GAP-20: skippable individual daily-lease days. Migration 0027's partial
// unique index (WHERE voided_at IS NULL) is what makes this a real conflict
// rather than a silent duplicate — a date can carry at most one live
// exception at a time.
export class LeaseDayAlreadyExceptedError extends AppError {
  constructor(message = "This date is already skipped on this daily lease") {
    super(409, "LEASE_DAY_ALREADY_EXCEPTED", message);
  }
}

export class LeaseDayExceptionAlreadyVoidedError extends AppError {
  constructor(message = "This exception has already been undone") {
    super(409, "LEASE_DAY_EXCEPTION_ALREADY_VOIDED", message);
  }
}

// A day already confirmed is a real event, not erasable by a later
// decision to skip it — that needs UC-96's ordinary void-and-correct path,
// not this mechanism (F-1.7/GAP-20's own note: an exception only ever
// stops a card from being generated in the first place).
export class LeaseDayAlreadyConfirmedError extends AppError {
  constructor(message = "This day has already been confirmed and cannot be skipped retroactively") {
    super(409, "LEASE_DAY_ALREADY_CONFIRMED", message);
  }
}

// GAP-26: migration 0019's `vehicle_unavailability_vehicle_id_daterange_excl`
// — a second live outage for the same vehicle over an overlapping range.
export class VehicleUnavailabilityOverlapsError extends AppError {
  constructor(message = "This vehicle already has a live outage over one or more of these dates") {
    super(409, "VEHICLE_UNAVAILABILITY_OVERLAPS", message);
  }
}

export class VehicleUnavailabilityAlreadyVoidedError extends AppError {
  constructor(message = "This outage has already been undone") {
    super(409, "VEHICLE_UNAVAILABILITY_ALREADY_VOIDED", message);
  }
}
