import { businessToday, toWire } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireBusinessTimezone, requireCapability } from "../auth/context.js";
import { getDepositReleases, getPaperworkWarnings } from "../domain/home.js";
import type { getDepositReleasesRoute, getPaperworkWarningsRoute } from "../route-defs/home.js";
import type { Env } from "../types.js";

/** F-10.1/UC-92. Same `dailyOperations` gate as the rest of the home screen's own daily-use content (owner/owner-manager/manager). */
export const getPaperworkWarningsHandler: RouteHandler<
  typeof getPaperworkWarningsRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));

  const rows = await getPaperworkWarnings(c.get("reader"), businessId, today);

  return c.json(rows, 200);
};

/** F-2.7/UC-16 step 6, W-29. Same `dailyOperations` gate — the actor is "System → manager." */
export const getDepositReleasesHandler: RouteHandler<typeof getDepositReleasesRoute, Env> = async (
  c,
) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));

  const rows = await getDepositReleases(c.get("reader"), businessId, today);

  return c.json(
    rows.map((r) => ({
      depositId: r.depositId,
      partyType: r.partyType,
      partyId: r.partyId,
      partyName: r.partyName,
      holdReleaseDate: r.holdReleaseDate,
      heldMinor: toWire(r.heldMinor),
    })),
    200,
  );
};
