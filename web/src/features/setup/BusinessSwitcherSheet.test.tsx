import type { SessionMembership } from "@fleetsettle/shared/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { ApiClient } from "../../lib/api.js";
import { ApiProvider } from "../../lib/ApiContext.js";
import { getSelectedBusinessId } from "../../lib/storage.js";
import { BusinessSwitcherSheet } from "./BusinessSwitcherSheet.js";

beforeEach(() => {
  localStorage.clear();
});

const BUSINESSES: SessionMembership[] = [
  { businessId: "b1", name: "First Fleet", role: "owner" },
  { businessId: "b2", name: "Second Fleet", role: "driver", driverId: "d1" },
];

function renderSheet(overrides: Partial<React.ComponentProps<typeof BusinessSwitcherSheet>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const post = vi.fn();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={{ post } as unknown as ApiClient}>
        <BusinessSwitcherSheet
          open
          onOpenChange={onOpenChange}
          businesses={BUSINESSES}
          {...overrides}
        />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, onOpenChange, post };
}

test("lists every membership's name and role", () => {
  renderSheet();
  expect(screen.getByText("First Fleet")).toBeInTheDocument();
  expect(screen.getByText("Owner")).toBeInTheDocument();
  expect(screen.getByText("Second Fleet")).toBeInTheDocument();
  expect(screen.getByText("Driver")).toBeInTheDocument();
});

test("selecting a row persists the choice via setSelectedBusinessId", async () => {
  const user = userEvent.setup();
  renderSheet();

  await user.click(screen.getByText("Second Fleet"));

  expect(getSelectedBusinessId()).toBe("b2");
});

