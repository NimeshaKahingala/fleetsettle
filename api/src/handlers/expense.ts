import {
  asBusinessDate,
  businessToday,
  toWire,
  type BusinessDate,
  type Minor,
} from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import type { BorneBy, ExpenseCategory, OdometerSource } from "@fleetsettle/shared/schemas";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import type { Reader } from "../db/client.js";
import {
  createExpense,
  replaceExpense,
  resolveBorneByDefault,
  voidExpense,
  type ResolvedBorneBy,
} from "../domain/expense.js";
import { NotFoundError } from "../errors/app-error.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findVehicleWithOldestUnconfirmedDay } from "../queries/day-record.js";
import { findDriverForBusiness } from "../queries/driver.js";
import {
  listExpensesForBusiness,
  type BusinessExpenseRow,
  type ExpenseFilters,
} from "../queries/expense.js";
import { findIncidentForBusiness } from "../queries/incident.js";
import { findBusinessMemberUserId } from "../queries/partner.js";
import { findTripForBusiness } from "../queries/trip.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import type {
  createExpenseRoute,
  expensePrefillVehicleRoute,
  listExpensesRoute,
  replaceExpenseRoute,
  resolveBorneByRoute,
  voidExpenseRoute,
} from "../route-defs/expense.js";
import type { Env } from "../types.js";
import { assertNotFutureBusinessDate } from "../validation.js";

/**
 * `createExpenseRequestSchema` and `replaceExpenseRequestSchema` share this
 * whole field set (GAP-224 keeps the two schemas separate rather than one
 * deriving the other, since `.refine()` closes over the object shape, but
 * the tenancy checks below don't care which request shape they came from —
 * a "wrong vehicle" edit needs the new vehicle validated exactly as a
 * fresh create would).
 */
interface ExpensePartyFields {
  vehicleId?: string | undefined;
  tripId?: string | undefined;
  incidentId?: string | undefined;
  borneByDriverId?: string | undefined;
  borneByCustomerId?: string | undefined;
  paidByUserId?: string | undefined;
}

