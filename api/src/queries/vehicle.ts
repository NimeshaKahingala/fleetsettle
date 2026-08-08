import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import {
  dayRecord,
  vehicle,
  vehicleArrangement,
  vehicleDayAllocation,
  vehicleDocument,
} from "../db/schema.js";
import type { DayRecordRow } from "./day-record.js";

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

/**
 * §6.7/UC-94/GAP-56: the arrangement in force on `asOf`, not necessarily
 * today's. Deliberately a separate query from `CURRENT_ARRANGEMENT` above —
 * that one backs the vehicle-overview badge and the client's gating, both
 * of which want "now"; this one backs a money default, which wants
 * "whenever the cost was actually incurred" (U-8: catch-up is the ordinary
 * case, not the exception).
 */
export async function findVehicleArrangementAsOf(
  db: ReadDb,
  vehicleId: string,
  asOf: string,
): Promise<"A" | "B" | "C" | null> {
  const rows = await db
    .select({ arrangement: vehicleArrangement.arrangement })
    .from(vehicleArrangement)
    .where(
      and(
        eq(vehicleArrangement.vehicleId, vehicleId),
        lte(vehicleArrangement.effectiveFrom, asOf),
        or(isNull(vehicleArrangement.effectiveTo), gte(vehicleArrangement.effectiveTo, asOf)),
      ),
    )
    .limit(1);
  return (rows[0]?.arrangement as "A" | "B" | "C" | undefined) ?? null;
}

export interface VehicleCalendarDayRow {
  businessDate: string;
  arrangement: "A" | "B" | "C";
  sourceType: string;
  sourceId: string;
  isHold: boolean;
  /** Only ever set for arrangement B (`sourceType === 'daily_lease'`) — that date's `day_record` outcome, when a row exists yet. `null` for arrangement A/C (nothing to join) and, within arrangement B, for a date generation hasn't reached yet (day-card-generation.ts's 90-day rolling horizon still covers every occupied date this endpoint could return, so this is rare in practice, not absent by design). */
  dayRecordState: DayRecordRow["state"] | null;
}

const CALENDAR_DAY_RECORD = and(
  eq(dayRecord.dailyLeaseId, vehicleDayAllocation.sourceId),
  eq(dayRecord.businessDate, vehicleDayAllocation.businessDate),
  eq(dayRecord.businessId, vehicleDayAllocation.businessId),
);

/**
 * UC-95, "a single indexed range scan" (DM §2 on `vehicle_day_allocation`) —
 * one row per occupied day; an absent date is not scheduled, the same
 * convention `day_record` already uses for an off-pattern day. This answers
 * "is the vehicle free," which is what booking a lease or a trip actually
 * needs before it can start. It also carries `day_record`'s own outcome
 * (Web-P5's calendar screen, UI §7.6, needs "ran" vs "lost" — occupancy
 * alone can't distinguish them) via a `LEFT JOIN` that only ever matches
 * arrangement-B rows, since `sourceId` is a `daily_lease_id` only for those.
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
      dayRecordState: dayRecord.state,
    })
    .from(vehicleDayAllocation)
    .leftJoin(dayRecord, CALENDAR_DAY_RECORD)
    .where(
      and(
        eq(vehicleDayAllocation.businessId, businessId),
        eq(vehicleDayAllocation.vehicleId, vehicleId),
        gte(vehicleDayAllocation.businessDate, fromDate),
        lte(vehicleDayAllocation.businessDate, toDate),
      ),
    )
    .orderBy(asc(vehicleDayAllocation.businessDate));
  return rows.map((row) => ({
    ...row,
    dayRecordState: row.dayRecordState ?? null,
  })) as VehicleCalendarDayRow[];
}

export interface VehicleDocumentRow {
  docType: "insurance" | "registration" | "revenue_licence" | "permit" | "emissions";
  expiryDate: string;
  reference: string | null;
}

/**
 * Vehicle overview's paperwork tab (Web-P5). `vehicle_document` carries no
 * `business_id` of its own (DM §4's DDL) — the caller must already have
 * confirmed `vehicleId` belongs to this business via `findVehicleForBusiness`
 * first, the same order `getVehicleCalendarHandler`/`upsertVehicleDocumentHandler`
 * already use.
 */
export async function listVehicleDocumentsForVehicle(
  db: ReadDb,
  vehicleId: string,
): Promise<VehicleDocumentRow[]> {
  const rows = await db
    .select({
      docType: vehicleDocument.docType,
      expiryDate: vehicleDocument.expiryDate,
      reference: vehicleDocument.reference,
    })
    .from(vehicleDocument)
    .where(eq(vehicleDocument.vehicleId, vehicleId));
  return rows as VehicleDocumentRow[];
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
