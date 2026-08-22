import type { Minor } from "@fleetsettle/shared";
import { Money } from "../../components/Money.js";
import { Card } from "../../design/primitives/Card.js";
import { cn } from "../../lib/cn.js";

interface ReportTableColumnBase {
  key: string;
  header: string;
  align?: "start" | "end";
}

export interface ReportTableRenderColumn<Row> extends ReportTableColumnBase {
  render: (row: Row) => React.ReactNode;
  money?: undefined;
}

export interface ReportTableMoneyColumn<Row> extends ReportTableColumnBase {
  /**
   * A money column, given as the value rather than rendered markup, so the
   * table can decide cents for the whole column at once.
   *
   * `format`'s own contract is "the moment one figure has cents every figure
   * shows them (M-16)", but a per-cell `<Money>` can only ever see its own
   * value, so nothing was enforcing it: a right-aligned column mixing
   * `Rs 12,500` and `Rs 3,200.50` lines the two up by their last character
   * instead of by place value, which is precisely the comparison a
   * right-aligned `tabular-nums` column exists to make possible.
   */
  money: (row: Row) => Minor;
  render?: undefined;
}

export type ReportTableColumn<Row> = ReportTableRenderColumn<Row> | ReportTableMoneyColumn<Row>;

export interface ReportTableProps<Row> {
  columns: ReportTableColumn<Row>[];
  rows: Row[];
  /** Stable per-row key — never the array index, since a report row's own id is what a screen reader announces on re-fetch. */
  rowKey: (row: Row) => string;
  /**
   * Tactile Ops Phase 2 (§5C.9): skips the table's own `Card` wrap for the
   * one place that already provides its own — `VehicleRow` (shared by
   * `VehicleMonthReportScreen`/`VehicleYearReportScreen`) renders this
   * inside its own expanded-row `Card`, and nesting one `Card` in another
   * doubles the border, shadow and padding rather than adding elevation.
   * Every other of the 9 call sites wants the default (unset).
   */
  bare?: boolean;
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
 *
 * Tactile Ops Phase 2 (§6): wrapped in `Card` so reports stop being the one
 * flat outlier among rows/stat tiles that already carry `shadow-card` —
 * §3.3 found 11 report screens rendered no `Card` at all. `Card`'s own
 * `p-4` is overridden to `p-0` here rather than doing a negative-margin
 * bleed on the scroller (§5C.9 offered both): each cell already carries its
 * own `px-2 py-2`, so the table sits flush with `Card`'s border with no
 * separate bleed-and-restore math, and `overflow-hidden` on the same `Card`
 * stops a horizontally-scrolled row from painting over the rounded corners.
 */
export function ReportTable<Row>({ columns, rows, rowKey, bare = false }: ReportTableProps<Row>) {
  // M-16, decided per column rather than per cell: one row carrying cents
  // puts them on every row of that column, so the figures stay comparable
  // by place value. A column of round thousands still shows no `.00` at all.
  const columnShowsCents = new Map<string, boolean>();
  for (const col of columns) {
    if (col.money !== undefined) {
      const toMinor = col.money;
      columnShowsCents.set(
        col.key,
        rows.some((row) => toMinor(row) % 100n !== 0n),
      );
    }
  }

  const table = (
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
                  {col.money !== undefined ? (
                    <Money value={col.money(row)} cents={columnShowsCents.get(col.key) ?? false} />
                  ) : (
                    col.render(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (bare) return table;
  return <Card className="overflow-hidden p-0">{table}</Card>;
}
