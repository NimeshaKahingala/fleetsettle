import type { Minor } from "@fleetsettle/shared";
import { Card } from "../design/primitives/Card.js";
import { Button } from "../design/primitives/Button.js";
import { Money } from "./Money.js";

export interface DayCardProps {
  /** e.g. "Bus" — the vehicle's short label, never its full registration here (there's no room, and the driver already knows which bus). */
  vehicleLabel: string;
  /** Pre-formatted upstream ("Tue 30 Jul") — DayCard does no date math itself. */
  dateLabel: string;
  /** e.g. "Expected from Sunil" */
  expectedFromLabel: string;
  amountMinor: Minor;
  onPaidInFull: () => void;
  onSomethingElse: () => void;
  onDidntRun: () => void;
  /** §3.2: when more than one vehicle has a card today, only the most-recently-used one is elevated — the rest are "ordinary cards" (§5.3: "shadow is reserved for things that genuinely float"). Defaults to `true` — the single-card case, still the common one. */
  elevated?: boolean;
}

/**
 * §6.2 `DayCard`: the 30-second obligation (F-4.2). One card, three
 * buttons, no navigation — this component only renders and calls back;
 * whether a tap creates the day record first (F-4.2's "if the card does
 * not exist, tapping creates it") is the caller's transaction to run, not
 * a concern this presentational component has.
 */
export function DayCard({
  vehicleLabel,
  dateLabel,
  expectedFromLabel,
  amountMinor,
  onPaidInFull,
  onSomethingElse,
  onDidntRun,
  elevated = true,
}: DayCardProps) {
  return (
    <Card elevated={elevated} className="flex flex-col gap-4">
      <div>
        <p className="text-body-sm text-ink-muted">
          {vehicleLabel} · {dateLabel}
        </p>
        <p className="text-body text-ink-secondary">{expectedFromLabel}</p>
      </div>

      <Money value={amountMinor} className="text-hero font-display" />

      <div className="flex flex-col gap-2">
        <Button size="cta" onClick={onPaidInFull}>
          Paid in full
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onSomethingElse}>
            Something else
          </Button>
          <Button variant="outline" className="flex-1" onClick={onDidntRun}>
            Didn&apos;t run
          </Button>
        </div>
      </div>
    </Card>
  );
}
