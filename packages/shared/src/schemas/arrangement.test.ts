import { describe, expect, it } from "vitest";
import {
  changeDailyLeaseRateRequestSchema,
  startDailyLeaseRequestSchema,
  startLeaseRequestSchema,
} from "./arrangement.js";

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

describe("startLeaseRequestSchema — GAP-177, rent is a real amount", () => {
  it("rejects a zero rent: a mileage-only lease is not a real arrangement (owner, 23 Aug 2026)", () => {
    expect(startLeaseRequestSchema.safeParse({ ...base, rentAmountMinor: "0" }).success).toBe(
      false,
    );
  });

  it("still accepts a zero excess rate — a lease that simply does not bill excess is legitimate", () => {
    // A mileage limit drags its two odometer fields in with it (INV-19, the
    // refines above), so they are supplied here — this case is about the
    // excess *rate* being allowed to be zero, not about the limit's own rules.
    expect(
      startLeaseRequestSchema.safeParse({
        ...base,
        mileageDailyLimitKm: 100,
        mileageExcessRateMinor: "0",
        odometerReadingKm: 45000,
        odometerSource: "photo",
      }).success,
    ).toBe(true);
  });
});

describe("startDailyLeaseRequestSchema / changeDailyLeaseRateRequestSchema — B21, a daily rate is a real amount", () => {
  const dailyBase = {
    vehicleId,
    driverId: "33333333-3333-4333-8333-333333333333",
    patternType: "every_day" as const,
    effectiveFrom: "2026-01-12",
  };

  it("rejects a zero starting daily-lease rate: a free lease is not a real arrangement", () => {
    const result = startDailyLeaseRequestSchema.safeParse({
      ...dailyBase,
      dailyLeaseAmountMinor: "0",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a positive starting daily-lease rate", () => {
    const result = startDailyLeaseRequestSchema.safeParse({
      ...dailyBase,
      dailyLeaseAmountMinor: "45000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects changing the daily-lease rate to zero", () => {
    const result = changeDailyLeaseRateRequestSchema.safeParse({
      dailyLeaseAmountMinor: "0",
      effectiveFrom: "2026-01-12",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a positive changed daily-lease rate", () => {
    const result = changeDailyLeaseRateRequestSchema.safeParse({
      dailyLeaseAmountMinor: "50000",
      effectiveFrom: "2026-01-12",
    });
    expect(result.success).toBe(true);
  });
});
