import { asBusinessDate } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  CustomerResponse,
  DriverResponse,
  OpeningBalanceBatchResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { OpeningBalanceScreen } from "./OpeningBalanceScreen.js";

const today = asBusinessDate("2026-08-08");

const driver: DriverResponse = {
  id: "d1",
  name: "Sunil Perera",
  mobile: "0771234567",
  driverDayFeeMinor: "300000",
  driverTripFeeMinor: "500000",
  licenceExpiry: null,
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
const member: BusinessMemberResponse = {
  id: "bm1",
  userId: "u1",
  displayName: "Nimal",
  role: "owner",
};
const vehicle: VehicleResponse = {
  id: "v1",
  registration: "CAB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  arrangement: "B",
};

function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/opening-balance") {
      return Promise.reject(new ApiError(404, "NOT_FOUND", "no batch yet", "req-1"));
    }
    if (path === "/api/driver") return Promise.resolve([driver]);
    if (path === "/api/customer") return Promise.resolve([customer]);
    if (path === "/api/business-member") return Promise.resolve([member]);
    if (path === "/api/vehicle") return Promise.resolve([vehicle]);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  return get;
}

async function enterAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("saves with just a go-live date and no entries at all (U-2)", async () => {
  const user = userEvent.setup();
  const put = vi.fn().mockResolvedValue({
    id: "b1",
    goLiveDate: today,
    status: "draft",
    committedAt: null,
    entries: [],
  } satisfies OpeningBalanceBatchResponse);
  const get = baseGet();
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get, put });

  await screen.findByText("Nothing entered yet.");
  await user.click(screen.getByRole("button", { name: "Save as draft" }));

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith("/api/opening-balance", { goLiveDate: today, entries: [] }),
  );
});

test("adding a customer-due entry shows it in the list, and Save sends the full shape", async () => {
  const user = userEvent.setup();
  const put = vi.fn().mockResolvedValue({
    id: "b1",
    goLiveDate: today,
    status: "draft",
    committedAt: null,
    entries: [],
  } satisfies OpeningBalanceBatchResponse);
  const get = baseGet();
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get, put });

  await user.click(await screen.findByRole("button", { name: "Add a starting figure" }));
  await user.click(await screen.findByText("A customer owes us"));
  await user.click(screen.getByRole("button", { name: "Choose customer" }));
  await user.click(await screen.findByText("Perera Tours"));
  await enterAmount(user, "50000");
  await user.click(screen.getByRole("button", { name: "Add to the list" }));

  expect(await screen.findByText("A customer owes us")).toBeInTheDocument();
  expect(screen.getByText("Perera Tours")).toBeInTheDocument();
  expect(screen.getByText("Rs 500")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Save as draft" }));

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith("/api/opening-balance", {
      goLiveDate: today,
      entries: [{ kind: "customer_due", amountMinor: "50000", partyCustomerId: "c1" }],
    }),
  );
});

test("removing an entry takes it back out of both the list and the next save", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("button", { name: "Add a starting figure" }));
  await user.click(await screen.findByText("We owe a driver"));
  await user.click(screen.getByRole("button", { name: "Choose driver" }));
  await user.click(await screen.findByText("Sunil Perera"));
  await enterAmount(user, "20000");
  await user.click(screen.getByRole("button", { name: "Add to the list" }));

  expect(await screen.findByText("We owe a driver")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove Sunil Perera" }));

  expect(screen.queryByText("We owe a driver")).not.toBeInTheDocument();
  expect(screen.getByText("Nothing entered yet.")).toBeInTheDocument();
});

test("Confirm and go live saves then commits, in order", async () => {
  const user = userEvent.setup();
  const draft: OpeningBalanceBatchResponse = {
    id: "b1",
    goLiveDate: today,
    status: "draft",
    committedAt: null,
    entries: [],
  };
  const committed: OpeningBalanceBatchResponse = { ...draft, status: "committed" };
  const put = vi.fn().mockResolvedValue(draft);
  const post = vi.fn().mockResolvedValue(committed);
  const get = baseGet();
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get, put, post });

  await user.click(await screen.findByRole("button", { name: "Confirm and go live" }));
  await user.click(await screen.findByRole("button", { name: "Confirm and go live" }));

  await waitFor(() => expect(post).toHaveBeenCalledWith("/api/opening-balance/commit", {}));
  const putOrder = put.mock.invocationCallOrder[0];
  const postOrder = post.mock.invocationCallOrder[0];
  expect(putOrder).toBeLessThan(postOrder as number);
});

test("loads an existing draft batch and resolves party names for display", async () => {
  const get = baseGet({
    "/api/opening-balance": {
      id: "b1",
      goLiveDate: "2026-08-01",
      status: "draft",
      committedAt: null,
      entries: [
        {
          id: "e1",
          kind: "driver_arrears",
          partyDriverId: "d1",
          amountMinor: "120000",
          vehicleId: null,
          originalDueDate: null,
        },
      ],
    } satisfies OpeningBalanceBatchResponse,
  });
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText("A driver owes us")).toBeInTheDocument();
  expect(screen.getByText("Sunil Perera")).toBeInTheDocument();
  expect(screen.getByText("Rs 1,200")).toBeInTheDocument();
});

test("GAP-101: a saved batch with real entries that fails to hydrate blocks Save and Confirm, rather than risking a silent overwrite on the next full-replace write", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/opening-balance") {
      return Promise.resolve({
        id: "b1",
        goLiveDate: "2026-08-01",
        status: "draft",
        committedAt: null,
        entries: [
          {
            id: "e1",
            kind: "driver_arrears",
            partyDriverId: "d1",
            amountMinor: "120000",
            vehicleId: null,
            originalDueDate: null,
          },
        ],
      } satisfies OpeningBalanceBatchResponse);
    }
    if (path === "/api/driver") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/customer") return Promise.resolve([customer]);
    if (path === "/api/business-member") return Promise.resolve([member]);
    if (path === "/api/vehicle") return Promise.resolve([vehicle]);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get });

  expect(await screen.findByText(/Couldn't load what you already saved/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save as draft" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Confirm and go live" })).toBeDisabled();
});

test("GAP-101: the driver list failing inside 'Add a starting figure' shows a failure notice in place of an empty picker", async () => {
  const user = userEvent.setup();
  const get = baseGet({
    "/api/driver": Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1")),
  });
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("button", { name: "Add a starting figure" }));
  await user.click(await screen.findByText("We owe a driver"));

  expect(
    await screen.findByText("Something went wrong loading the driver list."),
  ).toBeInTheDocument();
  // Nothing was saved to lose (no batch existed) — this is a picker-level
  // failure, not a write-blocking one, so the banner from the other test
  // must not appear here.
  expect(screen.queryByText(/Couldn't load what you already saved/)).not.toBeInTheDocument();
});

test("a closed first period shows the lock explanation, not a raw error", async () => {
  const user = userEvent.setup();
  const put = vi
    .fn()
    .mockRejectedValue(new ApiError(409, "OPENING_BALANCE_LOCKED", "locked", "req-2"));
  const get = baseGet();
  renderWithProviders(<OpeningBalanceScreen today={today} onBack={() => {}} />, { get, put });

  await screen.findByText("Nothing entered yet.");
  await user.click(screen.getByRole("button", { name: "Save as draft" }));

  expect(
    await screen.findByText(/The first accounting period has already closed/),
  ).toBeInTheDocument();
});
