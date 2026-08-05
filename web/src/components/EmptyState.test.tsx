import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EmptyState } from "./EmptyState.js";

test("renders the message and no button when there is no action", () => {
  render(<EmptyState message="Nothing needs you today" />);

  expect(screen.getByText("Nothing needs you today")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("renders the one action when given, and fires it", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(
    <EmptyState message="No vehicles yet" action={{ label: "Add a vehicle", onClick: onAction }} />,
  );

  await user.click(screen.getByRole("button", { name: "Add a vehicle" }));
  expect(onAction).toHaveBeenCalledOnce();
});
