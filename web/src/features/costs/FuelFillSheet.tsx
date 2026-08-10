import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { ExpenseResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { MoneyField } from "../../components/MoneyField.js";
import { PhotoCapture } from "../../components/PhotoCapture.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Input } from "../../design/primitives/Input.js";
import { Label } from "../../design/primitives/Label.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { usePhotoUpload } from "../../lib/attachmentUploader.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface FuelFillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
  onRecorded: (expense: ExpenseResponse) => void;
}

/**
 * F-3.3/UC-34/W-20, UI §7.3 — "the ten-second flow": reached from `＋` →
 * Fuel. Level 1 is vehicle (pre-filled, U-3) and amount; litres and
 * borne-by are level 2 and litres must stay optional (W-20 — a daily-lease
 * driver buys his own fuel and has no reason to report it, and a report
 * built on a field nobody fills is an empty report). "Pre-filled with the
 * one that has something pending" degrades to "first in the vehicle list"
 * — the same simplification `HomeScreen`'s own "most-recently-used" already
 * made (Web-P3), since nothing in this schema tracks which vehicle a
 * manager last touched. **Odometer and trip-link are not built this
 * pass**: `expense.odometer_reading_id` has no domain/query wiring
 * anywhere yet (unlike `trip.opening_odometer_id`, wired in P6) and adding
 * it is real, separate backend work, disproportionate to an optional
 * level-2 field — recorded rather than half-built, the same convention
 * every other deliberately-skipped field in this codebase already uses.
 */
export function FuelFillSheet({ open, onOpenChange, today, onRecorded }: FuelFillSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [selectedVehicle, setSelectedVehicle] = useState<EntityOption | null>(null);
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [litresText, setLitresText] = useState("");
  const [borneByUs, setBorneByUs] = useState(false);
  const photoUpload = usePhotoUpload("expense_receipt", "expense");

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
    enabled: open,
  });
  const vehicles = vehiclesQuery.data ?? [];
  // GAP-101: this is level 1 and required to save — a failed read must say
  // so rather than render an empty, unexplained picker on the flow UI §7.3
  // specifies as ten seconds end to end.
  const vehiclesState = useQueryState(vehiclesQuery);

  useEffect(() => {
    if (open) {
      setAmountMinor(null);
      setLitresText("");
      setBorneByUs(false);
      setSelectedVehicle(null);
      photoUpload.reset();
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  useEffect(() => {
    if (open && selectedVehicle === null && vehicles.length > 0) {
      const first = vehicles[0];
      if (first !== undefined) setSelectedVehicle({ id: first.id, label: first.registration });
    }
    // U-3 pre-fill only — never overrides a manager's own choice once made.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pre-fill only, not a controlled sync
  }, [open, vehicles.length]);

  const litres =
    litresText.trim() === ""
      ? undefined
      : // eslint-disable-next-line no-restricted-syntax -- fuel litres, not money (UC-72)
        Number(litresText);
  const litresValid = litres === undefined || (Number.isFinite(litres) && litres > 0);

  const mutation = useMutation({
    mutationFn: () => {
      if (amountMinor === null || selectedVehicle === null) {
        throw new Error("Vehicle and amount are required");
      }
      return api.post<ExpenseResponse>("/api/expense", {
        vehicleId: selectedVehicle.id,
        category: "fuel" as const,
        amountMinor: toWire(amountMinor),
        spentOn: today,
        ...(borneByUs ? { borneBy: "us" as const } : {}),
        ...(litres !== undefined ? { litres } : {}),
      });
    },
    onSuccess: (expense) => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      void queryClient.invalidateQueries({
        queryKey: ["vehicle", selectedVehicle?.id, "expense"],
      });
      // The record saves first and the photos follow it (UI §6.3) — any
      // photo captured before Save was only ever held locally until now.
      photoUpload.flush(expense.id);
      onRecorded(expense);
    },
  });

  const canSave =
    selectedVehicle !== null && amountMinor !== null && amountMinor > 0n && litresValid;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Log a fuel fill">
      <div className="flex flex-col gap-4">
        {vehiclesState.kind === "error" ? (
          <QueryStateFailure
            error={vehiclesState.error}
            retry={vehiclesState.retry}
            of="the vehicle list"
          />
        ) : null}
        <EntityPicker
          label="Vehicle"
          options={vehicles.map((v) => ({ id: v.id, label: v.registration }))}
          value={selectedVehicle}
          onChange={setSelectedVehicle}
        />
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />

        <Disclosure sectionName="Litres, borne by and photo">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="fuel-litres">Litres</Label>
              <Input
                id="fuel-litres"
                type="text"
                inputMode="decimal"
                value={litresText}
                onChange={(e) => setLitresText(e.target.value)}
                aria-invalid={!litresValid}
              />
              {!litresValid ? (
                <p className="text-body-sm text-critical-ink">
                  Enter a positive number, or leave blank
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-label font-medium text-ink-secondary">Borne by</span>
              <p className="text-body text-ink-primary">
                {borneByUs ? "Us (the business)" : "Resolved automatically"}
              </p>
              <button
                type="button"
                onClick={() => setBorneByUs((b) => !b)}
                className="min-h-tap w-fit rounded-sm border border-line-strong px-3 text-body text-brand-ink"
              >
                {borneByUs ? "Use the automatic default instead" : "Override to Us"}
              </button>
              <p className="text-caption text-ink-muted">
                Defaults to the usual party for this vehicle (§6.7) — already correct for a daily
                lease, where the driver buys his own fuel
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-label font-medium text-ink-secondary">Photo</span>
              <PhotoCapture
                onCapture={photoUpload.onCapture}
                uploadStatus={photoUpload.uploadStatus}
                onRetryUpload={photoUpload.onRetryUpload}
              />
            </div>
          </div>
        </Disclosure>

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          disabled={!canSave || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Log fuel fill
        </Button>
      </div>
    </Sheet>
  );
}
