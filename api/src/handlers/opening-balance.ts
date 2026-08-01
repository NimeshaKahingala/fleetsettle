import { toWire, type Minor } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { commitOpeningBalance, saveOpeningBalance } from "../domain/opening-balance.js";
import { NotFoundError } from "../errors/app-error.js";
import type { Reader } from "../db/client.js";
import {
  findBatchForBusiness,
  findEntriesForBatch,
  findOwnCustomerIds,
  findOwnDriverIds,
  findOwnMemberUserIds,
  findOwnVehicleIds,
  type OpeningBalanceEntryRow,
  type OpeningBalanceBatchRow,
} from "../queries/opening-balance.js";
import type {
  commitOpeningBalanceRoute,
  getOpeningBalanceRoute,
  saveOpeningBalanceRoute,
} from "../route-defs/opening-balance.js";
import type { Env } from "../types.js";
import type { CommitOpeningBalanceBatchRequest } from "@fleetsettle/shared/schemas";

type EntryInput = CommitOpeningBalanceBatchRequest["entries"][number];

/**
 * One query per party type regardless of how many entries name one (IG
 * §3.1), never a query per entry. A party from another business — or one
 * that never existed — is 404, not 403 (CLAUDE.md → Tenancy).
 */
async function assertPartiesBelongToBusiness(
  reader: Reader,
  businessId: string,
  entries: EntryInput[],
): Promise<void> {
  const customerIds = [
    ...new Set(
      entries
        .map((e) => ("partyCustomerId" in e ? e.partyCustomerId : undefined))
        .filter((v): v is string => v !== undefined),
    ),
  ];
  const driverIds = [
    ...new Set(
      entries
        .map((e) => ("partyDriverId" in e ? e.partyDriverId : undefined))
        .filter((v): v is string => v !== undefined),
    ),
  ];
  const userIds = [
    ...new Set(
      entries
        .map((e) => ("partyUserId" in e ? e.partyUserId : undefined))
        .filter((v): v is string => v !== undefined),
    ),
  ];
  const vehicleIds = [
    ...new Set(entries.map((e) => e.vehicleId).filter((v): v is string => v !== undefined)),
  ];

  const [ownCustomers, ownDrivers, ownUsers, ownVehicles] = await Promise.all([
    findOwnCustomerIds(reader, businessId, customerIds),
    findOwnDriverIds(reader, businessId, driverIds),
    findOwnMemberUserIds(reader, businessId, userIds),
    findOwnVehicleIds(reader, businessId, vehicleIds),
  ]);

  if (customerIds.some((id) => !ownCustomers.has(id)))
    throw new NotFoundError("No such customer in this business");
  if (driverIds.some((id) => !ownDrivers.has(id)))
    throw new NotFoundError("No such driver in this business");
  if (userIds.some((id) => !ownUsers.has(id)))
    throw new NotFoundError("No such business partner in this business");
  if (vehicleIds.some((id) => !ownVehicles.has(id)))
    throw new NotFoundError("No such vehicle in this business");
}

function toEntryResponse(row: OpeningBalanceEntryRow) {
  const common = {
    id: row.id,
    amountMinor: toWire(row.amountMinor as Minor),
    vehicleId: row.vehicleId,
    originalDueDate: row.originalDueDate,
  };
  switch (row.kind) {
    case "customer_due":
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DM §10.6's CHECK guarantees this party for this kind
      return { kind: row.kind, partyCustomerId: row.partyCustomerId!, ...common };
    case "driver_arrears":
    case "owed_to_driver":
    case "deposit_held":
    case "advance_outstanding":
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DM §10.6's CHECK guarantees this party for this kind
      return { kind: row.kind, partyDriverId: row.partyDriverId!, ...common };
    case "cash_held":
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- DM §10.6's CHECK guarantees this party for this kind
      return { kind: row.kind, partyUserId: row.partyUserId!, ...common };
  }
}

function toBatchResponse(
  batch: {
    id: string;
    goLiveDate: string;
    status: "draft" | "committed";
    committedAt: string | null;
  },
  entries: OpeningBalanceEntryRow[],
) {
  return {
    id: batch.id,
    goLiveDate: batch.goLiveDate,
    status: batch.status,
    committedAt: batch.committedAt,
    entries: entries.map(toEntryResponse),
  };
}

/** F-0.2 / UC-09. `manageOpeningBalances` — owners only, the same blast-radius class as closing a period. */
export const saveOpeningBalanceHandler: RouteHandler<typeof saveOpeningBalanceRoute, Env> = async (
  c,
) => {
  requireCapability(c, "manageOpeningBalances");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const reader = c.get("reader");

  await assertPartiesBelongToBusiness(reader, businessId, body.entries);

  const saved = await saveOpeningBalance(c.get("writer"), {
    businessId,
    goLiveDate: body.goLiveDate,
    entries: body.entries.map((entry) => ({
      kind: entry.kind,
      ...("partyCustomerId" in entry ? { partyCustomerId: entry.partyCustomerId } : {}),
      ...("partyDriverId" in entry ? { partyDriverId: entry.partyDriverId } : {}),
      ...("partyUserId" in entry ? { partyUserId: entry.partyUserId } : {}),
      ...(entry.vehicleId !== undefined ? { vehicleId: entry.vehicleId } : {}),
      amountMinor: entry.amountMinor,
      ...(entry.originalDueDate !== undefined ? { originalDueDate: entry.originalDueDate } : {}),
    })),
  });

  return c.json(
    toBatchResponse(
      {
        id: saved.batchId,
        goLiveDate: body.goLiveDate,
        status: saved.status,
        committedAt: saved.committedAt,
      },
      saved.entries,
    ),
    200,
  );
};

export const getOpeningBalanceHandler: RouteHandler<typeof getOpeningBalanceRoute, Env> = async (
  c,
) => {
  requireCapability(c, "manageOpeningBalances");

  const businessId = requireBusinessId(c);
  const reader = c.get("reader");

  const batch: OpeningBalanceBatchRow | undefined = await findBatchForBusiness(reader, businessId);
  if (!batch) throw new NotFoundError("No opening balance batch has been saved yet");

  const entries = await findEntriesForBatch(reader, batch.id);
  return c.json(toBatchResponse(batch, entries), 200);
};

export const commitOpeningBalanceHandler: RouteHandler<
  typeof commitOpeningBalanceRoute,
  Env
> = async (c) => {
  requireCapability(c, "manageOpeningBalances");

  const businessId = requireBusinessId(c);
  const committed = await commitOpeningBalance(c.get("writer"), businessId);

  return c.json(
    toBatchResponse(
      {
        id: committed.batchId,
        goLiveDate: committed.goLiveDate,
        status: committed.status,
        committedAt: committed.committedAt,
      },
      committed.entries,
    ),
    200,
  );
};
