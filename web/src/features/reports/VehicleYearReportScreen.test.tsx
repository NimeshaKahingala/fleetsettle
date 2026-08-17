import { asBusinessDate } from "@fleetsettle/shared";
import type { VehicleYearResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VehicleYearReportScreen } from "./VehicleYearReportScreen.js";

const FROM = asBusinessDate("2026-01-01");
const TO = asBusinessDate("2026-12-31");

test("GAP-18/UC-73: renders per-vehicle profit, the KPI row and overheads beneath it — never spread across vehicles", async () => {
  const body: VehicleYearResponse = {
    from: "2026-01-01",
    to: "2026-12-31",
    overheadsMinor: "400000",
    vehicles: [
      {
        vehicleId: "v1",
        registration: "NB-1234",
        earnedMinor: "5000000",
        costsMinor: "900000",
        profitMinor: "4100000",
        ownerShares: [],
      },
    ],
  };
  const get = vi.fn().mockResolvedValue(body);
  renderWithProviders(
    <VehicleYearReportScreen
      from={FROM}
      to={TO}
      today={TO}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Rs 4,000")).toBeInTheDocument();
  expect(screen.getByText("Overheads")).toBeInTheDocument();
  expect(screen.getByText("Rs 41,000")).toBeInTheDocument();

  await userEvent.click(await screen.findByRole("button", { name: "View as table" }));
  expect(screen.getByRole("button", { name: /NB-1234/ })).toBeInTheDocument();
});

test("GAP-101: a failed read shows a failure notice, never a false report", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <VehicleYearReportScreen
      from={FROM}
      to={TO}
      today={TO}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading how the year went."),
  ).toBeInTheDocument();
});
