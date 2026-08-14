import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { incident, incidentRecovery, insuranceClaim, leaseExtension } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewIncident {
  id: string;
  businessId: string;
  vehicleId: string;
  leaseId?: string;
  occurredOn: string;
  description?: string;
}

export async function insertIncident(db: WriteDb, values: NewIncident): Promise<void> {
  await db.insert(incident).values(values);
}

export interface IncidentRow {
  id: string;
  vehicleId: string;
  leaseId: string | null;
  status: "open" | "repairs_recorded" | "recovery_pending" | "closed";
  occurredOn: string;
  description: string | null;
  offRoadFrom: string | null;
  offRoadTo: string | null;
  rentTreatment: "continue" | "credit_days" | "extend" | null;
  closedAt: string | null;
}

const INCIDENT_COLUMNS = {
  id: incident.id,
  vehicleId: incident.vehicleId,
  leaseId: incident.leaseId,
  status: incident.status,
  occurredOn: incident.occurredOn,
  description: incident.description,
  offRoadFrom: incident.offRoadFrom,
  offRoadTo: incident.offRoadTo,
  rentTreatment: incident.rentTreatment,
  closedAt: incident.closedAt,
};

/** Scoped by `businessId` — the same shape every P2+ read gets (CLAUDE.md → Tenancy). */
export async function findIncidentForBusiness(
  db: ReadDb,
  businessId: string,
  incidentId: string,
): Promise<IncidentRow | undefined> {
  const rows = await db
    .select(INCIDENT_COLUMNS)
    .from(incident)
    .where(and(eq(incident.id, incidentId), eq(incident.businessId, businessId)))
    .limit(1);
  return rows[0] as IncidentRow | undefined;
}

/** F-3.4 step 2: the off-road window and the rent-treatment choice, entered together, "for this incident only." */
export async function updateIncidentOffRoad(
  db: WriteDb,
  incidentId: string,
  values: {
    offRoadFrom: string;
    offRoadTo: string;
    rentTreatment: "continue" | "credit_days" | "extend";
  },
): Promise<void> {
  await db
    .update(incident)
    .set({
      offRoadFrom: values.offRoadFrom,
      offRoadTo: values.offRoadTo,
      rentTreatment: values.rentTreatment,
    })
    .where(eq(incident.id, incidentId));
}

export async function closeIncidentRow(
  db: WriteDb,
  incidentId: string,
  closedAt: string,
): Promise<void> {
  await db.update(incident).set({ status: "closed", closedAt }).where(eq(incident.id, incidentId));
}

/** F-2.6/UC-16 step 4: "any open incident still awaiting a repair bill or recovery" — the closure summary's own line, scoped to this lease directly rather than the whole vehicle's history. */
export async function listOpenIncidentsForLease(
  db: ReadDb,
  businessId: string,
  leaseId: string,
): Promise<IncidentRow[]> {
  const rows = await db
    .select(INCIDENT_COLUMNS)
    .from(incident)
    .where(
      and(
        eq(incident.businessId, businessId),
        eq(incident.leaseId, leaseId),
        sql`${incident.status} <> 'closed'`,
      ),
    );
  return rows as IncidentRow[];
}

/** Vehicle overview's own Incidents section (Web-P8a): every incident this vehicle has had, open and closed alike, newest first — unlike `listOpenIncidentsForLease`, this is not filtered to "not closed," since the section is meant to answer "what has happened to this vehicle," not just "what still needs a decision." */
export async function listIncidentsForVehicle(
  db: ReadDb,
  businessId: string,
  vehicleId: string,
): Promise<IncidentRow[]> {
  const rows = await db
    .select(INCIDENT_COLUMNS)
    .from(incident)
    .where(and(eq(incident.businessId, businessId), eq(incident.vehicleId, vehicleId)))
    .orderBy(desc(incident.occurredOn));
  return rows as IncidentRow[];
}

export interface NewLeaseExtension {
  id: string;
  leaseId: string;
  incidentId: string;
  daysAdded: number;
  appliedOn: string;
  previousEndDate?: string;
  newEndDate: string;
  createdBy?: string;
}

/** D-7/W-9 'extend': its own record, never inferred from two timestamps. */
export async function insertLeaseExtension(db: WriteDb, values: NewLeaseExtension): Promise<void> {
  await db.insert(leaseExtension).values(values);
}

