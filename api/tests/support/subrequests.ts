/**
 * GAP-145: counts outbound `fetch` calls made while `fn` runs — the same
 * measurement that found the original 500 (`GET /api/partner/{userId}`
 * hitting Workers Free's 50-subrequest ceiling at 79 for one six-vehicle
 * business). Each Neon HTTP query (`reader()`, `@neondatabase/serverless`'s
 * `neon()`) is one `fetch`, so counting them here is the same unit Cloudflare
 * counts in production — a real ceiling test, not a proxy for one.
 *
 * Restores the real `fetch` in a `finally`, so a thrown assertion inside
 * `fn` never leaves later tests counting against a wrapped global.
 */
export async function countFetches<T>(fn: () => Promise<T>): Promise<{ result: T; count: number }> {
  const realFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (...args: Parameters<typeof realFetch>) => {
    count += 1;
    return realFetch(...args);
  };
  try {
    const result = await fn();
    return { result, count };
  } finally {
    globalThis.fetch = realFetch;
  }
}
