import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  changeBusinessMemberRoleHandler,
  inviteBusinessMemberHandler,
  listBusinessMembersHandler,
  revokeBusinessMemberHandler,
} from "../handlers/business-member.js";
import {
  changeBusinessMemberRoleRoute,
  inviteBusinessMemberRoute,
  listBusinessMembersRoute,
  revokeBusinessMemberRoute,
} from "../route-defs/business-member.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const businessMember = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(listBusinessMembersRoute, listBusinessMembersHandler)
  .openapi(inviteBusinessMemberRoute, inviteBusinessMemberHandler)
  .openapi(revokeBusinessMemberRoute, revokeBusinessMemberHandler)
  .openapi(changeBusinessMemberRoleRoute, changeBusinessMemberRoleHandler);
