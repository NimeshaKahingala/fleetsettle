import type { RouteHandler } from "@hono/zod-openapi";
import { requireUserId } from "../auth/context.js";
import { approveRequest, rejectRequest } from "../domain/business-creation.js";
import {
  grantPlatformAdmin,
  revokePlatformAdminGrant,
  setBusinessAllowance,
} from "../domain/platform-admin.js";
import {
  listRequests,
  listBusinessesForAdmin,
} from "../queries/platform/business-creation-request.js";
import {
  listPlatformAdmins,
  listPlatformAuditLog,
  listUsersForAdmin,
} from "../queries/platform/platform-admin.js";
import type {
  decideRequestRoute,
  getAuditLogRoute,
  grantAdminRoute,
  listAdminsRoute,
  listBusinessesRoute,
  listRequestsRoute,
  listUsersRoute,
  revokeAdminRoute,
  setAllowanceRoute,
} from "../route-defs/admin.js";
import type { Env } from "../types.js";

export const listRequestsHandler: RouteHandler<typeof listRequestsRoute, Env> = async (c) => {
  const requests = await listRequests(c.get("reader"));
  const actorId = requireUserId(c);
  return c.json(
    requests.map((r) => ({
      id: r.id,
      requestedBy: r.requestedBy,
      requesterName: r.requesterName,
      requesterEmail: r.requesterEmail,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      rejectionReason: r.rejectionReason,
      // W-67: for a decided request, the true self_action is whoever
      // actually decided it, recorded in platform_audit_log at that moment
      // (query joins it in as decidedSelfAction) — never the current
      // viewer, who may be a different admin entirely. For a still-pending
      // request there is no decision yet to be self or otherwise about, so
      // this instead answers "would deciding this right now be
      // self-approval," which is the version of the question that matters
      // to whoever is about to act on it.
      selfAction:
        r.status === "pending" ? r.requestedBy === actorId : (r.decidedSelfAction ?? false),
    })),
    200,
  );
};

export const decideRequestHandler: RouteHandler<typeof decideRequestRoute, Env> = async (c) => {
  const { id } = c.req.valid("param");
  const input = c.req.valid("json");
  const actorId = requireUserId(c);

  if (input.decision === "approve") {
    await approveRequest(c.get("writer"), id, actorId);
  } else {
    await rejectRequest(c.get("writer"), id, actorId, input.reason);
  }

  return c.body(null, 200);
};

export const listBusinessesHandler: RouteHandler<typeof listBusinessesRoute, Env> = async (c) => {
  const businesses = await listBusinessesForAdmin(c.get("reader"));
  return c.json(businesses, 200);
};

export const listUsersHandler: RouteHandler<typeof listUsersRoute, Env> = async (c) => {
  const users = await listUsersForAdmin(c.get("reader"));
  return c.json(users, 200);
};

export const setAllowanceHandler: RouteHandler<typeof setAllowanceRoute, Env> = async (c) => {
  const { id } = c.req.valid("param");
  const { businessAllowance } = c.req.valid("json");
  const actorId = requireUserId(c);
  await setBusinessAllowance(c.get("writer"), id, actorId, businessAllowance);
  return c.body(null, 200);
};

export const listAdminsHandler: RouteHandler<typeof listAdminsRoute, Env> = async (c) => {
  const admins = await listPlatformAdmins(c.get("reader"));
  return c.json(
    admins.map((a) => ({
      userId: a.userId,
      email: a.email,
      displayName: a.displayName,
      grantedAt: a.grantedAt,
    })),
    200,
  );
};

export const grantAdminHandler: RouteHandler<typeof grantAdminRoute, Env> = async (c) => {
  const { userId } = c.req.valid("json");
  const actorId = requireUserId(c);
  await grantPlatformAdmin(c.get("writer"), userId, actorId);
  return c.body(null, 200);
};

export const revokeAdminHandler: RouteHandler<typeof revokeAdminRoute, Env> = async (c) => {
  const { id } = c.req.valid("param");
  const actorId = requireUserId(c);
  await revokePlatformAdminGrant(c.get("writer"), id, actorId);
  return c.body(null, 200);
};

export const getAuditLogHandler: RouteHandler<typeof getAuditLogRoute, Env> = async (c) => {
  const entries = await listPlatformAuditLog(c.get("reader"));
  return c.json(
    entries.map((e) => ({
      id: e.id,
      action: e.action as
        | "request_approved"
        | "request_rejected"
        | "admin_granted"
        | "admin_revoked"
        | "allowance_changed",
      subjectId: e.subjectId,
      actorId: e.actorId,
      actorName: e.actorName,
      selfAction: e.selfAction,
      createdAt: e.createdAt,
    })),
    200,
  );
};
