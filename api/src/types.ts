import type { NeonQueryFunction, Pool } from "@neondatabase/serverless";

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
}

/** Populated by middleware, per request. businessId/userId land with P1's auth middleware. */
export interface Variables {
  requestId: string;
  reader: NeonQueryFunction<false, false>;
  writer: Pool;
  businessId?: string;
  userId?: string;
  // Set by the global error handler so the request logger does not emit a
  // second, duplicate line for a request it has already logged with a stack.
  errorLogged?: boolean;
}

export interface Env {
  Bindings: Bindings;
  Variables: Variables;
}
