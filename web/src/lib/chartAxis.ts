import type { Minor } from "@fleetsettle/shared";

/**
 * B4/§6: the one place a chart axis is allowed to touch `Number()` on a
 * money value — every report screen imports this rather than writing its
 * own `Number(minor)`, the same reason `money.ts` itself is one module
 * used at both edges (CLAUDE.md → Money). Recharts' own scale/axis props
 * take `number`, not `bigint`, so a boundary conversion is unavoidable
 * somewhere; this is the only somewhere.
 *
 * LKR cents sit well inside `Number.MAX_SAFE_INTEGER` for any figure this
 * product will ever chart (a single vehicle-month's profit, not a
 * multi-year total) — but "well inside" is not "always inside", and a
 * chart axis that silently lost precision on a number nobody could
 * reproduce is exactly the failure `money.ts`'s own doc comment warns
 * about, one layer up. Thrown, not clamped: a bar rendered at the wrong
 * height is a wrong number on screen, which this whole codebase treats as
 * worse than a crash.
 */
export function toAxisValue(minor: Minor): number {
  const raw: bigint = minor;
  if (raw > BigInt(Number.MAX_SAFE_INTEGER) || raw < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `${raw.toString()} minor units is outside Number.MAX_SAFE_INTEGER — cannot chart it`,
    );
  }
  // eslint-disable-next-line no-restricted-syntax -- the one sanctioned Number(Minor) boundary (this file's own doc comment)
  return Number(raw);
}
