import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  ExpenseResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { MoneyField } from "../../components/MoneyField.js";
import { BorneByPaidBy } from "../../components/BorneByPaidBy.js";
import { PhotoCapture } from "../../components/PhotoCapture.js";
import { ReasonPicker } from "../../components/ReasonPicker.js";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { BUSINESS_MEMBER_ROLE_LABEL } from "../../lib/businessMemberRoleLabel.js";
import { usePhotoUpload } from "../../lib/attachmentUploader.js";
import { EXPENSE_CATEGORY_LABEL } from "../../lib/expenseCategoryLabels.js";
import { useQueryState } from "../../lib/useQueryState.js";

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
 * other caller. "Paid by" now uses GAP-31's `GET /api/business-member`
 * read: choosing "You" omits `paidByUserId` so the server keeps its
 * original "whoever is entering" default, while choosing another member
 * sends that member's `userId` explicitly.
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
  const [paidBy, setPaidBy] = useState<EntityOption>({ id: "you", label: "You" });
  const [moreOpen, setMoreOpen] = useState(false);
  const photoUpload = usePhotoUpload("expense_receipt", "expense");

  const effectiveVehicleId = vehicleId ?? selectedVehicle?.id;

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
    enabled: open && vehicleId === undefined,
  });
  const membersQuery = useQuery({
    queryKey: ["business-member"],
    queryFn: () => api.get<BusinessMemberResponse[]>("/api/business-member"),
    enabled: open && moreOpen,
  });
  // GAP-101: a failed vehicle-list read must fail the picker in place, not
  // silently render as "you have no vehicles" (`?? []`) — the rest of the
  // sheet (amount, category, date) stays usable regardless.
  const vehiclesState = useQueryState(vehiclesQuery);
  const membersState = useQueryState(membersQuery);

  useEffect(() => {
    if (open) {
      setAmountMinor(null);
      setCategory(null);
      setSelectedVehicle(null);
      setSpentOn(today);
      setNote("");
      setBorneByUs(false);
      setPaidBy({ id: "you", label: "You" });
      setMoreOpen(false);
      photoUpload.reset();
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
        ...(paidBy.id !== "you" ? { paidByUserId: paidBy.id } : {}),
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
      // The record saves first and the photos follow it (UI §6.3) — any
      // photo captured before Save was only ever held locally until now.
      photoUpload.flush(expense.id);
      onRecorded(expense);
    },
  });

  const vehicleOptions: EntityOption[] = (vehiclesQuery.data ?? []).map((v) => ({
    id: v.id,
    label: v.registration,
  }));
  const paidByOptions: EntityOption[] = [
    { id: "you", label: "You" },
    ...(membersQuery.data ?? []).map((member) => ({
      id: member.userId,
      label: member.displayName ?? "Unnamed member",
      sublabel: BUSINESS_MEMBER_ROLE_LABEL[member.role],
    })),
  ];

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
            {vehiclesState.kind === "error" ? (
              <QueryStateFailure
                error={vehiclesState.error}
                retry={vehiclesState.retry}
                of="the vehicle list"
              />
            ) : null}
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

        <Disclosure sectionName="Paid by, borne by and note" onOpenChange={setMoreOpen}>
          <div className="flex flex-col gap-4">
            <BorneByPaidBy
              paidBy={paidBy}
              paidByOptions={paidByOptions}
              onPaidByChange={setPaidBy}
              paidByDerivation={
                paidBy.id === "you"
                  ? "Defaulted to you — you're recording this expense"
                  : "Overridden to another active business member"
              }
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
            {membersState.kind === "error" ? (
              <QueryStateFailure
                error={membersState.error}
                retry={membersState.retry}
                of="the member list"
              />
            ) : null}
            <NoteField label="Note" value={note} onChange={setNote} />
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
