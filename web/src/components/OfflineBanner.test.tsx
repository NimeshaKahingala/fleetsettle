import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { OfflineBanner } from "./OfflineBanner.js";

test("reads Working offline alone when the queue is empty", () => {
  render(<OfflineBanner />);
  expect(screen.getByRole("status")).toHaveTextContent("Working offline");
});

test("reads the queue count when non-empty", () => {
  render(<OfflineBanner queueCount={3} />);
  expect(screen.getByRole("status")).toHaveTextContent("Working offline · 3 waiting");
});

test("is not dismissible — no close button", () => {
  render(<OfflineBanner queueCount={3} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("is 32px (h-8)", () => {
  render(<OfflineBanner />);
  expect(screen.getByRole("status")).toHaveClass("h-8");
});
