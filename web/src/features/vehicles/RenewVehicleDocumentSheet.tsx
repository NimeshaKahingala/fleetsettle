import { zodResolver } from "@hookform/resolvers/zod";
import type { BusinessDate } from "@fleetsettle/shared";
import type {
  UpsertVehicleDocumentRequest,
  VehicleDocumentResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";
import {
  VEHICLE_DOC_TYPE_LABEL,
  VEHICLE_DOC_TYPE_OPTIONS,
} from "../../lib/vehicleDocumentLabel.js";

export interface RenewVehicleDocumentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  today: BusinessDate;
  initialDocument?: VehicleDocumentResponse | undefined;
}

const renewVehicleDocumentSchema = z.object({
  docType: z.enum(["insurance", "registration", "revenue_licence", "permit", "emissions"]),
  expiryDate: z.custom<BusinessDate>((v) => typeof v === "string", "Expiry date is required"),
  reference: z.string().trim().max(200, "Reference must be 200 characters or fewer"),
});
type RenewVehicleDocumentValues = z.infer<typeof renewVehicleDocumentSchema>;

/**
 * GAP-102 / UC-92: renew one vehicle document from the overview. The API is
 * an upsert, so this sheet edits the document type's single current expiry
 * row rather than creating a renewal history.
 */
export function RenewVehicleDocumentSheet({
  open,
  onOpenChange,
  vehicleId,
  today,
  initialDocument,
}: RenewVehicleDocumentSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<RenewVehicleDocumentValues>({
    resolver: zodResolver(renewVehicleDocumentSchema),
    defaultValues: {
      docType: initialDocument?.docType ?? "insurance",
      expiryDate: (initialDocument?.expiryDate ?? today) as BusinessDate,
      reference: initialDocument?.reference ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: RenewVehicleDocumentValues) => {
      const reference = values.reference.trim();
      const body: UpsertVehicleDocumentRequest = {
        docType: values.docType,
        expiryDate: values.expiryDate,
        ...(reference.length > 0 ? { reference } : {}),
      };
      return api.put<VehicleDocumentResponse>(`/api/vehicle/${vehicleId}/document`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "document"] });
      void queryClient.invalidateQueries({ queryKey: ["home", "paperwork-warnings"] });
      onOpenChange(false);
    },
  });

  const docType = watch("docType");

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    reset({
      docType: initialDocument?.docType ?? "insurance",
      expiryDate: (initialDocument?.expiryDate ?? today) as BusinessDate,
      reference: initialDocument?.reference ?? "",
    });
    // Sync when the sheet opens; while open, user edits should stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-time reset only
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Renew paperwork">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
      >
        <div className="flex flex-col gap-1">
          <span className="text-label font-medium text-ink-secondary">Document</span>
          <div className="grid grid-cols-2 gap-2">
            {VEHICLE_DOC_TYPE_OPTIONS.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                aria-pressed={docType === code}
                onClick={() => setValue("docType", code, { shouldDirty: true })}
                className={
                  docType === code
                    ? "min-h-tap rounded-sm border border-brand bg-brand-wash px-2 text-body-sm text-brand-ink"
                    : "min-h-tap rounded-sm border border-transparent bg-surface-sunken px-2 text-body-sm text-ink-primary"
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Controller
          control={control}
          name="expiryDate"
          render={({ field }) => (
            <DateField
              label={`${VEHICLE_DOC_TYPE_LABEL[docType]} expiry`}
              today={today}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />

        <Field
          label="Reference"
          htmlFor="vehicleDocumentReference"
          optional
          error={errors.reference?.message}
        >
          <Input
            id="vehicleDocumentReference"
            aria-invalid={errors.reference !== undefined}
            aria-describedby={fieldErrorId("vehicleDocumentReference")}
            {...register("reference")}
          />
        </Field>

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          Save paperwork
        </Button>
      </form>
    </Sheet>
  );
}
