import { asBusinessDate } from "@fleetsettle/shared";
import type { DepositReleaseRow, ReleaseDepositResponse } from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { DepositReleasesScreen } from "./DepositReleasesScreen.js";

const today = asBusinessDate("2026-09-13");

const row: DepositReleaseRow = {
  depositId: "dep1",
  partyType: "customer",
  partyId: "c1",
  partyName: "Perera Tours",
  holdReleaseDate: "2026-07-01",
  heldMinor: "20000",
};

/**
 * GAP-230/F-2.7: the owner's own answer, 13 Sept 2026 — the release action
 * lives on this screen, not the party's own detail screen. The row's own
 * name/date must still open the party (unchanged from GAP-183), so both
 * targets are covered rather than only the new one.
 */
test("each row's own name/date still opens the party, unchanged", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([row]);
  const onSelectParty = vi.fn();
  renderWithProviders(
    <DepositReleasesScreen onBack={vi.fn()} onSelectParty={onSelectParty} today={today} />,
    { get },
  );

  await user.click(await screen.findByText("Perera Tours"));
  expect(onSelectParty).toHaveBeenCalledWith("customer", "c1");
});

test("the Release button opens the release sheet, not the party", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([row]);
  const onSelectParty = vi.fn();
  renderWithProviders(
    <DepositReleasesScreen onBack={vi.fn()} onSelectParty={onSelectParty} today={today} />,
    { get },
  );

  await user.click(await screen.findByRole("button", { name: "Release" }));

  expect(screen.getByText("Release this deposit")).toBeInTheDocument();
  expect(onSelectParty).not.toHaveBeenCalled();
});

test("releasing (refund) posts the expected wire body and closes the sheet", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([row]);
  const post = vi.fn<(path: string, body: unknown) => Promise<ReleaseDepositResponse>>(() =>
    Promise.resolve({ depositId: "dep1", status: "released", heldMinor: "0" }),
  );
  renderWithProviders(
    <DepositReleasesScreen onBack={vi.fn()} onSelectParty={vi.fn()} today={today} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Release" }));
  await user.click(screen.getByRole("button", { name: "Refund the deposit" }));

  expect(post).toHaveBeenCalledWith("/api/deposit/dep1/release", {
    action: "refund",
    occurredOn: today,
  });
  await waitFor(() => {
    expect(screen.queryByText("Release this deposit")).not.toBeInTheDocument();
  });
});

test("retain — the amount is required before the sheet lets it submit", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([row]);
  const post = vi.fn();
  renderWithProviders(
    <DepositReleasesScreen onBack={vi.fn()} onSelectParty={vi.fn()} today={today} />,
    { get, post },
  );

  await user.click(await screen.findByRole("button", { name: "Release" }));
  await user.click(screen.getByRole("button", { name: "Retain" }));
  await user.click(screen.getByRole("button", { name: "Retain and release the rest" }));

  expect(await screen.findByText("Amount to retain is required")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
