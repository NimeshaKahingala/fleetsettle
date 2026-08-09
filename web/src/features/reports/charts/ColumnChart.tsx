import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export interface ColumnDatum {
  id: string;
  /** Already formatted (a month name, a weekday) — this component never derives a label. */
  label: string;
  value: number;
  formattedValue: string;
}

export interface ColumnChartProps {
  data: ColumnDatum[];
  height?: number;
  color?: string;
}

/**
 * UI §11.1: "Column per month" — UC-76's lost-day count, and (Wave 2)
 * its weekday-distribution sibling. A time axis, not a ranked list of
 * named entities, which is what keeps this vertical rather than
 * horizontal — §11.3's "horizontal for anything with a name" rule is
 * about long labels not fitting a column, and a month or a weekday
 * abbreviation always does.
 */
export function ColumnChart({
  data,
  height = 200,
  color = "var(--color-chart-1)",
}: ColumnChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-hairline)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--color-ink-secondary)", fontSize: 12 }}
          axisLine={{ stroke: "var(--color-line-strong)" }}
          tickLine={false}
        />
        <YAxis hide />
        <Bar dataKey="value" fill={color} radius={4}>
          <LabelList
            dataKey="formattedValue"
            position="top"
            fill="var(--color-ink-primary)"
            fontSize={12}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
