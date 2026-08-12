import { asBusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  MileagePackageResponse,
  PaperworkWarningRow,
  StartLeaseResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { StartLeaseScreen } from "./StartLeaseScreen.js";

const today = asBusinessDate("2026-07-15");

const vehicle: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Car",
  lifecycle: "active",
  arrangement: "A",
};

const existingCustomer: CustomerResponse = {
  id: "c1",
  customerType: "person",
  name: "Nimal Perera",
  nic: null,
  registrationNo: null,
  contactPerson: null,
  mobile: "0771234567",
  address: null,
};

function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    if (path === "/api/customer") return Promise.resolve([existingCustomer]);
    return Promise.resolve([]);
  });
  return get;
}

async function pickExistingCustomer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Choose customer" }));
  await user.click(await screen.findByText("Nimal Perera"));
}

/** `MoneyField`'s blank trigger is named "Enter {label}" (GAP-85) — defaults to the monthly amount field every call site but one wants. */
async function enterMoneyField(
  user: ReturnType<typeof userEvent.setup>,
  digits: string,
  triggerName = "Enter monthly amount",
) {
  await user.click(screen.getByRole("button", { name: triggerName }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("saves with level-1 fields only — every other step is skippable (U-2)", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "l1" } satisfies Partial<StartLeaseResponse>);
  const onCreated = vi.fn();
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={onCreated} />,
    { get, post },
  );

  // Step 0 — customer.
  await pickExistingCustomer(user);
  await user.click(screen.getByRole("button", { name: "Next" }));

  // Step 1 — money: monthly amount is the only other level-1 field.
  await enterMoneyField(user, "500000");
  await user.click(screen.getByRole("button", { name: "Next" }));

  // Steps 2–5: term, mileage, reminders, condition — all skipped.
  for (let i = 0; i < 4; i++) {
    await user.click(await screen.findByRole("button", { name: "Next" }));
  }

  // Step 6 — confirm.
  await user.click(await screen.findByRole("button", { name: "Start rental" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/lease",
      expect.objectContaining({
        vehicleId: "v1",
        customerId: "c1",
        startDate: today,
        billingDay: 15,
        rentAmountMinor: "500000",
      }),
    ),
  );
  const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
  expect(body).not.toHaveProperty("mileageDailyLimitKm");
  expect(body).not.toHaveProperty("depositAmountMinor");
  expect(body).not.toHaveProperty("endDate");
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith("l1"));
});

test("a saved mileage package fills its own rate; the odometer becomes required", async () => {
  const user = userEvent.setup();
  const packages: MileagePackageResponse[] = [
    {
      id: "mp1",
      name: "Standard 100",
      dailyLimitKm: 100,
      excessRateMinorPerKm: "5000",
      archivedAt: null,
    },
  ];
  const get = baseGet({ "/api/mileage-package": packages });
  const post = vi.fn().mockResolvedValue({ id: "l1" } satisfies Partial<StartLeaseResponse>);
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post },
  );

  await pickExistingCustomer(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await enterMoneyField(user, "500000");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("button", { name: "Next" })); // term step

  await user.click(await screen.findByText("Standard 100"));
  // Next is disabled until the handover odometer + source are both given.
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  await user.type(screen.getByLabelText("Odometer at handover (km)"), "12000");
  await user.click(screen.getByRole("button", { name: "In person" }));
  await user.click(screen.getByRole("button", { name: "Next" }));

  await user.click(await screen.findByRole("button", { name: "Next" })); // reminders
  await user.click(await screen.findByRole("button", { name: "Next" })); // condition
  await user.click(await screen.findByRole("button", { name: "Start rental" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/lease",
      expect.objectContaining({
        mileageDailyLimitKm: 100,
        mileageExcessRateMinor: "5000",
        odometerReadingKm: 12000,
        odometerSource: "in_person",
      }),
    ),
  );
});

