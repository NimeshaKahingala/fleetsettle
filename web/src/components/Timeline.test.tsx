import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Timeline } from "./Timeline.js";

test("renders every entry's who/when/what", () => {
  render(
    <Timeline
      entries={[
        { key: "1", who: "Nimesha", whenLabel: "30 Jul", description: "Received Rs 5,000" },
      ]}
    />,
  );
  expect(screen.getByText("Received Rs 5,000")).toBeInTheDocument();
  expect(screen.getByText("Nimesha · 30 Jul")).toBeInTheDocument();
});

test("a voided entry stays visible, struck through, with its replacement linked beneath rather than hidden (W-50)", () => {
  render(
    <Timeline
      entries={[
        {
          key: "1",
          who: "Nimesha",
          whenLabel: "30 Jul",
          description: "Received Rs 5,000",
          replacedByLabel: "Correction #2: Received Rs 4,500",
        },
      ]}
    />,
  );

  const original = screen.getByText("Received Rs 5,000");
  expect(original).toHaveClass("line-through");
  expect(screen.getByText(/replaced by: Correction #2: Received Rs 4,500/)).toBeInTheDocument();
});

test("an entry with onClick renders as a button; one without stays a plain row (Web-P6b)", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(
    <Timeline
      entries={[
        { key: "1", who: "Acme", whenLabel: "1 Jan", description: "Lease out", onClick },
        { key: "2", who: "Sunil", whenLabel: "1 Jun", description: "Daily lease" },
      ]}
    />,
  );

  await user.click(screen.getByText("Lease out"));
  expect(onClick).toHaveBeenCalledOnce();
  expect(screen.getByText("Daily lease").closest("button")).toBeNull();
});
