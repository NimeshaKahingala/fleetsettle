import { format, parse } from "@fleetsettle/shared";
import type { CashPositionResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card } from "../../design/primitives/Card.js";
import { Money } from "../../components/Money.js";
import { useApi } from "../../lib/ApiContext.js";
import { toAxisValue } from "../../lib/chartAxis.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";

export interface CashPositionReportScreenProps {
  onBack: () => void;
}

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
];

/**
 * One stacked bar, one row: every partner's `heldMinor` plus
 * `depositsHeldMinor` as its own, visually distinct final segment — §6.13's
 * "never netted in" applied to the chart, not only the figures. Recharts
 * stacks multiple `dataKey`s sharing one `stackId` into one bar, so each
 * partner becomes its own series against a single-row dataset.
 */
function CashStackedBar({ data }: { data: CashPositionResponse }) {
  const row: Record<string, number | string> = { name: "Cash" };
  for (const partner of data.partners) {
    row[partner.userId] = toAxisValue(parse(partner.heldMinor));
  }
  row["deposits"] = toAxisValue(parse(data.depositsHeldMinor));

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={[row]} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" hide />
        {data.partners.map((partner, i) => (
          <Bar
            key={partner.userId}
            dataKey={partner.userId}
            stackId="cash"
            fill={CHART_COLORS[i % CHART_COLORS.length]}
          >
            <LabelList
              dataKey={partner.userId}
              position="center"
              fill="var(--color-surface)"
              fontSize={12}
              formatter={() => partner.displayName ?? "Unnamed partner"}
            />
          </Bar>
        ))}
        <Bar dataKey="deposits" stackId="cash" fill="var(--color-ink-faint)">
          <LabelList
            dataKey="deposits"
            position="center"
            fill="var(--color-surface)"
            fontSize={12}
            formatter={() => "Held for customers"}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const COLUMNS: ReportTableColumn<CashPositionResponse["partners"][number]>[] = [
  { key: "name", header: "Partner", render: (row) => row.displayName ?? "Unnamed partner" },
  {
    key: "held",
    header: "Held",
    align: "end",
    render: (row) => <Money value={parse(row.heldMinor)} />,
  },
];

/**
 * UC-75 / `GET /api/reports/cash-position` — **Wave 1, under the narrower
 * title.** GAP-70 is still open: the response has no field for banked cash
 * or driver advances, so "Where is our cash" would be a lie about money the
 * report cannot account for — the exact confident-wrong-number failure
 * W-56 exists to prevent. This screen answers only what the contract can
 * prove: what each partner is personally holding, plus deposits held as a
 * liability, never merged into the partner figures. Reverts to its real
 * title in Wave 2, in the same change that adds the missing fields
 * (B4-REPORTS-DESIGN.md §5.3/§8.1).
 */
export function CashPositionReportScreen({ onBack }: CashPositionReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "cash-position"],
    queryFn: () => api.get<CashPositionResponse>("/api/reports/cash-position"),
  });

  if (query.data === undefined) {
    return (
      <ReportScreen
        title="Cash partners are holding"
        onBack={onBack}
        table={<p className="text-body text-ink-muted">Loading…</p>}
      />
    );
  }

  const deposits = parse(query.data.depositsHeldMinor);

  return (
    <ReportScreen
      title="Cash partners are holding"
      onBack={onBack}
      chart={
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {query.data.partners.map((p) => (
              <Card key={p.userId} className="flex flex-col gap-1">
                <span className="text-caption text-ink-muted">
                  {p.displayName ?? "Unnamed partner"}
                </span>
                <Money value={parse(p.heldMinor)} className="text-body font-medium" />
              </Card>
            ))}
          </div>
          <CashStackedBar data={query.data} />
          <p className="text-caption text-ink-muted">
            Rs {format(deposits)} held for customers — a liability, not partner cash.
          </p>
        </div>
      }
      table={
        <div className="flex flex-col gap-3">
          <ReportTable columns={COLUMNS} rows={query.data.partners} rowKey={(row) => row.userId} />
          <p className="text-body-sm text-ink-secondary">
            Held for customers (deposits): <Money value={deposits} />
          </p>
        </div>
      }
    />
  );
}
