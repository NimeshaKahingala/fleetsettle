/**
 * The money codec. Imported by both sides, and byte-identical on both by
 * construction rather than by agreement (IG §2, §4.4).
 *
 * Money is `bigint` minor units in domain code, `string` on the wire, and never
 * a `number` anywhere. LKR cents sit well inside MAX_SAFE_INTEGER, so a Number
 * round-trip will never fail a test — it only loses a rounding argument two
 * years from now, in a conversation about a figure nobody can reproduce.
 */
import { splitInteger } from "./split.js";
import { WireFormatError } from "./wire-format-error.js";

/** Whole minor units — LKR cents. Branded so a bare bigint cannot pass for one. */
export type Minor = bigint & { readonly __minor: unique symbol };

const brand = (v: bigint): Minor => v as Minor;

/** Drop the brand for arithmetic. The brand exists at the boundaries, not inside. */
const raw = (v: Minor): bigint => v;

export const ZERO: Minor = brand(0n);

/** U+2212 MINUS SIGN. Not a hyphen — it aligns with digits in a tabular column. */
const MINUS = "−";

/**
 * GAP-180/B7: the negative lookahead rejects `"-0"` (and `"-00"`, `"-000"`)
 * while accepting every value this pattern already accepted. Negative zero
 * is the one wire string that does not survive a round trip —
 * `parse("-0")` is `0n`, `toWire(0n)` is `"0"` — so a client that sent it
 * back would be sending a different string than it received, on a money
 * field.
 *
 * **Written as a lookahead rather than an alternation, after SonarCloud
 * (`typescript:S8786`) flagged the first form on PR #120.** That form,
 * `^(?:\d+|-\d*[1-9]\d*)$`, scans for the first non-zero digit by
 * backtracking `\d*`, so its cost grows with the length of an all-zero
 * negative input. Not catastrophic — measured linear, not exponential — but
 * this runs on every money value crossing the wire, and `^-0+$` is a flat
 * check for exactly the string being excluded. Behaviour is identical on
 * every case the test file pins, and ~9× faster on a 20,000-digit input.
 *
 * **Deliberately not tightened any further.** Leading zeros (`"007"`) stay
 * legal, and `fromInput` stays more permissive than this: `parse` reads the
 * **wire** shape (integer minor units) and `fromInput` reads what a person
 * **typed** (major-unit decimals, commas). They are different grammars on
 * purpose, and making them agree would be a regression, not a fix.
 */
const WIRE = /^(?!-0+$)-?\d+$/;

/**
 * Parse the wire shape. The wire carries minor units as a decimal string, so
 * "134000" is Rs 1,340.00 — there is no decimal point to misplace.
 */
export function parse(wire: string): Minor {
  if (!WIRE.test(wire)) {
    throw new WireFormatError(`Not a money value: ${JSON.stringify(wire)}`);
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
  return splitInteger(raw(total), weights).map(brand);
}

export const add = (a: Minor, b: Minor): Minor => brand(raw(a) + raw(b));
export const subtract = (a: Minor, b: Minor): Minor => brand(raw(a) - raw(b));
export const negate = (a: Minor): Minor => brand(-raw(a));
export const isZero = (a: Minor): boolean => a === 0n;

/**
 * GAP-198: a plain `dividend / BigInt(divisor)` truncates — Rs 33,000 / 90
 * read Rs 366.66 instead of the required half-up Rs 366.67 (a per-day
 * revenue figure, `reports.ts`'s own `revenuePerAvailableDayMinor`). This
 * is a division, not a split — `split()` above answers "how do N weighted
 * shares add back to a whole exactly," a different question with a
 * different algorithm (largest-remainder) than "what is this one ratio,
 * rounded." Symmetric (rounds a negative quotient's magnitude up too,
 * same direction split() already takes for a negative total), so the sign
 * of the result always matches the sign `dividend / divisor` would have
 * produced.
 *
 * Plain `bigint` in and out, not `Minor` — the domain layer's own money
 * arithmetic (this call's own `earnedMinor`, `reports.ts`) is already
 * plain `bigint` end to end rather than threaded through the wire-facing
 * brand, and a branded `Minor` is a `bigint` by construction, so it passes
 * through unchanged wherever a caller already has one.
 */
export function divideHalfUp(dividend: bigint, divisor: bigint): bigint {
  if (divisor === 0n) throw new RangeError("divideHalfUp: divisor must not be zero");
  const negative = dividend < 0n !== divisor < 0n;
  const n = dividend < 0n ? -dividend : dividend;
  const d = divisor < 0n ? -divisor : divisor;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}
