import type { SessionResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { getSelectedBusinessId, setSelectedBusinessId } from "../../lib/storage.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { FirstRunGate, type FirstRunGateProps } from "./FirstRunGate.js";

beforeEach(() => {
  localStorage.clear();
});

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    userId: "u1",
    isPlatformAdmin: false,
    businesses: [],
    pendingRequest: null,
    hadMembership: false,
    ...overrides,
  };
}

function renderGate(get: ReturnType<typeof vi.fn>, overrides: Partial<FirstRunGateProps> = {}) {
  return renderWithProviders(
    <FirstRunGate
      pathname="/"
      onOpenAdmin={vi.fn()}
      renderOperate={() => <p>Operate</p>}
      renderReview={() => <p>Review</p>}
      renderMine={() => <p>Mine</p>}
      renderAdmin={() => <p>Admin</p>}
      {...overrides}
    />,
    { get },
  );
}

test("no businesses, never requested, not previously a member — the get-started form", async () => {
  const get = vi.fn().mockResolvedValue(session());
  renderGate(get);

  expect(await screen.findByText("Get started")).toBeInTheDocument();
  expect(screen.getByLabelText("FleetSettle")).toBeInTheDocument();
  expect(screen.getByText("Create a business")).toBeInTheDocument();
  expect(screen.getByText("Join a business")).toBeInTheDocument();
});

test("GAP-101: a real server error shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderGate(get);

  expect(await screen.findByText("Something went wrong loading your account.")).toBeInTheDocument();
  expect(screen.queryByText("Get started")).not.toBeInTheDocument();
});

test("decision 17: a pending request renders the reviewing state via CreateBusinessForm, not a duplicate read", async () => {
  const get = vi
    .fn()
    .mockResolvedValue(session({ pendingRequest: { status: "pending", rejectionReason: null } }));
  renderGate(get);

  expect(await screen.findByText("Your request is being reviewed.")).toBeInTheDocument();
  // Still offered — an outstanding creation request has nothing to do with
  // whether an invite code works.
  expect(screen.getByText("Join a business")).toBeInTheDocument();
  // Exactly one call: FirstRunGate's own read, not a second one from
  // CreateBusinessForm re-querying /api/session for the same field.
  expect(get).toHaveBeenCalledTimes(1);
});

