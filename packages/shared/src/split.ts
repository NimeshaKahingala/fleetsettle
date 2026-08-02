/**
 * Largest-remainder splitting, on plain integers. `money.ts`'s `split` wraps
 * this for `Minor` amounts; `mileage_assessment_split` (DM §6, INV-26) uses it
 * directly on kilometres, which are never money and never branded.
 *
 * The parts always add back to the whole — the entire point (W-54). The
 * remainder goes to the largest fractional shares, ties broken by the
 * earlier position, so the same input always produces the same output.
 */
export function splitInteger(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) throw new RangeError("splitInteger needs at least one weight");
  if (weights.some((w) => w < 0n)) throw new RangeError("weights cannot be negative");

  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new RangeError("weights cannot sum to zero");

  // Work on the magnitude so flooring truncates toward zero on both signs; the
  // sign is reapplied at the end. Otherwise a negative split rounds the wrong
  // way and the parts stop summing to the whole.
  const negative = total < 0n;
  const abs = negative ? -total : total;

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
    return negative ? -part : part;
  });
}
