import { asc, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { mileageAssessment, mileageAssessmentSplit } from "../db/schema.js";

type WriteDb = Writer | Tx;
type ReadDb = Reader | Writer | Tx;

export interface NewMileageAssessment {
  id: string;
  leaseId: string;
  businessId: string;
  fromReadingId?: string;
  toReadingId: string;
  drivenKm: number;
  combinedAllowanceKm: number;
  excessKm: number;
  excessAmountMinor: bigint;
  isEstimated: boolean;
  status: "provisional" | "final" | "superseded";
  postedPeriodId: string;
  belongsToPeriodId?: string;
}

/** UC-14: one assessment may span two billing periods when a boundary reading is missing (`isEstimated`). */
export async function insertMileageAssessment(
  db: WriteDb,
  values: NewMileageAssessment,
): Promise<void> {
  await db.insert(mileageAssessment).values(values);
}

export interface NewMileageAssessmentSplit {
  id: string;
  assessmentId: string;
  billingPeriodId: string;
  apportionedKm: number;
  apportionedExcessMinor: bigint;
}

/** INV-26: largest-remainder, and `split_sums` (the deferred constraint trigger) is the truth that these sum to the parent — never a pre-check here. */
export async function insertMileageAssessmentSplit(
  db: WriteDb,
  values: NewMileageAssessmentSplit,
): Promise<void> {
  await db.insert(mileageAssessmentSplit).values(values);
}

export interface MileageAssessmentRow {
  id: string;
  leaseId: string;
  drivenKm: number;
  combinedAllowanceKm: number;
  excessKm: number;
  excessAmountMinor: bigint;
  isEstimated: boolean;
  status: "provisional" | "final" | "superseded";
}

const ASSESSMENT_COLUMNS = {
  id: mileageAssessment.id,
  leaseId: mileageAssessment.leaseId,
  drivenKm: mileageAssessment.drivenKm,
  combinedAllowanceKm: mileageAssessment.combinedAllowanceKm,
  excessKm: mileageAssessment.excessKm,
  excessAmountMinor: mileageAssessment.excessAmountMinor,
  isEstimated: mileageAssessment.isEstimated,
  status: mileageAssessment.status,
};

/** The idempotency read for a replayed `odometer_reading` submission (0005's unique index) — the assessment that reading's own insert already produced. */
export async function findMileageAssessmentByToReading(
  db: ReadDb,
  toReadingId: string,
): Promise<MileageAssessmentRow | undefined> {
  const rows = await db
    .select(ASSESSMENT_COLUMNS)
    .from(mileageAssessment)
    .where(eq(mileageAssessment.toReadingId, toReadingId))
    .limit(1);
  return rows[0] as MileageAssessmentRow | undefined;
}

export interface MileageAssessmentSplitRow {
  billingPeriodId: string;
  apportionedKm: number;
  apportionedExcessMinor: bigint;
}

export async function findSplitsForAssessment(
  db: WriteDb,
  assessmentId: string,
): Promise<MileageAssessmentSplitRow[]> {
  const rows = await db
    .select({
      billingPeriodId: mileageAssessmentSplit.billingPeriodId,
      apportionedKm: mileageAssessmentSplit.apportionedKm,
      apportionedExcessMinor: mileageAssessmentSplit.apportionedExcessMinor,
    })
    .from(mileageAssessmentSplit)
    .where(eq(mileageAssessmentSplit.assessmentId, assessmentId))
    .orderBy(asc(mileageAssessmentSplit.id));
  return rows;
}
