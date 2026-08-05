import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Provisional } from "./Provisional.js";

test("renders its children with the leading-edge stripe treatment, not a full-element overlay", () => {
  render(<Provisional>Rs 1,240 (estimated)</Provisional>);
  const el = screen.getByText("Rs 1,240 (estimated)");
  expect(el).toHaveClass("before:w-1");
  expect(el).not.toHaveClass("before:inset-0");
});
