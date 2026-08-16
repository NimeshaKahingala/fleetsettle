import { asBusinessDate } from "@fleetsettle/shared";
import type {
  BankingEventsResponse,
  CapitalContributionsResponse,
  PartnerPayoutsResponse,
  PartnerSummaryResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { PartnerDetailScreen } from "./PartnerDetailScreen.js";

const today = asBusinessDate("2026-08-11");

const summary: PartnerSummaryResponse = {
  userId: "u1",
  displayName: "Nimal",
  period: { id: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
  putIn: { contributionsMinor: "500000", outOfPocketMinor: "100000" },
  takenOut: { payoutsMinor: "200000", settlementsMinor: "0" },
  earned: { profitShareMinor: "300000", managementFeeMinor: "0" },
  holdingMinor: "800000",
  balanceMinor: "700000",
};

const contributions: CapitalContributionsResponse = [
  {
    id: "c1",
    userId: "u1",
    vehicleId: null,
    amountMinor: "500000",
    contributedOn: "2026-08-01",
    note: null,
    replacesId: null,
  },
];
const payouts: PartnerPayoutsResponse = [
  {
    id: "po1",
    userId: "u1",
    amountMinor: "200000",
    kind: "payout",
    occurredOn: "2026-08-02",
    replacesId: null,
  },
];
const bankings: BankingEventsResponse = [
  {
    id: "b1",
    fromUserId: "u1",
    amountRecordedMinor: "800000",
    amountCountedMinor: "800000",
    bankedOn: "2026-08-03",
    destination: "BOC",
    reference: null,
    discrepancyMinor: "0",
    discrepancyBearer: null,
    replacesId: null,
  },
];

function baseGet() {
  return vi.fn().mockImplementation((path: string) => {
    if (path === "/api/partner/u1") return Promise.resolve(summary);
    if (path === "/api/capital-contribution?userId=u1") return Promise.resolve(contributions);
    if (path === "/api/partner-payout?userId=u1") return Promise.resolve(payouts);
    if (path === "/api/banking-event?userId=u1") return Promise.resolve(bankings);
    throw new Error(`unexpected path ${path}`);
  });
}

async function enterMoney(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("B2: Partner detail shows summary and operational money history", async () => {
  renderWithProviders(<PartnerDetailScreen userId="u1" today={today} onBack={vi.fn()} />, {
    get: baseGet(),
  });

  expect(await screen.findByRole("heading", { name: "Nimal" })).toBeInTheDocument();
  expect(screen.getByText("Balance")).toBeInTheDocument();
  expect(screen.getByText("Capital contributions · 1")).toBeInTheDocument();
  expect(screen.getByText("Payouts and settlements · 1")).toBeInTheDocument();
  expect(screen.getByText("Banking · 1")).toBeInTheDocument();
});

test("B2: Partner detail records a partner payout", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "po2",
    userId: "u1",
    amountMinor: "70000",
    kind: "payout",
    occurredOn: today,
  });
  renderWithProviders(<PartnerDetailScreen userId="u1" today={today} onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Partner money" }));
  await user.click(await screen.findByRole("button", { name: "Partner payout" }));
  await enterMoney(user, "70000");
  await user.click(screen.getByRole("button", { name: "Save payout" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/partner-payout",
      expect.objectContaining({ userId: "u1", amountMinor: "70000", kind: "payout" }),
    ),
  );
});

/**
 * GAP-115: the capital-contribution write path had no test at all —
 * `PartnerDetailScreen.tsx`'s own `CapitalContributionSheet` (`mutationFn`
 * posts `userId`/`amountMinor`/`contributedOn` and an optional trimmed
 * `note`) was correct source with zero coverage. Mirrors the payout test
 * above, the sibling mutation this file already tests.
 */
test("GAP-115: Partner detail records a capital contribution", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "c2",
    userId: "u1",
    vehicleId: null,
    amountMinor: "150000",
    contributedOn: today,
    note: null,
    replacesId: null,
  });
  renderWithProviders(<PartnerDetailScreen userId="u1" today={today} onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Partner money" }));
  await user.click(await screen.findByRole("button", { name: "Capital contribution" }));
  await enterMoney(user, "150000");
  await user.click(screen.getByRole("button", { name: "Save contribution" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/capital-contribution",
      expect.objectContaining({ userId: "u1", amountMinor: "150000", contributedOn: today }),
    ),
  );
  // The mutationFn's own conditional spread — `note` is omitted entirely
  // when blank, not sent as an empty string — so a regression that starts
  // always sending it would fail this.
  const [, body] = post.mock.calls[0] as [string, Record<string, unknown>];
  expect(body).not.toHaveProperty("note");
});

test("GAP-101: failed partner summary read shows a scoped failure", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === "/api/partner/u1") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-partner"));
    }
    return Promise.resolve([]);
  });
  renderWithProviders(<PartnerDetailScreen userId="u1" today={today} onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Something went wrong loading this partner.")).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});
