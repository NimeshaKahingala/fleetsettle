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
