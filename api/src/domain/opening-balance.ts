import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Tx, Writer } from "../db/client.js";
import { isPeriodClosedViolation } from "../db/pg-error.js";
import { findFirstPeriodStatus, resolvePeriodLinkage } from "../queries/accounting-period.js";
import {
  findDepositForBusiness,
  findDepositMovementAmount,
  insertAdvances,
  insertDepositMovement,
  insertDepositMovements,
  insertDeposits,
  voidAdvanceById,
  type NewAdvance,
  type NewDeposit,
  type NewDepositMovement,
} from "../queries/driver-money.js";
import {
  insertObligations,
  voidObligationById,
  type NewObligation,
} from "../queries/obligation.js";
import { insertPayments, markPaymentReversed, type NewPayment } from "../queries/payment.js";
import {
  NotFoundError,
  OpeningBalanceLockedError,
  PeriodClosedError,
} from "../errors/app-error.js";
import {
  findActivePostingsForBatch,
  findBatchForBusiness,
  findEntriesForBatch,
  insertBatch,
  insertEntries,
  insertPostings,
  markBatchCommitted,
  markPostingsReversed,
  updateBatchGoLiveDate,
  voidEntriesForBatch,
  type NewOpeningBalanceEntry,
  type NewOpeningBalancePosting,
  type OpeningBalanceEntryRow,
} from "../queries/opening-balance.js";

export interface OpeningBalanceEntryInput {
  kind:
    | "customer_due"
    | "driver_arrears"
    | "owed_to_driver"
    | "deposit_held"
    | "advance_outstanding"
    | "cash_held";
  partyCustomerId?: string;
  partyDriverId?: string;
  partyUserId?: string;
  vehicleId?: string;
  amountMinor: Minor;
  originalDueDate?: BusinessDate;
}

export interface SaveOpeningBalanceInput {
  businessId: string;
  goLiveDate: BusinessDate;
  entries: OpeningBalanceEntryInput[];
  actorUserId: string;
}

export interface SavedOpeningBalance {
  batchId: string;
  goLiveDate: string;
  status: "draft" | "committed";
  committedAt: string | null;
  entries: OpeningBalanceEntryRow[];
}

/**
 * GAP-103: the write half `commitOpeningBalance` never had. One entry
 * becomes one row in whichever real table its report already reads —
 * `obligation` for the three balance kinds that already are a receivable
 * or payable, `deposit`/`deposit_movement` for `deposit_held`, `advance`
 * for `advance_outstanding`, and a `payment` for `cash_held` (queries/
 * reports.ts's `listPartnerCashPositions` already derives a partner's
 * held cash as `received − banked − advanced`; an opening float is just a
 * starting `received` with no allocation, the same shape a real surplus
 * payment already leaves). `opening_balance_posting` (migration 0014)
 * records which row each entry produced, so a correction (below) can find
 * and reverse exactly those rows without touching anything else.
 *
 * One `resolvePeriodLinkage` call for the whole batch, not one per entry —
 * every entry belongs to the same go-live date, so they all post to the
 * same period. `goLiveDate`, not each entry's own `originalDueDate`,
 * decides which period receives the posting (W-35): a due date the
 * business remembers from before it existed cannot itself have an
 * `accounting_period` row, only the period open when the business actually
 * started using this ledger can.
 */
