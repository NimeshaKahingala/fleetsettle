import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Input } from "./Input.js";
import { Label } from "./Label.js";

test("associates with its control so the label is always visible, never a placeholder (§6.3)", () => {
  render(
    <>
      <Label htmlFor="reg">Registration</Label>
      <Input id="reg" />
    </>,
  );
  expect(screen.getByLabelText("Registration")).toBeInTheDocument();
});
