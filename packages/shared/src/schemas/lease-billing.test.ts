import { describe, expect, it } from "vitest";
import {
  recordOdometerReadingRequestSchema,
  recordPaymentRequestSchema,
  renewLeaseRequestSchema,
} from "./lease-billing.js";

const leaseId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";

describe("recordOdometerReadingRequestSchema", () => {
  it("accepts a reading with its source (INV-19, W-18)", () => {
    const result = recordOdometerReadingRequestSchema.safeParse({
      leaseId,
      readingKm: 3240,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative reading", () => {
    const result = recordOdometerReadingRequestSchema.safeParse({
      leaseId,
      readingKm: -1,
      readOn: "2026-02-11",
      source: "in_person",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown source", () => {
    const result = recordOdometerReadingRequestSchema.safeParse({
      leaseId,
      readingKm: 100,
      readOn: "2026-02-11",
      source: "guessed",
    });
    expect(result.success).toBe(false);
  });
});

describe("renewLeaseRequestSchema", () => {
  it("accepts a new agreed rent (F-2.5/UC-17)", () => {
    const result = renewLeaseRequestSchema.safeParse({ rentAmountMinor: "8000000" });
    expect(result.success).toBe(true);
  });
});

describe("recordPaymentRequestSchema", () => {
  it("accepts a customer payment (F-2.2/UC-11)", () => {
    const result = recordPaymentRequestSchema.safeParse({
      partyType: "customer",
      partyId: customerId,
      amountMinor: "7000000",
      occurredOn: "2026-02-12",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative amount", () => {
    const result = recordPaymentRequestSchema.safeParse({
      partyType: "customer",
      partyId: customerId,
      amountMinor: "0",
      occurredOn: "2026-02-12",
    });
    expect(result.success).toBe(false);
  });
});
