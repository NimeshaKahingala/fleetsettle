import { asBusinessDate } from "@fleetsettle/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DateField } from "./DateField.js";

const today = asBusinessDate("2026-07-30");

test("shows the weekday, not a bare date — checkable, not ambiguous (M-17)", () => {
  render(<DateField label="Date" value={today} onChange={vi.fn()} today={today} />);
  expect(screen.getByRole("button", { name: "Thu 30 Jul" })).toBeInTheDocument();
});

test("Today and Yesterday chips report the right business dates, injected rather than device-clock-derived", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<DateField label="Date" value={today} onChange={onChange} today={today} />);

  await user.click(screen.getByRole("button", { name: "Yesterday" }));
  expect(onChange).toHaveBeenCalledWith("2026-07-29");

  await user.click(screen.getByRole("button", { name: "Today" }));
  expect(onChange).toHaveBeenCalledWith("2026-07-30");
});

test("Today is pressed when the value is today's date", () => {
  render(<DateField label="Date" value={today} onChange={vi.fn()} today={today} />);
  expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Yesterday" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
