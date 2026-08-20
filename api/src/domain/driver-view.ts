import type { Reader, Tx, Writer } from "../db/client.js";
import {
  listAdvancesForDriver,
  listDepositMovementsForDeposit,
  listOffsetsForDriver,
  findHeldDepositForDriver,
  sumDepositMovements,
  type AdvanceRow,
  type DepositMovementHistoryRow,
  type OffsetRecordRow,
} from "../queries/driver-money.js";
import { listDayRecordsForDriver, type DriverViewDayRow } from "../queries/day-record.js";
import {
  findOutstandingObligationsForDriver,
  sumOutstandingByDirectionForDriver,
  type OutstandingObligation,
} from "../queries/obligation.js";
import { listClosedTripsForDriver, type DriverViewTripRow } from "../queries/trip.js";

type ReadDb = Reader | Writer | Tx;

export interface DriverOwnView {
  owedToUsMinor: bigint;
  owedByUsMinor: bigint;
  days: DriverViewDayRow[];
  trips: DriverViewTripRow[];
  advances: AdvanceRow[];
  offsets: OffsetRecordRow[];
  deposit: { id: string; heldMinor: bigint; movements: DepositMovementHistoryRow[] } | null;
  owedToUsObligations: OutstandingObligation[];
}

/**
 * F-6.8/UC-59/W-13, INV-25: the linked driver's own view, assembled the same
 * way F-6.5's staff-facing figures are — every figure here must match F-6.5
 * exactly, since it's two people looking at one number instead of two
 * memories. `driverId` is never a parameter here; the caller (`requireDriverId`)
 * resolves it from the verified identity, which is the entire security
 * boundary (W-49) — there is no route by which this function could be asked
 * for a different driver's data.
 */
export async function getDriverOwnView(
  db: ReadDb,
  businessId: string,
  driverId: string,
  from: string,
  to: string,
): Promise<DriverOwnView> {
  const [balances, days, trips, advances, offsets, heldDeposit, owedToUsObligations] =
    await Promise.all([
      sumOutstandingByDirectionForDriver(db, businessId, driverId),
      listDayRecordsForDriver(db, businessId, driverId, from, to),
      listClosedTripsForDriver(db, businessId, driverId, from, to),
      listAdvancesForDriver(db, businessId, driverId, from, to),
      listOffsetsForDriver(db, businessId, driverId, from, to),
      findHeldDepositForDriver(db, businessId, driverId),
      findOutstandingObligationsForDriver(db, businessId, driverId, "owed_to_us"),
    ]);

  const deposit =
    heldDeposit !== undefined
      ? await Promise.all([
          sumDepositMovements(db, heldDeposit.id),
          listDepositMovementsForDeposit(db, businessId, heldDeposit.id),
        ]).then(([heldMinor, movements]) => ({ id: heldDeposit.id, heldMinor, movements }))
      : null;

  return {
    owedToUsMinor: balances.owedToUsMinor,
    owedByUsMinor: balances.owedByUsMinor,
    days,
    trips,
    advances,
    offsets,
    deposit,
    owedToUsObligations,
  };
}
