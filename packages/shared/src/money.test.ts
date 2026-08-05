import { describe, expect, it } from "vitest";
import { type Minor, format, fromInput, parse, split, toWire } from "./money.js";

const m = (v: bigint) => v as Minor;

describe("parse and the wire shape", () => {
  it("round-trips", () => {
    expect(toWire(parse("13400000"))).toBe("13400000");
  });

  it("rejects anything that is not whole minor units", () => {
    for (const bad of ["1340.00", "1,340", "", " ", "1e5", "abc", "0x10"]) {
      expect(() => parse(bad)).toThrow(TypeError);
    }
  });
});

describe("fromInput — what a person types", () => {
  it.each([
    ["5000", 500_000n],
    ["5,000", 500_000n],
    ["5000.50", 500_050n],
    ["5,000.5", 500_050n],
    ["0.05", 5n],
    [".5", 50n],
    ["-250", -25_000n],
  ])("%s → %s", (input, expected) => {
    expect(fromInput(input)).toBe(expected);
  });

  it("returns null rather than throwing, because it runs on every keystroke", () => {
    for (const partial of ["", "  ", "-", "abc", "1.234"]) {
      expect(fromInput(partial)).toBeNull();
    }
  });
});

describe("format", () => {
  it("uses U+2212, not a hyphen — it aligns with digits in a tabular column", () => {
    const out = format(m(-500_000n));
    expect(out.startsWith("−")).toBe(true);
    expect(out.includes("-")).toBe(false);
  });

  it("suppresses cents when they are zero and shows them when they are not (M-16)", () => {
    expect(format(m(500_000n))).toBe("5,000");
    expect(format(m(500_050n))).toBe("5,000.50");
    expect(format(m(5n))).toBe("0.05");
  });

  it("forces cents when asked, so a column can be made uniform", () => {
    expect(format(m(500_000n), { cents: true })).toBe("5,000.00");
  });

  it("groups thousands", () => {
    expect(format(m(13_400_000n))).toBe("134,000");
  });
});

describe("split — largest remainder", () => {
  it("keeps 300 across two equal owners at 152 / 148, never 152 / 147", () => {
    // FL §1.3's worked example. 300 minor units, 50/50: exact shares are 150
    // each, so this case is clean — the one below is where it bites.
    expect(split(m(300n), [1n, 1n])).toEqual([150n, 150n]);
    expect(split(m(300n), [51n, 49n])).toEqual([153n, 147n]);
  });

  it("always sums back to the whole", () => {
    const cases: Array<[bigint, bigint[]]> = [
      [100n, [1n, 1n, 1n]],
      [1n, [1n, 1n, 1n]],
      [7_500n, [152n, 148n]],
      [13_400_000n, [1n, 2n, 3n, 5n, 7n]],
      [999_999_999_999n, [1n, 1n, 1n, 1n, 1n, 1n, 1n]],
    ];
    for (const [total, weights] of cases) {
      const parts = split(m(total), weights);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
    }
  });

  it("hands the remainder to the largest fractional shares", () => {
    // 10 across 1:1:1 — exact is 3.33 each, so one unit is left over and goes
    // to the first two by index once the fractions tie.
    expect(split(m(10n), [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
  });

  it("is stable — the same input always gives the same output", () => {
    const a = split(m(10n), [1n, 1n, 1n]);
    const b = split(m(10n), [1n, 1n, 1n]);
    expect(a).toEqual(b);
  });

  it("sums back to the whole for negative totals too", () => {
    const parts = split(m(-10n), [1n, 1n, 1n]);
    expect(parts.reduce((x, y) => x + y, 0n)).toBe(-10n);
    expect(parts).toEqual([-4n, -3n, -3n]);
  });

  it("refuses weights that cannot produce a split", () => {
    expect(() => split(m(100n), [])).toThrow(RangeError);
    expect(() => split(m(100n), [0n, 0n])).toThrow(RangeError);
    expect(() => split(m(100n), [1n, -1n])).toThrow(RangeError);
  });
});
