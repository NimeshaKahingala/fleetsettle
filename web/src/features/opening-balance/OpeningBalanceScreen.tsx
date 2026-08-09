import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  commitOpeningBalanceBatchRequestSchema,
  CustomerResponse,
  DriverResponse,
  OpeningBalanceBatchResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import type { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Money } from "../../components/Money.js";
import { DateField } from "../../components/DateField.js";
import { AlertStrip } from "../../components/AlertStrip.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { ApiError } from "../../lib/api.js";
import {
  AddOpeningBalanceEntrySheet,
  type OpeningBalanceEntryKind,
} from "./AddOpeningBalanceEntrySheet.js";
import { TriangleAlert } from "lucide-react";

const KIND_LABEL: Record<OpeningBalanceEntryKind, string> = {
  customer_due: "A customer owes us",
  driver_arrears: "A driver owes us",
  owed_to_driver: "We owe a driver",
  deposit_held: "A driver's deposit we're holding",
  advance_outstanding: "An advance we gave a driver",
  cash_held: "Cash a partner is already holding",
};

/** Display-augmented local draft — the wire request needs only the id fields; `partyLabel`/`vehicleLabel` exist so the list can render a name without a second lookup per row. */
export interface OpeningBalanceEntryDraft {
  kind: OpeningBalanceEntryKind;
  partyCustomerId?: string;
  partyDriverId?: string;
  partyUserId?: string;
  amountMinor: Minor;
  partyLabel: string;
  vehicleId?: string;
  vehicleLabel?: string;
  originalDueDate?: BusinessDate;
}

export interface OpeningBalanceScreenProps {
  today: BusinessDate;
  onBack: () => void;
}

/**
 * F-0.2/UC-09 — "going live mid-stream." Backend has been ready since P2
 * (`opening-balance` route-def: `PUT` save/draft, `GET`, `POST .../commit`);
 * this is the first screen that ever calls it (GAP-61, found by the 8 Aug
 * flow-inventory audit). **Per-vehicle setup (arrangement, odometer, lease
 * terms) is deliberately not part of this screen** — the request schema
 * carries no such fields, because F-1.1/F-2.1/F-1.7 already accept an
 * original start date and are how a vehicle's own arrangement gets entered,
 * mid-stream or not. What this screen is for is the *starting money
 * positions* nothing else can capture: a customer's opening dues, a
 * driver's opening arrears/owed/deposit/advance, and cash each partner is
 * already holding.
 *
 * **A full replace, not incremental CRUD** (`domain/opening-balance.ts`'s
 * own comment) — every "Save as draft" PUTs the whole accumulated list, so
 * F-0.2's "save as a draft and come back" alternate is just calling this
 * again with more entries, never a second code path.
 */