test("selecting a row closes the sheet", async () => {
  const user = userEvent.setup();
  const { onOpenChange } = renderSheet();

  await user.click(screen.getByText("First Fleet"));

  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("selecting a row calls the optional onSelected callback after clearing", async () => {
  const user = userEvent.setup();
  const onSelected = vi.fn();
  renderSheet({ onSelected });

  await user.click(screen.getByText("First Fleet"));

  expect(onSelected).toHaveBeenCalledTimes(1);
});

test("GAP-139: marks the current business, and only the current business", () => {
  renderSheet({ currentBusinessId: "b2" });

  const current = screen.getByRole("button", { name: /Second Fleet/ });
  const other = screen.getByRole("button", { name: /First Fleet/ });
  expect(current).toHaveAttribute("aria-current", "true");
  expect(other).not.toHaveAttribute("aria-current");
  expect(screen.getByText("Driver · Current")).toBeInTheDocument();
  expect(screen.queryByText("Owner · Current")).not.toBeInTheDocument();
});

test("GAP-139: no currentBusinessId (or one that matches nothing) marks nothing as current", () => {
  renderSheet({ currentBusinessId: "not-a-real-id" });

  expect(screen.getByRole("button", { name: /First Fleet/ })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("button", { name: /Second Fleet/ })).not.toHaveAttribute("aria-current");
});

test("GAP-149: in-shell hub can create a business and selects the new business before reload", async () => {
  const user = userEvent.setup();
  const onSelected = vi.fn();
  const { post, onOpenChange } = renderSheet({
    createBusiness: { pendingRequest: null },
    onSelected,
  });
  post.mockResolvedValue({
    kind: "created",
    id: "00000000-0000-4000-8000-000000000123",
    name: "Third Fleet",
    currencyCode: "LKR",
    timezone: "Asia/Colombo",
    accountingPeriodId: "00000000-0000-4000-8000-000000000456",
  });

  await user.click(screen.getByRole("button", { name: "Create a business" }));
  await user.type(screen.getByLabelText("Business name"), "Third Fleet");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/business", {
      name: "Third Fleet",
      currencyCode: "LKR",
      timezone: "Asia/Colombo",
    }),
  );
  expect(getSelectedBusinessId()).toBe("00000000-0000-4000-8000-000000000123");
  expect(onSelected).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("GAP-157: in-shell hub can join a second business by invite code and selects it before reload", async () => {
  const user = userEvent.setup();
  const onSelected = vi.fn();
  const { post, onOpenChange } = renderSheet({
    createBusiness: { pendingRequest: null },
    onSelected,
  });
  post.mockResolvedValue({
    kind: "business_member",
    businessId: "00000000-0000-4000-8000-000000000789",
    role: "manager",
  });

  await user.click(screen.getByRole("button", { name: "Join a business" }));
  await user.type(screen.getByLabelText("Invite code"), "ABC123");
  await user.click(screen.getByRole("button", { name: "Join" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/invite/redeem", { code: "ABC123" }),
  );
  expect(getSelectedBusinessId()).toBe("00000000-0000-4000-8000-000000000789");
  expect(onSelected).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("GAP-157: a driver_link redemption clears the cache and closes without changing the selection", async () => {
  const user = userEvent.setup();
  const onSelected = vi.fn();
  const { post, onOpenChange } = renderSheet({
    createBusiness: { pendingRequest: null },
    onSelected,
  });
  post.mockResolvedValue({ kind: "driver_link", driverId: "00000000-0000-4000-8000-00000000ddd1" });

  await user.click(screen.getByRole("button", { name: "Join a business" }));
  await user.type(screen.getByLabelText("Invite code"), "DRV123");
  await user.click(screen.getByRole("button", { name: "Join" }));

  await vi.waitFor(() => expect(onSelected).toHaveBeenCalledOnce());
  expect(getSelectedBusinessId()).toBeNull();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("GAP-157: opening Join a business collapses an already-open Create a business, and vice versa", async () => {
  const user = userEvent.setup();
  renderSheet({ createBusiness: { pendingRequest: null } });

  await user.click(screen.getByRole("button", { name: "Create a business" }));
  expect(screen.getByLabelText("Business name")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Join a business" }));
  expect(screen.queryByLabelText("Business name")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Invite code")).toBeInTheDocument();
});

/**
 * Design doc open question 19 / implementation plan §5: the concrete,
 * named regression case. `PartnerDetailScreen.tsx:208,212,217,221` keys
 * four real-money queries on `userId` alone — `["partner", userId]`,
 * `["capital-contribution", userId]`, `["partner-payout", userId]`,
 * `["banking-event", userId]` — so a partner in two businesses would see
 * business A's figures rendered under business B's name unless switching
 * actually runs `queryClient.clear()`. This proves it does, for exactly
 * those four keys, not a hypothetical.
 */
test("selecting a different business clears PartnerDetailScreen's four userId-keyed caches — the design doc's named regression case", async () => {
  const user = userEvent.setup();
  const { queryClient } = renderSheet();

  const userId = "u1";
  queryClient.setQueryData(["partner", userId], { balanceMinor: "100000" });
  queryClient.setQueryData(["capital-contribution", userId], [{ id: "c1" }]);
  queryClient.setQueryData(["partner-payout", userId], [{ id: "p1" }]);
  queryClient.setQueryData(["banking-event", userId], [{ id: "e1" }]);
  // A sibling key from a different screen, to prove clear() is genuinely
  // total rather than this test accidentally only exercising four
  // hand-picked removals.
  queryClient.setQueryData(["vehicles"], [{ id: "v1" }]);

  await user.click(screen.getByText("Second Fleet"));

  expect(queryClient.getQueryData(["partner", userId])).toBeUndefined();
  expect(queryClient.getQueryData(["capital-contribution", userId])).toBeUndefined();
  expect(queryClient.getQueryData(["partner-payout", userId])).toBeUndefined();
  expect(queryClient.getQueryData(["banking-event", userId])).toBeUndefined();
  expect(queryClient.getQueryData(["vehicles"])).toBeUndefined();
});

test("dismissing the create form without submitting does not leave it open on reopen", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const post = vi.fn();
  const onOpenChange = vi.fn();

  // Every real caller (router.tsx) mounts this sheet unconditionally and
  // drives visibility with `open`, so the component instance -- and its
  // `creating` state -- survives a close. `rerender` on the same instance is
  // what reproduces that, unlike a fresh `render` per case.
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={{ post } as unknown as ApiClient}>
        <BusinessSwitcherSheet
          open
          onOpenChange={onOpenChange}
          businesses={BUSINESSES}
          createBusiness={{ pendingRequest: null }}
        />
      </ApiProvider>
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Create a business" }));
  expect(screen.getByLabelText("Business name")).toBeInTheDocument();

  rerender(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={{ post } as unknown as ApiClient}>
        <BusinessSwitcherSheet
          open={false}
          onOpenChange={onOpenChange}
          businesses={BUSINESSES}
          createBusiness={{ pendingRequest: null }}
        />
      </ApiProvider>
    </QueryClientProvider>,
  );

  rerender(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={{ post } as unknown as ApiClient}>
        <BusinessSwitcherSheet
          open
          onOpenChange={onOpenChange}
          businesses={BUSINESSES}
          createBusiness={{ pendingRequest: null }}
        />
      </ApiProvider>
    </QueryClientProvider>,
  );

  expect(screen.queryByLabelText("Business name")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create a business" })).toBeInTheDocument();
  expect(screen.getByText("First Fleet")).toBeInTheDocument();
});
