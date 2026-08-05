import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Card } from "./Card.js";

test("is a hairline surface by default, with no shadow", () => {
  render(<Card data-testid="card">Bus · Tue 30 Jul</Card>);
  const card = screen.getByTestId("card");
  expect(card).toHaveClass("border-line-hairline", "bg-surface");
  expect(card).not.toHaveClass("shadow-md");
});

test("elevated is the exception, reserved for the day card", () => {
  render(
    <Card data-testid="card" elevated>
      Bus · Tue 30 Jul
    </Card>,
  );
  expect(screen.getByTestId("card")).toHaveClass("shadow-md");
});
