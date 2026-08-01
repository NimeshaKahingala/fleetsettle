import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import { NotFoundError, PeriodClosedError, ValidationError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findAdvanceForBusiness,
  insertAdvance,
  insertAdvanceSettlement,
  sumSettledForAdvance,
  updateAdvanceStatus,
  type AdvanceRow,
} from "../queries/driver-money.js";

export interface IssueAdvanceInput {
  businessId: string;
  driverId: string;
  tripId?: string;
  amountMinor: Minor;
  issuedOn: BusinessDate;
  issuedByUserId: string;
}

export interface IssuedAdvance {
  advanceId: string;
}

/** F-6.3/UC-53. Not a cost — reconciled to zero, and INV-17 (trip.ts, P6) blocks trip closure until it is. */
export async function issueAdvance(
  writer: Writer,
  input: IssueAdvanceInput,
): Promise<IssuedAdvance> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.issuedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  const advanceId = newId();
  try {
    await insertAdvance(writer, {
      id: advanceId,
      businessId: input.businessId,
      driverId: input.driverId,
      ...(input.tripId !== undefined ? { tripId: input.tripId } : {}),
      amountMinor: input.amountMinor,
      issuedOn: input.issuedOn,
      issuedByUserId: input.issuedByUserId,
      postedPeriodId: linkage.postedPeriodId,
      ...(linkage.belongsToPeriodId !== null
        ? { belongsToPeriodId: linkage.belongsToPeriodId }
        : {}),
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }

  return { advanceId };
}

export interface SettleAdvanceInput {
  businessId: string;
  advanceId: string;
  kind: "spent" | "returned" | "kept_as_fee";
  amountMinor: Minor;
  occurredOn: BusinessDate;
}

export interface SettledAdvance {
  advance: AdvanceRow;
  settledMinor: Minor;
}

/**
 * UC-53: "the advance closes at zero." Each settlement (spent / returned /
 * kept as fee) is its own row — DM §10.4 keeps no stored running total, so
 * this sums every settlement recorded so far and compares it to the
 * original amount to decide `open` / `part_settled` / `settled`.
 */
export async function settleAdvance(
  writer: Writer,
  input: SettleAdvanceInput,
): Promise<SettledAdvance> {
  return writer.transaction(async (tx) => {
    const adv = await findAdvanceForBusiness(tx, input.businessId, input.advanceId);
    if (!adv || adv.voidedAt !== null) throw new NotFoundError("No such advance in this business");

    const alreadySettled = await sumSettledForAdvance(tx, input.advanceId);
    const newSettled = alreadySettled + input.amountMinor;
    if (newSettled > adv.amountMinor) {
      throw new ValidationError("This settlement would exceed the advance's original amount");
    }

    const linkage = await resolvePeriodLinkage(tx, input.businessId, input.occurredOn);
    if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

    try {
      await insertAdvanceSettlement(tx, {
        id: newId(),
        businessId: input.businessId,
        advanceId: input.advanceId,
        kind: input.kind,
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      });

      const status = newSettled >= adv.amountMinor ? "settled" : "part_settled";
      await updateAdvanceStatus(tx, input.advanceId, status);

      return {
        advance: { ...adv, status },
        settledMinor: newSettled as Minor,
      };
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      throw err;
    }
  });
}
