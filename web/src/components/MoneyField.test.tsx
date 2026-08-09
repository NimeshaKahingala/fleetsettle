import { parse } from "@fleetsettle/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MoneyField } from "./MoneyField.js";

test("default variant opens AmountPad in a sheet on tap, and reports the saved value", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<MoneyField label="Fuel amount" valueMinor={null} onChange={onChange} />);

  expect(screen.getByText("Enter fuel amount")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Enter fuel amount" }));

  // AmountPad is now open inside the sheet.
  expect(screen.getByRole("textbox", { name: "Fuel amount" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(onChange).toHaveBeenCalledWith(parse("5"));
});

test("degraded variant is a plain inputmode=decimal text field, never type=number", () => {
  render(<MoneyField label="Amount" valueMinor={parse("500000")} onChange={vi.fn()} degrade />);
  const input = screen.getByLabelText("Amount");
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveAttribute("inputmode", "decimal");
  expect(input).toHaveValue("5,000");
});

test("degraded variant parses and reformats on blur, never per keystroke", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<MoneyField label="Amount" valueMinor={null} onChange={onChange} degrade />);

  const input = screen.getByLabelText("Amount");
  await user.type(input, "1500");
  expect(onChange).not.toHaveBeenCalled();
  expect(input).toHaveValue("1500");

  await user.tab();
  expect(onChange).toHaveBeenCalledWith(parse("150000"));
  expect(input).toHaveValue("1,500");
});
