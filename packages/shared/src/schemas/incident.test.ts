import { describe, expect, it } from "vitest";
import {
  recordCustomerContributionRequestSchema,
  submitInsuranceClaimRequestSchema,
} from "./incident.js";

const base = {
  agreedAmountMinor: "2000000",
  agreedOn: "2026-08-24",
};

describe("recordCustomerContributionRequestSchema — GAP-177, a contribution is a real amount", () => {
  it("accepts a real agreed amount", () => {
    expect(recordCustomerContributionRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects zero — record no recovery at all, or the real figure and waive it (UC-77)", () => {
    // Entering 0 here is the failure W-28/UC-77 exists to prevent: it looks
    // like a settled contribution of nothing, rather than either an absent
    // recovery or a recorded amount deliberately given away.
    expect(
      recordCustomerContributionRequestSchema.safeParse({ ...base, agreedAmountMinor: "0" })
        .success,
    ).toBe(false);
  });

  it("accepts one rupee — the rule is a real amount, not a large one", () => {
    expect(
      recordCustomerContributionRequestSchema.safeParse({ ...base, agreedAmountMinor: "1" })
        .success,
    ).toBe(true);
  });
});

describe("submitInsuranceClaimRequestSchema — B21, a claim is a real amount", () => {
  const claimBase = { claimedAmountMinor: "500000", claimedOn: "2026-08-24" };

  it("rejects a zero claimed amount — nothing to submit", () => {
    expect(
      submitInsuranceClaimRequestSchema.safeParse({ ...claimBase, claimedAmountMinor: "0" })
        .success,
    ).toBe(false);
  });

  it("still accepts a zero excess borne — none of the excess falling on this party is a real case", () => {
    expect(
      submitInsuranceClaimRequestSchema.safeParse({ ...claimBase, excessBorneMinor: "0" }).success,
    ).toBe(true);
  });
});
