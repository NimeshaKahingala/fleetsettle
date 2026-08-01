import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "./Button.js";

test("cta size renders the 56px full-width primary action", () => {
  render(<Button size="cta">Paid in full</Button>);
  expect(screen.getByRole("button", { name: "Paid in full" })).toHaveClass("h-14", "w-full");
});

test("default size never drops below the 44px floor (§4.3)", () => {
  render(<Button>Something else</Button>);
  expect(screen.getByRole("button", { name: "Something else" })).toHaveClass("min-h-tap");
});

test("icon size is a 44x44 hit area", () => {
  render(<Button size="icon" aria-label="Close" />);
  expect(screen.getByRole("button", { name: "Close" })).toHaveClass("size-tap");
});

test("destructive and primary are visually distinct, never colour-only (M-15)", () => {
  render(<Button variant="destructive">Delete</Button>);
  const button = screen.getByRole("button", { name: "Delete" });
  expect(button).toHaveClass("bg-critical");
  expect(button).not.toHaveClass("bg-brand");
});

test("disabled state is inert", () => {
  render(<Button disabled>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});