test("decision 12: a rejected request shows the reason and a way to request again", async () => {
  const get = vi.fn().mockResolvedValue(
    session({
      pendingRequest: { status: "rejected", rejectionReason: "Too many businesses already" },
    }),
  );
  renderGate(get);

  expect(
    await screen.findByText("Request declined: Too many businesses already"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Request again" })).toBeInTheDocument();
});

test("decision 26: a user revoked from their only business gets a distinct message, never the create/redeem cards", async () => {
  const get = vi.fn().mockResolvedValue(session({ hadMembership: true }));
  renderGate(get);

  expect(
    await screen.findByText(
      "You no longer have access to any business. Contact the business owner.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("Create a business")).not.toBeInTheDocument();
  expect(screen.queryByText("Join a business")).not.toBeInTheDocument();
});

test.each([
  ["owner_manager", "Operate"],
  ["manager", "Operate"],
  ["owner", "Review"],
  ["driver", "Mine"],
] as const)("a single membership with role %s routes to %s", async (role, expected) => {
  const get = vi
    .fn()
    .mockResolvedValue(session({ businesses: [{ businessId: "b1", name: "Test Fleet", role }] }));
  renderGate(get);

  expect(await screen.findByText(expected)).toBeInTheDocument();
});

/**
 * Gitar review on PR #77, 19 Aug 2026: a stored selection surviving from a
 * time this identity held more than one membership (picked business A, then
 * got revoked from it, left with only B) was never reconciled here — `B`'s
 * shell rendered regardless, but `api.ts` kept sending the stale `A` as
 * `X-Business-Id` on every request, and `authMiddleware` 404s an unmatched
 * header unconditionally (never `BUSINESS_NOT_SELECTED`), so `main.tsx`'s
 * own recovery branch — which only watches for that specific code — never
 * fired. Every request 404ing forever, with no way out but a manual sign-out,
 * is exactly the class of bug this test exists to catch before it recurs.
 */
test("gitar/PR #77: a stale stored selection from a since-revoked business is cleared when only one membership remains", async () => {
  setSelectedBusinessId("b-revoked");
  const get = vi
    .fn()
    .mockResolvedValue(
      session({ businesses: [{ businessId: "b1", name: "Test Fleet", role: "owner_manager" }] }),
    );
  renderGate(get);

  expect(await screen.findByText("Operate")).toBeInTheDocument();
  expect(getSelectedBusinessId()).not.toBe("b-revoked");
});

const TWO_BUSINESSES = [
  { businessId: "b1", name: "First Fleet", role: "owner" as const },
  { businessId: "b2", name: "Second Fleet", role: "driver" as const, driverId: "d1" },
];

test("more than one membership, nothing stored yet: shows the switcher, not a shell — a real choice exists", async () => {
  const get = vi.fn().mockResolvedValue(session({ businesses: TWO_BUSINESSES }));
  renderGate(get);

  expect(await screen.findByText("Choose a business")).toBeInTheDocument();
  expect(screen.getByText("First Fleet")).toBeInTheDocument();
  expect(screen.getByText("Second Fleet")).toBeInTheDocument();
  expect(screen.queryByText("Review")).not.toBeInTheDocument();
  expect(screen.queryByText("Mine")).not.toBeInTheDocument();
});

test("more than one membership, a valid stored selection: routes straight into that membership's shell, no prompt", async () => {
  setSelectedBusinessId("b2");
  const get = vi.fn().mockResolvedValue(session({ businesses: TWO_BUSINESSES }));
  renderGate(get);

  expect(await screen.findByText("Mine")).toBeInTheDocument();
  expect(screen.queryByText("Choose a business")).not.toBeInTheDocument();
});

test("more than one membership, a stored selection that no longer names a current business (revoked since it was picked): shows the switcher again", async () => {
  setSelectedBusinessId("b-revoked");
  const get = vi.fn().mockResolvedValue(session({ businesses: TWO_BUSINESSES }));
  renderGate(get);

  expect(await screen.findByText("Choose a business")).toBeInTheDocument();
});

test("picking a business in the switcher persists it and proceeds into that membership's shell", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(session({ businesses: TWO_BUSINESSES }));
  renderGate(get);

  await user.click(await screen.findByText("Second Fleet"));

  expect(getSelectedBusinessId()).toBe("b2");
  expect(await screen.findByText("Mine")).toBeInTheDocument();
});

test("design §7.1: an admin with zero memberships gets a door into the admin panel", async () => {
  const get = vi.fn().mockResolvedValue(session({ isPlatformAdmin: true }));
  renderGate(get);

  expect(await screen.findByText("Open the admin panel")).toBeInTheDocument();
});

test("a non-admin gets no admin door", async () => {
  const get = vi.fn().mockResolvedValue(session());
  renderGate(get);

  await screen.findByText("Get started");
  expect(screen.queryByText("Open the admin panel")).not.toBeInTheDocument();
});

test("tapping the admin door calls onOpenAdmin", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(session({ isPlatformAdmin: true }));
  const onOpenAdmin = vi.fn();
  renderGate(get, { onOpenAdmin });

  await user.click(await screen.findByText("Open the admin panel"));
  expect(onOpenAdmin).toHaveBeenCalledTimes(1);
});

test("UI §3.1: isPlatformAdmin plus an /admin pathname renders the admin surface regardless of business count", async () => {
  const get = vi.fn().mockResolvedValue(
    session({
      isPlatformAdmin: true,
      businesses: [{ businessId: "b1", name: "Test Fleet", role: "owner_manager" }],
    }),
  );
  renderGate(get, { pathname: "/admin/users" });

  expect(await screen.findByText("Admin")).toBeInTheDocument();
});

test("an /admin pathname for a non-admin falls through to their ordinary shell", async () => {
  const get = vi
    .fn()
    .mockResolvedValue(
      session({ businesses: [{ businessId: "b1", name: "Test Fleet", role: "owner_manager" }] }),
    );
  renderGate(get, { pathname: "/admin/users" });

  expect(await screen.findByText("Operate")).toBeInTheDocument();
});

test("creating a business replaces the get-started form with the operate shell", async () => {
  const user = userEvent.setup();
  let hasBusiness = false;
  const get = vi.fn().mockImplementation(() =>
    Promise.resolve(
      hasBusiness
        ? session({
            businesses: [{ businessId: "b1", name: "Test Fleet", role: "owner_manager" }],
          })
        : session(),
    ),
  );
  const post = vi.fn().mockImplementation(() => {
    hasBusiness = true;
    return Promise.resolve({
      kind: "created",
      id: "b1",
      name: "Test Fleet",
      currencyCode: "LKR",
      timezone: "Asia/Colombo",
      accountingPeriodId: "p1",
    });
  });
  renderWithProviders(
    <FirstRunGate
      pathname="/"
      onOpenAdmin={vi.fn()}
      renderOperate={() => <p>Operate</p>}
      renderReview={() => <p>Review</p>}
      renderMine={() => <p>Mine</p>}
      renderAdmin={() => <p>Admin</p>}
    />,
    { get, post },
  );

  await user.type(await screen.findByLabelText("Business name"), "Test Fleet");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  expect(await screen.findByText("Operate")).toBeInTheDocument();
});
