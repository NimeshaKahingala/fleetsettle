import { useState } from "react";
import { Screen } from "../../design/primitives/Screen.js";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";

export interface ReportScreenProps {
  title: string;
  /** "1 Jun – 30 Jun 2026" — the parameters actually used, shown as UI §5.3's own small subtitle. */
  subtitle?: string;
  onBack: () => void;
  /** Absent for a report that is a work list rather than a visual (UC-74's own "table, not a chart") — no toggle renders, only `table`. */
  chart?: React.ReactNode;
  table: React.ReactNode;
}

/**
 * UI §5.3: "All share one shell: title, the parameters used…, the primary
 * visual…, and a table-view toggle." One tap between the two (§11.3's
 * accessibility relief for the three low-contrast palette slots) rather
 * than showing both at once, which a 360px screen has no room for.
 */
export function ReportScreen({ title, subtitle, onBack, chart, table }: ReportScreenProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <Screen title={title} onBack={onBack}>
      <div className="flex flex-col gap-3">
        {subtitle !== undefined ? <p className="text-body-sm text-ink-muted">{subtitle}</p> : null}
        {chart !== undefined ? (
          <>
            {showTable ? table : chart}
            <div
              role="group"
              aria-label="View"
              className="flex rounded-sm border border-line-hairline p-0.5"
            >
              {(["Chart", "Table"] as const).map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={(label === "Table") === showTable}
                  onClick={() => setShowTable(label === "Table")}
                  className={cn(
                    "min-h-tap flex-1 rounded-sm px-3 text-body-sm",
                    rowButtonFocus,
                    (label === "Table") === showTable
                      ? "bg-brand-wash font-medium text-brand-ink"
                      : "text-ink-secondary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          table
        )}
      </div>
    </Screen>
  );
}
