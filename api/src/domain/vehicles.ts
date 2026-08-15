import { addDays, newId, type BusinessDate } from "@fleetsettle/shared";
import type { Reader, Writer } from "../db/client.js";
import { isExclusionViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  NotFoundError,
  ValidationError,
  VehicleAlreadyExistsError,
  VehicleArrangementChangeBlockedError,
  VehicleUnavailabilityAlreadyVoidedError,
  VehicleUnavailabilityOverlapsError,
} from "../errors/app-error.js";
import { voidFutureOpenDayRecordsForLease } from "../queries/day-record.js";
import {
  endDailyLeaseRow,
  findCurrentDailyLeaseRowForVehicle,
  releaseDailyLeaseAllocationsAfter,
} from "../queries/dailyLease.js";
import { findLastMaintenanceOdometerKm } from "../queries/expense.js";
import { findOpenLeaseForVehicle } from "../queries/lease.js";
import { findLatestOdometerReadingForVehicle } from "../queries/odometer-reading.js";
import { findOpenTripForVehicle } from "../queries/trip.js";
import {
  endVehicleArrangementRow,
  findCurrentVehicleArrangementRow,
  findVehicleForBusiness,
  findVehicleUnavailabilityForBusiness,
  insertVehicle,
  insertVehicleArrangement,
  insertVehicleUnavailability,
  setVehicleLifecycle,
  setVehicleServiceInterval,
  upsertVehicleDocument,
  voidVehicleUnavailabilityRow,
} from "../queries/vehicle.js";

export interface CreateVehicleInput {
  businessId: string;
  registration: string;
  vehicleType: string;
  defaultArrangement: "A" | "B" | "C";
  insuranceExpiry?: BusinessDate;
  registrationExpiry?: BusinessDate;
  /** Injected — `businessToday()` is the one sanctioned clock read, and it belongs to the handler (IG §4.5). */
  today: BusinessDate;
}

export interface CreatedVehicle {
  vehicleId: string;
}

/**
 * F-1.1 / UC-01, one transaction: the vehicle, its opening `vehicle_arrangement`
 * row (effective from today, open-ended — F-1.2 is what ever closes it), and
 * — the one thing worth entering on the same form because it is the one
 * field that costs money by being blank — insurance and registration expiry,
 * each upserted into `vehicle_document` only if given (DM §16: `vehicle`,
 * `vehicle_arrangement`, `vehicle_document`).
 */
export async function createVehicle(
  writer: Writer,
  input: CreateVehicleInput,
): Promise<CreatedVehicle> {
  try {
    return await writer.transaction(async (tx) => {
      const vehicleId = newId();
      await insertVehicle(tx, {
        id: vehicleId,
        businessId: input.businessId,
        registration: input.registration,
        vehicleType: input.vehicleType,
      });

      await insertVehicleArrangement(tx, {
        id: newId(),
        vehicleId,
        arrangement: input.defaultArrangement,
        effectiveFrom: input.today,
      });

      if (input.insuranceExpiry !== undefined) {
        await upsertVehicleDocument(tx, {
          id: newId(),
          vehicleId,
          docType: "insurance",
          expiryDate: input.insuranceExpiry,
        });
      }
      if (input.registrationExpiry !== undefined) {
        await upsertVehicleDocument(tx, {
          id: newId(),
          vehicleId,
          docType: "registration",
          expiryDate: input.registrationExpiry,
        });
      }

      return { vehicleId };
    });
  } catch (err) {
    if (isUniqueViolation(err, "vehicle_business_id_registration_key")) {
      throw new VehicleAlreadyExistsError();
    }
    throw err;
  }
}

export interface ChangeVehicleArrangementInput {
  vehicleId: string;
  arrangement: "A" | "B" | "C";
  effectiveFrom: BusinessDate;
  /** GAP-118: attributed on the closed daily lease's voided allocations/day-records the same way every other void trio is (CLAUDE.md → Writes: append-only, an actor recorded). */
  userId: string;
}

