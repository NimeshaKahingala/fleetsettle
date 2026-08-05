import { neon, Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.js";

/**
 * Two modes, chosen deliberately (IG §4.1): `neon()` for a single-statement
 * read in one HTTP round trip, `Pool` for anything writing more than one row,
 * where an interactive transaction is required. Never held in module scope —
 * isolates are reused across requests, connections are not safe to share.
 *
 * Both are wrapped in Drizzle (IG §1.6, §3.1: "Drizzle is the typed query
 * layer") rather than handed to `queries/` raw. A raw `sql` fragment is still
 * available via `db.execute(sql\`...\`)` for the rare case that needs it
 * (`/api/ready`'s literal `SELECT 1`) — the wrapping adds types, it does not
 * remove the escape hatch.
 */
export const reader = (url: string) => drizzleHttp(neon(url), { schema });
export const writer = (url: string) => drizzlePool(new Pool({ connectionString: url }), { schema });

export type Reader = ReturnType<typeof reader>;
export type Writer = ReturnType<typeof writer>;

/**
 * The type Drizzle passes into a `writer.transaction(async (tx) => …)`
 * callback — the same `.insert`/`.select`/… surface as `Writer`, scoped to
 * one transaction. `queries/` functions that a domain module runs inside a
 * transaction accept `Writer | Tx` so the same query works standalone or
 * transactionally, without importing `drizzle-orm/pg-core`'s transaction
 * type by hand.
 */
export type Tx = Parameters<Parameters<Writer["transaction"]>[0]>[0];

/**
 * F-8.6/INV-28/migration 0002: `write_audit_log()` records `changed_by` from
 * `current_setting('fleetsettle.actor_id')`, but nothing was ever setting it —
 * every audit_log row since P3 has a NULL `changed_by` (found while building
 * P9, which is what actually reads the trail). Rather than teach all fifteen
 * domain files to remember a `SET LOCAL` at the top of every transaction —
 * the same "developer remembered" failure mode migration 0002's own comment
 * warns about — this wraps `.transaction` exactly once, at the one door every
 * write already goes through (`c.get("writer")`, IG §4.1). `getActorId` is
 * read lazily, at the moment a transaction actually opens, so `dbMiddleware`
 * can construct this before `authMiddleware` has resolved `userId` into
 * context — by the time any handler calls `.transaction(...)`, it has.
 */
export function withActor(target: Writer, getActorId: () => string | undefined): Writer {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop === "transaction") {
        // No call site in this codebase passes `.transaction`'s optional
        // second (isolation-level) argument, so the wrapper only needs to
        // forward the callback — narrower than Writer["transaction"]'s own
        // generic signature, but everything that type-checks against it
        // still type-checks against this.
        return function actorScopedTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
          return obj.transaction(async (tx) => {
            const actorId = getActorId();
            if (actorId !== undefined) {
              await tx.execute(sql`SELECT set_config('fleetsettle.actor_id', ${actorId}, true)`);
            }
            return fn(tx);
          });
        };
      }
      const value: unknown = Reflect.get(obj, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(obj)
        : value;
    },
  });
}
