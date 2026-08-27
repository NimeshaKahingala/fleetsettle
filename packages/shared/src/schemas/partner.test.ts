import { describe, expect, it } from "vitest";
import {
  recordCapitalContributionRequestSchema,
  recordPartnerPayoutRequestSchema,
} from "./partner.js";

const userId = "11111111-1111-4111-8111-111111111111";

describe("recordCapitalContributionRequestSchema — B21, a contribution is a real amount", () => {
  const base = { userId, amountMinor: "500000", contributedOn: "2026-08-24" };

  it("rejects a zero contribution — nothing was actually paid in", () => {
    expect(
      recordCapitalContributionRequestSchema.safeParse({ ...base, amountMinor: "0" }).success,
    ).toBe(false);
  });

  it("accepts a positive contribution", () => {
    expect(recordCapitalContributionRequestSchema.safeParse(base).success).toBe(true);
  });
});

describe("recordPartnerPayoutRequestSchema — B21, a payout or settlement is a real amount", () => {
  const base = { userId, amountMinor: "500000", kind: "payout" as const, occurredOn: "2026-08-24" };

  it("rejects a zero payout — nothing moved", () => {
    expect(recordPartnerPayoutRequestSchema.safeParse({ ...base, amountMinor: "0" }).success).toBe(
      false,
    );
  });

  it("rejects a zero settlement — the same 'nothing moved' rule applies to both kinds", () => {
    expect(
      recordPartnerPayoutRequestSchema.safeParse({
        ...base,
        kind: "partner_settlement",
        amountMinor: "0",
      }).success,
    ).toBe(false);
  });

  it("accepts a positive payout", () => {
    expect(recordPartnerPayoutRequestSchema.safeParse(base).success).toBe(true);
  });
});
