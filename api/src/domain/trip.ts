import { addDays, newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { OdometerSource } from "@fleetsettle/shared/schemas";
import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  PeriodClosedError,
  TripAdvanceUnsettledError,
  ValidationError,
  VehicleDoubleBookedError,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { pauseDayRecordsForTrip, resumeDayRecordsForTrip } from "../queries/day-record.js";
import {
  findUnsettledAdvancesForTrip,
  insertAdvanceSettlement,
  sumSettledForAdvance,
  updateAdvanceStatus,
} from "../queries/driver-money.js";
import { sumTripCostsByCategory, sumTripFuelLitres } from "../queries/expense.js";
import { insertObligation, voidObligationBySource } from "../queries/obligation.js";
import {
  findOdometerReadingForBusiness,
  insertOdometerReading,
} from "../queries/odometer-reading.js";
import {
  cancelTripRow,
  closeTripRow,
  deleteAllocationDaysForTrip,
  insertAllocationDays,
  insertTrip,
  type TripRow,
} from "../queries/trip.js";

export interface BookTripInput {
  businessId: string;
  vehicleId: string;
  customerId?: string;
  driverId?: string;
  startDate: BusinessDate;
  endDate: BusinessDate;
  /** GAP-23/A6: the fact being posted is the booking, not the trip's own dates — supplied by the handler from `businessToday()`, never `new Date()`. */
  bookingDate: BusinessDate;
  destination?: string;
  agreedAmountMinor: Minor;
  driverFeeMinor: Minor;
  openingOdometerKm?: number;
  openingOdometerSource?: OdometerSource;
}

export interface BookedTrip {
  tripId: string;
  /** GAP-57: the `trip_fare` obligation's own id, when one was raised — `null` for a charter with no customer or a zero agreed amount, the same guard that decides whether to write one at all. */
  receivableId: string | null;
}

/** Every day in `[start, end]`, inclusive of both ends (W-54) — never open-ended, unlike a lease's horizon. */
function dateRange(start: BusinessDate, end: BusinessDate): BusinessDate[] {
  const dates: BusinessDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

/**
 * F-5.1 / UC-20, one transaction: the `trip` row, its full-range
 * `vehicle_day_allocation` (DM §4.1: a trip's allocation is always written in
 * full at booking, unlike a lease or daily lease's rolling horizon), any
 * existing `day_record` rows in range moving to `paused_for_trip` — "a
 * future trip has no day records to pause" (F-5.1's own trap): a charter
 * booked beyond the rolling horizon has nothing to update here, and P13's
 * card generation later finds the date already allocated and creates no
 * card at all, which is the *other* half of the same mechanism, not a bug in
 * this one — and, when there is a customer and an agreed amount, a
 * `trip_fare` `obligation` (GAP-23/A6). INV-1 — "the car cannot also be on a
 * monthly rental for those dates" — is the `one_arrangement_per_vehicle_day`
 * unique index, not a pre-check; a violation is caught here and mapped to
 * 409.
 *
 * GAP-23/A6 made this endpoint period-dependent for the first time, but
 * only when there is actually money to post: a charter with a customer and
 * a nonzero agreed amount needs a `posted_period_id` for its `obligation`,
 * so booking one now 409s `PERIOD_CLOSED` when no accounting period is
 * open, exactly as `closeTrip`/`recordPayment` already do — an owner-driven
 * charter with no customer touches no period-scoped table at all (the
 * allocation and pause above carry no `posted_period_id`) and is refused
 * nothing new. `resolvePeriodLinkage` is resolved off `input.bookingDate`
 * (today, per W-35) — the trip's own `startDate`/`endDate` only ever decide
 * `belongs_to_period_id`, never `posted_period_id`; booking is the fact
 * being posted, not the trip's travel dates. `due_on`/`effective_due_on` on
 * the obligation are the trip's `endDate` — the charter's fare falls due
 * once the trip is over, not the day it was booked.
 */
export async function bookTrip(writer: Writer, input: BookTripInput): Promise<BookedTrip> {
  try {
    return await writer.transaction(async (tx) => {
      const tripId = newId();

      let openingOdometerId: string | undefined;
      if (input.openingOdometerKm !== undefined && input.openingOdometerSource !== undefined) {
        openingOdometerId = newId();
        await insertOdometerReading(tx, {
          id: openingOdometerId,
          businessId: input.businessId,
          vehicleId: input.vehicleId,
          readingKm: input.openingOdometerKm,
          readOn: input.startDate,
          source: input.openingOdometerSource,
          tripId,
        });
      }

      await insertTrip(tx, {
        id: tripId,
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
        ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
        status: "booked",
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.destination !== undefined ? { destination: input.destination } : {}),
        agreedAmountMinor: input.agreedAmountMinor,
        driverFeeMinor: input.driverFeeMinor,
        ...(openingOdometerId !== undefined ? { openingOdometerId } : {}),
      });

      const days = dateRange(input.startDate, input.endDate).map((businessDate) => ({
        id: newId(),
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        businessDate,
        arrangement: "C" as const,
        sourceType: "trip" as const,
        sourceId: tripId,
      }));
      await insertAllocationDays(tx, days);

      await pauseDayRecordsForTrip(tx, input.vehicleId, input.startDate, input.endDate, tripId);

      let receivableId: string | null = null;
      if (input.customerId !== undefined && input.agreedAmountMinor > 0n) {
        const linkage = await resolvePeriodLinkage(tx, input.businessId, input.bookingDate);
        if (!linkage) {
          throw new PeriodClosedError("No accounting period covers this business date yet");
        }

        receivableId = newId();
        await insertObligation(tx, {
          id: receivableId,
          businessId: input.businessId,
          direction: "owed_to_us",
          partyType: "customer",
          partyCustomerId: input.customerId,
          kind: "trip_fare",
          sourceType: "trip",
          sourceId: tripId,
          vehicleId: input.vehicleId,
          amountMinor: input.agreedAmountMinor,
          settledMinor: 0n,
          waivedMinor: 0n,
          dueOn: input.endDate,
          effectiveDueOn: input.endDate,
          status: "pending",
          postedPeriodId: linkage.postedPeriodId,
          ...(linkage.belongsToPeriodId !== null
            ? { belongsToPeriodId: linkage.belongsToPeriodId }
            : {}),
        });
      }

      return { tripId, receivableId };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "one_arrangement_per_vehicle_day")) {
      throw new VehicleDoubleBookedError();
    }
    throw err;
  }
}

export interface CloseTripInput {
  businessId: string;
  trip: TripRow;
  closingDate: BusinessDate;
  closingOdometerKm?: number;
  closingOdometerSource?: OdometerSource;
}

export interface ClosedTripCostByCategory {
  category: string;
  amountMinor: Minor;
}

export interface ClosedTrip {
  id: string;
  status: "closed";
  closingDate: BusinessDate;
  incomeMinor: Minor;
  costsMinor: Minor;
  costsByCategory: ClosedTripCostByCategory[];
  driverFeeMinor: Minor;
  profitMinor: Minor;
  distanceKm: number | null;
  litres: number | null;
  kmPerLitre: number | null;
}

/** The odometer reading's own `reading_km`, or `null` when there is no reading to look up — never a stand-in figure (W-56). */
async function readingKmFor(
  db: Parameters<typeof findOdometerReadingForBusiness>[0],
  businessId: string,
  odometerId: string | null,
): Promise<number | null> {
  if (odometerId === null) return null;
  const row = await findOdometerReadingForBusiness(db, businessId, odometerId);
  return row?.readingKm ?? null;
}

/**
 * F-5.4/UC-44's P&L, read fresh every time — on the first close it reflects
 * what is about to be written; on a replay of an already-`closed` trip
 * (below) it is simply read again, since costs/litres come from `expense`
 * rows that do not change after the fact.
 */
async function buildTripPnL(
  db: Parameters<typeof findOdometerReadingForBusiness>[0],
  businessId: string,
  trip: TripRow,
  closingOdometerId: string | null,
): Promise<Omit<ClosedTrip, "id" | "status" | "closingDate">> {
  const costRows = await sumTripCostsByCategory(db, trip.id);
  const costsByCategory = costRows.map((row) => ({
    category: row.category,
    amountMinor: row.amountMinor as Minor,
  }));
  const costsMinor = costRows.reduce((sum, row) => sum + row.amountMinor, 0n) as Minor;
  const litres = await sumTripFuelLitres(db, trip.id);

  const openingKm = await readingKmFor(db, businessId, trip.openingOdometerId);
  const closingKm = await readingKmFor(db, businessId, closingOdometerId);
  const distanceKm = openingKm !== null && closingKm !== null ? closingKm - openingKm : null;

  const kmPerLitre =
    distanceKm !== null && litres !== null && litres > 0 ? distanceKm / litres : null;

  return {
    incomeMinor: trip.agreedAmountMinor as Minor,
    costsMinor,
    costsByCategory,
    driverFeeMinor: trip.driverFeeMinor as Minor,
    profitMinor: (trip.agreedAmountMinor - costsMinor - trip.driverFeeMinor) as Minor,
    distanceKm,
    litres,
    kmPerLitre,
  };
}

/**
 * F-5.4/UC-44, one transaction: the closing odometer reading (when taken),
 * the driver-fee `obligation` (owed_by_us — UC-70's cost query keys off
 * `posted_period_id` and `kind='driver_fee'`, so this must land at close,
 * never at booking, per W-41/INV-30), and the `trip` row itself moving to
 * `closed` with the period it recognises in.
 *
 * INV-17: an unreconciled advance blocks this unconditionally — there is no
 * disposition parameter here the way F-5.5's cancel has one, because F-6.3's
 * settle-advance flow is the only sanctioned way to clear it first.
 *
 * Idempotent on the trip's own `status`, not a DB constraint (unlike
 * confirmDay/mileage/billing-period): a trip already `closed` is read back
 * and returned rather than re-closed, so a double-submit cannot double-post
 * the driver-fee obligation. A genuine concurrent double-close (two requests
 * both observing `booked`) is not additionally guarded against here — the
 * same accepted, documented race billing-period's own idempotent wrapper
 * describes, not a gap specific to this function.
 */
export async function closeTrip(writer: Writer, input: CloseTripInput): Promise<ClosedTrip> {
  const { trip } = input;

  if (trip.status === "cancelled") {
    throw new ValidationError("A cancelled trip cannot be closed");
  }

  if (trip.status === "closed") {
    const pnl = await buildTripPnL(writer, input.businessId, trip, trip.closingOdometerId);
    return {
      id: trip.id,
      status: "closed",
      // A closed trip's own CHECK constraint (INV-30) guarantees this is set.
      closingDate: trip.closingDate as BusinessDate,
      ...pnl,
    };
  }

  try {
    return await writer.transaction(async (tx) => {
      const unsettled = await findUnsettledAdvancesForTrip(tx, trip.id);
      if (unsettled.length > 0) {
        throw new TripAdvanceUnsettledError(
          "An advance against this trip must be settled (F-6.3) before it can be closed",
        );
      }

      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.closingDate);
      if (!linkage) {
        throw new PeriodClosedError("No accounting period covers this business date yet");
      }

      let closingOdometerId: string | null = null;
      if (input.closingOdometerKm !== undefined && input.closingOdometerSource !== undefined) {
        closingOdometerId = newId();
        await insertOdometerReading(tx, {
          id: closingOdometerId,
          businessId: input.businessId,
          vehicleId: trip.vehicleId,
          readingKm: input.closingOdometerKm,
          readOn: input.closingDate,
          source: input.closingOdometerSource,
          tripId: trip.id,
        });
      }

      if (trip.driverId !== null && trip.driverFeeMinor > 0n) {
        await insertObligation(tx, {
          id: newId(),
          businessId: input.businessId,
          direction: "owed_by_us",
          partyType: "driver",
          partyDriverId: trip.driverId,
          kind: "driver_fee",
          sourceType: "trip",
          sourceId: trip.id,
          vehicleId: trip.vehicleId,
          amountMinor: trip.driverFeeMinor,
          settledMinor: 0n,
          waivedMinor: 0n,
          dueOn: input.closingDate,
          effectiveDueOn: input.closingDate,
          status: "pending",
          postedPeriodId: linkage.postedPeriodId,
          ...(linkage.belongsToPeriodId !== null
            ? { belongsToPeriodId: linkage.belongsToPeriodId }
            : {}),
        });
      }

      await closeTripRow(tx, trip.id, {
        closingDate: input.closingDate,
        ...(closingOdometerId !== null ? { closingOdometerId } : {}),
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      });

      const pnl = await buildTripPnL(tx, input.businessId, trip, closingOdometerId);
      return { id: trip.id, status: "closed" as const, closingDate: input.closingDate, ...pnl };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface CancelTripInput {
  businessId: string;
  trip: TripRow;
  cancelledOn: BusinessDate;
  /** GAP-23/A6: attributes the trip_fare obligation's void, the same way any other void names who did it. */
  userId: string;
  cancelReason?: string;
  advanceDisposition?: "refunded" | "retained";
}

export interface CancelledTrip {
  id: string;
  status: "cancelled";
  cancelReason: string | null;
  advanceDisposition: "refunded" | "retained" | null;
}

/**
 * F-5.5/UC-45, one transaction: any unsettled advance against the trip
 * reconciled one way or the other (a `spent` disposition makes no sense on
 * cancellation, so only `returned`/`kept_as_fee` apply here), any
 * `trip_fare` obligation this booking raised voided (GAP-23/A6 — a
 * cancelled charter owes nothing), the daily arrangement's day records
 * resumed, the trip's own `vehicle_day_allocation` rows freed, and the trip
 * itself moving to `cancelled` — never touching `posted_period_id` (only a
 * close ever recognises a trip into a period). Costs already incurred stay
 * exactly where they are: `expense` rows keyed to this trip are never
 * voided by a cancellation.
 *
 * Idempotent on the trip's own `status`, the same pattern `closeTrip` uses:
 * a trip already `cancelled` is read back rather than re-cancelled, so a
 * double-submit cannot double-settle the same advance or re-void an
 * already-voided obligation. `voidObligationBySource` is itself a no-op —
 * 0 rows, not an error — for a charter that never raised one (no customer,
 * or a zero agreed amount).
 *
 * The void is subject to A9a's rule (migration 0008): cancelling a trip
 * booked in a now-closed accounting period 409s `PERIOD_CLOSED`, because
 * voiding a receivable changes that closed month's own figures — the same
 * reason A9a had to land before this item could.
 */
export async function cancelTrip(writer: Writer, input: CancelTripInput): Promise<CancelledTrip> {
  const { trip } = input;

  if (trip.status === "cancelled") {
    return {
      id: trip.id,
      status: "cancelled",
      cancelReason: trip.cancelReason,
      advanceDisposition: trip.advanceDisposition,
    };
  }

  if (trip.status === "closed") {
    throw new ValidationError("A closed trip cannot be cancelled");
  }

  try {
    return await writer.transaction(async (tx) => {
      const unsettled = await findUnsettledAdvancesForTrip(tx, trip.id);

      if (unsettled.length > 0) {
        if (input.advanceDisposition === undefined) {
          throw new TripAdvanceUnsettledError(
            "An advance against this trip needs a disposition (refunded or retained) before it can be cancelled",
          );
        }

        const linkage = await resolvePeriodLinkage(tx, input.businessId, input.cancelledOn);
        if (!linkage) {
          throw new PeriodClosedError("No accounting period covers this business date yet");
        }

        const kind = input.advanceDisposition === "refunded" ? "returned" : "kept_as_fee";
        for (const advance of unsettled) {
          const alreadySettled = await sumSettledForAdvance(tx, advance.id);
          const outstanding = advance.amountMinor - alreadySettled;
          if (outstanding > 0n) {
            await insertAdvanceSettlement(tx, {
              id: newId(),
              businessId: input.businessId,
              advanceId: advance.id,
              kind,
              amountMinor: outstanding,
              occurredOn: input.cancelledOn,
              postedPeriodId: linkage.postedPeriodId,
              ...(linkage.belongsToPeriodId !== null
                ? { belongsToPeriodId: linkage.belongsToPeriodId }
                : {}),
            });
          }
          await updateAdvanceStatus(tx, advance.id, "settled");
        }
      }

      await voidObligationBySource(tx, "trip", trip.id, {
        voidedReason: input.cancelReason ?? "Trip cancelled",
        voidedBy: input.userId,
      });

      await resumeDayRecordsForTrip(tx, trip.id);
      await deleteAllocationDaysForTrip(tx, trip.id);
      await cancelTripRow(tx, trip.id, {
        ...(input.cancelReason !== undefined ? { cancelReason: input.cancelReason } : {}),
        ...(input.advanceDisposition !== undefined
          ? { advanceDisposition: input.advanceDisposition }
          : {}),
      });

      return {
        id: trip.id,
        status: "cancelled" as const,
        cancelReason: input.cancelReason ?? null,
        advanceDisposition: input.advanceDisposition ?? null,
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
