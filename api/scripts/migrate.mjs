#!/usr/bin/env node
/**
 * The migration runner. Runs in Node, never in the Worker (IG §2).
 *
 *   node api/scripts/migrate.mjs            apply anything outstanding
 *   node api/scripts/migrate.mjs --status   report, change nothing
 *   node api/scripts/migrate.mjs --check    report, change nothing, exit 1 if anything is pending
 *
 * Reads DATABASE_URL from the environment or from api/.dev.vars.
 *
 * Two pieces of hardening that IG §11 requires before the first migration lands,
 * because both failures are silent:
 *
 *   An advisory lock around the whole run. Two concurrent deploys can otherwise
 *   both read an empty _migrations table and both apply 0001, and the second one
 *   fails somewhere in the middle of a schema that is now half applied.
 *
 *   A SHA-256 per filename. An already-applied migration that is later edited is
 *   a file that disagrees with every database that ran it — silently, forever.
 *   Editing it is not the fix; the fix is always another migration.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, "..", "migrations");
const LOCK_KEY = 8_675_309; // arbitrary, but must be the same in every process

const statusOnly = process.argv.includes("--status");
const checkOnly = process.argv.includes("--check");

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

function pending() {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((name) => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) {
      throw new Error(`Migration name is not NNNN_lower_snake_case.sql: ${name}`);
    }
    const sql = readFileSync(resolve(MIGRATIONS, name), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

const pool = new Pool({ connectionString: databaseUrl() });
const client = await pool.connect();
let held = false;
let exitCode = 0;

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  held = true;

  const { rows } = await client.query("SELECT name, checksum FROM _migrations");
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));

  let ran = 0;
  let outstanding = 0;
  const reportOnly = statusOnly || checkOnly;

  for (const migration of pending()) {
    const seen = applied.get(migration.name);

    if (seen) {
      if (seen !== migration.checksum) {
        throw new Error(
          `${migration.name} has changed since it was applied.\n` +
            `  applied: ${seen}\n  on disk: ${migration.checksum}\n` +
            "Migrations are forward-only. Every database that already ran this file " +
            "disagrees with it now, and editing it further cannot reconcile them. " +
            "Revert the edit and write the correction as a new migration.",
        );
      }
      if (statusOnly) console.log(`  applied  ${migration.name}`);
      continue;
    }

    outstanding += 1;

    if (reportOnly) {
      if (statusOnly) console.log(`  PENDING  ${migration.name}`);
      continue;
    }

    process.stdout.write(`  applying ${migration.name} … `);
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query("INSERT INTO _migrations (name, checksum) VALUES ($1, $2)", [
        migration.name,
        migration.checksum,
      ]);
      await client.query("COMMIT");
      console.log("ok");
      ran += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      console.log("failed");
      throw error;
    }
  }

  if (!reportOnly) {
    console.log(ran === 0 ? "nothing to apply" : `applied ${ran} migration(s)`);
  }

  if (checkOnly) {
    console.log(outstanding === 0 ? "nothing pending" : `${outstanding} migration(s) pending`);
    if (outstanding > 0) exitCode = 1;
  }
} finally {
  if (held) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  client.release();
  await pool.end();
}

process.exitCode = exitCode;
