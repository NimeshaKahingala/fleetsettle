import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TriangleAlert } from "lucide-react";
import { expect, test, vi } from "vitest";
import { AlertStrip } from "./AlertStrip.js";

test("renders the icon, the text and fires its one action", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(
    <AlertStrip
      severity="warning"
      icon={TriangleAlert}
      action={{ label: "View vehicle", onClick: onAction }}
    >
      Insurance expires in 5 days
    </AlertStrip>,
  );

  expect(screen.getByText("Insurance expires in 5 days")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "View vehicle" }));
  expect(onAction).toHaveBeenCalledOnce();
});

test("critical severity renders without crashing and without an action when none is given", () => {
  render(
    <AlertStrip severity="critical" icon={TriangleAlert}>
      Insurance expired 3 days ago
    </AlertStrip>,
  );

  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
