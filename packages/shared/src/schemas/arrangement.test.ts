import { describe, expect, it } from "vitest";
import { startLeaseRequestSchema } from "./arrangement.js";

const vehicleId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";

const base = {
  vehicleId,
  customerId,
  startDate: "2026-01-12",
  billingDay: 12,
  rentAmountMinor: "70000",
};

describe("startLeaseRequestSchema — F-2.1 step 4, odometer at handover (INV-19)", () => {
  it("accepts no mileage limit and no odometer reading — unlimited suppresses the prompt", () => {
    expect(startLeaseRequestSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a mileage limit with both odometer fields present", () => {
    const result = startLeaseRequestSchema.safeParse({
      ...base,
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 0,
      odometerSource: "in_person",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a mileage limit with no odometer reading", () => {
    const result = startLeaseRequestSchema.safeParse({
      ...base,
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerSource: "in_person",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a mileage limit with no odometer source", () => {
    const result = startLeaseRequestSchema.safeParse({
      ...base,
      mileageDailyLimitKm: 100,
      mileageExcessRateMinor: "25",
      odometerReadingKm: 0,
    });
    expect(result.success).toBe(false);
  });
});