export interface NewInsuranceClaim {
  id: string;
  businessId: string;
  incidentId: string;
  claimedAmountMinor: bigint;
  excessBorneMinor: bigint;
  status: "submitted" | "in_progress" | "settled" | "rejected";
  postedPeriodId: string;
}

/** W-11: optional, off by default. Submitted alongside the paired `incident_recovery` row (source='insurer') in the same transaction — see domain/incident.ts. */
export async function insertInsuranceClaim(db: WriteDb, values: NewInsuranceClaim): Promise<void> {
  await db.insert(insuranceClaim).values(values);
}

export interface InsuranceClaimRow {
  id: string;
  incidentId: string;
  claimedAmountMinor: bigint;
  excessBorneMinor: bigint;
  status: "submitted" | "in_progress" | "settled" | "rejected";
  receivedAmountMinor: bigint | null;
  receivedOn: string | null;
  postedPeriodId: string;
  receivedPeriodId: string | null;
}

const INSURANCE_CLAIM_COLUMNS = {
  id: insuranceClaim.id,
  incidentId: insuranceClaim.incidentId,
  claimedAmountMinor: insuranceClaim.claimedAmountMinor,
  excessBorneMinor: insuranceClaim.excessBorneMinor,
  status: insuranceClaim.status,
  receivedAmountMinor: insuranceClaim.receivedAmountMinor,
  receivedOn: insuranceClaim.receivedOn,
  postedPeriodId: insuranceClaim.postedPeriodId,
  receivedPeriodId: insuranceClaim.receivedPeriodId,
};

export async function findInsuranceClaimForBusiness(
  db: ReadDb,
  businessId: string,
  claimId: string,
): Promise<InsuranceClaimRow | undefined> {
  const rows = await db
    .select(INSURANCE_CLAIM_COLUMNS)
    .from(insuranceClaim)
    .where(and(eq(insuranceClaim.id, claimId), eq(insuranceClaim.businessId, businessId)))
    .limit(1);
  return rows[0] as InsuranceClaimRow | undefined;
}

/**
 * Web-P8a: the incident screen's own read of a claim it already submitted —
 * at most one per incident (app-checked, `InsuranceClaimAlreadyExistsError`),
 * so this is what lets the screen find "was one submitted, and what's its
 * own id to settle" across a reload, the same gap `findIncidentRecoveryBySource`
 * already solves for the recovery half of the same pair.
 */
export async function findInsuranceClaimForIncident(
  db: ReadDb,
  incidentId: string,
): Promise<InsuranceClaimRow | undefined> {
  const rows = await db
    .select(INSURANCE_CLAIM_COLUMNS)
    .from(insuranceClaim)
    .where(eq(insuranceClaim.incidentId, incidentId))
    .limit(1);
  return rows[0] as InsuranceClaimRow | undefined;
}

/**
 * F-3.4 step 5, settling later — often after the claim's own `posted_period_id`
 * has closed (G-2: claimed July, settled September). Migration 0006 is what
 * makes this UPDATE legal: it does not touch `posted_period_id`, so
 * `assert_period_open()` no longer treats it as a re-post into a closed month.
 */
export async function settleInsuranceClaimRow(
  db: WriteDb,
  claimId: string,
  values: {
    status: "settled" | "rejected";
    receivedAmountMinor: bigint;
    receivedOn: string;
    receivedPeriodId?: string;
  },
): Promise<void> {
  await db
    .update(insuranceClaim)
    .set({
      status: values.status,
      receivedAmountMinor: values.receivedAmountMinor,
      receivedOn: values.receivedOn,
      ...(values.receivedPeriodId !== undefined
        ? { receivedPeriodId: values.receivedPeriodId }
        : {}),
    })
    .where(eq(insuranceClaim.id, claimId));
}

export interface NewIncidentRecovery {
  id: string;
  businessId: string;
  incidentId: string;
  source: "customer" | "insurer";
  agreedAmountMinor: bigint;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  note?: string;
  /** GAP-10/A10b: set for `source: 'customer'` — the obligation that makes this agreed amount payable through `POST /api/payment`. An insurer is never a payer there, so `source: 'insurer'` never sets this. */
  obligationId?: string;
}

/** W-10/W-11: money EXPECTED until it arrives, never earned — `received_amount_minor` starts at 0 and is filled in later by `recordIncidentRecoveryReceived`. */
export async function insertIncidentRecovery(
  db: WriteDb,
  values: NewIncidentRecovery,
): Promise<void> {
  await db.insert(incidentRecovery).values(values);
}

