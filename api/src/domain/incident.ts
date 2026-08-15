import {
  addDays,
  inclusiveDays,
  newId,
  splitInteger,
  type BusinessDate,
  type Minor,
} from "@fleetsettle/shared";
import type { Reader, Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  IncidentRecoveryAlreadyVoidedError,
  InsuranceClaimAlreadyExistsError,
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
  ValidationError,
  VoidBlockedError,
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
  voidIncidentRecoveryRow,
  type IncidentRecoveryRow,
  type IncidentRow,
  type InsuranceClaimRow,
} from "../queries/incident.js";
import { findLeaseForBusiness, updateLeaseEndDate } from "../queries/lease.js";
import {
  findObligationBySource,
  insertObligation,
  updateObligationSettled,
  voidObligationBySource,
} from "../queries/obligation.js";
import {
  findPaymentAllocationsForObligation,
  insertPayment,
  insertPaymentAllocation,
  markPaymentReversed,
  voidPaymentAllocation,
} from "../queries/payment.js";
import { applyAdjustmentTx } from "./adjustment.js";
import { applyCreditForward } from "./credit-forward.js";
import { computeObligationStatus } from "./obligation-status.js";

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
  replacesId?: string;
}

export interface RecordedCustomerContribution {
  recoveryId: string;
}

/**
 * F-3.4 step 4/W-10, one transaction: negotiated after the repair cost is
 * known, so this is a separate edit against an already-open incident,
 * entered whenever the agreement happens — not part of opening the
 * incident. Since D-9/GAP-10 (user-flows.md F-3.4, 9 August 2026), agreeing
 * the amount also opens an `Obligation` against the incident's own
 * customer — without it, "payable in one go, in instalments, or from the
 * deposit" has nothing for `POST /api/payment` to allocate against. This
 * requires the incident to carry a `leaseId`: no lease means no customer,
 * and a contribution nobody can be billed to is not a receivable.
 */
