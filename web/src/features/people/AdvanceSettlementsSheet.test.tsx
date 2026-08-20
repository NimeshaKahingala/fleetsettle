import type { ListAdvanceSettlementsResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { AdvanceSettlementsSheet } from "./AdvanceSettlementsSheet.js";

const settlements: ListAdvanceSettlementsResponse = [
  {
    id: "s1",
    advanceId: "a1",
    kind: "spent",
    amountMinor: "30000",
    occurredOn: "2026-08-10",
    voidedAt: null,
    voidedReason: null,
    replacesId: null,
  },
];

test("lists settlements against an advance", async () => {
  const get = vi.fn().mockResolvedValue(settlements);
  renderWithProviders(
    <AdvanceSettlementsSheet open onOpenChange={vi.fn()} driverId="d1" advanceId="a1" />,
    { get },
  );

  expect(await screen.findByText("Spent")).toBeInTheDocument();
  expect(screen.getByText("Rs 300")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/advance/a1/settlement");
});

test("an empty list says so rather than showing nothing", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(
    <AdvanceSettlementsSheet open onOpenChange={vi.fn()} driverId="d1" advanceId="a1" />,
    { get },
  );

  expect(await screen.findByText("No settlements recorded yet.")).toBeInTheDocument();
});

test("a failed read shows a scoped failure", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <AdvanceSettlementsSheet open onOpenChange={vi.fn()} driverId="d1" advanceId="a1" />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading settlements against this advance."),
  ).toBeInTheDocument();
});

test("voids a settlement, then returns to the list", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(settlements);
  const post = vi.fn().mockResolvedValue({ voidedAt: "2026-08-20T00:00:00.000Z" });
  renderWithProviders(
    <AdvanceSettlementsSheet open onOpenChange={vi.fn()} driverId="d1" advanceId="a1" />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Void settlement" }));
  await user.type(screen.getByLabelText("Reason"), "Entered against the wrong advance");
  const submitButtons = screen.getAllByRole("button", { name: "Void settlement" });
  const submit = submitButtons.at(-1);
  if (submit === undefined) throw new Error("expected void submit button");
  await user.click(submit);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/advance/a1/settlement/s1/void", {
      reason: "Entered against the wrong advance",
    }),
  );
});

test("Back to settlements returns to the list without submitting", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(settlements);
  const post = vi.fn();
  renderWithProviders(
    <AdvanceSettlementsSheet open onOpenChange={vi.fn()} driverId="d1" advanceId="a1" />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Void settlement" }));
  await user.click(screen.getByRole("button", { name: "Back to settlements" }));

  expect(await screen.findByText("Spent")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
