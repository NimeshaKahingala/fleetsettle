import { asBusinessDate } from "@fleetsettle/shared";
import type { AgeingResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { AgeingReportScreen } from "./AgeingReportScreen.js";

const TODAY = asBusinessDate("2026-07-15");

test("renders every party with its bucket and outstanding amount", async () => {
  const rows: AgeingResponse = [
    {
      partyType: "customer",
      partyId: "c1",
      partyName: "Nimal Perera",
      bucket: "current",
      outstandingMinor: "1500000",
    },
    {
      partyType: "driver",
      partyId: "d1",
      partyName: null,
      bucket: "over-90",
      outstandingMinor: "300000",
    },
  ];
  const get = vi.fn().mockResolvedValue(rows);
  renderWithProviders(
    <AgeingReportScreen
      asOfDate={TODAY}
      today={TODAY}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Nimal Perera")).toBeInTheDocument();
  expect(screen.getByText("Unnamed driver")).toBeInTheDocument();
  expect(screen.getByText("Current")).toBeInTheDocument();
  expect(screen.getByText("Over 90 days")).toBeInTheDocument();
  expect(screen.getByText("Rs 15,000")).toBeInTheDocument();
  expect(screen.getByText("Rs 3,000")).toBeInTheDocument();
});

test("an empty response reads as a real fact, not a loading state that never resolves", async () => {
  const get = vi.fn().mockResolvedValue([] satisfies AgeingResponse);
  renderWithProviders(
    <AgeingReportScreen
      asOfDate={TODAY}
      today={TODAY}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("No one is overdue.")).toBeInTheDocument();
});

test("GAP-101: a failed read shows a failure notice, never a false 'no one is overdue'", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <AgeingReportScreen
      asOfDate={TODAY}
      today={TODAY}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Something went wrong loading ageing.")).toBeInTheDocument();
  expect(screen.queryByText("No one is overdue.")).not.toBeInTheDocument();
});
