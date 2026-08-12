import { asBusinessDate } from "@fleetsettle/shared";
import type { FuelEfficiencyResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { FuelEfficiencyReportScreen, toChartData } from "./FuelEfficiencyReportScreen.js";

const today = asBusinessDate("2026-07-15");
const vehicles: VehicleResponse[] = [
  { id: "v1", registration: "NB-1234", vehicleType: "Bus", lifecycle: "active", arrangement: "B" },
];

describe("toChartData (fuel efficiency)", () => {
  test("a null kmPerLitre becomes a genuine gap (null), never a zero", () => {
    const points: FuelEfficiencyResponse["points"] = [
      { spentOn: "2026-06-01", amountMinor: "500000", litres: 20, kmPerLitre: null },
      { spentOn: "2026-06-05", amountMinor: "500000", litres: 18, kmPerLitre: 12.5 },
    ];

    expect(toChartData(points)).toEqual([
      { x: "1 Jun", y: null },
      { x: "5 Jun", y: 12.5 },
    ]);
  });
});

test("no vehicle chosen yet shows the parameter form, not a fetch against nothing", () => {
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(
    <FuelEfficiencyReportScreen
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

test("GAP-101: a failed report read shows a failure notice, params form still usable, and back is still reachable", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle") return Promise.resolve(vehicles);
    return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  });
  renderWithProviders(
    <FuelEfficiencyReportScreen
      vehicleId="v1"
      from={asBusinessDate("2026-04-16")}
      to={today}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading this vehicle's fuel efficiency."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vehicle: NB-1234" })).toBeInTheDocument();
  await screen.findByRole("button", { name: "Back" });
});

test("GAP-101: a failed vehicle-list read shows a notice above the picker", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <FuelEfficiencyReportScreen
      from={asBusinessDate("2026-04-16")}
      to={today}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading the vehicle list."),
  ).toBeInTheDocument();
});

test("a window with zero complete fill-to-fill pairs shows NotAvailable for the whole chart", async () => {
  const points: FuelEfficiencyResponse["points"] = [
    { spentOn: "2026-07-01", amountMinor: "500000", litres: 20, kmPerLitre: null },
  ];
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle") return Promise.resolve(vehicles);
    return Promise.resolve({ vehicleId: "v1", points });
  });
  renderWithProviders(
    <FuelEfficiencyReportScreen
      vehicleId="v1"
      from={asBusinessDate("2026-04-16")}
      to={today}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  expect(
    await screen.findByLabelText("Not available: no complete fill-to-fill pair in this window"),
  ).toBeInTheDocument();
});

test("switching to the table view shows NotAvailable per row for a missing reading, not a fabricated ratio", async () => {
  const user = userEvent.setup();
  const points: FuelEfficiencyResponse["points"] = [
    { spentOn: "2026-06-01", amountMinor: "500000", litres: 20, kmPerLitre: null },
    { spentOn: "2026-06-10", amountMinor: "500000", litres: 18, kmPerLitre: 12.5 },
  ];
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle") return Promise.resolve(vehicles);
    return Promise.resolve({ vehicleId: "v1", points });
  });
  renderWithProviders(
    <FuelEfficiencyReportScreen
      vehicleId="v1"
      from={asBusinessDate("2026-04-16")}
      to={today}
      today={today}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { get },
  );

  await user.click(await screen.findByRole("button", { name: "View as table" }));
  expect(screen.getByText("12.50")).toBeInTheDocument();
  expect(screen.getByLabelText("Not available: no paired odometer reading")).toBeInTheDocument();
});
