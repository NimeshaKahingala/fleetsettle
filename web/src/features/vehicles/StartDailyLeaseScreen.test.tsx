import { asBusinessDate } from "@fleetsettle/shared";
import type {
  DailyLeaseResponse,
  DriverResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { StartDailyLeaseScreen } from "./StartDailyLeaseScreen.js";

const today = asBusinessDate("2026-07-15");

const vehicle: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  arrangement: "B",
};

const driver: DriverResponse = {
  id: "d1",
  name: "Sunil Perera",
  mobile: "0771234567",
  // Money you pay *him*, on a charter. It must never reach this screen's
  // amount field, which is money he pays *you* — the assertion below is the
  // point of setting it here at all.
  driverDayFeeMinor: "300000",
  driverTripFeeMinor: "500000",
  licenceExpiry: null,
};

function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    if (path === "/api/driver") return Promise.resolve([driver]);
    return Promise.resolve([]);
  });
  return get;
}

async function pickDriver(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Choose driver" }));
  await user.click(await screen.findByText("Sunil Perera"));
}

/** `MoneyField`'s trigger is named by its current value — blank reads "Rs 0" (§6.2). */
async function enterAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.click(screen.getByRole("button", { name: "Rs 0" }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("saves with driver, pattern and amount alone — the effective date defaults and the end date is level 2 (U-2)", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "dl1" } satisfies Partial<DailyLeaseResponse>);
  const onCreated = vi.fn();
  renderWithProviders(
    <StartDailyLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={onCreated} />,
    { get, post },
  );

  await pickDriver(user);
  await enterAmount(user, "500000");
  await user.click(screen.getByRole("button", { name: "Start daily lease" }));

  expect(post).toHaveBeenCalledWith("/api/daily-lease", {
    vehicleId: "v1",
    driverId: "d1",
    patternType: "every_day",
    effectiveFrom: "2026-07-15",
    dailyLeaseAmountMinor: "500000",
  });
  expect(onCreated).toHaveBeenCalledWith("dl1");
});

test("the daily lease amount is never pre-filled from the driver's day fee — opposite directions of money", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <StartDailyLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get: baseGet() },
  );

  await pickDriver(user);

  // `driverDayFeeMinor` is 300000 above. If it ever leaks into this field the
  // trigger reads "Rs 3,000" instead of the blank "Rs 0", and a manager
  // accepts a plausible figure pointing the wrong way. UC §2's UC-04 note
  // records that v1.1 merged these two and that separating them was a
  // deliberate correction.
  expect(await screen.findByRole("button", { name: "Rs 0" })).toBeInTheDocument();
});

test("patternWeekdays is sent only for the chosen-days pattern, and the save waits for at least one day", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "dl1" } satisfies Partial<DailyLeaseResponse>);
  renderWithProviders(
    <StartDailyLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post },
  );

  await pickDriver(user);
  await enterAmount(user, "500000");
  await user.click(screen.getByRole("button", { name: "Chosen days" }));

  // The schema's own `superRefine` requires the pair, so an empty selection
  // could only ever be rejected server-side.
  expect(screen.getByRole("button", { name: "Start daily lease" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Wed" }));
  await user.click(screen.getByRole("button", { name: "Mon" }));
  await user.click(screen.getByRole("button", { name: "Start daily lease" }));

  expect(post).toHaveBeenCalledWith(
    "/api/daily-lease",
    expect.objectContaining({ patternType: "weekdays", patternWeekdays: [1, 3] }),
  );
});

test("an overlapping daily lease is shown as an ordinary outcome, not a raw error", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockRejectedValue(new ApiError(409, "DAILY_LEASE_OVERLAPS", "overlaps", "req-1"));
  renderWithProviders(
    <StartDailyLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get: baseGet(), post },
  );

  await pickDriver(user);
  await enterAmount(user, "500000");
  await user.click(screen.getByRole("button", { name: "Start daily lease" }));

  expect(await screen.findByText(/already has a daily lease/i)).toBeInTheDocument();
});
