import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  startDailyLeaseRequestSchema,
  DailyLeaseResponse,
  DriverResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { AlertStrip } from "../../components/AlertStrip.js";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Label } from "../../design/primitives/Label.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { ApiError } from "../../lib/api.js";
import { cn } from "../../lib/cn.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { CreateDriverForm } from "../people/CreateDriverForm.js";
import { TriangleAlert } from "lucide-react";

/** Post-transform, `startDailyLeaseRequestSchema`'s output carries `Minor`/`BusinessDate`; `z.input` is the wire shape actually sent — the same fix `StartLeaseScreen` and `OffsetSheet` both record. */
type StartDailyLeaseWireRequest = z.input<typeof startDailyLeaseRequestSchema>;

type PatternType = StartDailyLeaseWireRequest["patternType"];

export interface StartDailyLeaseScreenProps {
  vehicleId: string;
  today: BusinessDate;
  onBack: () => void;
  onCreated: (dailyLeaseId: string) => void;
}

/**
 * F-1.7's own three pattern choices. `alternate` is deliberately worded as
 * "Every other day" rather than named after the enum: the reserved
 * vocabulary (§9.6) governs money words, but a pattern the manager has to
 * reason about on a phone should read as the thing it does.
 */
const PATTERN_LABEL: Record<PatternType, string> = {
  every_day: "Every day",
  alternate: "Every other day",
  weekdays: "Chosen days",
};

/** `patternWeekdays` is 0–6 and DM §7 reads it as Sunday-first, matching `Date.getDay()`. */
const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body",
    selected
      ? "border-brand bg-brand-wash text-brand-ink"
      : "border-transparent bg-surface-sunken text-ink-primary",
  );
}

/**
 * F-1.7 / UC-05, "set up the daily lease" — arrangement B, the model the
 * bus in this project's own running example actually runs on.
 *
 * **This screen has no wireframe in UI §7.** F-1.7 was specified in
 * `user-flows.md` and never drawn, which is almost certainly why it was
 * never built: the backend has been complete and labelled for it since
 * P2/P5 (`route-defs/dailyLease.ts` names the flow in its own doc comment)
 * while no client screen ever called it, so arrangement B could not be
 * started by anyone (GAP-51, found live 6 Aug 2026). The shape here is
 * taken from F-1.7's own four steps and the request schema, not invented:
 * *1. Driver. 2. Pattern. 3. Amount owed per operating day. 4. Effective
 * date, optional end date.*
 *
 * **There is no vehicle field, and that is not an omission.** F-1.7 has no
 * vehicle step because the flow is entered from a vehicle, exactly as F-2.1
 * is — `vehicleId` arrives from the route, the way `StartLeaseScreen` takes
 * it.
 *
 * **The amount is not pre-filled from the driver, deliberately.** A driver
 * record carries `driverDayFeeMinor`, which is money *you pay him* on a
 * charter; this field is money *he pays you*. UC §2's UC-04 note records
 * that v1.1 of the specification called both a "per-day rate" and that
 * separating them was a deliberate correction — prefilling one from the
 * other would re-merge them where it costs real money and nothing
 * downstream would flag it. It starts empty.
 */
