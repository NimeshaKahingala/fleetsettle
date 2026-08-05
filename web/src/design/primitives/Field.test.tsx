import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { fieldErrorId } from "../../lib/fieldErrorId.js";
import { Field } from "./Field.js";
import { Input } from "./Input.js";

test("required fields are never asterisked; optional ones are marked in words", () => {
  render(
    <Field label="Registration" htmlFor="reg">
      <Input id="reg" />
    </Field>,
  );
  expect(screen.getByText("Registration")).toBeInTheDocument();
  expect(screen.queryByText("*")).not.toBeInTheDocument();

  render(
    <Field label="Notes" htmlFor="notes" optional>
      <Input id="notes" />
    </Field>,
  );
  expect(screen.getByText("(optional)")).toBeInTheDocument();
});

test("wires the FieldError slot at a deterministic id a control can reference", () => {
  render(
    <Field label="Registration" htmlFor="reg" error="Registration is required">
      <Input id="reg" aria-invalid="true" aria-describedby={fieldErrorId("reg")} />
    </Field>,
  );
  const error = document.getElementById(fieldErrorId("reg"));
  expect(error).toHaveTextContent("Registration is required");
  expect(screen.getByLabelText("Registration")).toHaveAttribute("aria-describedby", "reg-error");
});
