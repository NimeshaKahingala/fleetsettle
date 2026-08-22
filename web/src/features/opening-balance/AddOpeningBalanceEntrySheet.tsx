import type { BusinessDate, Minor } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  CustomerResponse,
  DriverResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Label } from "../../design/primitives/Label.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { useQueryState } from "../../lib/useQueryState.js";
import type { OpeningBalanceEntryDraft } from "./OpeningBalanceScreen.js";

export type OpeningBalanceEntryKind =
  | "customer_due"
  | "driver_arrears"
  | "owed_to_driver"
  | "deposit_held"
  | "advance_outstanding"
  | "cash_held";

/**
 * F-0.2's own three party groups (customer, driver, cash held by a
 * partner), named honestly rather than with the accounting words the
 * schema's own `kind` enum uses internally (U-6: no "receivable"/"payable"
 * reaches the interface) — each label states which direction the money
 * moves, the same discipline §9.6's vocabulary lock applies everywhere else.
 */
const KIND_LABEL: Record<OpeningBalanceEntryKind, string> = {
  customer_due: "A customer owes us",
  driver_arrears: "A driver owes us",
  owed_to_driver: "We owe a driver",
  deposit_held: "A driver's deposit we're holding",
  advance_outstanding: "An advance we gave a driver",
  cash_held: "Cash a partner is already holding",
};

const KIND_ORDER: OpeningBalanceEntryKind[] = [
  "customer_due",
  "driver_arrears",
  "owed_to_driver",
  "deposit_held",
  "advance_outstanding",
  "cash_held",
];

function partyKindFor(kind: OpeningBalanceEntryKind): "customer" | "driver" | "partner" {
  if (kind === "customer_due") return "customer";
  if (kind === "cash_held") return "partner";
  return "driver";
}

// GAP-129/GAP-125: these queries are `enabled: open`, so `idle` only ever
// means "sheet still closed" — once open, both `idle` and `pending` are the
// same fetch-in-flight window the picker below must not render as empty.
function inFlight(s: { kind: string }): boolean {
  return s.kind === "pending" || s.kind === "idle";
}

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body text-left",
    selected
      ? "border-brand bg-brand-wash text-brand-ink"
      : "border-transparent bg-surface-sunken text-ink-primary",
  );
}

export interface AddOpeningBalanceEntrySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: BusinessDate;
  onAdd: (entry: OpeningBalanceEntryDraft) => void;
}

/**
 * F-0.2 steps 3–5, one entry at a time: "Per driver: opening arrears,
 * opening amount owed to him, deposit held, advances outstanding. Per
 * customer: opening unpaid dues with their original due dates… Opening
 * cash held by each partner." `OpeningBalanceScreen` accumulates what this
 * sheet adds into one local list, PUT as a whole batch (the backend's own
 * "full replace, not incremental CRUD" shape — see `domain/opening-balance.ts`).
 */
