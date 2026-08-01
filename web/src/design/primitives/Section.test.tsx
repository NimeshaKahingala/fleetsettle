import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Section } from "./Section.js";

const days = ["Tue 14 Jul", "Wed 15 Jul", "Thu 16 Jul", "Fri 17 Jul", "Sat 18 Jul"].map((d) => (
  <p key={d}>{d}</p>
));

test("shows the heading with its count, and collapses to 3 rows with Show all (§3.2)", () => {
  render(<Section title="Earlier days" count={5} items={days} />);

  expect(screen.getByText("Earlier days · 5")).toBeInTheDocument();
  expect(screen.getByText("Tue 14 Jul")).toBeInTheDocument();
  expect(screen.getByText("Thu 16 Jul")).toBeInTheDocument();
  expect(screen.queryByText("Fri 17 Jul")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show all (5)" })).toBeInTheDocument();
});

test("Show all reveals every row and removes the button", async () => {
  const user = userEvent.setup();
  render(<Section title="Earlier days" count={5} items={days} />);

  await user.click(screen.getByRole("button", { name: "Show all (5)" }));

  expect(screen.getByText("Fri 17 Jul")).toBeInTheDocument();
  expect(screen.getByText("Sat 18 Jul")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
});

test("no Show all button when everything already fits", () => {
  render(<Section title="Trips in progress" count={2} items={days.slice(0, 2)} />);
  expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
});
