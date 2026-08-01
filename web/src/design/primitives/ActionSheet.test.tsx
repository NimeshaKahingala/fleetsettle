import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fuel, Plus, Users } from "lucide-react";
import { expect, test, vi } from "vitest";
import { ActionSheet } from "./ActionSheet.js";

test("renders every action in the given order and selecting one closes the sheet and fires onSelect", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const onSelectFuel = vi.fn();
  const onSelectPeople = vi.fn();

  render(
    <ActionSheet
      open
      onOpenChange={onOpenChange}
      title="Add"
      actions={[
        { key: "fuel", label: "Log a fuel fill", icon: Fuel, onSelect: onSelectFuel },
        { key: "people", label: "Add a driver", icon: Users, onSelect: onSelectPeople },
        { key: "trip", label: "Book a trip", icon: Plus, onSelect: vi.fn() },
      ]}
    />,
  );

  const buttons = screen
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-label") !== "Close");
  expect(buttons.map((b) => b.textContent)).toEqual([
    "Log a fuel fill",
    "Add a driver",
    "Book a trip",
  ]);

  await user.click(screen.getByRole("button", { name: "Add a driver" }));
  expect(onSelectPeople).toHaveBeenCalledOnce();
  expect(onSelectFuel).not.toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
