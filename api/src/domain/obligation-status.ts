/**
 * `obligation.status`, computed the same way everywhere it changes
 * (adjustments, offsets, write-offs, and any future settle path) — one
 * function so the callers can never quietly disagree with each other.
 *
 * `settled_minor + waived_minor + written_off_minor <= amount_minor` is
 * DM §10.1's own CHECK. Fully settled in cash wins the 'paid' label even if
 * an earlier partial waiver or write-off also touched this obligation;
 * short of that, reaching the full amount reads as 'written_off' whenever a
 * write-off contributed to it (GAP-203/H-1/D2 — a write-off is a distinct,
 * more severe fact than a waiver, "he'll never pay the last bit" rather
 * than a discount chosen, and `recordWriteOff` already gave it this same
 * precedence unconditionally before write-offs could be partial), otherwise
 * 'waived'. `writtenOffMinor` defaults to 0 so every pre-existing call site
 * (none of which has ever touched a write-off) is unchanged.
 */
export function computeObligationStatus(
  amountMinor: bigint,
  settledMinor: bigint,
  waivedMinor: bigint,
  writtenOffMinor: bigint = 0n,
): "pending" | "part_paid" | "paid" | "waived" | "written_off" {
  if (settledMinor >= amountMinor) return "paid";
  if (settledMinor + waivedMinor + writtenOffMinor >= amountMinor) {
    return writtenOffMinor > 0n ? "written_off" : "waived";
  }
  if (settledMinor > 0n || waivedMinor > 0n || writtenOffMinor > 0n) return "part_paid";
  return "pending";
}
