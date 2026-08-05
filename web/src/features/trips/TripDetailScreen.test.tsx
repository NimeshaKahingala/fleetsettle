import { asBusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  ExpenseListRow,
  TripResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { TripDetailScreen } from "./TripDetailScreen.js";

const today = asBusinessDate("2026-07-15");

const bookedTrip: TripResponse = {
  id: "t1",
  vehicleId: "v1",
  customerId: "c1",
  driverId: "d1",
  status: "booked",
  startDate: "2026-07-10",
  endDate: "2026-07-12",
  destination: "Kandy",
  agreedAmountMinor: "6000000",
  driverFeeMinor: "900000",
  closingDate: null,
  cancelReason: null,
  advanceDisposition: null,
};

const customer: CustomerResponse = {
  id: "c1",
  customerType: "person",
  name: "Perera Tours",
  nic: null,
  registrationNo: null,
  contactPerson: null,
  mobile: null,
  address: null,
};

const driver: DriverResponse = {
  id: "d1",
  name: "Sunil Perera",
  mobile: null,
  driverDayFeeMinor: null,
  driverTripFeeMinor: null,
  licenceExpiry: null,
};

const expenses: ExpenseListRow[] = [
  {
    id: "e1",
    vehicleId: "v1",
    tripId: "t1",
    incidentId: null,
    category: "fuel",
    amountMinor: "2200000",
    spentOn: "2026-07-11",
    borneBy: "us",
    borneByDriverId: null,
    borneByCustomerId: null,
    paidByUserId: null,
    litres: 35,
    note: null,
    voidedAt: null,
    voidedReason: null,
  },
  {
    id: "e2",
    vehicleId: "v1",
    tripId: "t1",
    incidentId: null,
    category: "tolls",
    amountMinor: "300000",
    spentOn: "2026-07-10",
    borneBy: "us",
    borneByDriverId: null,
    borneByCustomerId: null,
    paidByUserId: null,
    litres: null,
    note: null,
    voidedAt: "2026-07-13T00:00:00.000Z",
    voidedReason: "wrong trip",
  },
];

function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/trip/t1") return Promise.resolve(bookedTrip);
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/driver/d1") return Promise.resolve(driver);
    if (path === "/api/trip/t1/expense") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  return get;
}

test("renders the trip's agreed amount, costs so far (voided excluded), and driver fee", async () => {
  const get = baseGet({ "/api/trip/t1/expense": expenses });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText(/Kandy/)).toBeInTheDocument();
  expect(await screen.findByText(/Perera Tours/)).toBeInTheDocument();
  expect(screen.getByText("Rs 60,000")).toBeInTheDocument();
  // Costs so far excludes the voided toll — fuel (22,000) alone, so the
  // running total and the one contributing item show the same figure.
  expect(screen.getAllByText("Rs 22,000")).toHaveLength(2);
  expect(await screen.findByText(/Sunil Perera/)).toHaveTextContent("Sunil Perera · fee Rs 9,000");

  expect(screen.getByText("Costs · 2")).toBeInTheDocument();
  expect(screen.getByText("Fuel")).toBeInTheDocument();
  const voidedRow = screen.getByText("Tolls");
  expect(voidedRow).toHaveClass("line-through");
  expect(screen.getByText(/Voided: wrong trip/)).toBeInTheDocument();
});

test("Received and Advance to him are honest gaps, never a fabricated zero (W-56)", async () => {
  const get = baseGet();
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText("Received")).toBeInTheDocument();
  expect(
    screen.getByText(/no receivable is raised yet for a trip's agreed amount/),
  ).toBeInTheDocument();
  expect(screen.getByText("Advance to him")).toBeInTheDocument();
  expect(screen.getByText(/no advance list read exists yet/)).toBeInTheDocument();
});

test("a booked trip offers Close trip and Cancel trip; a closed one offers neither", async () => {
  const get = baseGet();
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByRole("button", { name: "Close trip" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel trip" })).toBeInTheDocument();
});

test("a closed trip shows its closing date instead of the close/cancel actions", async () => {
  const closedTrip: TripResponse = {
    ...bookedTrip,
    status: "closed",
    closingDate: "2026-07-12",
  };
  const get = baseGet({ "/api/trip/t1": closedTrip });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText(/Closed 12 Jul 2026/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close trip" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel trip" })).not.toBeInTheDocument();
});

test("a cancelled trip shows its reason and the advance's disposition", async () => {
  const cancelledTrip: TripResponse = {
    ...bookedTrip,
    status: "cancelled",
    cancelReason: "customer changed plans",
    advanceDisposition: "refunded",
  };
  const get = baseGet({ "/api/trip/t1": cancelledTrip });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(
    await screen.findByText(/Cancelled: customer changed plans · advance refunded/),
  ).toBeInTheDocument();
});

test("Close trip opens the close sheet", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("button", { name: "Close trip" }));
  expect(await screen.findByText("Read the closing odometer now")).toBeInTheDocument();
});

test("Cancel trip opens the cancel sheet", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("button", { name: "Cancel trip" }));
  expect(await screen.findByLabelText("Reason (optional)")).toBeInTheDocument();
});
