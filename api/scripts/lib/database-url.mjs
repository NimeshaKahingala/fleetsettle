import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolves DATABASE_URL for a CLI script under api/scripts/: the environment
 * first, then api/.dev.vars for local runs. Shared rather than copy-pasted —
 * ledger-audit.mjs and check-drift.mjs each carried an identical copy of
 * this, which is what SonarCloud's duplication gate flagged on PR #93.
 */
export function databaseUrl() {
  if (process.env["DATABASE_URL"]) return process.env["DATABASE_URL"];
  const devVars = resolve(HERE, "..", "..", ".dev.vars");
  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, "utf8").split("\n")) {
      const m = /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*(?:#.*)?$/.exec(line);
      if (m?.[1]) return m[1];
    }
  }
  throw new Error("DATABASE_URL is not set, and api/.dev.vars does not define it");
}
