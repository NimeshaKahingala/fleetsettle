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

import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import { databaseUrl } from "./lib/database-url.mjs";

neonConfig.webSocketConstructor = ws;

/**
 * The recurring shape behind most of the tenancy checks below: a child row
 * carries its own `business_id` alongside a foreign key into some parent
 * table, and the two must never disagree (W-49's own boundary, checked here
 * rather than trusted). Hand-writing that join once per table pair is what
 * SonarCloud's quality gate flagged as duplicated code on PR #88 (75.5% on
 * new code) — the twelve near-identical `SELECT … JOIN … WHERE
 * parent.business_id <> child.business_id` blocks were the same check typed
 * out twelve times, not twelve different checks.
 */
function tenancyCheck(childTable, childAlias, fkColumn, parentTable, parentAlias) {
  return `SELECT ${childAlias}.id FROM ${childTable} ${childAlias}
     JOIN ${parentTable} ${parentAlias} ON ${parentAlias}.id = ${childAlias}.${fkColumn}
     WHERE ${parentAlias}.business_id <> ${childAlias}.business_id`;
}

// label, child table, child alias, fk column, parent table, parent alias —
// one row per tenancyCheck() call. Kept as a flat data table rather than
// twelve repeated `[label, tenancyCheck(...)]` array entries: that shape
// was itself flagged as duplicated code on PR #93, since the twelve entries
// were identical in structure even after the SQL bodies were deduped above.
const TENANCY_CHECKS = [
  [
    "obligation's party business_id disagrees with the obligation's own business_id (customer)",
    "obligation",
    "o",
    "party_customer_id",
    "customer",
    "c",
  ],
  [
    "obligation's party business_id disagrees with the obligation's own business_id (driver)",
    "obligation",
    "o",
    "party_driver_id",
    "driver",
    "d",
  ],
  [
    "obligation's vehicle business_id disagrees with the obligation's own business_id",
    "obligation",
    "o",
    "vehicle_id",
    "vehicle",
    "v",
  ],
  [
    "payment's party business_id disagrees with the payment's own business_id (customer)",
    "payment",
    "p",
    "party_customer_id",
    "customer",
    "c",
  ],
  [
    "payment's party business_id disagrees with the payment's own business_id (driver)",
    "payment",
    "p",
    "party_driver_id",
    "driver",
    "d",
  ],
  [
    "expense's vehicle business_id disagrees with the expense's own business_id",
    "expense",
    "e",
    "vehicle_id",
    "vehicle",
    "v",
  ],
  [
    "trip's vehicle business_id disagrees with the trip's own business_id",
    "trip",
    "t",
    "vehicle_id",
    "vehicle",
    "v",
  ],
  [
    "day_record's vehicle business_id disagrees with the day_record's own business_id",
    "day_record",
    "dr",
    "vehicle_id",
    "vehicle",
    "v",
  ],
  [
    "deposit_movement's deposit business_id disagrees with the movement's own business_id",
    "deposit_movement",
    "dm",
    "deposit_id",
    "deposit",
    "d",
  ],
  [
    "lease's vehicle business_id disagrees with the lease's own business_id",
    "lease",
    "l",
    "vehicle_id",
    "vehicle",
    "v",
  ],
  [
    "money posted into an accounting_period belonging to a different business",
    "obligation",
    "o",
    "posted_period_id",
    "accounting_period",
    "ap",
  ],
  [
    "advance_settlement referencing an advance from a different business",
    "advance_settlement",
    "s",
    "advance_id",
    "advance",
    "a",
  ],
];

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
    // earned/received never collapsing (CLAUDE.md) is a schema-shape guarantee —
    // received_minor isn't even a day_record column, it's obligation.settled_minor
    // (DM §7) — so this is defense-in-depth on the NOT NULL constraint, not a
    // row-level test of the collapse invariant itself
    "confirmed day_record with a null earned_minor (defense-in-depth on the NOT NULL constraint)",
    `SELECT id FROM day_record
     WHERE voided_at IS NULL AND state <> 'open' AND earned_minor IS NULL`,
  ],
  [
    "payment_allocation joins a payment and an obligation from different businesses",
    `SELECT pa.id FROM payment_allocation pa
     JOIN payment p ON p.id = pa.payment_id JOIN obligation o ON o.id = pa.obligation_id
     WHERE p.business_id <> o.business_id`,
  ],
  [
    "more than one accounting_period open at once for the same business",
    `SELECT business_id FROM accounting_period WHERE status = 'open'
     GROUP BY business_id HAVING count(*) > 1`,
  ],
  [
    // sanity check on period sequencing itself: no business_id should have
    // two accounting_periods both claiming to cover the same date
    "two accounting_periods for the same business have overlapping date ranges",
    `SELECT ap1.business_id FROM accounting_period ap1
     JOIN accounting_period ap2 ON ap2.business_id = ap1.business_id AND ap2.id > ap1.id
     WHERE ap1.period_start <= ap2.period_end AND ap2.period_start <= ap1.period_end`,
  ],
  [
    "write_off_recovery with no corresponding live payment (INV-15 — a recovery is an ordinary linked payment)",
    `SELECT wor.id FROM write_off_recovery wor
     LEFT JOIN payment p ON p.id = wor.payment_id
     WHERE wor.voided_at IS NULL AND (p.id IS NULL OR p.status = 'voided')`,
  ],
  ...TENANCY_CHECKS.map(([label, childTable, childAlias, fkColumn, parentTable, parentAlias]) => [
    label,
    tenancyCheck(childTable, childAlias, fkColumn, parentTable, parentAlias),
  ]),
];

const pool = new Pool({ connectionString: databaseUrl() });
let failures = 0;

try {
  for (const [label, sql] of CHECKS) {
    try {
      const { rows } = await pool.query(sql);
      if (rows.length === 0) {
        console.log(`  OK    ${label}`);
      } else {
        failures++;
        const ids = rows.map((r) => Object.values(r)[0]).slice(0, 10);
        console.error(`  FAIL  ${label} — ${rows.length} row(s): ${ids.join(", ")}`);
      }
    } catch (err) {
      failures++;
      console.error(`  ERROR ${label} — ${err.message}`);
    }
  }
} finally {
  await pool.end();
}

if (failures === 0) {
  console.log(`\nledger audit: clean — ${CHECKS.length} invariants held`);
  process.exit(0);
}
console.error(`\nledger audit: ${failures} invariant(s) violated out of ${CHECKS.length}`);
process.exit(1);
