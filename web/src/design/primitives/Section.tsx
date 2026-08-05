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
}

/** §6.1 `Section`: heading + count + collapsible body + "Show all" — the home screen's item 4–7 treatment (§3.2). */
export function Section({ title, count, items, maxVisible = 3, className }: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, maxVisible);
  const hiddenCount = items.length - visible.length;

  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h2 className="text-label font-medium text-ink-secondary">
        {title} · {count}
      </h2>
      <div className="flex flex-col gap-2">{visible}</div>
      {hiddenCount > 0 ? (
        <Button variant="ghost" size="default" onClick={() => setExpanded(true)}>
          Show all ({items.length})
        </Button>
      ) : null}
    </section>
  );
}
