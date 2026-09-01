/**
 * Settled and re-thrown as a value, so `Promise.all` reports both outcomes
 * rather than the first rejection — the shape every two-real-connections
 * race test in this suite needs (`gap-178-concurrency.test.ts` first, this
 * is that same helper named once rather than redefined per file).
 */
export async function outcome<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, err };
  }
}
