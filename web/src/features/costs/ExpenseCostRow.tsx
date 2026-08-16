import { parse } from "@fleetsettle/shared";
import type { ExpenseListRow, ListAttachmentsResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { useApi } from "../../lib/ApiContext.js";
import { useLocalAttachmentUploads } from "../../lib/attachmentUploader.js";
import { cn } from "../../lib/cn.js";
import { EXPENSE_CATEGORY_LABEL } from "../../lib/expenseCategoryLabels.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ReceiptSheet } from "./ReceiptSheet.js";
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
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const voided = expense.voidedAt !== null;
  const api = useApi();

  // A voided expense's receipts stay visible (they are evidence of what was
  // claimed, A7's plan, "Domain and storage") — this query is not gated on
  // `voided`. Shares its cache key with `ReceiptSheet`'s own query, so
  // opening it never re-fetches what this row already has.
  const attachmentsQuery = useQuery({
    queryKey: ["attachments", "expense", expense.id],
    queryFn: () =>
      api.get<ListAttachmentsResponse>(
        `/api/attachment?${new URLSearchParams({ subjectType: "expense", subjectId: expense.id }).toString()}`,
      ),
  });
  // GAP-101: a failed read must not collapse into "0 receipts" — that's a
  // confident wrong answer on a row a manager may be relying on for
  // dispute evidence. Distinguish "definitely none" from "couldn't check".
  const attachmentsState = useQueryState(attachmentsQuery);
  const { uploads: localUploads } = useLocalAttachmentUploads("expense", expense.id);
  const confirmedCount = attachmentsQuery.data?.length ?? 0;
  const pendingCount = localUploads.filter(
    (u) => !(attachmentsQuery.data ?? []).some((a) => a.id === u.id),
  ).length;
  const receiptCount = confirmedCount + pendingCount;

  const content = (
    <div className="flex flex-col gap-1">
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
    </div>
  );

  return (
    <Card accent={voided ? "critical" : undefined} className="flex flex-col gap-2">
      {voided ? (
        content
      ) : (
        <button type="button" onClick={() => setVoidOpen(true)} className="text-left">
          {content}
        </button>
      )}
      {attachmentsState.kind === "error" ? (
        <p className="text-caption text-ink-muted">Receipts couldn't be checked</p>
      ) : receiptCount > 0 ? (
        <button
          type="button"
          onClick={() => setReceiptsOpen(true)}
          className="inline-flex min-h-tap w-fit items-center gap-1 self-start rounded-sm px-2 text-caption text-ink-secondary active:bg-brand-wash"
        >
          <ImageIcon className="size-4" aria-hidden />
          {receiptCount} receipt{receiptCount === 1 ? "" : "s"}
        </button>
      ) : attachmentsState.kind === "pending" || attachmentsState.kind === "idle" ? (
        // GAP-130: `confirmedCount` reads as 0 for the query's whole
        // in-flight window, indistinguishable from a genuinely receipt-free
        // expense without this branch — the same "?? 0 during pending"
        // shape GAP-126/127/128/129 already fixed elsewhere.
        <p className="text-caption text-ink-muted">Checking receipts…</p>
      ) : null}
      {!voided ? (
        <VoidExpenseSheet
          open={voidOpen}
          onOpenChange={setVoidOpen}
          expenseId={expense.id}
          invalidateKeys={invalidateKeys}
        />
      ) : null}
      <ReceiptSheet
        open={receiptsOpen}
        onOpenChange={setReceiptsOpen}
        subjectType="expense"
        subjectId={expense.id}
      />
    </Card>
  );
}
