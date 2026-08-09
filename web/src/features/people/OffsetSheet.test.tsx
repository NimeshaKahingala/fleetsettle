import { asBusinessDate } from "@fleetsettle/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { OffsetSheet } from "./OffsetSheet.js";

const today = asBusinessDate("2026-07-15");

test("records an offset with the amount, today's date pre-filled, and closes on success", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "off1",
    driverId: "d1",
    amountMinor: "5000",
    occurredOn: today,
    note: null,
  });
  const onOpenChange = vi.fn();
  renderWithProviders(
    <OffsetSheet open driverId="d1" today={today} onOpenChange={onOpenChange} />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of "5000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Record offset" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/offset", {
      driverId: "d1",
      amountMinor: "5000",
      occurredOn: today,
    }),
  );
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("surfaces the server's 400 when the offset exceeds what is outstanding on one side (INV-3)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockRejectedValue(new Error("This offset exceeds what is outstanding"));
  renderWithProviders(<OffsetSheet open driverId="d1" today={today} onOpenChange={vi.fn()} />, {
    post,
  });

  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of "5000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Record offset" }));

  expect(await screen.findByText("This offset exceeds what is outstanding")).toBeInTheDocument();
});
