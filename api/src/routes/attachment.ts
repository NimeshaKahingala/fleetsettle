import { OpenAPIHono } from "@hono/zod-openapi";
import { zodValidationHook } from "../errors/openapi-hook.js";
import {
  createAttachmentHandler,
  getAttachmentHandler,
  listAttachmentsHandler,
  voidAttachmentHandler,
} from "../handlers/attachment.js";
import {
  createAttachmentRoute,
  getAttachmentRoute,
  listAttachmentsRoute,
  voidAttachmentRoute,
} from "../route-defs/attachment.js";
import type { Env } from "../types.js";

/** Wiring only (IG §3.2 step 7) — mounted behind `dbMiddleware` + `authMiddleware` in index.ts. */
export const attachment = new OpenAPIHono<Env>({ defaultHook: zodValidationHook })
  .openapi(createAttachmentRoute, createAttachmentHandler)
  .openapi(listAttachmentsRoute, listAttachmentsHandler)
  .openapi(getAttachmentRoute, getAttachmentHandler)
  .openapi(voidAttachmentRoute, voidAttachmentHandler);
