import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Sheet } from "./Sheet.js";

test("renders its title and children when open, and closes via the visible close button (M-23)", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(
    <Sheet open onOpenChange={onOpenChange} title="Log a fuel fill">
      <p>Amount</p>
    </Sheet>,
  );

  expect(screen.getByText("Log a fuel fill")).toBeInTheDocument();
  expect(screen.getByText("Amount")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("renders nothing when closed", () => {
  render(
    <Sheet open={false} onOpenChange={vi.fn()} title="Log a fuel fill">
      <p>Amount</p>
    </Sheet>,
  );
  expect(screen.queryByText("Amount")).not.toBeInTheDocument();
});
