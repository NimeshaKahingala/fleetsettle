import { asBusinessDate } from "@fleetsettle/shared";
import type {
  DriverResponse,
  PaperworkWarningRow,
  TripResponse,
  VehicleCalendarDay,
  VehicleDailyLeaseHistoryRow,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { BookTripScreen } from "./BookTripScreen.js";

const today = asBusinessDate("2026-07-15");

const vehicle: VehicleResponse = {
  id: "v1",
  registration: "NC-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  arrangement: "B",
};

const driver: DriverResponse = {
  id: "d1",
  name: "Sunil Perera",
  mobile: null,
  driverDayFeeMinor: "300000",
  driverTripFeeMinor: "900000",
  licenceExpiry: null,
};

function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    if (path === "/api/customer") return Promise.resolve([]);
    if (path === "/api/driver") return Promise.resolve([driver]);
    if (path === "/api/home/paperwork-warnings") return Promise.resolve([]);
    if (path.startsWith("/api/vehicle/v1/calendar")) return Promise.resolve([]);
    if (path === "/api/vehicle/v1/daily-lease") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  return get;
}

test("saves with just the vehicle and default dates — every other field is skippable (U-2)", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "t1" } satisfies Partial<TripResponse>);
  const onBooked = vi.fn();
  renderWithProviders(
    <BookTripScreen vehicleId="v1" today={today} onBack={() => {}} onBooked={onBooked} />,
    { get, post },
  );

  expect(await screen.findByRole("heading", { name: "NC-1234" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Book trip" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/trip", {
      vehicleId: "v1",
      startDate: today,
      endDate: today,
    }),
  );
  expect(onBooked).toHaveBeenCalledWith("t1");
});

test("picking a driver pre-fills his own trip fee, overridable", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "t1" });
  renderWithProviders(
    <BookTripScreen vehicleId="v1" today={today} onBack={() => {}} onBooked={() => {}} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("button", { name: "Choose driver (optional)" }));
  await user.click(screen.getByText("Sunil Perera"));

  // "Rs 9,000" is the driver's own driverTripFeeMinor, pre-filled, not typed.
  expect(await screen.findByText("Rs 9,000")).toBeInTheDocument();

  // AmountPad builds minor units from the right onto whatever it opened
  // with (§6.2) — one more digit on the pre-filled 900000 is 9000005, which
  // is enough to prove the field actually took the tap, not stuck immutably.
  await user.click(screen.getByRole("button", { name: "Rs 9,000" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Book trip" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/trip",
      expect.objectContaining({ driverId: "d1", driverFeeMinor: "9000005" }),
    ),
  );
});

test("the confirm step warns how many daily-lease days this booking pauses, and what they were worth", async () => {
  const user = userEvent.setup();
  // A single-day trip (start === end, the wizard's own default) keeps this
  // test from having to drive the native date input — one day is enough to
  // prove the warning reads the calendar rather than being hardcoded.
  const days: VehicleCalendarDay[] = [
    {
      businessDate: "2026-07-15",
      arrangement: "B",
      sourceType: "daily_lease",
      sourceId: "dl1",
      isHold: false,
      dayRecordState: "open",
    },
  ];
  const dailyLeases: VehicleDailyLeaseHistoryRow[] = [
    {
      id: "dl1",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "500000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ];
  const get = baseGet({
    "/api/vehicle/v1/calendar?from=2026-07-15&to=2026-07-15": days,
    "/api/vehicle/v1/daily-lease": dailyLeases,
  });
  renderWithProviders(
    <BookTripScreen vehicleId="v1" today={today} onBack={() => {}} onBooked={() => {}} />,
    { get, post: vi.fn() },
  );

  await user.click(await screen.findByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByText(/pauses 1 day/)).toBeInTheDocument();
  expect(screen.getByText(/Rs 5,000/)).toBeInTheDocument();
});

test("a paperwork warning for this vehicle shows on the confirm step (F-10.1)", async () => {
  const user = userEvent.setup();
  const warnings: PaperworkWarningRow[] = [
    {
      subjectType: "vehicle",
      subjectId: "v1",
      subjectLabel: "NC-1234",
      docType: "insurance",
      expiryDate: "2026-08-01",
      isExpired: false,
    },
  ];
  const get = baseGet({ "/api/home/paperwork-warnings": warnings });
  renderWithProviders(
    <BookTripScreen vehicleId="v1" today={today} onBack={() => {}} onBooked={() => {}} />,
    { get, post: vi.fn() },
  );

  await user.click(await screen.findByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByText(/insurance expires 2026-08-01/)).toBeInTheDocument();
});
