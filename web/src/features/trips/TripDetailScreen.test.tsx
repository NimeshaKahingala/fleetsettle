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
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { TripDetailScreen } from "./TripDetailScreen.js";

const today = asBusinessDate("2026-07-15");

const pendingReceivable: TripResponse["receivable"] = {
  id: "ob1",
  kind: "trip_fare",
  dueOn: "2026-07-12",
  amountMinor: "6000000",
  settledMinor: "0",
  waivedMinor: "0",
  status: "pending",
};

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
  receivable: pendingReceivable,
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

async function enterMoney(
  user: ReturnType<typeof userEvent.setup>,
  buttonName: string,
  digits: string,
) {
  await user.click(screen.getByRole("button", { name: buttonName }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("renders the trip's agreed amount, costs so far (voided excluded), and driver fee", async () => {
  const get = baseGet({ "/api/trip/t1/expense": expenses });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText(/Kandy/)).toBeInTheDocument();
  expect(await screen.findByText(/Perera Tours/)).toBeInTheDocument();
  // Agreed and Received/Due both read 60,000 here — nothing has been
  // collected against a pending receivable, so both figures are genuinely
  // the same number (GAP-75: Received shows the amount owed, not settled).
  expect(screen.getAllByText("Rs 60,000")).toHaveLength(2);
  // Costs so far excludes the voided toll — fuel (22,000) alone, so the
  // running total and the one contributing item show the same figure.
  expect(screen.getAllByText("Rs 22,000")).toHaveLength(2);
  expect(await screen.findByText(/Sunil Perera/)).toHaveTextContent("Sunil Perera · fee Rs 9,000");

  expect(screen.getByText("Costs · 2")).toBeInTheDocument();
  expect(screen.getByText("Fuel")).toBeInTheDocument();
  const voidedRow = screen.getByText("Tolls");
  expect(voidedRow).toHaveClass("line-through");
  expect(screen.getByText("Voided")).toBeInTheDocument();
  expect(screen.getByText("wrong trip")).toBeInTheDocument();
});

test("GAP-45: the title omits the year when the range sits inside the business's current year", async () => {
  const get = baseGet();
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByRole("heading", { name: "10 Jul – 12 Jul" })).toBeInTheDocument();
});

test("GAP-45: the title shows the year on both dates when the range sits outside the current year", async () => {
  const lastYearTrip: TripResponse = {
    ...bookedTrip,
    startDate: "2025-07-10",
    endDate: "2025-07-12",
  };
  const get = baseGet({ "/api/trip/t1": lastYearTrip });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(
    await screen.findByRole("heading", { name: "10 Jul 2025 – 12 Jul 2025" }),
  ).toBeInTheDocument();
});

test("GAP-101: a failed trip read shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText("Something went wrong loading this trip.")).toBeInTheDocument();
});

test("GAP-101: a failed costs read shows a failure notice rather than a silently empty costs list", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/trip/t1/expense") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/trip/t1") return Promise.resolve(bookedTrip);
    if (path === "/api/customer/c1") return Promise.resolve(customer);
    if (path === "/api/driver/d1") return Promise.resolve(driver);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(
    await screen.findByText("Something went wrong loading this trip's costs."),
  ).toBeInTheDocument();
});

test("GAP-57/GAP-100 — Received shows the real trip_fare receivable, and a booked trip can record a trip advance", async () => {
  const get = baseGet();
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText("Received")).toBeInTheDocument();
  // GAP-75: the row shows the amount owed (60,000), not what's settled so
  // far (0 for a pending receivable, by definition) — a fully-unpaid trip
  // must read as 60,000 due, not as nothing owed.
  expect(screen.getByRole("button", { name: /Due.*Rs 60,000/ })).toBeInTheDocument();
  expect(screen.getByText("Advance to him")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record advance" })).toBeInTheDocument();
});

test("GAP-100 — recording an advance from Trip detail posts the trip id", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({
    id: "a1",
    driverId: "d1",
    tripId: "t1",
    amountMinor: "40000",
    issuedOn: today,
    status: "open",
    settledMinor: "0",
  });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, {
    get,
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Record advance" }));
  await enterMoney(user, "Enter amount", "40000");
  const buttons = screen.getAllByRole("button", { name: "Record advance" });
  const submitButton = buttons.at(-1);
  if (submitButton === undefined) throw new Error("expected a sheet submit button");
  await user.click(submitButton);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/advance", {
      driverId: "d1",
      tripId: "t1",
      amountMinor: "40000",
      issuedOn: today,
    }),
  );
});

test("GAP-57 — tapping the outstanding Received row opens the collect-payment sheet", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("button", { name: /Due.*Rs 60,000/ }));
  expect(await screen.findByText("Collect payment")).toBeInTheDocument();
});

test("GAP-57 — a fully paid receivable is shown but is no longer tappable", async () => {
  const paidTrip: TripResponse = {
    ...bookedTrip,
    receivable: { ...pendingReceivable, settledMinor: "6000000", status: "paid" },
  };
  const get = baseGet({ "/api/trip/t1": paidTrip });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText("Received")).toBeInTheDocument();
  expect(screen.getByText("Paid")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Paid/ })).not.toBeInTheDocument();
});

test("GAP-57 — a charter with no customer shows no Received row at all, never a fabricated zero (W-56)", async () => {
  const noCustomerTrip: TripResponse = { ...bookedTrip, customerId: null, receivable: null };
  const get = baseGet({ "/api/trip/t1": noCustomerTrip });
  renderWithProviders(<TripDetailScreen tripId="t1" today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText(/Kandy/)).toBeInTheDocument();
  expect(screen.queryByText("Received")).not.toBeInTheDocument();
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
