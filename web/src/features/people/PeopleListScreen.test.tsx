import type { CustomerResponse, DriverResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
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
