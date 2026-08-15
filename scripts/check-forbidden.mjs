#!/usr/bin/env node
/**
 * The rules ESLint cannot see.
 *
 * ESLint parses TypeScript. It cannot read the inside of a SQL file, it cannot
 * check that a migration is numbered correctly, and it cannot tell that a
 * translation string used a word the interface has banned. Every rule below is
 * one whose failure is silent: the code runs, the report renders, and the number
 * is wrong in a way nobody notices until someone argues about it.
 *
 *   node scripts/check-forbidden.mjs               scan the whole repo
 *   node scripts/check-forbidden.mjs <file> …      scan specific files
 *   node scripts/check-forbidden.mjs --json <file> machine-readable (Claude hook)
 *
 * A single line may opt out, but must say why:
 *
 *   ALTER TABLE … ;  -- allow: column was added in 0007 and never populated
 *   const pct = Number(raw);  // allow: mileage percentage, not money
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const explicit = args.filter((a) => !a.startsWith("--"));

/** Files that legitimately contain the patterns they describe. */
const NEVER_SCAN = [
  "scripts/check-forbidden.mjs",
  ".claude/hooks/",
  "docs/",
  "eslint.config.js",
  "stylelint.config.js",
  "package-lock.json",
];

const inApi = (p) => p.startsWith("api/");
const isSql = (p) => p.endsWith(".sql");
const isMigration = (p) => p.startsWith("api/migrations/") && isSql(p);
const isLocale = (p) => /^web\/(src|public)\/locales\/.*\.json$/.test(p);
const isCss = (p) => p.endsWith(".css");
// api/CLAUDE.md: "`queries/` takes `(db, …)` and has never heard of HTTP" —
// domain/ is the same, one layer up (IG §3.1). Neither ever sees `c` or a
// request body, so a `.businessId` read off a same-named local variable
// (routinely called `input` for a domain function's own typed parameter
// struct) cannot be the request-body read this rule exists to catch — that
// provenance is only checkable where the request is actually read, i.e.
// handlers/ and routes/.
const isDomainOrQueries = (p) =>
  p.startsWith("api/src/domain/") || p.startsWith("api/src/queries/");

