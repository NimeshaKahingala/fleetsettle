import { v7 as uuidv7 } from "uuid";

/**
 * Every primary key in this schema is `uuid`, generated in the app rather than
 * by a column default (DM §2). UUIDv7 specifically — not v4 — because it is
 * time-ordered: inserts stay index-local under this schema's high write rate,
 * where a v4 key would scatter every insert across the whole btree.
 */
export const newId = (): string => uuidv7();
