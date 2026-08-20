import type { BusinessDate } from "@fleetsettle/shared";
import type {
  ChangeDailyLeaseDriverRequest,
  DailyLeaseResponse,
  DriverResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { CreateDriverForm } from "../people/CreateDriverForm.js";

export interface ChangeDailyLeaseDriverSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  dailyLeaseId: string;
  currentDriverId: string;
  today: BusinessDate;
}

/** F-4.7/UC-36/GAP-62: close the current daily-lease row and open the replacement with the new driver from an effective date. */
export function ChangeDailyLeaseDriverSheet({
  open,
  onOpenChange,
  vehicleId,
  dailyLeaseId,
  currentDriverId,
  today,
}: ChangeDailyLeaseDriverSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [driver, setDriver] = useState<EntityOption | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState<BusinessDate>(today);
  const [addDriverOpen, setAddDriverOpen] = useState(false);

  const driversQuery = useQuery({
    queryKey: ["drivers"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
    enabled: open,
  });
  const driversState = useQueryState(driversQuery);
  const driverOptions: EntityOption[] = (driversQuery.data ?? [])
    .filter((row) => row.id !== currentDriverId)
    .map((row) => ({
      id: row.id,
      label: row.name,
      ...(row.mobile !== null ? { sublabel: row.mobile } : {}),
    }));

  useEffect(() => {
    if (!open) return;
    setDriver(null);
    setEffectiveFrom(today);
    setAddDriverOpen(false);
  }, [open, today]);

  const mutation = useMutation({
    mutationFn: (body: ChangeDailyLeaseDriverRequest) =>
      api.post<DailyLeaseResponse>(`/api/daily-lease/${dailyLeaseId}/change-driver`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "daily-lease"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-lease"] });
      onOpenChange(false);
    },
  });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Change driver">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (driver !== null) mutation.mutate({ driverId: driver.id, effectiveFrom });
          }}
        >
          {driversState.kind === "error" ? (
            <QueryStateFailure
              error={driversState.error}
              retry={driversState.retry}
              of="the driver list"
            />
          ) : null}
          <EntityPicker
            label="Driver"
            options={driverOptions}
            value={driver}
            onChange={setDriver}
            onAddNew={() => setAddDriverOpen(true)}
            addNewLabel="Add a new driver"
            pending={driversState.kind !== "ready" && driversState.kind !== "error"}
          />
          {driversState.kind === "ready" && driverOptions.length === 0 ? (
            <p className="text-body-sm text-ink-secondary">No other drivers yet.</p>
          ) : null}
          <DateField
            label="Effective from"
            today={today}
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />

          {mutation.isError ? (
            <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
          ) : null}
          <Button type="submit" size="cta" disabled={driver === null || mutation.isPending}>
            Change driver
          </Button>
        </form>
      </Sheet>
      <Sheet open={addDriverOpen} onOpenChange={setAddDriverOpen} title="Add a driver">
        <CreateDriverForm
          onCreated={(created) => {
            setDriver({ id: created.id, label: created.name });
            setAddDriverOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
