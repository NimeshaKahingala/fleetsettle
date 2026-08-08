import { describe, expect, test } from "vitest";
import type { MeRole } from "@fleetsettle/shared/schemas";
import { can, type Capability } from "./capabilities.js";

const ROLES: readonly MeRole[] = ["owner", "owner_manager", "manager", "driver"];

/**
 * B0b/W-49: one row per `api/src/auth/policy.ts`'s own `MATRIX`, copied
 * here so the two can drift apart loudly (a mismatch would show up as one
 * of these failing against a manual re-check, not as a silent divergence) —
 * this test is what makes that copy honest.
 */
const EXPECTED: Record<Capability, readonly MeRole[]> = {
  dailyOperations: ["owner", "owner_manager", "manager"],
  leaseAndTripLifecycle: ["owner", "owner_manager", "manager"],
  manageEntities: ["owner", "owner_manager", "manager"],
  manageOpeningBalances: ["owner", "owner_manager"],
  managePartnerCapital: ["owner", "owner_manager"],
  manageMembers: ["owner", "owner_manager"],
  writeOffOrWaiveAboveThreshold: ["owner", "owner_manager"],
  reverseReceipt: ["owner", "owner_manager"],
  closePeriod: ["owner", "owner_manager"],
  viewReports: ["owner", "owner_manager", "manager"],
  viewOwnerOnlyReports: ["owner", "owner_manager"],
  viewOwnData: ["driver"],
  messagingKillSwitch: ["owner", "owner_manager", "manager"],
  messagingConfig: ["owner", "owner_manager"],
};

describe("can()", () => {
  for (const [capability, allowed] of Object.entries(EXPECTED) as [
    Capability,
    readonly MeRole[],
  ][]) {
    test(`${capability}: exactly ${allowed.join("/")}`, () => {
      for (const role of ROLES) {
        expect(can(role, capability)).toBe(allowed.includes(role));
      }
    });
  }

  test("a driver has no STAFF capability at all", () => {
    const staffOnly: Capability[] = [
      "dailyOperations",
      "leaseAndTripLifecycle",
      "manageEntities",
      "viewReports",
      "messagingKillSwitch",
    ];
    for (const capability of staffOnly) {
      expect(can("driver", capability)).toBe(false);
    }
  });

  test("viewOwnData belongs to the linked driver alone — no staff role holds it", () => {
    expect(can("owner", "viewOwnData")).toBe(false);
    expect(can("owner_manager", "viewOwnData")).toBe(false);
    expect(can("manager", "viewOwnData")).toBe(false);
    expect(can("driver", "viewOwnData")).toBe(true);
  });
});
