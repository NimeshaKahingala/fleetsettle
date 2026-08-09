import type { Minor } from "@fleetsettle/shared";
import { describe, expect, test } from "vitest";
import { toAxisValue } from "./chartAxis.js";

function minor(v: bigint): Minor {
  return v as Minor;
}

describe("toAxisValue", () => {
  test("a positive profit", () => {
    expect(toAxisValue(minor(13_400_00n))).toBe(1340000);
  });

  test("zero — a real figure, not a missing one", () => {
    expect(toAxisValue(minor(0n))).toBe(0);
  });

  test("a negative profit — a loss-making vehicle is an ordinary case here, not an edge one", () => {
    expect(toAxisValue(minor(-4_600_00n))).toBe(-460000);
  });

  test("mixed-sign domain — one call each, independent of the other's sign", () => {
    expect(toAxisValue(minor(500_00n))).toBe(50000);
    expect(toAxisValue(minor(-500_00n))).toBe(-50000);
  });

  test("exactly Number.MAX_SAFE_INTEGER still converts", () => {
    const atLimit = minor(BigInt(Number.MAX_SAFE_INTEGER));
    expect(toAxisValue(atLimit)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("past Number.MAX_SAFE_INTEGER throws a controlled error rather than losing precision silently", () => {
    const overLimit = minor(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    expect(() => toAxisValue(overLimit)).toThrow(RangeError);
  });

  test("past the negative limit also throws", () => {
    const underLimit = minor(BigInt(Number.MIN_SAFE_INTEGER) - 1n);
    expect(() => toAxisValue(underLimit)).toThrow(RangeError);
  });
});
