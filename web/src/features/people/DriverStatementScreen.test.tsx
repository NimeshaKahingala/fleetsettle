import { asBusinessDate } from "@fleetsettle/shared";
import type {
  DriverBalancesResponse,
  DriverResponse,
  DriverViewResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { DriverDetailScreen } from "./DriverDetailScreen.js";
import { DriverStatementScreen } from "./DriverStatementScreen.js";

const driver: DriverResponse = {
  id: "d1",
  name: "Sunil Perera",
  mobile: null,
  driverDayFeeMinor: null,
  driverTripFeeMinor: null,
  licenceExpiry: null,
};

const balances: DriverBalancesResponse = {
  driverId: "d1",
  owedToUsMinor: "800000",
  owedByUsMinor: "1200000",
};

const populatedView: DriverViewResponse = {
  owedToUsMinor: "800000",
  owedByUsMinor: "1200000",
  days: [
    {
      businessDate: "2026-08-10",
      state: "did_not_run",
      earnedMinor: "0",
      receivedMinor: "0",
      lostReason: "breakdown",
    },
  ],
  trips: [
    {
      id: "t1",
      vehicleId: "v1",
      closingDate: "2026-08-09",
      agreedAmountMinor: "3000000",
      driverFeeMinor: "500000",
    },
  ],
  advances: [{ id: "a1", amountMinor: "100000", issuedOn: "2026-08-03", status: "open" }],
  offsets: [
    {
      id: "o1",
      amountMinor: "50000",
      occurredOn: "2026-08-05",
      voidedAt: null,
      voidedReason: null,
    },
  ],
  deposit: {
    id: "dep1",
    heldMinor: "250000",
    movements: [
      {
        id: "dm1",
        movementType: "taken",
        amountMinor: "250000",
        occurredOn: "2026-08-01",
        reason: null,
        belongsToPeriodStart: null,
        voidedAt: null,
        voidedReason: null,
      },
    ],
  },
  owedToUsObligations: [],
};

const today = asBusinessDate("2026-08-11");

function isDriverHistoryPath(path: string): boolean {
  return path.startsWith("/api/driver/d1/view?");
}

function mockGet() {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") return Promise.resolve(driver);
    if (path === "/api/driver/d1/balances") return Promise.resolve(balances);
    if (isDriverHistoryPath(path)) return Promise.resolve(populatedView);
    throw new Error(`unexpected path ${path}`);
  });
  return get;
}

test("renders the driver's name once, both balances, the covered period, and every activity section", async () => {
  const get = mockGet();
  renderWithProviders(<DriverStatementScreen driverId="d1" today={today} onBack={vi.fn()} />, {
    get,
  });

  // GAP-78: named once, by the print-area's own header — TwoBalances is not
  // given `driverName`, since that would print the name a second time.
  expect(await screen.findAllByText("Sunil Perera")).toHaveLength(1);
  expect(screen.getByText("Driver statement")).toBeInTheDocument();
  // The covered range, in words — an undated slip is not evidence (§14).
  expect(screen.getByText(/12 Jul 2026.*11 Aug 2026/)).toBeInTheDocument();

  expect(screen.getByText("He owes you")).toBeInTheDocument();
  expect(screen.getByText("Rs 8,000")).toBeInTheDocument();
  expect(screen.getByText("You owe him")).toBeInTheDocument();
  expect(screen.getByText("Rs 12,000")).toBeInTheDocument();

  expect(screen.getByText("Recent days · 1")).toBeInTheDocument();
  expect(screen.getByText("Trips and fees · 1")).toBeInTheDocument();
  expect(screen.getByText("Advances · 1")).toBeInTheDocument();
  expect(screen.getByText("Offsets · 1")).toBeInTheDocument();
  expect(screen.getByText("Held deposit")).toBeInTheDocument();
});

test("no write affordance renders — read-only, the same contract MineScreen/F-6.8 already holds", async () => {
  const get = mockGet();
  renderWithProviders(<DriverStatementScreen driverId="d1" today={today} onBack={vi.fn()} />, {
    get,
  });

  await screen.findByText("Recent days · 1");

  expect(screen.queryByText("Offset…")).not.toBeInTheDocument();
  expect(screen.queryByText("Settle")).not.toBeInTheDocument();
  expect(screen.queryByText("Void")).not.toBeInTheDocument();
  expect(screen.queryByText("View settlements")).not.toBeInTheDocument();
});

test("Print fires window.print", async () => {
  const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
  const user = userEvent.setup();
  const get = mockGet();
  renderWithProviders(<DriverStatementScreen driverId="d1" today={today} onBack={vi.fn()} />, {
    get,
  });

  await user.click(await screen.findByText("Print"));
  expect(printSpy).toHaveBeenCalledTimes(1);

  printSpy.mockRestore();
});

test("GAP-101: a failed read shows a scoped failure, never an eternal spinner", async () => {
  const get = vi
    .fn()
    .mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-driver-statement"));
  renderWithProviders(<DriverStatementScreen driverId="d1" today={today} onBack={vi.fn()} />, {
    get,
  });

  expect(
    await screen.findByText("Something went wrong loading this driver's statement."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});

test("GAP-170: 'View statement' fires onViewStatement when supplied", async () => {
  const user = userEvent.setup();
  const onViewStatement = vi.fn();
  const get = mockGet();
  renderWithProviders(
    <DriverDetailScreen driverId="d1" onBack={vi.fn()} onViewStatement={onViewStatement} />,
    { get },
  );

  await user.click(await screen.findByLabelText("Driver actions"));
  await user.click(await screen.findByText("View statement"));

  expect(onViewStatement).toHaveBeenCalledTimes(1);
});

test("'View statement' is absent when onViewStatement is not supplied", async () => {
  const user = userEvent.setup();
  const get = mockGet();
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  await user.click(await screen.findByLabelText("Driver actions"));
  expect(screen.queryByText("View statement")).not.toBeInTheDocument();
});
