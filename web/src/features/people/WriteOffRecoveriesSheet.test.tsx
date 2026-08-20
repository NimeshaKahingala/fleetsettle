import type { ListWriteOffRecoveriesResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { WriteOffRecoveriesSheet } from "./WriteOffRecoveriesSheet.js";

const recoveries: ListWriteOffRecoveriesResponse = [
  {
    id: "r1",
    writeOffId: "wo1",
    paymentId: "p1",
    amountMinor: "15000",
    occurredOn: "2026-08-10",
    voidedAt: null,
    voidedReason: null,
    replacesId: null,
  },
];

test("lists recoveries against a write-off, newest first", async () => {
  const get = vi.fn().mockResolvedValue(recoveries);
  renderWithProviders(
    <WriteOffRecoveriesSheet
      open
      onOpenChange={vi.fn()}
      writeOffId="wo1"
      party={{ type: "customer", id: "c1" }}
    />,
    { get },
  );

  expect(await screen.findByText("Rs 150")).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/write-off/wo1/recovery");
});

test("an empty list says so rather than showing nothing", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(
    <WriteOffRecoveriesSheet
      open
      onOpenChange={vi.fn()}
      writeOffId="wo1"
      party={{ type: "customer", id: "c1" }}
    />,
    { get },
  );

  expect(await screen.findByText("No recoveries recorded yet.")).toBeInTheDocument();
});

test("a failed read shows a scoped failure", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <WriteOffRecoveriesSheet
      open
      onOpenChange={vi.fn()}
      writeOffId="wo1"
      party={{ type: "customer", id: "c1" }}
    />,
    { get },
  );

  expect(
    await screen.findByText("Something went wrong loading recoveries against this write-off."),
  ).toBeInTheDocument();
});

test("voids a recovery, then returns to the list", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(recoveries);
  const post = vi.fn().mockResolvedValue({ voidedAt: "2026-08-20T00:00:00.000Z" });
  renderWithProviders(
    <WriteOffRecoveriesSheet
      open
      onOpenChange={vi.fn()}
      writeOffId="wo1"
      party={{ type: "customer", id: "c1" }}
    />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Void recovery" }));
  await user.type(screen.getByLabelText("Reason"), "Entered against the wrong write-off");
  const submitButtons = screen.getAllByRole("button", { name: "Void recovery" });
  const submit = submitButtons.at(-1);
  if (submit === undefined) throw new Error("expected void submit button");
  await user.click(submit);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/write-off/wo1/recovery/r1/void", {
      reason: "Entered against the wrong write-off",
    }),
  );
});

test("Back to recoveries returns to the list without submitting", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(recoveries);
  const post = vi.fn();
  renderWithProviders(
    <WriteOffRecoveriesSheet
      open
      onOpenChange={vi.fn()}
      writeOffId="wo1"
      party={{ type: "customer", id: "c1" }}
    />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Void recovery" }));
  await user.click(screen.getByRole("button", { name: "Back to recoveries" }));

  expect(await screen.findByText("Rs 150")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
