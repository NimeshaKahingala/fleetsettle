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

  it("GAP-30: rejects odometerReadingKm with no odometerSource", () => {
    const result = createExpenseRequestSchema.safeParse({
      vehicleId: driverId,
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      odometerReadingKm: 45000,
    });
    expect(result.success).toBe(false);
  });

  it("GAP-30: rejects odometerReadingKm with no vehicleId — no vehicle for the reading to belong to", () => {
    const result = createExpenseRequestSchema.safeParse({
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      odometerReadingKm: 45000,
      odometerSource: "reported",
    });
    expect(result.success).toBe(false);
  });

  it("GAP-30: accepts odometerReadingKm + odometerSource given together, with a vehicle", () => {
    const result = createExpenseRequestSchema.safeParse({
      vehicleId: driverId,
      category: "fuel",
      amountMinor: "50000",
      spentOn: "2026-07-15",
      odometerReadingKm: 45000,
      odometerSource: "reported",
    });
    expect(result.success).toBe(true);
  });
  it("rejects a zero amount, so a free repair is recorded and waived rather than entered as nothing (GAP-177)", () => {
    const zero = createExpenseRequestSchema.safeParse({
      category: "repairs",
      amountMinor: "0",
      spentOn: "2026-08-24",
    });
    expect(zero.success).toBe(false);

    // One rupee passes. The rule is "a real amount", not "a large one" — and
    // the DB CHECK on this column stays `>= 0` for accumulators that start
    // empty, which is a different question from what a person may type.
    const one = createExpenseRequestSchema.safeParse({
      category: "repairs",
      amountMinor: "1",
      spentOn: "2026-08-24",
    });
    expect(one.success).toBe(true);
  });
});
