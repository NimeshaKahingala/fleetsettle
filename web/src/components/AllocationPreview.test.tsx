import { parse } from "@fleetsettle/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AllocationPreview } from "./AllocationPreview.js";

const lines = [
  { key: "1", dateLabel: "Tue 14 Jul", amountMinor: parse("500000") },
  { key: "2", dateLabel: "Wed 15 Jul", amountMinor: parse("500000") },
];

test("renders the header, every line oldest-first as given, and each marked settled", () => {
  render(
    <AllocationPreview
      totalMinor={parse("1000000")}
      partyLabel="Sunil"
      lines={lines}
      onChangeAllocation={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );

  expect(screen.getByText(/Received/)).toHaveTextContent("Received Rs 10,000 from Sunil");
  expect(screen.getByText("Tue 14 Jul")).toBeInTheDocument();
  expect(screen.getByText("Wed 15 Jul")).toBeInTheDocument();
  expect(screen.getAllByText("settled")).toHaveLength(2);
});

test("nothing left when the total exactly covers every line", () => {
  render(
    <AllocationPreview
      totalMinor={parse("1000000")}
      partyLabel="Sunil"
      lines={lines}
      onChangeAllocation={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/nothing left/)).toBeInTheDocument();
});

test("a surplus is shown as held as credit, never an unexplained overpayment", () => {
  render(
    <AllocationPreview
      totalMinor={parse("1200000")}
      partyLabel="Sunil"
      lines={lines}
      onChangeAllocation={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/held as credit/)).toBeInTheDocument();
  expect(screen.getByText("Rs 2,000")).toBeInTheDocument();
});

test("Change allocation and Confirm fire their own callbacks", async () => {
  const user = userEvent.setup();
  const onChangeAllocation = vi.fn();
  const onConfirm = vi.fn();
  render(
    <AllocationPreview
      totalMinor={parse("1000000")}
      partyLabel="Sunil"
      lines={lines}
      onChangeAllocation={onChangeAllocation}
      onConfirm={onConfirm}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Change allocation" }));
  expect(onChangeAllocation).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Confirm" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
