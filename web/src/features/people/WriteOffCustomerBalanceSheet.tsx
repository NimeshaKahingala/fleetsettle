import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { VehicleResponse, WriteOffResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface WriteOffCustomerBalanceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  today: BusinessDate;
}

/** F-8.3/UC-90: standalone customer loss, not tied to one visible due. */
export function WriteOffCustomerBalanceSheet({
  open,
  onOpenChange,
  customerId,
  today,
}: WriteOffCustomerBalanceSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [reason, setReason] = useState("");
  const [writtenOffOn, setWrittenOffOn] = useState<BusinessDate>(today);
  const [selectedVehicle, setSelectedVehicle] = useState<EntityOption | null>(null);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", "write-off-picker"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
    enabled: open,
  });
  const vehiclesState = useQueryState(vehiclesQuery);
  const vehicleOptions: EntityOption[] = (vehiclesQuery.data ?? []).map((vehicle) => ({
    id: vehicle.id,
    label: vehicle.registration,
    sublabel: vehicle.vehicleType,
  }));

  useEffect(() => {
    if (!open) return;
    setAmountMinor(null);
    setReason("");
    setWrittenOffOn(today);
    setSelectedVehicle(null);
  }, [open, today]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<WriteOffResponse>("/api/write-off", {
        partyType: "customer",
        partyCustomerId: customerId,
        amountMinor: toWire(value),
        reason: reason.trim(),
        writtenOffOn,
        ...(selectedVehicle !== null ? { vehicleId: selectedVehicle.id } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["write-off"] });
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId, "obligation"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Write off balance">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (amountMinor !== null && reason.trim() !== "") mutation.mutate(amountMinor);
        }}
      >
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <Field label="Reason" htmlFor="writeOffCustomerReason">
          <Input
            id="writeOffCustomerReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <DateField
          label="Written off on"
          today={today}
          value={writtenOffOn}
          onChange={setWrittenOffOn}
        />
        {vehiclesState.kind === "error" ? (
          <QueryStateFailure
            error={vehiclesState.error}
            retry={vehiclesState.retry}
            of="vehicles"
          />
        ) : (
          <EntityPicker
            label="Vehicle"
            options={vehicleOptions}
            value={selectedVehicle}
            onChange={setSelectedVehicle}
            pending={vehiclesState.kind === "idle" || vehiclesState.kind === "pending"}
          />
        )}

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          type="submit"
          size="cta"
          disabled={amountMinor === null || reason.trim() === "" || mutation.isPending}
        >
          Write off
        </Button>
      </form>
    </Sheet>
  );
}
