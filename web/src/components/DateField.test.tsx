import { asBusinessDate } from "@fleetsettle/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DateField } from "./DateField.js";

const today = asBusinessDate("2026-07-30");

test("shows the weekday, not a bare date — checkable, not ambiguous (M-17)", () => {
  render(<DateField label="Date" value={today} onChange={vi.fn()} today={today} />);
  expect(screen.getByText("Thu 30 Jul")).toBeInTheDocument();
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

test("GAP-83/GAP-105: renders exactly one focusable date control — no separate hidden Tab stop", () => {
  const { container } = render(
    <DateField label="Date" value={today} onChange={vi.fn()} today={today} />,
  );
  // Today/Yesterday are two more focusable buttons by design (M-17) — the
  // regression this guards is the *date control itself* no longer being
  // one visible button plus one invisible-but-focusable native input.
  expect(container.querySelectorAll('input[type="date"]')).toHaveLength(1);
  expect(container.querySelectorAll("button")).toHaveLength(2);
});

test("GAP-83: the date control's accessible name says it opens a date picker, and includes the shown weekday", () => {
  render(<DateField label="Date" value={today} onChange={vi.fn()} today={today} />);
  expect(screen.getByLabelText("Date: Thu 30 Jul, opens a date picker")).toBeInTheDocument();
});

test("GAP-105: showShortcuts defaults to true (M-17), and is opt-out for report/range fields", () => {
  const { rerender } = render(
    <DateField label="From" value={today} onChange={vi.fn()} today={today} />,
  );
  expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();

  rerender(
    <DateField label="From" value={today} onChange={vi.fn()} today={today} showShortcuts={false} />,
  );
  expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Yesterday" })).not.toBeInTheDocument();
});

test("GAP-105: a From/To range renders two date controls total, not six, once shortcuts are off", () => {
  const { container } = render(
    <div className="flex gap-3">
      <DateField
        label="From"
        value={today}
        onChange={vi.fn()}
        today={today}
        showShortcuts={false}
      />
      <DateField label="To" value={today} onChange={vi.fn()} today={today} showShortcuts={false} />
    </div>,
  );
  expect(container.querySelectorAll('input[type="date"]')).toHaveLength(2);
  expect(container.querySelectorAll("button")).toHaveLength(0);
});

test("GAP-105: a browser without showPicker() still lets the real input take a new date directly", () => {
  // jsdom does not implement showPicker at all — this environment already
  // is the "unavailable" branch MP-06 asked about, not a simulation of it.
  expect("showPicker" in window.HTMLInputElement.prototype).toBe(false);

  const onChange = vi.fn();
  render(<DateField label="Date" value={today} onChange={onChange} today={today} />);

  const dateInput = screen.getByLabelText("Date: Thu 30 Jul, opens a date picker");
  expect(() => fireEvent.click(dateInput)).not.toThrow();

  // Simulates the OS calendar's own picker committing a new value directly
  // to the real input — the fallback path GAP-105 needs when showPicker()
  // isn't available, exercised here with no call to it at all.
  fireEvent.change(dateInput, { target: { value: "2026-08-01" } });
  expect(onChange).toHaveBeenCalledWith("2026-08-01");
});
