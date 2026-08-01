import { describe, expect, it } from "vitest";
import {
  createOffsetRequestSchema,
  issueAdvanceRequestSchema,
  takeDriverDepositRequestSchema,
} from "./driver-money.js";

const driverId = "11111111-1111-4111-8111-111111111111";

describe("issueAdvanceRequestSchema", () => {
  it("accepts an advance with no trip attached", () => {
    const result = issueAdvanceRequestSchema.safeParse({
      driverId,
      amountMinor: "1000000",
      issuedOn: "2026-07-15",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative amount", () => {
    expect(
      issueAdvanceRequestSchema.safeParse({
        driverId,
        amountMinor: "0",
        issuedOn: "2026-07-15",
      }).success,
    ).toBe(false);
  });
});

describe("takeDriverDepositRequestSchema", () => {
  it("accepts a positive deposit amount", () => {
    const result = takeDriverDepositRequestSchema.safeParse({
      driverId,
      amountMinor: "500000",
      occurredOn: "2026-07-15",
    });
    expect(result.success).toBe(true);
  });
});

describe("createOffsetRequestSchema", () => {
  it("accepts an offset with a note", () => {
    const result = createOffsetRequestSchema.safeParse({
      driverId,
      amountMinor: "400000",
      occurredOn: "2026-07-15",
      note: "Settling arrears against his trip fee",
    });
    expect(result.success).toBe(true);
  });
});
