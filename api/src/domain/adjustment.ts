import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { AdjustmentType } from "@fleetsettle/shared/schemas";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import { NotFoundError, PeriodClosedError, ValidationError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import { insertAdjustment } from "../queries/adjustment.js";
import {
  applyAdjustmentToObligation,
  findObligationForBusiness,
  type ObligationForAdjustment,
} from "../queries/obligation.js";
import { computeObligationStatus } from "./obligation-status.js";

const WAIVER_TYPES: readonly AdjustmentType[] = ["waiver", "auto_waiver"];

export interface ApplyAdjustmentInput {
  businessId: string;
  obligationId: string;
  adjustmentType: AdjustmentType;
  amountMinor: Minor;
  sign: -1 | 1;
  reason?: string;
  occurredOn: BusinessDate;
  userId: string;
}

export interface AppliedAdjustment {
  adjustmentId: string;
  obligation: ObligationForAdjustment;
}

/**
 * The transactional core, callable standalone (wrapped below) or composed
 * into a larger transaction — F-3.4/UC-12's 'credit_days' rent treatment
 * (domain/incident.ts) applies a discount adjustment as part of recording
 * the incident's off-road period, one transaction rather than two.
 *
 * A waiver (or `auto_waiver`) raises `waived_minor` only — the original
 * `amount_minor` stays "the 340 charged" (DM §10.3's own example), so the
 * month can show both the charge and the waiver. Every other type is a real
 * change to what is owed and adjusts `amount_minor` by `sign * amountMinor`
 * directly.
 */
export async function applyAdjustmentTx(
  tx: Tx,
  input: ApplyAdjustmentInput,
): Promise<AppliedAdjustment> {
  const ob = await findObligationForBusiness(tx, input.businessId, input.obligationId);
  if (!ob || ob.voidedAt !== null) throw new NotFoundError("No such obligation in this business");

  const isWaiver = WAIVER_TYPES.includes(input.adjustmentType);
  const newAmountMinor = isWaiver
    ? ob.amountMinor
    : ob.amountMinor + BigInt(input.sign) * input.amountMinor;
  const newWaivedMinor = isWaiver ? ob.waivedMinor + input.amountMinor : ob.waivedMinor;

  if (newAmountMinor < 0n) {
    throw new ValidationError("This adjustment would take the amount owed below zero");
  }
  if (ob.settledMinor + newWaivedMinor > newAmountMinor) {
    throw new ValidationError(
      "This adjustment would waive more than remains unsettled on this obligation",
    );
  }

  const status = computeObligationStatus(newAmountMinor, ob.settledMinor, newWaivedMinor);

  const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const adjustmentId = newId();
  try {
    await insertAdjustment(tx, {
      id: adjustmentId,
      businessId: input.businessId,
      obligationId: input.obligationId,
      adjustmentType: input.adjustmentType,
      amountMinor: input.amountMinor,
      sign: input.sign,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      postedPeriodId: linkage.postedPeriodId,
      ...(linkage.belongsToPeriodId !== null
        ? { belongsToPeriodId: linkage.belongsToPeriodId }
        : {}),
      createdBy: input.userId,
    });
    await applyAdjustmentToObligation(tx, input.obligationId, {
      amountMinor: newAmountMinor,
      waivedMinor: newWaivedMinor,
      status,
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return {
    adjustmentId,
    obligation: {
      id: ob.id,
      amountMinor: newAmountMinor,
      settledMinor: ob.settledMinor,
      waivedMinor: newWaivedMinor,
      status,
      voidedAt: null,
    },
  };
}

/** F-2.4/UC-15/W-17: `adjustment` plus the obligation it touches, one transaction. */
export async function applyAdjustment(
  writer: Writer,
  input: ApplyAdjustmentInput,
): Promise<AppliedAdjustment> {
  return writer.transaction((tx) => applyAdjustmentTx(tx, input));
}
