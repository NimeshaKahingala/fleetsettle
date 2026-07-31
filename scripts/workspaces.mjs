#!/usr/bin/env node
/**
 * Runs one npm script across every workspace that actually exists.
 *
 * `npm run <script> --workspaces --if-present` does not do this: --if-present
 * tolerates a workspace without that script, but the command still fails with
 * "No workspaces found!" when no workspace has a package.json yet. That is the
 * state this repository is in until IG §12.1, and a gate that errors before the
 * first line of code trains everyone to skip it.
 *
 *   node scripts/workspaces.mjs typecheck
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const script = process.argv[2];

if (!script) {
  console.error("usage: node scripts/workspaces.mjs <script>");
  process.exit(2);
}

const roots = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).workspaces ?? [];

// Only literal and single-level `dir/*` patterns — that is all this repo uses,
// and a glob dependency for two shapes is not worth the supply chain.
const candidates = roots.flatMap((pattern) => {
  if (!pattern.endsWith("/*")) return [pattern];
  const parent = resolve(ROOT, pattern.slice(0, -2));
  if (!existsSync(parent)) return [];
  return readdirSyncSafe(parent).map((d) => `${pattern.slice(0, -2)}/${d}`);
});

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

const present = candidates.filter((ws) => {
  const pkg = resolve(ROOT, ws, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    return Boolean(JSON.parse(readFileSync(pkg, "utf8")).scripts?.[script]);
  } catch {
    return false;
  }
});

if (!present.length) {
  console.log(`${script}: no workspace defines it yet — skipping`);
  process.exit(0);
}

for (const ws of present) {
  console.log(`\n> ${ws}: ${script}`);
  const r = spawnSync("npm", ["run", script, "-w", ws], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
