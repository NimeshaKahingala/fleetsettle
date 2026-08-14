import { newId, splitInteger, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import { NotFoundError, PeriodClosedError, ValidationError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findBillingPeriodsInRange, type BillingPeriodRow } from "../queries/billing-period.js";
import { findBusinessSettings } from "../queries/business.js";
import { findLeaseForBusiness } from "../queries/lease.js";
import {
  findMileageAssessmentByToReading,
  findSplitsForAssessment,
  insertMileageAssessment,
  insertMileageAssessmentSplit,
  type MileageAssessmentRow,
  type MileageAssessmentSplitRow,
} from "../queries/mileage-assessment.js";
import {
  findLatestOdometerReadingForLease,
  findOdometerReadingByLeaseAndDate,
  insertOdometerReading,
} from "../queries/odometer-reading.js";
import { insertAdjustment } from "../queries/adjustment.js";
import { insertObligation, findObligationBySource } from "../queries/obligation.js";
import { applyCreditForward } from "./credit-forward.js";
import { computeObligationStatus } from "./obligation-status.js";

export interface AssessMileageInput {
  businessId: string;
  leaseId: string;
  readingKm: number;
  readOn: BusinessDate;
  source: "photo" | "in_person" | "reported" | "at_return";
  userId: string;
}

export interface AssessedMileage {
  assessment: MileageAssessmentRow;
  splits: MileageAssessmentSplitRow[];
  obligationId: string | null;
  autoWaived: boolean;
  created: boolean;
}

/**
 * F-2.3/UC-14, one transaction: an `odometer_reading`, the `mileage_assessment`
 * it closes out, its per-period `mileage_assessment_split` rows when a
 * boundary reading was missing (INV-26), and the excess `obligation` it
 * raises — auto-waived on the spot when it is at or below
 * `businessSettings.autoWaiveThresholdMinor` (F-2.4: "an excess below the
 * auto-waive threshold never surfaces — and is still recorded as waived").
 *
 * Which billing period(s) this reading closes out is derived from the date
 * range since the *previous* reading, never chosen by the caller — exactly
 * §7.3's missing-March-reading case, where the next reading combines two
 * periods against their combined allowance (W-25: one-directional, so the
 * combination can only ever add, never favour the customer less than
 * separate readings would have).
 */
export async function assessMileage(
  writer: Writer,
  input: AssessMileageInput,
): Promise<AssessedMileage> {
  try {
    return await writer.transaction(async (tx) => {
      const lease = await findLeaseForBusiness(tx, input.businessId, input.leaseId);
      if (!lease) throw new NotFoundError("No such lease in this business");
      if (lease.mileageDailyLimitKm === null || lease.mileageExcessRateMinor === null) {
        throw new ValidationError("This lease has no mileage limit — nothing to assess");
      }

      // Idempotent on (lease_id, read_on) — a second submission for the same
      // lease and date is a replay, not a new fact. Checked up front, not
      // only caught at insert time: by the time of a genuine replay, this
      // reading is itself the *latest* one for the lease, and computing
      // "driven since the previous reading" from it would produce a
      // nonsensical zero-period assessment instead of the original result.
      const alreadyRecorded = await findOdometerReadingByLeaseAndDate(
        tx,
        input.leaseId,
        input.readOn,
      );
      if (alreadyRecorded) {
        const replayed = await replayAssessment(tx, alreadyRecorded.id);
        if (replayed) return replayed;
      }

      const previous = await findLatestOdometerReadingForLease(tx, input.leaseId);
      if (!previous) {
        throw new ValidationError(
          "No prior odometer reading for this lease — record the handover reading first",
        );
      }

      const drivenKm = input.readingKm - previous.readingKm;
      if (drivenKm < 0) {
        throw new ValidationError("This reading is lower than the last one recorded");
      }

      const periods = await findBillingPeriodsInRange(
        tx,
        input.leaseId,
        previous.readOn,
        input.readOn,
      );
      if (periods.length === 0) {
        throw new ValidationError("This reading does not close out any billing period yet");
      }

      const allowances = periods.map((p) => {
        if (p.allowanceKm === null) {
          throw new ValidationError("A billing period in range has no recorded mileage allowance");
        }
        return p.allowanceKm;
      });
      const combinedAllowanceKm = allowances.reduce((sum, a) => sum + a, 0);
      const excessKm = Math.max(0, drivenKm - combinedAllowanceKm);
      const excessAmountMinor = (BigInt(excessKm) * lease.mileageExcessRateMinor) as Minor;
      const isEstimated = periods.length > 1;

      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.readOn);
      if (!linkage)
        throw new PeriodClosedError("No accounting period covers this business date yet");
      const periodFields = {
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      };

      const readingId = newId();
      await insertOdometerReading(tx, {
        id: readingId,
        businessId: input.businessId,
        vehicleId: lease.vehicleId,
        readingKm: input.readingKm,
        readOn: input.readOn,
        source: input.source,
        leaseId: input.leaseId,
      });

      const assessmentId = newId();
      await insertMileageAssessment(tx, {
        id: assessmentId,
        leaseId: input.leaseId,
        businessId: input.businessId,
        fromReadingId: previous.id,
        toReadingId: readingId,
        drivenKm,
        combinedAllowanceKm,
        excessKm,
        excessAmountMinor,
        isEstimated,
        status: "final",
        ...periodFields,
      });

      const splits = await writeSplitsIfCombined(
        tx,
        assessmentId,
        periods,
        excessKm,
        lease.mileageExcessRateMinor,
      );

      let obligationId: string | null = null;
      let autoWaived = false;
      if (excessAmountMinor > 0n) {
        const settings = await findBusinessSettings(tx, input.businessId);
        // eslint-disable-next-line no-restricted-syntax -- OQ-3/W-43: a blank threshold means zero, waive nothing — not missing data standing in for zero
        const threshold = settings?.autoWaiveThresholdMinor ?? 0n;
        autoWaived = excessAmountMinor <= threshold;

        obligationId = newId();
        await insertObligation(tx, {
          id: obligationId,
          businessId: input.businessId,
          direction: "owed_to_us",
          partyType: "customer",
          partyCustomerId: lease.customerId,
          kind: "mileage_excess",
          sourceType: "mileage_assessment",
          sourceId: assessmentId,
          vehicleId: lease.vehicleId,
          amountMinor: excessAmountMinor,
          settledMinor: 0n,
          waivedMinor: autoWaived ? excessAmountMinor : 0n,
          dueOn: input.readOn,
          effectiveDueOn: input.readOn,
          status: autoWaived
            ? computeObligationStatus(excessAmountMinor, 0n, excessAmountMinor)
            : "pending",
          ...periodFields,
        });

        if (autoWaived) {
          await insertAdjustment(tx, {
            id: newId(),
            businessId: input.businessId,
            obligationId,
            adjustmentType: "auto_waiver",
            amountMinor: excessAmountMinor,
            sign: -1,
            reason: "Below the auto-waive threshold (F-2.4)",
            occurredOn: input.readOn,
            createdBy: input.userId,
            ...periodFields,
          });
        } else {
          // GAP-5b: an auto-waived obligation has nothing left to draw
          // credit against (waivedMinor already covers it) — only the
          // genuinely outstanding case applies forward.
          await applyCreditForward(
            tx,
            input.businessId,
            "customer",
            lease.customerId,
            "owed_to_us",
            obligationId,
            excessAmountMinor,
            input.readOn,
          );
        }
      }

      return {
        assessment: {
          id: assessmentId,
          leaseId: input.leaseId,
          drivenKm,
          combinedAllowanceKm,
          excessKm,
          excessAmountMinor,
          isEstimated,
          status: "final",
        },
        splits,
        obligationId,
        autoWaived,
        created: true,
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "odometer_reading_lease_id_read_on_key")) {
      // The race this guards: two concurrent submissions both passed the
      // up-front check above and both tried to insert — one wins, the other
      // lands here. Read its own writer connection rather than `tx` (rolled
      // back with the losing transaction).
      const reading = await findOdometerReadingByLeaseAndDate(writer, input.leaseId, input.readOn);
      const replayed = reading ? await replayAssessment(writer, reading.id) : undefined;
      if (replayed) return replayed;
    }
    throw err;
  }
}

/** The idempotent-replay read: the assessment a prior identical submission already produced, keyed off the reading it closed out. */
async function replayAssessment(
  db: Tx | Writer,
  readingId: string,
): Promise<AssessedMileage | undefined> {
  const assessment = await findMileageAssessmentByToReading(db, readingId);
  if (!assessment) return undefined;

  const splits = await findSplitsForAssessment(db, assessment.id);
  const obligationRow = await findObligationBySource(db, "mileage_assessment", assessment.id);
  return {
    assessment,
    splits,
    obligationId: obligationRow?.id ?? null,
    autoWaived: obligationRow ? obligationRow.status === "waived" : false,
    created: false,
  };
}

async function writeSplitsIfCombined(
  tx: Tx,
  assessmentId: string,
  periods: BillingPeriodRow[],
  excessKm: number,
  excessRateMinor: bigint,
): Promise<MileageAssessmentSplitRow[]> {
  if (periods.length <= 1) return [];

  const apportionedKm = splitInteger(
    BigInt(excessKm),
    periods.map((p) => BigInt(p.daysCount)),
  );

  const rows: MileageAssessmentSplitRow[] = [];
  for (const [i, period] of periods.entries()) {
    const km = apportionedKm[i];
    if (km === undefined) {
      throw new Error(
        "splitInteger returned fewer parts than periods — unreachable by construction",
      );
    }
    const apportionedExcessMinor = km * excessRateMinor;
    // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
    const apportionedKmNumber = Number(km);
    await insertMileageAssessmentSplit(tx, {
      id: newId(),
      assessmentId,
      billingPeriodId: period.id,
      apportionedKm: apportionedKmNumber,
      apportionedExcessMinor,
    });
    rows.push({
      billingPeriodId: period.id,
      apportionedKm: apportionedKmNumber,
      apportionedExcessMinor,
    });
  }
  return rows;
}
