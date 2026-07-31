import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bindings } from "../../src/types.js";

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
 * Passed as the third argument to `app.request(path, init, TEST_ENV)`
 * (support/client.ts) — the full middleware chain, no server (IG §8.3).
 *
 * KV/R2/MESSAGE_QUEUE are unavailable-by-default stubs: nothing exercises them
 * yet (JWKS caching is P1, R2 attachments and the message queue are later),
 * and a stub that throws on first use is more honest than one that silently
 * no-ops.
 */
export const TEST_ENV: Bindings = {
  DATABASE_URL: TEST_DATABASE_URL,
  ENVIRONMENT: "development",
  ASGARDEO_ISSUER: read("ASGARDEO_ISSUER") ?? "https://api.asgardeo.io/t/fleetsettle/oauth2/token",
  ASGARDEO_JWKS_URL:
    read("ASGARDEO_JWKS_URL") ?? "https://api.asgardeo.io/t/fleetsettle/oauth2/jwks",
  ASGARDEO_AUDIENCE: read("ASGARDEO_AUDIENCE") ?? "OEWdJbFmoc65GbQkr4WwuBlEfnUa",
  KV: unavailableBinding<KVNamespace>("KV"),
  R2: unavailableBinding<R2Bucket>("R2"),
  MESSAGE_QUEUE: unavailableBinding<Queue>("MESSAGE_QUEUE"),
};
