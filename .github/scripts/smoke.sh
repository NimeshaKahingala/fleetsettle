#!/usr/bin/env bash
#
# Post-deploy smoke suite (DEPLOYMENT.md "Verification"). Shared by
# deploy-qa.yml and deploy-production.yml so the two environments are
# checked against a bit-identical bar.
#
#   smoke.sh <origin> <expected /api/docs status>
#
# /api/docs is the one check that differs: 404 in production (IG §10.7),
# 200 in QA, where a browsable spec is the point.
#
# Every assertion retries. A freshly deployed Worker route takes a few
# seconds to propagate, and during that window `/api/*` still falls through
# to the web Worker's SPA fallback and answers 200 with index.html — which
# is indistinguishable from a real routing bug if you only look once. This
# was observed on the first QA deploy, not predicted.

set -euo pipefail

ORIGIN="${1:?usage: smoke.sh <origin> <docs-status>}"
DOCS_EXPECTED="${2:?usage: smoke.sh <origin> <docs-status>}"

ATTEMPTS=12
DELAY=5

code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

expect() {
  local path="$1" want="$2" why="$3" got=""
  for _ in $(seq "$ATTEMPTS"); do
    got="$(code "${ORIGIN}${path}")"
    if [ "$got" = "$want" ]; then
      printf '  ok   %-14s %s\n' "$path" "$want"
      return 0
    fi
    sleep "$DELAY"
  done
  printf '  FAIL %-14s want %s, got %s — %s\n' "$path" "$want" "$got" "$why" >&2
  return 1
}

echo "Smoke: ${ORIGIN}"

expect /api/health 200 "Worker is not up"
expect /api/ready  200 "database unreachable or unmigrated"
# The load-bearing one. A 200 here means /api/* never reached the API
# Worker and the web Worker served index.html in its place.
expect /api/home   401 "/api/* is being swallowed by the web Worker"
expect /api/docs   "$DOCS_EXPECTED" "docs gate wrong for this environment"
expect /           200 "assets Worker is not serving"
expect /leases/x   200 "SPA fallback is broken"

echo "Checking security headers"
headers="$(curl -sI "${ORIGIN}/")"
grep -qi '^content-security-policy:' <<<"$headers" || {
  echo "  FAIL missing Content-Security-Policy" >&2
  exit 1
}
grep -qi '^strict-transport-security:' <<<"$headers" || {
  echo "  FAIL missing Strict-Transport-Security" >&2
  exit 1
}
echo "  ok   CSP + HSTS"

echo "Smoke passed."
