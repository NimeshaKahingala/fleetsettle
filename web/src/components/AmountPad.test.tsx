import { parse } from "@fleetsettle/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AmountPad } from "./AmountPad.js";

test("digits build minor units from the right — no decimal-point state machine", async () => {
  const user = userEvent.setup();
  render(<AmountPad title="Amount received" onSave={vi.fn()} />);

  for (const digit of ["5", "0", "0", "0", "0", "0"]) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  // 500000 minor units = Rs 5,000.00 — cents suppressed since they're zero.
  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 5,000");
});

test("backspace removes the last digit typed", async () => {
  const user = userEvent.setup();
  render(<AmountPad title="Amount received" onSave={vi.fn()} />);

  for (const digit of ["5", "0", "0"]) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Backspace" }));
  // 50 minor units = Rs 0.50
  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 0.50");
});

test("the decimal point key is present (matches the 12-key grid) but inert", async () => {
  const user = userEvent.setup();
  render(<AmountPad title="Amount received" onSave={vi.fn()} />);

  const dot = screen.getByRole("button", { name: "." });
  expect(dot).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "5" }));
  expect(screen.getByRole("textbox", { name: "Amount received" })).toHaveTextContent("Rs 0.05");
});

test("shows the expected caption when given, never fabricating one", () => {
  render(<AmountPad title="Amount received" expectedMinor={parse("500000")} onSave={vi.fn()} />);
  expect(screen.getByText("expected")).toBeInTheDocument();
  expect(screen.getByText("Rs 5,000")).toBeInTheDocument();
});

test("Save reports the typed value as a Minor, and the checkbox state (UC-32)", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AmountPad title="Amount received" showMakeNewDailyAmount onSave={onSave} />);

  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("checkbox", { name: "Make this the new daily amount" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(onSave).toHaveBeenCalledWith(parse("5"), { makeNewDailyAmount: true });
});

test("the effective-date slot only appears once the checkbox is checked", async () => {
  const user = userEvent.setup();
  render(
    <AmountPad
      title="Amount received"
      showMakeNewDailyAmount
      effectiveDateControl={<span>30 Jul</span>}
      onSave={vi.fn()}
    />,
  );

  expect(screen.queryByText("30 Jul")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Make this the new daily amount" }));
  expect(screen.getByText("30 Jul")).toBeInTheDocument();
});
