import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KV_KEY } from "../../src/auth/jwks.js";
import type { Bindings } from "../../src/types.js";
import { TEST_JWKS } from "./jwks.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseDevVars(): Record<string, string> {
  const path = resolve(HERE, "..", "..", ".dev.vars");
  if (!existsSync(path)) return {};

  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*(?:#.*)?$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

const devVars = parseDevVars();
const read = (key: string): string | undefined => process.env[key] ?? devVars[key];

const testDatabaseUrl = read("TEST_DATABASE_URL");
const devDatabaseUrl = read("DATABASE_URL");

// The non-negotiable safety rail (IG §8.3): integration tests write real rows.
// Pointed at the wrong database, "cleanup" deletes rows a person entered.
if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Point it at a disposable Neon branch — " +
      "set it in the environment or in api/.dev.vars (IG §8.3).",
  );
}
if (testDatabaseUrl === devDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL must not equal DATABASE_URL — that would run the " +
      "integration suite, and its cleanup, against real data (IG §8.3).",
  );
}

export const TEST_DATABASE_URL: string = testDatabaseUrl;

/** Throws with a clear message rather than "undefined is not a function" when hit. */
function unavailableBinding<T>(name: string): T {
  return new Proxy(
    {},
    {
      get(): never {
        throw new Error(
          `env.${name} is not wired in tests yet — add a fake when a test first needs it.`,
        );
      },
    },
  ) as T;
}

/**
 * An in-memory KV, real enough for auth/jwks.ts: `get`/`put` with the same
 * "json" round trip. Not the full KVNamespace surface (no `list`, no
 * metadata) — nothing here exercises those yet.
 */
function fakeKV(): KVNamespace {
  const store = new Map<string, string>();

  const get = ((key: string, type?: unknown) => {
    const raw = store.get(key);
    if (raw === undefined) return Promise.resolve(null);
    return Promise.resolve(type === "json" ? (JSON.parse(raw) as unknown) : raw);
  }) as KVNamespace["get"];

  const put = ((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  }) as KVNamespace["put"];

  return { get, put } as unknown as KVNamespace;
}

/** Always allows — rate limiting (IG §13) is a production concern, not this suite's. */
function permissiveRateLimiter(): RateLimit {
  return { limit: () => Promise.resolve({ success: true }) };
}

const testKV = fakeKV();
// Pre-seeded so auth/verify.ts's cache-hit path runs for real without a
// network call — the cache-miss/refetch-on-kid-miss paths are exercised
// directly in src/auth/jwks.test.ts (the "unit" project), not here.
await testKV.put(KV_KEY, JSON.stringify(TEST_JWKS));

/**
 * Passed as the third argument to `app.request(path, init, TEST_ENV)`
 * (support/client.ts) — the full middleware chain, no server (IG §8.3).
 *
 * R2/MESSAGE_QUEUE are still unavailable-by-default stubs: nothing exercises
 * them yet (attachments and the message queue are much later), and a stub
 * that throws on first use is more honest than one that silently no-ops.
 */
export const TEST_ENV: Bindings = {
  DATABASE_URL: TEST_DATABASE_URL,
  ENVIRONMENT: "development",
  ASGARDEO_ISSUER: read("ASGARDEO_ISSUER") ?? "https://api.asgardeo.io/t/fleetsettle/oauth2/token",
  ASGARDEO_JWKS_URL:
    read("ASGARDEO_JWKS_URL") ?? "https://api.asgardeo.io/t/fleetsettle/oauth2/jwks",
  ASGARDEO_AUDIENCE: read("ASGARDEO_AUDIENCE") ?? "OEWdJbFmoc65GbQkr4WwuBlEfnUa",
  KV: testKV,
  R2: unavailableBinding<R2Bucket>("R2"),
  MESSAGE_QUEUE: unavailableBinding<Queue>("MESSAGE_QUEUE"),
  RATE_LIMITER: permissiveRateLimiter(),
};
