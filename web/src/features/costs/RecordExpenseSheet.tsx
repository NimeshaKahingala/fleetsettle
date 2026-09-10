import { asBusinessDate, parse, toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  ExpenseListRow,
  ExpenseResponse,
  OdometerSource,
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
import {
  isValidOdometerReadingKm,
  OdometerReadingField,
  parseOdometerReadingKm,
} from "./OdometerReadingField.js";

const US: EntityOption = { id: "us", label: "Us (the business)" };

// GAP-185/F-12.2: 'finance' is generated server-side by a loan payment's
// own split (domain/vehicle-loan.ts) — never a category a person picks here.
const CATEGORY_REASONS = Object.entries(EXPENSE_CATEGORY_LABEL)
  .filter(([key]) => key !== "finance")
  .map(([key, label]) => ({ key, label }));

export interface RecordExpenseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
  /** Pre-fills and locks the vehicle when opened from a vehicle's own "Vehicle actions" menu; omitted from `＋` quick-add, where F-3.2/INV-24's overhead case (no vehicle) is the point. */
  vehicleId?: string;
  /** GAP-172: set when opened from a trip's own detail screen — folds this cost into that trip's P&L (F-5.4) alongside the vehicle's month. Always given together with `vehicleId` by its one caller, so `resolveBorneByDefault` still runs. */
  tripId?: string;
  /** GAP-172: set when opened from an incident's own action menu — folds this cost into UC-12's bottom line. Always given together with `vehicleId` by its one caller, for the same reason as `tripId`. */
  incidentId?: string;
  onRecorded: (expense: ExpenseResponse) => void;
  /**
   * GAP-224/F-8.5: set to correct this row instead of recording a new one.
   * Wire is one request either way (`PATCH /api/expense/{id}`) — void-and-
   * replace happens underneath (domain/expense.ts), so the word "void"
   * never reaches this sheet. Only a *live* row is ever handed here
   * (`ExpenseCostRow` only offers Edit on one) — a voided row's correction
   * already happened; see it through its own replacement instead.
   */
  editing?: ExpenseListRow;
}

/**
 * F-3.1/F-3.2/F-3.5, UC-60/UC-66. Level 1: amount, category, vehicle (optional
 * — blank is a real overhead cost, never an error), date (defaulted to
 * today). Level 2: `BorneByPaidBy`, note, an optional odometer reading
 * (GAP-216 — shown only once a vehicle is set, the schema's own
 * both-or-neither pair with its source, feeding the service-interval
 * prompt on `category: 'servicing'`, F-3.5), photo. Per UI §7.10's own line
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
 *
 * GAP-224/F-8.5: `editing` turns this into the same sheet with the fields
 * pre-filled from the row being corrected, plus a required "Reason for the
 * change" — "Edit" is what the manager sees; void-and-replace happens
 * underneath in one PATCH request (domain/expense.ts), never a second call
 * from here. **A known limit of this pass**: the vehicle a cost is filed
 * against can't be reassigned through this sheet — every caller that opens
 * it for editing already locks `vehicleId` from its own screen context, the
 * same way create does, so F-8.5's own "wrong vehicle" example needs a
 * vehicle-reassignment picker this sheet doesn't yet offer, even though the
 * backend (`replaceExpenseRequestSchema`) already accepts a different one.
 */
