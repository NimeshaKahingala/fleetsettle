import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import {
  AdvanceAlreadyVoidedError,
  AdvanceSettlementAlreadyVoidedError,
  NotFoundError,
  PeriodClosedError,
  ReplacesTargetAlreadyReplacedError,
  ReplacesTargetNotVoidedError,
  ValidationError,
  VoidBlockedError,
  type VoidBlockingItem,
} from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findAdvanceForBusiness,
  findAdvanceSettlementForBusiness,
  findLiveSettlementsForAdvance,
  insertAdvance,
  insertAdvanceSettlement,
  sumSettledForAdvance,
  updateAdvanceStatus,
  voidAdvanceRow,
  voidAdvanceSettlementRow,
  type AdvanceRow,
} from "../queries/driver-money.js";

export interface IssueAdvanceInput {
  businessId: string;
  driverId: string;
  tripId?: string;
  amountMinor: Minor;
  issuedOn: BusinessDate;
  issuedByUserId: string;
  replacesId?: string;
}

export interface IssuedAdvance {
  advanceId: string;
}

/**
 * F-6.3/UC-53. Not a cost — reconciled to zero, and INV-17 (trip.ts, P6)
 * blocks trip closure until it is.
 *
 * GAP-60/D-16: `replacesId` — see `createExpense`'s own comment for the shape.
 */