export function OpeningBalanceScreen({ today, onBack }: OpeningBalanceScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();

  const batchQuery = useQuery({
    queryKey: ["opening-balance"],
    queryFn: async () => {
      try {
        return await api.get<OpeningBalanceBatchResponse>("/api/opening-balance");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
  const driversQuery = useQuery({
    queryKey: ["driver"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
  });
  const customersQuery = useQuery({
    queryKey: ["customer"],
    queryFn: () => api.get<CustomerResponse[]>("/api/customer"),
  });
  const membersQuery = useQuery({
    queryKey: ["business-member"],
    queryFn: () => api.get<BusinessMemberResponse[]>("/api/business-member"),
  });
  const vehiclesQuery = useQuery({
    queryKey: ["vehicle"],
    queryFn: () => api.get<VehicleResponse[]>("/api/vehicle"),
  });

  const [goLiveDate, setGoLiveDate] = useState<BusinessDate>(today);
  const [entries, setEntries] = useState<OpeningBalanceEntryDraft[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Seeds local state from the fetched batch exactly once — this screen is
  // the source of truth for the list from that point on (adds/removes are
  // local until the next explicit Save), so a background refetch must never
  // silently overwrite in-progress edits.
  const [seeded, setSeeded] = useState(false);

  const lookupsReady =
    driversQuery.data !== undefined &&
    customersQuery.data !== undefined &&
    membersQuery.data !== undefined &&
    vehiclesQuery.data !== undefined;

  useEffect(() => {
    if (seeded || batchQuery.data === undefined || !lookupsReady) return;
    setSeeded(true);
    if (batchQuery.data === null) return;
    const driverName = new Map((driversQuery.data ?? []).map((d) => [d.id, d.name]));
    const customerName = new Map((customersQuery.data ?? []).map((c) => [c.id, c.name]));
    const memberName = new Map(
      (membersQuery.data ?? []).map((m) => [m.userId, m.displayName ?? "Unnamed partner"]),
    );
    const vehicleName = new Map((vehiclesQuery.data ?? []).map((v) => [v.id, v.registration]));

    setGoLiveDate(batchQuery.data.goLiveDate as BusinessDate);
    setEntries(
      batchQuery.data.entries.map((entry) => {
        // The response is a discriminated union on `kind` — a `switch` over
        // it (rather than probing each party field in turn) is what lets
        // TypeScript narrow which one actually exists per branch.
        let partyField: Partial<
          Pick<OpeningBalanceEntryDraft, "partyCustomerId" | "partyDriverId" | "partyUserId">
        >;
        let partyLabel: string;
        switch (entry.kind) {
          case "customer_due":
            partyField = { partyCustomerId: entry.partyCustomerId };
            partyLabel = customerName.get(entry.partyCustomerId) ?? "Unknown customer";
            break;
          case "cash_held":
            partyField = { partyUserId: entry.partyUserId };
            partyLabel = memberName.get(entry.partyUserId) ?? "Unknown partner";
            break;
          case "driver_arrears":
          case "owed_to_driver":
          case "deposit_held":
          case "advance_outstanding":
            partyField = { partyDriverId: entry.partyDriverId };
            partyLabel = driverName.get(entry.partyDriverId) ?? "Unknown driver";
            break;
        }
        return {
          kind: entry.kind,
          amountMinor: BigInt(entry.amountMinor) as Minor,
          partyLabel,
          ...partyField,
          ...(entry.vehicleId !== null
            ? { vehicleId: entry.vehicleId, vehicleLabel: vehicleName.get(entry.vehicleId) ?? "" }
            : {}),
          ...(entry.originalDueDate !== null
            ? { originalDueDate: entry.originalDueDate as BusinessDate }
            : {}),
        } satisfies OpeningBalanceEntryDraft;
      }),
    );
  }, [
    seeded,
    batchQuery.data,
    lookupsReady,
    driversQuery.data,
    customersQuery.data,
    membersQuery.data,
    vehiclesQuery.data,
  ]);

  type WireEntry = z.input<typeof commitOpeningBalanceBatchRequestSchema>["entries"][number];

  function toWireEntry(entry: OpeningBalanceEntryDraft): WireEntry {
    const common = {
      amountMinor: toWire(entry.amountMinor),
      ...(entry.vehicleId !== undefined ? { vehicleId: entry.vehicleId } : {}),
      ...(entry.originalDueDate !== undefined ? { originalDueDate: entry.originalDueDate } : {}),
    };
    switch (entry.kind) {
      case "customer_due":
        if (entry.partyCustomerId === undefined) {
          throw new Error("customer_due entry missing partyCustomerId");
        }
        return { kind: "customer_due", partyCustomerId: entry.partyCustomerId, ...common };
      case "cash_held":
        if (entry.partyUserId === undefined) {
          throw new Error("cash_held entry missing partyUserId");
        }
        return { kind: "cash_held", partyUserId: entry.partyUserId, ...common };
      case "driver_arrears":
      case "owed_to_driver":
      case "deposit_held":
      case "advance_outstanding":
        if (entry.partyDriverId === undefined) {
          throw new Error(`${entry.kind} entry missing partyDriverId`);
        }
        return { kind: entry.kind, partyDriverId: entry.partyDriverId, ...common };
    }
  }

  function toWireEntries(): WireEntry[] {
    return entries.map(toWireEntry);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put<OpeningBalanceBatchResponse>("/api/opening-balance", {
        goLiveDate,
        entries: toWireEntries(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["opening-balance"] });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      await api.put<OpeningBalanceBatchResponse>("/api/opening-balance", {
        goLiveDate,
        entries: toWireEntries(),
      });
      return api.post<OpeningBalanceBatchResponse>("/api/opening-balance/commit", {});
    },
    onSuccess: () => {
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["opening-balance"] });
    },
  });

  const isLocked = (err: unknown) =>
    err instanceof ApiError && err.code === "OPENING_BALANCE_LOCKED";
  const lockedError =
    (saveMutation.isError && isLocked(saveMutation.error)) ||
    (commitMutation.isError && isLocked(commitMutation.error));

  const status = batchQuery.data?.status ?? null;

  return (
    <Screen
      title="Opening balances"
      onBack={onBack}
      primaryAction={{
        label: "Save as draft",
        onClick: () => saveMutation.mutate(),
        disabled: saveMutation.isPending,
      }}
    >
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          Enter what was already true the day this business went live on FleetSettle — arrears,
          dues, deposits, advances and cash on hand. None of this counts as income or a cost; it is
          only a starting point.
        </p>

        {status === "committed" ? (
          <p className="rounded-sm bg-surface px-4 py-3 text-body-sm text-ink-secondary">
            Confirmed — you can still add or correct figures here until the first month closes.
          </p>
        ) : null}

        <DateField label="Go-live date" value={goLiveDate} today={today} onChange={setGoLiveDate} />

        <div className="flex flex-col gap-2">
          {entries.length > 0 ? (
            entries.map((entry, index) => (
              <Card key={index} className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <p className="text-body text-ink-primary">{KIND_LABEL[entry.kind]}</p>
                  <p className="text-caption text-ink-muted">
                    {entry.partyLabel}
                    {entry.vehicleLabel !== undefined && entry.vehicleLabel !== ""
                      ? ` · ${entry.vehicleLabel}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Money value={entry.amountMinor} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${entry.partyLabel}`}
                    onClick={() => setEntries((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4 text-ink-muted" aria-hidden />
                  </Button>
                </div>
              </Card>
            ))
          ) : (
            <p className="text-body-sm text-ink-muted">Nothing entered yet.</p>
          )}
        </div>

        <Button type="button" variant="outline" onClick={() => setAddOpen(true)}>
          Add a starting figure
        </Button>

        {lockedError ? (
          <AlertStrip severity="warning" icon={TriangleAlert}>
            The first accounting period has already closed — correct this through an ordinary
            adjustment instead of opening balances.
          </AlertStrip>
        ) : saveMutation.isError ? (
          <p className="text-body-sm text-critical-ink">{saveMutation.error.message}</p>
        ) : null}

        <Button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={commitMutation.isPending}
        >
          Confirm and go live
        </Button>

        <AddOpeningBalanceEntrySheet
          open={addOpen}
          onOpenChange={setAddOpen}
          today={today}
          onAdd={(entry) => setEntries((current) => [...current, entry])}
        />

        <Sheet open={confirmOpen} onOpenChange={setConfirmOpen} title="Go live?">
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-body text-ink-secondary">
              This saves the list above and confirms it as the business's starting position. You can
              still add or correct entries afterward, until the first month closes.
            </p>
            <DialogConfirmFooter
              confirmLabel="Confirm and go live"
              onConfirm={() => commitMutation.mutate()}
              onCancel={() => setConfirmOpen(false)}
            />
          </div>
        </Sheet>
      </div>
    </Screen>
  );
}
