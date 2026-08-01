import { isZero, type Minor } from "@fleetsettle/shared";
import { useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { MoneyField } from "../../components/MoneyField.js";

export interface SomethingElseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expectedMinor: Minor;
  onSave: (earnedMinor: Minor, receivedMinor: Minor) => void;
}

/**
 * F-4.2's "something else": earned and received are two separate facts
 * (CLAUDE.md → Money, INV-2) — a cheap day and an unpaid or short-paid day
 * are different things, entered explicitly rather than inferred from one
 * figure. Save stays disabled until both are set, and received may never
 * exceed earned here — an amount beyond what was earned today is credit
 * (F-4.5), a different flow.
 */
export function SomethingElseSheet({
  open,
  onOpenChange,
  expectedMinor,
  onSave,
}: SomethingElseSheetProps) {
  const [earnedMinor, setEarnedMinor] = useState<Minor | null>(null);
  const [receivedMinor, setReceivedMinor] = useState<Minor | null>(null);

  const receivedExceedsEarned =
    earnedMinor !== null && receivedMinor !== null && receivedMinor > earnedMinor;
  const canSave = earnedMinor !== null && receivedMinor !== null && !receivedExceedsEarned;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setEarnedMinor(null);
          setReceivedMinor(null);
        }
        onOpenChange(next);
      }}
      title="Something else"
    >
      <div className="flex flex-col gap-4">
        <MoneyField
          label="Earned today"
          valueMinor={earnedMinor}
          onChange={setEarnedMinor}
          expectedMinor={expectedMinor}
        />
        <MoneyField
          label="Received today"
          valueMinor={receivedMinor}
          onChange={setReceivedMinor}
          {...(earnedMinor !== null && !isZero(earnedMinor) ? { expectedMinor: earnedMinor } : {})}
        />
        {receivedExceedsEarned ? (
          <p className="text-body-sm text-critical-ink">
            Received can&apos;t be more than earned — an overpayment is credit, not part of today
          </p>
        ) : null}
        <Button
          size="cta"
          disabled={!canSave}
          onClick={() => {
            if (earnedMinor !== null && receivedMinor !== null) onSave(earnedMinor, receivedMinor);
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}
