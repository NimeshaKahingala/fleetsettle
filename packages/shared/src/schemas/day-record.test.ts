import { describe, expect, it } from "vitest";
import { confirmDayRequestSchema } from "./day-record.js";

const base = { dailyLeaseId: "11111111-1111-4111-8111-111111111111", businessDate: "2026-07-30" };

describe("confirmDayRequestSchema", () => {
  it("accepts the one-tap paid-in-full action with no amounts", () => {
    const result = confirmDayRequestSchema.safeParse({ ...base, action: "paid_in_full" });
    expect(result.success).toBe(true);
  });

  it("accepts something_else with earned and received as separate facts", () => {
    const result = confirmDayRequestSchema.safeParse({
      ...base,
      action: "something_else",
      earnedMinor: "400000",
      receivedMinor: "300000",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === "something_else") {
      expect(result.data.earnedMinor).toBe(400000n);
      expect(result.data.receivedMinor).toBe(300000n);
    }
  });

  it("rejects something_else where received exceeds earned (that's credit, F-4.5, not this endpoint)", () => {
    const result = confirmDayRequestSchema.safeParse({
      ...base,
      action: "something_else",
      earnedMinor: "300000",
      receivedMinor: "400000",
    });
    expect(result.success).toBe(false);
  });

  it("accepts did_not_run with a lost reason", () => {
    const result = confirmDayRequestSchema.safeParse({
      ...base,
      action: "did_not_run",
      lostReason: "breakdown",
    });
    expect(result.success).toBe(true);
  });

  it("rejects did_not_run with 'on_charter' — deliberately not a valid reason (FL §4.1)", () => {
    const result = confirmDayRequestSchema.safeParse({
      ...base,
      action: "did_not_run",
      lostReason: "on_charter",
    });
    expect(result.success).toBe(false);
  });

  it("rejects did_not_run with no reason at all", () => {
    const result = confirmDayRequestSchema.safeParse({ ...base, action: "did_not_run" });
    expect(result.success).toBe(false);
  });
});
