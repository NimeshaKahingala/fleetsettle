import type { BusinessDate } from "@fleetsettle/shared";
import type {
  ChangeVehicleArrangementRequest,
  VehicleArrangementResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { NativeSelect } from "../../design/primitives/NativeSelect.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { ARRANGEMENT_LABEL } from "../../lib/arrangementLabel.js";

const ARRANGEMENT_CODES = ["A", "B", "C"] as const;

function nextArrangement(currentArrangement: VehicleResponse["arrangement"]) {
  return ARRANGEMENT_CODES.find((code) => code !== currentArrangement) ?? "A";
}

export interface ChangeVehicleArrangementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  currentArrangement: VehicleResponse["arrangement"];
  today: BusinessDate;
}

/** F-1.2/UC-94/GAP-54: close the current vehicle arrangement row and open a new one from an effective business date. */
export function ChangeVehicleArrangementSheet({
  open,
  onOpenChange,
  vehicleId,
  currentArrangement,
  today,
}: ChangeVehicleArrangementSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const initialArrangement = useMemo(
    () => nextArrangement(currentArrangement),
    [currentArrangement],
  );
  const [arrangement, setArrangement] =
    useState<ChangeVehicleArrangementRequest["arrangement"]>(initialArrangement);
  const [effectiveFrom, setEffectiveFrom] = useState<BusinessDate>(today);

  useEffect(() => {
    if (!open) return;
    setArrangement(nextArrangement(currentArrangement));
    setEffectiveFrom(today);
  }, [currentArrangement, open, today]);

  const mutation = useMutation({
    mutationFn: (body: ChangeVehicleArrangementRequest) =>
      api.post<VehicleArrangementResponse>(`/api/vehicle/${vehicleId}/arrangement`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Change arrangement">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({ arrangement, effectiveFrom });
        }}
      >
        <Field label="New arrangement" htmlFor="vehicleArrangement">
          <NativeSelect
            id="vehicleArrangement"
            value={arrangement}
            onChange={(event) => {
              setArrangement(event.target.value as ChangeVehicleArrangementRequest["arrangement"]);
            }}
          >
            {ARRANGEMENT_CODES.map((code) => (
              <option key={code} value={code} disabled={code === currentArrangement}>
                {ARRANGEMENT_LABEL[code] ?? code}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <DateField
          label="Effective from"
          today={today}
          value={effectiveFrom}
          onChange={setEffectiveFrom}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          type="submit"
          size="cta"
          disabled={arrangement === currentArrangement || mutation.isPending}
        >
          Change arrangement
        </Button>
      </form>
    </Sheet>
  );
}
