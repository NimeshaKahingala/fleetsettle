import { createRoute } from "@hono/zod-openapi";
import { redeemInviteRequestSchema, redeemInviteResponseSchema } from "@fleetsettle/shared/schemas";

/**
 * W-57. Mounted behind `verifyTokenMiddleware`, never `authMiddleware`
 * (index.ts) — the same reasoning as `POST /api/business` (F-0.1): the
 * caller may not resolve to any business or driver yet, because this route
 * is what can create that resolution. No capability check inside the
 * handler either — redeeming is how a capability is granted in the first
 * place.
 */
export const redeemInviteRoute = createRoute({
  method: "post",
  path: "/redeem",
  request: {
    body: { content: { "application/json": { schema: redeemInviteRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: redeemInviteResponseSchema } },
      description: "Joined — either a business membership or a linked driver account",
    },
    400: { description: "This code is invalid or has expired" },
    401: { description: "Missing or invalid access token" },
    // Phase 1 (18 Aug 2026, W-63/W-66): a different business is no longer a
    // conflict — an identity may hold several. Only business_member_active_pair
    // survives: the identical business, redeemed twice.
    409: { description: "This account already belongs to this business" },
  },
});
