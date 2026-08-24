import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { LeaseObligationRow, PaymentResponse } from "@fleetsettle/shared/schemas";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AllocationPreview, type AllocationLine } from "../../components/AllocationPreview.js";
import { AmountPad } from "../../components/AmountPad.js";
import { DateField } from "../../components/DateField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { OPEN_OBLIGATION_STATUSES } from "../../lib/obligationStatusLabel.js";

export interface CollectPaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
  /** Already oldest-first (the API's own order) — this component allocates against it but never re-sorts it. */
  dues: LeaseObligationRow[];
  today: BusinessDate;
  /** F-2.2's "tap the due" pre-fills the amount from that one due — the write itself is still party-level (§6.5), so entering more still rolls into the next-oldest due too, the same "two months together" alternate the spec names. */
  initialAmountMinor?: Minor;
  /** Fires after a successful collection, before the sheet closes — the caller owns its own query invalidation (a lease's dues, a trip's own receivable), since this sheet has no idea which screen opened it. */
  onCollected: () => void;
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** §6.5's allocation discipline, mirrored client-side only to build the preview `AllocationPreview` shows before anything writes — the server (`recordPayment`) re-derives the real allocation itself; this never sends per-obligation instructions. */
function buildAllocationPreview(amountMinor: Minor, dues: LeaseObligationRow[]): AllocationLine[] {
  let remaining = amountMinor;
  const lines: AllocationLine[] = [];
  for (const due of dues) {
    if (remaining <= 0n) break;
    if (!OPEN_OBLIGATION_STATUSES.has(due.status)) continue;
    const outstanding = (BigInt(due.amountMinor) -
      BigInt(due.settledMinor) -
      BigInt(due.waivedMinor)) as Minor;
    if (outstanding <= 0n) continue;
    const applied = remaining < outstanding ? remaining : outstanding;
    lines.push({ key: due.id, dateLabel: formatShortDate(due.dueOn), amountMinor: applied });
    remaining = (remaining - applied) as Minor;
  }
  return lines;
}

/**
 * F-2.2/UC-11: amount + date, then the oldest-first `AllocationPreview`
 * before anything writes (the add-screen skill's own rule: "any write that
 * allocates across items shows `AllocationPreview` **before** it writes").
 * The write itself is `POST /api/payment` — party-level, no obligation ids
 * — so this sheet's own preview is UI only; the server performs the real
 * allocation independently and is the only authority on what actually
 * settled. Party-level all the way down, which is also why this sheet
 * takes no `leaseId`/`tripId` — `LeaseHubScreen` and `TripDetailScreen`
 * (GAP-57) both open it against a customer, never against a specific record.
 */
export function CollectPaymentSheet({
  open,
  onOpenChange,
  customerId,
  customerName,
  dues,
  today,
  initialAmountMinor,
  onCollected,
}: CollectPaymentSheetProps) {
  const api = useApi();
  const [step, setStep] = useState<"enter" | "preview">("enter");
  const [amountMinor, setAmountMinor] = useState<Minor | null>(initialAmountMinor ?? null);
  const [occurredOn, setOccurredOn] = useState<BusinessDate>(today);

  useEffect(() => {
    if (open) {
      setStep("enter");
      setAmountMinor(initialAmountMinor ?? null);
      setOccurredOn(today);
    }
    // Sync on open, not close — this sheet stays mounted continuously
    // (`LeaseHubScreen` never conditionally unmounts it, unlike
    // `AdjustObligationSheet`), and `initialAmountMinor` differs per due
    // that opens it. A close-only reset would seed `useState`'s initial
    // value once at first mount and never again, leaving every later
    // due's own pre-fill invisible — the bug this fixes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only, see above
  }, [open]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<PaymentResponse>("/api/payment", {
        partyType: "customer",
        partyId: customerId,
        amountMinor: toWire(value),
        occurredOn,
      }),
    onSuccess: () => {
      onCollected();
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Collect payment">
      {step === "enter" ? (
        <div className="flex flex-col gap-4">
          <DateField label="Date" value={occurredOn} onChange={setOccurredOn} today={today} />
          <AmountPad
            title="Amount received"
            {...(amountMinor !== null ? { initialValueMinor: amountMinor } : {})}
            onSave={(value) => {
              if (value > 0n) {
                setAmountMinor(value);
                setStep("preview");
              }
            }}
          />
        </div>
      ) : amountMinor !== null ? (
        <div className="flex flex-col gap-3">
          <AllocationPreview
            totalMinor={amountMinor}
            partyLabel={customerName}
            lines={buildAllocationPreview(amountMinor, dues)}
            onChangeAllocation={() => setStep("enter")}
            onConfirm={() => mutation.mutate(amountMinor)}
          />
          {mutation.isError ? (
            <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
