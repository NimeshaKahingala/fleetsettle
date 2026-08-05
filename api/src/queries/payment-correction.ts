import type { Tx, Writer } from "../db/client.js";
import { paymentCorrection } from "../db/schema.js";

type WriteDb = Writer | Tx;

export interface NewPaymentCorrection {
  id: string;
  businessId: string;
  paymentId: string;
  differenceMinor: bigint;
  bearer: "back_to_arrears" | "absorbed_loss";
  reason: string;
  correctedOn: string;
  postedPeriodId: string;
  belongsToPeriodId?: string;
  createdBy?: string;
}

/** UC-93/W-36/W-37, INV-21: the recorded reason and decision behind a payment correction — `payment.amount_minor`/`status` carry the actual change (`updatePaymentAfterCorrection`), this row is why. */
export async function insertPaymentCorrection(
  db: WriteDb,
  values: NewPaymentCorrection,
): Promise<void> {
  await db.insert(paymentCorrection).values(values);
}
