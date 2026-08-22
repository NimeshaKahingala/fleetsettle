import {
  addDays,
  asBusinessDate,
  newId,
  type BusinessDate,
  type Minor,
  type VehicleDoubleBookedDetails,
} from "@fleetsettle/shared";
import type { OdometerSource } from "@fleetsettle/shared/schemas";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  PeriodClosedError,
  TripAdvanceUnsettledError,
  ValidationError,
  VehicleDoubleBookedError,
} from "../errors/app-error.js";
import { findOpenPeriodRow, resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findBusinessSettings } from "../queries/business.js";
import { findCustomerForBusiness } from "../queries/customer.js";
import { applyCreditForward } from "./credit-forward.js";
import { HORIZON_DAYS, materializeDailyLeaseHorizon } from "./day-card-generation.js";
import {
  findCurrentDailyLeaseRowForVehicle,
  findDailyLeaseForBusiness,
  listDailyLeaseRatesForLease,
} from "../queries/dailyLease.js";
import { findDriverForBusiness } from "../queries/driver.js";
import { findLeaseForBusiness, findLeaseOverlappingRange } from "../queries/lease.js";
import { findVehicleCalendar } from "../queries/vehicle.js";
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
  clearHoldOnAllocationDaysForTrip,
  closeTripRow,
  confirmTripHoldRow,
  deleteAllocationDaysForTrip,
  findTripForBusiness,
  insertAllocationDays,
  insertTrip,
  releaseDailyLeaseAllocationsForRange,
  releaseExpiredHolds,
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
  /** GAP-119: attributed on the daily lease's released allocations the same way any other void names who did it. */
  userId: string;
  /** F-5.1 step 4/ST-5: "Confirm → booked, or hold if the enquiry is tentative." Defaults to `false` — a hold is an explicit choice, never the fallback, so an old client that has never heard of holds keeps booking outright. */
  asHold?: boolean;
}

export interface BookedTrip {
  tripId: string;
  status: "hold" | "booked";
  /** GAP-7/D-13: the hold's own expiry, `null` for a booked trip. */
  holdExpiresOn: string | null;
  /** GAP-57: the `trip_fare` obligation's own id, when one was raised — `null` for a charter with no customer or a zero agreed amount, the same guard that decides whether to write one at all, and always `null` for a hold (F-5.1's Accept: tentative, nothing owed yet). */
  receivableId: string | null;
  /** GAP-5b: the receivable's real settled amount and status after credit-forward — `null` alongside `receivableId` when none was raised. `0n`/`"pending"` when raised but the customer carried no credit to draw on. */
  receivableSettledMinor: bigint | null;
  receivableStatus: "pending" | "part_paid" | "paid" | "waived" | null;
}

interface TripFareObligationInput {
  businessId: string;
  tripId: string;
  vehicleId: string;
  customerId: string;
  agreedAmountMinor: Minor;
  /** W-35: the date the fact is posted, not the trip's own dates — the booking date for a booked trip, the confirmation date for a just-confirmed hold. */
  postingDate: BusinessDate;
  dueOn: BusinessDate;
}

interface TripFareObligationResult {
  receivableId: string;
  receivableSettledMinor: bigint;
  receivableStatus: "pending" | "part_paid" | "paid" | "waived";
}

/**
 * GAP-23/A6's `trip_fare` obligation plus GAP-5b's credit-forward, shared by
 * `bookTrip`'s own booked path and `confirmTripHold` below — a hold's
 * "nothing owed yet" (F-5.1 Accept) means this fires exactly once per trip,
 * whichever of the two writes it, and the two must never diverge on how a
 * fare becomes a receivable.
 */
