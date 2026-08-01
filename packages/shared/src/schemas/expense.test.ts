import { describe, expect, it } from "vitest";
import { createExpenseRequestSchema } from "./expense.js";

const driverId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";

describe("createExpenseRequestSchema", () => {
  it("accepts an overhead cost with no vehicle (UC-66, INV-24)", () => {
    const result = createExpenseRequestSchema.safeParse({
      category: "office",
      amountMinor: "50000",
      spentOn: "2026-07-15",
    });
    expect(result.success).toBe(true);
  });

  it("rejects borneBy 'driver' with no borneByDriverId (W-48/INV-27)", () => {
    const result = createExpenseRequestSchema.safeParse({
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      borneBy: "driver",
    });
    expect(result.success).toBe(false);
  });

  it("accepts borneBy 'driver' with an id", () => {
    const result = createExpenseRequestSchema.safeParse({
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      borneBy: "driver",
      borneByDriverId: driverId,
    });
    expect(result.success).toBe(true);
  });

  it("rejects borneBy 'customer' with no borneByCustomerId", () => {
    const result = createExpenseRequestSchema.safeParse({
      category: "cleaning",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      borneBy: "customer",
    });
    expect(result.success).toBe(false);
  });

  it("accepts borneBy 'customer' with an id", () => {
    const result = createExpenseRequestSchema.safeParse({
      category: "cleaning",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      borneBy: "customer",
      borneByCustomerId: customerId,
    });
    expect(result.success).toBe(true);
  });
});
