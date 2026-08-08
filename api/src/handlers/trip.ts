import { businessToday, toWire, ZERO, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import {
  requireBusinessId,
  requireBusinessTimezone,
  requireCapability,
  requireUserId,
} from "../auth/context.js";
import {
  bookTrip,
  cancelTrip,
  closeTrip,
  type CancelledTrip,
  type ClosedTrip,
} from "../domain/trip.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { listExpensesForTrip } from "../queries/expense.js";
import { findObligationBySource, type ObligationRow } from "../queries/obligation.js";
import {
  findTripForBusiness,
  listInProgressTripsForBusiness,
  type TripRow,
} from "../queries/trip.js";
import { findVehicleForBusiness } from "../queries/vehicle.js";
import { NotFoundError } from "../errors/app-error.js";
import type {
  bookTripRoute,
  cancelTripRoute,
  closeTripRoute,
  getTripRoute,
  listInProgressTripsRoute,
  listTripExpensesRoute,
} from "../route-defs/trip.js";
import type { Env } from "../types.js";

type TripResponseRow = Pick<
  TripRow,
  | "id"
  | "vehicleId"
  | "customerId"
  | "driverId"
  | "status"
  | "startDate"
  | "endDate"
  | "destination"
  | "agreedAmountMinor"
  | "driverFeeMinor"
  | "closingDate"
  | "cancelReason"
  | "advanceDisposition"
>;

/** GAP-57: `null` for a charter with no customer, no agreed amount, or a cancelled trip (`findObligationBySource` excludes a voided one). */
function toReceivable(row: ObligationRow | null | undefined) {
  if (row === null || row === undefined) return null;
  return {
    id: row.id,
    kind: row.kind,
    dueOn: row.dueOn,
    amountMinor: toWire(row.amountMinor as Minor),
    settledMinor: toWire(row.settledMinor as Minor),
    waivedMinor: toWire(row.waivedMinor as Minor),
    status: row.status,
  };
}

function toResponse(row: TripResponseRow, receivable: ObligationRow | null) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    customerId: row.customerId,
    driverId: row.driverId,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    destination: row.destination,
    agreedAmountMinor: toWire(row.agreedAmountMinor as Minor),
    driverFeeMinor: toWire(row.driverFeeMinor as Minor),
    closingDate: row.closingDate,
    cancelReason: row.cancelReason,
    advanceDisposition: row.advanceDisposition,
    receivable: toReceivable(receivable),
  };
}

function toClosedResponse(result: ClosedTrip) {
  return {
    id: result.id,
    status: result.status,
    closingDate: result.closingDate,
    incomeMinor: toWire(result.incomeMinor),
    costsMinor: toWire(result.costsMinor),
    costsByCategory: result.costsByCategory.map((row) => ({
      category: row.category,
      amountMinor: toWire(row.amountMinor),
    })),
    driverFeeMinor: toWire(result.driverFeeMinor),
    profitMinor: toWire(result.profitMinor),
    distanceKm: result.distanceKm,
    litres: result.litres,
    kmPerLitre: result.kmPerLitre,
  };
}

function toCancelledResponse(result: CancelledTrip) {
  return {
    id: result.id,
    status: result.status,
    cancelReason: result.cancelReason,
    advanceDisposition: result.advanceDisposition,
  };
}

/** F-5.1 / UC-20. `leaseAndTripLifecycle` (STAFF) — the same capability that gates closing one. */
export const bookTripHandler: RouteHandler<typeof bookTripRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");
  const bookingDate = businessToday(requireBusinessTimezone(c));

  const vehicle = await findVehicleForBusiness(reader, businessId, body.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");
  if (body.customerId !== undefined) {
    const customer = await findCustomerForBusiness(reader, businessId, body.customerId);
    if (!customer) throw new NotFoundError("No such customer in this business");
  }
  if (body.driverId !== undefined) {
    const driver = await findDriverForBusiness(reader, businessId, body.driverId);
    if (!driver) throw new NotFoundError("No such driver in this business");
  }

  const agreedAmountMinor = body.agreedAmountMinor ?? ZERO;
  const driverFeeMinor = body.driverFeeMinor ?? ZERO;

  const { tripId, receivableId } = await bookTrip(c.get("writer"), {
    businessId,
    vehicleId: body.vehicleId,
    ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
    ...(body.driverId !== undefined ? { driverId: body.driverId } : {}),
    startDate: body.startDate,
    endDate: body.endDate,
    bookingDate,
    ...(body.destination !== undefined ? { destination: body.destination } : {}),
    agreedAmountMinor,
    driverFeeMinor,
    ...(body.openingOdometerKm !== undefined ? { openingOdometerKm: body.openingOdometerKm } : {}),
    ...(body.openingOdometerSource !== undefined
      ? { openingOdometerSource: body.openingOdometerSource }
      : {}),
  });

  // GAP-57: mirrors exactly what `bookTrip` just wrote in the same
  // transaction — never re-derived from a second guard that could drift
  // from the one that decided whether to insert the row at all.
  const receivable: ObligationRow | null =
    receivableId !== null
      ? {
          id: receivableId,
          kind: "trip_fare",
          dueOn: body.endDate,
          amountMinor: agreedAmountMinor,
          settledMinor: 0n,
          waivedMinor: 0n,
          status: "pending",
        }
      : null;

  return c.json(
    toResponse(
      {
        id: tripId,
        vehicleId: body.vehicleId,
        customerId: body.customerId ?? null,
        driverId: body.driverId ?? null,
        status: "booked",
        startDate: body.startDate,
        endDate: body.endDate,
        destination: body.destination ?? null,
        agreedAmountMinor,
        driverFeeMinor,
        closingDate: null,
        cancelReason: null,
        advanceDisposition: null,
      },
      receivable,
    ),
    201,
  );
};

