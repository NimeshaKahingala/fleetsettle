import { parse } from "@fleetsettle/shared";
import type { ExpenseListRow } from "@fleetsettle/shared/schemas";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { cn } from "../../lib/cn.js";
import { EXPENSE_CATEGORY_LABEL } from "../../lib/expenseCategoryLabels.js";
import { VoidExpenseSheet } from "./VoidExpenseSheet.js";

export interface ExpenseCostRowProps {
  expense: ExpenseListRow;
  formattedDate: string;
  invalidateKeys: readonly unknown[][];
}

/**
 * GAP-81/F-8.5: the one cost-row shape `VehicleOverviewScreen`,
 * `TripDetailScreen` and `IncidentScreen` each rendered inline, identically
 * — pulled out so voiding wires into all three at once rather than three
 * times. A voided row stays in place, struck through, its reason appended
 * (INV-21) — the same "row already tappable, action gated on state" shape
 * `LeaseHubScreen`'s dues use, not an `ActionSheet` for one action.
 */
export function ExpenseCostRow({ expense, formattedDate, invalidateKeys }: ExpenseCostRowProps) {
  const [voidOpen, setVoidOpen] = useState(false);
  const voided = expense.voidedAt !== null;

  const row = (
    <Card accent={voided ? "critical" : undefined} className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <p className={cn("text-body", voided ? "text-ink-muted line-through" : "text-ink-primary")}>
          {EXPENSE_CATEGORY_LABEL[expense.category] ?? expense.category}
        </p>
        <Money
          value={parse(expense.amountMinor)}
          className={voided ? "line-through text-ink-muted" : ""}
        />
      </div>
      <p className="text-caption text-ink-muted">
        {formattedDate}
        {expense.litres !== null ? ` · ${expense.litres.toString()}ℓ` : ""}
      </p>
      {voided ? (
        <div className="flex items-center gap-2">
          <Badge variant="critical">Voided</Badge>
          {expense.voidedReason !== null ? (
            <p className="text-caption text-critical-ink">{expense.voidedReason}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );

  return voided ? (
    row
  ) : (
    <>
      <button type="button" onClick={() => setVoidOpen(true)} className="w-full text-left">
        {row}
      </button>
      <VoidExpenseSheet
        open={voidOpen}
        onOpenChange={setVoidOpen}
        expenseId={expense.id}
        invalidateKeys={invalidateKeys}
      />
    </>
  );
}
