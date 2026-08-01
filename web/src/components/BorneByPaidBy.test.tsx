import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { BorneByPaidBy } from "./BorneByPaidBy.js";

const manager = { id: "m1", label: "You (the manager)" };
const driver = { id: "d1", label: "Sunil Perera" };

test("renders two independent rows — paid by and borne by never collapse into one field (W-48)", () => {
  render(
    <BorneByPaidBy
      paidBy={manager}
      paidByOptions={[manager]}
      onPaidByChange={vi.fn()}
      paidByDerivation="Defaulted to you — you're recording this expense"
      borneBy={driver}
      borneByOptions={[driver, manager]}
      onBorneByChange={vi.fn()}
      borneByDerivation="Defaulted to the driver — this vehicle is on a daily lease"
    />,
  );

  expect(screen.getByText("Paid by")).toBeInTheDocument();
  expect(screen.getByText("Borne by")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Paid by: You (the manager)" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Borne by: Sunil Perera" })).toBeInTheDocument();
  expect(screen.getByText("Defaulted to you — you're recording this expense")).toBeInTheDocument();
  expect(
    screen.getByText("Defaulted to the driver — this vehicle is on a daily lease"),
  ).toBeInTheDocument();
});
