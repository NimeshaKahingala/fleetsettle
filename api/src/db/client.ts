import { neon, Pool } from "@neondatabase/serverless";

/**
 * Two modes, chosen deliberately (IG §4.1): `neon()` for a single-statement
 * read in one HTTP round trip, `Pool` for anything writing more than one row,
 * where an interactive transaction is required. Never held in module scope —
 * isolates are reused across requests, connections are not safe to share.
 */
export const reader = (url: string) => neon(url);
export const writer = (url: string) => new Pool({ connectionString: url });

export type Reader = ReturnType<typeof reader>;
export type Writer = ReturnType<typeof writer>;
