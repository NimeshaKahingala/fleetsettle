import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Disclosure } from "./Disclosure.js";

test('labelled "More" on first use, then the section name once opened (U-2/M-6)', async () => {
  const user = userEvent.setup();
  render(
    <Disclosure sectionName="Mileage allowance">
      <p>Daily limit</p>
    </Disclosure>,
  );

  const toggle = screen.getByRole("button", { name: "More" });
  expect(screen.queryByText("Daily limit")).not.toBeInTheDocument();

  await user.click(toggle);
  expect(screen.getByRole("button", { name: "Mileage allowance" })).toBeInTheDocument();
  expect(screen.getByText("Daily limit")).toBeInTheDocument();
});

test("stays open once opened, rather than collapsing again on its own", async () => {
  const user = userEvent.setup();
  render(
    <Disclosure sectionName="Mileage allowance">
      <p>Daily limit</p>
    </Disclosure>,
  );
  await user.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByText("Daily limit")).toBeInTheDocument();
  // Nothing else re-collapses it; only another explicit click would.
  expect(screen.getByRole("button", { name: "Mileage allowance" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
