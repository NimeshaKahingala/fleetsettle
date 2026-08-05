import {
  addDays,
  inclusiveDays,
  newId,
  splitInteger,
  type BusinessDate,
  type Minor,
} from "@fleetsettle/shared";
import type { Reader, Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import {
  InsuranceClaimAlreadyExistsError,
  NotFoundError,
  PeriodClosedError,
  ValidationError,
} from "../errors/app-error.js";
import { findPeriodForDate, resolvePeriodLinkage } from "../queries/accounting-period.js";
import { findBillingPeriodCoveringDate } from "../queries/billing-period.js";
import { sumIncidentCostMinor } from "../queries/expense.js";
import {
  closeIncidentRow,
  findIncidentForBusiness,
  findIncidentRecoveryBySource,
  findIncidentRecoveryForBusiness,
  findInsuranceClaimForBusiness,
  insertIncident,
  insertIncidentRecovery,
  insertInsuranceClaim,
  insertLeaseExtension,
  listIncidentRecoveries,
  recordIncidentRecoveryReceived,
  settleInsuranceClaimRow,
  updateIncidentOffRoad,
  type IncidentRecoveryRow,
  type IncidentRow,
  type InsuranceClaimRow,
} from "../queries/incident.js";
import { findLeaseForBusiness, updateLeaseEndDate } from "../queries/lease.js";
import { findObligationBySource } from "../queries/obligation.js";
import { applyAdjustmentTx } from "./adjustment.js";

export interface OpenIncidentInput {
  businessId: string;
  vehicleId: string;
  leaseId?: string;
  occurredOn: BusinessDate;
  description?: string;
}

export interface OpenedIncident {
  incidentId: string;
}

/** F-3.4 step 1: the container, opened with its minimal fields — everything after is a separate edit, days or weeks apart (§6.6). Not a wizard. */
export async function openIncident(
  writer: Writer,
  input: OpenIncidentInput,
): Promise<OpenedIncident> {
  const incidentId = newId();
  await insertIncident(writer, {
    id: incidentId,
    businessId: input.businessId,
    vehicleId: input.vehicleId,
    ...(input.leaseId !== undefined ? { leaseId: input.leaseId } : {}),
    occurredOn: input.occurredOn,
    ...(input.description !== undefined ? { description: input.description } : {}),
  });
  return { incidentId };
}

export interface RecordOffRoadInput {
  businessId: string;
  incidentId: string;
  offRoadFrom: BusinessDate;
  offRoadTo: BusinessDate;
  rentTreatment: "continue" | "credit_days" | "extend";
  occurredOn: BusinessDate;
  userId: string;
}

export interface RecordedOffRoad {
  incident: IncidentRow;
  leaseExtensionId?: string;
  adjustmentId?: string;
}

/**
 * F-3.4 step 2/W-9, one transaction: the off-road window and the rent
 * treatment chosen "for this incident only." `continue` touches nothing
 * further (the safe, do-nothing default). `credit_days` applies a pro-rata
 * discount (largest-remainder, the same convention as INV-26's mileage
 * split) against the billing period's own rent obligation. `extend` pushes
 * `lease.end_date` out and records why (D-7) — the added days' own mileage
 * allowance follows automatically the next time F-2.3 runs, no recalculation.
 */
export async function recordOffRoad(
  writer: Writer,
  input: RecordOffRoadInput,
): Promise<RecordedOffRoad> {
  return writer.transaction(async (tx) => {
    const existing = await findIncidentForBusiness(tx, input.businessId, input.incidentId);
    if (!existing) throw new NotFoundError("No such incident in this business");

    await updateIncidentOffRoad(tx, input.incidentId, {
      offRoadFrom: input.offRoadFrom,
      offRoadTo: input.offRoadTo,
      rentTreatment: input.rentTreatment,
    });

    const incidentAfter: IncidentRow = {
      ...existing,
      offRoadFrom: input.offRoadFrom,
      offRoadTo: input.offRoadTo,
      rentTreatment: input.rentTreatment,
    };

    if (input.rentTreatment === "continue") {
      return { incident: incidentAfter };
    }

    if (!existing.leaseId) {
      throw new ValidationError("This incident has no lease to apply a rent treatment to");
    }
    const lease = await findLeaseForBusiness(tx, input.businessId, existing.leaseId);
    if (!lease) throw new NotFoundError("No such lease in this business");

    if (input.rentTreatment === "extend") {
      if (!lease.endDate) {
        throw new ValidationError("This lease has no end date to extend");
      }
      const daysAdded = inclusiveDays(input.offRoadFrom, input.offRoadTo);
      const previousEndDate = lease.endDate;
      const newEndDate = addDays(previousEndDate as BusinessDate, daysAdded);

      await updateLeaseEndDate(tx, lease.id, newEndDate);
      const leaseExtensionId = newId();
      await insertLeaseExtension(tx, {
        id: leaseExtensionId,
        leaseId: lease.id,
        incidentId: input.incidentId,
        daysAdded,
        appliedOn: input.occurredOn,
        previousEndDate,
        newEndDate,
        createdBy: input.userId,
      });

      return { incident: incidentAfter, leaseExtensionId };
    }

    // credit_days
    const period = await findBillingPeriodCoveringDate(tx, lease.id, input.offRoadFrom);
    if (!period) {
      throw new ValidationError("No billing period covers the off-road start date");
    }
    const clippedTo = input.offRoadTo < period.periodEnd ? input.offRoadTo : period.periodEnd;
    const offRoadDaysInPeriod = inclusiveDays(input.offRoadFrom, clippedTo as BusinessDate);
    const remainingDays = period.daysCount - offRoadDaysInPeriod;
    if (remainingDays < 0) {
      throw new ValidationError("The off-road window is longer than the billing period itself");
    }

    let adjustmentId: string | undefined;
    if (offRoadDaysInPeriod > 0) {
      const [creditMinor] = splitInteger(period.rentAmountMinor, [
        BigInt(offRoadDaysInPeriod),
        BigInt(remainingDays),
      ]);

      const obligationRow = await findObligationBySource(tx, "billing_period", period.id);
      if (!obligationRow)
        throw new NotFoundError("No rent obligation found for this billing period");

      if (creditMinor !== undefined && creditMinor > 0n) {
        const applied = await applyAdjustmentTx(tx, {
          businessId: input.businessId,
          obligationId: obligationRow.id,
          adjustmentType: "agreed_discount",
          amountMinor: creditMinor as Minor,
          sign: -1,
          reason: `Incident ${input.incidentId}: ${String(offRoadDaysInPeriod)} off-road day(s) credited`,
          occurredOn: input.offRoadFrom,
          userId: input.userId,
        });
        adjustmentId = applied.adjustmentId;
      }
    }

    return { incident: incidentAfter, ...(adjustmentId !== undefined ? { adjustmentId } : {}) };
  });
}

export interface RecordCustomerContributionInput {
  businessId: string;
  incidentId: string;
  agreedAmountMinor: Minor;
  agreedOn: BusinessDate;
  note?: string;
}

export interface RecordedCustomerContribution {
  recoveryId: string;
}

/**
 * F-3.4 step 4/W-10: negotiated after the repair cost is known, so this is a
 * separate edit against an already-open incident, entered whenever the
 * agreement happens — not part of opening the incident. `obligation_id`
 * stays NULL here (a deliberate simplification, recorded rather than
 * guessed at): F-3.4's own "Writes" line does not list `Obligation`, and
 * turning "payable in instalments or from the deposit" into a real
 * receivable is real design work this pass does not do.
 */
export async function recordCustomerContribution(
  writer: Writer,
  input: RecordCustomerContributionInput,
): Promise<RecordedCustomerContribution> {
  const existing = await findIncidentForBusiness(writer, input.businessId, input.incidentId);
  if (!existing) throw new NotFoundError("No such incident in this business");

  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.agreedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const recoveryId = newId();
  try {
    // withActor (db/client.ts) only attributes writes inside a real
    // transaction — wrapped here for that reason (F-8.6): incident_recovery
    // carries posted_period_id and is audited.
    await writer.transaction((tx) =>
      insertIncidentRecovery(tx, {
        id: recoveryId,
        businessId: input.businessId,
        incidentId: input.incidentId,
        source: "customer",
        agreedAmountMinor: input.agreedAmountMinor,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      }),
    );
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return { recoveryId };
}

export interface RecordRecoveryReceivedInput {
  businessId: string;
  recoveryId: string;
  receivedAmountMinor: Minor;
  receivedOn: BusinessDate;
}

export interface RecordedRecoveryReceived {
  recovery: IncidentRecoveryRow;
}

/**
 * F-3.4 steps 4/5, the money actually arriving — shared by a customer's
 * contribution and (indirectly, via `settleInsuranceClaim` below) the
 * insurer's. `received_period_id` is the period covering `receivedOn`,
 * open or closed (W-35's `findPeriodForDate`) — it is not gated by
 * `assert_period_open()`, only `posted_period_id` is. Migration 0006 is
 * what makes this UPDATE legal once the original `posted_period_id` month
 * (often much earlier) has itself closed.
 */
export async function recordRecoveryReceived(
  writer: Writer,
  input: RecordRecoveryReceivedInput,
): Promise<RecordedRecoveryReceived> {
  const recovery = await findIncidentRecoveryForBusiness(
    writer,
    input.businessId,
    input.recoveryId,
  );
  if (!recovery || recovery.voidedAt !== null) {
    throw new NotFoundError("No such recovery in this business");
  }

  const receivedPeriod = await findPeriodForDate(writer, input.businessId, input.receivedOn);

  // See recordCustomerContribution's own comment.
  await writer.transaction((tx) =>
    recordIncidentRecoveryReceived(tx, input.recoveryId, {
      receivedAmountMinor: input.receivedAmountMinor,
      ...(receivedPeriod ? { receivedPeriodId: receivedPeriod.id } : {}),
    }),
  );

  return {
    recovery: {
      ...recovery,
      receivedAmountMinor: input.receivedAmountMinor,
      receivedPeriodId: receivedPeriod?.id ?? null,
    },
  };
}

export interface SubmitInsuranceClaimInput {
  businessId: string;
  incidentId: string;
  claimedAmountMinor: Minor;
  excessBorneMinor: Minor;
  claimedOn: BusinessDate;
}

export interface SubmittedInsuranceClaim {
  claimId: string;
  recoveryId: string;
  agreedAmountMinor: Minor;
}

/**
 * F-3.4 step 5/W-11, one transaction: the claim's own lifecycle record
 * (`insurance_claim`) and the paired `incident_recovery` (source='insurer')
 * that actually feeds the month-by-month report — `agreed_amount_minor` is
 * what you can recover, claimed minus the excess you bear (§7.2:
 * 75,000 − 15,000 = 60,000). Both rows are written together so they can
 * never drift; `settleInsuranceClaim` below updates both together too.
 */
export async function submitInsuranceClaim(
  writer: Writer,
  input: SubmitInsuranceClaimInput,
): Promise<SubmittedInsuranceClaim> {
  return writer.transaction(async (tx) => {
    const existing = await findIncidentForBusiness(tx, input.businessId, input.incidentId);
    if (!existing) throw new NotFoundError("No such incident in this business");

    const already = await findIncidentRecoveryBySource(tx, input.incidentId, "insurer");
    if (already) throw new InsuranceClaimAlreadyExistsError();

    if (input.excessBorneMinor > input.claimedAmountMinor) {
      throw new ValidationError("The excess borne cannot exceed the amount claimed");
    }

    const linkage = await resolvePeriodLinkage(tx, input.businessId, input.claimedOn);
    if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

    const agreedAmountMinor = (input.claimedAmountMinor - input.excessBorneMinor) as Minor;
    const claimId = newId();
    const recoveryId = newId();

    try {
      await insertInsuranceClaim(tx, {
        id: claimId,
        businessId: input.businessId,
        incidentId: input.incidentId,
        claimedAmountMinor: input.claimedAmountMinor,
        excessBorneMinor: input.excessBorneMinor,
        status: "submitted",
        postedPeriodId: linkage.postedPeriodId,
      });
      await insertIncidentRecovery(tx, {
        id: recoveryId,
        businessId: input.businessId,
        incidentId: input.incidentId,
        source: "insurer",
        agreedAmountMinor,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      });
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      throw err;
    }

    return { claimId, recoveryId, agreedAmountMinor };
  });
}

export interface SettleInsuranceClaimInput {
  businessId: string;
  claimId: string;
  receivedAmountMinor: Minor;
  receivedOn: BusinessDate;
  status?: "settled" | "rejected";
}

export interface SettledInsuranceClaim {
  claim: InsuranceClaimRow;
  recovery?: IncidentRecoveryRow;
}

/**
 * F-3.4 step 5, later — often much later, and often after the claim's own
 * `posted_period_id` month has closed (§7.2: claimed July, settled
 * September). Updates the claim and its paired recovery row together, in
 * one transaction, so "recovered" never means something different on the
 * two tables.
 */
export async function settleInsuranceClaim(
  writer: Writer,
  input: SettleInsuranceClaimInput,
): Promise<SettledInsuranceClaim> {
  return writer.transaction(async (tx) => {
    const claim = await findInsuranceClaimForBusiness(tx, input.businessId, input.claimId);
    if (!claim) throw new NotFoundError("No such insurance claim in this business");

    const receivedPeriod = await findPeriodForDate(tx, input.businessId, input.receivedOn);
    const status = input.status ?? "settled";

    await settleInsuranceClaimRow(tx, input.claimId, {
      status,
      receivedAmountMinor: input.receivedAmountMinor,
      receivedOn: input.receivedOn,
      ...(receivedPeriod ? { receivedPeriodId: receivedPeriod.id } : {}),
    });

    const recovery = await findIncidentRecoveryBySource(tx, claim.incidentId, "insurer");
    if (recovery) {
      await recordIncidentRecoveryReceived(tx, recovery.id, {
        receivedAmountMinor: input.receivedAmountMinor,
        ...(receivedPeriod ? { receivedPeriodId: receivedPeriod.id } : {}),
      });
    }

    return {
      claim: {
        ...claim,
        status,
        receivedAmountMinor: input.receivedAmountMinor,
        receivedOn: input.receivedOn,
        receivedPeriodId: receivedPeriod?.id ?? null,
      },
      ...(recovery !== undefined
        ? {
            recovery: {
              ...recovery,
              receivedAmountMinor: input.receivedAmountMinor,
              receivedPeriodId: receivedPeriod?.id ?? null,
            },
          }
        : {}),
    };
  });
}

/** F-3.4: closed manually, whenever repairs and recoveries are settled — no automatic status transition attempted here (a deliberate simplification: the enum's `repairs_recorded`/`recovery_pending` states are not driven from anywhere in this pass). */
export async function closeIncident(
  writer: Writer,
  businessId: string,
  incidentId: string,
  closedAt: string,
): Promise<IncidentRow> {
  const existing = await findIncidentForBusiness(writer, businessId, incidentId);
  if (!existing) throw new NotFoundError("No such incident in this business");
  await closeIncidentRow(writer, incidentId, closedAt);
  return { ...existing, status: "closed", closedAt };
}

export interface IncidentBottomLine {
  totalRepairCostMinor: Minor;
  totalRecoveredMinor: Minor;
  pendingRecoveryMinor: Minor;
  netCostMinor: Minor;
}

/**
 * F-3.4 step 6/UC-12: "total repair cost, total recovered, still expected,
 * and net cost to you" — a live snapshot as of now, not the month-by-month
 * table (§7.2's own report, built from the same `posted`/`received`/
 * `belongs_to` period columns, is P11's, the same deferral already made for
 * P7's partner reports).
 */
export async function computeIncidentBottomLine(
  reader: Reader,
  incidentId: string,
): Promise<IncidentBottomLine> {
  const totalRepairCostMinor = await sumIncidentCostMinor(reader, incidentId);
  const recoveries = await listIncidentRecoveries(reader, incidentId);

  const totalRecoveredMinor = recoveries.reduce((sum, r) => sum + r.receivedAmountMinor, 0n);
  const totalAgreedMinor = recoveries.reduce((sum, r) => sum + r.agreedAmountMinor, 0n);

  return {
    totalRepairCostMinor: totalRepairCostMinor as Minor,
    totalRecoveredMinor: totalRecoveredMinor as Minor,
    pendingRecoveryMinor: (totalAgreedMinor - totalRecoveredMinor) as Minor,
    netCostMinor: (totalRepairCostMinor - totalRecoveredMinor) as Minor,
  };
}