export interface ChangedVehicleArrangement {
  id: string;
  vehicleId: string;
  arrangement: "A" | "B" | "C";
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * F-1.2/UC-94/GAP-54, one transaction: the row is never overwritten
 * (`createVehicle`'s own doc comment named this function as what ever
 * closes the opening arrangement). **Pre** (UC-94): no open lease or trip
 * conflicting with the effective date.
 *
 * The two arrangements this can close behave differently, deliberately:
 * moving off **A** refuses outright if a lease is not yet `closed` — a
 * lease carries a deposit/mileage/billing commitment only F-2.6's own
 * multi-step flow may unwind. Moving off **B** closes the current
 * `daily_lease` automatically — it is bookkeeping-only, nothing money-
 * committing happens by leaving it open, and this is F-1.2's own "daily
 * cards stop" — `generate-day-cards` (P13) never reads `vehicle_arrangement`
 * at all, only whether a `daily_lease` row is still open, so closing it here
 * is the only thing that actually stops cards from continuing to generate.
 *
 * Ordering matters in both closes: the old row's `UPDATE` must land before
 * the new row's `INSERT` in the same transaction — `vehicle_arrangement`'s
 * exclusion constraint (like `daily_lease`'s) is not deferred, so the old
 * range has to stop overlapping first.
 */
export async function changeVehicleArrangement(
  writer: Writer,
  input: ChangeVehicleArrangementInput,
): Promise<ChangedVehicleArrangement> {
  return await writer.transaction(async (tx) => {
    const current = await findCurrentVehicleArrangementRow(tx, input.vehicleId);
    if (!current) throw new NotFoundError("This vehicle has no current arrangement");
    if (current.arrangement === input.arrangement) {
      throw new ValidationError("This vehicle is already configured for this arrangement");
    }
    if (input.effectiveFrom <= current.effectiveFrom) {
      throw new ValidationError(
        "effectiveFrom must be after the current arrangement's own start date",
      );
    }

    const openLease = await findOpenLeaseForVehicle(tx, input.vehicleId);
    if (openLease) {
      throw new VehicleArrangementChangeBlockedError(
        "This vehicle has a lease that is not yet closed — close it first (F-2.6)",
      );
    }
    const openTrip = await findOpenTripForVehicle(tx, input.vehicleId, input.effectiveFrom);
    if (openTrip) {
      throw new VehicleArrangementChangeBlockedError(
        "This vehicle has an open trip covering the effective date",
      );
    }

    if (current.arrangement === "B" && input.arrangement !== "B") {
      const openDailyLease = await findCurrentDailyLeaseRowForVehicle(tx, input.vehicleId);
      if (openDailyLease) {
        if (input.effectiveFrom <= openDailyLease.effectiveFrom) {
          throw new ValidationError(
            "effectiveFrom must be after the current daily lease's own start date",
          );
        }
        const closesOn = addDays(input.effectiveFrom, -1);
        await endDailyLeaseRow(tx, openDailyLease.id, closesOn);
        // GAP-118: moving off B leaves this lease's future occupancy and
        // cards behind otherwise — no replacement lease follows here (unlike
        // changeDailyLeaseDriver's own materialise-back), so freeing them is
        // the entire fix for this side.
        await releaseDailyLeaseAllocationsAfter(
          tx,
          openDailyLease.id,
          closesOn,
          "Vehicle moved off daily lease",
          input.userId,
        );
        await voidFutureOpenDayRecordsForLease(
          tx,
          openDailyLease.id,
          closesOn,
          "Vehicle moved off daily lease",
          input.userId,
        );
      }
    }

    await endVehicleArrangementRow(tx, current.id, addDays(input.effectiveFrom, -1));

    const newArrangementId = newId();
    await insertVehicleArrangement(tx, {
      id: newArrangementId,
      vehicleId: input.vehicleId,
      arrangement: input.arrangement,
      effectiveFrom: input.effectiveFrom,
    });

    return {
      id: newArrangementId,
      vehicleId: input.vehicleId,
      arrangement: input.arrangement,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: null,
    };
  });
}

/**
 * GAP-36/A9b item 2: `lifecycle` moves off `'active'` for the first time.
 * Transaction-wrapped for consistency with every other write in this
 * codebase (found by review) — `vehicle` carries no `posted_period_id`
 * (DM §13), so migration 0002's audit trigger never attaches to it and
 * there is no `audit_log` attribution at stake either way. Unconditional,
 * matching `mileage_package`'s own archive: no domain code reads
 * `lifecycle` at booking time, so there is no already-archived state to
 * race against.
 */
export async function archiveVehicle(writer: Writer, vehicleId: string): Promise<void> {
  await writer.transaction((tx) => setVehicleLifecycle(tx, vehicleId, "archived"));
}

export async function unarchiveVehicle(writer: Writer, vehicleId: string): Promise<void> {
  await writer.transaction((tx) => setVehicleLifecycle(tx, vehicleId, "active"));
}

/** F-3.5/UC-13/GAP-68. `null` clears the interval — the same "no interval, no prompt" reading the rest of this feature carries. */
export async function changeVehicleServiceInterval(
  writer: Writer,
  vehicleId: string,
  serviceIntervalKm: number | null,
): Promise<void> {
  await writer.transaction((tx) => setVehicleServiceInterval(tx, vehicleId, serviceIntervalKm));
}

export interface VehicleMaintenanceStatus {
  /** Null whenever the figure isn't computable — no interval set, or no maintenance baseline recorded yet. Never a guessed 0 (W-56). */
  kmSinceLastServiceKm: number | null;
  due: boolean;
}

/**
 * F-3.5/UC-13/GAP-68, read live on every vehicle-detail fetch — the same
 * "a query the screen makes, not a job that writes anything" shape
 * `getPaperworkWarnings` (domain/home.ts) already uses for its own prompt.
 * **With no interval set, there is no prompt at all** — this function is
 * never even called in that case (`getVehicleHandler` short-circuits it).
 * With an interval set but no maintenance ever recorded through this
 * system, there is nothing to compare the latest reading against —
 * `kmSinceLastServiceKm` stays `null` rather than assuming the vehicle has
 * never been serviced, which W-56 rules out as a guess this document
 * cannot stand behind.
 */
export async function getVehicleMaintenanceStatus(
  reader: Reader,
  vehicleId: string,
  serviceIntervalKm: number,
): Promise<VehicleMaintenanceStatus> {
  const [latest, lastMaintenanceKm] = await Promise.all([
    findLatestOdometerReadingForVehicle(reader, vehicleId),
    findLastMaintenanceOdometerKm(reader, vehicleId),
  ]);
  if (latest === undefined || lastMaintenanceKm === undefined) {
    return { kmSinceLastServiceKm: null, due: false };
  }

  const kmSinceLastServiceKm = latest.readingKm - lastMaintenanceKm;
  // `latest` (by readOn) and lastMaintenanceKm (by the servicing expense's
  // own spentOn) are independent lookups — an out-of-order or backdated
  // entry can make this negative. W-56: that's "not available", never a
  // guessed (and here, nonsensical) figure.
  if (kmSinceLastServiceKm < 0) return { kmSinceLastServiceKm: null, due: false };
  return { kmSinceLastServiceKm, due: kmSinceLastServiceKm >= serviceIntervalKm };
}

export interface MarkVehicleUnavailableInput {
  businessId: string;
  vehicleId: string;
  reason: "service" | "sale_preparation" | "other";
  unavailableFrom: BusinessDate;
  unavailableTo?: BusinessDate;
  note?: string;
  userId: string;
}

export interface VehicleUnavailability {
  id: string;
  vehicleId: string;
  reason: "service" | "sale_preparation" | "other";
  unavailableFrom: string;
  unavailableTo: string | null;
  note: string | null;
}

/**
 * F-1.10/GAP-26: "works regardless of the vehicle's current arrangement" —
 * no arrangement check, unlike `startLease`/`startDailyLease` (GAP-84). A
 * single insert; the exclusion constraint (migration 0019) is the truth for
 * overlap, never a pre-check (CLAUDE.md → Writes) — a second live outage
 * over any of the same dates on this vehicle is caught below, not guessed
 * at in application code.
 */
export async function markVehicleUnavailable(
  writer: Writer,
  input: MarkVehicleUnavailableInput,
): Promise<VehicleUnavailability> {
  const vehicle = await findVehicleForBusiness(writer, input.businessId, input.vehicleId);
  if (!vehicle) throw new NotFoundError("No such vehicle in this business");

  const id = newId();
  try {
    await writer.transaction((tx) =>
      insertVehicleUnavailability(tx, {
        id,
        businessId: input.businessId,
        vehicleId: input.vehicleId,
        reason: input.reason,
        unavailableFrom: input.unavailableFrom,
        ...(input.unavailableTo !== undefined ? { unavailableTo: input.unavailableTo } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        createdBy: input.userId,
      }),
    );
  } catch (err) {
    if (isExclusionViolation(err, "vehicle_unavailability_vehicle_id_daterange_excl")) {
      throw new VehicleUnavailabilityOverlapsError();
    }
    throw err;
  }

  return {
    id,
    vehicleId: input.vehicleId,
    reason: input.reason,
    unavailableFrom: input.unavailableFrom,
    unavailableTo: input.unavailableTo ?? null,
    note: input.note ?? null,
  };
}

export interface VoidVehicleUnavailabilityInput {
  businessId: string;
  vehicleId: string;
  unavailabilityId: string;
  reason: string;
  userId: string;
}

/** F-1.10/GAP-26: void, never delete — the same correction shape every other outage-style fact in this document uses (W-58). No "end early" endpoint: the row that guessed wrong is voided, and a fresh one covers the corrected range if one is still needed. */
export async function voidVehicleUnavailability(
  writer: Writer,
  input: VoidVehicleUnavailabilityInput,
): Promise<{ voidedAt: string }> {
  const existing = await findVehicleUnavailabilityForBusiness(
    writer,
    input.businessId,
    input.unavailabilityId,
  );
  if (!existing || existing.vehicleId !== input.vehicleId) {
    throw new NotFoundError("No such outage on this vehicle");
  }
  if (existing.voidedAt !== null) throw new VehicleUnavailabilityAlreadyVoidedError();

  // The WHERE guard in voidVehicleUnavailabilityRow makes a losing race
  // against a concurrent void return undefined here rather than clobbering
  // the winner's own reason/actor — the same shape voidCapitalContribution uses.
  const voided = await writer.transaction((tx) =>
    voidVehicleUnavailabilityRow(tx, input.unavailabilityId, {
      voidedReason: input.reason,
      voidedBy: input.userId,
    }),
  );
  if (!voided) throw new VehicleUnavailabilityAlreadyVoidedError();
  return voided;
}