async function materializeOpeningBalanceEntries(
  tx: Tx,
  businessId: string,
  batchId: string,
  entries: OpeningBalanceEntryRow[],
  goLiveDate: string,
): Promise<void> {
  if (entries.length === 0) return;

  const linkage = await resolvePeriodLinkage(tx, businessId, goLiveDate);
  if (!linkage) throw new PeriodClosedError("No accounting period covers this business date yet");
  const periodFields = {
    postedPeriodId: linkage.postedPeriodId,
    ...(linkage.belongsToPeriodId !== null ? { belongsToPeriodId: linkage.belongsToPeriodId } : {}),
  };

  const obligationRows: NewObligation[] = [];
  const advanceRows: NewAdvance[] = [];
  const paymentRows: NewPayment[] = [];
  const depositRows: NewDeposit[] = [];
  const depositMovementRows: NewDepositMovement[] = [];
  const postings: NewOpeningBalancePosting[] = [];

  for (const entry of entries) {
    const dueOn = entry.originalDueDate ?? goLiveDate;
    const vehicleField = entry.vehicleId !== null ? { vehicleId: entry.vehicleId } : {};

    switch (entry.kind) {
      case "customer_due":
      case "driver_arrears":
      case "owed_to_driver": {
        const id = newId();
        const isCustomer = entry.kind === "customer_due";
        let partyField: { partyCustomerId: string } | { partyDriverId: string };
        if (isCustomer) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the wire schema's discriminated union guarantees this party for this kind
          partyField = { partyCustomerId: entry.partyCustomerId! };
        } else {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the wire schema's discriminated union guarantees this party for this kind
          partyField = { partyDriverId: entry.partyDriverId! };
        }
        obligationRows.push({
          id,
          businessId,
          direction: entry.kind === "owed_to_driver" ? "owed_by_us" : "owed_to_us",
          partyType: isCustomer ? "customer" : "driver",
          ...partyField,
          kind: "opening_balance",
          sourceType: "opening_balance_entry",
          sourceId: entry.id,
          ...vehicleField,
          amountMinor: entry.amountMinor,
          settledMinor: 0n,
          waivedMinor: 0n,
          dueOn,
          effectiveDueOn: dueOn,
          status: "pending",
          ...periodFields,
        });
        postings.push({
          id: newId(),
          businessId,
          batchId,
          entryKind: entry.kind,
          targetTable: "obligation",
          targetId: id,
        });
        break;
      }
      case "deposit_held": {
        const depositId = newId();
        const movementId = newId();
        depositRows.push({
          id: depositId,
          businessId,
          partyType: "driver",
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the wire schema's discriminated union guarantees this party for this kind
          partyDriverId: entry.partyDriverId!,
        });
        depositMovementRows.push({
          id: movementId,
          businessId,
          depositId,
          movementType: "taken",
          amountMinor: entry.amountMinor,
          occurredOn: dueOn,
          reason: "Opening balance",
          ...periodFields,
        });
        postings.push({
          id: newId(),
          businessId,
          batchId,
          entryKind: entry.kind,
          targetTable: "deposit_movement",
          targetId: movementId,
          depositId,
        });
        break;
      }
      case "advance_outstanding": {
        const id = newId();
        advanceRows.push({
          id,
          businessId,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the wire schema's discriminated union guarantees this party for this kind
          driverId: entry.partyDriverId!,
          amountMinor: entry.amountMinor,
          issuedOn: dueOn,
          ...periodFields,
        });
        postings.push({
          id: newId(),
          businessId,
          batchId,
          entryKind: entry.kind,
          targetTable: "advance",
          targetId: id,
        });
        break;
      }
      case "cash_held": {
        const id = newId();
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the wire schema's discriminated union guarantees this party for this kind
        const partyUserId = entry.partyUserId!;
        paymentRows.push({
          id,
          businessId,
          direction: "received",
          partyType: "partner",
          partyUserId,
          amountMinor: entry.amountMinor,
          occurredOn: dueOn,
          handledByUserId: partyUserId,
          reference: "Opening balance",
          ...periodFields,
        });
        postings.push({
          id: newId(),
          businessId,
          batchId,
          entryKind: entry.kind,
          targetTable: "payment",
          targetId: id,
        });
        break;
      }
    }
  }

  await insertObligations(tx, obligationRows);
  await insertDeposits(tx, depositRows);
  await insertDepositMovements(tx, depositMovementRows);
  await insertAdvances(tx, advanceRows);
  await insertPayments(tx, paymentRows);
  await insertPostings(tx, postings);
}

/**
 * F-0.2's own Alternates clause, the write side: a correction made after
 * commit (still before the first period closes — the caller already
 * enforces that) cannot leave the previous commit's rows standing, or a
 * fixed typo would double the figure everywhere it was materialised.
 * `obligation`/`advance` reverse the way every other correction in this
 * codebase does — void by id, respected by every sum that reads them
 * (`sumOutstandingByDirectionForDriver`, `listPartnerCashPositions`'s own
 * `advance` half). `payment` reverses by flipping `status`, which
 * `listPartnerCashPositions` already filters on — never routed through
 * `payment_correction`, which unwinds real allocations this row never has.
 * `deposit_movement` is different, and not for the reason once written
 * here: `sumDepositMovements` (queries/driver-money.ts) does filter
 * `voided_at`, and `voidDepositMovementRow` is a real, working void path
 * used elsewhere. This reversal still writes a real offsetting `refunded`
 * movement rather than voiding the original — because a correction here is
 * not "this entry was wrong," it is "money that genuinely existed is now
 * being handed back," the identical fact a top-up followed by an ordinary
 * refund already represents. Voiding would say the original `taken` never
 * happened; it did, and the deposit's own history should keep saying so.
 */
