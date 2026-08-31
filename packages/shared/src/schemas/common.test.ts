import { describe, expect, it } from "vitest";
import { businessDateSchema, moneyWireSchema } from "./common.js";

describe("moneyWireSchema", () => {
  it("parses a wire string straight to Minor", () => {
    expect(moneyWireSchema.parse("134000")).toBe(134000n);
    expect(moneyWireSchema.parse("-500")).toBe(-500n);
  });

  it("rejects a decimal or a bare number shape", () => {
    expect(moneyWireSchema.safeParse("134000.50").success).toBe(false);
    expect(moneyWireSchema.safeParse("abc").success).toBe(false);
  });

  it("L-1 — rejects '-0' (and '-00') as a failed parse, never by throwing out of the transform", () => {
    for (const bad of ["-0", "-00", "-000"]) {
      const result = moneyWireSchema.safeParse(bad);
      expect(result.success).toBe(false);
    }
    // A genuine zero, and an ordinary negative, both still parse — this is
    // about the one string that cannot round-trip, not zero or negatives
    // generally.
    expect(moneyWireSchema.parse("0")).toBe(0n);
    expect(moneyWireSchema.parse("-500")).toBe(-500n);
  });
});

describe("businessDateSchema", () => {
  it("parses YYYY-MM-DD straight to a BusinessDate", () => {
    expect(businessDateSchema.parse("2026-07-12")).toBe("2026-07-12");
  });

  it("rejects anything else, including a full ISO instant", () => {
    expect(businessDateSchema.safeParse("2026-07-12T00:00:00Z").success).toBe(false);
    expect(businessDateSchema.safeParse("12/07/2026").success).toBe(false);
  });
});
