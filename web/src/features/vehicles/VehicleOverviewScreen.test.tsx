import type {
  ExpenseListRow,
  VehicleDailyLeaseHistoryRow,
  VehicleDocumentResponse,
  VehicleLeaseHistoryRow,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { VehicleOverviewScreen } from "./VehicleOverviewScreen.js";

const baseVehicle: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  arrangement: "B",
};

/** Every scoped read this screen fetches (`document`/`expense`/`lease`/`daily-lease`) defaults to empty, so a test only has to say what it cares about — the same convention `HomeScreen.test.tsx`'s own `baseGet` already established. */
function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/vehicle/v1") return Promise.resolve(baseVehicle);
    return Promise.resolve([]);
  });
  return get;
}

test("renders the vehicle's fields once loaded", async () => {
  const get = baseGet();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Bus")).toBeInTheDocument();
  expect(screen.getByText("Daily lease")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/vehicle/v1");
});

test("the calendar action calls onViewCalendar", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const onViewCalendar = vi.fn();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={onViewCalendar}
      onSelectLease={() => {}}
    />,
    { get },
  );

  await user.click(await screen.findByRole("button", { name: "View calendar" }));

  expect(onViewCalendar).toHaveBeenCalledOnce();
});

test("no active arrangement renders NotAvailable, never a blank or a zero", async () => {
  const get = baseGet({
    "/api/vehicle/v1": { ...baseVehicle, arrangement: undefined },
  });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("no active arrangement")).toBeInTheDocument();
});

test("nothing recorded in any scoped read renders no Paperwork, Costs or History section", async () => {
  const get = baseGet();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Bus")).toBeInTheDocument();
  expect(screen.queryByText(/Paperwork/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Costs/)).not.toBeInTheDocument();
  expect(screen.queryByText(/History/)).not.toBeInTheDocument();
});

test("paperwork lists every document type with a date set", async () => {
  const documents: VehicleDocumentResponse[] = [
    { docType: "insurance", expiryDate: "2026-09-30" },
    { docType: "revenue_licence", expiryDate: "2027-01-15" },
  ];
  const get = baseGet({ "/api/vehicle/v1/document": documents });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Paperwork · 2")).toBeInTheDocument();
  expect(screen.getByText("Insurance")).toBeInTheDocument();
  expect(screen.getByText("Revenue licence")).toBeInTheDocument();
  expect(screen.getByText("Expires 30 Sept 2026")).toBeInTheDocument();
});

test("a voided expense stays in the costs list, struck through, with its reason (W-50)", async () => {
  const expenses: ExpenseListRow[] = [
    {
      id: "e1",
      vehicleId: "v1",
      tripId: null,
      incidentId: null,
      category: "fuel",
      amountMinor: "500000",
      spentOn: "2026-07-20",
      borneBy: "us",
      borneByDriverId: null,
      borneByCustomerId: null,
      paidByUserId: null,
      litres: null,
      note: null,
      voidedAt: null,
      voidedReason: null,
    },
    {
      id: "e2",
      vehicleId: "v1",
      tripId: null,
      incidentId: null,
      category: "repairs",
      amountMinor: "1200000",
      spentOn: "2026-07-10",
      borneBy: "us",
      borneByDriverId: null,
      borneByCustomerId: null,
      paidByUserId: null,
      litres: null,
      note: null,
      voidedAt: "2026-07-11T00:00:00Z",
      voidedReason: "wrong vehicle",
    },
  ];
  const get = baseGet({ "/api/vehicle/v1/expense": expenses });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("Costs · 2")).toBeInTheDocument();
  expect(screen.getByText("Fuel")).toBeInTheDocument();
  const voidedCategory = screen.getByText("Repairs");
  expect(voidedCategory).toHaveClass("line-through");
  expect(screen.getByText(/Voided: wrong vehicle/)).toBeInTheDocument();
});

test("history merges lease and daily-lease periods into one chronological list", async () => {
  const leases: VehicleLeaseHistoryRow[] = [
    {
      id: "l1",
      status: "closed",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      rentAmountMinor: "4500000",
      customerId: "c1",
      customerName: "Acme Traders",
    },
  ];
  const dailyLeases: VehicleDailyLeaseHistoryRow[] = [
    {
      id: "dl1",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "450000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ];
  const get = baseGet({
    "/api/vehicle/v1/lease": leases,
    "/api/vehicle/v1/daily-lease": dailyLeases,
  });
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={() => {}}
    />,
    { get },
  );

  expect(await screen.findByText("History · 2")).toBeInTheDocument();
  expect(screen.getByText("Daily lease · Rs 4,500/day")).toBeInTheDocument();
  expect(screen.getByText("Lease out · Rs 45,000/month")).toBeInTheDocument();
  expect(screen.getByText("Sunil Perera · 1 Jun 2026 – ongoing")).toBeInTheDocument();
  expect(screen.getByText("Acme Traders · 1 Jan 2025 – 31 Dec 2025")).toBeInTheDocument();
});

test("a lease entry in History is tappable onto its own hub; a daily-lease entry is not (Web-P6b)", async () => {
  const user = userEvent.setup();
  const leases: VehicleLeaseHistoryRow[] = [
    {
      id: "l1",
      status: "closed",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      rentAmountMinor: "4500000",
      customerId: "c1",
      customerName: "Acme Traders",
    },
  ];
  const dailyLeases: VehicleDailyLeaseHistoryRow[] = [
    {
      id: "dl1",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "450000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ];
  const get = baseGet({
    "/api/vehicle/v1/lease": leases,
    "/api/vehicle/v1/daily-lease": dailyLeases,
  });
  const onSelectLease = vi.fn();
  renderWithProviders(
    <VehicleOverviewScreen
      vehicleId="v1"
      onBack={() => {}}
      onViewCalendar={() => {}}
      onSelectLease={onSelectLease}
    />,
    { get },
  );

  await user.click(await screen.findByText("Lease out · Rs 45,000/month"));
  expect(onSelectLease).toHaveBeenCalledOnce();
  expect(onSelectLease).toHaveBeenCalledWith("l1");

  // The daily-lease row has nothing to go to yet — a plain row, not a button.
  const dailyLeaseText = screen.getByText("Daily lease · Rs 4,500/day");
  expect(dailyLeaseText.closest("button")).toBeNull();
});