async function reverseOpeningBalancePostings(
  tx: Tx,
  businessId: string,
  batchId: string,
  priorGoLiveDate: string,
  actorUserId: string,
): Promise<void> {
  const postings = await findActivePostingsForBatch(tx, batchId);
  if (postings.length === 0) return;

  const voidValues = { voidedReason: "Opening balance corrected", voidedBy: actorUserId };
  let depositLinkage: { postedPeriodId: string; belongsToPeriodId: string | null } | undefined;

  for (const posting of postings) {
    switch (posting.targetTable) {
      case "obligation":
        await voidObligationById(tx, businessId, posting.targetId, voidValues);
        break;
      case "advance":
        await voidAdvanceById(tx, posting.targetId, voidValues);
        break;
      case "payment":
        await markPaymentReversed(tx, posting.targetId);
        break;
      case "deposit_movement": {
        const amount = await findDepositMovementAmount(tx, posting.targetId);
        if (amount === undefined || posting.depositId === null) break;
        // GAP-178/B10: unlike the two paths above, this one writes a movement
        // against a deposit that already existed before this transaction — so
        // it takes the parent lock, in the same order every other writer
        // does. The correction reverses an opening balance while a draw
        // against the same deposit may be in flight.
        await findDepositForBusiness(tx, businessId, posting.depositId, true);
        depositLinkage ??= await resolvePeriodLinkage(tx, businessId, priorGoLiveDate);
        if (!depositLinkage) {
          throw new PeriodClosedError("No accounting period covers this business date yet");
        }
        await insertDepositMovement(tx, {
          id: newId(),
          businessId,
          depositId: posting.depositId,
          movementType: "refunded",
          amountMinor: amount,
          occurredOn: priorGoLiveDate,
          reason: "Opening balance corrected",
          postedPeriodId: depositLinkage.postedPeriodId,
          ...(depositLinkage.belongsToPeriodId !== null
            ? { belongsToPeriodId: depositLinkage.belongsToPeriodId }
            : {}),
        });
        break;
      }
    }
  }

  await markPostingsReversed(tx, batchId);
}

/**
 * F-0.2 / UC-09, one transaction: upserts the one-per-business batch (DM
 * §10.6's `business_id UNIQUE`) and fully replaces its entries. A full
 * replace, not incremental CRUD, so "save as a draft, add a vehicle or two,
 * finish the rest later" (the Alternates clause) is just calling this again
 * with the accumulated set. The handler has already confirmed every party
 * an entry names belongs to this business (CLAUDE.md → Tenancy) before this
 * runs.
 *
 * Status is untouched here — `commitOpeningBalance` below is the only thing
 * that flips it — so this same function also serves "correct it after
 * commit, before the first month closes" (the other Alternates clause): no
 * separate code path for a pre- vs. post-commit save. When the batch was
 * already committed, GAP-103's materialisation has to move with the
 * entries — the prior commit's postings are reversed first, the new ones
 * are posted after the replace, all inside this same transaction.
 *
 * P9/F-0.2's own Alternates clause: once the business's first accounting
 * period has closed, this endpoint refuses — the opening figures become an
 * ordinary adjustment like any other from that point on, never a batch
 * this call can still rewrite wholesale. P2 left this unenforced because no
 * business could reach a closed first period yet; P9's period close is what
 * makes it reachable.
 */
