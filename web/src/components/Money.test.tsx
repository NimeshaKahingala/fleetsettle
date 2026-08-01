import { parse } from "@fleetsettle/shared";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Money } from "./Money.js";

test("groups thousands, suppresses cents when they are zero (M-16)", () => {
  render(<Money value={parse("500000")} />);
  expect(screen.getByText("Rs 5,000")).toBeInTheDocument();
});

test("shows cents when they are non-zero", () => {
  render(<Money value={parse("500050")} />);
  expect(screen.getByText("Rs 5,000.50")).toBeInTheDocument();
});

test("is tabular so a column of amounts aligns (§5.2)", () => {
  render(<Money value={parse("100")} />);
  expect(screen.getByText("Rs 1")).toHaveClass("tabular-nums");
});
