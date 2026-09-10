import { add, parse, ZERO } from "@fleetsettle/shared";
import type { ExpenseListRow } from "@fleetsettle/shared/schemas";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { Button } from "../../design/primitives/Button.js";
import { Section } from "../../design/primitives/Section.js";
import { ExpenseCostRow } from "./ExpenseCostRow.js";

export interface ExpenseCostSectionProps {
  /** "Costs" (vehicle, trip) or "Repair costs" (incident) — the three callers each had their own heading already. */
  title: string;
  expenses: ExpenseListRow[];
  formatDate: (spentOn: string) => string;
  /** Every query key whose list includes these rows — forwarded to each `ExpenseCostRow`'s void sheet unchanged. */
  invalidateKeys: readonly unknown[][];
}

/**
 * GAP-216/217. `VehicleOverviewScreen`, `TripDetailScreen` and
 * `IncidentScreen` each built this block inline and each got the same thing
 * wrong: `Section`'s `count` was `expenses.length` (every row, voided
 * included) while the money beside it — this screen's own `costsTotal`, or
 * a sibling "Costs so far"/"Total repairs" figure elsewhere on the page —
 * summed only the live ones. Confirmed live: "Costs · 2 — Rs 57,600" naming
 * an amount that belongs to one row, not two (W-56 — a confident wrong
 * number is worse than an admitted gap). `count` and the total computed
 * here now read the same rows, always.
 *
 * Voided rows are hidden by default rather than filtered out — INV-21/W-50
 * still requires a void never leave the list a screen renders, GAP-217 only
 * asks it not be the default view. The toggle names its own count
 * (`"N voided · Show"`) so nothing is silently hidden; expanding it falls
 * back to `expenses`' own order (newest first) rather than appending voided
 * rows after live ones, matching what every caller rendered before this
 * component existed.
 */
export function ExpenseCostSection({
  title,
  expenses,
  formatDate,
  invalidateKeys,
}: ExpenseCostSectionProps) {
  const [showVoided, setShowVoided] = useState(false);

  if (expenses.length === 0) return null;

  const live = expenses.filter((expense) => expense.voidedAt === null);
  const voided = expenses.filter((expense) => expense.voidedAt !== null);
  const total = live.reduce((sum, expense) => add(sum, parse(expense.amountMinor)), ZERO);
  const rows = showVoided ? expenses : live;

  return (
    <div className="flex flex-col gap-2">
      <Section
        title={title}
        count={live.length}
        total={<Money value={total} />}
        items={rows.map((expense) => (
          <ExpenseCostRow
            key={expense.id}
            expense={expense}
            formattedDate={formatDate(expense.spentOn)}
            invalidateKeys={invalidateKeys}
          />
        ))}
      />
      {voided.length > 0 ? (
        <Button variant="ghost" size="default" onClick={() => setShowVoided((v) => !v)}>
          {voided.length} voided · {showVoided ? "Hide" : "Show"}
        </Button>
      ) : null}
    </div>
  );
}
