import type { SessionResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { FirstRunGate, type FirstRunGateProps } from "./FirstRunGate.js";

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

test("Phase 3 stopgap: more than one membership does not crash — picks businesses[0] deterministically", async () => {
  const get = vi.fn().mockResolvedValue(
    session({
      businesses: [
        { businessId: "b1", name: "First", role: "owner" },
        { businessId: "b2", name: "Second", role: "driver", driverId: "d1" },
      ],
    }),
  );
  renderGate(get);

  expect(await screen.findByText("Review")).toBeInTheDocument();
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
