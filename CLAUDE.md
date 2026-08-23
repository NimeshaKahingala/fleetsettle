# FleetSettle

A ledger for a small Sri Lankan vehicle-rental business — a bus and two cars, run by two partners, one of whom does all the data entry and the other of whom reads the reports.

**Its whole promise is being believed about money.** Every rule below exists because breaking it produces a number that is wrong, plausible, and not noticed until someone argues about it months later.

**Repository state: deployed and running.** The Worker is complete through P13, the React client through Web-P8b, and both environments are live — `fleetsettle.com` (production) and `qa.fleetsettle.com` (QA), each backed by its own Neon branch. **Migration numbers deliberately not quoted here, corrected 16 August 2026**: this paragraph said production was on `0001`–`0014` and QA on `0001`–`0023` long after both had moved — `main` and `develop` now carry the identical 28 migration files, `0001`–`0028`. A hand-copied number in the always-loaded context file is the worst place for this fact to live, because it is read constantly and updated never. **`npm run migrate:status` is the answer; this file is not.** **`main` started deploying to production 22 August 2026** (PR #99, `develop`→`main`, a deliberate corrective release) — this paragraph previously said the two environments were "deliberately apart" with production holding zero rows pending phase-1 completion; that framing is now stale. **Production is not yet open to real users**: it is internal testing only, any data in it is disposable, and the owner has explicit freedom to wipe it before an actual go-live. `docs/` remains the specification and still decides; the golden fixtures pass 39 of 39 against live Postgres 17.

[TRACKER.md](TRACKER.md) is what is built and every open gap; [Plan.md](Plan.md) is what remains; [DEPLOYMENT.md](DEPLOYMENT.md) is how it ships. **Merging to `main` deploys production automatically and nothing pauses afterwards** — the pull request is the deploy decision.

---

## Where things are

Read [docs/README.md](docs/README.md) first — it maps the seven documents, gives the read order, and defines the citation prefixes (`UC §`, `FL §`, `DM §`, `TS §`, `IG §`, `UI §`, `BR §`) used throughout.

| Need | Go to |
|---|---|
| What the business does, and why | `docs/product/use-cases.md` |
| Exact behaviour, invariants, acceptance criteria | `docs/product/user-flows.md` |
| Schema, constraints, report queries | `docs/engineering/data-model.md` |
| Stack and platform constraints | `docs/engineering/tech-stack.md` |
| How to build on it — layering, errors, tests, CI | `docs/engineering/implementation-guidelines.md` |
| Screens, components, tokens, the React client | `docs/design/ui-ux-guidelines.md` |
| Mark, lockups, icons, voice | `docs/design/brand-guidelines.md` |

**Before changing behaviour, read the document that owns it.** Nothing here is arbitrary; almost every rule has a recorded reason, and the reason is usually a specific way the numbers go wrong.

---

## Rules that must not be broken

### Money

- **`bigint` minor units in the database, `bigint` in domain code, `string` on the wire, never `number` anywhere.** LKR cents stay well inside `MAX_SAFE_INTEGER`, so a `Number` round-trip will never fail a test — only a rounding argument two years from now. One codec module, used at both edges.
- **Whole minor units, rounded half-up. Splitting an amount hands the remainder to the largest fractional shares** so the parts always add back to the whole.
- **Deposits and advances are money you hold, never income.** Booking either as income inflates the month it arrives and forces a reversal out of a month already closed.
- **Never net the driver's two balances.** What he owes and what he is owed are separate figures; the net is displayed as information and only an explicit `offset_record` moves both (W-2).
- **`earned` and `received` are separate facts and never collapse in storage.** Collapse them and a cheap day is indistinguishable from an unpaid day forever.
- **`borne_by` and `paid_by` are two fields.** The manager buying the driver's fuel out of his own pocket is borne by the driver and paid by the manager; one field cannot say both (W-48).

### Time

- **"Today" is the business timezone's today** (`Asia/Colombo`), never the device's and never the server's.
- `new Date().toISOString().slice(0,10)` is **wrong** and will be off by one for five and a half hours a day. Use `Intl.DateTimeFormat('en-CA', { timeZone: tz })`.
- **In SQL, pass the business date as a parameter. Never `CURRENT_DATE`** — Postgres evaluates it in the server's timezone.
- **A billing period is not an accounting period.** A lease cycle (the 12th to the 11th) and a settled month coincide only by accident (W-40).

### Tenancy and access

- **`business_id` is resolved from the verified JWT `sub` via `business_member`. It is never taken from a request body or query param.** That single line is the whole multi-tenancy bug.
- **A linked driver must not reach another driver's data by any route** — report, export, shared link or crafted request. This is a security requirement, not a preference (W-49), and it has its own test class.
- **Cross-tenant access returns 404, never 403** — a 403 confirms the row exists. A capability the role lacks returns 403, because the row's existence is not the secret.

### Writes

- **Every money write is one transaction.** Confirming a day is four inserts; a partial write leaves a day confirmed but unpaid, which is a debt the driver does not owe.
- **Money records are append-only.** Corrections void and replace with a reference to the original — never an overwrite (W-50).
- **The period-open trigger is the truth.** Do not pre-check in application code; catch the violation and map it to `PERIOD_CLOSED`. Two implementations of one rule will diverge.
- **A new money table is not finished until it is in the `assert_period_open()` array.** DM §13 carries a CI assertion for exactly this — the list is hand-maintained and has drifted once already.
- **Idempotency lives in the constraints, not in code.** On cron paths, treat a unique violation as success: a job that fires twice should be a no-op, not a page.
- **No cron is a prerequisite for a user action.** Confirming a day whose card was never generated creates it. A scheduled job that failed overnight must be invisible to the user.

### Numbers that go wrong quietly

- **Reports degrade to "not available", never to zero** (W-56). A confident wrong number is worse than an admitted gap.
- **The lost-day denominator is `ran + lost`** — it excludes days the pattern never scheduled and days paused for a charter. Include either and the report overstates in the direction that costs money.
- **Rent is a fixed amount per billing period; mileage allowance is per day × days in the period.** Making these consistent is the one place in this system where consistency is a bug (W-25).
- **Mileage is one-directional.** Driving under the allowance produces no refund, no credit and no carry-forward.
- **A waiver and a write-off never share a bucket.** One is a discount you chose, the other a loss you were handed (W-28).

### Interface

- **Every phase-1 flow completes on 360 × 640, one thumb, no horizontal scroll** (M-1).
- **Nothing at level 2 or 3 is ever required to save a record** (U-2). Every create form must save with level-1 fields only — this is an automated test, not an intention.
- **Minimum interactive target 44 × 44 CSS px**, ≥ 8px apart, ≥ 16px when one is destructive.
- **No raw hex anywhere.** Colour comes from `--color-*` tokens; the `--color-` prefix is required by Tailwind v4's `@theme` namespace, not decorative.
- **Colour never carries meaning alone** — always a word, a sign or an icon beside it.
- **Reserved vocabulary, never abbreviated.** "Daily lease amount" (he pays you) and "driver day fee" (you pay him) are opposite directions of money and must never both shorten to "rate". No accounting vocabulary in the interface at all — no "accrual", "current account", "allocation", "receivable" (U-6, FL §1.5).

### Process

- **Migrations are hand-written SQL, numbered, forward-only.** A money system that rolls a migration backwards over live data has a worse problem than the migration.
- **The golden fixtures are the regression suite.** Any change that moves **134,000**, **15,000** or **7,500** is a breaking change and must fail loudly (FL §9.1).
- **Documents travel together.** A change to intent that alters mechanics is one change; shipping half leaves the pair lying about each other.

---

## Working here

- **The owning document decides.** If a change contradicts `docs/product/use-cases.md`, that document is right and the change is wrong — or the document needs changing first, deliberately, with its reason recorded.
- **Record what you did not take.** Every document that has absorbed a review lists the recommendations it declined and why. Continue that; it is what stops the same argument happening twice.
- **When a rule here seems wrong, it may well be** — three are flagged in UC §8 as worth attacking. Say so and make the case; do not route around it silently.

## Commands

```
npm run check        the whole gate — what CI runs
npm run guard        the rules ESLint cannot see: SQL, migrations, interface copy
npm run lint         eslint . (flat config at the root covers every workspace)
npm run lint:css     stylelint
npm run format       prettier — deliberately excludes docs/
npm run typecheck    delegates per workspace
npm test             delegates per workspace
```

The workspaces (`api/`, `web/`, `packages/shared`) do not exist yet; `typecheck`, `test` and `build` delegate through `scripts/workspaces.mjs`, which skips a workspace that has not been created rather than failing the gate. **`guard`, `lint`, `lint:css` and `format:check` work today and are wired into a `PostToolUse` hook**, so a violation blocks at the moment the file is written rather than in CI. IG §16 is the table of which rule is caught by which mechanism, and why five of them can only be caught by a test.

Every check takes an inline exemption that requires a reason — `// eslint-disable-next-line … -- odometer km, not money`, or `-- allow: <reason>` in SQL. Use it rather than deleting a rule; the point is that the exception is visible in the diff.

The first implementation tasks, in order, are in IG §12. The first two are not negotiable: apply the DM §16.0 DDL as migration `0001`, then the `audit_log` trigger as `0002`, **before any money table holds live data**.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **fleetsettle** (5839 symbols, 18389 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/fleetsettle/context` | Codebase overview, check index freshness |
| `gitnexus://repo/fleetsettle/clusters` | All functional areas |
| `gitnexus://repo/fleetsettle/processes` | All execution flows |
| `gitnexus://repo/fleetsettle/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
