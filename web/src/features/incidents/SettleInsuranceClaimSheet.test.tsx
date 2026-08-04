import { asBusinessDate, parse } from "@fleetsettle/shared";
import type { SettledInsuranceClaimResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { SettleInsuranceClaimSheet } from "./SettleInsuranceClaimSheet.js";

const today = asBusinessDate("2026-09-15");

const settled: SettledInsuranceClaimResponse = {
  claim: {
    id: "claim1",
    incidentId: "inc1",
    claimedAmountMinor: "7500000",
    excessBorneMinor: "1500000",
    status: "settled",
    receivedAmountMinor: "6000000",
    receivedOn: "2026-09-15",
  },
};

test("recoverable (claimed minus excess) pre-fills the amount when nothing has arrived yet", () => {
  renderWithProviders(
    <SettleInsuranceClaimSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      claimId="claim1"
      claimedAmountMinor={parse("7500000")}
      excessBorneMinor={parse("1500000")}
      receivedAmountMinor={null}
      today={today}
      onSettled={() => {}}
    />,
    { post: vi.fn() },
  );

  expect(screen.getByText("Recoverable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rs 60,000" })).toBeInTheDocument();
});

test("defaults to 'Settled' and saves the recoverable amount as a wire string", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(settled);
  const onSettled = vi.fn();
  renderWithProviders(
    <SettleInsuranceClaimSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      claimId="claim1"
      claimedAmountMinor={parse("7500000")}
      excessBorneMinor={parse("1500000")}
      receivedAmountMinor={null}
      today={today}
      onSettled={onSettled}
    />,
    { post },
  );

  expect(screen.getByRole("button", { name: "Settled" })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident/inc1/insurance-claim/claim1/settle", {
      receivedAmountMinor: "6000000",
      receivedOn: today,
      status: "settled",
    }),
  );
  expect(onSettled).toHaveBeenCalledOnce();
});

test("choosing 'Rejected' passes status: rejected", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(settled);
  renderWithProviders(
    <SettleInsuranceClaimSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      claimId="claim1"
      claimedAmountMinor={parse("7500000")}
      excessBorneMinor={parse("1500000")}
      receivedAmountMinor={null}
      today={today}
      onSettled={() => {}}
    />,
    { post },
  );

  await user.click(screen.getByRole("button", { name: "Rejected" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/incident/inc1/insurance-claim/claim1/settle",
      expect.objectContaining({ status: "rejected" }),
    ),
  );
});