async function postTripFareObligation(
  tx: Tx,
  input: TripFareObligationInput,
): Promise<TripFareObligationResult> {
  const linkage = await resolvePeriodLinkage(tx, input.businessId, input.postingDate);
  if (!linkage) {
    throw new PeriodClosedError("No accounting period covers this business date yet");
  }

  const receivableId = newId();
  await insertObligation(tx, {
    id: receivableId,
    businessId: input.businessId,
    direction: "owed_to_us",
    partyType: "customer",
    partyCustomerId: input.customerId,
    kind: "trip_fare",
    sourceType: "trip",
    sourceId: input.tripId,
    vehicleId: input.vehicleId,
    amountMinor: input.agreedAmountMinor,
    settledMinor: 0n,
    waivedMinor: 0n,
    dueOn: input.dueOn,
    effectiveDueOn: input.dueOn,
    status: "pending",
    postedPeriodId: linkage.postedPeriodId,
    ...(linkage.belongsToPeriodId !== null ? { belongsToPeriodId: linkage.belongsToPeriodId } : {}),
  });

  const credit = await applyCreditForward(
    tx,
    input.businessId,
    "customer",
    input.customerId,
    "owed_to_us",
    receivableId,
    input.agreedAmountMinor,
    input.dueOn,
  );

  return {
    receivableId,
    receivableSettledMinor: credit.settledMinor,
    receivableStatus: credit.status,
  };
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
 *
 * GAP-119/D-12 (data-model.md §4.1): a vehicle already on a daily lease can
 * still take this charter — "the daily-lease allocation row is REPLACED by
 * the trip's," not refused. `releaseDailyLeaseAllocationsForRange` frees the
 * daily lease's own occupancy for exactly this range *before* the trip's own
 * `insertAllocationDays` below, so the two never collide on
 * `one_arrangement_per_vehicle_day` in the first place; `cancelTrip`
 * re-materialises whatever the vehicle's current daily lease would have
 * occupied, undoing this release rather than leaving a permanent hole.
 *
 * GAP-7/ST-5: `input.asHold` reserves the calendar (the same allocation
 * write, with `isHold: true`) but takes neither of the two "this is real now"
 * steps above — the day-record pause and the `trip_fare` obligation both
 * wait for `confirmTripHold`, per F-5.1's own Accept clause ("a hold…does
 * not suppress daily cards"). Before either branch runs, this vehicle's own
 * expired holds are released synchronously, never only by the nightly sweep.
 */
// GAP-44: how far past the requested range this looks for a free block of
// the same length. Generous on purpose — a heavily-booked vehicle is
// exactly the case a short window would fail silently on (`nextFreeFrom`
// staying `null` when a real gap exists just past it).
const DOUBLE_BOOKED_LOOKAHEAD_DAYS = 180;

/**
 * GAP-44: turns a bare `one_arrangement_per_vehicle_day` violation into the
 * enriched `VehicleDoubleBookedError` the client actually renders — the
 * conflicting entity (named, not just "occupied"), the dates it holds, and
 * the next date this same request would fit. Runs *after* `bookTrip`'s own
 * transaction has already rolled back, on `writer` directly rather than the
 * dead `tx` — a plain best-effort read, never itself money-writing, so it
 * has no transaction of its own to join.
 *
 * Never rejects. A transient failure in one of the reads below (a dropped
 * connection right after the constraint violation, not a real gap in the
 * data) must still surface as the plain 409 the caller is already primed to
 * catch — never a 500 that makes an ordinary conflict look like a server
 * failure. This is the app-error.ts doc comment's "the 409 still fires with
 * the plain message" promise, extended from the no-row case to every read
 * failure.
 */
async function buildDoubleBookedError(
  writer: Writer,
  businessId: string,
  vehicleId: string,
  startDate: BusinessDate,
  endDate: BusinessDate,
): Promise<VehicleDoubleBookedError> {
  try {
    return await buildDoubleBookedErrorDetails(writer, businessId, vehicleId, startDate, endDate);
  } catch {
    return new VehicleDoubleBookedError();
  }
}

async function buildDoubleBookedErrorDetails(
  writer: Writer,
  businessId: string,
  vehicleId: string,
  startDate: BusinessDate,
  endDate: BusinessDate,
): Promise<VehicleDoubleBookedError> {
  const requestedDays = dateRange(startDate, endDate);
  const lookaheadTo = addDays(endDate, DOUBLE_BOOKED_LOOKAHEAD_DAYS);
  const occupied = await findVehicleCalendar(writer, businessId, vehicleId, startDate, lookaheadTo);
  const occupiedByDate = new Map(occupied.map((row) => [row.businessDate, row]));

  const firstConflictDate = requestedDays.find((d) => occupiedByDate.has(d));
  const conflictRow =
    firstConflictDate !== undefined ? occupiedByDate.get(firstConflictDate) : undefined;

  let conflict: VehicleDoubleBookedDetails["conflict"] | undefined;
  if (conflictRow?.sourceType === "trip") {
    const holding = await findTripForBusiness(writer, businessId, conflictRow.sourceId);
    const holderLabel =
      holding?.customerId !== null && holding?.customerId !== undefined
        ? ((await findCustomerForBusiness(writer, businessId, holding.customerId))?.name ??
          "an unnamed customer")
        : "no customer on file";
    conflict = {
      sourceType: "trip",
      from: holding?.startDate ?? firstConflictDate ?? startDate,
      to: holding?.endDate ?? null,
      holderLabel,
      destination: holding?.destination ?? null,
    };
  } else if (conflictRow?.sourceType === "daily_lease") {
    const holding = await findDailyLeaseForBusiness(writer, businessId, conflictRow.sourceId);
    const holderLabel =
      holding !== undefined
        ? ((await findDriverForBusiness(writer, businessId, holding.driverId))?.name ??
          "an unnamed driver")
        : "the current holder";
    conflict = {
      sourceType: "daily_lease",
      from: holding?.effectiveFrom ?? firstConflictDate ?? startDate,
      to: holding?.effectiveTo ?? null,
      holderLabel,
      destination: null,
    };
  } else if (conflictRow?.sourceType === "lease") {
    const holding = await findLeaseForBusiness(writer, businessId, conflictRow.sourceId);
    const holderLabel =
      holding !== undefined
        ? ((await findCustomerForBusiness(writer, businessId, holding.customerId))?.name ??
          "an unnamed customer")
        : "the current holder";
    conflict = {
      sourceType: "lease",
      from: holding?.startDate ?? firstConflictDate ?? startDate,
      to: holding?.endDate ?? null,
      holderLabel,
      destination: null,
    };
  }

  // The last candidate whose own window still ends at or before
  // `lookaheadTo` — every date this loop checks was actually queried above,
  // so it never reports a date "free" only because it fell outside what was
  // asked for.
  const requestedLength = requestedDays.length;
  const scanUntil = addDays(lookaheadTo, -(requestedLength - 1));
  let nextFreeFrom: string | null = null;
  for (const candidate of dateRange(startDate, scanUntil)) {
    const window = dateRange(candidate, addDays(candidate, requestedLength - 1));
    if (window.every((d) => !occupiedByDate.has(d))) {
      nextFreeFrom = candidate;
      break;
    }
  }

  return new VehicleDoubleBookedError(
    undefined,
    conflict !== undefined ? { conflict, nextFreeFrom } : undefined,
  );
}

export async function bookTrip(writer: Writer, input: BookTripInput): Promise<BookedTrip> {
  const asHold = input.asHold ?? false;
  let restoreResult: RestoreDailyLeaseOccupancyResult | undefined;
  try {
    const booked = await writer.transaction(async (tx) => {
      const tripId = newId();

      // GAP-7: a stale hold on this vehicle must not block a real booking
      // just because the nightly sweep has not run yet — release is
      // synchronous, ahead of every conflict check below, the same
      // relationship D-9 already gives the daily-lease horizon and the cron.
      const releasedHolds = await releaseExpiredHolds(
        tx,
        input.bookingDate,
        input.vehicleId,
        input.userId,
      );
      // GAP-7/GAP-146: undo any hole the just-released hold(s) left in the
      // vehicle's current daily-lease occupancy, backfilling from wherever
      // each hold actually started — the same GAP-119 restore `cancelTrip`
      // already does. Runs before the carve-out below, which then voids
      // whatever this booking's own range needs regardless.
      restoreResult = await restoreDailyLeaseOccupancy(
        tx,
        releasedHolds.affected,
        input.bookingDate,
      );

      await releaseDailyLeaseAllocationsForRange(
        tx,
        input.vehicleId,
        input.startDate,
        input.endDate,
        input.userId,
      );

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

      let holdExpiresOn: string | null = null;
      if (asHold) {
        const settings = await findBusinessSettings(tx, input.businessId);
        holdExpiresOn = addDays(input.bookingDate, settings?.holdExpiryDays ?? 7);
      }

      await insertTrip(tx, {
        id: tripId,
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
        ...(input.driverId !== undefined ? { driverId: input.driverId } : {}),
        status: asHold ? "hold" : "booked",
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.destination !== undefined ? { destination: input.destination } : {}),
        agreedAmountMinor: input.agreedAmountMinor,
        driverFeeMinor: input.driverFeeMinor,
        ...(openingOdometerId !== undefined ? { openingOdometerId } : {}),
        ...(holdExpiresOn !== null ? { holdExpiresOn } : {}),
      });

      const days = dateRange(input.startDate, input.endDate).map((businessDate) => ({
        id: newId(),
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        businessDate,
        arrangement: "C" as const,
        sourceType: "trip" as const,
        sourceId: tripId,
        isHold: asHold,
      }));
      await insertAllocationDays(tx, days);

      // GAP-160 (review of GAP-158): a lease materialises `vehicle_day_
      // allocation` rows only through day-card-generation's 90-day rolling
      // horizon, so `one_arrangement_per_vehicle_day` has nothing to catch
      // a trip booked against a genuinely active lease whose own dates
      // reach past it — the exact false-negative INV-1 exists to prevent.
      // Runs *after* the insert above, not before: within the horizon,
      // `insertAllocationDays` already either succeeded (nothing occupied
      // these exact days) or threw (caught below, `buildDoubleBookedError`'s
      // own calendar scan finds the precise conflict and the true nearest
      // free date — checked here first would only report the lease's raw
      // end date instead, a real regression on GAP-44's own test). Reaching
      // this line at all means every requested day was actually free — so
      // any lease still overlapping the range now must be one whose
      // relevant days were never materialised in the first place, which is
      // exactly, and only, the horizon gap this exists to close.
      const overlappingLease = await findLeaseOverlappingRange(
        tx,
        input.vehicleId,
        input.startDate,
        input.endDate,
      );
      if (overlappingLease !== undefined) {
        const holderLabel =
          (await findCustomerForBusiness(tx, input.businessId, overlappingLease.customerId))
            ?.name ?? "an unnamed customer";
        throw new VehicleDoubleBookedError(undefined, {
          conflict: {
            sourceType: "lease",
            from: overlappingLease.startDate,
            to: overlappingLease.endDate,
            holderLabel,
            destination: null,
          },
          // The lease's own end is the only honest answer here — its future
          // days are, by construction, exactly the ones the horizon hasn't
          // materialised yet, so the calendar-scan lookahead
          // `buildDoubleBookedError` uses for the materialised case has
          // nothing to search for a free date with. `null` for an
          // open-ended lease is not a missing feature: there genuinely is
          // no known next-free date to suggest, and the client already
          // renders that as a plain OK.
          nextFreeFrom:
            overlappingLease.endDate !== null
              ? addDays(asBusinessDate(overlappingLease.endDate), 1)
              : null,
        });
      }

      // ST-5/F-5.1 Accept: "a hold reserves the calendar but does not
      // suppress daily cards" — the daily lease's own already-generated
      // day_record rows must stay exactly as they were, only its future
      // occupancy moved above. Pausing them, and raising a receivable for
      // money nobody has agreed to yet, are both deferred to
      // `confirmTripHold`.
      let receivableId: string | null = null;
      let receivableSettledMinor: bigint | null = null;
      let receivableStatus: "pending" | "part_paid" | "paid" | "waived" | null = null;
      if (!asHold) {
        await pauseDayRecordsForTrip(tx, input.vehicleId, input.startDate, input.endDate, tripId);

        if (input.customerId !== undefined && input.agreedAmountMinor > 0n) {
          const posted = await postTripFareObligation(tx, {
            businessId: input.businessId,
            tripId,
            vehicleId: input.vehicleId,
            customerId: input.customerId,
            agreedAmountMinor: input.agreedAmountMinor,
            postingDate: input.bookingDate,
            dueOn: input.endDate,
          });
          receivableId = posted.receivableId;
          receivableSettledMinor = posted.receivableSettledMinor;
          receivableStatus = posted.receivableStatus;
        }
      }

      return {
        tripId,
        status: asHold ? ("hold" as const) : ("booked" as const),
        holdExpiresOn,
        receivableId,
        receivableSettledMinor,
        receivableStatus,
      };
    });
    if (restoreResult) {
      logUnrestorableDailyLeaseDates(restoreResult, {
        businessId: input.businessId,
        reason: "hold_expired_on_booking",
      });
    }
    return booked;
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "one_arrangement_per_vehicle_day")) {
      throw await buildDoubleBookedError(
        writer,
        input.businessId,
        input.vehicleId,
        input.startDate,
        input.endDate,
      );
    }
    throw err;
  }
}

