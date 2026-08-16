import { parse, type BusinessDate } from "@fleetsettle/shared";
import type { AgeingResponse, AgeingBucket } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { PartyName } from "./PartyName.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";
import { PARTY_TYPE_LABEL } from "./lib/partyTypeLabel.js";

export interface AgeingReportScreenProps {
  asOfDate: BusinessDate;
  today: BusinessDate;
  onParamsChange: (asOfDate: BusinessDate) => void;
  onBack: () => void;
}

const BUCKET_LABEL: Record<AgeingBucket, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "over-90": "Over 90 days",
};

const BUCKET_VARIANT: Record<
  AgeingBucket,
  "good" | "neutral" | "warning" | "serious" | "critical"
> = {
  current: "good",
  "1-30": "neutral",
  "31-60": "warning",
  "61-90": "serious",
  "over-90": "critical",
};

const COLUMNS: ReportTableColumn<AgeingResponse[number]>[] = [
  {
    key: "party",
    header: "Who",
    render: (row) => <PartyName value={row.partyName} type={row.partyType} />,
  },
  { key: "type", header: "Type", render: (row) => PARTY_TYPE_LABEL[row.partyType] },
  {
    key: "bucket",
    header: "Age",
    render: (row) => <Badge variant={BUCKET_VARIANT[row.bucket]}>{BUCKET_LABEL[row.bucket]}</Badge>,
  },
  {
    key: "outstanding",
    header: "Outstanding",
    align: "end",
    render: (row) => <Money value={parse(row.outstandingMinor)} />,
  },
];

/**
 * UC-78 / `GET /api/reports/ageing` — the UC-74 list bucketed **from the
 * agreed settlement point, not the calendar** (UC-37), so a weekly settler
 * never reads as overdue on a Thursday. A work list, not a magnitude to
 * compare (§5.3's own "table, not a chart"), the same shape
 * `ReceivablesReportScreen` already uses — no `chart` prop.
 */
export function AgeingReportScreen({
  asOfDate,
  today,
  onParamsChange,
  onBack,
}: AgeingReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "ageing", asOfDate],
    queryFn: () => api.get<AgeingResponse>(`/api/reports/ageing?asOfDate=${asOfDate}`),
  });
  const state = useQueryState(query);

  const paramsForm = (
    <DateField label="As of" value={asOfDate} today={today} onChange={onParamsChange} />
  );

  return (
    <ReportScreen
      title="Who is overdue, and by how long"
      onBack={onBack}
      table={
        <div className="flex flex-col gap-3">
          {paramsForm}
          {state.kind === "error" ? (
            <QueryStateFailure error={state.error} retry={state.retry} of="ageing" />
          ) : state.kind !== "ready" ? (
            <p className="text-body text-ink-muted">Loading…</p>
          ) : state.data.length === 0 ? (
            <p className="text-body text-ink-secondary">No one is overdue.</p>
          ) : (
            <ReportTable
              columns={COLUMNS}
              rows={state.data}
              rowKey={(row) => `${row.partyType}-${row.partyId}`}
            />
          )}
        </div>
      }
    />
  );
}
