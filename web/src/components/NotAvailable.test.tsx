import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { NotAvailable } from "./NotAvailable.js";

test("renders the em-dash with its reason, never a bare zero (W-56)", () => {
  render(<NotAvailable reason="no closing odometer" />);
  expect(screen.getByText("no closing odometer")).toBeInTheDocument();
  expect(screen.getByLabelText("Not available: no closing odometer")).toBeInTheDocument();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});

test("the info affordance is optional and fires its own callback", async () => {
  const user = userEvent.setup();
  const onInfo = vi.fn();
  render(<NotAvailable reason="no closing odometer" onInfo={onInfo} />);

  await user.click(screen.getByRole("button", { name: /Why is this not available/ }));
  expect(onInfo).toHaveBeenCalledOnce();
});

test("no info button when onInfo is omitted", () => {
  render(<NotAvailable reason="no closing odometer" />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
