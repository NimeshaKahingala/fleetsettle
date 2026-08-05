import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Checkbox } from "./Checkbox.js";

test("toggles and reports its checked state", async () => {
  const user = userEvent.setup();
  const onCheckedChange = vi.fn();
  render(
    <Checkbox aria-label="Make this the new daily amount" onCheckedChange={onCheckedChange} />,
  );

  const box = screen.getByRole("checkbox", { name: "Make this the new daily amount" });
  expect(box).toHaveAttribute("data-state", "unchecked");

  await user.click(box);
  expect(onCheckedChange).toHaveBeenCalledWith(true);
});
