import { neon, Pool } from "@neondatabase/serverless";
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
