import type { PaymentListRow } from "@fleetsettle/shared/schemas";

export type PaymentStatus = PaymentListRow["status"];

/** U-6: no raw enum text on screen — `CloseMonthScreen`/`CustomerDetailScreen` both show a payment's own `status`. */
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  active: "Active",
  corrected: "Corrected",
  reversed: "Reversed",
};
