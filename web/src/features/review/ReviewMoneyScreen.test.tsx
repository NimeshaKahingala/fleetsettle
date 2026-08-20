import type { MeResponse, PartnerSummaryResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ReviewMoneyScreen } from "./ReviewMoneyScreen.js";

const me: MeResponse = { userId: "u1", businessId: "b1", role: "owner" };

const partner: PartnerSummaryResponse = {
  userId: "u1",
  displayName: "Me",
  period: { id: "p-jul", periodStart: "2026-07-01", periodEnd: "2026-07-31" },
  putIn: { contributionsMinor: "500000", outOfPocketMinor: "0" },
  takenOut: { payoutsMinor: "0", settlementsMinor: "0" },
  earned: { profitShareMinor: "1340000", managementFeeMinor: "0" },
  holdingMinor: "200000",
  balanceMinor: "1840000",
};

test("renders every figure from GET /api/partner/{userId}, all-time and this-period captioned separately", async () => {
  const get = vi.fn().mockResolvedValue(partner);
  renderWithProviders(<ReviewMoneyScreen />, { get }, undefined, me);

  expect(await screen.findByText("Rs 18,400")).toBeInTheDocument();
  expect(screen.getByText("Rs 5,000")).toBeInTheDocument();
  expect(screen.getByText(/Earned \(2026-07-01 – 2026-07-31\)/)).toBeInTheDocument();
});

test("GAP-153/F-5: can render a Back affordance when opened from Operate's More hub", async () => {
  const user = userEvent.setup();
  const onBack = vi.fn();
  const get = vi.fn().mockResolvedValue(partner);
  renderWithProviders(<ReviewMoneyScreen onBack={onBack} />, { get }, undefined, me);

  await user.click(await screen.findByRole("button", { name: "Back" }));

  expect(onBack).toHaveBeenCalledTimes(1);
});

test("GAP-101/GAP-90/F2: a failed read — including a revoked member's 404 — shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(404, "NOT_FOUND", "gone", "req-1"));
  renderWithProviders(<ReviewMoneyScreen />, { get }, undefined, me);

  expect(await screen.findByText("Your money isn't here any more.")).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});
