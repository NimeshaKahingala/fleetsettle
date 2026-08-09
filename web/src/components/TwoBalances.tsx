import { isZero, negate, subtract, type Minor } from "@fleetsettle/shared";
import { Button } from "../design/primitives/Button.js";
import { Card } from "../design/primitives/Card.js";
import { Money } from "./Money.js";

export interface TwoBalancesProps {
  /** Omit when the caller's own screen title already names the driver (GAP-78) — a heading a screen already carries in its app bar shouldn't repeat inside the card below it. */
  driverName?: string;
  /** "He owes you" — e.g. short days. */
  owedToYouMinor: Minor;
  owedToYouDetail: string;
  /** "You owe him" — e.g. an unpaid trip fee. */
  owedByYouMinor: Minor;
  owedByYouDetail: string;
  onOffset: () => void;
}

/**
 * §6.2 `TwoBalances` (M-14, F-6.4): the driver's position. **Never a
 * signed net balance** (W-2) — the net line is always a sentence
 * ("you owe him", "he owes you", "settled") plus an unsigned `Money`,
 * muted, never bold, and never the thing a tap acts on. `Offset…` is the
 * only action, and it is explicit: it writes one recorded action with a
 * date and a note, never an implicit netting of the two balances.
 */
export function TwoBalances({
  driverName,
  owedToYouMinor,
  owedToYouDetail,
  owedByYouMinor,
  owedByYouDetail,
  onOffset,
}: TwoBalancesProps) {
  const net = subtract(owedToYouMinor, owedByYouMinor);
  const netSettled = isZero(net);
  const heOwesYouNet = !netSettled && (net as bigint) > 0n;

  return (
    <Card className="flex flex-col gap-4">
      {driverName !== undefined ? (
        <h2 className="text-title text-ink-primary">{driverName}</h2>
      ) : null}

      <div className="border-l-[3px] border-brand pl-3">
        <p className="flex items-baseline justify-between gap-4">
          <span className="text-body text-ink-primary">He owes you</span>
          <Money value={owedToYouMinor} className="text-title" />
        </p>
        <p className="text-body-sm text-ink-muted">{owedToYouDetail}</p>
      </div>

      <div className="border-l-[3px] border-direction-payable pl-3">
        <p className="flex items-baseline justify-between gap-4">
          <span className="text-body text-ink-primary">You owe him</span>
          <Money value={owedByYouMinor} className="text-title" />
        </p>
        <p className="text-body-sm text-ink-muted">{owedByYouDetail}</p>
      </div>

      <div className="flex items-baseline justify-between gap-4 border-t border-line-hairline pt-3">
        <span className="text-body-sm text-ink-muted">
          {netSettled ? "Net: settled" : heOwesYouNet ? "Net: he owes you" : "Net: you owe him"}
        </span>
        {!netSettled ? (
          <Money value={heOwesYouNet ? net : negate(net)} className="text-body-sm text-ink-muted" />
        ) : null}
      </div>

      <Button size="cta" variant="outline" onClick={onOffset}>
        Offset…
      </Button>
    </Card>
  );
}
