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

  // Transaction-wrapped for consistency with every void endpoint in this
  // codebase, though `driver`/`customer` carry no `posted_period_id` (DM
  // §13) so migration 0002's audit trigger never attaches to them — there is
  // no `audit_log` row to attribute either way; `voided_by` is set directly,
  // from `input.userId`, regardless. What the transaction *does* matter for
  // here is the WHERE guard inside `archiveDriverRow`: a losing race against
  // a concurrent archive returns undefined rather than a clobbered row,
  // treated the same as the already-archived check above.
  const voided = await writer.transaction((tx) =>
    archiveDriverRow(tx, input.partyId, {
      voidedReason: input.reason,
      voidedBy: input.userId,
    }),
  );
  if (!voided) throw new PartyAlreadyArchivedError();
  return voided;
}

export async function unarchiveDriver(
  reader: Reader,
  writer: Writer,
  businessId: string,
  driverId: string,
): Promise<void> {
  const existing = await findDriverForBusiness(reader, businessId, driverId);
  if (!existing) throw new NotFoundError("No such driver in this business");
  await writer.transaction((tx) => unarchiveDriverRow(tx, driverId));
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

  // See archiveDriver's own comment: the transaction here is for the WHERE
  // guard's race behaviour, not audit_log attribution — `customer` has no
  // `posted_period_id` either, so migration 0002's trigger doesn't cover it.
  const voided = await writer.transaction((tx) =>
    archiveCustomerRow(tx, input.partyId, {
      voidedReason: input.reason,
      voidedBy: input.userId,
    }),
  );
  if (!voided) throw new PartyAlreadyArchivedError();
  return voided;
}

export async function unarchiveCustomer(
  reader: Reader,
  writer: Writer,
  businessId: string,
  customerId: string,
): Promise<void> {
  const existing = await findCustomerForBusiness(reader, businessId, customerId);
  if (!existing) throw new NotFoundError("No such customer in this business");
  await writer.transaction((tx) => unarchiveCustomerRow(tx, customerId));
}
