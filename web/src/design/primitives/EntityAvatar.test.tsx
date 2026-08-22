import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { EntityAvatar } from "./EntityAvatar.js";

test("initials: two-plus words use the first letter of the first two", () => {
  render(<EntityAvatar kind="driver" name="Sunil Perera" />);
  expect(screen.getByText("SP")).toBeInTheDocument();
});

test("initials: a single word uses its own first two characters", () => {
  render(<EntityAvatar kind="driver" name="Kasun" />);
  expect(screen.getByText("KA")).toBeInTheDocument();
});

// §5B.9: driver.name is schema-valid down to a single character.
test("initials: a single-character name renders that character alone, never an empty chip", () => {
  render(<EntityAvatar kind="driver" name="K" />);
  expect(screen.getByText("K")).toBeInTheDocument();
});

test("initials are case-normalised regardless of input casing", () => {
  render(<EntityAvatar kind="driver" name="sunil perera" />);
  expect(screen.getByText("SP")).toBeInTheDocument();
});

test("customer person gets initials, same as a driver", () => {
  render(<EntityAvatar kind="customer" customerType="person" name="Nimal Silva" />);
  expect(screen.getByText("NS")).toBeInTheDocument();
});

test("customer organisation gets an icon, never initials", () => {
  render(<EntityAvatar kind="customer" customerType="organisation" name="Ceylon Logistics" />);
  expect(screen.queryByText("CL")).not.toBeInTheDocument();
});

test("vehicle and driver chips are brand-tone; customer chips are neutral", () => {
  const { container: vehicle } = render(<EntityAvatar kind="vehicle" vehicleType="Bus" />);
  expect(vehicle.firstChild).toHaveClass("bg-brand", "text-white");

  const { container: driver } = render(<EntityAvatar kind="driver" name="Sunil Perera" />);
  expect(driver.firstChild).toHaveClass("bg-brand", "text-white");

  const { container: customer } = render(
    <EntityAvatar kind="customer" customerType="person" name="Nimal Silva" />,
  );
  expect(customer.firstChild).toHaveClass("bg-surface-sunken", "text-ink-primary");
});

// F-1.1/GAP-150: reads carry vehicleType as an open string, and QA already
// has legacy spellings outside "Bus" | "Car" | "Van".
test("an unrecognised vehicle type falls back to the generic glyph rather than crashing", () => {
  const { container } = render(<EntityAvatar kind="vehicle" vehicleType="Lorry" />);
  expect(container.querySelector("svg")).toBeInTheDocument();
});

test("size defaults to list (36px) and detail is explicitly larger", () => {
  const { container: list } = render(<EntityAvatar kind="driver" name="Sunil Perera" />);
  expect(list.firstChild).toHaveClass("size-9");

  const { container: detail } = render(
    <EntityAvatar kind="driver" name="Sunil Perera" size="detail" />,
  );
  expect(detail.firstChild).toHaveClass("size-12");
});

test("is always decorative — the caller's own text carries the accessible name", () => {
  const { container } = render(<EntityAvatar kind="vehicle" vehicleType="Car" />);
  expect(container.firstChild).toHaveAttribute("aria-hidden");
});
