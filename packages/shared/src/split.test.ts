import { describe, expect, it } from "vitest";
import { splitInteger } from "./split.js";

describe("splitInteger — largest remainder, on plain integers", () => {
  it("reproduces §7.3's 300km excess split by days (31 / 30) as 152 / 148", () => {
    expect(splitInteger(300n, [31n, 30n])).toEqual([152n, 148n]);
  });

  it("always sums back to the total, for arbitrary weights", () => {
    const cases: [bigint, bigint[]][] = [
      [10n, [1n, 1n, 1n]],
      [7n, [2n, 3n, 5n]],
      [1n, [1n, 1n, 1n, 1n]],
      [1000n, [7n, 11n, 13n]],
    ];
    for (const [total, weights] of cases) {
      const parts = splitInteger(total, weights);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
    }
  });

  it("is deterministic — the same input always produces the same output", () => {
    expect(splitInteger(10n, [1n, 1n, 1n])).toEqual(splitInteger(10n, [1n, 1n, 1n]));
  });

  it("splits a negative total the same way, sign reapplied", () => {
    const parts = splitInteger(-10n, [1n, 1n, 1n]);
    expect(parts).toEqual([-4n, -3n, -3n]);
  });

  it("refuses weights that cannot produce a split", () => {
    expect(() => splitInteger(100n, [])).toThrow(RangeError);
    expect(() => splitInteger(100n, [0n, 0n])).toThrow(RangeError);
    expect(() => splitInteger(100n, [1n, -1n])).toThrow(RangeError);
  });
});