export const getTripHandler: RouteHandler<typeof getTripRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findTripForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  const receivable = (await findObligationBySource(c.get("reader"), "trip", id)) ?? null;

  return c.json(toResponse(row, receivable), 200);
};

/** Web-P7: the open-trip screen's own "Costs so far" — same `leaseAndTripLifecycle` gate as this resource's other reads. */
export const listTripExpensesHandler: RouteHandler<typeof listTripExpensesRoute, Env> = async (
  c,
) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const trip = await findTripForBusiness(c.get("reader"), businessId, id);
  if (!trip) throw new NotFoundError();

  const rows = await listExpensesForTrip(c.get("reader"), id);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicleId,
      tripId: id,
      incidentId: row.incidentId,
      category: row.category,
      amountMinor: toWire(row.amountMinor as Minor),
      spentOn: row.spentOn,
      borneBy: row.borneBy,
      borneByDriverId: row.borneByDriverId,
      borneByCustomerId: row.borneByCustomerId,
      paidByUserId: row.paidByUserId,
      litres: row.litres,
      note: row.note,
      voidedAt: row.voidedAt,
      voidedReason: row.voidedReason,
    })),
    200,
  );
};

/** F-5.4/UC-44. `closeTrip` (domain/trip.ts) is the write; this is validation and translation only. */
export const closeTripHandler: RouteHandler<typeof closeTripRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const trip = await findTripForBusiness(c.get("reader"), businessId, id);
  if (!trip) throw new NotFoundError();

  const result = await closeTrip(c.get("writer"), {
    businessId,
    trip,
    closingDate: body.closingDate,
    ...(body.closingOdometerKm !== undefined ? { closingOdometerKm: body.closingOdometerKm } : {}),
    ...(body.closingOdometerSource !== undefined
      ? { closingOdometerSource: body.closingOdometerSource }
      : {}),
  });

  return c.json(toClosedResponse(result), 200);
};

/** F-5.5/UC-45. `cancelTrip` (domain/trip.ts) resumes the daily arrangement and settles any open advance. */
export const cancelTripHandler: RouteHandler<typeof cancelTripRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const cancelledOn = businessToday(requireBusinessTimezone(c));
  const userId = requireUserId(c);

  const trip = await findTripForBusiness(c.get("reader"), businessId, id);
  if (!trip) throw new NotFoundError();

  const result = await cancelTrip(c.get("writer"), {
    businessId,
    trip,
    cancelledOn,
    userId,
    ...(body.cancelReason !== undefined ? { cancelReason: body.cancelReason } : {}),
    ...(body.advanceDisposition !== undefined
      ? { advanceDisposition: body.advanceDisposition }
      : {}),
  });

  return c.json(toCancelledResponse(result), 200);
};

/** Home item 7 (UI §3.2). Same `leaseAndTripLifecycle` gate as this resource's other endpoints. */
export const listInProgressTripsHandler: RouteHandler<
  typeof listInProgressTripsRoute,
  Env
> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");
  const businessId = requireBusinessId(c);

  const rows = await listInProgressTripsForBusiness(c.get("reader"), businessId);

  return c.json(
    rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicleId,
      vehicleRegistration: r.vehicleRegistration,
      customerId: r.customerId,
      customerName: r.customerName,
      driverId: r.driverId,
      driverName: r.driverName,
      startDate: r.startDate,
      endDate: r.endDate,
      destination: r.destination,
    })),
    200,
  );
};
