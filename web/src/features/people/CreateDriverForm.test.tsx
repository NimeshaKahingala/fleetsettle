import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CreateDriverForm } from "./CreateDriverForm.js";

test("saves with name alone — fee and mobile stay behind Disclosure, never required (U-2/M-6)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  const onCreated = vi.fn();
  renderWithProviders(<CreateDriverForm onCreated={onCreated} />, { post });

  await user.type(screen.getByLabelText("Name"), "Sunil Perera");
  await user.click(screen.getByRole("button", { name: "Add driver" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/driver", { name: "Sunil Perera" }),
  );
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
});

test("GAP-55: Name and Mobile carry autocomplete tokens", async () => {
  const user = userEvent.setup();
  renderWithProviders(<CreateDriverForm onCreated={() => {}} />);

  expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
  await user.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByLabelText(/^Mobile/)).toHaveAttribute("autocomplete", "tel");
});

test("a day fee entered via MoneyField reaches the request as a wire string, never a bigint or a number", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ id: "d1", name: "Sunil Perera" });
  renderWithProviders(<CreateDriverForm onCreated={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Name"), "Sunil Perera");
  await user.click(screen.getByRole("button", { name: "More" }));

  await user.click(screen.getByRole("button", { name: "Enter driver day fee" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "Add driver" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/driver", {
      name: "Sunil Perera",
      driverDayFeeMinor: "5",
    }),
  );
  const [, body] = post.mock.calls[0] as [string, { driverDayFeeMinor: unknown }];
  expect(typeof body.driverDayFeeMinor).toBe("string");
});

test("GAP-76: a blank name shows field-specific copy, never the generic zod fallback", async () => {
  const user = userEvent.setup();
  const post = vi.fn();
  renderWithProviders(<CreateDriverForm onCreated={vi.fn()} />, { post });

  await user.click(screen.getByRole("button", { name: "Add driver" }));

  expect(await screen.findByText("Name is required")).toBeInTheDocument();
  expect(screen.queryByText("Invalid input")).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

test("a trip fee entered via MoneyField reaches the request as a wire string, independent of the day fee", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ id: "d1", name: "Sunil Perera" });
  renderWithProviders(<CreateDriverForm onCreated={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Name"), "Sunil Perera");
  await user.click(screen.getByRole("button", { name: "More" }));

  await user.click(screen.getByRole("button", { name: "Enter driver trip fee" }));
  await user.click(screen.getByRole("button", { name: "9" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "Add driver" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/driver", {
      name: "Sunil Perera",
      driverTripFeeMinor: "9",
    }),
  );
});
