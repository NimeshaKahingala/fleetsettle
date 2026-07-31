# FleetSettle

A ledger for a small Sri Lankan vehicle-rental business — a bus and two cars, run by two partners, one of whom does all the data entry and the other of whom reads the reports.

**Its whole promise is being believed about money.** Every rule below exists because breaking it produces a number that is wrong, plausible, and not noticed until someone argues about it months later.

**Repository state: documentation only.** No application code exists yet. `docs/` is complete and implementation-ready; the schema has been executed against live Postgres 17 and the golden fixtures pass 39 of 39.

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

No build yet. When the workspaces land (`api/`, `web/`, `packages/shared`), root scripts delegate rather than implement — `npm run lint` → `npm run lint --workspaces --if-present` — so CI and humans use the same entry points.

The first implementation tasks, in order, are in IG §12. The first two are not negotiable: apply the DM §16.0 DDL as migration `0001`, then the `audit_log` trigger as `0002`, **before any money table holds live data**.
