import { toWire, type Minor } from "@fleetsettle/shared";
import type { Reader, Tx, Writer } from "../db/client.js";
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
  type CustomerRow,
} from "../queries/customer.js";
import {
  archiveDriverRow,
  findDriverForBusiness,
  unarchiveDriverRow,
  type DriverRow,
} from "../queries/driver.js";
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
  reader: Reader | Tx,
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
    // GAP-203/H-1/D2: a written-off portion is never collectible, so it is
    // never "open money" a party is still holding against.
    (sum, o) => sum + (o.amountMinor - o.settledMinor - o.waivedMinor - o.writtenOffMinor),
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
    // GAP-203/H-1/D2: a written-off portion is never collectible, so it is
    // never "open money" a party is still holding against.
    (sum, o) => sum + (o.amountMinor - o.settledMinor - o.waivedMinor - o.writtenOffMinor),
    0n,
  );
  if (payableMinor > 0n) items.push({ kind: "payable", amountMinor: payableMinor });

  // GAP-132: a party normally holds few deposits, so this stays a handful of
  // parallel reads rather than a full aggregate query — sequential awaits in
  // a loop is the shape CLAUDE.md/api's own "no loop issuing one query per
  // row" rule names, even at this small a scale.
  const openDeposits = await findOpenDepositsForParty(reader, businessId, partyType, partyId);
  const depositSums = await Promise.all(openDeposits.map((d) => sumDepositMovements(reader, d.id)));
  const depositMinor = depositSums.reduce((sum, amount) => sum + amount, 0n);
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
  reader: Reader | Tx,
  businessId: string,
  partyType: "customer" | "driver",
  partyId: string,
): Promise<void> {
  const items = await findOpenMoneyForParty(reader, businessId, partyType, partyId);
  if (items.length === 0) return;
  const { message, openItems } = describeOpenItems(items);
  throw new PartyHasOpenMoneyError(message, openItems);
}

/** GAP-131: returns the row the caller already needed to fetch, post-write, so a handler that needs it for its response never re-fetches. */
export async function archiveDriver(
  reader: Reader,
  writer: Writer,
  input: ArchivePartyInput,
): Promise<DriverRow> {
  const existing = await findDriverForBusiness(reader, input.businessId, input.partyId);
  if (!existing) throw new NotFoundError("No such driver in this business");
  if (existing.voidedAt !== null) throw new PartyAlreadyArchivedError();

  // GAP-190/B13, corrected after Gitar's review of the first cut: running
  // the check on `tx` instead of `reader` narrows the window but does not
  // by itself serialize anything under READ COMMITTED — a plain SELECT
  // here and a plain SELECT in migration 0031's trigger can each read the
  // other's pre-commit state, so an archive and a concurrent money insert
  // could still both succeed. Locking the driver row FOR UPDATE here, and
  // migration 0034 giving the trigger's own check FOR SHARE on the same
  // row, is what actually closes it: the two conflict, so whichever
  // transaction gets there first is seen by the other.
  //
  // Transaction-wrapped also for consistency with every void endpoint in
  // this codebase, though `driver`/`customer` carry no `posted_period_id`
  // (DM §13) so migration 0002's audit trigger never attaches to them —
  // there is no `audit_log` row to attribute either way; `voided_by` is set
  // directly, from `input.userId`, regardless. What the transaction *does*
  // matter for here is the WHERE guard inside `archiveDriverRow`: a losing
  // race against a concurrent archive returns undefined rather than a
  // clobbered row, treated the same as the already-archived check above.
  const voided = await writer.transaction(async (tx) => {
    await findDriverForBusiness(tx, input.businessId, input.partyId, true);
    await assertArchivable(tx, input.businessId, "driver", input.partyId);
    return archiveDriverRow(tx, input.partyId, {
      voidedReason: input.reason,
      voidedBy: input.userId,
    });
  });
  if (!voided) throw new PartyAlreadyArchivedError();
  return { ...existing, voidedAt: voided.voidedAt };
}

/** GAP-131: same as `archiveDriver` — returns the fetched row, post-write. */
export async function unarchiveDriver(
  reader: Reader,
  writer: Writer,
  businessId: string,
  driverId: string,
): Promise<DriverRow> {
  const existing = await findDriverForBusiness(reader, businessId, driverId);
  if (!existing) throw new NotFoundError("No such driver in this business");
  await writer.transaction((tx) => unarchiveDriverRow(tx, driverId));
  return { ...existing, voidedAt: null };
}

/** GAP-131: returns the row the caller already needed to fetch, post-write, so a handler that needs it for its response never re-fetches. */
export async function archiveCustomer(
  reader: Reader,
  writer: Writer,
  input: ArchivePartyInput,
): Promise<CustomerRow> {
  const existing = await findCustomerForBusiness(reader, input.businessId, input.partyId);
  if (!existing) throw new NotFoundError("No such customer in this business");
  if (existing.voidedAt !== null) throw new PartyAlreadyArchivedError();

  // See archiveDriver's own comment (GAP-190/B13): the FOR UPDATE lock, not
  // only running the check on `tx`, is what actually serializes this
  // against migration 0034's trigger — `customer` has no `posted_period_id`
  // either, so migration 0002's audit trigger doesn't cover it.
  const voided = await writer.transaction(async (tx) => {
    await findCustomerForBusiness(tx, input.businessId, input.partyId, true);
    await assertArchivable(tx, input.businessId, "customer", input.partyId);
    return archiveCustomerRow(tx, input.partyId, {
      voidedReason: input.reason,
      voidedBy: input.userId,
    });
  });
  if (!voided) throw new PartyAlreadyArchivedError();
  return { ...existing, voidedAt: voided.voidedAt };
}

/** GAP-131: same as `archiveDriver`'s twin — returns the fetched row, post-write. */
export async function unarchiveCustomer(
  reader: Reader,
  writer: Writer,
  businessId: string,
  customerId: string,
): Promise<CustomerRow> {
  const existing = await findCustomerForBusiness(reader, businessId, customerId);
  if (!existing) throw new NotFoundError("No such customer in this business");
  await writer.transaction((tx) => unarchiveCustomerRow(tx, customerId));
  return { ...existing, voidedAt: null };
}