async function assertExpensePartiesExist(
  reader: Reader,
  businessId: string,
  body: ExpensePartyFields,
): Promise<void> {
  if (body.vehicleId !== undefined) {
    const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
    if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  }

  if (body.tripId !== undefined) {
    const trip = await findTripForBusiness(reader, businessId, body.tripId);
    if (!trip) throw new NotFoundError("No such trip in this business");
  }

  if (body.incidentId !== undefined) {
    const incidentRow = await findIncidentForBusiness(reader, businessId, body.incidentId);
    if (!incidentRow) throw new NotFoundError("No such incident in this business");
  }

  if (body.borneByDriverId !== undefined) {
    const driver = await findDriverForBusiness(reader, businessId, body.borneByDriverId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  }
  if (body.borneByCustomerId !== undefined) {
    const customer = await findCustomerForBusiness(reader, businessId, body.borneByCustomerId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  }

  // GAP-207/NM-5: paidByUserId names whose pocket the cash came from
  // (W-48's paid_by half) and was trusted from the request body outright —
  // the same class of hole GAP-93 already closed for a payment's own
  // partner party.
  if (body.paidByUserId !== undefined) {
    const member = await findBusinessMemberUserId(reader, businessId, body.paidByUserId);
    if (!member) throw new NotFoundError("No such active member in this business");
  }
}

/**
 * The borne-by-resolution ternary `createExpenseHandler` and
 * `replaceExpenseHandler` both ran verbatim: an explicit override wins,
 * otherwise a vehicle defaults through §6.7's matrix, otherwise `us`
 * (INV-24's overhead case). `category`/`vehicleId` typed narrowly rather
 * than against either full request type — both request shapes carry them
 * identically (`expenseCommonFieldsSchema`, packages/shared), and this
 * helper doesn't care which one called it.
 */
async function resolveExpenseBorneBy(
  reader: Reader,
  body: {
    borneBy?: BorneBy | undefined;
    borneByDriverId?: string | undefined;
    borneByCustomerId?: string | undefined;
    vehicleId?: string | undefined;
    category: ExpenseCategory;
  },
  spentOn: BusinessDate,
): Promise<ResolvedBorneBy> {
  if (body.borneBy !== undefined) {
    return {
      borneBy: body.borneBy,
      ...(body.borneByDriverId !== undefined ? { borneByDriverId: body.borneByDriverId } : {}),
      ...(body.borneByCustomerId !== undefined
        ? { borneByCustomerId: body.borneByCustomerId }
        : {}),
    };
  }
  if (body.vehicleId !== undefined) {
    return resolveBorneByDefault(reader, body.vehicleId, body.category, spentOn);
  }
  return { borneBy: "us" };
}

/**
 * The response shape `createExpenseHandler` and `replaceExpenseHandler`
 * both build — identical field for field except `id` (the new row) and
 * `replacesId` (optional/from the body on create; always the path id on
 * replace), which the two callers pass in rather than this function
 * guessing which case it's in.
 */
function buildExpenseResponseBody(
  id: string,
  body: {
    vehicleId?: string | undefined;
    tripId?: string | undefined;
    incidentId?: string | undefined;
    category: ExpenseCategory;
    amountMinor: Minor;
    spentOn: string;
    paidByUserId?: string | undefined;
    litres?: number | undefined;
    odometerReadingKm?: number | undefined;
    odometerSource?: OdometerSource | undefined;
    note?: string | undefined;
  },
  resolved: ResolvedBorneBy,
  odometerReadingId: string | null,
  userId: string,
  replacesId: string | null,
) {
  return {
    id,
    vehicleId: body.vehicleId ?? null,
    tripId: body.tripId ?? null,
    incidentId: body.incidentId ?? null,
    category: body.category,
    amountMinor: toWire(body.amountMinor),
    spentOn: body.spentOn,
    borneBy: resolved.borneBy,
    borneByDriverId: resolved.borneByDriverId ?? null,
    borneByCustomerId: resolved.borneByCustomerId ?? null,
    paidByUserId: body.paidByUserId ?? userId,
    litres: body.litres ?? null,
    odometerReadingId,
    // Copilot review, PR #182: echoed straight from the request that just
    // wrote them — no query needed, unlike the list reads above, which are
    // reconstructing a historical row rather than echoing one just written.
    odometerReadingKm: body.odometerReadingKm ?? null,
    odometerReadingSource: body.odometerSource ?? null,
    note: body.note ?? null,
    replacesId,
  } as const;
}

/**
 * The write-input fields `createExpense`/`replaceExpense` both need beyond
 * their own distinct shape (vehicle/trip/incident linkage plus
 * `businessId`/`replacesId` on create, `businessId`/`expenseId`/`reason` on
 * replace) — `category` through `note`, resolved borne-by included. The two
 * callers each spread this alongside their own remaining fields rather
 * than repeating it.
 */
function buildExpenseWriteFields(
  body: {
    category: ExpenseCategory;
    amountMinor: Minor;
    paidByUserId?: string | undefined;
    litres?: number | undefined;
    odometerReadingKm?: number | undefined;
    odometerSource?: OdometerSource | undefined;
    note?: string | undefined;
  },
  resolved: ResolvedBorneBy,
  spentOn: BusinessDate,
  userId: string,
) {
  return {
    category: body.category,
    amountMinor: body.amountMinor,
    spentOn,
    ...resolved,
    paidByUserId: body.paidByUserId ?? userId,
    actorUserId: userId,
    ...(body.litres !== undefined ? { litres: body.litres } : {}),
    ...(body.odometerReadingKm !== undefined ? { odometerReadingKm: body.odometerReadingKm } : {}),
    ...(body.odometerSource !== undefined ? { odometerSource: body.odometerSource } : {}),
    ...(body.note !== undefined ? { note: body.note } : {}),
  };
}

/** F-3.1/F-3.2/F-3.3. `dailyOperations` (STAFF) — the same capability expenses are already grouped under (`auth/policy.ts`). */
export const createExpenseHandler: RouteHandler<typeof createExpenseRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");
  const spentOn = asBusinessDate(body.spentOn);
  assertNotFutureBusinessDate(c, spentOn, "spentOn");

  await assertExpensePartiesExist(reader, businessId, body);
  const resolved = await resolveExpenseBorneBy(reader, body, spentOn);

  const { expenseId, odometerReadingId } = await createExpense(c.get("writer"), {
    ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}),
    ...(body.tripId !== undefined ? { tripId: body.tripId } : {}),
    ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
    businessId,
    ...buildExpenseWriteFields(body, resolved, spentOn, userId),
    ...(body.replacesId !== undefined ? { replacesId: body.replacesId } : {}),
  });

  return c.json(
    buildExpenseResponseBody(
      expenseId,
      body,
      resolved,
      odometerReadingId,
      userId,
      body.replacesId ?? null,
    ),
    201,
  );
};