export async function saveOpeningBalance(
  writer: Writer,
  input: SaveOpeningBalanceInput,
): Promise<SavedOpeningBalance> {
  return await writer.transaction(async (tx) => {
    const firstPeriod = await findFirstPeriodStatus(tx, input.businessId);
    if (firstPeriod?.status === "closed") throw new OpeningBalanceLockedError();

    const existing = await findBatchForBusiness(tx, input.businessId);
    const batchId = existing?.id ?? newId();
    const wasCommitted = existing !== undefined && existing.status === "committed";

    try {
      if (existing !== undefined && wasCommitted) {
        await reverseOpeningBalancePostings(
          tx,
          input.businessId,
          batchId,
          existing.goLiveDate,
          input.actorUserId,
        );
      }

      if (existing) {
        await updateBatchGoLiveDate(tx, batchId, input.goLiveDate);
      } else {
        await insertBatch(tx, {
          id: batchId,
          businessId: input.businessId,
          goLiveDate: input.goLiveDate,
        });
      }

      await voidEntriesForBatch(tx, batchId, input.actorUserId);

      const rows: NewOpeningBalanceEntry[] = input.entries.map((entry) => ({
        id: newId(),
        batchId,
        kind: entry.kind,
        ...(entry.partyCustomerId !== undefined ? { partyCustomerId: entry.partyCustomerId } : {}),
        ...(entry.partyDriverId !== undefined ? { partyDriverId: entry.partyDriverId } : {}),
        ...(entry.partyUserId !== undefined ? { partyUserId: entry.partyUserId } : {}),
        ...(entry.vehicleId !== undefined ? { vehicleId: entry.vehicleId } : {}),
        amountMinor: entry.amountMinor,
        ...(entry.originalDueDate !== undefined ? { originalDueDate: entry.originalDueDate } : {}),
      }));
      await insertEntries(tx, rows);

      const entries: OpeningBalanceEntryRow[] = rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        partyCustomerId: row.partyCustomerId ?? null,
        partyDriverId: row.partyDriverId ?? null,
        partyUserId: row.partyUserId ?? null,
        vehicleId: row.vehicleId ?? null,
        amountMinor: row.amountMinor,
        originalDueDate: row.originalDueDate ?? null,
      }));

      if (wasCommitted) {
        await materializeOpeningBalanceEntries(
          tx,
          input.businessId,
          batchId,
          entries,
          input.goLiveDate,
        );
      }

      return {
        batchId,
        goLiveDate: input.goLiveDate,
        status: existing?.status ?? "draft",
        committedAt: existing?.committedAt ?? null,
        entries,
      };
    } catch (err) {
      if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
      throw err;
    }
  });
}

/**
 * F-0.2's "Confirm" step. 404 if nothing was ever saved — there is nothing
 * to confirm yet. Idempotent on the fact that matters: a batch already
 * carrying active postings never materialises twice, so a client retry of
 * "Confirm" (a flaky connection, a double tap) stays a no-op, never a
 * failure (CLAUDE.md → Writes) and never a doubled opening balance.
 *
 * **GAP-109**: that idempotency check used to be `status === 'draft'`
 * alone, which is a different fact — `commitOpeningBalance` shipped
 * (GAP-103/F3, 11 Aug 2026) with a data model where "committed" and
 * "materialised" were assumed to always agree, and for every batch
 * committed *after* that date they do. Every batch committed *before* it
 * has `status: 'committed'` with zero rows in `opening_balance_posting` —
 * the write half F3 added never ran for them — and the old check treated
 * that as "nothing to do" forever. **The real idempotency signal is
 * whether this batch has any active posting, not what its status column
 * says**: zero postings on a non-empty batch means the one write this
 * function exists to make has never actually happened, committed or not,
 * and a client re-confirming (GAP-110 is what makes that reachable at
 * 360×640) is the one path that fixes it — no backfill migration, no
 * write outside a normal user action, and it can never double-materialise
 * a batch that already has postings.
 */
export async function commitOpeningBalance(
  writer: Writer,
  businessId: string,
): Promise<SavedOpeningBalance> {
  return await writer.transaction(async (tx) => {
    const existing = await findBatchForBusiness(tx, businessId);
    if (!existing) throw new NotFoundError("No opening balance batch has been saved yet");

    const entries = await findEntriesForBatch(tx, existing.id);
    const activePostings = await findActivePostingsForBatch(tx, existing.id);

    if (existing.status === "draft" || activePostings.length === 0) {
      try {
        if (existing.status === "draft") await markBatchCommitted(tx, existing.id);
        await materializeOpeningBalanceEntries(
          tx,
          businessId,
          existing.id,
          entries,
          existing.goLiveDate,
        );
      } catch (err) {
        if (isPeriodClosedViolation(err)) throw new PeriodClosedError();
        throw err;
      }
    }

    const committed =
      existing.status === "committed" ? existing : await findBatchForBusiness(tx, businessId);
    return {
      batchId: existing.id,
      goLiveDate: existing.goLiveDate,
      status: "committed",
      committedAt: committed?.committedAt ?? null,
      entries,
    };
  });
}
