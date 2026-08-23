# FleetSettle — browser test scenarios

**Source documents:** `docs/product/use-cases.md` · `docs/product/user-flows.md`

**The living scenario catalogue.** Independent of `../live-test-plan.md` (the pending queue) and `.claude/skills/run-qa-pass/SKILL.md` (how to run a session) — this directory says *what* a real browser should confirm, by flow, at happy-path/edge-case/error-case depth; the queue says what's actually still pending against the current build; the skill says the mechanics of running a session at all. Written 1 August 2026, then unrun and correctly not trusted as an execution record (GAP-58) — the structure was always sound, but the literal UI text (button labels, screen names) had drifted from the real app by the time anyone checked. **Refreshed 22 August 2026** against current source for suites 00–06, 08, 11 and `invariants/`; suites 07, 09 and 10 are known to still need real rework (07: several cases describe a "reverse/edit any record" mechanism that was never built — corrections are void-and-replace, not edit, per W-50; 09: the whole suite describes messaging UI that doesn't exist yet, P14 is deliberately deferred to phase 2; 10: predates the platform-admin/multi-business tier and the four-role model entirely, added 18 Aug — needs new cases, not label fixes).

A case describing a flow with **no current UI at all** is marked `**Not built** (as of 22 Aug 2026)` in place of its steps, with a one-line pointer to why (a phase deferral, a GAP id, or an architecture mismatch) — kept, not deleted, so the catalogue still records the intended behaviour even where the product hasn't caught up. Re-check that marker before trusting it; it's a snapshot, not a promise.

---

## How to use this

Pick the suite for the flow you're checking, read its `happy-path.md` and `edge-cases.md`. Each case is self-contained: preconditions, numbered `ACTION`/`VERIFY` steps, post-test assertions. Suites have no enforced run order or pass/fail dependency between them — this is a reference catalogue, not a pipeline. When a live session (`run-qa-pass`) walks a case and finds its literal text wrong, fix it in place; that's the maintenance model, not a separate backlog.

## Conventions

### Test case ID format

```
{TYPE}-{SUITE}-{SEQ}
```

| Segment | Values | Meaning |
|---|---|---|
| `TYPE` | `HP` / `EC` / `GF` | Happy Path / Edge Case / Golden Fixture |
| `SUITE` | `00`–`11` | Suite number |
| `SEQ` | `001`–`999` | Sequence within suite |

Examples: `HP-00-001`, `EC-01-005`, `GF-11-001`

### Priority levels

| Priority | Meaning |
|---|---|
| **P0** | Core lifecycle — system unusable if broken |
| **P1** | Important business logic — wrong numbers if broken |
| **P2** | Edge cases and advanced features |
| **P3** | Nice-to-have, reporting cosmetics |

### Step format

```markdown
N. ACTION: {what to do — navigate, click, type, select, scroll}
   VERIFY: {what to assert immediately after — DOM state, text, visibility}
```

`VERIFY` is optional when the action is trivial. Post-test assertions use checkbox syntax (`- [ ] …`).

### Source traceability

Every case cites its source in a `Source:` field:
- `UC-nn` — use case (`use-cases.md`)
- `F-n.m` — flow (`user-flows.md`)
- `INV-n` — invariant (`user-flows.md` §5)
- `W-nn` — decision (`use-cases.md` §1.1)
- `A-nn` — adversarial scenario (`user-flows.md` §9.3)
- `G-n` — golden fixture (`user-flows.md` §9.1)

---

## Directory layout

```
docs/qa/scenarios/
├── README.md               ← you are here
├── fixtures/                ← test data (seed-data.yaml, golden fixtures)
├── suites/                  ← test cases, split by domain, happy-path.md + edge-cases.md each
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
    └── invariant-checks.md  ← reusable INV-* assertion blocks
```

---

## Maintenance rules

1. **Adding a case:** add it to the right suite file, with a `Source:` citation. No separate index to keep in sync — the suite files are the whole catalogue.
2. **Changing a golden fixture number:** stop. Re-read user-flows.md §9.1 to understand why it was that number — a change here is a specification change, not a test change.
3. **Source precedence:** `use-cases.md` wins on intent, `user-flows.md` wins on mechanics (per §0 of `user-flows.md`).
4. **Finding stale UI text while walking a case:** fix it in place, same session. That's how this catalogue stays trustworthy without a separate refresh project.
