import { newId, type BusinessDate } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { insertObligationsIdempotent, type NewObligation } from "../queries/obligation.js";
import { listManagementFeeAgreementsEffectiveAsOf } from "../queries/partner.js";
import { listOpenPeriodsForCron, type OpenPeriodForCron } from "../queries/scheduled.js";

export interface GenerateManagementFeeObligationsInput {
  businessId: string;
  periodId: string;
  periodStart: BusinessDate;
}

export interface GeneratedManagementFeeObligations {
  created: number;
}

/**
 * A10a/GAP-39/W-53, the transactional core: one `management_fee` obligation
 * per agreement effective on `periodStart`, posted to `periodId` — the exact
 * gap `sumVehicleCostsForPeriod` (queries/reports.ts) has read against since
 * P7 with nothing ever writing the row it expects. Mirrors
 * `generateNextBillingPeriodTx`'s own shape: callable standalone or composed
 * into a larger transaction, idempotent via a real constraint
 * (`obligation_management_fee_once`, migration 0011) rather than an
 * application check, and a bulk `INSERT … ON CONFLICT DO NOTHING` (IG §2)
 * rather than a per-row loop — Postgres aborts the whole transaction on an
 * uncaught statement error, so a per-row try/catch inside one transaction
 * would not work here the way `generateNextBillingPeriod`'s own
 * wrapper-level catch does.
 *
 * `direction: "owed_by_us"`/`partyType: "partner"` mirrors W-53 exactly: the
 * fee is the owner's cost and the manager's income, so it is money *we* owe
 * *him* — `sumVehicleCostsForPeriod` already reads it that way
 * (`direction = 'owed_by_us'`), this is just the write side finally
 * existing.
 */
export async function generateManagementFeeObligationsTx(
  tx: Tx,
  input: GenerateManagementFeeObligationsInput,
): Promise<GeneratedManagementFeeObligations> {
  const agreements = await listManagementFeeAgreementsEffectiveAsOf(
    tx,
    input.businessId,
    input.periodStart,
  );
  if (agreements.length === 0) return { created: 0 };

  const rows: NewObligation[] = agreements.map((a) => ({
    id: newId(),
    businessId: input.businessId,
    direction: "owed_by_us",
    partyType: "partner",
    partyUserId: a.managerUserId,
    kind: "management_fee",
    sourceType: "management_fee_agreement",
    sourceId: a.id,
    vehicleId: a.vehicleId,
    amountMinor: a.monthlyAmountMinor,
    settledMinor: 0n,
    waivedMinor: 0n,
    dueOn: input.periodStart,
    effectiveDueOn: input.periodStart,
    status: "pending",
    postedPeriodId: input.periodId,
  }));

  const created = await insertObligationsIdempotent(tx, rows);
  return { created };
}

/**
 * `generate-management-fee` (TS §4, new Cron Trigger): every business's
 * currently open period gets caught up, the same "one unit, own try/catch"
 * shape `generateDayCards` already uses so one business's failure never
 * takes another down. Also what `closeAccountingPeriod` calls for its own
 * successor period, for immediacy — the two callers share this one function
 * rather than duplicating the agreement lookup and insert shape.
 */
export async function generateManagementFeeObligationsForAllOpenPeriods(writer: Writer): Promise<{
  created: number;
  errors: { businessId: string; message: string }[];
}> {
  const openPeriods: OpenPeriodForCron[] = await listOpenPeriodsForCron(writer);
  let created = 0;
  const errors: { businessId: string; message: string }[] = [];

  for (const period of openPeriods) {
    try {
      const result = await writer.transaction((tx) =>
        generateManagementFeeObligationsTx(tx, {
          businessId: period.businessId,
          periodId: period.id,
          periodStart: period.periodStart as BusinessDate,
        }),
      );
      created += result.created;
    } catch (err) {
      errors.push({
        businessId: period.businessId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, errors };
}
