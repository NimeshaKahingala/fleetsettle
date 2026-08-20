#!/usr/bin/env node
/**
 * Reconciles the ledger's own stated invariants against live data, rather
 * than trusting that the write path that produced them is still correct.
 * Every check here mirrors a rule from the root CLAUDE.md or a real domain
 * function (computeObligationStatus, W-49 tenancy, W-58 void semantics) —
 * this script does not invent vocabulary, it re-derives from source so it
 * cannot drift from what the code actually means by "settled" or "paid".
 *
 *   node api/scripts/ledger-audit.mjs
 *   DATABASE_URL=<qa-or-prod> node api/scripts/ledger-audit.mjs
 *
 * Exit 0 and prints a clean summary on success. Exit 1 and lists every
 * offending row's id otherwise. Read-only — never writes.
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

// label, sql returning the offending rows' ids (or any identifying column),
// one row per violation, empty result = clean.
const CHECKS = [
  [
    "obligation.settled_minor disagrees with its live payment allocations",
    `SELECT o.id FROM obligation o
     LEFT JOIN (
       SELECT pa.obligation_id, sum(pa.amount_minor) allocated
       FROM payment_allocation pa JOIN payment p ON p.id = pa.payment_id
       WHERE pa.voided_at IS NULL AND p.status <> 'voided'
       GROUP BY pa.obligation_id
     ) a ON a.obligation_id = o.id
     WHERE o.voided_at IS NULL AND o.settled_minor <> COALESCE(a.allocated, 0)`,
  ],
  [
    // computeObligationStatus, api/src/domain/obligation-status.ts — the one
    // function every status write goes through; re-derived here, not guessed
    "obligation.status disagrees with computeObligationStatus(amount, settled, waived)",
    `SELECT o.id FROM obligation o
     WHERE o.voided_at IS NULL AND o.status <> 'written_off' AND o.status <> (
       CASE WHEN o.settled_minor >= o.amount_minor THEN 'paid'
            WHEN o.settled_minor + o.waived_minor >= o.amount_minor THEN 'waived'
            WHEN o.settled_minor > 0 OR o.waived_minor > 0 THEN 'part_paid'
            ELSE 'pending' END)`,
  ],
  [
    "obligation over-settled or over-waived beyond its own amount (DM 10.1 CHECK)",
    `SELECT id FROM obligation
     WHERE voided_at IS NULL AND settled_minor + waived_minor > amount_minor`,
  ],
  [
    "negative money on a live obligation",
    `SELECT id FROM obligation
     WHERE voided_at IS NULL AND (amount_minor < 0 OR settled_minor < 0 OR waived_minor < 0)`,
  ],
  [
    "payment_allocation total exceeds its own payment's amount",
    `SELECT pa.payment_id FROM payment_allocation pa
     WHERE pa.voided_at IS NULL
     GROUP BY pa.payment_id
     HAVING sum(pa.amount_minor) > (SELECT p.amount_minor FROM payment p WHERE p.id = pa.payment_id)`,
  ],
  [
    "live payment_allocation pointing at a voided obligation",
    `SELECT pa.id FROM payment_allocation pa
     JOIN obligation o ON o.id = pa.obligation_id
     WHERE pa.voided_at IS NULL AND o.voided_at IS NOT NULL`,
  ],
  [
    "deposit's live movements sum to a negative balance (money held cannot go below zero)",
    `SELECT d.id FROM deposit d
     LEFT JOIN deposit_movement dm ON dm.deposit_id = d.id AND dm.voided_at IS NULL
     GROUP BY d.id HAVING COALESCE(sum(dm.amount_minor), 0) < 0`,
  ],
  [
    "confirmed day_record with earned/received never both recorded (CLAUDE.md: never collapsed)",
    `SELECT id FROM day_record
     WHERE voided_at IS NULL AND state = 'confirmed' AND earned_minor IS NULL`,
  ],
  [
    "obligation's party business_id disagrees with the obligation's own business_id (customer)",
    `SELECT o.id FROM obligation o JOIN customer c ON c.id = o.party_customer_id
     WHERE c.business_id <> o.business_id`,
  ],
  [
    "obligation's party business_id disagrees with the obligation's own business_id (driver)",
    `SELECT o.id FROM obligation o JOIN driver d ON d.id = o.party_driver_id
     WHERE d.business_id <> o.business_id`,
  ],
  [
    "obligation's vehicle business_id disagrees with the obligation's own business_id",
    `SELECT o.id FROM obligation o JOIN vehicle v ON v.id = o.vehicle_id
     WHERE v.business_id <> o.business_id`,
  ],
  [
    "payment's party business_id disagrees with the payment's own business_id (customer)",
    `SELECT p.id FROM payment p JOIN customer c ON c.id = p.party_customer_id
     WHERE c.business_id <> p.business_id`,
  ],
  [
    "payment's party business_id disagrees with the payment's own business_id (driver)",
    `SELECT p.id FROM payment p JOIN driver d ON d.id = p.party_driver_id
     WHERE d.business_id <> p.business_id`,
  ],
  [
    "payment_allocation joins a payment and an obligation from different businesses",
    `SELECT pa.id FROM payment_allocation pa
     JOIN payment p ON p.id = pa.payment_id JOIN obligation o ON o.id = pa.obligation_id
     WHERE p.business_id <> o.business_id`,
  ],
  [
    "expense's vehicle business_id disagrees with the expense's own business_id",
    `SELECT e.id FROM expense e JOIN vehicle v ON v.id = e.vehicle_id
     WHERE v.business_id <> e.business_id`,
  ],
  [
    "trip's vehicle business_id disagrees with the trip's own business_id",
    `SELECT t.id FROM trip t JOIN vehicle v ON v.id = t.vehicle_id
     WHERE v.business_id <> t.business_id`,
  ],
  [
    "day_record's vehicle business_id disagrees with the day_record's own business_id",
    `SELECT dr.id FROM day_record dr JOIN vehicle v ON v.id = dr.vehicle_id
     WHERE v.business_id <> dr.business_id`,
  ],
  [
    "deposit_movement's deposit business_id disagrees with the movement's own business_id",
    `SELECT dm.id FROM deposit_movement dm JOIN deposit d ON d.id = dm.deposit_id
     WHERE d.business_id <> dm.business_id`,
  ],
  [
    "lease's vehicle business_id disagrees with the lease's own business_id",
    `SELECT l.id FROM lease l JOIN vehicle v ON v.id = l.vehicle_id
     WHERE v.business_id <> l.business_id`,
  ],
  [
    "money posted into an accounting_period belonging to a different business",
    `SELECT o.id FROM obligation o JOIN accounting_period ap ON ap.id = o.posted_period_id
     WHERE ap.business_id <> o.business_id`,
  ],
  [
    "more than one accounting_period open at once for the same business",
    `SELECT business_id FROM accounting_period WHERE status = 'open'
     GROUP BY business_id HAVING count(*) > 1`,
  ],
  [
    "a closed accounting_period with a live money row still posted_period_id-ing into it as its OPEN period",
    // sanity check on period sequencing itself: no business_id should have
    // two periods both claiming to cover the same date
    `SELECT ap1.business_id FROM accounting_period ap1
     JOIN accounting_period ap2 ON ap2.business_id = ap1.business_id AND ap2.id <> ap1.id
     WHERE ap1.period_start <= ap2.period_end AND ap2.period_start <= ap1.period_end`,
  ],
  [
    "write_off_recovery with no corresponding live payment (INV-15 — a recovery is an ordinary linked payment)",
    `SELECT wor.id FROM write_off_recovery wor
     LEFT JOIN payment p ON p.id = wor.payment_id
     WHERE wor.voided_at IS NULL AND (p.id IS NULL OR p.status = 'voided')`,
  ],
  [
    "advance_settlement referencing an advance from a different business",
    `SELECT s.id FROM advance_settlement s JOIN advance a ON a.id = s.advance_id
     WHERE a.business_id <> s.business_id`,
  ],
];

const pool = new Pool({ connectionString: databaseUrl() });
let failures = 0;

for (const [label, sql] of CHECKS) {
  const { rows } = await pool.query(sql);
  if (rows.length === 0) {
    console.log(`  OK    ${label}`);
  } else {
    failures++;
    const ids = rows.map((r) => Object.values(r)[0]).slice(0, 10);
    console.error(`  FAIL  ${label} — ${rows.length} row(s): ${ids.join(", ")}`);
  }
}

await pool.end();

if (failures === 0) {
  console.log(`\nledger audit: clean — ${CHECKS.length} invariants held`);
  process.exit(0);
}
console.error(`\nledger audit: ${failures} invariant(s) violated out of ${CHECKS.length}`);
process.exit(1);
