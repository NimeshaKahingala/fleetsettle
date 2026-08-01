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

test("a day fee entered via MoneyField reaches the request as a wire string, never a bigint or a number", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ id: "d1", name: "Sunil Perera" });
  renderWithProviders(<CreateDriverForm onCreated={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Name"), "Sunil Perera");
  await user.click(screen.getByRole("button", { name: "More" }));

  // MoneyField's default (non-degraded) variant opens AmountPad in a sheet.
  await user.click(screen.getByRole("button", { name: "Rs 0" }));
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
