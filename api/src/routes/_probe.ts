import { Hono } from "hono";
import { can } from "../auth/policy.js";
import { ForbiddenCapabilityError, NotFoundError } from "../errors/app-error.js";
import type { Env } from "../types.js";

/**
 * Temporary — exists only to exercise the auth-boundary test matrix
 * (TRACKER.md P1 "Done means") against real tables before P2 builds the
 * CRUD endpoints that will make this redundant. Nothing here is a product
 * feature: no vehicle/driver route exists yet, and `close-period` performs
 * no period-close logic (that is P9's `assert_period_open()` trigger, not
 * a check written here twice).
 */
export const probe = new Hono<Env>()
  // 404 cross-business: scoped by business_id, the same shape every P2+ read gets.
  .get("/vehicle/:id", async (c) => {
    const rows = await c.get(
      "reader",
    )`SELECT id FROM vehicle WHERE id = ${c.req.param("id")} AND business_id = ${c.get("businessId")}`;
    if (!rows[0]) throw new NotFoundError();
    return c.json({ id: rows[0]["id"] as string });
  })

  // 404 cross-driver: IG §7.1 rule 4 — a linked driver's boundary is
  // `driver_id` scoping in the data layer, never a claim in the token. A
  // driver may only ever resolve their own row; staff are scoped by
  // business_id only, same as every other entity.
  .get("/driver/:id", async (c) => {
    const role = c.get("role");
    const id = c.req.param("id");
    const rows =
      role === "driver"
        ? await c.get(
            "reader",
          )`SELECT id FROM driver WHERE id = ${id} AND id = ${c.get("driverId")}`
        : await c.get(
            "reader",
          )`SELECT id FROM driver WHERE id = ${id} AND business_id = ${c.get("businessId")}`;
    if (!rows[0]) throw new NotFoundError();
    return c.json({ id: rows[0]["id"] as string });
  })

  // 403 capability: proves the gate only. Real period-close is P9.
  .post("/close-period", (c) => {
    const role = c.get("role");
    if (!role || !can(role, "closePeriod")) throw new ForbiddenCapabilityError();
    return c.json({ ok: true });
  });