test("switching from Custom back to a named package uses the package's own rate, not a stale custom one", async () => {
  const user = userEvent.setup();
  const packages: MileagePackageResponse[] = [
    {
      id: "mp1",
      name: "Standard 100",
      dailyLimitKm: 100,
      excessRateMinorPerKm: "5000",
      archivedAt: null,
    },
  ];
  const get = baseGet({ "/api/mileage-package": packages });
  const post = vi.fn().mockResolvedValue({ id: "l1" } satisfies Partial<StartLeaseResponse>);
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post },
  );

  await pickExistingCustomer(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await enterMoneyField(user, "500000");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("button", { name: "Next" })); // term step

  await user.click(await screen.findByRole("button", { name: "Custom" }));
  await user.type(screen.getByLabelText("Daily km limit"), "80");
  await enterMoneyField(user, "9999", "Enter excess fee per km");

  // Switch to the named package instead — its own rate must win, not the 9999 just typed.
  await user.click(screen.getByRole("button", { name: "Standard 100" }));
  await user.type(screen.getByLabelText("Odometer at handover (km)"), "1000");
  await user.click(screen.getByRole("button", { name: "Photo" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("button", { name: "Next" }));
  await user.click(await screen.findByRole("button", { name: "Start rental" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/lease",
      expect.objectContaining({ mileageDailyLimitKm: 100, mileageExcessRateMinor: "5000" }),
    ),
  );
});

test("adding a new customer selects it for the lease", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/customer")
      return Promise.resolve({
        id: "c2",
        customerType: "person",
        name: "Kamala Silva",
        nic: null,
        registrationNo: null,
        contactPerson: null,
        mobile: "0779876543",
        address: null,
      } satisfies CustomerResponse);
    return Promise.resolve({ id: "l1" });
  });
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Choose customer" }));
  await user.click(await screen.findByRole("button", { name: "Add a new customer" }));
  await user.type(screen.getByLabelText("Name"), "Kamala Silva");
  await user.click(screen.getByRole("button", { name: "More" })); // mobile is level 2 (U-2)
  await user.type(screen.getByLabelText(/Mobile/), "0779876543");
  await user.click(screen.getByRole("button", { name: "Add customer" }));

  expect(await screen.findByRole("button", { name: "Customer: Kamala Silva" })).toBeInTheDocument();
});

test("a paperwork warning for this vehicle shows on the confirm step (F-10.1)", async () => {
  const user = userEvent.setup();
  const warnings: PaperworkWarningRow[] = [
    {
      subjectType: "vehicle",
      subjectId: "v1",
      subjectLabel: "CAB-1234",
      docType: "insurance",
      expiryDate: "2026-06-01",
      isExpired: true,
    },
  ];
  const get = baseGet({ "/api/home/paperwork-warnings": warnings });
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post: vi.fn() },
  );

  await pickExistingCustomer(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await enterMoneyField(user, "500000");
  for (let i = 0; i < 5; i++) {
    await user.click(await screen.findByRole("button", { name: "Next" }));
  }

  expect(await screen.findByText(/insurance/)).toHaveTextContent("insurance expired 2026-06-01");
});

test("GAP-101 (Mode 3): a failed paperwork read shows a warning, never silently nothing, on the confirm step", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/home/paperwork-warnings") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    if (path === "/api/customer") return Promise.resolve([existingCustomer]);
    return Promise.resolve([]);
  });
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post: vi.fn() },
  );

  await pickExistingCustomer(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await enterMoneyField(user, "500000");
  for (let i = 0; i < 5; i++) {
    await user.click(await screen.findByRole("button", { name: "Next" }));
  }

  expect(await screen.findByText("Couldn't check this vehicle's paperwork.")).toBeInTheDocument();
});

test("GAP-101: a failed vehicle read blocks the form rather than silently skipping the GAP-84 arrangement check", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/vehicle/v1") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    return Promise.resolve([]);
  });
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post: vi.fn() },
  );

  expect(await screen.findByText("Something went wrong loading this vehicle.")).toBeInTheDocument();
  expect(screen.queryByText("Step 1 of 7 · Customer")).not.toBeInTheDocument();
});

test("GAP-101: a failed customer-list read shows a notice at the customer step rather than an emptied picker", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/customer") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/vehicle/v1") return Promise.resolve(vehicle);
    return Promise.resolve([]);
  });
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post: vi.fn() },
  );

  expect(
    await screen.findByText("Something went wrong loading the customer list."),
  ).toBeInTheDocument();
});

test("Back always means back — the app-bar chevron steps back one page at a time, never discarding the whole form", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const onBack = vi.fn();
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={onBack} onCreated={() => {}} />,
    { get, post: vi.fn() },
  );

  await screen.findByText("Step 1 of 7 · Customer");
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalledOnce();

  await pickExistingCustomer(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Step 2 of 7 · Money")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByText("Step 1 of 7 · Customer")).toBeInTheDocument();
  // Still once — stepping back from step 2 must not also fire the screen's own onBack.
  expect(onBack).toHaveBeenCalledOnce();
});

test("GAP-84 — a vehicle set up for a different arrangement refuses before the form ever renders", async () => {
  const post = vi.fn();
  const get = baseGet({
    "/api/vehicle/v1": { ...vehicle, arrangement: "C" } satisfies VehicleResponse,
  });
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post },
  );

  expect(
    await screen.findByText("This vehicle is set up for arrangement C, not a monthly rental."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Step 1 of 7 · Customer")).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test("GAP-84 — a vehicle with no current arrangement also refuses (never treated as 'A')", async () => {
  const get = baseGet({
    "/api/vehicle/v1": {
      id: "v1",
      registration: "CAB-1234",
      vehicleType: "Car",
      lifecycle: "active",
    } satisfies VehicleResponse,
  });
  renderWithProviders(
    <StartLeaseScreen vehicleId="v1" today={today} onBack={() => {}} onCreated={() => {}} />,
    { get, post: vi.fn() },
  );

  expect(
    await screen.findByText(
      "This vehicle has no current arrangement, so a rental can't be started on it yet.",
    ),
  ).toBeInTheDocument();
});
