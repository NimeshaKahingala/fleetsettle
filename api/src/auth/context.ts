import type { Context } from "hono";
import type { Env } from "../types.js";
import { ForbiddenCapabilityError } from "../errors/app-error.js";
import { can, type Capability } from "./policy.js";

/**
 * `businessId`/`driverId` are optional on `Variables` because they are
 * genuinely unset before `authMiddleware` runs — honest, not a shortcut.
 * Every handler mounted behind it can rely on `businessId` existing, so this
 * turns "is the wiring right" into one throw instead of an optional-chain at
 * every call site. A throw here is a mounting bug, not a client error — it
 * never reaches a user if the route is wired correctly.
 */
export function requireBusinessId(c: Context<Env>): string {
  const businessId = c.get("businessId");
  if (!businessId)
    throw new Error("businessId is not set — is authMiddleware mounted on this route?");
  return businessId;
}

export function requireDriverId(c: Context<Env>): string {
  const driverId = c.get("driverId");
  if (!driverId)
    throw new Error("driverId is not set — this route is not scoped to a linked driver");
  return driverId;
}

/** W-54: the business's own configured timezone, never a hardcoded default (CLAUDE.md → Time). */
export function requireBusinessTimezone(c: Context<Env>): string {
  const businessTimezone = c.get("businessTimezone");
  if (!businessTimezone)
    throw new Error("businessTimezone is not set — is authMiddleware mounted on this route?");
  return businessTimezone;
}

/** W-49: the one place a capability is decided (IG §7.2) — every handler that needs a gate calls this instead of re-deriving the `!role || !can(...)` check inline. */
export function requireCapability(c: Context<Env>, capability: Capability): void {
  const role = c.get("role");
  if (!role || !can(role, capability)) throw new ForbiddenCapabilityError();
}

/** F-0.1 only — set by `verifyTokenMiddleware`, never by `authMiddleware`. */
export function requireAuthSub(c: Context<Env>): string {
  const authSub = c.get("authSub");
  if (!authSub)
    throw new Error("authSub is not set — is verifyTokenMiddleware mounted on this route?");
  return authSub;
}
