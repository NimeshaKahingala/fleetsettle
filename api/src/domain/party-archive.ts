import { toWire, type Minor } from "@fleetsettle/shared";
import type { Reader, Writer } from "../db/client.js";
import {
  NotFoundError,
  PartyAlreadyArchivedError,
  PartyHasOpenMoneyError,
  type OpenMoneyItem,
} from "../errors/app-error.js";
import {
  archiveCustomerRow,
  findCustomerForBusiness,
  unarchiveCustomerRow,
} from "../queries/customer.js";
import { archiveDriverRow, findDriverForBusiness, unarchiveDriverRow } from "../queries/driver.js";
import {
  findOpenAdvancesForDriver,
  findOpenDepositsForParty,
  sumDepositMovements,
} from "../queries/driver-money.js";
import { findOutstandingObligationsForParty } from "../queries/obligation.js";

type OpenMoneyKind = OpenMoneyItem["kind"];

export interface ArchivePartyInput {
  businessId: string;
  partyId: string;
  reason: string;
  userId: string;
}

/**
 * INV-35/W-60/UC-100. The archive check itself, shared by both driver and
 * customer — a due (`owed_to_us`), a payable (`owed_by_us`), a deposit still
 * `held`/`hold_window`, and, driver only, an advance still
 * `open`/`part_settled`. INV-3 still applies: the two obligation directions
 * are summed and reported separately, never netted into one figure.
 */
export async function findOpenMoneyForParty(
  reader: Reader,
  businessId: string,
  partyType: "customer" | "driver",
  partyId: string,
): Promise<Array<{ kind: OpenMoneyKind; amountMinor: bigint }>> {
  const items: Array<{ kind: OpenMoneyKind; amountMinor: bigint }> = [];

  const owedToUs = await findOutstandingObligationsForParty(
    reader,
    businessId,
    partyType,
    partyId,
    "owed_to_us",
  );
  const dueMinor = owedToUs.reduce(
    (sum, o) => sum + (o.amountMinor - o.settledMinor - o.waivedMinor),
    0n,
  );
  if (dueMinor > 0n) items.push({ kind: "due", amountMinor: dueMinor });

  const owedByUs = await findOutstandingObligationsForParty(
    reader,
    businessId,
    partyType,
    partyId,
    "owed_by_us",
  );
  const payableMinor = owedByUs.reduce(
    (sum, o) => sum + (o.amountMinor - o.settledMinor - o.waivedMinor),
    0n,
  );
  if (payableMinor > 0n) items.push({ kind: "payable", amountMinor: payableMinor });

  const openDeposits = await findOpenDepositsForParty(reader, businessId, partyType, partyId);
  let depositMinor = 0n;
  for (const d of openDeposits) {
    depositMinor += await sumDepositMovements(reader, d.id);
  }
  if (depositMinor > 0n) items.push({ kind: "deposit_held", amountMinor: depositMinor });

  if (partyType === "driver") {
    const openAdvances = await findOpenAdvancesForDriver(reader, businessId, partyId);
    const advanceMinor = openAdvances.reduce((sum, a) => sum + a.amountMinor, 0n);
    if (advanceMinor > 0n) items.push({ kind: "advance", amountMinor: advanceMinor });
  }

  return items;
}

function kindLabel(kind: OpenMoneyKind): string {
  switch (kind) {
    case "due":
      return "a due";
    case "payable":
      return "money owed to him";
    case "deposit_held":
      return "a deposit held";
    case "advance":
      return "an unreconciled advance";
  }
}

function describeOpenItems(items: Array<{ kind: OpenMoneyKind; amountMinor: bigint }>): {
  message: string;
  openItems: OpenMoneyItem[];
} {
  const openItems = items.map((i) => ({
    kind: i.kind,
    amountMinor: toWire(i.amountMinor as Minor),
  }));
  const parts = items.map((i) => `${kindLabel(i.kind)} (${toWire(i.amountMinor as Minor)})`);
  return {
    message: `Cannot archive — still open: ${parts.join(", ")}`,
    openItems,
  };
}

async function assertArchivable(
  reader: Reader,
  businessId: string,
  partyType: "customer" | "driver",
  partyId: string,
): Promise<void> {
  const items = await findOpenMoneyForParty(reader, businessId, partyType, partyId);
  if (items.length === 0) return;
  const { message, openItems } = describeOpenItems(items);
  throw new PartyHasOpenMoneyError(message, openItems);
}

export async function archiveDriver(
  reader: Reader,
  writer: Writer,
  input: ArchivePartyInput,
): Promise<{ voidedAt: string }> {
  const existing = await findDriverForBusiness(reader, input.businessId, input.partyId);
  if (!existing) throw new NotFoundError("No such driver in this business");
  if (existing.voidedAt !== null) throw new PartyAlreadyArchivedError();

  await assertArchivable(reader, input.businessId, "driver", input.partyId);

  return archiveDriverRow(writer, input.partyId, {
    voidedReason: input.reason,
    voidedBy: input.userId,
  });
}

export async function unarchiveDriver(
  reader: Reader,
  writer: Writer,
  businessId: string,
  driverId: string,
): Promise<void> {
  const existing = await findDriverForBusiness(reader, businessId, driverId);
  if (!existing) throw new NotFoundError("No such driver in this business");
  await unarchiveDriverRow(writer, driverId);
}

export async function archiveCustomer(
  reader: Reader,
  writer: Writer,
  input: ArchivePartyInput,
): Promise<{ voidedAt: string }> {
  const existing = await findCustomerForBusiness(reader, input.businessId, input.partyId);
  if (!existing) throw new NotFoundError("No such customer in this business");
  if (existing.voidedAt !== null) throw new PartyAlreadyArchivedError();

  await assertArchivable(reader, input.businessId, "customer", input.partyId);

  return archiveCustomerRow(writer, input.partyId, {
    voidedReason: input.reason,
    voidedBy: input.userId,
  });
}

export async function unarchiveCustomer(
  reader: Reader,
  writer: Writer,
  businessId: string,
  customerId: string,
): Promise<void> {
  const existing = await findCustomerForBusiness(reader, businessId, customerId);
  if (!existing) throw new NotFoundError("No such customer in this business");
  await unarchiveCustomerRow(writer, customerId);
}
