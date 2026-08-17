import { asBusinessDate } from "@fleetsettle/shared";
import type { UtilisationResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { UtilisationReportScreen } from "./UtilisationReportScreen.js";

const today = asBusinessDate("2026-07-15");
const vehicles: VehicleResponse[] = [
  {
    id: "v1",
    registration: "NB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    serviceIntervalKm: null,
    arrangement: "B",
  },
];

test("no vehicle chosen yet shows the parameter form, not a fetch against nothing", () => {
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(
    <UtilisationReportScreen
      from={asBusinessDate("2026-04-16")}
      to={today}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(screen.getByRole("button", { name: "Choose vehicle" })).toBeInTheDocument();
});

test("renders the day counts and the real per-day revenue figure", async () => {
  const report: UtilisationResponse = {
    vehicleId: "v1",
    from: "2026-07-01",
    to: "2026-07-14",
    earningDays: 10,
    idleDays: 3,
    offRoadDays: 1,
    totalDays: 14,
    revenuePerAvailableDayMinor: "250000",
  };
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle") return Promise.resolve(vehicles);
    return Promise.resolve(report);
  });
  renderWithProviders(
    <UtilisationReportScreen
      vehicleId="v1"
      from={asBusinessDate("2026-07-01")}
      to={asBusinessDate("2026-07-14")}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Rs 2,500")).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("1")).toBeInTheDocument();
});

/** GAP-19/W-56: a window with no available day at all — never a guessed Rs 0. */
test("revenuePerAvailableDayMinor: null renders NotAvailable, never a guessed Rs 0", async () => {
  const report: UtilisationResponse = {
    vehicleId: "v1",
    from: "2026-07-01",
    to: "2026-07-14",
    earningDays: 0,
    idleDays: 0,
    offRoadDays: 14,
    totalDays: 14,
    revenuePerAvailableDayMinor: null,
  };
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle") return Promise.resolve(vehicles);
    return Promise.resolve(report);
  });
  renderWithProviders(
    <UtilisationReportScreen
      vehicleId="v1"
      from={asBusinessDate("2026-07-01")}
      to={asBusinessDate("2026-07-14")}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(
    await screen.findByLabelText("Not available: no available day in this window"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Rs 0")).not.toBeInTheDocument();
});
