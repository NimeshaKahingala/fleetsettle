import { createRoute } from "@hono/zod-openapi";
import { businessMembersResponseSchema } from "@fleetsettle/shared/schemas";

/** GAP-31: `dailyOperations` (STAFF), not `managePartnerCapital` — the caller is `BorneByPaidBy` inside `RecordExpenseSheet`, which a manager uses, not an owners-only screen. */
export const listBusinessMembersRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: businessMembersResponseSchema } },
      description: "This business's active owners, owner-managers and managers",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read business members" },
  },
});
