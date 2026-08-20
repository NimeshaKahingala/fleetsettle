import type { BusinessDate } from "@fleetsettle/shared";
import type {
  CreateLeaseDayExceptionRequest,
  LeaseDayExceptionResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface SkipDailyLeaseDaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  dailyLeaseId: string;
  today: BusinessDate;
}

/** F-1.7/GAP-20: an individually skipped date is an exception checked before any daily card is generated. */
export function SkipDailyLeaseDaySheet({
  open,
  onOpenChange,
  vehicleId,
  dailyLeaseId,
  today,
}: SkipDailyLeaseDaySheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [exceptionDate, setExceptionDate] = useState<BusinessDate>(today);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setExceptionDate(today);
    setReason("");
  }, [open, today]);

  const mutation = useMutation({
    mutationFn: (body: CreateLeaseDayExceptionRequest) =>
      api.post<LeaseDayExceptionResponse>(`/api/daily-lease/${dailyLeaseId}/exception`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "daily-lease"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-lease"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Skip daily lease day">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedReason = reason.trim();
          mutation.mutate({
            exceptionDate,
            ...(trimmedReason !== "" ? { reason: trimmedReason } : {}),
          });
        }}
      >
        <DateField
          label="Skipped date"
          today={today}
          value={exceptionDate}
          onChange={setExceptionDate}
        />
        <Field label="Reason" htmlFor="leaseDayExceptionReason" optional>
          <Input
            id="leaseDayExceptionReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          Skip daily lease day
        </Button>
      </form>
    </Sheet>
  );
}
