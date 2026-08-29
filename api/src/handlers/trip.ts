import { businessToday, toWire, ZERO, type BusinessDate, type Minor } from "@fleetsettle/shared";
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
  confirmTripHold,
  deriveTripStatus,
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
  confirmTripHoldRoute,
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
  | "holdExpiresOn"
>;

/** GAP-57: `null` for a charter with no customer, no agreed amount, or a cancelled trip (`findObligationBySource` excludes a voided one). */
function toReceivable(row: ObligationRow | null | undefined) {
  if (row === null || row === undefined) return null;
  return {
    id: row.id,
    kind: row.kind,
    dueOn: row.dueOn,
    effectiveDueOn: row.effectiveDueOn,
    amountMinor: toWire(row.amountMinor as Minor),
    settledMinor: toWire(row.settledMinor as Minor),
    waivedMinor: toWire(row.waivedMinor as Minor),
    status: row.status,
  };
}

/** GAP-7/ST-5: `status` is derived against `today` here, at the one seam every trip read passes through — a stored `booked` row reads as `in_progress` once its own dates have started, never written that way. */
function toResponse(row: TripResponseRow, receivable: ObligationRow | null, today: BusinessDate) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    customerId: row.customerId,
    driverId: row.driverId,
    status: deriveTripStatus(row, today),
    startDate: row.startDate,
    endDate: row.endDate,
    destination: row.destination,
    agreedAmountMinor: toWire(row.agreedAmountMinor as Minor),
    driverFeeMinor: toWire(row.driverFeeMinor as Minor),
    closingDate: row.closingDate,
    cancelReason: row.cancelReason,
    advanceDisposition: row.advanceDisposition,
    holdExpiresOn: row.holdExpiresOn,
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
  // GAP-158, reversing GAP-87: F-5.1 carries no `Pre` on arrangement at
  // all, unlike F-2.1/F-1.7 — a trip is arbitrated by occupancy on the
  // requested dates (INV-1), never by the vehicle's own current
  // classification. A car genuinely out on a monthly lease for these dates
  // already has allocation rows there and is refused below by the real
  // check — `one_arrangement_per_vehicle_day` via `buildDoubleBookedError`
  // — with a better error than a bare arrangement mismatch ever gave.
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

  const { tripId, status, holdExpiresOn, receivableId, receivableSettledMinor, receivableStatus } =
    await bookTrip(c.get("writer"), {
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
      ...(body.openingOdometerKm !== undefined
        ? { openingOdometerKm: body.openingOdometerKm }
        : {}),
      ...(body.openingOdometerSource !== undefined
        ? { openingOdometerSource: body.openingOdometerSource }
        : {}),
      userId: requireUserId(c),
      asHold: body.asHold,
    });

  // GAP-57: mirrors exactly what `bookTrip` just wrote in the same
  // transaction — never re-derived from a second guard that could drift
  // from the one that decided whether to insert the row at all. GAP-5b:
  // settledMinor/status come from bookTrip's own return, not a hardcoded
  // "just raised, nothing settled" — a customer's own unapplied credit can
  // settle this fare on the spot, and reporting "pending" regardless would
  // be exactly the confident-wrong-number W-56 exists to prevent.
  const receivable: ObligationRow | null =
    receivableId !== null
      ? {
          id: receivableId,
          kind: "trip_fare",
          dueOn: body.endDate,
          effectiveDueOn: body.endDate,
          amountMinor: agreedAmountMinor,
          settledMinor: receivableSettledMinor ?? 0n,
          waivedMinor: 0n,
          status: receivableStatus ?? "pending",
        }
      : null;

  return c.json(
    toResponse(
      {
        id: tripId,
        vehicleId: body.vehicleId,
        customerId: body.customerId ?? null,
        driverId: body.driverId ?? null,
        status,
        startDate: body.startDate,
        endDate: body.endDate,
        destination: body.destination ?? null,
        agreedAmountMinor,
        driverFeeMinor,
        closingDate: null,
        cancelReason: null,
        advanceDisposition: null,
        holdExpiresOn,
      },
      receivable,
      bookingDate,
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

  const receivable =
    (await findObligationBySource(c.get("reader"), "trip", id, "trip_fare", "owed_to_us")) ?? null;

  return c.json(toResponse(row, receivable, businessToday(requireBusinessTimezone(c))), 200);
};

/** ST-5/GAP-7. `confirmTripHold` (domain/trip.ts) is the write; this is validation and translation only. */
export const confirmTripHoldHandler: RouteHandler<typeof confirmTripHoldRoute, Env> = async (c) => {
  requireCapability(c, "leaseAndTripLifecycle");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");
  const confirmedOn = businessToday(requireBusinessTimezone(c));

  const trip = await findTripForBusiness(c.get("reader"), businessId, id);
  if (!trip) throw new NotFoundError();

  const { receivableId, receivableSettledMinor, receivableStatus } = await confirmTripHold(
    c.get("writer"),
    { businessId, trip, confirmedOn },
  );

  const receivable: ObligationRow | null =
    receivableId !== null
      ? {
          id: receivableId,
          kind: "trip_fare",
          dueOn: trip.endDate,
          effectiveDueOn: trip.endDate,
          amountMinor: trip.agreedAmountMinor,
          settledMinor: receivableSettledMinor ?? 0n,
          waivedMinor: 0n,
          status: receivableStatus ?? "pending",
        }
      : null;

  return c.json(
    toResponse({ ...trip, status: "booked", holdExpiresOn: null }, receivable, confirmedOn),
    200,
  );
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
    today: cancelledOn,
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
