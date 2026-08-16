import { parse, toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  AuditLogEntry,
  BusinessMemberResponse,
  correctPaymentRequestSchema,
  PaymentCorrectionResponse,
  PaymentListRow,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Timeline } from "../../components/Timeline.js";
import { Button } from "../../design/primitives/Button.js";
import { Label } from "../../design/primitives/Label.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { paymentAuditEntryToTimeline } from "./auditEntryToTimeline.js";

export interface CorrectPaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentListRow | null;
  today: BusinessDate;
  onCorrected: () => void;
}

type CorrectPaymentWireRequest = z.input<typeof correctPaymentRequestSchema>;

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap flex-1 rounded-sm border px-3 text-body text-center",
    selected ? "border-brand bg-brand-wash text-brand-ink" : "border-line-strong text-ink-primary",
  );
}

/**
 * F-8.2/UC-93/W-36/W-37 — "open the receipt", correct it. `bearer` is the
 * whole decision (never a silent default): `back_to_arrears` puts the
 * party back in arrears for the shortfall, `absorbed_loss` leaves their
 * due settled and the business eats it — worded here as two plain
 * sentences, never "allocation" (U-6). `Timeline` reads this payment's own
 * audit trail (F-8.6), per record rather than per month, exactly as
 * `GET /api/audit-log/{tableName}/{recordId}` is shaped for.
 */
export function CorrectPaymentSheet({
  open,
  onOpenChange,
  payment,
  today,
  onCorrected,
}: CorrectPaymentSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [differenceMinor, setDifferenceMinor] = useState<Minor | null>(null);
  const [bearer, setBearer] = useState<"back_to_arrears" | "absorbed_loss" | null>(null);
  const [reason, setReason] = useState("");
  const [correctedOn, setCorrectedOn] = useState<BusinessDate>(today);

  useEffect(() => {
    if (open) {
      setDifferenceMinor(null);
      setBearer(null);
      setReason("");
      setCorrectedOn(today);
    }
    // Sync on open only — see CollectPaymentSheet's own comment for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const auditQuery = useQuery({
    queryKey: ["audit-log", "payment", payment?.id],
    queryFn: () => {
      if (payment === null) throw new Error("no payment to fetch the audit trail for");
      return api.get<{ entries: AuditLogEntry[] }>(`/api/audit-log/payment/${payment.id}`);
    },
    enabled: open && payment !== null,
  });
  // allow: reasoned out below — a failed/pending membersQuery degrades
  // each entry to the honest "A former member" label, never a wrong name.
  const membersQuery = useQuery({
    queryKey: ["business-member"],
    queryFn: () => api.get<BusinessMemberResponse[]>("/api/business-member"),
    enabled: open,
  });
  // GAP-101: a failed audit read used to leave `timelineEntries` silently
  // empty (`?? []`), so the History section just didn't render — no
  // different from a payment with a genuinely empty trail. `membersQuery`
  // failing is not blocking: `paymentAuditEntryToTimeline` already
  // degrades a missing member to "A former member," a real, honest label,
  // not a fabricated one.
  const auditState = useQueryState(auditQuery);
  const historyFailure = auditState.kind === "error" ? auditState : null;

  const mutation = useMutation({
    mutationFn: () => {
      if (payment === null || differenceMinor === null || bearer === null) {
        throw new Error("difference, bearer and reason are required");
      }
      return api.post<PaymentCorrectionResponse>(`/api/payment/${payment.id}/correct`, {
        differenceMinor: toWire(differenceMinor),
        bearer,
        reason,
        correctedOn,
      } satisfies CorrectPaymentWireRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payment"] });
      void queryClient.invalidateQueries({ queryKey: ["audit-log", "payment", payment?.id] });
      onCorrected();
      onOpenChange(false);
    },
  });

  const canSave =
    differenceMinor !== null && differenceMinor > 0n && bearer !== null && reason.trim().length > 0;

  const timelineEntries = (auditQuery.data?.entries ?? []).map((entry) =>
    paymentAuditEntryToTimeline(entry, membersQuery.data ?? []),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Correct this payment">
      {payment !== null ? (
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-body text-ink-secondary">Recorded amount</span>
            <Money value={parse(payment.amountMinor)} />
          </div>

          <MoneyField
            label="Difference"
            valueMinor={differenceMinor}
            onChange={setDifferenceMinor}
          />

          <div className="flex flex-col gap-2">
            <Label>What happens to the shortfall</Label>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={bearer === "back_to_arrears"}
                onClick={() => setBearer("back_to_arrears")}
                className={chipClass(bearer === "back_to_arrears")}
              >
                He still owes it
              </button>
              <button
                type="button"
                aria-pressed={bearer === "absorbed_loss"}
                onClick={() => setBearer("absorbed_loss")}
                className={chipClass(bearer === "absorbed_loss")}
              >
                We absorb it
              </button>
            </div>
          </div>

          <NoteField label="Reason (required)" value={reason} onChange={setReason} />
          <DateField label="Date" value={correctedOn} today={today} onChange={setCorrectedOn} />

          {mutation.isError ? (
            <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
          ) : null}
          <Button
            type="button"
            size="cta"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Correct payment
          </Button>

          {historyFailure !== null ? (
            <div className="flex flex-col gap-3 border-t border-line-hairline pt-4">
              <Label>History</Label>
              <QueryStateFailure
                error={historyFailure.error}
                retry={historyFailure.retry}
                of="this payment's history"
              />
            </div>
          ) : timelineEntries.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-line-hairline pt-4">
              <Label>History</Label>
              <Timeline entries={timelineEntries} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
