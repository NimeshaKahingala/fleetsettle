import { newId, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { Writer } from "../db/client.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  deleteEntriesForBatch,
  findBatchForBusiness,
  findEntriesForBatch,
  insertBatch,
  insertEntries,
  markBatchCommitted,
  updateBatchGoLiveDate,
  type NewOpeningBalanceEntry,
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
}

export interface SavedOpeningBalance {
  batchId: string;
  goLiveDate: string;
  status: "draft" | "committed";
  committedAt: string | null;
  entries: OpeningBalanceEntryRow[];
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
 * commit, before the first period closes" (the other Alternates clause): no
 * separate code path for a pre- vs. post-commit save.
 *
 * P2 does not yet gate this by "has the first period closed" — P9 builds
 * period close, and until then no business can reach a closed first period
 * at all. Recorded here rather than building an enforcement path for a
 * state nothing can yet produce.
 */
export async function saveOpeningBalance(
  writer: Writer,
  input: SaveOpeningBalanceInput,
): Promise<SavedOpeningBalance> {
  return await writer.transaction(async (tx) => {
    const existing = await findBatchForBusiness(tx, input.businessId);
    const batchId = existing?.id ?? newId();

    if (existing) {
      await updateBatchGoLiveDate(tx, batchId, input.goLiveDate);
    } else {
      await insertBatch(tx, {
        id: batchId,
        businessId: input.businessId,
        goLiveDate: input.goLiveDate,
      });
    }

    await deleteEntriesForBatch(tx, batchId);

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

    return {
      batchId,
      goLiveDate: input.goLiveDate,
      status: existing?.status ?? "draft",
      committedAt: existing?.committedAt ?? null,
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        partyCustomerId: row.partyCustomerId ?? null,
        partyDriverId: row.partyDriverId ?? null,
        partyUserId: row.partyUserId ?? null,
        vehicleId: row.vehicleId ?? null,
        amountMinor: row.amountMinor,
        originalDueDate: row.originalDueDate ?? null,
      })),
    };
  });
}

/**
 * F-0.2's "Confirm" step. 404 if nothing was ever saved — there is nothing
 * to confirm yet. Idempotent: committing an already-committed batch just
 * succeeds without re-stamping `committedAt`, since a client retry of
 * "Confirm" (a flaky connection, a double tap) must be a no-op, never a
 * failure (CLAUDE.md → Writes).
 */
export async function commitOpeningBalance(
  writer: Writer,
  businessId: string,
): Promise<SavedOpeningBalance> {
  return await writer.transaction(async (tx) => {
    const existing = await findBatchForBusiness(tx, businessId);
    if (!existing) throw new NotFoundError("No opening balance batch has been saved yet");
    if (existing.status === "draft") await markBatchCommitted(tx, existing.id);

    const committed =
      existing.status === "committed" ? existing : await findBatchForBusiness(tx, businessId);
    const entries = await findEntriesForBatch(tx, existing.id);
    return {
      batchId: existing.id,
      goLiveDate: existing.goLiveDate,
      status: "committed",
      committedAt: committed?.committedAt ?? null,
      entries,
    };
  });
}
