/**
 * `obligation.status`, computed the same way everywhere it changes
 * (adjustments, offsets, and any future settle path) — one function so the
 * three callers can never quietly disagree with each other.
 *
 * `settled_minor + waived_minor <= amount_minor` is DM §10.1's own CHECK.
 * Fully settled in cash wins the 'paid' label even if an earlier partial
 * waiver also touched this obligation; short of that, reaching the full
 * amount through settlement plus waiver reads as 'waived' — the remainder
 * was forgiven, not collected.
 */
export function computeObligationStatus(
  amountMinor: bigint,
  settledMinor: bigint,
  waivedMinor: bigint,
): "pending" | "part_paid" | "paid" | "waived" {
  if (settledMinor >= amountMinor) return "paid";
  if (settledMinor + waivedMinor >= amountMinor) return "waived";
  if (settledMinor > 0n || waivedMinor > 0n) return "part_paid";
  return "pending";
}
