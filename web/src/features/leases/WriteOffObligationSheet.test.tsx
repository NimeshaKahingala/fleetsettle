import { asBusinessDate, parse } from "@fleetsettle/shared";
import type { LeaseObligationRow, WriteOffResponse } from "@fleetsettle/shared/schemas";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { WriteOffObligationSheet } from "./WriteOffObligationSheet.js";

const today = asBusinessDate("2026-08-20");

const due: LeaseObligationRow = {
  id: "o1",
  kind: "rent",
  dueOn: "2026-01-12",
  effectiveDueOn: "2026-01-12",
  amountMinor: "7000000",
  settledMinor: "1000000",
  waivedMinor: "0",
  writtenOffMinor: "0",
  status: "part_paid",
};

const writtenOff: WriteOffResponse = {
  id: "11111111-1111-1111-1111-111111111111",
  obligationId: "o1",
  partyType: "customer",
  partyCustomerId: "c1",
  partyDriverId: null,
  vehicleId: "v1",
  amountMinor: "6000000",
  reason: "Customer disappeared",
  writtenOffOn: "2026-08-21",
  replacesId: null,
};

/** F-8.3/UC-90: write-off clears a concrete obligation through the write-off endpoint, not a waiver adjustment. */
test("submits the obligation-scoped write-off", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(writtenOff);
  renderWithProviders(
    <WriteOffObligationSheet
      open
      onOpenChange={() => {}}
      leaseId="l1"
      customerId="c1"
      vehicleId="v1"
      due={due}
      outstandingMinor={parse("6000000")}
      today={today}
    />,
    { post },
  );

  await user.type(screen.getByLabelText("Reason"), "Customer disappeared");
  fireEvent.change(screen.getByLabelText(/Written off on/), {
    target: { value: "2026-08-21" },
  });
  await user.click(screen.getByRole("button", { name: "Write off" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/write-off", {
      obligationId: "o1",
      partyType: "customer",
      partyCustomerId: "c1",
      vehicleId: "v1",
      amountMinor: "6000000",
      reason: "Customer disappeared",
      writtenOffOn: asBusinessDate("2026-08-21"),
    }),
  );
});

test("requires a reason before saving", () => {
  renderWithProviders(
    <WriteOffObligationSheet
      open
      onOpenChange={() => {}}
      leaseId="l1"
      customerId="c1"
      vehicleId="v1"
      due={due}
      outstandingMinor={parse("6000000")}
      today={today}
    />,
    {},
  );

  expect(screen.getByRole("button", { name: "Write off" })).toBeDisabled();
});
