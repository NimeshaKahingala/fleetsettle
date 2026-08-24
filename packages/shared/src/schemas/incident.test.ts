import { describe, expect, it } from "vitest";
import { recordCustomerContributionRequestSchema } from "./incident.js";

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
