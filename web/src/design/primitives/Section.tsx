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
  /**
   * Gitar review, PR #143: the collapsed rows are never rendered into the
   * DOM at all (`items.slice(0, maxVisible)`), only summoned by a click
   * that sets React state — nothing a print stylesheet does can reveal an
   * element that was never mounted. A caller building a printed/exported
   * document (the driver statement, GAP-170) sets this so every row
   * mounts unconditionally; the toggle button never renders either, since
   * "Show all" pointing at content already fully shown would be dead UI.
   */
  forceExpanded?: boolean;
}

/** §6.1 `Section`: heading + count + collapsible body + "Show all" — the home screen's item 4–7 treatment (§3.2). */
export function Section({
  title,
  count,
  items,
  maxVisible = 3,
  className,
  total,
  forceExpanded = false,
}: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || forceExpanded ? items : items.slice(0, maxVisible);
  const hiddenCount = forceExpanded ? 0 : items.length - visible.length;

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
