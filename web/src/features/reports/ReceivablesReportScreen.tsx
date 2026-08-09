import { parse } from "@fleetsettle/shared";
import type { ReceivablesResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Money } from "../../components/Money.js";
import { useApi } from "../../lib/ApiContext.js";
import { PartyName } from "./PartyName.js";
import { ReportScreen } from "./ReportScreen.js";
import { ReportTable, type ReportTableColumn } from "./ReportTable.js";
import { PARTY_TYPE_LABEL } from "./lib/partyTypeLabel.js";

export interface ReceivablesReportScreenProps {
  onBack: () => void;
}

const COLUMNS: ReportTableColumn<ReceivablesResponse[number]>[] = [
  {
    key: "party",
    header: "Who",
    render: (row) => <PartyName value={row.partyName} type={row.partyType} />,
  },
  {
    key: "type",
    header: "Type",
    render: (row) => PARTY_TYPE_LABEL[row.partyType],
  },
  {
    key: "outstanding",
    header: "Outstanding",
    align: "end",
    render: (row) => <Money value={parse(row.outstandingMinor)} />,
  },
  {
    key: "oldestDueOn",
    header: "Oldest due",
    align: "end",
    render: (row) => row.oldestDueOn,
  },
];

/**
 * UC-74 / `GET /api/reports/receivables` — §5.3's own "table, not a chart":
 * this is a work list the reader acts on, not a magnitude to compare, so
 * `ReportScreen`'s chart/table toggle never applies here (no `chart` prop).
 * Already sorted largest-outstanding-first by the domain layer
 * (`getReceivablesReport`) — this screen renders the array as given rather
 * than re-deriving the order.
 */
export function ReceivablesReportScreen({ onBack }: ReceivablesReportScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["reports", "receivables"],
    queryFn: () => api.get<ReceivablesResponse>("/api/reports/receivables"),
  });

  return (
    <ReportScreen
      title="Who owes us"
      onBack={onBack}
      table={
        query.data === undefined ? (
          <p className="text-body text-ink-muted">Loading…</p>
        ) : query.data.length === 0 ? (
          <p className="text-body text-ink-secondary">No one owes us anything.</p>
        ) : (
          <ReportTable columns={COLUMNS} rows={query.data} rowKey={(row) => row.partyId} />
        )
      }
    />
  );
}