export function RecordExpenseSheet({
  open,
  onOpenChange,
  today,
  vehicleId,
  tripId,
  incidentId,
  onRecorded,
  editing,
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
  // F-8.5: required for a money correction (never optional, unlike a plain
  // create) — migration 0025's `replaces_id` unique index is the
  // constraint half; this is the input half.
  const [reason, setReason] = useState("");
  // F-3.5/GAP-216: string, parsed at submit — the odometer idiom every other
  // sheet in this client uses (`ReadOdometerSheet`, `StartLeaseScreen`).
  const [odometerReadingKm, setOdometerReadingKm] = useState("");
  const [odometerSource, setOdometerSource] = useState<OdometerSource | null>(null);
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
    // GAP-224: fetched eagerly in edit mode, not gated on `moreOpen` — the
    // picker's initial selection has to resolve `editing.paidByUserId` to
    // a real name before the manager ever opens the disclosure, or Save
    // would silently keep whatever "You" defaults to (the current actor),
    // not the party the original record actually named.
    enabled: open && (moreOpen || editing !== undefined),
  });
  // GAP-101: a failed vehicle-list read must fail the picker in place, not
  // silently render as "you have no vehicles" (`?? []`) — the rest of the
  // sheet (amount, category, date) stays usable regardless.
  const vehiclesState = useQueryState(vehiclesQuery);
  const membersState = useQueryState(membersQuery);

  useEffect(() => {
    if (open) {
      if (editing !== undefined) {
        setAmountMinor(parse(editing.amountMinor));
        setCategory(editing.category);
        setSpentOn(asBusinessDate(editing.spentOn));
        setNote(editing.note ?? "");
        setBorneByUs(editing.borneBy === "us");
        // Resolved to a real name below, once membersQuery loads — "You"
        // is a placeholder for this one render, not an assumption that the
        // original record was actually paid by whoever opened Edit.
        setPaidBy(
          editing.paidByUserId === null ? { id: "you", label: "You" } : { id: "you", label: "…" },
        );
      } else {
        setAmountMinor(null);
        setCategory(null);
        setSelectedVehicle(null);
        setSpentOn(today);
        setNote("");
        setBorneByUs(false);
        setPaidBy({ id: "you", label: "You" });
      }
      setMoreOpen(false);
      setReason("");
      setOdometerReadingKm("");
      setOdometerSource(null);
      photoUpload.reset();
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  // GAP-224: resolves `editing.paidByUserId` to a real name once the member
  // list arrives — cannot happen in the sync-on-open effect above, which
  // fires before this query has ever had a chance to load.
  useEffect(() => {
    if (open && editing !== undefined && editing.paidByUserId !== null && membersQuery.data) {
      const match = membersQuery.data.find((m) => m.userId === editing.paidByUserId);
      if (match) {
        setPaidBy({
          id: match.userId,
          label: match.displayName ?? "Unnamed member",
          sublabel: BUSINESS_MEMBER_ROLE_LABEL[match.role],
        });
      }
    }
  }, [open, editing, membersQuery.data]);

  const mutation = useMutation({
    mutationFn: () => {
      if (amountMinor === null || category === null) {
        throw new Error("Amount and category are required");
      }
      // Copilot review, PR #180: `canSave` already blocks a malformed
      // reading from reaching here — re-checked rather than trusted, the
      // same defence-in-depth this codebase's other guarded mutations use.
      const parsedReading = parseOdometerReadingKm(odometerReadingKm);
      const fields = {
        ...(effectiveVehicleId !== undefined ? { vehicleId: effectiveVehicleId } : {}),
        ...(tripId !== undefined ? { tripId } : {}),
        ...(incidentId !== undefined ? { incidentId } : {}),
        category,
        amountMinor: toWire(amountMinor),
        spentOn,
        ...(borneByUs ? { borneBy: "us" as const } : {}),
        ...(paidBy.id !== "you" ? { paidByUserId: paidBy.id } : {}),
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
        ...(parsedReading !== undefined && odometerSource !== null
          ? { odometerReadingKm: parsedReading, odometerSource }
          : {}),
      };
      // GAP-224: "Edit" is one request either way — void-and-replace
      // happens inside this one PATCH (domain/expense.ts), never a second
      // call from here. A reason is required for a money correction
      // (F-8.5's own Accept clause), never optional the way a plain
      // create's own note is.
      if (editing !== undefined) {
        if (reason.trim() === "") throw new Error("A reason is required to edit an expense");
        return api.patch<ExpenseResponse>(`/api/expense/${editing.id}`, {
          ...fields,
          reason: reason.trim(),
        });
      }
      return api.post<ExpenseResponse>("/api/expense", fields);
    },
    onSuccess: (expense) => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      if (effectiveVehicleId !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: ["vehicle", effectiveVehicleId, "expense"],
        });
      }
      if (tripId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ["trip", tripId, "expense"] });
      }
      if (incidentId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ["incident", incidentId, "expense"] });
        // Gitar review, PR #128: "Total repairs"/"Net cost to you" live on
        // the incident *detail* query (`bottomLine`), a separate key from
        // its expense list — invalidating only the list left the bottom
        // line stale after recording a cost, exactly the symptom GAP-172
        // was filed to fix. The trip side needs no equivalent: "Costs so
        // far" is computed client-side from the expense list alone.
        void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      }
      // The record saves first and the photos follow it (UI §6.3) — any
      // photo captured before Save was only ever held locally until now.
      // On an edit, `expense.id` is the *replacement*'s id — a photo
      // captured during this edit belongs to the corrected record, not the
      // one just voided underneath it.
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

  // Copilot review, PR #181: `paidBy` sits at its "…" placeholder (never
  // "You", which is the label a real, resolved default or an explicit pick
  // both use) for the whole window before `membersQuery` resolves — saving
  // during it would hit the mutation's own `paidBy.id !== "you"` check,
  // omit `paidByUserId` from the PATCH, and let the server default it to
  // whoever is editing now, silently reassigning who the expense is
  // recorded as paid by (W-48). Blocked until the query resolves it for
  // real or the manager overrides it by hand — either one moves the label
  // off "…" for good.
  const paidByUnresolved = editing !== undefined && paidBy.label === "…";
  // F-3.5/GAP-216: the pair is all-or-nothing at the schema (both-or-neither
  // refine) — a typed km with no source picked would 400, so this blocks
  // save rather than silently dropping what was entered (`CloseLeaseScreen`
  // does the latter for its own odometer field; `StartLeaseScreen` gates
  // instead, and that's the precedent worth following here).
  const odometerSourceMissing = odometerReadingKm.trim() !== "" && odometerSource === null;
  // Copilot review, PR #180: a non-integer or partial reading ("45200.5",
  // "45200km") must block save the same way a missing source does, rather
  // than reach `Number.parseInt` and silently store a truncated figure.
  const odometerReadingInvalid =
    odometerReadingKm.trim() !== "" && !isValidOdometerReadingKm(odometerReadingKm);
  const canSave =
    amountMinor !== null &&
    amountMinor > 0n &&
    category !== null &&
    (editing === undefined || reason.trim() !== "") &&
    !paidByUnresolved &&
    !odometerSourceMissing &&
    !odometerReadingInvalid;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing !== undefined ? "Edit expense" : "Record expense"}
    >
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
            className="min-h-tap w-full rounded-sm border border-transparent bg-surface-sunken px-3 text-left text-body text-ink-primary"
          >
            {category !== null ? (
              (EXPENSE_CATEGORY_LABEL[category] ?? category)
            ) : (
              <span className="text-ink-muted">Choose category</span>
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

        {editing !== undefined ? (
          // F-8.5: required, not level-2 — a money correction always
          // carries a reason (migration 0025's `replaces_id` unique index
          // is the constraint half; this is the input half).
          <NoteField label="Reason for the change" value={reason} onChange={setReason} />
        ) : null}

        <Disclosure
          sectionName="Paid by, borne by, note and odometer"
          onOpenChange={setMoreOpen}
          forceOpen={paidByUnresolved || odometerSourceMissing || odometerReadingInvalid}
        >
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
            {effectiveVehicleId !== undefined ? (
              <OdometerReadingField
                idPrefix="expense"
                readingKm={odometerReadingKm}
                onReadingKmChange={setOdometerReadingKm}
                source={odometerSource}
                onSourceChange={setOdometerSource}
                sourceMissing={odometerSourceMissing}
              />
            ) : null}
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
          {editing !== undefined ? "Save changes" : "Record expense"}
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
