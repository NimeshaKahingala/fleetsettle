import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { ExpenseResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { MoneyField } from "../../components/MoneyField.js";
import { BorneByPaidBy } from "../../components/BorneByPaidBy.js";
import { ReasonPicker } from "../../components/ReasonPicker.js";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { EXPENSE_CATEGORY_LABEL } from "../../lib/expenseCategoryLabels.js";

const US: EntityOption = { id: "us", label: "Us (the business)" };

const CATEGORY_REASONS = Object.entries(EXPENSE_CATEGORY_LABEL).map(([key, label]) => ({
  key,
  label,
}));

export interface RecordExpenseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
  /** Pre-fills and locks the vehicle when opened from a vehicle's own "Vehicle actions" menu; omitted from `＋` quick-add, where F-3.2/INV-24's overhead case (no vehicle) is the point. */
  vehicleId?: string;
  onRecorded: (expense: ExpenseResponse) => void;
}

/**
 * F-3.1/F-3.2, UC-60/UC-66. Level 1: amount, category, vehicle (optional —
 * blank is a real overhead cost, never an error), date (defaulted to
 * today). Level 2: `BorneByPaidBy`, note, photo. Per UI §7.10's own line
 * ("`BorneByPaidBy` at level 2, both pre-filled") — but this form cannot
 * actually show the server's own §6.7-matrix default without asking the
 * server first, and CLAUDE.md/the Web-P8b trap list are explicit that the
 * matrix must never be recomputed client-side. So `borneBy` is left unsent
 * unless the manager opens Disclosure and picks "Us" — the one override
 * this form offers — and the backend's own `resolveBorneByDefault`
 * silently supplies the real default exactly as it already does for every
 * other caller. "Paid by" has exactly one real option (the caller): there
 * is no endpoint yet to list other business members to attribute a payment
 * to, so `BorneByPaidBy` renders it as a single, honest, non-fabricated
 * choice rather than a picker with nothing real to pick.
 */
export function RecordExpenseSheet({
  open,
  onOpenChange,
  today,
  vehicleId,
  onRecorded,
}: RecordExpenseSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<EntityOption | null>(null);
  const [spentOn, setSpentOn] = useState<BusinessDate>(today);
  const [note, setNote] = useState("");
  const [borneByUs, setBorneByUs] = useState(false);

  const effectiveVehicleId = vehicleId ?? selectedVehicle?.id;

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
    enabled: open && vehicleId === undefined,
  });

  useEffect(() => {
    if (open) {
      setAmountMinor(null);
      setCategory(null);
      setSelectedVehicle(null);
      setSpentOn(today);
      setNote("");
      setBorneByUs(false);
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (amountMinor === null || category === null) {
        throw new Error("Amount and category are required");
      }
      return api.post<ExpenseResponse>("/api/expense", {
        ...(effectiveVehicleId !== undefined ? { vehicleId: effectiveVehicleId } : {}),
        category,
        amountMinor: toWire(amountMinor),
        spentOn,
        ...(borneByUs ? { borneBy: "us" as const } : {}),
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      });
    },
    onSuccess: (expense) => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      if (effectiveVehicleId !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: ["vehicle", effectiveVehicleId, "expense"],
        });
      }
      onRecorded(expense);
    },
  });

  const vehicleOptions: EntityOption[] = (vehiclesQuery.data ?? []).map((v) => ({
    id: v.id,
    label: v.registration,
  }));

  const canSave = amountMinor !== null && amountMinor > 0n && category !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Record expense">
      <div className="flex flex-col gap-4">
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />

        <div className="flex flex-col gap-1">
          <span className="text-label font-medium text-ink-secondary">Category</span>
          <button
            type="button"
            onClick={() => setCategoryPickerOpen(true)}
            aria-label={
              category !== null
                ? `Category: ${EXPENSE_CATEGORY_LABEL[category] ?? category}`
                : "Choose category"
            }
            className="min-h-tap w-full rounded-sm border border-line-strong bg-surface px-3 text-left text-body text-ink-primary"
          >
            {category !== null ? (
              (EXPENSE_CATEGORY_LABEL[category] ?? category)
            ) : (
              <span className="text-ink-faint">Choose category</span>
            )}
          </button>
        </div>

        {vehicleId === undefined ? (
          <div className="flex flex-col gap-1">
            <EntityPicker
              label="Vehicle"
              options={vehicleOptions}
              value={selectedVehicle}
              onChange={setSelectedVehicle}
            />
            <p className="text-caption text-ink-muted">
              Optional — leave blank for a cost with no vehicle (UC-66)
            </p>
          </div>
        ) : null}

        <DateField label="Date" value={spentOn} today={today} onChange={setSpentOn} />

        <Disclosure sectionName="Paid by, borne by and note">
          <div className="flex flex-col gap-4">
            <BorneByPaidBy
              paidBy={{ id: "you", label: "You" }}
              paidByOptions={[{ id: "you", label: "You" }]}
              onPaidByChange={() => {
                /* the only real option today — no endpoint yet lists other business members */
              }}
              paidByDerivation="Defaulted to you — you're recording this expense"
              borneBy={borneByUs ? US : { id: "default", label: "Resolved automatically" }}
              borneByOptions={
                borneByUs ? [US] : [{ id: "default", label: "Resolved automatically" }, US]
              }
              onBorneByChange={(option) => setBorneByUs(option.id === "us")}
              borneByDerivation={
                borneByUs
                  ? "Overridden to the business"
                  : "Defaults to the usual party for this vehicle and category — override to Us if needed"
              }
            />
            <NoteField label="Note" value={note} onChange={setNote} />
            <div className="flex flex-col gap-1">
              <span className="text-label font-medium text-ink-secondary">Photo</span>
              <NotAvailable reason="photo capture isn't available yet" />
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
          Record expense
        </Button>
      </div>

      <ReasonPicker
        open={categoryPickerOpen}
        onOpenChange={setCategoryPickerOpen}
        title="Category"
        reasons={CATEGORY_REASONS}
        onSelect={(reason) => setCategory(reason.key)}
      />
    </Sheet>
  );
}