export async function recordCustomerContribution(
  writer: Writer,
  input: RecordCustomerContributionInput,
): Promise<RecordedCustomerContribution> {
  const existing = await findIncidentForBusiness(writer, input.businessId, input.incidentId);
  if (!existing) throw new NotFoundError("No such incident in this business");
  if (!existing.leaseId) {
    throw new ValidationError(
      "This incident has no lease, so there is no customer to bill a contribution to",
    );
  }

  const lease = await findLeaseForBusiness(writer, input.businessId, existing.leaseId);
  if (!lease) throw new NotFoundError("No such lease in this business");

  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.agreedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  if (input.replacesId !== undefined) {
    const target = await findIncidentRecoveryForBusiness(
      writer,
      input.businessId,
      input.replacesId,
    );
    if (!target) throw new NotFoundError("No such recovery in this business");
    if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
    // Found by Gitar's review of PR #45: without this, replacesId could name
    // a voided recovery against a *different* incident, leaving F-8.6's
    // "what corrected this?" pointing at an unrelated fact.
    if (target.incidentId !== input.incidentId) {
      throw new ValidationError("replacesId names a recovery against a different incident");
    }
  }

  const recoveryId = newId();
  const obligationId = newId();
  try {
    // withActor (db/client.ts) only attributes writes inside a real
    // transaction — wrapped here for that reason (F-8.6): both rows carry
    // posted_period_id and are audited.
    await writer.transaction(async (tx) => {
      await insertObligation(tx, {
        id: obligationId,
        businessId: input.businessId,
        direction: "owed_to_us",
        partyType: "customer",
        partyCustomerId: lease.customerId,
        kind: "customer_contribution",
        sourceType: "incident_recovery",
        sourceId: recoveryId,
        vehicleId: existing.vehicleId,
        amountMinor: input.agreedAmountMinor,
        settledMinor: 0n,
        waivedMinor: 0n,
        dueOn: input.agreedOn,
        effectiveDueOn: input.agreedOn,
        status: "pending",
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      });
      await insertIncidentRecovery(tx, {
        id: recoveryId,
        businessId: input.businessId,
        incidentId: input.incidentId,
        source: "customer",
        agreedAmountMinor: input.agreedAmountMinor,
        obligationId,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });

      // GAP-5b: a customer already carrying unapplied credit has this
      // contribution settled from it immediately.
      await applyCreditForward(
        tx,
        input.businessId,
        "customer",
        lease.customerId,
        "owed_to_us",
        obligationId,
        input.agreedAmountMinor,
        input.agreedOn,
      );
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "incident_recovery_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
    throw err;
  }

  return { recoveryId };
}

export interface RecordRecoveryReceivedInput {
  businessId: string;
  recoveryId: string;
  receivedAmountMinor: Minor;
  receivedOn: BusinessDate;
  userId: string;
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
 *
 * GAP-10/A10b: a customer-sourced recovery now carries an `obligationId`
 * (an insurer's never does — insurers are never `POST /api/payment`
 * parties). Left alone, this endpoint would update `incident_recovery`
 * while the obligation it opened stayed "pending" forever — the exact
 * split-brain CLAUDE.md's "earned and received never collapse" rule warns
 * against, just between two tables instead of two columns. So for a
 * customer recovery this also settles the obligation and writes the real
 * `payment`/`payment_allocation` pair that makes it so — the same shape
 * `confirmDay`'s one-tap path already writes for a driver's day, and the
 * reason this can now fail `PERIOD_CLOSED`, which it never could before:
 * a real money-table write only enters the picture here for that case.
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

  let customerId: string | undefined;
  if (recovery.source === "customer" && recovery.obligationId !== null) {
    const incidentRow = await findIncidentForBusiness(
      writer,
      input.businessId,
      recovery.incidentId,
    );
    if (incidentRow?.leaseId) {
      const lease = await findLeaseForBusiness(writer, input.businessId, incidentRow.leaseId);
      customerId = lease?.customerId;
    }
  }

  const receivedPeriod = await findPeriodForDate(writer, input.businessId, input.receivedOn);

  try {
    await writer.transaction(async (tx) => {
      await recordIncidentRecoveryReceived(tx, input.recoveryId, {
        receivedAmountMinor: input.receivedAmountMinor,
        ...(receivedPeriod ? { receivedPeriodId: receivedPeriod.id } : {}),
      });

      if (recovery.source === "customer" && recovery.obligationId !== null && customerId) {
        const status = computeObligationStatus(
          recovery.agreedAmountMinor,
          input.receivedAmountMinor,
          0n,
        );
        await updateObligationSettled(tx, recovery.obligationId, {
          settledMinor: input.receivedAmountMinor,
          status,
        });

        // Bug found 14 Aug 2026 (GAP-12/W-61/INV-36 §3.9): this handler
        // overwrites `received_amount_minor` (a real correction) but used to
        // mint a *fresh* payment unconditionally on every call — so
        // re-recording a fat-fingered amount silently double-posted cash
        // into UC-75's position and the customer's payment history. Fixed by
        // reversing whatever this obligation's own live allocation already
        // is before posting the new pair, the same "reverse then repost"
        // shape `correctPayment` (F-8.2) uses — never more than one live
        // payment behind this recovery at a time.
        const priorAllocations = await findPaymentAllocationsForObligation(
          tx,
          recovery.obligationId,
        );
        for (const alloc of priorAllocations) {
          await voidPaymentAllocation(tx, alloc.id, {
            voidedReason: "Superseded by a corrected recovery amount",
            voidedBy: input.userId,
          });
          await markPaymentReversed(tx, alloc.paymentId);
        }

        if (input.receivedAmountMinor > 0n) {
          const linkage = await resolvePeriodLinkage(tx, input.businessId, input.receivedOn);
          if (!linkage) {
            throw new PeriodClosedError("No accounting period covers this business date yet");
          }

          const paymentId = newId();
          await insertPayment(tx, {
            id: paymentId,
            businessId: input.businessId,
            direction: "received",
            partyType: "customer",
            partyCustomerId: customerId,
            amountMinor: input.receivedAmountMinor,
            occurredOn: input.receivedOn,
            handledByUserId: input.userId,
            createdBy: input.userId,
            postedPeriodId: linkage.postedPeriodId,
            ...(linkage.belongsToPeriodId !== null
              ? { belongsToPeriodId: linkage.belongsToPeriodId }
              : {}),
          });
          await insertPaymentAllocation(tx, {
            id: newId(),
            paymentId,
            obligationId: recovery.obligationId,
            amountMinor: input.receivedAmountMinor,
            allocatedOn: input.receivedOn,
          });
        }
      }
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return {
    recovery: {
      ...recovery,
      receivedAmountMinor: input.receivedAmountMinor,
      receivedPeriodId: receivedPeriod?.id ?? null,
    },
  };
}

export interface VoidIncidentRecoveryInput {
  businessId: string;
  recoveryId: string;
  reason: string;
  userId: string;
}

export interface VoidedIncidentRecovery {
  id: string;
  voidedAt: string;
}

/**
 * GAP-12/W-61/INV-36 §3.9: refuses once `received_amount_minor > 0` — the
 * receipt behind it is its own entered act, undone through its own
 * correction (F-8.2/`recordRecoveryReceived`'s reverse-then-repost path
 * above), not by voiding the recovery it settled. Clear, this cascades only
 * `voidObligationBySource` — the obligation `recordCustomerContribution`
 * minted alongside this row, never entered separately (§2's exception).
 */
export async function voidIncidentRecovery(
  writer: Writer,
  input: VoidIncidentRecoveryInput,
): Promise<VoidedIncidentRecovery> {
  const recovery = await findIncidentRecoveryForBusiness(
    writer,
    input.businessId,
    input.recoveryId,
  );
  if (!recovery) throw new NotFoundError("No such recovery in this business");
  if (recovery.voidedAt !== null) throw new IncidentRecoveryAlreadyVoidedError();

  if (recovery.receivedAmountMinor > 0n) {
    throw new VoidBlockedError(
      `Cannot void — ${recovery.receivedAmountMinor.toString()} has already been received against ` +
        "it. Correct the receipt itself first",
      [
        {
          kind: "receipt",
          id: input.recoveryId,
          amountMinor: recovery.receivedAmountMinor.toString(),
        },
      ],
    );
  }

  try {
    return await writer.transaction(async (tx) => {
      const voided = await voidIncidentRecoveryRow(tx, input.recoveryId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new IncidentRecoveryAlreadyVoidedError();

      if (recovery.source === "customer" && recovery.obligationId !== null) {
        await voidObligationBySource(tx, "incident_recovery", input.recoveryId, {
          voidedReason: `Recovery voided: ${input.reason}`,
          voidedBy: input.userId,
        });
      }

      return { id: input.recoveryId, voidedAt: voided.voidedAt };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface SubmitInsuranceClaimInput {
  businessId: string;
  incidentId: string;
  claimedAmountMinor: Minor;
  excessBorneMinor: Minor;
  claimedOn: BusinessDate;
  replacesId?: string;
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

    if (input.replacesId !== undefined) {
      const target = await findIncidentRecoveryForBusiness(tx, input.businessId, input.replacesId);
      if (!target) throw new NotFoundError("No such recovery in this business");
      if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
      // See recordCustomerContribution's own comment (Gitar, PR #45).
      if (target.incidentId !== input.incidentId) {
        throw new ValidationError("replacesId names a recovery against a different incident");
      }
    }

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
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      if (isUniqueViolation(err, "incident_recovery_replaces_id_key")) {
        throw new ReplacesTargetAlreadyReplacedError();
      }
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
