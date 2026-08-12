import { format, parse } from "@fleetsettle/shared";
import type { CashPositionResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Card } from "../../design/primitives/Card.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { useApi } from "../../lib/ApiContext.js";
import { toAxisValue } from "../../lib/chartAxis.js";
import { useQueryState } from "../../lib/useQueryState.js";
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
            formatter={() => "Held as deposits"}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const PARTNER_COLUMNS: ReportTableColumn<CashPositionResponse["partners"][number]>[] = [
  { key: "name", header: "Partner", render: (row) => row.displayName ?? "Unnamed partner" },
  {
    key: "held",
    header: "Held",
    align: "end",
    render: (row) => <Money value={parse(row.heldMinor)} />,
  },
];

const BANKED_COLUMNS: ReportTableColumn<CashPositionResponse["banked"][number]>[] = [
  { key: "destination", header: "Account", render: (row) => row.destination },
  {
    key: "held",
    header: "Held",
    align: "end",
    render: (row) => <Money value={parse(row.heldMinor)} />,
  },
];

const DRIVER_ADVANCE_COLUMNS: ReportTableColumn<CashPositionResponse["driverAdvances"][number]>[] =
  [
    { key: "driver", header: "Driver", render: (row) => row.driverName ?? "Unnamed driver" },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "end",
      render: (row) => <Money value={parse(row.outstandingMinor)} />,
    },
  ];

/**
 * UC-75 / `GET /api/reports/cash-position` — **Wave 2, the full contract.**
 * GAP-70 closed: `heldMinor` nets `received − banked − advanced`, and this
 * screen now gives the two subtrahends their own place to be seen, exactly
 * as UI §11.1 asks ("a breakdown by bank account and by driver advance") —
 * the report can now say *where* the missing money went, not only that it
 * is missing (W-56). Both breakdowns are kept arithmetically consistent
 * with `heldMinor`'s own simplification rather than a corrected version of
 * it (DM §15's own stated reason) — a `part_settled` advance counts at its
 * full amount in both places.
 */
export function CashPositionReportScreen({ onBack }: CashPositionReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "cash-position"],
    queryFn: () => api.get<CashPositionResponse>("/api/reports/cash-position"),
  });
  const state = useQueryState(query);

  // GAP-101/F2: `ReportScreen`'s own chrome (title, back button) stays up
  // regardless of the read's outcome — only the body changes, so a failed
  // read never traps the manager behind a screen with no way back.
  if (state.kind === "error") {
    return (
      <ReportScreen
        title="Where is our cash"
        onBack={onBack}
        table={<QueryStateFailure error={state.error} retry={state.retry} of="the cash position" />}
      />
    );
  }
  if (state.kind !== "ready") {
    return (
      <ReportScreen
        title="Where is our cash"
        onBack={onBack}
        table={<p className="text-body text-ink-muted">Loading…</p>}
      />
    );
  }

  const data = state.data;
  const deposits = parse(data.depositsHeldMinor);

  return (
    <ReportScreen
      title="Where is our cash"
      onBack={onBack}
      chart={
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {data.partners.map((p) => (
              <Card key={p.userId} className="flex flex-col gap-1">
                <span className="text-caption text-ink-muted">
                  {p.displayName ?? "Unnamed partner"}
                </span>
                <Money value={parse(p.heldMinor)} className="text-body font-medium" />
              </Card>
            ))}
          </div>
          <CashStackedBar data={data} />
          <p className="text-caption text-ink-muted">
            Rs {format(deposits)} held as deposits — a liability, not partner cash.
          </p>
          <div className="flex flex-col gap-1">
            <p className="text-caption text-ink-muted">In each account</p>
            {data.banked.length > 0 ? (
              <ReportTable
                columns={BANKED_COLUMNS}
                rows={data.banked}
                rowKey={(row) => row.destination}
              />
            ) : (
              <p className="text-body-sm text-ink-secondary">Nothing banked yet.</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-caption text-ink-muted">With drivers, as advances</p>
            {data.driverAdvances.length > 0 ? (
              <ReportTable
                columns={DRIVER_ADVANCE_COLUMNS}
                rows={data.driverAdvances}
                rowKey={(row) => row.driverId}
              />
            ) : (
              <p className="text-body-sm text-ink-secondary">No advances outstanding.</p>
            )}
          </div>
        </div>
      }
      table={
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-caption text-ink-muted">Held per partner</p>
            <ReportTable
              columns={PARTNER_COLUMNS}
              rows={data.partners}
              rowKey={(row) => row.userId}
            />
            <p className="text-body-sm text-ink-secondary">
              Held as deposits: <Money value={deposits} />
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-caption text-ink-muted">In each account</p>
            <ReportTable
              columns={BANKED_COLUMNS}
              rows={data.banked}
              rowKey={(row) => row.destination}
            />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-caption text-ink-muted">With drivers, as advances</p>
            <ReportTable
              columns={DRIVER_ADVANCE_COLUMNS}
              rows={data.driverAdvances}
              rowKey={(row) => row.driverId}
            />
          </div>
        </div>
      }
    />
  );
}
