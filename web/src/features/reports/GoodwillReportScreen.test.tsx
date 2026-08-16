import { asBusinessDate } from "@fleetsettle/shared";
import type { GoodwillResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { GoodwillReportScreen } from "./GoodwillReportScreen.js";

const FROM = asBusinessDate("2026-01-01");
const TO = asBusinessDate("2026-07-15");

test("renders the hero total and the by-type breakdown (GAP-73)", async () => {
  const body: GoodwillResponse = {
    totalMinor: "500000",
    byType: [
      { adjustmentType: "goodwill", totalMinor: "300000" },
      { adjustmentType: "auto_waiver", totalMinor: "200000" },
    ],
  };
  const get = vi.fn().mockResolvedValue(body);
  renderWithProviders(
    <GoodwillReportScreen
      from={FROM}
      to={TO}
      today={TO}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Rs 5,000")).toBeInTheDocument();
  expect(screen.getByText("Goodwill")).toBeInTheDocument();
  expect(screen.getByText("Auto-waived")).toBeInTheDocument();
  expect(screen.getByText("Rs 3,000")).toBeInTheDocument();
  expect(screen.getByText("Rs 2,000")).toBeInTheDocument();
});

test("an empty window reads as a real fact, not a loading state that never resolves", async () => {
  const get = vi.fn().mockResolvedValue({ totalMinor: "0", byType: [] } satisfies GoodwillResponse);
  renderWithProviders(
    <GoodwillReportScreen
      from={FROM}
      to={TO}
      today={TO}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Rs 0")).toBeInTheDocument();
  expect(screen.getByText("Nothing waived in this window.")).toBeInTheDocument();
});

test("GAP-101: a failed read shows a failure notice, never a false zero total", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <GoodwillReportScreen
      from={FROM}
      to={TO}
      today={TO}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading goodwill given."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Rs 0")).not.toBeInTheDocument();
});
