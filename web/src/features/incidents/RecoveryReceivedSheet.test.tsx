import { asBusinessDate, parse } from "@fleetsettle/shared";
import type { IncidentRecoveryResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { RecoveryReceivedSheet } from "./RecoveryReceivedSheet.js";

const today = asBusinessDate("2026-08-20");

const received: IncidentRecoveryResponse = {
  id: "rec1",
  incidentId: "inc1",
  source: "customer",
  agreedAmountMinor: "2000000",
  receivedAmountMinor: "2000000",
  replacesId: null,
  voidedAt: null,
  voidedReason: null,
};

test("pre-fills at the agreed amount when nothing has arrived yet, and saves it as a wire string", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(received);
  const onRecorded = vi.fn();
  renderWithProviders(
    <RecoveryReceivedSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      recoveryId="rec1"
      agreedAmountMinor={parse("2000000")}
      receivedAmountMinor={parse("0")}
      today={today}
      onRecorded={onRecorded}
    />,
    { post },
  );

  expect(screen.getByRole("button", { name: "Rs 20,000" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/incident/inc1/recovery/rec1/receive", {
      receivedAmountMinor: "2000000",
      receivedOn: today,
    }),
  );
  expect(onRecorded).toHaveBeenCalledOnce();
});

test("pre-fills at the current total-so-far when a partial amount already arrived", () => {
  renderWithProviders(
    <RecoveryReceivedSheet
      open
      onOpenChange={() => {}}
      incidentId="inc1"
      recoveryId="rec1"
      agreedAmountMinor={parse("2000000")}
      receivedAmountMinor={parse("500000")}
      today={today}
      onRecorded={() => {}}
    />,
    { post: vi.fn() },
  );

  expect(screen.getByRole("button", { name: "Rs 5,000" })).toBeInTheDocument();
});
