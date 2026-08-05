import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ReasonPicker } from "./ReasonPicker.js";

test("selecting a reason closes the sheet and reports the reason (never includes On charter for a lost day)", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const onSelect = vi.fn();

  render(
    <ReasonPicker
      open
      onOpenChange={onOpenChange}
      title="Why didn't it run?"
      reasons={[
        { key: "breakdown", label: "Breakdown" },
        { key: "driver_unavailable", label: "Driver unavailable" },
        { key: "other", label: "Other" },
      ]}
      onSelect={onSelect}
    />,
  );

  expect(screen.queryByText("On charter")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Driver unavailable" }));
  expect(onSelect).toHaveBeenCalledWith({ key: "driver_unavailable", label: "Driver unavailable" });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
