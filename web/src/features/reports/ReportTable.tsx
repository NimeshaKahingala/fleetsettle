import { cn } from "../../lib/cn.js";

export interface ReportTableColumn<Row> {
  key: string;
  header: string;
  align?: "start" | "end";
  render: (row: Row) => React.ReactNode;
}

export interface ReportTableProps<Row> {
  columns: ReportTableColumn<Row>[];
  rows: Row[];
  /** Stable per-row key — never the array index, since a report row's own id is what a screen reader announces on re-fetch. */
  rowKey: (row: Row) => string;
}

/**
 * B4/§6: the shared table view every chart gets "one tap away" (UI §11.3) —
 * built once, before any chart, so a report defines its columns and reuses
 * them for both forms rather than a bespoke table per screen. This is also
 * §11.2's own accessibility relief for the three chart-palette slots that
 * sit under the 3:1 contrast threshold: a table with plain `--color-ink-*`
 * text carries no such risk. `overflow-x: auto` scrolls the table itself,
 * never the page (§11.3) — a report with more columns than 360px holds
 * scrolls sideways in its own box, the page body does not.
 */
export function ReportTable<Row>({ columns, rows, rowKey }: ReportTableProps<Row>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-body-sm">
        <thead>
          <tr className="border-b border-line-strong">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "px-2 py-2 font-medium text-ink-secondary",
                  col.align === "end" ? "text-right" : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line-hairline last:border-b-0">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-2 py-2 text-ink-primary",
                    col.align === "end" ? "text-right tabular-nums" : "text-left",
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
