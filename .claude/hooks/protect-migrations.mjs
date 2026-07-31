#!/usr/bin/env node
/**
 * PreToolUse hook — runs *before* a write, so it can stop one.
 *
 * The guard hook is PostToolUse: it inspects what was written and asks for a
 * fix. That is the right shape for a rule about content. It is the wrong shape
 * for a rule about *identity* — editing a migration that has already been
 * applied elsewhere cannot be fixed by editing it again, because the copy that
 * ran is already in someone's database.
 *
 * A migration that is committed is a migration that may have been applied. So
 * an edit to one asks rather than proceeds. It does not hard-deny: while a
 * migration is being authored the file is legitimately rewritten many times,
 * and a rule with no way through gets removed instead of respected.
 *
 * Never breaks the session — every failure path exits 0, which allows the tool.
 */

import { execFileSync } from "node:child_process";
import { resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");

const read = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

try {
  const input = await read();
  const file = input?.tool_input?.file_path;
  if (!file) process.exit(0);

  const rel = relative(ROOT, resolve(file));
  if (!/^api\/migrations\/.*\.sql$/.test(rel)) process.exit(0);

  // Tracked by git means committed at least once, which means it may already
  // have run somewhere that is not this machine.
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", rel], {
      cwd: ROOT,
      stdio: "ignore",
      timeout: 5000,
    });
  } catch {
    process.exit(0); // untracked — still being authored, carry on
  }

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          `${rel} is committed, so it may already have been applied — possibly to production.\n\n` +
          "Migrations are forward-only. If this one is wrong, the fix is a new numbered migration, " +
          "not an edit to this file: editing it changes the checksum without changing any database " +
          "that already ran it, and the two silently disagree from then on.\n\n" +
          "Approve only if this migration is known not to have been applied anywhere.",
      },
    }),
  );
  process.exit(0);
} catch {
  process.exit(0);
}
