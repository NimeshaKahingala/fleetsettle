import { zodResolver } from "@hookform/resolvers/zod";
import type { BusinessDate } from "@fleetsettle/shared";
import type { DailyLeaseResponse, EndDailyLeaseRequest } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface EndDailyLeaseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  dailyLeaseId: string;
  today: BusinessDate;
  onEnded?: () => void;
}

const endDailyLeaseSchema = z.object({
  effectiveTo: z.custom<BusinessDate>((v) => typeof v === "string", "End date is required"),
});
type EndDailyLeaseValues = z.infer<typeof endDailyLeaseSchema>;

/**
 * F-4.8/UC-101/GAP-25: "nothing replaces it" — distinct from F-4.7's
 * change-driver flow, which is its own sheet with a new driver in the same
 * request. INV-37: this never refuses on an open driver balance, so the
 * form carries no balance check of its own to mirror.
 */
export function EndDailyLeaseSheet({
  open,
  onOpenChange,
  vehicleId,
  dailyLeaseId,
  today,
  onEnded,
}: EndDailyLeaseSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EndDailyLeaseValues>({
    resolver: zodResolver(endDailyLeaseSchema),
    defaultValues: { effectiveTo: today },
  });

  const mutation = useMutation({
    mutationFn: (values: EndDailyLeaseValues) => {
      const body: EndDailyLeaseRequest = { effectiveTo: values.effectiveTo };
      return api.post<DailyLeaseResponse>(`/api/daily-lease/${dailyLeaseId}/end`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "daily-lease"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-lease"] });
      onOpenChange(false);
      onEnded?.();
    },
  });

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    reset({ effectiveTo: today });
    // Sync when the sheet opens; while open, user edits should stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-time reset only
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="End daily lease">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
      >
        <p className="text-body-sm text-ink-secondary">
          Past days and whatever the driver owes or is owed stay exactly as they are, on his own
          page.
        </p>

        <Controller
          control={control}
          name="effectiveTo"
          render={({ field }) => (
            <DateField
              label="Last day"
              today={today}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        {errors.effectiveTo?.message !== undefined ? (
          <p className="text-body-sm text-critical-ink">{errors.effectiveTo.message}</p>
        ) : null}

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          End daily lease
        </Button>
      </form>
    </Sheet>
  );
}
