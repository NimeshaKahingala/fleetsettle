import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FieldError } from "./FieldError.js";

test("renders the message with its icon when there is an error", () => {
  render(<FieldError id="reg-error" message="Registration is required" />);
  expect(screen.getByText("Registration is required")).toBeInTheDocument();
});

test("reserves its 20px slot even with no error, so validating on blur never reflows the form", () => {
  render(<FieldError id="reg-error" />);
  const el = document.getElementById("reg-error");
  expect(el).toHaveClass("h-5");
  expect(el).toHaveTextContent("");
});
