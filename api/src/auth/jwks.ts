import type { JSONWebKeySet } from "jose";

// Exported so tests can pre-seed a fake KV with a known keyset (tests/support/
// jwks.ts) rather than mocking `fetch` — the real cache-hit path runs
// unmodified either way.
export const KV_KEY = "asgardeo:jwks";

// A generous TTL — refetch-on-kid-miss (verify.ts) is what actually keeps
// this current across a key rotation; the TTL just bounds how long a KV
// entry survives if nothing ever misses.
const KV_TTL_SECONDS = 6 * 60 * 60;

async function fetchAndCache(kv: KVNamespace, jwksUrl: string): Promise<JSONWebKeySet> {
  const res = await fetch(jwksUrl);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${String(res.status)} ${jwksUrl}`);
  }
  const jwks: JSONWebKeySet = await res.json();
  await kv.put(KV_KEY, JSON.stringify(jwks), { expirationTtl: KV_TTL_SECONDS });
  return jwks;
}

/**
 * IG §7.1 rule 3: JWKS cached in KV, refetched on `kid` miss. Isolates are
 * horizontally scaled and short-lived — an in-memory cache (what
 * `jose.createRemoteJWKSet` gives you for free) only helps the isolate that
 * fetched it, not the next cold one. KV is the shared cache across all of them.
 */
export async function getJwks(
  kv: KVNamespace,
  jwksUrl: string,
  options: { forceRefresh?: boolean } = {},
): Promise<JSONWebKeySet> {
  if (!options.forceRefresh) {
    const cached = await kv.get<JSONWebKeySet>(KV_KEY, "json");
    if (cached) return cached;
  }
  return fetchAndCache(kv, jwksUrl);
}
