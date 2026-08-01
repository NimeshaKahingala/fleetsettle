import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { isPeriodClosedViolation, isUniqueViolation } from "../db/pg-error.js";
import { PeriodClosedError } from "../errors/app-error.js";
import { resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findDayRecordByLeaseAndDate,
  insertDayRecord,
  type DayRecordRow,
} from "../queries/day-record.js";
import { findObligationBySource, insertObligation } from "../queries/obligation.js";
import { insertPayment, insertPaymentAllocation } from "../queries/payment.js";
import { computeObligationStatus } from "./obligation-status.js";
import type { LostReason } from "@fleetsettle/shared/schemas";

export type ConfirmDayAction =
  | { kind: "paid_in_full" }
  | { kind: "something_else"; earnedMinor: Minor; receivedMinor: Minor }
  | { kind: "did_not_run"; lostReason: LostReason };

export interface ConfirmDayInput {
  businessId: string;
  dailyLeaseId: string;
  vehicleId: string;
  driverId: string;
  businessDate: BusinessDate;
  expectedMinor: Minor;
  userId: string;
  note?: string;
  action: ConfirmDayAction;
}

export interface ConfirmDayResult {
  dayRecord: DayRecordRow;
  receivedMinor: Minor;
  /** false on the idempotent no-op path — a second tap changes nothing (CLAUDE.md → Writes). */
  created: boolean;
}

/**
 * F-4.2/F-4.4, one transaction: `day_record`, its `obligation`, and — when
 * anything was actually received — a `payment` and its `payment_allocation`.
 * Exactly the "four inserts" F-4.2 describes; `obligation.settled_minor` and
 * `status` are computed once, correctly, from the given figures, so there is
 * never a follow-up UPDATE.
 *
 * Idempotent on `(daily_lease_id, business_date)` (DM §7's unique index): a
 * day already confirmed — any state but the pre-generated-card `open`, which
 * nothing in this phase produces yet (that's P13's `generate-day-cards`) — is
 * a no-op, read back and returned as-is rather than re-written.
 */
export async function confirmDay(
  writer: Writer,
  input: ConfirmDayInput,
): Promise<ConfirmDayResult> {
  try {
    return await writer.transaction(async (tx) => {
      const existing = await findDayRecordByLeaseAndDate(
        tx,
        input.dailyLeaseId,
        input.businessDate,
      );
      if (existing) {
        const obligationRow = await findObligationBySource(tx, "day_record", existing.id);
        return {
          dayRecord: existing,
          // eslint-disable-next-line no-restricted-syntax -- a did_not_run day (INV-6) has no obligation at all; 0 is the fact for that day, not a stand-in for data we don't have (W-56)
          receivedMinor: (obligationRow?.settledMinor ?? 0n) as Minor,
          created: false,
        };
      }

      const linkage = await resolvePeriodLinkage(tx, input.businessId, input.businessDate);
      if (!linkage) {
        throw new PeriodClosedError("No accounting period covers this business date yet");
      }

      const dayRecordId = newId();
      const periodFields = {
        postedPeriodId: linkage.postedPeriodId,
        ...(linkage.belongsToPeriodId !== null
          ? { belongsToPeriodId: linkage.belongsToPeriodId }
          : {}),
      };

      if (input.action.kind === "did_not_run") {
        await insertDayRecord(tx, {
          id: dayRecordId,
          businessId: input.businessId,
          dailyLeaseId: input.dailyLeaseId,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          businessDate: input.businessDate,
          state: "did_not_run",
          earnedMinor: 0n,
          expectedMinor: input.expectedMinor,
          lostReason: input.action.lostReason,
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...periodFields,
        });
        return {
          dayRecord: {
            id: dayRecordId,
            dailyLeaseId: input.dailyLeaseId,
            vehicleId: input.vehicleId,
            driverId: input.driverId,
            businessDate: input.businessDate,
            state: "did_not_run",
            earnedMinor: 0n,
            expectedMinor: input.expectedMinor,
            lostReason: input.action.lostReason,
            note: input.note ?? null,
          },
          receivedMinor: 0n as Minor,
          created: true,
        };
      }

      const earnedMinor =
        input.action.kind === "paid_in_full" ? input.expectedMinor : input.action.earnedMinor;
      const receivedMinor =
        input.action.kind === "paid_in_full" ? input.expectedMinor : input.action.receivedMinor;

      const state: DayRecordRow["state"] =
        receivedMinor === 0n
          ? "ran_unpaid"
          : receivedMinor < earnedMinor
            ? "ran_paid_short"
            : "ran_paid_full";
      const obligationStatus = computeObligationStatus(earnedMinor, receivedMinor, 0n);

      await insertDayRecord(tx, {
        id: dayRecordId,
        businessId: input.businessId,
        dailyLeaseId: input.dailyLeaseId,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        businessDate: input.businessDate,
        state,
        earnedMinor,
        expectedMinor: input.expectedMinor,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...periodFields,
      });

      const obligationId = newId();
      await insertObligation(tx, {
        id: obligationId,
        businessId: input.businessId,
        direction: "owed_to_us",
        partyType: "driver",
        partyDriverId: input.driverId,
        kind: "daily_amount",
        sourceType: "day_record",
        sourceId: dayRecordId,
        vehicleId: input.vehicleId,
        amountMinor: earnedMinor,
        settledMinor: receivedMinor,
        waivedMinor: 0n,
        dueOn: input.businessDate,
        effectiveDueOn: input.businessDate,
        status: obligationStatus,
        ...periodFields,
      });

      if (receivedMinor > 0n) {
        const paymentId = newId();
        await insertPayment(tx, {
          id: paymentId,
          businessId: input.businessId,
          direction: "received",
          partyType: "driver",
          partyDriverId: input.driverId,
          amountMinor: receivedMinor,
          occurredOn: input.businessDate,
          handledByUserId: input.userId,
          createdBy: input.userId,
          ...periodFields,
        });
        await insertPaymentAllocation(tx, {
          id: newId(),
          paymentId,
          obligationId,
          amountMinor: receivedMinor,
          allocatedOn: input.businessDate,
        });
      }

      return {
        dayRecord: {
          id: dayRecordId,
          dailyLeaseId: input.dailyLeaseId,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          businessDate: input.businessDate,
          state,
          earnedMinor,
          expectedMinor: input.expectedMinor,
          lostReason: null,
          note: input.note ?? null,
        },
        receivedMinor,
        created: true,
      };
    });
  } catch (err) {
    if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
    // A concurrent confirm of the same day landed first — the same "unique
    // violation on an idempotent path is success" rule CLAUDE.md states for
    // cron jobs, extended to this user-triggered idempotent action.
    if (isUniqueViolation(err, "day_record_daily_lease_id_business_date_key")) {
      const row = await findDayRecordByLeaseAndDate(writer, input.dailyLeaseId, input.businessDate);
      if (row) {
        const obligationRow = await findObligationBySource(writer, "day_record", row.id);
        return {
          dayRecord: row,
          // eslint-disable-next-line no-restricted-syntax -- a did_not_run day (INV-6) has no obligation at all; 0 is the fact for that day, not a stand-in for data we don't have (W-56)
          receivedMinor: (obligationRow?.settledMinor ?? 0n) as Minor,
          created: false,
        };
      }
    }
    throw err;
  }
}
