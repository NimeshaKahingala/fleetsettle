import { Hono } from "hono";
import type { Env } from "../types.js";

/**
 * No DB touch, deliberately (IG §11): this must stay green through a total
 * database outage. Point uptime/smoke checks at `/api/ready` instead.
 */
export const health = new Hono<Env>().get("/", (c) => c.json({ ok: true }));
