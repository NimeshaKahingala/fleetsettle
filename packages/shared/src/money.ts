/**
 * The money codec. Imported by both sides, and byte-identical on both by
 * construction rather than by agreement (IG §2, §4.4).
 *
 * Money is `bigint` minor units in domain code, `string` on the wire, and never
 * a `number` anywhere. LKR cents sit well inside MAX_SAFE_INTEGER, so a Number
 * round-trip will never fail a test — it only loses a rounding argument two
 * years from now, in a conversation about a figure nobody can reproduce.
 */

/** Whole minor units — LKR cents. Branded so a bare bigint cannot pass for one. */
export type Minor = bigint & { readonly __minor: unique symbol };

const brand = (v: bigint): Minor => v as Minor;

/** Drop the brand for arithmetic. The brand exists at the boundaries, not inside. */
const raw = (v: Minor): bigint => v;

export const ZERO: Minor = brand(0n);

/** U+2212 MINUS SIGN. Not a hyphen — it aligns with digits in a tabular column. */
const MINUS = "−";

const WIRE = /^-?\d+$/;

/**
 * Parse the wire shape. The wire carries minor units as a decimal string, so
 * "134000" is Rs 1,340.00 — there is no decimal point to misplace.
 */
export function parse(wire: string): Minor {
  if (!WIRE.test(wire)) {
    throw new TypeError(`Not a money value: ${JSON.stringify(wire)}`);
  }
  return brand(BigInt(wire));
}

/** The wire shape. Always a string, never a number, at both edges. */
export const toWire = (v: Minor): string => v.toString();

/**
 * Parse what a person typed — "5000", "5,000", "5000.50", "5,000.5".
 * Returns null rather than throwing, because this runs on every keystroke.
 */
export function fromInput(text: string): Minor | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (cleaned === "") return null;

  const matched = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!matched) return null;

  const sign = matched[1] ?? "";
  const whole = matched[2] ?? "";
  const frac = matched[3];

  // "-" alone, or "." alone, is a person mid-keystroke rather than an amount.
  if (whole === "" && (frac === undefined || frac === "")) return null;

  const cents = (frac ?? "").padEnd(2, "0");
  const magnitude = BigInt(whole === "" ? "0" : whole) * 100n + BigInt(cents);
  return brand(sign === "-" ? -magnitude : magnitude);
}

const grouped = new Intl.NumberFormat(["en-LK", "en"]);

/**
 * Format for display. Cents appear when they are non-zero, and are suppressed
 * when they are not — a column of round thousands reads better without a wall
 * of `.00`, and the moment one figure has cents every figure shows them (M-16).
 */
export function format(v: Minor, opts?: { cents?: boolean }): string {
  const value = raw(v);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const major = abs / 100n;
  const cents = abs % 100n;

  const showCents = opts?.cents ?? cents !== 0n;
  const body = grouped.format(major) + (showCents ? `.${String(cents).padStart(2, "0")}` : "");

  return (negative ? MINUS : "") + body;
}

/**
 * Split an amount across weights, largest-remainder.
 *
 * The parts always add back to the whole. That is the entire point: a rent
 * split of 300 across two owners must be 152 / 148 and never 152 / 147, or the
 * two halves of a report stop agreeing with each other (W-54, FL §1.3).
 *
 * The remainder goes to the largest fractional shares, ties broken by the
 * earlier position, so the same input always produces the same output.
 */
export function split(total: Minor, weights: readonly bigint[]): Minor[] {
  if (weights.length === 0) throw new RangeError("split needs at least one weight");
  if (weights.some((w) => w < 0n)) throw new RangeError("weights cannot be negative");

  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new RangeError("weights cannot sum to zero");

  // Work on the magnitude so flooring truncates toward zero on both signs; the
  // sign is reapplied at the end. Otherwise a negative split rounds the wrong
  // way and the parts stop summing to the whole.
  const value = raw(total);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const shares = weights.map((w, i) => {
    const exact = (abs * w) / sum;
    return { i, exact, remainder: abs * w - exact * sum };
  });

  let left = abs - shares.reduce((a, s) => a + s.exact, 0n);

  // Largest remainder first; the earlier index wins a tie, so the same input
  // always produces the same output.
  const byRemainder = [...shares].sort((a, b) =>
    b.remainder === a.remainder ? a.i - b.i : b.remainder > a.remainder ? 1 : -1,
  );

  const gainsOne = new Set<number>();
  for (const share of byRemainder) {
    if (left === 0n) break;
    gainsOne.add(share.i);
    left -= 1n;
  }

  return shares.map((share) => {
    const part = share.exact + (gainsOne.has(share.i) ? 1n : 0n);
    return brand(negative ? -part : part);
  });
}

export const add = (a: Minor, b: Minor): Minor => brand(raw(a) + raw(b));
export const subtract = (a: Minor, b: Minor): Minor => brand(raw(a) - raw(b));
export const negate = (a: Minor): Minor => brand(-raw(a));
export const isZero = (a: Minor): boolean => a === 0n;
