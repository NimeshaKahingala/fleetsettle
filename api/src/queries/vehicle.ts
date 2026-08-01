import { and, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { vehicle, vehicleArrangement, vehicleDocument } from "../db/schema.js";

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
