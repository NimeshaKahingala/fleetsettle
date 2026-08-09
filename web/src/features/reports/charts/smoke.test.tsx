import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { ColumnChart } from "./ColumnChart.js";
import { HorizontalBarChart } from "./HorizontalBarChart.js";
import { TrendLineChart } from "./TrendLineChart.js";

/**
 * jsdom does no layout, so `ResponsiveContainer` (the `ResizeObserver`
 * polyfill in `test/setup.ts` stops it throwing) measures 0×0 and Recharts
 * renders an empty SVG rather than real marks — this is a smoke test that
 * the three chart primitives mount without crashing, not a check of their
 * pixel output, which is a real-browser question (the same category as
 * GAP-50's accessibility-tree note).
 */
test("HorizontalBarChart mounts with data", () => {
  expect(() =>
    render(
      <HorizontalBarChart
        data={[{ id: "v1", label: "CAB-1234", value: 134000, formattedValue: "Rs 1,340" }]}
      />,
    ),
  ).not.toThrow();
});

test("HorizontalBarChart mounts with an empty list", () => {
  expect(() => render(<HorizontalBarChart data={[]} />)).not.toThrow();
});

test("TrendLineChart mounts with a null gap in the series", () => {
  expect(() =>
    render(
      <TrendLineChart
        data={[
          { x: "1 Jun", y: 12.5 },
          { x: "5 Jun", y: null },
          { x: "9 Jun", y: 11.2 },
        ]}
      />,
    ),
  ).not.toThrow();
});

test("ColumnChart mounts with data", () => {
  expect(() =>
    render(<ColumnChart data={[{ id: "jun", label: "Jun", value: 4, formattedValue: "4" }]} />),
  ).not.toThrow();
});