/** F-8.5/UC-96. `dailyOperations` (STAFF) — same actor as F-3.1 itself ("Manager"). */
export const voidExpenseHandler: RouteHandler<typeof voidExpenseRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await voidExpense(c.get("writer"), {
    businessId,
    expenseId: id,
    reason: body.reason,
    userId,
  });

  return c.json(result, 200);
};

/**
 * GAP-224/F-8.5. "Edit" on the client — void-and-replace underneath, one
 * request, `dailyOperations` (STAFF) same as create/void. Rejects a target
 * that's already voided (`ExpenseAlreadyVoidedError`, 409) — that row's
 * correction already happened; a second edit on it would replace the
 * replacement without a caller ever seeing which row is actually live.
 */
export const replaceExpenseHandler: RouteHandler<typeof replaceExpenseRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const reader = c.get("reader");
  const spentOn = asBusinessDate(body.spentOn);
  assertNotFutureBusinessDate(c, spentOn, "spentOn");

  await assertExpensePartiesExist(reader, businessId, body);
  const resolved = await resolveExpenseBorneBy(reader, body, spentOn);

  const { id: newExpenseId, odometerReadingId } = await replaceExpense(c.get("writer"), c.env.R2, {
    businessId,
    expenseId: id,
    ...(body.vehicleId !== undefined ? { vehicleId: body.vehicleId } : {}),
    ...(body.tripId !== undefined ? { tripId: body.tripId } : {}),
    ...(body.incidentId !== undefined ? { incidentId: body.incidentId } : {}),
    ...buildExpenseWriteFields(body, resolved, spentOn, userId),
    reason: body.reason,
  });

  return c.json(
    buildExpenseResponseBody(newExpenseId, body, resolved, odometerReadingId, userId, id),
    201,
  );
};

function toListRow(row: BusinessExpenseRow) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    tripId: row.tripId,
    incidentId: row.incidentId,
    category: row.category,
    amountMinor: toWire(row.amountMinor as Minor),
    spentOn: row.spentOn,
    borneBy: row.borneBy,
    borneByDriverId: row.borneByDriverId,
    borneByCustomerId: row.borneByCustomerId,
    paidByUserId: row.paidByUserId,
    litres: row.litres,
    odometerReadingId: row.odometerReadingId,
    odometerReadingKm: row.odometerReadingKm,
    odometerReadingSource: row.odometerReadingSource,
    note: row.note,
    voidedAt: row.voidedAt,
    voidedReason: row.voidedReason,
    replacesId: row.replacesId,
  } as const;
}

/** Web-P8b's costs list (F-3.1). `dailyOperations` (STAFF) — same gate as create. */
export const listExpensesHandler: RouteHandler<typeof listExpensesRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const query = c.req.valid("query");

  const filters: ExpenseFilters = {
    ...(query.vehicleId !== undefined ? { vehicleId: query.vehicleId } : {}),
    ...(query.tripId !== undefined ? { tripId: query.tripId } : {}),
    ...(query.incidentId !== undefined ? { incidentId: query.incidentId } : {}),
    ...(query.category !== undefined ? { category: query.category } : {}),
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
  };

  const rows = await listExpensesForBusiness(c.get("reader"), businessId, filters);
  return c.json(rows.map(toListRow), 200);
};

/** GAP-32/§6.7. `dailyOperations` (STAFF) — same gate as create, the flow this preview feeds. */
export const resolveBorneByHandler: RouteHandler<typeof resolveBorneByRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const { vehicleId, category, spentOn } = c.req.valid("query");
  const reader = c.get("reader");

  const vehicle = await findVehicleForBusiness(reader, businessId, vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");

  const resolved = await resolveBorneByDefault(
    reader,
    vehicleId,
    category,
    asBusinessDate(spentOn),
  );

  return c.json(
    {
      borneBy: resolved.borneBy,
      borneByDriverId: resolved.borneByDriverId ?? null,
      borneByCustomerId: resolved.borneByCustomerId ?? null,
    },
    200,
  );
};

/** GAP-34/U-3. `dailyOperations` (STAFF) — same gate as create, the flow this prefill feeds. */
export const expensePrefillVehicleHandler: RouteHandler<
  typeof expensePrefillVehicleRoute,
  Env
> = async (c) => {
  requireCapability(c, "dailyOperations");
  const businessId = requireBusinessId(c);
  const today = businessToday(requireBusinessTimezone(c));

  const pending = await findVehicleWithOldestUnconfirmedDay(c.get("reader"), businessId, today);

  return c.json({ vehicleId: pending?.vehicleId ?? null }, 200);
};