export interface ConfirmTripHoldInput {
  businessId: string;
  trip: TripRow;
  /** Injected — `businessToday()` (IG §4.5). Also the obligation's own posting date (W-35): the fare becomes a real receivable the moment it is confirmed, not when the hold was first taken. */
  confirmedOn: BusinessDate;
}

export interface ConfirmedTripHold {
  tripId: string;
  status: "booked";
  receivableId: string | null;
  receivableSettledMinor: bigint | null;
  receivableStatus: "pending" | "part_paid" | "paid" | "waived" | null;
}

/**
 * ST-5/GAP-7: `hold` → `booked`, the confirm half of "it expires or is
 * confirmed." Deliberately does not check `holdExpiresOn` against today —
 * confirming is itself a user action overriding a stale expiry, and
 * `releaseExpiredHolds` will have already cancelled anything genuinely
 * abandoned before this row could still be found in `hold`. What a hold
 * deferred at booking happens here instead: the daily lease's own day
 * records for this range finally pause, the reserved allocation stops
 * reading as tentative, and — only now — a `trip_fare` obligation is raised
 * if there is a customer and a nonzero agreed amount.
 *
 * `input.trip` is only used for the initial fast-path check below — the
 * handler reads it outside any transaction, so by the time this runs it may
 * already be stale. The transaction re-reads the row `forUpdate` and works
 * from that locked copy for everything else: two concurrent confirms (two
 * tabs, two devices) would otherwise both pass the outer check, both enter
 * their own transaction, and both call `postTripFareObligation`, double-
 * posting the receivable — and a confirm racing a concurrent hold release
 * (synchronous or the nightly cron) could resurrect a hold that had already
 * been cancelled. The second transaction in either race now finds
 * `status !== 'hold'` on its locked read and refuses instead.
 */
