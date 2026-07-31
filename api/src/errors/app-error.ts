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
