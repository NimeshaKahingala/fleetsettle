#!/usr/bin/env node
/**
 * DM §13's drift assertion, runnable rather than something to remember to ask
 * for. This is the check that caught `trip` missing from the period-open array
 * during P0 — the array is hand-maintained, and a hand-maintained list is
 * exactly the kind of thing that goes stale the next time someone adds a money
 * table and forgets this step.
 *
 *   node api/scripts/check-drift.mjs
 *
 * Exit 0 and prints nothing on success. Exit 1 and lists every gap otherwise —
 * wired into the migrations CI job so a drifted table fails the PR instead of
 * waiting to be noticed after it has already accepted a write into a closed
 * period.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const HERE = dirname(fileURLToPath(import.meta.url));

function databaseUrl() {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const devVars = resolve(HERE, "..", ".dev.vars");
  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, "utf8").split("\n")) {
      const m = /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*(?:#.*)?$/.exec(line);
      if (m?.[1]) return m[1];
    }
  }
  throw new Error("DATABASE_URL is not set, and api/.dev.vars does not define it");
}

const sql = readFileSync(resolve(HERE, "assert-no-trigger-drift.sql"), "utf8");

const pool = new Pool({ connectionString: databaseUrl() });
const { rows } = await pool.query(sql);
await pool.end();

if (rows.length === 0) {
  console.log("drift check: clean — every posted_period_id table has both triggers");
  process.exit(0);
}

console.error(`${rows.length} table(s) missing a required trigger:\n`);
for (const r of rows) {
  const gaps = [r.missing_period_open && "assert_period_open", r.missing_audit && "audit writer"]
    .filter(Boolean)
    .join(", ");
  console.error(`  ${r.table_name} — missing: ${gaps}`);
}
console.error(
  "\nAdd the table to the FOREACH array in the migration that attaches these " +
    "triggers (DM §13), or write a migration that does. Never patch this by " +
    "hand against a live database.",
);
process.exit(1);
