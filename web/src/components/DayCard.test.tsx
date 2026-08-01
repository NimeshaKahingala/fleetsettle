import { parse } from "@fleetsettle/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DayCard } from "./DayCard.js";

function renderDayCard(overrides: Partial<React.ComponentProps<typeof DayCard>> = {}) {
  const onPaidInFull = vi.fn();
  const onSomethingElse = vi.fn();
  const onDidntRun = vi.fn();
  render(
    <DayCard
      vehicleLabel="Bus"
      dateLabel="Tue 30 Jul"
      expectedFromLabel="Expected from Sunil"
      amountMinor={parse("500000")}
      onPaidInFull={onPaidInFull}
      onSomethingElse={onSomethingElse}
      onDidntRun={onDidntRun}
      {...overrides}
    />,
  );
  return { onPaidInFull, onSomethingElse, onDidntRun };
}

test("renders the vehicle, date, expected party and the amount as the hero figure", () => {
  renderDayCard();
  expect(screen.getByText("Bus · Tue 30 Jul")).toBeInTheDocument();
  expect(screen.getByText("Expected from Sunil")).toBeInTheDocument();
  expect(screen.getByText("Rs 5,000")).toHaveClass("text-hero");
});

test("one card, three buttons, no navigation — each fires its own callback", async () => {
  const user = userEvent.setup();
  const { onPaidInFull, onSomethingElse, onDidntRun } = renderDayCard();

  await user.click(screen.getByRole("button", { name: "Paid in full" }));
  expect(onPaidInFull).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Something else" }));
  expect(onSomethingElse).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Didn't run" }));
  expect(onDidntRun).toHaveBeenCalledOnce();
});

test("Paid in full is the 56px primary CTA; the other two are 44px outline", () => {
  renderDayCard();
  expect(screen.getByRole("button", { name: "Paid in full" })).toHaveClass("h-14");
  expect(screen.getByRole("button", { name: "Something else" })).toHaveClass("min-h-tap");
  expect(screen.getByRole("button", { name: "Didn't run" })).toHaveClass("min-h-tap");
});
