# FleetSettle — Browser Test Design

**Version:** 1.0.0
**Date:** 1 August 2026
**Source documents:** `docs/product/use-cases.md` (v1.2.2) · `docs/product/user-flows.md` (v1.1.2)

**Status, decided 11 Aug 2026 — GAP-58, retired.** This suite (178 cases across 12 files) has never been run: `test-manifest.yaml`'s own `last_full_run`/`last_updated` are still `null`, and every case is still `not_started`. It is **aspirational test design, not an execution record** — despite the "single source of truth" language below, which predates anyone checking whether it was true. Decided not to adopt it: the individual suite files stay as reference material, a real and thought-out mapping from use case to test case, but nothing here is evidence anything has been tested, and nothing will make it current. The repository's actual acceptance evidence is the automated suite (`npm test`, per-workspace) plus [`../../LIVE-TEST-PLAN.md`](../../LIVE-TEST-PLAN.md), the live-browser queue that has actually been run, repeatedly, and found a real defect on every pass so far. Full reasoning in `TRACKER.md`'s closed row for GAP-58.

---

## Purpose

This directory contains the complete browser test design for FleetSettle. Every test case is structured for execution by an **AI agent via Chrome MCP** — not for manual human testing. The format is deterministic, machine-readable, and traceable back to the product specification.

---

## How to Execute

### For the AI Agent

1. **Read** `test-manifest.yaml` to discover all suites and their dependency order.
2. **Load** the fixture file(s) needed for the current suite (see `fixtures/`).
3. **Execute** each test case in order within a suite. For each case:
   - Check **Preconditions** — skip if not met (mark `blocked`).
   - Perform each **Step** using Chrome MCP tools (`navigate`, `click`, `type`, `evaluate`).
   - After each step, run the **VERIFY** assertions.
   - After all steps, run the **Assertions (post-test)** block.
4. **Update** `test-manifest.yaml` with `result`, `last_run`, and `notes` for each case.
5. **Generate** a summary report at the end of the run.

### Dependency Resolution

Suites declare dependencies via `depends_on` in the manifest. If a dependency suite has `status: failed`, all dependent suites are `blocked`. The agent should:
- Execute suites in topological order
- Skip blocked suites with a note explaining which dependency failed

---

## Conventions

### Test Case ID Format

```
{TYPE}-{SUITE}-{SEQ}
```

| Segment | Values | Meaning |
|---|---|---|
| `TYPE` | `HP` / `EC` / `GF` | Happy Path / Edge Case / Golden Fixture |
| `SUITE` | `00`–`11` | Suite number |
| `SEQ` | `001`–`999` | Sequence within suite |

Examples: `HP-00-001`, `EC-01-005`, `GF-11-001`

### Priority Levels

| Priority | Meaning | When to run |
|---|---|---|
| **P0** | Core lifecycle — system unusable if broken | Every run |
| **P1** | Important business logic — wrong numbers if broken | Every run |
| **P2** | Edge cases and advanced features | Full regression |
| **P3** | Nice-to-have, reporting cosmetics | Release validation |

### Step Format

Each step in a test case follows this pattern:

```markdown
N. ACTION: {what the agent does — navigate, click, type, select, scroll}
   VERIFY: {what to assert immediately after — DOM state, text content, element visibility}
```

The `VERIFY` line is optional when the action is trivial (e.g., scrolling). When present, a failed `VERIFY` fails the entire test case.

### Assertion Checkpoint Format

Post-test assertions use checkbox syntax:

```markdown
- [ ] {assertion description}
```

The agent checks each one and marks `[x]` for pass or `[!]` for fail, with a note.

### Source Traceability

Every test case declares its source in the `Source:` field using the product document IDs:
- `UC-nn` — use case from `use-cases.md`
- `F-n.m` — flow from `user-flows.md`
- `INV-n` — invariant from `user-flows.md` §5
- `W-nn` — decision from `use-cases.md` §1.1
- `A-nn` — adversarial scenario from `user-flows.md` §9.3
- `G-n` — golden fixture from `user-flows.md` §9.1

---

## Directory Layout

```
docs/testing/
├── README.md                     ← you are here
├── test-manifest.yaml            ← machine-readable registry + progress
├── fixtures/                     ← test data
│   ├── seed-data.yaml
│   ├── golden-g1-bus-month.yaml
│   ├── golden-g2-accident.yaml
│   └── golden-g3-mileage.yaml
├── suites/                       ← test cases, split by domain
│   ├── 00-setup/
│   ├── 01-arrangement-a-monthly-rental/
│   ├── 02-arrangement-b-daily-lease/
│   ├── 03-arrangement-c-trips/
│   ├── 04-incidents-and-costs/
│   ├── 05-driver-management/
│   ├── 06-financial-operations/
│   ├── 07-corrections-and-audit/
│   ├── 08-period-close-and-reports/
│   ├── 09-notifications/
│   ├── 10-permissions-and-roles/
│   └── 11-golden-fixture-e2e/
└── invariants/
    └── invariant-checks.md       ← reusable INV-* assertion blocks
```

---

## Coverage Targets

| Source | Count | Covered by |
|---|---|---|
| Use cases (UC-01 – UC-99) | 99 | Happy path suites 00–10 |
| Invariants (INV-1 – INV-30) | 30 | `invariants/invariant-checks.md` + inline in suites |
| Adversarial scenarios (A-1 – A-26) | 26 | Edge case suites 00–10 |
| Golden fixtures (G-1 – G-3) | 3 | Suite 11 |
| Property tests (§9.2) | 8 | Edge case suites (parameterized) |
| Flows (F-0 – F-10) | 40+ | Mapped through their UC sources |

---

## Progress Tracking

**Retired 11 Aug 2026 (GAP-58) — describes intended process, not current practice.** `test-manifest.yaml` was meant to be the single source of truth for execution progress; it has never been executed against. Kept below for anyone who does pick this suite up. After each execution:

1. The agent updates each test case's `status` and `result`
2. The suite-level `status` is derived from its cases
3. A `notes` field captures failure details or observations

Status values: `not_started` · `in_progress` · `passed` · `failed` · `blocked` · `skipped`
Result values: `pass` · `fail` · `skip` · `blocked` · `null` (not yet run)

---

## Maintenance Rules

1. **Adding a test:** add the case to the correct suite file AND to `test-manifest.yaml`
2. **Changing a golden fixture number:** stop. Re-read §9.1 of `user-flows.md` to understand why it was that number. A change here is a specification change, not a test change.
3. **Source precedence:** `use-cases.md` wins on intent, `user-flows.md` wins on mechanics (per §0 of user-flows.md)