const RULES = [
  // ── Time ───────────────────────────────────────────────────────────────────
  {
    id: "time/server-date",
    when: (p) => isSql(p) || (inApi(p) && p.endsWith(".ts")),
    pattern:
      /\b(CURRENT_DATE|LOCALTIMESTAMP|LOCALTIME)\b|\b(now\(\)|current_timestamp)\s*::\s*date\b/gi,
    message:
      "Postgres evaluates this in the server's timezone, not Asia/Colombo. Pass the business date in as a parameter (CLAUDE.md → Time).",
  },

  // ── Money ──────────────────────────────────────────────────────────────────
  {
    id: "money/inexact-type",
    when: isSql,
    pattern: /\b(numeric|decimal|real|double\s+precision|money|float[48]?)\b/gi,
    message:
      "Money is bigint minor units. An inexact type is a rounding argument waiting to happen (CLAUDE.md → Money). If this column is genuinely not money, add `-- allow: <reason>`.",
  },
  {
    id: "schema/serial-id",
    when: isSql,
    pattern: /\b(big)?serial\b/gi,
    message:
      "Ids appear in URLs — use uuid, generated in the app as UUIDv7 (DM §2), never serial (write-migration skill).",
  },

  // ── Forward-only ───────────────────────────────────────────────────────────
  {
    id: "migration/destructive",
    when: isMigration,
    pattern: /\b(DROP\s+(TABLE|COLUMN|CONSTRAINT|TYPE)|TRUNCATE|ALTER\s+COLUMN\s+\w+\s+TYPE)\b/gi,
    message:
      "Migrations are forward-only and never dropped or renamed without instruction. Add a new column and backfill (write-migration skill).",
  },

  // ── SQL safety ─────────────────────────────────────────────────────────────
  {
    id: "sql/raw-interpolation",
    when: (p) => inApi(p) && p.endsWith(".ts"),
    pattern: /\bsql\.raw\s*\(|\bexecute\s*\(\s*[`"'][^`"']*\$\{/g,
    message: "Parameterised SQL exclusively — no string concatenation, ever (IG §10.3).",
  },

  // ── Tenancy ────────────────────────────────────────────────────────────────
  {
    id: "tenancy/from-request",
    when: (p) => inApi(p) && p.endsWith(".ts") && !isDomainOrQueries(p),
    pattern: /\b(body|payload|input|query|params)\s*(\?\.|\.|\[["'])\s*business_?[iI]d/g,
    message:
      "business_id is resolved from the verified JWT sub via business_member — never from a request (CLAUDE.md → Tenancy).",
  },

  // ── Secrets ────────────────────────────────────────────────────────────────
  {
    id: "secret/connection-string",
    when: (p) => !p.endsWith(".example") && !p.endsWith(".md"),
    pattern: /postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/gi,
    message:
      "A connection string with credentials must never be committed. Use `wrangler secret put` (TS §8).",
  },
  {
    id: "secret/in-vars",
    when: (p) => /wrangler\.(jsonc?|toml)$/.test(p),
    pattern:
      /"(DATABASE_URL|WHATSAPP_TOKEN|WHATSAPP_PHONE_ID|[A-Z_]*(SECRET|TOKEN|PASSWORD|PRIVATE_KEY))"\s*:/g,
    message:
      "`vars` are plaintext in the deployed bundle. Secrets go through `wrangler secret put` (IG §9.4).",
  },

  // ── Interface ──────────────────────────────────────────────────────────────
  {
    id: "copy/accounting-vocabulary",
    when: isLocale,
    pattern:
      /\b(accrual|accruals?|accrued|receivable|payables?\s+account|current\s+account|allocation|debtor|creditor|reconciliation)\b/gi,
    message:
      "No accounting vocabulary in the interface (U-6, FL §1.5). Say what happened, in the words the business uses.",
  },
  {
    id: "copy/reserved-vocabulary",
    when: isLocale,
    pattern: /"[^"]*\brates?\b[^"]*"/gi,
    message:
      "'Daily lease amount' (he pays you) and 'driver day fee' (you pay him) are opposite directions of money and must never both shorten to 'rate' (U-6).",
  },
  {
    id: "copy/vague-action",
    when: isLocale,
    pattern: /:\s*"(Submit|OK|Ok|Confirm|Done|Save)"/g,
    message:
      "One primary action per screen, stating what it does — never 'Submit' or 'OK' (add-screen skill, UI §6).",
  },
  {
    id: "css/untokenised-colour",
    when: isCss,
    // Not `text` — Tailwind v4's @theme reserves --text-* for the font-size
    // scale (`text-xl`), not colour; UI §12.3's tokens.css defines
    // --text-hero etc. for exactly that and would false-positive here.
    pattern: /^\s*--(ink|bg|surface|border|fg|accent|direction)-[a-z0-9-]+\s*:/gim,
    message:
      "Tailwind v4's @theme only generates colour utilities from --color-*. A colour token without that prefix fails silently (UI §5.1).",
  },
  {
    id: "css/viewport-unit",
    when: (p) => isCss(p) || /^web\/.*\.tsx?$/.test(p),
    pattern: /\b100vh\b/g,
    message: "100vh does not account for mobile browser chrome. Use 100svh (UI §5).",
  },
];

// ── Scanning ─────────────────────────────────────────────────────────────────

const OPT_OUT = /(?:--|\/\/|#|\/\*)\s*allow:\s*\S+/;

function filesToScan() {
  if (explicit.length) return explicit.map((f) => relative(ROOT, resolve(f)));
  // --others picks up files that are new and not yet staged. Without it the
  // scan is blind to precisely the file someone is in the middle of writing.
  return execSync("git ls-files --cached --others --exclude-standard", {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function scan(path) {
  const findings = [];
  if (NEVER_SCAN.some((skip) => path.startsWith(skip))) return findings;
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return findings;

  const applicable = RULES.filter((r) => r.when(path));
  if (!applicable.length) return findings;

  let lines;
  try {
    lines = readFileSync(abs, "utf8").split("\n");
  } catch {
    return findings; // binary, unreadable — not our business
  }

  for (const rule of applicable) {
    for (const [i, line] of lines.entries()) {
      if (OPT_OUT.test(line)) continue;
      const subject = code(line, path);
      rule.pattern.lastIndex = 0;
      const m = rule.pattern.exec(subject);
      if (m) {
        findings.push({
          file: path,
          line: i + 1,
          column: m.index + 1,
          id: rule.id,
          match: m[0].trim(),
          message: rule.message,
        });
      }
    }
  }
  return findings;
}

/**
 * The code part of a line, with comments removed.
 *
 * A comment cannot declare a column type or evaluate a date, so matching inside
 * one is always a false positive — and false positives are what get a check
 * deleted. Prose about "money tables" in a migration header is the case that
 * found this.
 *
 * CSS is left alone: there, `--` starts a custom property, not a comment, and
 * `--ink-primary` is exactly what one rule is looking for.
 */
function code(line, path) {
  if (path.endsWith(".sql")) return line.replace(/--.*$/, "");
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return line.replace(/\/\/.*$/, "");
  return line;
}

/** Whole-directory checks that no single line can express. */
function checkMigrationSet() {
  const findings = [];
  const dir = resolve(ROOT, "api/migrations");
  if (!existsSync(dir)) return findings;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const seen = new Map();

  for (const f of files) {
    const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
    if (!m) {
      findings.push({
        file: `api/migrations/${f}`,
        line: 1,
        column: 1,
        id: "migration/filename",
        match: f,
        message:
          "Migrations are numbered NNNN_lower_snake_case.sql and applied in filename order (IG §5).",
      });
      continue;
    }
    const n = m[1];
    if (seen.has(n)) {
      findings.push({
        file: `api/migrations/${f}`,
        line: 1,
        column: 1,
        id: "migration/duplicate-number",
        match: n,
        message: `Number ${n} is already used by ${seen.get(n)}. Two migrations with one number apply in an order nobody chose.`,
      });
    }
    seen.set(n, f);
  }
  return findings;
}

/**
 * GAP-101/UI §6.4/M-28: a `useQuery(` with no error state renders a failed
 * fetch as loading forever — and passes every test that only mocks success,
 * which is exactly how this shipped the first time. File-level, not
 * call-site-level: cheap to check, and a screen with several reads usually
 * wraps them together (`combineQueryStates`) rather than once each.
 */
function checkQueryErrorHandling(paths) {
  const findings = [];
  for (const path of paths) {
    if (!/^web\/src\/.*\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue; // binary, unreadable — not our business
    }
    if (!/\buseQuery\s*\(\s*\{/.test(text)) continue;
    if (/\buseQueryState\b|\bQueryState\b/.test(text)) continue;
    if (OPT_OUT.test(text)) continue;
    findings.push({
      file: path,
      line: 1,
      column: 1,
      id: "query/no-error-state",
      match: "useQuery(",
      message:
        "A read with no error state renders a failed fetch as loading forever (UI §6.4/M-28, GAP-101). Wrap it with QueryState/useQueryState, or add `// allow: <reason>` if this read genuinely never needs one.",
    });
  }
  return findings;
}

/**
 * Wave 2/GAP-118: `vehicle_day_allocation`, `payment_allocation`, `day_record`
 * and `opening_balance_entry` all gained the W-58 void trio in migration
 * 0022, specifically "ahead of Wave 2, which is what actually needs it" (its
 * own header comment) — GAP-118's fix voids a stale future `day_record`
 * rather than mutating it, and a scan over the table that doesn't exclude a
 * voided row treats a freed day as still occupied. File-scoped, the same
 * shape as `checkQueryErrorHandling` above: a file touching one of these
 * tables via `.from`/`.update`/`.leftJoin`/`.innerJoin` with no
 * `<table>.voidedAt` reference anywhere in it is missing the filter, not
 * just one call site of it.
 *
 * Widened GAP-12/W-61/INV-36 (14 Aug 2026): the nine remaining void-cascade
 * tables now carry a live void endpoint too (`adjustment`, `offsetRecord`,
 * `offsetAllocation` — migration 0024 gave it the trio, `depositMovement`,
 * `advance`, `advanceSettlement`, `writeOff`, `writeOffRecovery`,
 * `incidentRecovery`) — every file that reads or updates one of them already
 * references `<table>.voidedAt` somewhere, checked table by table before
 * adding each. `capitalContribution`/`bankingEvent`/`partnerPayout` (GAP-12's
 * first three, landed earlier the same wave) and `obligation` (voidable
 * since P3, not new here) are deliberately still not in this list — none of
 * them is ever summed across rows the way GAP-120's four originals were, so
 * there is no unfiltered-sum bug this rule exists to catch. Widen the list
 * deliberately, table by table, as each one's own void path ships — not by
 * relaxing this comment.
 */
const VOID_FILTERED_TABLES = [
  "vehicleDayAllocation",
  "paymentAllocation",
  "dayRecord",
  "openingBalanceEntry",
  "adjustment",
  "offsetRecord",
  "offsetAllocation",
  "depositMovement",
  "advance",
  "advanceSettlement",
  "writeOff",
  "writeOffRecovery",
  "incidentRecovery",
];

function checkVoidTableFilter(paths) {
  const findings = [];
  for (const path of paths) {
    if (!/^api\/src\/.*\.ts$/.test(path) || /\.test\.ts$/.test(path)) continue;
    if (path.endsWith("db/schema.ts")) continue;
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue; // binary, unreadable — not our business
    }
    for (const table of VOID_FILTERED_TABLES) {
      const usage = new RegExp(`\\.(from|update|leftJoin|innerJoin)\\(${table}\\b`);
      if (!usage.test(text)) continue;
      const filtered = new RegExp(`${table}\\.voidedAt`);
      if (filtered.test(text)) continue;
      // Table-specific opt-out, not OPT_OUT's bare `allow:` — a file with an
      // unrelated `allow:` comment (a W-56 zero, a mileage percentage) is not
      // thereby exempt from *this* rule. checkQueryErrorHandling's own
      // file-wide OPT_OUT.test(text) was tried here first and found to
      // silently pass reports.ts on exactly that collision before this rule
      // had ever actually filtered anything in it — confirmed by reverting
      // this file to its pre-fix content and re-running the check.
      const tableOptOut = new RegExp(`(?:--|//|#|/\\*)\\s*allow:.*\\b(void|${table})\\b`, "i");
      if (tableOptOut.test(text)) continue;
      findings.push({
        file: path,
        line: 1,
        column: 1,
        id: "money/void-table-unfiltered",
        match: table,
        message:
          `${table} carries the W-58 void trio and this file reads or updates it with no ` +
          `${table}.voidedAt reference anywhere — a voided row (GAP-118) can still surface as ` +
          "live. Add `isNull(" +
          table +
          ".voidedAt)`, or `// allow: <reason>` if this read genuinely must see voided rows too.",
      });
    }
  }
  return findings;
}

/** Positive assertions — things that must be present, not absent. */
function checkRequired() {
  const findings = [];
  const wrangler = ["api/wrangler.jsonc", "api/wrangler.json", "api/wrangler.toml"]
    .map((p) => resolve(ROOT, p))
    .find(existsSync);

  if (wrangler) {
    const text = readFileSync(wrangler, "utf8");
    if (!/workers_dev["\s]*[:=]\s*false/.test(text)) {
      findings.push({
        file: relative(ROOT, wrangler),
        line: 1,
        column: 1,
        id: "deploy/workers-dev",
        match: "workers_dev",
        message:
          'Set "workers_dev": false so a bare `wrangler deploy` cannot publish a live URL (IG §9.4).',
      });
    }
  }

  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split("\n");
  for (const f of tracked) {
    if (/(^|\/)(\.env|\.dev\.vars)$/.test(f)) {
      findings.push({
        file: f,
        line: 1,
        column: 1,
        id: "secret/tracked-env",
        match: f,
        message:
          "This file holds secrets and is tracked by git. Remove it from the index and rotate what it held.",
      });
    }
  }
  return findings;
}

// ── Report ───────────────────────────────────────────────────────────────────

const scanTargets = filesToScan();
const findings = [
  ...scanTargets.flatMap(scan),
  ...checkQueryErrorHandling(scanTargets),
  ...checkVoidTableFilter(scanTargets),
  ...(explicit.length ? [] : [...checkMigrationSet(), ...checkRequired()]),
];

if (asJson) {
  console.log(JSON.stringify(findings));
  process.exit(0); // the hook decides what to do with these
}

if (!findings.length) {
  if (!explicit.length) console.log("guard: clean");
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

for (const [file, list] of byFile) {
  console.error(`\n${file}`);
  for (const f of list) {
    console.error(`  ${f.line}:${f.column}  ${f.id}  ${JSON.stringify(f.match)}`);
    console.error(`    ${f.message}`);
  }
}
console.error(
  `\n${findings.length} violation${findings.length === 1 ? "" : "s"}. ` +
    "Fix, or add `allow: <reason>` on the line if it is genuinely correct.\n",
);
process.exit(1);
