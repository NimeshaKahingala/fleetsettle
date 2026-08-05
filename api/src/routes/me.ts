import { Hono } from "hono";
import type { Env } from "../types.js";

/**
 * The identity the frontend needs for role → shell selection (P1 Frontend,
 * UI §3.1's tab bars differ by role) — and the natural happy-path target for
 * the auth-boundary test matrix (TRACKER.md P1 "Done means"). Mounted behind
 * `dbMiddleware` + `authMiddleware`, so reaching the handler at all already
 * proves the token verified and resolved to a business.
 */
export const me = new Hono<Env>().get("/", (c) => {
  const role = c.get("role");
  const driverId = c.get("driverId");
  return c.json({
    userId: c.get("userId"),
    businessId: c.get("businessId"),
    role,
    ...(driverId ? { driverId } : {}),
  });
});
