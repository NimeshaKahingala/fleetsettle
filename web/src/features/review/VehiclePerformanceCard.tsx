import { parse } from "@fleetsettle/shared";
import type { VehicleMonthRow } from "@fleetsettle/shared/schemas";
import { AlertTriangle } from "lucide-react";
import { Card } from "../../design/primitives/Card.js";
import { Money } from "../../components/Money.js";

export interface VehiclePerformanceCardProps {
  vehicle: VehicleMonthRow;
  /** This signed-in user's own share of `vehicle`'s profit — `undefined` if they hold no share of it. */
  myShareMinor: string | undefined;
  warning?: string;
  onClick: () => void;
}

/**
 * B4-REPORTS-DESIGN.md §5.5: "Both tabs render the same
 * `VehiclePerformanceCard`… with different framing — one component, two
 * callers" (`This month`'s per-vehicle list and `Vehicles`' own list).
 * Read-only by construction — no action menu, no cost entry, nothing that
 * writes; the Review shell's own rule (§7.8: "no entry affordance
 * anywhere") is structural here, not a prop that could be forgotten.
 */
export function VehiclePerformanceCard({
  vehicle,
  myShareMinor,
  warning,
  onClick,
}: VehiclePerformanceCardProps) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body font-medium text-ink-primary">{vehicle.registration}</span>
          <Money value={parse(vehicle.profitMinor)} />
        </div>
        <div className="flex justify-between text-body-sm text-ink-secondary">
          <span>Earned</span>
          <Money value={parse(vehicle.earnedMinor)} />
        </div>
        <div className="flex justify-between text-body-sm text-ink-secondary">
          <span>Spent</span>
          <Money value={parse(vehicle.costsMinor)} />
        </div>
        {myShareMinor !== undefined ? (
          <div className="flex justify-between text-body-sm text-ink-secondary">
            <span>My share</span>
            <Money value={parse(myShareMinor)} />
          </div>
        ) : null}
        {warning !== undefined ? (
          <div className="flex items-center gap-1 text-caption text-warning-ink">
            <AlertTriangle className="size-3.5" aria-hidden />
            <span>{warning}</span>
          </div>
        ) : null}
      </Card>
    </button>
  );
}
