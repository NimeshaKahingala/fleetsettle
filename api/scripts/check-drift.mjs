#!/usr/bin/env node
/**
 * DM §13's drift assertions, runnable rather than something to remember to ask
 * for. Two of them now — the period-open/audit pair, and GAP-178's archive
 * guard, which covers a different set of tables and so asks a different
 * question. This is the check that caught `trip` missing from the period-open array
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

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import { databaseUrl } from "./lib/database-url.mjs";

neonConfig.webSocketConstructor = ws;

const HERE = dirname(fileURLToPath(import.meta.url));

const read = (name) => readFileSync(resolve(HERE, name), "utf8");

const pool = new Pool({ connectionString: databaseUrl() });
const periodOpenAndAudit = (await pool.query(read("assert-no-trigger-drift.sql"))).rows;
const archiveGuard = (await pool.query(read("assert-no-archive-guard-drift.sql"))).rows;
await pool.end();

if (periodOpenAndAudit.length === 0 && archiveGuard.length === 0) {
  console.log(
    "drift check: clean — every posted_period_id table has both triggers, " +
      "and every party-referencing money table has its archive guard",
  );
  process.exit(0);
}

if (periodOpenAndAudit.length > 0) {
  console.error(`${periodOpenAndAudit.length} table(s) missing a required trigger:\n`);
  for (const r of periodOpenAndAudit) {
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
}

// GAP-178/B13. A separate list because it is a different set of tables:
// "carries posted_period_id" above, "carries posted_period_id *and* names a
// driver or customer" here. Migration 0031 attaches these from the catalogue,
// but like 0002's block it runs once — a party-referencing money table added
// afterwards accrues money against archived parties in silence.
if (archiveGuard.length > 0) {
  console.error(
    `\n${archiveGuard.length} party-referencing money table(s) missing the archive guard:\n`,
  );
  for (const r of archiveGuard) {
    console.error(`  ${r.table_name} — missing: assert_party_not_archived`);
  }
  console.error(
    "\nWrite a migration attaching `<table>_archive_guard` (BEFORE INSERT, " +
      "FOR EACH ROW, assert_party_not_archived) — migration 0031 is the shape " +
      "to copy. Never patch this by hand against a live database.",
  );
}

process.exit(1);
