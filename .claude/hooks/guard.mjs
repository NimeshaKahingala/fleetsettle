#!/usr/bin/env node
/**
 * PostToolUse hook — runs after Claude writes or edits a file.
 *
 * CLAUDE.md is prose, and prose is advisory: an agent may follow it, may
 * paraphrase it, may quietly not. This hook is the same rules with teeth. It
 * turns a violation into feedback at the moment the line is written, rather
 * than a CI failure twenty minutes later with the reasoning already paged out.
 *
 * It does three things, in order:
 *   1. runs the repo guard against the one file that changed;
 *   2. blocks with the reason if that file violates a money/time/tenancy rule;
 *   3. formats the file, if it is clean.
 *
 * It must never break the session. Everything is wrapped, and every failure
 * path exits 0.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");

const read = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const emit = (payload) => {
  console.log(JSON.stringify(payload));
  process.exit(0);
};

const FORMATTABLE = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".css",
  ".html",
  ".yml",
  ".yaml",
]);

/** Written on a migration, this is the checklist that has already been missed. */
const MIGRATION_REMINDER = `This is a migration. Before calling it done, confirm the money-table checklist:
  · business_id, not nullable, with the composite FK
  · posted_period_id NOT NULL, and belongs_to_period_id for late arrivals (W-35)
  · voided_at / voided_reason / voided_by — money records are append-only (W-50)
  · created_at / updated_at + trigger_set_updated_at()
  · THE TABLE NAME ADDED TO THE assert_period_open() ARRAY — this is the one that
    gets forgotten; three tables were missing from it once and every one silently
    accepted writes into a closed accounting period (DM §13)
  · a unique key that makes a second cron run a no-op
Then run the DM §13 drift assertion, and the golden fixtures.`;

try {
  const input = await read();
  const file = input?.tool_input?.file_path ?? input?.tool_response?.filePath;
  if (!file) process.exit(0);

  const rel = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
  if (rel.startsWith("..") || !existsSync(file)) process.exit(0);

  // ── 1. Guard ───────────────────────────────────────────────────────────────
  let findings = [];
  try {
    const out = execFileSync(
      process.execPath,
      [resolve(ROOT, "scripts/check-forbidden.mjs"), "--json", file],
      { cwd: ROOT, encoding: "utf8", timeout: 10_000 },
    );
    findings = JSON.parse(out || "[]");
  } catch {
    // The guard is a safety net, not a gate on the session.
  }

  if (findings.length) {
    const detail = findings
      .map((f) => `  ${f.file}:${f.line}  ${f.id}\n    found: ${f.match}\n    ${f.message}`)
      .join("\n\n");
    emit({
      decision: "block",
      reason:
        `${findings.length} FleetSettle rule violation${findings.length === 1 ? "" : "s"} in the file just written:\n\n` +
        `${detail}\n\n` +
        "Fix these now. If a line is genuinely correct, annotate it with `allow: <reason>` " +
        "so the exception is visible in review — do not remove the check.",
    });
  }

  // ── 2. Format ──────────────────────────────────────────────────────────────
  if (FORMATTABLE.has(extname(file))) {
    const prettier = resolve(ROOT, "node_modules/.bin/prettier");
    if (existsSync(prettier)) {
      try {
        execFileSync(prettier, ["--write", "--ignore-unknown", file], {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 20_000,
          stdio: "ignore",
        });
      } catch {
        // A syntax error will surface from typecheck with a better message.
      }
    }
  }

  // ── 3. Context that only matters for certain paths ─────────────────────────
  if (/^api\/migrations\/.*\.sql$/.test(rel)) {
    emit({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: MIGRATION_REMINDER,
      },
    });
  }

  process.exit(0);
} catch {
  process.exit(0);
}
