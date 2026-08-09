import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface HorizontalBarDatum {
  id: string;
  /** Already resolved to display text (a registration, a driver's name via `<PartyName>`) — this component never derives a label. */
  label: string;
  /** Axis value, via `chartAxis.ts`'s `toAxisValue` — never a raw `Number(minor)` at the call site. */
  value: number;
  /** Pre-formatted for the direct label — e.g. `Money`'s own "Rs 12,000" — so this chart never reformats a figure a different rule already owns. */
  formattedValue: string;
  /** UI §11.2 chart-palette token, e.g. `"var(--color-chart-1)"`. Defaults to slot 1 when every bar shares one series. */
  color?: string;
}

export interface HorizontalBarChartProps {
  data: HorizontalBarDatum[];
  /** Row height in px — Recharts needs an explicit chart height; `ResponsiveContainer` only measures width. */
  barSize?: number;
}

/**
 * UI §11.1/§11.3: "Horizontal bars for anything with a name" — a vehicle
 * registration or a driver's name does not fit under a vertical column at
 * 360px. Direct-labelled per §11.3 (≤4 series get a legend *and* direct
 * labels; this component only ever renders one series per bar, so it is
 * always in the direct-label case). Used by UC-70 (per-vehicle profit) and
 * UC-71 (trips ranked by profit) — both single-series, ranked, named lists.
 */
export function HorizontalBarChart({ data, barSize = 32 }: HorizontalBarChartProps) {
  const height = Math.max(data.length * (barSize + 16), 80);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={110}
          tick={{ fill: "var(--color-ink-secondary)", fontSize: 13 }}
          axisLine={false}
          tickLine={false}
        />
        <Bar dataKey="value" barSize={barSize} radius={4}>
          {data.map((entry) => (
            <Cell key={entry.id} fill={entry.color ?? "var(--color-chart-1)"} />
          ))}
          <LabelList
            dataKey="formattedValue"
            position="right"
            fill="var(--color-ink-primary)"
            fontSize={13}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
