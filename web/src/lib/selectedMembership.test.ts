import type { SessionResponse } from "@fleetsettle/shared/schemas";
import { beforeEach, expect, test } from "vitest";
import { resolveSelectedMembership } from "./selectedMembership.js";
import { setSelectedBusinessId } from "./storage.js";

beforeEach(() => {
  localStorage.clear();
});

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    userId: "u1",
    isPlatformAdmin: false,
    businesses: [
      { businessId: "b1", name: "First", role: "owner" },
      { businessId: "b2", name: "Second", role: "driver", driverId: "d1" },
    ],
    pendingRequest: null,
    hadMembership: true,
    ...overrides,
  };
}

test("resolves the stored selection when it names one of the current memberships", () => {
  setSelectedBusinessId("b2");
  expect(resolveSelectedMembership(session())?.businessId).toBe("b2");
});

test("falls back to businesses[0] when nothing has been selected yet — the pre-switcher, single-membership behaviour", () => {
  expect(resolveSelectedMembership(session())?.businessId).toBe("b1");
});

test("falls back to businesses[0] when the stored selection no longer names a current membership (revoked since it was picked)", () => {
  setSelectedBusinessId("b-revoked");
  expect(resolveSelectedMembership(session())?.businessId).toBe("b1");
});

test("returns undefined when there are no memberships at all", () => {
  expect(resolveSelectedMembership(session({ businesses: [] }))).toBeUndefined();
});