export function StartDailyLeaseScreen({
  vehicleId,
  today,
  onBack,
  onCreated,
}: StartDailyLeaseScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();

  const vehicleQuery = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });
  const driversQuery = useQuery({
    queryKey: ["driver"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
  });
  const vehicleState = useQueryState(vehicleQuery);
  const driversState = useQueryState(driversQuery);

  const [driver, setDriver] = useState<EntityOption | null>(null);
  const [addDriverOpen, setAddDriverOpen] = useState(false);
  const [patternType, setPatternType] = useState<PatternType>("every_day");
  const [patternWeekdays, setPatternWeekdays] = useState<number[]>([]);
  const [dailyLeaseAmountMinor, setDailyLeaseAmountMinor] = useState<Minor | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState<BusinessDate>(today);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [effectiveTo, setEffectiveTo] = useState<BusinessDate>(today);

  const driverOptions: EntityOption[] = (driversQuery.data ?? []).map((d) => ({
    id: d.id,
    label: d.name,
    ...(d.mobile !== null ? { sublabel: d.mobile } : {}),
  }));

  // U-2: driver, pattern and amount are the whole level-1 set. The effective
  // date defaults to today and the end date is level 2, so a save is possible
  // without touching either. `weekdays` needs at least one day only because
  // the request schema's own `superRefine` requires the pair.
  const canSave =
    driver !== null &&
    dailyLeaseAmountMinor !== null &&
    (patternType !== "weekdays" || patternWeekdays.length > 0);

  const mutation = useMutation({
    mutationFn: () => {
      if (driver === null || dailyLeaseAmountMinor === null) {
        throw new Error("driver and daily lease amount are required");
      }
      return api.post<DailyLeaseResponse>("/api/daily-lease", {
        vehicleId,
        driverId: driver.id,
        patternType,
        ...(patternType === "weekdays" ? { patternWeekdays: [...patternWeekdays].sort() } : {}),
        effectiveFrom,
        ...(hasEndDate ? { effectiveTo } : {}),
        dailyLeaseAmountMinor: toWire(dailyLeaseAmountMinor),
      } satisfies StartDailyLeaseWireRequest);
    },
    onSuccess: (dailyLease) => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ["daily-lease", "active"] });
      onCreated(dailyLease.id);
    },
  });

  // A vehicle already mid-daily-lease over these dates refuses a second one:
  // DM §7's exclusion constraint is the authority and the 409 is an ordinary
  // outcome, not a failure. Caught here rather than pre-checked by fetching
  // the vehicle's existing leases first — two implementations of one rule
  // diverge, and the one that loses is the database.
  const isOverlap =
    mutation.error instanceof ApiError && mutation.error.code === "DAILY_LEASE_OVERLAPS";

  function toggleWeekday(value: number): void {
    setPatternWeekdays((current) =>
      current.includes(value) ? current.filter((d) => d !== value) : [...current, value],
    );
  }

  // GAP-101: a failed vehicle read must not silently skip the arrangement
  // check just below — same reasoning as `StartLeaseScreen`'s identical fix.
  if (vehicleState.kind === "error") {
    return (
      <Screen title="Start a daily lease" onBack={onBack}>
        <QueryStateFailure
          error={vehicleState.error}
          retry={vehicleState.retry}
          of="this vehicle"
        />
      </Screen>
    );
  }

  // GAP-84/F1: a daily lease is arrangement B, or no current arrangement at
  // all — `VehicleOverviewScreen`'s own `canStartDailyLease` reads exactly
  // this pair. The Worker refuses this independently on submit (a deep link
  // bypasses this component entirely); this is the "never the form" half.
  if (
    vehicleQuery.data !== undefined &&
    vehicleQuery.data.arrangement !== "B" &&
    vehicleQuery.data.arrangement !== undefined
  ) {
    return (
      <Screen title={vehicleQuery.data.registration} onBack={onBack}>
        <p className="text-body text-ink-secondary">
          {`This vehicle is set up for arrangement ${vehicleQuery.data.arrangement}, not a daily lease.`}
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      title={vehicleQuery.data?.registration ?? "Start a daily lease"}
      onBack={onBack}
      primaryAction={{
        label: "Start daily lease",
        onClick: () => {
          mutation.mutate();
        },
        disabled: !canSave || mutation.isPending,
      }}
    >
      <div className="flex flex-col gap-4">
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
          onAddNew={() => {
            setAddDriverOpen(true);
          }}
          addNewLabel="Add a new driver"
        />

        <div className="flex flex-col gap-2">
          <Label>Which days</Label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PATTERN_LABEL) as PatternType[]).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={patternType === type}
                onClick={() => {
                  setPatternType(type);
                }}
                className={chipClass(patternType === type)}
              >
                {PATTERN_LABEL[type]}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-muted">
            Days outside the pattern raise nothing and count as neither operated nor lost.
          </p>
        </div>

        {patternType === "weekdays" ? (
          <div className="flex flex-col gap-2">
            <Label>Days of the week</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={patternWeekdays.includes(day.value)}
                  onClick={() => {
                    toggleWeekday(day.value);
                  }}
                  className={chipClass(patternWeekdays.includes(day.value))}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <MoneyField
          label="Daily lease amount"
          valueMinor={dailyLeaseAmountMinor}
          onChange={setDailyLeaseAmountMinor}
        />

        <DateField
          label="Effective from"
          value={effectiveFrom}
          today={today}
          onChange={setEffectiveFrom}
        />

        <Disclosure sectionName="End date">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={!hasEndDate}
                onClick={() => {
                  setHasEndDate(false);
                }}
                className={cn(chipClass(!hasEndDate), "flex-1")}
              >
                No end date
              </button>
              <button
                type="button"
                aria-pressed={hasEndDate}
                onClick={() => {
                  setHasEndDate(true);
                }}
                className={cn(chipClass(hasEndDate), "flex-1")}
              >
                Ends on a date
              </button>
            </div>
            {hasEndDate ? (
              <DateField
                label="Last day"
                value={effectiveTo}
                today={today}
                onChange={setEffectiveTo}
              />
            ) : null}
            <p className="text-caption text-ink-muted">
              An end date stops new days being raised. Days already recorded are untouched.
            </p>
          </div>
        </Disclosure>

        {isOverlap ? (
          <AlertStrip severity="warning" icon={TriangleAlert}>
            This vehicle already has a daily lease covering some of these dates. End that one, or
            start this from a later date.
          </AlertStrip>
        ) : mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}

        <Sheet open={addDriverOpen} onOpenChange={setAddDriverOpen} title="Add a driver">
          <CreateDriverForm
            onCreated={(created) => {
              setDriver({ id: created.id, label: created.name });
              setAddDriverOpen(false);
            }}
          />
        </Sheet>
      </div>
    </Screen>
  );
}
