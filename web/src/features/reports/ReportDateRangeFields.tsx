import type { BusinessDate } from "@fleetsettle/shared";
import { DateField } from "../../components/DateField.js";

export interface ReportDateRangeFieldsProps {
  from: BusinessDate;
  to: BusinessDate;
  today: BusinessDate;
  onParamsChange: (params: { from: BusinessDate; to: BusinessDate }) => void;
}

/** GAP-18: the From/To pair `VehicleYearReportScreen` and `ExportTransactionsScreen` both need, shared rather than copied a second time between two screens landing the same day. */
export function ReportDateRangeFields({
  from,
  to,
  today,
  onParamsChange,
}: ReportDateRangeFieldsProps) {
  return (
    <div className="flex gap-3">
      <DateField
        label="From"
        value={from}
        today={today}
        onChange={(date) => onParamsChange({ from: date, to })}
      />
      <DateField
        label="To"
        value={to}
        today={today}
        onChange={(date) => onParamsChange({ from, to: date })}
      />
    </div>
  );
}
