import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
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
