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

import { readFileSync, existsSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const explicit = args.filter((a) => !a.startsWith("--"));

/**
 * REV-2026-08-19-04: every regex below that anchors on `$` (`code()`'s own
 * comment strip, chief among them) silently fails on a CRLF line — `.` never
 * matches `\r`, so the match fails outright and `.replace()` hands back the
 * original, comment intact. Normalised once, here, at the one place every
 * caller in this file reads a file — not by patching each regex separately,
 * which is exactly the kind of fix that leaves the next one unpatched.
 */
function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

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
  // IG §7.5: X-Business-Id is a filter over memberships the server already
  // derived from the token, never itself the source of businessId. This is
  // a structurally different pattern from the rule above, not an extension
  // of it — the-above matches property access (body.business_id); a header
  // read is a call expression with a string-literal argument and contains
  // no `.business_id` anywhere in its text, so adding "header" to that
  // regex's alternation would be a no-op. One call site is meant to read
  // this header at all: middleware/auth.ts, which carries its own
  // `-- allow:`.
  {
    id: "tenancy/from-header",
    when: (p) => inApi(p) && p.endsWith(".ts") && !isDomainOrQueries(p),
    pattern: /c\.req\.header\s*\(\s*["']x-business-id["']/gi,
    message:
      "X-Business-Id is resolved once, in middleware/auth.ts's five-step rule — never read directly elsewhere (IG §7.5).",
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
    // GAP-176. `new Date(`${d}T00:00:00`)` parses at the *device's* midnight, so
    // in Asia/Colombo (UTC+5:30) every such date renders one day early for five
    // and a half hours out of every day. Sixteen files carried it. The correct
    // pattern is `web/src/lib/formatShortDate.ts` — a trailing `Z` when parsing
    // *and* `timeZone: "UTC"` on the formatter; the `Z` alone still formats in
    // local time and is the half-fix that looks right in London.
    id: "web/local-midnight-parse",
    when: (p) => /^web\/.*\.tsx?$/.test(p),
    // Not just the backtick-terminated template-literal form — a quoted or
    // concatenated `T00:00:00` is the same bug in different syntax.
    pattern: /T00:00:00(?![\d.Z])/g,
    message:
      'A date parsed without a trailing `Z` lands at the device\'s midnight, not the business day (CLAUDE.md → Time). Use `T00:00:00Z` and give the formatter `timeZone: "UTC"` — see web/src/lib/formatShortDate.ts.',
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
    lines = readText(abs).split("\n");
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
 * which is exactly how this shipped the first time.
 *
 * **Call-site-level, not file-level (S0-3/GAP-125, 15 Aug 2026)** — the
 * file-level version this replaces missed exactly GAP-125's own shape: a
 * screen with several reads, most wrapped, one not, where the file merely
 * *containing* `useQueryState`/`QueryState` anywhere exempted every read in
 * it, including the one that never reached either. Every `useQuery({...})`
 * binding is checked for its own variable reaching `useQueryState(name)` or
 * `<QueryState query={name}>` — not "does this file mention the primitive
 * anywhere." A bare `const { data } = useQuery(...)` is always a finding
 * regardless: destructuring only `data` discards `isError`/`isPending`
 * before there is anything left to wrap.
 */
// A comment on the binding's own line, or on an unbroken run of comment
// lines directly above it — the same "explain it right where it happens"
// convention this codebase's `eslint-disable-next-line …-- reason` comments
// already use.
function isOptedOut(lines, lineIndex) {
  if (OPT_OUT.test(lines[lineIndex])) return true;
  for (let i = lineIndex - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) {
    if (OPT_OUT.test(lines[i])) return true;
  }
  return false;
}

// Both findings below are "walk every match of a pattern, skip opted-out
// lines, describe what's wrong" — this is the one shape, parameterised by
// the pattern and by `describe`, which returns `null` to skip a match that
// turns out fine on a closer look (the wrapped-binding case) or the
// finding's own `match`/`message` otherwise.
function collectPatternFindings(text, lines, path, pattern, describe) {
  const findings = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const lineIndex = text.slice(0, m.index).split("\n").length - 1;
    if (isOptedOut(lines, lineIndex)) continue;
    const description = describe(m);
    if (description === null) continue;
    findings.push({
      file: path,
      line: lineIndex + 1,
      column: 1,
      id: "query/no-error-state",
      ...description,
    });
  }
  return findings;
}

function findUnwrappedQueryBindings(text, lines, path) {
  const bindingPattern = /\b(?:const|let)\s+(\w+)\s*=\s*useQuery(?:<[^>]*>)?\s*\(\s*\{/g;
  return collectPatternFindings(text, lines, path, bindingPattern, (m) => {
    const name = m[1];
    const wrapped = new RegExp(String.raw`\buseQueryState\s*\(\s*${name}\b|\bquery=\{${name}\}`);
    if (wrapped.test(text)) return null;
    return {
      match: name,
      message:
        `\`${name}\` is never passed to useQueryState or a <QueryState query={${name}}> — ` +
        "a failed fetch renders as loading forever (UI §6.4/M-28, GAP-101/GAP-125). Wrap it, " +
        "or add `// allow: <reason>` on this line (or the comment block above it) if this " +
        "read genuinely never needs one.",
    };
  });
}

function findDestructuredDataOnlyQueries(text, lines, path) {
  const destructurePattern =
    /\b(?:const|let)\s*\{\s*data\s*(?::\s*\w+\s*)?\}\s*=\s*useQuery(?:<[^>]*>)?\s*\(\s*\{/g;
  return collectPatternFindings(text, lines, path, destructurePattern, () => ({
    match: "{ data }",
    message:
      "Destructuring only `data` off useQuery discards isError/isPending before there's " +
      "anything left to wrap (UI §6.4/M-28, GAP-101/GAP-125). Bind the whole query result " +
      "and wrap it with useQueryState, or add `// allow: <reason>` on this line (or the " +
      "comment block above it).",
  }));
}

function checkQueryErrorHandling(paths) {
  const findings = [];
  for (const path of paths) {
    if (!/^web\/src\/.*\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readText(abs);
    } catch {
      continue; // binary, unreadable — not our business
    }
    if (!/\buseQuery\s*\(\s*\{/.test(text)) continue;
    const lines = text.split("\n");
    findings.push(
      ...findUnwrappedQueryBindings(text, lines, path),
      ...findDestructuredDataOnlyQueries(text, lines, path),
    );
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
      text = readText(abs);
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

/**
 * GAP-158/GAP-159 (21 Aug 2026): CLAUDE.md's "reserved vocabulary" rule has
 * now shipped as a live bug twice for the identical reason — a raw
 * internal enum value (`arrangement A`, `revenue_licence`, `mileage_excess`)
 * rendered straight into user-facing text instead of through the `_LABEL`
 * map that already exists for it (`arrangementLabel.ts`'s own comment cites
 * `EXPENSE_CATEGORY_LABEL`/GAP-81 as the first occurrence). Six call sites
 * across four screens were found and fixed the same sitting the raw
 * `arrangement A` message was; this rule exists so a seventh has to be
 * deliberate, not missed.
 *
 * **Three fields only, deliberately** — `docType`, `arrangement`,
 * `partyType` are the fields this audit actually found leaking, and none of
 * the three collides with an unrelated meaning elsewhere in this codebase.
 * `kind` and `status` are NOT here even though `obligation.kind` was one of
 * the six: both names are reused constantly for `useQueryState`'s own
 * `{ kind: "idle" | "pending" | "ready" | "error" }` discriminator
 * (`xxxState.kind === "error"` appears dozens of times), so a rule keyed on
 * the bare field name would flag that discriminator on sight — the kind of
 * false positive that gets a check disabled rather than obeyed. Widen this
 * list the same way `VOID_FILTERED_TABLES` above is widened: one real,
 * confirmed leak at a time, never by relaxing the shape of the check.
 */
const ENUM_LABEL_FIELDS = [
  {
    field: "docType",
    // `labels` names what the finding's own message suggests — not a gate
    // this rule checks the file for. Either map is a correct fix:
    // `VEHICLE_DOC_TYPE_LABEL` (the vehicle's own 5 document types) or
    // `PAPERWORK_DOC_TYPE_LABEL` (those plus a driver's own licence,
    // home.ts's `paperworkDocTypeSchema`) — which one a given file needs
    // depends on whether it reads a vehicle document directly or a
    // home-screen paperwork warning.
    labels: ["VEHICLE_DOC_TYPE_LABEL", "PAPERWORK_DOC_TYPE_LABEL"],
  },
  { field: "arrangement", labels: ["ARRANGEMENT_LABEL"] },
  { field: "partyType", labels: ["PARTY_TYPE_LABEL"] },
];

/**
 * Is `prefix` (everything on the line before a match) still inside a
 * `key={…}`/`rowKey={…}`-style prop's own braces — including the plain
 * `key={doc.docType}` case, where the match's own opening `{` *is* the
 * prop's opening brace and so never appears in `prefix` at all? Handled
 * first, directly: an immediate `key=`/`rowKey=` right at the end of
 * `prefix` means the match starts exactly at that prop's own `{`.
 *
 * The other shape a React key takes is a composite built as a template
 * literal (`` key={`${a}-${b}-${c.docType}`} ``,
 * `rowKey={(row) => `${row.partyType}-${row.partyId}`}`) — never
 * user-visible text, but the field access it wraps is nested two or three
 * braces deep, past what the immediate check alone reaches (there, the
 * prop's own `{` *does* land inside `prefix`, with more open braces after
 * it). Finds the last `key=`/`rowKey=` in the prefix and counts unmatched
 * `{` from there — if the braces it opened are still open at the match,
 * the match is inside it. Deliberately unbounded rather than scoped to
 * `key=` alone (Copilot's own review of an earlier version): a prop for a
 * different, already-closed attribute earlier in the line must not mask a
 * real leak later in the same line, and bracket-depth tracking gets that
 * right where a bare text-contains check cannot.
 */
function isInsideKeyProp(prefix) {
  if (/\b(?:key|rowKey)\s*=\s*$/.test(prefix)) return true;
  const opener = /\b(?:key|rowKey)\s*=\s*\{/g;
  let last = -1;
  let m;
  while ((m = opener.exec(prefix)) !== null) last = m.index + m[0].length;
  if (last === -1) return false;
  const between = prefix.slice(last);
  const opens = (between.match(/\{/g) ?? []).length;
  const closes = (between.match(/\}/g) ?? []).length;
  return opens >= closes; // the opener's own `{` already counted in `opens` — still open at >=
}

/**
 * Prop names confirmed, by reading the receiving component, to hand the raw
 * value to something other than user-facing text — never a blanket "any
 * `prop=` is safe" rule, which Copilot's review of an earlier version
 * pointed out would just as happily wave through `aria-label={x.docType}`
 * or `title={x.partyType}`, both genuinely user-facing (the second one is
 * screen-reader text, not decoration). `key`/`rowKey` are handled by
 * `isInsideKeyProp` above instead, which already covers the non-nested form
 * this list would otherwise also need to name.
 *
 * - `type` — `ReceivablesReportScreen`/`AgeingReportScreen` pass
 *   `row.partyType` to `PartyName`'s own `type` prop, which maps it through
 *   `PARTY_TYPE_LABEL` internally (`features/reports/PartyName.tsx`).
 * - `currentArrangement` — `VehicleOverviewScreen` passes `vehicle.arrangement`
 *   to `ChangeVehicleArrangementSheet`, which renders it through its own
 *   `ARRANGEMENT_LABEL` lookup, not raw.
 *
 * Widen by confirming the receiving component maps the value, the same
 * discipline `ENUM_LABEL_FIELDS` itself is widened by — never by adding a
 * prop name on the assumption that "it's probably a pass-through."
 */
const SAFE_PROP_PASSTHROUGH = new Set(["type", "currentArrangement"]);

// Walks backward by hand rather than `/([\w-]+)\s*=\s*$/.exec(prefix)`
// (SonarCloud S8786, confirmed by direct reproduction — that unanchored
// pattern took 65+ seconds against a 200k-char line with no `=` in it,
// O(n²) backtracking): trimEnd()/endsWith() are native linear scans, and
// the identifier walk below tests one character at a time with no
// quantifier to backtrack through.
function isSafePropPassthrough(prefix) {
  const trimmed = prefix.trimEnd();
  if (!trimmed.endsWith("=")) return false;
  const beforeEq = trimmed.slice(0, -1).trimEnd();
  let start = beforeEq.length;
  while (start > 0 && /[\w-]/.test(beforeEq[start - 1])) start--;
  const name = beforeEq.slice(start);
  return name.length > 0 && SAFE_PROP_PASSTHROUGH.has(name);
}

function checkEnumLabelUsage(paths) {
  const findings = [];
  for (const path of paths) {
    if (!/^web\/src\/.*\.tsx$/.test(path) || path.endsWith(".test.tsx")) continue;
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readText(abs);
    } catch {
      continue; // binary, unreadable — not our business
    }
    const lines = text.split("\n");
    for (const { field, labels } of ENUM_LABEL_FIELDS) {
      // A bare `{expr.field}` or `${expr.field}` — nothing else inside the
      // braces. This shape alone already excludes a comparison
      // (`.field === "x"`) and a correctly-labeled render: `LABEL[expr.field]`
      // opens on `LABEL[`, not on the accessor itself, so it can never match
      // here — there is no "does this file use the label anywhere" check
      // to get right or wrong, because the two shapes are syntactically
      // disjoint. (An earlier file-wide version tried exactly that check and
      // masked a real leak the moment any *other* line in the same file used
      // the label correctly — found in review, not shipped.)
      const raw = new RegExp(String.raw`\{\s*[\w.]+\.${field}\s*\}`, "g");
      for (const [i, line] of lines.entries()) {
        if (OPT_OUT.test(line)) continue;
        const subject = code(line, path);
        raw.lastIndex = 0;
        let m;
        while ((m = raw.exec(subject)) !== null) {
          // A prop pass-through (`key={row.id}`, `type={row.partyType}`) is
          // never user-visible text itself — the receiving component (or
          // React's own reconciler, for `key`) is responsible for it, the
          // same reasoning `PartyName` already relies on. Matched against
          // only the text immediately before this match, not the whole
          // line's prefix — `<div key={row.id}>{row.partyType}</div>` must
          // still flag the second brace even though `key=` appears earlier
          // in the same line, found in review before it shipped. A
          // composite key built from a template literal nests the field
          // access two or three braces inside `key=`/`rowKey=` rather than
          // immediately after it — `isInsideKeyProp` tracks that separately
          // since the plain immediately-preceding check can't see through
          // the nesting (also found in review). The pass-through exemption
          // itself is a reviewed allowlist (`SAFE_PROP_PASSTHROUGH`), not
          // "any `prop=`" — that version was flagged in review for waving
          // through genuinely user-facing props like `aria-label`/`title`.
          const prefix = subject.slice(0, m.index);
          if (isSafePropPassthrough(prefix)) continue;
          if (isInsideKeyProp(prefix)) continue;
          findings.push({
            file: path,
            line: i + 1,
            column: m.index + 1,
            id: "copy/raw-enum-in-jsx",
            match: m[0].trim(),
            message:
              `\`.${field}\` is rendered raw here — an internal code (CLAUDE.md's ` +
              "reserved-vocabulary rule) reaching the interface unmapped, the same shape GAP-158 " +
              `found live. Map it through ${labels.join(" or ")}, or add ` +
              "`// allow: <reason>` on this line if it is genuinely correct.",
          });
        }
      }
    }
  }
  return findings;
}

/**
 * IG §7.6/§16.1: `api/src/queries/platform/` may never import money-table
 * schema — the structural half of "a platform admin can never read
 * business money" (INV-38), enforced here rather than trusted to review.
 *
 * **An allowlist, deliberately, not a money-table denylist** — the shape
 * `checkVoidTableFilter` above uses for a different problem. A denylist
 * fails open: a new operational table added later (a lease, a trip, an
 * incident — none strictly "money" by DM §13's `posted_period_id` test, but
 * all business-internal data a platform admin must never see) would be
 * importable from this directory by default until someone remembers to add
 * it here. An allowlist fails closed — new schema is unreachable from this
 * directory until someone deliberately widens the list, which is the
 * correct default for a security boundary, not merely a stylistic choice.
 */
const PLATFORM_QUERY_SAFE_TABLES = [
  "business",
  "businessSettings",
  "accountingPeriod",
  "appUser",
  "platformAdmin",
  "businessCreationRequest",
  "platformAuditLog",
  "businessMember",
  "businessMemberInvite",
];

// Every import from db/schema.js in a file, not just the first — a second,
// later import statement (however it got there) is exactly the shape a
// violation would actually take. Split out of checkPlatformQueryImports
// below purely to keep that function's own cognitive complexity under the
// project's threshold — this loop carries no branching of its own that the
// caller needs to see.
function extractSchemaImportNames(text) {
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/\.\.\/db\/schema\.js["']/g;
  const imported = [];
  let m;
  while ((m = importPattern.exec(text)) !== null) {
    imported.push(
      ...m[1]
        .split(",")
        .map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        .filter(Boolean),
    );
  }
  return imported;
}

function checkPlatformQueryImports(paths) {
  const findings = [];
  for (const path of paths) {
    if (!/^api\/src\/queries\/platform\/.*\.ts$/.test(path)) continue;
    if (path.endsWith(".test.ts")) continue;
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readText(abs);
    } catch {
      continue; // binary, unreadable — not our business
    }
    if (OPT_OUT.test(text)) continue; // file-wide allow: — a deliberate, visible exception

    const imported = extractSchemaImportNames(text);
    if (imported.length === 0) continue;
    const forbidden = imported.filter((name) => !PLATFORM_QUERY_SAFE_TABLES.includes(name));
    if (forbidden.length === 0) continue;

    findings.push({
      file: path,
      line: 1,
      column: 1,
      id: "tenancy/platform-query-schema-import",
      match: forbidden.join(", "),
      message:
        `api/src/queries/platform/ may only import ${PLATFORM_QUERY_SAFE_TABLES.join(", ")} ` +
        `from db/schema.js — a platform admin can never read business money (INV-38). Move this ` +
        "query out of queries/platform/, or add `-- allow: <reason>` (anywhere in the file) if " +
        "this import is genuinely correct.",
    });
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
    const text = readText(wrangler);
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

// ── Self-test ────────────────────────────────────────────────────────────────

/**
 * REV-2026-08-19-04's own regression: `code()`'s comment strip failed
 * silently on CRLF, and nothing in this file would have caught that failing
 * itself. No vitest project reaches a root-level script (IG §8.1's two
 * projects are both under api/), so the check lives here instead — run
 * directly (`node scripts/check-forbidden.mjs --self-test`) and from CI.
 */
function selfTest() {
  const failures = [];

  const codeCases = [
    ["-- a plain comment", "x.sql", ""],
    ["SELECT 1; -- trailing comment", "x.sql", "SELECT 1; "],
    ["const x = 1; // trailing comment", "x.ts", "const x = 1; "],
    ["not a comment at all", "x.sql", "not a comment at all"],
  ];
  for (const [line, path, expected] of codeCases) {
    const got = code(line, path);
    if (got !== expected) {
      failures.push(
        `code(${JSON.stringify(line)}, ${JSON.stringify(path)}) -> ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }

  // The regression itself: readText must collapse CRLF before anything
  // downstream (code(), or any $-anchored rule pattern) ever sees a line.
  const crlfFile = resolve(ROOT, `.self-test-crlf-${process.pid}.tmp`);
  try {
    const crlfContents = ["-- a comment about money", "SELECT 1;", ""].join("\r\n");
    writeFileSync(crlfFile, crlfContents, "utf8");
    const lines = readText(crlfFile).split("\n");
    if (lines.some((l) => l.includes("\r"))) {
      failures.push(`readText() left a \\r in: ${JSON.stringify(lines)}`);
    }
    const stripped = code(lines[0], "x.sql");
    if (stripped !== "") {
      failures.push(
        `code() on a readText()-normalised CRLF comment line -> ${JSON.stringify(stripped)}, expected ""`,
      );
    }
  } finally {
    try {
      unlinkSync(crlfFile);
    } catch {
      // best-effort cleanup
    }
  }

  if (failures.length) {
    console.error("check-forbidden.mjs self-test FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("check-forbidden.mjs self-test: clean");
  process.exit(0);
}

if (args.includes("--self-test")) selfTest();

// ── Report ───────────────────────────────────────────────────────────────────

const scanTargets = filesToScan();
const findings = [
  ...scanTargets.flatMap(scan),
  ...checkQueryErrorHandling(scanTargets),
  ...checkVoidTableFilter(scanTargets),
  ...checkEnumLabelUsage(scanTargets),
  ...checkPlatformQueryImports(scanTargets),
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
