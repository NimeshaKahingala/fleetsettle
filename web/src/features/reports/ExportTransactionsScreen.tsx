import type { BusinessDate } from "@fleetsettle/shared";
import { useMutation } from "@tanstack/react-query";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { ReportDateRangeFields } from "./ReportDateRangeFields.js";

export interface ExportTransactionsScreenProps {
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { from: BusinessDate; to: BusinessDate }) => void;
  onBack: () => void;
}

/** Triggers a normal browser file save from an already-fetched blob — never `<a href>` straight to the API (that would carry no bearer token), and revoked immediately after: the object URL only exists to hand the browser one click's worth of bytes. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * GAP-18/UC-99 (CSV half) / `GET /api/reports/export` — "a year of
 * transactions to CSV, for an accountant, a tax filing, or a bank."
 * `api.getBlob` (already built for A7's receipt downloads) carries the
 * bearer token the way a plain `<a href>` to the API never could; the file
 * itself is a browser-native save, not a second in-app viewer, since a
 * spreadsheet import is exactly what leaving the app is right for. One
 * primary action (M-24's sticky CTA), matching `CloseMonthScreen`'s own
 * shape for a single terminal action.
 */
export function ExportTransactionsScreen({
  from,
  to,
  today,
  onParamsChange,
  onBack,
}: ExportTransactionsScreenProps) {
  const api = useApi();

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { blob } = await api.getBlob(`/api/reports/export?from=${from}&to=${to}`);
      saveBlob(blob, `fleetsettle-transactions-${from}-to-${to}.csv`);
    },
  });

  return (
    <Screen
      title="Export transactions"
      onBack={onBack}
      primaryAction={{
        label: exportMutation.isPending ? "Exporting…" : "Export CSV",
        onClick: () => exportMutation.mutate(),
        disabled: exportMutation.isPending,
      }}
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink-secondary">
          Every rent, daily amount, mileage excess, trip and cost recorded in this window, as a
          spreadsheet — for an accountant, a tax filing, or a bank.
        </p>
        <ReportDateRangeFields from={from} to={to} today={today} onParamsChange={onParamsChange} />
        {exportMutation.isSuccess ? (
          <p className="text-body-sm text-ink-secondary">Saved to your downloads.</p>
        ) : null}
        {exportMutation.isError ? (
          <p className="text-body-sm text-critical-ink">{exportMutation.error.message}</p>
        ) : null}
      </div>
    </Screen>
  );
}