export interface IncidentRecoveryRow {
  id: string;
  incidentId: string;
  source: "customer" | "insurer";
  agreedAmountMinor: bigint;
  receivedAmountMinor: bigint;
  /** GAP-10/A10b: set for `source: 'customer'` only — what `recordRecoveryReceived` settles alongside `received_amount_minor` so the two never disagree. */
  obligationId: string | null;
  postedPeriodId: string;
  receivedPeriodId: string | null;
  belongsToPeriodId: string | null;
  voidedAt: string | null;
}

const INCIDENT_RECOVERY_COLUMNS = {
  id: incidentRecovery.id,
  incidentId: incidentRecovery.incidentId,
  source: incidentRecovery.source,
  agreedAmountMinor: incidentRecovery.agreedAmountMinor,
  receivedAmountMinor: incidentRecovery.receivedAmountMinor,
  obligationId: incidentRecovery.obligationId,
  postedPeriodId: incidentRecovery.postedPeriodId,
  receivedPeriodId: incidentRecovery.receivedPeriodId,
  belongsToPeriodId: incidentRecovery.belongsToPeriodId,
  voidedAt: incidentRecovery.voidedAt,
};

export async function findIncidentRecoveryForBusiness(
  db: ReadDb,
  businessId: string,
  recoveryId: string,
): Promise<IncidentRecoveryRow | undefined> {
  const rows = await db
    .select(INCIDENT_RECOVERY_COLUMNS)
    .from(incidentRecovery)
    .where(and(eq(incidentRecovery.id, recoveryId), eq(incidentRecovery.businessId, businessId)))
    .limit(1);
  return rows[0] as IncidentRecoveryRow | undefined;
}

/** The insurer's own recovery row for this incident — at most one, paired 1:1 with the `insurance_claim` submitted alongside it. */
export async function findIncidentRecoveryBySource(
  db: ReadDb,
  incidentId: string,
  source: "customer" | "insurer",
): Promise<IncidentRecoveryRow | undefined> {
  const rows = await db
    .select(INCIDENT_RECOVERY_COLUMNS)
    .from(incidentRecovery)
    .where(
      and(
        eq(incidentRecovery.incidentId, incidentId),
        eq(incidentRecovery.source, source),
        isNull(incidentRecovery.voidedAt),
      ),
    )
    .limit(1);
  return rows[0] as IncidentRecoveryRow | undefined;
}

/** F-3.4 step 6, "the bottom line" — voided rows (W-50) never count toward it. */
export async function listIncidentRecoveries(
  db: ReadDb,
  incidentId: string,
): Promise<IncidentRecoveryRow[]> {
  const rows = await db
    .select(INCIDENT_RECOVERY_COLUMNS)
    .from(incidentRecovery)
    .where(and(eq(incidentRecovery.incidentId, incidentId), isNull(incidentRecovery.voidedAt)));
  return rows as IncidentRecoveryRow[];
}

/** GAP-12/W-61/INV-36 §3.9: void, never delete — the `voidExpense` shape, `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber. */
export async function voidIncidentRecoveryRow(
  db: WriteDb,
  recoveryId: string,
  values: { voidedReason: string; voidedBy: string },
): Promise<{ voidedAt: string } | undefined> {
  const rows = await db
    .update(incidentRecovery)
    .set({ voidedAt: sql`now()`, voidedReason: values.voidedReason, voidedBy: values.voidedBy })
    .where(and(eq(incidentRecovery.id, recoveryId), isNull(incidentRecovery.voidedAt)))
    .returning({ voidedAt: incidentRecovery.voidedAt });
  return rows[0] as { voidedAt: string } | undefined;
}

/** F-3.4 steps 4/5: the same update serves both a customer contribution and an insurer settlement — see migration 0006 for why this UPDATE remains legal once `posted_period_id`'s own month has closed. */
export async function recordIncidentRecoveryReceived(
  db: WriteDb,
  recoveryId: string,
  values: { receivedAmountMinor: bigint; receivedPeriodId?: string },
): Promise<void> {
  await db
    .update(incidentRecovery)
    .set({
      receivedAmountMinor: values.receivedAmountMinor,
      ...(values.receivedPeriodId !== undefined
        ? { receivedPeriodId: values.receivedPeriodId }
        : {}),
    })
    .where(eq(incidentRecovery.id, recoveryId));
}
