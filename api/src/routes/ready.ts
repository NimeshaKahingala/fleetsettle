import { Hono } from "hono";
import type { Env } from "../types.js";

/** Runs `SELECT 1` against the real database (IG §11) — mounted with `dbMiddleware`. */
export const ready = new Hono<Env>().get("/", async (c) => {
  await c.get("reader")`SELECT 1`;
  return c.json({ ok: true });
});