export function AddOpeningBalanceEntrySheet({
  open,
  onOpenChange,
  today,
  onAdd,
}: AddOpeningBalanceEntrySheetProps) {
  const api = useApi();
  const [kind, setKind] = useState<OpeningBalanceEntryKind | null>(null);
  const [party, setParty] = useState<EntityOption | null>(null);
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [vehicle, setVehicle] = useState<EntityOption | null>(null);
  const [hasDueDate, setHasDueDate] = useState(false);
  const [originalDueDate, setOriginalDueDate] = useState<BusinessDate>(today);

  const driversQuery = useQuery({
    queryKey: ["driver"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
    enabled: open,
  });
  const customersQuery = useQuery({
    queryKey: ["customer"],
    queryFn: () => api.get<CustomerResponse[]>("/api/customer"),
    enabled: open,
  });
  const membersQuery = useQuery({
    queryKey: ["business-member"],
    queryFn: () => api.get<BusinessMemberResponse[]>("/api/business-member"),
    enabled: open,
  });
  const vehiclesQuery = useQuery({
    queryKey: ["vehicle"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
    enabled: open,
  });
  // GAP-101: each party list fails its own picker in place — the rest of
  // the sheet (kind, amount, due date) stays usable regardless of which
  // one failed.
  const driversState = useQueryState(driversQuery);
  const customersState = useQueryState(customersQuery);
  const membersState = useQueryState(membersQuery);
  const vehiclesState = useQueryState(vehiclesQuery);

  function reset(): void {
    setKind(null);
    setParty(null);
    setAmountMinor(null);
    setVehicle(null);
    setHasDueDate(false);
    setOriginalDueDate(today);
  }

  const partyOptions: EntityOption[] =
    kind === null
      ? []
      : partyKindFor(kind) === "customer"
        ? (customersQuery.data ?? []).map((c) => ({ id: c.id, label: c.name }))
        : partyKindFor(kind) === "partner"
          ? (membersQuery.data ?? []).map((m) => ({
              id: m.userId,
              label: m.displayName ?? "Unnamed partner",
            }))
          : (driversQuery.data ?? []).map((d) => ({
              id: d.id,
              label: d.name,
              ...(d.mobile !== null ? { sublabel: d.mobile } : {}),
            }));

  const vehicleOptions: EntityOption[] = (vehiclesQuery.data ?? []).map((v) => ({
    id: v.id,
    label: v.registration,
  }));

  const partyState =
    kind === null
      ? null
      : partyKindFor(kind) === "customer"
        ? customersState
        : partyKindFor(kind) === "partner"
          ? membersState
          : driversState;

  const canAdd = kind !== null && party !== null && amountMinor !== null && amountMinor > 0n;

  function handleAdd(): void {
    if (kind === null || party === null || amountMinor === null) return;
    const partyField: Pick<
      OpeningBalanceEntryDraft,
      "partyCustomerId" | "partyDriverId" | "partyUserId"
    > =
      partyKindFor(kind) === "customer"
        ? { partyCustomerId: party.id }
        : partyKindFor(kind) === "partner"
          ? { partyUserId: party.id }
          : { partyDriverId: party.id };
    const entry: OpeningBalanceEntryDraft = {
      kind,
      ...partyField,
      amountMinor,
      partyLabel: party.label,
      ...(vehicle !== null ? { vehicleId: vehicle.id, vehicleLabel: vehicle.label } : {}),
      ...(kind === "customer_due" && hasDueDate ? { originalDueDate } : {}),
    };
    onAdd(entry);
    reset();
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Add a starting figure"
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col gap-2">
          <Label>What is it</Label>
          <div className="flex flex-col gap-2">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setParty(null);
                }}
                className={chipClass(kind === k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        {kind !== null ? (
          <>
            {partyState?.kind === "error" ? (
              <QueryStateFailure
                error={partyState.error}
                retry={partyState.retry}
                of={
                  partyKindFor(kind) === "customer"
                    ? "the customer list"
                    : partyKindFor(kind) === "partner"
                      ? "the partner list"
                      : "the driver list"
                }
              />
            ) : null}
            <EntityPicker
              label={
                partyKindFor(kind) === "customer"
                  ? "Customer"
                  : partyKindFor(kind) === "partner"
                    ? "Partner"
                    : "Driver"
              }
              options={partyOptions}
              value={party}
              onChange={setParty}
              pending={partyState !== null && inFlight(partyState)}
            />
          </>
        ) : null}

        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />

        {kind === "customer_due" ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={!hasDueDate}
                onClick={() => setHasDueDate(false)}
                className={cn(chipClass(!hasDueDate), "flex-1 text-center")}
              >
                No original due date
              </button>
              <button
                type="button"
                aria-pressed={hasDueDate}
                onClick={() => setHasDueDate(true)}
                className={cn(chipClass(hasDueDate), "flex-1 text-center")}
              >
                Had a due date
              </button>
            </div>
            {hasDueDate ? (
              <DateField
                label="Original due date"
                value={originalDueDate}
                today={today}
                onChange={setOriginalDueDate}
              />
            ) : (
              <p className="text-caption text-ink-muted">
                Without one, this due dates from the go-live date instead — the ageing report is
                truthful only when the real date is known.
              </p>
            )}
          </div>
        ) : null}

        <Disclosure sectionName="Link to a vehicle">
          {vehiclesState.kind === "error" ? (
            <QueryStateFailure
              error={vehiclesState.error}
              retry={vehiclesState.retry}
              of="the vehicle list"
            />
          ) : (
            <EntityPicker
              label="Vehicle"
              options={vehicleOptions}
              value={vehicle}
              onChange={setVehicle}
              pending={inFlight(vehiclesState)}
            />
          )}
        </Disclosure>

        <Button type="button" onClick={handleAdd} disabled={!canAdd}>
          Add to the list
        </Button>
      </div>
    </Sheet>
  );
}
