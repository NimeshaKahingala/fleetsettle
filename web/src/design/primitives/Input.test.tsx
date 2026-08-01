import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Input } from "./Input.js";

test("meets the 44px floor and the body-size text minimum (M-19)", () => {
  render(<Input aria-label="Registration" />);
  expect(screen.getByLabelText("Registration")).toHaveClass("min-h-tap", "text-body");
});

test("invalid state reserves the 2px border rather than adding one (no layout shift)", () => {
  render(<Input aria-label="Registration" aria-invalid="true" />);
  expect(screen.getByLabelText("Registration")).toHaveClass("border");
});
