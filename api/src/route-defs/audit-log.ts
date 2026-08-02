import { createRoute } from "@hono/zod-openapi";
import { auditedTableNameSchema, auditLogResponseSchema } from "@fleetsettle/shared/schemas";
import { z } from "zod";

const auditLogParams = z.object({
  tableName: auditedTableNameSchema,
  recordId: z.string().uuid(),
});

/** F-8.6/UC-97/W-50: readable from the record itself, not only down a global log. An empty list covers both "no changes yet" and "not this business's record" — the query is already tenant-scoped, so there is nothing further to distinguish (CLAUDE.md → Tenancy). */
export const getAuditLogRoute = createRoute({
  method: "get",
  path: "/{tableName}/{recordId}",
  request: { params: auditLogParams },
  responses: {
    200: {
      content: { "application/json": { schema: auditLogResponseSchema } },
      description: "The record's audit trail, newest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot read the audit trail" },
  },
});
