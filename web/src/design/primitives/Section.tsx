import { useState } from "react";
import { cn } from "../../lib/cn.js";
import { Button } from "./Button.js";

export interface SectionProps {
  title: string;
  /** e.g. "Earlier days · 5" (§3.2) — the count is part of the heading, not a separate badge. */
  count: number;
  items: React.ReactNode[];
  /** §3.2: items 4–7 collapse to three rows each with "Show all". */
  maxVisible?: number;
  className?: string;
  /**
   * GAP-96: an optional scoped aggregate shown beside the heading — e.g.
   * a vehicle's cost total, so a manager has something to check a void
   * against. Never required; most sections have no single figure to sum.
   */
  total?: React.ReactNode;
}

/** §6.1 `Section`: heading + count + collapsible body + "Show all" — the home screen's item 4–7 treatment (§3.2). */
export function Section({ title, count, items, maxVisible = 3, className, total }: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, maxVisible);
  const hiddenCount = items.length - visible.length;

  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-label font-medium text-ink-secondary">
          {title} · {count}
        </h2>
        {total !== undefined ? (
          <span className="text-label font-medium text-ink-secondary">{total}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">{visible}</div>
      {hiddenCount > 0 ? (
        <Button variant="ghost" size="default" onClick={() => setExpanded(true)}>
          Show all ({items.length})
        </Button>
      ) : null}
    </section>
  );
}
