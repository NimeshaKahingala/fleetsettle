import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Badge } from "./Badge.js";

test("renders each semantic variant with its own tokens", () => {
  const variants = ["brand", "good", "warning", "serious", "critical", "neutral"] as const;
  for (const variant of variants) {
    render(<Badge variant={variant}>{variant}</Badge>);
    expect(screen.getByText(variant)).toBeInTheDocument();
  }
});

test("defaults to neutral when no variant is given", () => {
  render(<Badge data-testid="badge">Draft</Badge>);
  expect(screen.getByTestId("badge")).toHaveClass("border-line-hairline", "text-ink-muted");
});

test("carries the label as real text, never colour alone", () => {
  render(<Badge variant="critical">Voided</Badge>);
  expect(screen.getByText("Voided")).toBeInTheDocument();
});
