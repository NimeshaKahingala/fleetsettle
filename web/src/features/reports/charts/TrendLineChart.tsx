import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface TrendLineDatum {
  /** The x-axis label, already formatted (a short date) — this component never parses or reformats a date. */
  x: string;
  /** `null` renders as a genuine gap in the line, never a dip to zero (§11.4/UC-72: "a month with no complete fill-to-fill pair shows nothing at all"). */
  y: number | null;
}

export interface TrendLineChartProps {
  data: TrendLineDatum[];
  height?: number;
}

/**
 * UI §11.1: "Line over time, single series" — UC-72's kilometres-per-litre
 * trend, the one report this shape fits (a ratio changing over dated
 * points, not a ranked list of named entities). `connectNulls={false}` is
 * the load-bearing prop: Recharts' default already skips a `null` point
 * rather than plotting it at zero, but leaving the connecting behaviour
 * explicit here is what keeps a future edit from flipping it by accident —
 * a bridged gap and a missing reading would look identical on screen,
 * which is exactly the failure §11.4 exists to prevent.
 */
export function TrendLineChart({ data, height = 220 }: TrendLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-hairline)" />
        <XAxis
          dataKey="x"
          tick={{ fill: "var(--color-ink-secondary)", fontSize: 12 }}
          axisLine={{ stroke: "var(--color-line-strong)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "var(--color-ink-secondary)", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Line
          type="monotone"
          dataKey="y"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-chart-1)" }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
