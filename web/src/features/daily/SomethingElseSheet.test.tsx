import { parse } from "@fleetsettle/shared";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SomethingElseSheet } from "./SomethingElseSheet.js";

/** `MoneyField`'s filled trigger button is only ever named by its own displayed value, never by its label — scope to the label's own wrapper to pick the right one. */
function openMoneyField(label: string) {
  const wrapper = screen.getByText(label).parentElement;
  if (!wrapper) throw new Error(`no wrapper found for label "${label}"`);
  return within(wrapper).getByRole("button");
}

test("earned and received are entered as two separate figures, not one", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(
    <SomethingElseSheet
      open
      onOpenChange={vi.fn()}
      expectedMinor={parse("500000")}
      onSave={onSave}
    />,
  );

  await user.click(openMoneyField("Earned today"));
  expect(screen.getByRole("textbox", { name: "Earned today" })).toBeInTheDocument();
  for (const d of ["4", "0", "0", "0", "0", "0"]) {
    await user.click(screen.getByRole("button", { name: d }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(openMoneyField("Received today"));
  expect(screen.getByRole("textbox", { name: "Received today" })).toBeInTheDocument();
  for (const d of ["2", "5", "0", "0", "0", "0"]) {
    await user.click(screen.getByRole("button", { name: d }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(onSave).toHaveBeenCalledWith(parse("400000"), parse("250000"));
});

test("received cannot exceed earned — Save stays disabled and an explanation shows (F-4.5 is a different flow)", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(
    <SomethingElseSheet
      open
      onOpenChange={vi.fn()}
      expectedMinor={parse("500000")}
      onSave={onSave}
    />,
  );

  await user.click(openMoneyField("Earned today"));
  for (const d of ["3", "0", "0", "0", "0", "0"]) {
    await user.click(screen.getByRole("button", { name: d }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(openMoneyField("Received today"));
  for (const d of ["4", "0", "0", "0", "0", "0"]) {
    await user.click(screen.getByRole("button", { name: d }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByText(/Received can't be more than earned/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});
