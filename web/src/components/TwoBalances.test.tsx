import { parse } from "@fleetsettle/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TwoBalances } from "./TwoBalances.js";

test("renders both balances with their own detail line, never netted into one figure", () => {
  render(
    <TwoBalances
      driverName="Sunil Perera"
      owedToYouMinor={parse("800000")}
      owedToYouDetail="6 short days, oldest 14 Jul"
      owedByYouMinor={parse("1200000")}
      owedByYouDetail="Trip #21 fee, unpaid"
      onOffset={vi.fn()}
    />,
  );

  expect(screen.getByText("He owes you")).toBeInTheDocument();
  expect(screen.getByText("Rs 8,000")).toBeInTheDocument();
  expect(screen.getByText("6 short days, oldest 14 Jul")).toBeInTheDocument();

  expect(screen.getByText("You owe him")).toBeInTheDocument();
  expect(screen.getByText("Rs 12,000")).toBeInTheDocument();
  expect(screen.getByText("Trip #21 fee, unpaid")).toBeInTheDocument();
});

test("the net line is never a signed number (W-2) — a sentence plus an unsigned amount", () => {
  render(
    <TwoBalances
      driverName="Sunil Perera"
      owedToYouMinor={parse("800000")}
      owedToYouDetail="6 short days"
      owedByYouMinor={parse("1200000")}
      owedByYouDetail="Trip #21 fee, unpaid"
      onOffset={vi.fn()}
    />,
  );

  expect(screen.getByText("Net: you owe him")).toBeInTheDocument();
  expect(screen.getByText("Rs 4,000")).toBeInTheDocument();
  expect(screen.queryByText(/−|-4,000/)).not.toBeInTheDocument();
});

test("reverses direction correctly when he owes you overall", () => {
  render(
    <TwoBalances
      driverName="Sunil Perera"
      owedToYouMinor={parse("2000000")}
      owedToYouDetail="6 short days"
      owedByYouMinor={parse("500000")}
      owedByYouDetail="Trip fee"
      onOffset={vi.fn()}
    />,
  );
  expect(screen.getByText("Net: he owes you")).toBeInTheDocument();
});

test("settled shows no amount on the net line", () => {
  render(
    <TwoBalances
      driverName="Sunil Perera"
      owedToYouMinor={parse("500000")}
      owedToYouDetail="—"
      owedByYouMinor={parse("500000")}
      owedByYouDetail="—"
      onOffset={vi.fn()}
    />,
  );
  expect(screen.getByText("Net: settled")).toBeInTheDocument();
});

test("GAP-78: omitting driverName renders no heading — for a caller whose own screen title already names the driver", () => {
  render(
    <TwoBalances
      owedToYouMinor={parse("800000")}
      owedToYouDetail="—"
      owedByYouMinor={parse("1200000")}
      owedByYouDetail="—"
      onOffset={vi.fn()}
    />,
  );

  expect(screen.queryByText("Sunil Perera")).toBeNull();
  expect(screen.queryByRole("heading")).toBeNull();
});

test("Offset is the only action, and is explicit", async () => {
  const user = userEvent.setup();
  const onOffset = vi.fn();
  render(
    <TwoBalances
      driverName="Sunil Perera"
      owedToYouMinor={parse("800000")}
      owedToYouDetail="—"
      owedByYouMinor={parse("1200000")}
      owedByYouDetail="—"
      onOffset={onOffset}
    />,
  );

  expect(screen.getAllByRole("button")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Offset…" }));
  expect(onOffset).toHaveBeenCalledOnce();
});

test("omitting Offset keeps read-only shells free of write affordances", () => {
  render(
    <TwoBalances
      driverName="Sunil Perera"
      owedToYouMinor={parse("800000")}
      owedToYouDetail="—"
      owedByYouMinor={parse("1200000")}
      owedByYouDetail="—"
    />,
  );

  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
