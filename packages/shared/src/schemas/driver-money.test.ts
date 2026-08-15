import { describe, expect, it } from "vitest";
import {
  createOffsetRequestSchema,
  depositMovementRequestSchema,
  issueAdvanceRequestSchema,
  takeDriverDepositRequestSchema,
} from "./driver-money.js";

const driverId = "11111111-1111-4111-8111-111111111111";
const obligationId = "33333333-3333-4333-8333-333333333333";

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

describe("depositMovementRequestSchema", () => {
  it("GAP-6: rejects 'applied' with no obligationId", () => {
    const result = depositMovementRequestSchema.safeParse({
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-15",
    });
    expect(result.success).toBe(false);
  });

  it("GAP-6: rejects obligationId given for a non-'applied' movement", () => {
    const result = depositMovementRequestSchema.safeParse({
      movementType: "topped_up",
      amountMinor: "30000",
      occurredOn: "2026-07-15",
      obligationId,
    });
    expect(result.success).toBe(false);
  });

  it("GAP-6: accepts 'applied' with an obligationId", () => {
    const result = depositMovementRequestSchema.safeParse({
      movementType: "applied",
      amountMinor: "30000",
      occurredOn: "2026-07-15",
      obligationId,
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
