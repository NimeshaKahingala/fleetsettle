import type { Reader, Writer } from "./db/client.js";
import type { Role } from "./auth/policy.js";

/** Wrangler bindings (TS §8). Secrets and vars both arrive here — Workers have no process.env. */
export interface Bindings {
  DATABASE_URL: string;
  ENVIRONMENT: "development" | "preview" | "production";
  ASGARDEO_ISSUER: string;
  ASGARDEO_JWKS_URL: string;
  ASGARDEO_AUDIENCE: string;
  KV: KVNamespace;
  R2: R2Bucket;
  MESSAGE_QUEUE: Queue;
  // IG §13: never a database row per request — this is the sanctioned way.
  RATE_LIMITER: RateLimit;
}

/** Populated by middleware, per request. */
export interface Variables {
  requestId: string;
  reader: Reader;
  writer: Writer;
  // Set by auth/middleware.ts (P1) once the token is verified and the sub
  // resolves to either a business_member or a linked driver (queries/identity.ts).
  businessId?: string;
  userId?: string;
  role?: Role;
  // Only set when role is "driver" — the boundary in IG §7.1 rule 4 is
  // enforced by scoping queries to this id, never by trusting a token claim.
  driverId?: string;
  // Set by the global error handler so the request logger does not emit a
  // second, duplicate line for a request it has already logged with a stack.
  errorLogged?: boolean;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}
