import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CreateCustomerForm } from "./CreateCustomerForm.js";

test("defaults to person, and saves with just a name plus a mobile (W-55: a person needs an NIC or a mobile)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "c1",
    customerType: "person",
    name: "Kamal Silva",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: "0771234567",
    address: null,
  });
  const onCreated = vi.fn();
  renderWithProviders(<CreateCustomerForm onCreated={onCreated} />, { post });

  expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByLabelText("Registration number")).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("Name"), "Kamal Silva");
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.type(screen.getByLabelText(/^Mobile/), "0771234567");
  await user.click(screen.getByRole("button", { name: "Add customer" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/customer", {
      customerType: "person",
      name: "Kamal Silva",
      mobile: "0771234567",
    }),
  );
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
});

test("GAP-55: Name, Mobile and Address carry autocomplete tokens", async () => {
  const user = userEvent.setup();
  renderWithProviders(<CreateCustomerForm onCreated={() => {}} />);

  expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
  await user.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByLabelText(/^Mobile/)).toHaveAttribute("autocomplete", "tel");
  expect(screen.getByLabelText(/^Address/)).toHaveAttribute("autocomplete", "street-address");
});

test("switching to organisation requires a registration number and reveals its field", async () => {
  const user = userEvent.setup();
  const post = vi.fn();
  renderWithProviders(<CreateCustomerForm onCreated={vi.fn()} />, { post });

  await user.click(screen.getByRole("button", { name: "Organisation" }));
  expect(screen.getByLabelText("Registration number")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Name"), "Perera Transport (Pvt) Ltd");
  await user.click(screen.getByRole("button", { name: "Add customer" }));

  expect(await screen.findByText(/have >=1 character/i)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test("a person with neither NIC nor mobile is rejected client-side (W-55)", async () => {
  const user = userEvent.setup();
  const post = vi.fn();
  renderWithProviders(<CreateCustomerForm onCreated={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Name"), "Kamal Silva");
  await user.click(screen.getByRole("button", { name: "Add customer" }));

  expect(await screen.findByText("A person needs an NIC or a mobile number")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
