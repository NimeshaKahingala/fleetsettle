/**
 * W-57/W-42: the code shared out of band for both `business_member_invite`
 * and `driver_link_invite` — same shape, one helper. Web Crypto only
 * (`crypto.getRandomValues`/`crypto.subtle`), never Node's `crypto` module
 * (api/CLAUDE.md: no Node globals in the Worker runtime).
 *
 * Only the hash is ever stored — `code_hash` on both tables (DM §3, §5) —
 * so a database read alone can never produce a redeemable code.
 */

// Crockford-style, uppercase, no 0/O/1/I/L — nothing a person reads over the
// phone or types on a cramped keyboard can be confused for another symbol.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_CHARS = 10;
export const INVITE_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // W-57/W-42: a week to hand it over

/** ~49 bits of entropy, grouped for readability. Never guessable — this is the only copy of the plaintext that will ever exist. */
export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_CHARS));
  // .charAt(), not indexing — noUncheckedIndexedAccess would type ALPHABET[n]
  // as `string | undefined` even though `n` is always in range by construction.
  const chars = Array.from(bytes, (b) => ALPHABET.charAt(b % ALPHABET.length));
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

/** Normalises case/whitespace before hashing so a redeem attempt matches regardless of how the code was retyped. */
export async function hashInviteCode(code: string): Promise<string> {
  const normalised = code.trim().toUpperCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalised));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