export async function confirmTripHold(
  writer: Writer,
  input: ConfirmTripHoldInput,
): Promise<ConfirmedTripHold> {
  const { trip } = input;
  if (trip.status !== "hold") {
    throw new ValidationError("Only a hold can be confirmed");
  }

  try {
    return await writer.transaction(async (tx) => {
      const live = await findTripForBusiness(tx, input.businessId, trip.id, true);
      if (!live || live.status !== "hold") {
        throw new ValidationError("Only a hold can be confirmed");
      }

      await pauseDayRecordsForTrip(tx, live.vehicleId, live.startDate, live.endDate, live.id);
      await clearHoldOnAllocationDaysForTrip(tx, live.id);
      const confirmed = await confirmTripHoldRow(tx, live.id);
      if (!confirmed) {
        throw new ValidationError("Only a hold can be confirmed");
      }

      let receivableId: string | null = null;
      let receivableSettledMinor: bigint | null = null;
      let receivableStatus: "pending" | "part_paid" | "paid" | "waived" | null = null;
      if (live.customerId !== null && live.agreedAmountMinor > 0n) {
        const posted = await postTripFareObligation(tx, {
          businessId: input.businessId,
          tripId: live.id,
          vehicleId: live.vehicleId,
          customerId: live.customerId,
          agreedAmountMinor: live.agreedAmountMinor as Minor,
          postingDate: input.confirmedOn,
          dueOn: live.endDate as BusinessDate,
        });
        receivableId = posted.receivableId;
        receivableSettledMinor = posted.receivableSettledMinor;
        receivableStatus = posted.receivableStatus;
      }

      return {
        tripId: live.id,
        status: "booked" as const,
        receivableId,
        receivableSettledMinor,
        receivableStatus,
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

/**
 * ST-5/GAP-7: "`in_progress` is derived, not written." A `booked` trip whose
 * range has started reads as `in_progress` wherever status is shown;
 * `closed`/`cancelled` are already terminal and never reinterpreted, and a
 * `hold` stays a `hold` regardless of its own dates — it is not occupying
 * anything until confirmed.
 */
export function deriveTripStatus(
  row: Pick<TripRow, "status" | "startDate" | "endDate">,
  today: BusinessDate,
): TripRow["status"] {
  if (row.status === "booked" && today >= row.startDate && today <= row.endDate) {
    return "in_progress";
  }
  return row.status;
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

  // GAP-7/ST-5: `hold` → `booked` → `in_progress` → `closed` — a hold must
  // be confirmed first (never raised a receivable or paused the daily
  // lease, both of which this write assumes already happened).
  if (trip.status === "hold") {
    throw new ValidationError("A hold must be confirmed before it can be closed");
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
        const driverFeeObligationId = newId();
        await insertObligation(tx, {
          id: driverFeeObligationId,
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

        // GAP-5b/F-4.5: a driver who already carries unapplied "paid"
        // credit (an earlier overpayment) has this trip's fee settled from
        // it immediately.
        await applyCreditForward(
          tx,
          input.businessId,
          "driver",
          trip.driverId,
          "owed_by_us",
          driverFeeObligationId,
          trip.driverFeeMinor,
          input.closingDate,
        );
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

export interface DailyLeaseOccupancyRestoreTarget {
  businessId: string;
  vehicleId: string;
  /**
   * GAP-146/REV-2026-08-19-02: the earliest date this vehicle's release
   * actually freed — a hold's own `startDate` (`releaseExpiredHolds`'s
   * `affected[].freedFrom`) or a cancelled trip's own `startDate`
   * (`cancelTrip`, below). Plain `string`, matching every DB-row date this
   * far from the request boundary (IG §3.1) — cast to `BusinessDate` inside
   * this function, the same as `fullLease.effectiveFrom` already is.
   * Omitted only where nothing more specific is known; the restore then
   * falls back to `today`, the pre-GAP-146 behaviour.
   */
  freedFrom?: string;
}

export interface RestoreDailyLeaseOccupancyResult {
  /**
   * GAP-146: per vehicle, pattern dates the restore could not raise a
   * driver day fee for, because they fall before the currently open
   * period's own start — an already-closed period. `assert_period_open()`
   * only checks whether the row's *named* period is closed, not whether
   * its `business_date` actually falls inside it, so writing one of these
   * would silently move a closed month's figures into the open one. The
   * vehicle's occupancy for these dates is still corrected (that fact has
   * no period and needs no such guard) — only the money side is withheld.
   */
  unrestorable: { vehicleId: string; dates: BusinessDate[] }[];
}

/**
 * GAP-119/GAP-7/GAP-146: the shared "undo whatever daily-lease occupancy a
 * hold or charter released" step — `cancelTrip`'s own restore, factored out
 * so `releaseExpiredHolds`'s callers (`bookTrip`, `startDailyLease`,
 * `startLease`, the nightly `release-expired-holds` cron) can run the same
 * fix for an *expired* hold. Voiding a hold's allocation without this left a
 * still-active daily lease reading as free on the calendar for every date
 * the hold covered — no current daily lease on a vehicle (never had one, or
 * moved off it) means nothing to restore, and is a no-op for that vehicle.
 *
 * `freedFrom` (REV-2026-08-19-02) is what makes this reach backward: the
 * void that frees a vehicle's dates has no lower bound at `today` — a hold
 * or a charter can span dates already in the past by the time it's released
 * or cancelled — but `materializeDailyLeaseHorizon` used to fill only
 * forward from `today`, so nothing ever re-covered the elapsed portion.
 */
export async function restoreDailyLeaseOccupancy(
  tx: Tx,
  vehicles: DailyLeaseOccupancyRestoreTarget[],
  today: BusinessDate,
): Promise<RestoreDailyLeaseOccupancyResult> {
  const unrestorable: RestoreDailyLeaseOccupancyResult["unrestorable"] = [];
  for (const { businessId, vehicleId, freedFrom } of vehicles) {
    const currentDailyLease = await findCurrentDailyLeaseRowForVehicle(tx, vehicleId);
    if (!currentDailyLease) continue;
    const fullLease = await findDailyLeaseForBusiness(tx, businessId, currentDailyLease.id);
    if (!fullLease) continue;
    const rates = await listDailyLeaseRatesForLease(tx, fullLease.id);
    const openPeriod = (await findOpenPeriodRow(tx, businessId)) ?? null;

    // Never later than today (this is a backfill, not a forward extension)
    // and never earlier than the lease's own start (nothing to restore
    // before a daily lease existed to own the date).
    const freedFromDate = freedFrom as BusinessDate | undefined;
    const requestedFrom =
      freedFromDate !== undefined && freedFromDate < today ? freedFromDate : today;
    const from =
      requestedFrom < fullLease.effectiveFrom
        ? (fullLease.effectiveFrom as BusinessDate)
        : requestedFrom;

    const result = await materializeDailyLeaseHorizon(
      tx,
      { ...fullLease, businessId },
      rates,
      openPeriod,
      today,
      HORIZON_DAYS,
      from,
    );
    if (result.unrestorableDayRecordDates.length > 0) {
      unrestorable.push({ vehicleId, dates: result.unrestorableDayRecordDates });
    }
  }
  return { unrestorable };
}

/**
 * GAP-146: the one place this domain layer logs, and only when a restore
 * left a genuine, permanent gap behind — a pattern date whose driver day
 * fee will now never be raised, because it fell before the currently open
 * period's own start. Called after the transaction that produced `result`
 * has committed, never from inside it: a mid-transaction log line would
 * survive a later rollback in the same transaction and read as a real gap
 * that never actually happened.
 */
export function logUnrestorableDailyLeaseDates(
  result: RestoreDailyLeaseOccupancyResult,
  context: { businessId: string; reason: string },
): void {
  if (result.unrestorable.length === 0) return;
  // eslint-disable-next-line no-console -- IG §3.4's sanctioned exception, same shape attachment.ts/scheduled.ts already carry: a structured operational fact, never a request body, and it never blocks or slows the write it reports on.
  console.log(
    JSON.stringify({
      level: "warn",
      event: "daily_lease_restore_incomplete",
      businessId: context.businessId,
      reason: context.reason,
      vehicles: result.unrestorable,
    }),
  );
}

export interface CancelTripInput {
  businessId: string;
  trip: TripRow;
  cancelledOn: BusinessDate;
  /** GAP-23/A6: attributes the trip_fare obligation's void, the same way any other void names who did it. */
  userId: string;
  /** Injected — `businessToday()` (IG §4.5). GAP-119: drives how far `materializeDailyLeaseHorizon` reaches when re-filling whatever this cancellation frees back up, the same injection `startDailyLease`/`changeDailyLeaseDriver` already use. */
  today: BusinessDate;
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
 *
 * GAP-119: if the vehicle is still on a daily lease, `bookTrip`'s own
 * release left a hole in that lease's occupancy for this trip's range —
 * `materializeDailyLeaseHorizon` re-fills it the same way it would have
 * filled it in the first place, over the vehicle's *current* daily lease,
 * not necessarily the one active when the trip was booked (a driver change,
 * GAP-118, may have superseded it in the meantime; the current one is the
 * correct one to restore). No current daily lease (the vehicle moved off B
 * entirely, or never had one) means nothing to restore, and this is a no-op.
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

  let restoreResult: RestoreDailyLeaseOccupancyResult | undefined;
  try {
    const cancelled = await writer.transaction(async (tx) => {
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
      await deleteAllocationDaysForTrip(tx, trip.id, input.userId);

      // GAP-119/GAP-146: restore whatever daily-lease occupancy bookTrip
      // released for this vehicle, if it is still on one — backfilling
      // from the cancelled trip's own startDate, not just today, so a
      // multi-day charter cancelled after it has already begun doesn't
      // lose the elapsed portion.
      restoreResult = await restoreDailyLeaseOccupancy(
        tx,
        [{ businessId: input.businessId, vehicleId: trip.vehicleId, freedFrom: trip.startDate }],
        input.today,
      );

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
    if (restoreResult) {
      logUnrestorableDailyLeaseDates(restoreResult, {
        businessId: input.businessId,
        reason: "trip_cancelled",
      });
    }
    return cancelled;
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

/**
 * GAP-7/ST-5's nightly sweep — the optimisation, not the mechanism (the
 * mechanism is the synchronous release inside `bookTrip`/`startDailyLease`/
 * `startLease`). Unscoped by `business_id`, the same shape every other cron
 * unit in this system uses (TS §4) — a hold nobody happened to book around
 * releases on its own rather than waiting for the next booking attempt on
 * that exact vehicle.
 */
export async function releaseAllExpiredHolds(
  writer: Writer,
  today: BusinessDate,
): Promise<{ released: number; unrestorable: RestoreDailyLeaseOccupancyResult["unrestorable"] }> {
  const result = await writer.transaction(async (tx) => {
    const released = await releaseExpiredHolds(tx, today);
    const restored = await restoreDailyLeaseOccupancy(tx, released.affected, today);
    return { released, restored };
  });
  // Returned rather than logged here (GAP-146) — this already runs inside
  // scheduled.ts, which owns the one sanctioned log line for a cron job
  // (IG §3.4); logging a second time from inside the domain layer would be
  // exactly the "two log lines for one event" the boundary convention
  // exists to prevent.
  return { released: result.released.released, unrestorable: result.restored.unrestorable };
}
