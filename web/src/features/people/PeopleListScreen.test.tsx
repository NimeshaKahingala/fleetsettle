import type { CustomerResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { PeopleListScreen } from "./PeopleListScreen.js";

const drivers: DriverResponse[] = [
  {
    id: "d1",
    name: "Sunil Perera",
    mobile: "0771234567",
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  },
];
const customers: CustomerResponse[] = [
  {
    id: "c1",
    customerType: "organisation",
    name: "Perera Transport",
    nic: null,
    registrationNo: "PV123",
    contactPerson: null,
    mobile: null,
    address: null,
  },
];

function get<T>(path: string): Promise<T> {
  if (path === "/api/driver") return Promise.resolve(drivers as T);
  if (path === "/api/customer") return Promise.resolve(customers as T);
  throw new Error(`unexpected path: ${path}`);
}

test("lists drivers and customers in their own sections with counts", async () => {
  renderWithProviders(<PeopleListScreen onSelectDriver={vi.fn()} onSelectCustomer={vi.fn()} />, {
    get,
  });

  expect(await screen.findByText("Drivers · 1")).toBeInTheDocument();
  expect(screen.getByText("Sunil Perera")).toBeInTheDocument();
  expect(screen.getByText("Customers · 1")).toBeInTheDocument();
  expect(screen.getByText("Perera Transport")).toBeInTheDocument();
});

test("GAP-101: a failed driver read shows a failure notice, never a false 'Drivers · 0' — the customers section is unaffected", async () => {
  const failingGet = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/driver") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (path === "/api/customer") return Promise.resolve(customers);
    throw new Error(`unexpected path: ${path}`);
  });
  renderWithProviders(<PeopleListScreen onSelectDriver={vi.fn()} onSelectCustomer={vi.fn()} />, {
    get: failingGet,
  });

  expect(await screen.findByText("Something went wrong loading drivers.")).toBeInTheDocument();
  expect(screen.queryByText(/Drivers ·/)).not.toBeInTheDocument();
  expect(screen.getByText("Customers · 1")).toBeInTheDocument();
  expect(screen.getByText("Perera Transport")).toBeInTheDocument();
});

test("GAP-128: a driver read still in flight shows a loading notice, never a false 'Drivers · 0' — the customers section is unaffected", async () => {
  let resolveDrivers: ((value: DriverResponse[]) => void) | undefined;
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/driver") {
      return new Promise<DriverResponse[]>((resolve) => {
        resolveDrivers = resolve;
      });
    }
    if (path === "/api/customer") return Promise.resolve(customers);
    throw new Error(`unexpected path: ${path}`);
  });
  renderWithProviders(<PeopleListScreen onSelectDriver={vi.fn()} onSelectCustomer={vi.fn()} />, {
    get,
  });

  expect(await screen.findByText("Customers · 1")).toBeInTheDocument();
  expect(screen.getAllByText("Loading…")).toHaveLength(1);
  expect(screen.queryByText(/Drivers ·/)).not.toBeInTheDocument();

  resolveDrivers?.(drivers);

  expect(await screen.findByText("Drivers · 1")).toBeInTheDocument();
});

test("selecting a driver or a customer reports it, never a route change", async () => {
  const user = userEvent.setup();
  const onSelectDriver = vi.fn();
  const onSelectCustomer = vi.fn();
  renderWithProviders(
    <PeopleListScreen onSelectDriver={onSelectDriver} onSelectCustomer={onSelectCustomer} />,
    { get },
  );

  await user.click(await screen.findByText("Sunil Perera"));
  expect(onSelectDriver).toHaveBeenCalledWith(drivers[0]);

  await user.click(screen.getByText("Perera Transport"));
  expect(onSelectCustomer).toHaveBeenCalledWith(customers[0]);
});

test("Add opens the quick-add action sheet, offering both kinds — fuel is always first in spirit, add is always the same order here", async () => {
  const user = userEvent.setup();
  renderWithProviders(<PeopleListScreen onSelectDriver={vi.fn()} onSelectCustomer={vi.fn()} />, {
    get,
  });

  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("button", { name: "Add a driver" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add a customer" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Add a driver" }));
  expect(screen.getByLabelText("Name")).toBeInTheDocument();
});
