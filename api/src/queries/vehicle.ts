import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  vehicle,
  vehicleArrangement,
  vehicleDayAllocation,
  vehicleDocument,
} from "../db/schema.js";

type WriteDb = Writer | Tx;
/** Reads run from either the reader (the common case) or a writer/tx already open for a write in the same flow. */
type ReadDb = Reader | Writer | Tx;

export interface NewVehicle {
  id: string;
  businessId: string;
  registration: string;
  vehicleType: string;
}

export async function insertVehicle(db: WriteDb, values: NewVehicle): Promise<void> {
  await db.insert(vehicle).values(values);
}

export interface NewVehicleArrangement {
  id: string;
  vehicleId: string;
  arrangement: "A" | "B" | "C";
  effectiveFrom: string;
}

export async function insertVehicleArrangement(
  db: WriteDb,
  values: NewVehicleArrangement,
): Promise<void> {
  await db.insert(vehicleArrangement).values(values);
}

export interface UpsertVehicleDocument {
  id: string;
  vehicleId: string;
  docType: string;
  expiryDate: string;
  reference?: string;
}

/** UC-92: one row per `(vehicle_id, doc_type)` — a renewal replaces the date, never adds a row (DM §4's unique index is the upsert target). */
export async function upsertVehicleDocument(
  db: WriteDb,
  values: UpsertVehicleDocument,
): Promise<void> {
  await db
    .insert(vehicleDocument)
    .values(values)
    .onConflictDoUpdate({
      target: [vehicleDocument.vehicleId, vehicleDocument.docType],
      set: {
        expiryDate: values.expiryDate,
        reference: values.reference,
        updatedAt: sql`now()`,
      },
    });
}

export interface VehicleRow {
  id: string;
  registration: string;
  vehicleType: string;
  lifecycle: "active" | "archived" | "disposed";
  arrangement: "A" | "B" | "C" | null;
}

const CURRENT_ARRANGEMENT = and(
  eq(vehicleArrangement.vehicleId, vehicle.id),
  isNull(vehicleArrangement.effectiveTo),
);

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findVehicleForBusiness(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<VehicleRow | undefined> {
  const rows = await db
    .select({
      id: vehicle.id,
      registration: vehicle.registration,
      vehicleType: vehicle.vehicleType,
      lifecycle: vehicle.lifecycle,
      arrangement: vehicleArrangement.arrangement,
    })
    .from(vehicle)
    .leftJoin(vehicleArrangement, CURRENT_ARRANGEMENT)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.businessId, businessId)))
    .limit(1);
  return rows[0] as VehicleRow | undefined;
}

export interface VehicleCalendarDayRow {
  businessDate: string;
  arrangement: "A" | "B" | "C";
  sourceType: string;
  sourceId: string;
  isHold: boolean;
}

/**
 * UC-95, "a single indexed range scan" (DM §2 on `vehicle_day_allocation`) —
 * one row per occupied day; an absent date is not scheduled, the same
 * convention `day_record` already uses for an off-pattern day. This answers
 * "is the vehicle free," which is what booking a lease or a trip actually
 * needs before it can start; it does not merge in `day_record`'s own state
 * (lost / ran), which is a day's *outcome*, not its occupancy.
 */
export async function findVehicleCalendar(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
  fromDate: string,
  toDate: string,
): Promise<VehicleCalendarDayRow[]> {
  const rows = await db
    .select({
      businessDate: vehicleDayAllocation.businessDate,
      arrangement: vehicleDayAllocation.arrangement,
      sourceType: vehicleDayAllocation.sourceType,
      sourceId: vehicleDayAllocation.sourceId,
      isHold: vehicleDayAllocation.isHold,
    })
    .from(vehicleDayAllocation)
    .where(
      and(
        eq(vehicleDayAllocation.businessId, businessId),
        eq(vehicleDayAllocation.vehicleId, vehicleId),
        gte(vehicleDayAllocation.businessDate, fromDate),
        lte(vehicleDayAllocation.businessDate, toDate),
      ),
    )
    .orderBy(asc(vehicleDayAllocation.businessDate));
  return rows as VehicleCalendarDayRow[];
}

export async function listVehiclesForBusiness(
  db: ReadDb,
  businessId: string,
): Promise<VehicleRow[]> {
  const rows = await db
    .select({
      id: vehicle.id,
      registration: vehicle.registration,
      vehicleType: vehicle.vehicleType,
      lifecycle: vehicle.lifecycle,
      arrangement: vehicleArrangement.arrangement,
    })
    .from(vehicle)
    .leftJoin(vehicleArrangement, CURRENT_ARRANGEMENT)
    .where(eq(vehicle.businessId, businessId))
    .orderBy(vehicle.createdAt);
  return rows as VehicleRow[];
}