export async function issueAdvance(
  writer: Writer,
  input: IssueAdvanceInput,
): Promise<IssuedAdvance> {
  const linkage = await resolvePeriodLinkage(writer, input.businessId, input.issuedOn);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");

  if (input.replacesId !== undefined) {
    const target = await findAdvanceForBusiness(writer, input.businessId, input.replacesId);
    if (!target) throw new NotFoundError("No such advance in this business");
    if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
    // Found by Gitar's review of PR #45: without this, replacesId could
    // name a voided advance against a *different* driver.
    if (target.driverId !== input.driverId) {
      throw new ValidationError("replacesId names an advance against a different driver");
    }
  }

  const advanceId = newId();
  try {
    // withActor (db/client.ts) only attributes writes inside a real
    // transaction — wrapped here for that reason (F-8.6).
    await writer.transaction((tx) =>
      insertAdvance(tx, {
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
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      }),
    );
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    if (isUniqueViolation(err, "advance_replaces_id_key")) {
      throw new ReplacesTargetAlreadyReplacedError();
    }
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
  replacesId?: string;
}

export interface SettledAdvance {
  settlementId: string;
  advance: AdvanceRow;
  settledMinor: Minor;
}

/**
 * UC-53: "the advance closes at zero." Each settlement (spent / returned /
 * kept as fee) is its own row — DM §10.4 keeps no stored running total, so
 * this sums every settlement recorded so far and compares it to the
 * original amount to decide `open` / `part_settled` / `settled`.
 *
 * GAP-60/D-16: `replacesId` — see `createExpense`'s own comment for the shape.
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

    if (input.replacesId !== undefined) {
      const target = await findAdvanceSettlementForBusiness(tx, input.businessId, input.replacesId);
      if (!target) throw new NotFoundError("No such settlement in this business");
      if (target.voidedAt === null) throw new ReplacesTargetNotVoidedError();
      // Found by Gitar's review of PR #45: without this, replacesId could
      // name a voided settlement against a *different* advance.
      if (target.advanceId !== input.advanceId) {
        throw new ValidationError("replacesId names a settlement against a different advance");
      }
    }

    const settlementId = newId();
    try {
      await insertAdvanceSettlement(tx, {
        id: settlementId,
        businessId: input.businessId,
        advanceId: input.advanceId,
        kind: input.kind,
        amountMinor: input.amountMinor,
        occurredOn: input.occurredOn,
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
        ...(input.replacesId !== undefined ? { replacesId: input.replacesId } : {}),
      });

      const status = newSettled >= adv.amountMinor ? "settled" : "part_settled";
      await updateAdvanceStatus(tx, input.advanceId, status);

      return {
        settlementId,
        advance: { ...adv, status },
        settledMinor: newSettled as Minor,
      };
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      if (isUniqueViolation(err, "advance_settlement_replaces_id_key")) {
        throw new ReplacesTargetAlreadyReplacedError();
      }
      throw err;
    }
  });
}

export interface VoidAdvanceSettlementInput {
  businessId: string;
  settlementId: string;
  reason: string;
  userId: string;
}

export interface VoidedAdvanceSettlement {
  id: string;
  voidedAt: string;
  advance: AdvanceRow;
  settledMinor: Minor;
}

/**
 * GAP-12/W-61/INV-36 §3.5: void the settlement, recompute `advance.status`
 * from the live settlements that remain, using the exact arithmetic
 * `settleAdvance` already applies — `sumSettledForAdvance` already excludes
 * this row once voided (§3 read-side filter), so re-deriving is always
 * correct. Restores INV-17's trip-close block: a trip whose advance now
 * reads `open`/`part_settled` again cannot close until it is reconciled.
 */
export async function voidAdvanceSettlement(
  writer: Writer,
  input: VoidAdvanceSettlementInput,
): Promise<VoidedAdvanceSettlement> {
  try {
    return await writer.transaction(async (tx) => {
      const settlement = await findAdvanceSettlementForBusiness(
        tx,
        input.businessId,
        input.settlementId,
      );
      if (!settlement) throw new NotFoundError("No such settlement in this business");
      if (settlement.voidedAt !== null) throw new AdvanceSettlementAlreadyVoidedError();

      const adv = await findAdvanceForBusiness(tx, input.businessId, settlement.advanceId);
      if (!adv) throw new NotFoundError("No such advance in this business");

      const voided = await voidAdvanceSettlementRow(tx, input.settlementId, {
        voidedReason: input.reason,
        voidedBy: input.userId,
      });
      if (!voided) throw new AdvanceSettlementAlreadyVoidedError();

      const settledMinor = await sumSettledForAdvance(tx, settlement.advanceId);
      const status =
        settledMinor >= adv.amountMinor ? "settled" : settledMinor > 0n ? "part_settled" : "open";
      if (status !== adv.status) await updateAdvanceStatus(tx, settlement.advanceId, status);

      return {
        id: input.settlementId,
        voidedAt: voided.voidedAt,
        advance: { ...adv, status },
        settledMinor: settledMinor as Minor,
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}

export interface VoidAdvanceInput {
  businessId: string;
  advanceId: string;
  reason: string;
  userId: string;
}

export interface VoidedAdvance {
  id: string;
  voidedAt: string;
}

/**
 * GAP-12/W-61/INV-36 §3.6: refuses while any settlement against this
 * advance is still live — each is its own entered act (§2's governing
 * principle), so the manager voids those first, each with its own reason,
 * before the advance itself can go.
 */
export async function voidAdvance(writer: Writer, input: VoidAdvanceInput): Promise<VoidedAdvance> {
  const adv = await findAdvanceForBusiness(writer, input.businessId, input.advanceId);
  if (!adv) throw new NotFoundError("No such advance in this business");
  if (adv.voidedAt !== null) throw new AdvanceAlreadyVoidedError();

  const live = await findLiveSettlementsForAdvance(writer, input.advanceId);
  if (live.length > 0) {
    const items: VoidBlockingItem[] = live.map((s) => ({
      kind: "settlement",
      id: s.id,
      amountMinor: s.amountMinor.toString(),
    }));
    const totalMinor = live.reduce((sum, s) => sum + s.amountMinor, 0n);
    throw new VoidBlockedError(
      `Cannot void — ${live.length.toString()} settlement(s) totalling ${totalMinor.toString()} ` +
        "are still against it. Void those first, each with its own reason",
      items,
    );
  }

  try {
    const voided = await writer.transaction((tx) =>
      voidAdvanceRow(tx, input.advanceId, { voidedReason: input.reason, voidedBy: input.userId }),
    );
    if (!voided) throw new AdvanceAlreadyVoidedError();
    return { id: input.advanceId, voidedAt: voided.voidedAt };
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    throw err;
  }
}
