import { add, isZero, subtract, ZERO, type Minor } from "@fleetsettle/shared";
import { Check } from "lucide-react";
import { Button } from "../design/primitives/Button.js";
import { Card } from "../design/primitives/Card.js";
import { Money } from "./Money.js";

export interface AllocationLine {
  key: string;
  dateLabel: string;
  amountMinor: Minor;
}

export interface AllocationPreviewProps {
  totalMinor: Minor;
  /** e.g. "Sunil" — the header reads "Received {total} from {partyLabel}". */
  partyLabel: string;
  lines: AllocationLine[];
  onChangeAllocation: () => void;
  onConfirm: () => void;
}

/**
 * §6.2 `AllocationPreview`: the oldest-first preview (M-8, UC §6.5).
 * Identical across F-4.5, F-4.6, F-6.2 and a rent payment across two
 * dues — this component only renders a `lines` array the caller has
 * already ordered oldest-first; it does no allocation logic itself.
 * Any amount left over is shown as "held as credit", never as an
 * unexplained overpayment.
 */
export function AllocationPreview({
  totalMinor,
  partyLabel,
  lines,
  onChangeAllocation,
  onConfirm,
}: AllocationPreviewProps) {
  const allocatedMinor = lines.reduce((acc, line) => add(acc, line.amountMinor), ZERO);
  const remainingMinor = subtract(totalMinor, allocatedMinor);

  return (
    <Card className="flex flex-col gap-0 p-0">
      <div className="border-b border-line-hairline p-4">
        <p className="text-body text-ink-primary">
          Received <Money value={totalMinor} /> from {partyLabel}
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-line-hairline">
        {lines.map((line) => (
          <li key={line.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="text-body text-ink-secondary">{line.dateLabel}</span>
            <span className="flex items-center gap-2">
              <Money value={line.amountMinor} />
              <span className="flex items-center gap-1 text-body-sm text-good-ink">
                <Check className="size-4" aria-hidden />
                settled
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 border-t border-line-hairline p-4">
        <p className="text-body-sm text-ink-muted">
          Allocated <Money value={allocatedMinor} />
          {" · "}
          {isZero(remainingMinor) ? (
            "nothing left"
          ) : (
            <>
              held as credit: <Money value={remainingMinor} />
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onChangeAllocation}>
            Change allocation
          </Button>
          <Button className="flex-1" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </Card>
  );
}
