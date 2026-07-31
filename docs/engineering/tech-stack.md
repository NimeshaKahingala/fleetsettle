# Tech Stack

**Status:** v1.1 — auth reaffirmed (§2)
**Date:** 31 July 2026
**Companion:** `data-model.md` (schema) · `use-cases.md` (intent) · `user-flows.md` (mechanics)

This document exists for one reason beyond inventory: **four platform constraints change the data model**, and they are listed in §7. Read that section before reviewing the schema.

---

## 1. The stack

| Layer | Choice | Why |
|---|---|---|
| **Runtime** | Cloudflare Workers | Edge-deployed, no servers to run. Fits an app with a handful of users and long idle stretches |
| **Database** | Neon (serverless Postgres) | Real Postgres — constraints, `date` types, exclusion constraints and triggers, all of which the data model leans on hard. Scale-to-zero suits the usage pattern |
| **DB driver** | `@neondatabase/serverless` | Purpose-built for Workers. HTTP for single reads, WebSocket pool for transactions (§7.1) |
| **Query layer** | Drizzle ORM | TypeScript-first, generates SQL close to hand-written, migrations in-repo. Avoids an ORM that hides the constraints doing the work |
| **Auth (client)** | `@asgardeo/auth-react` ^5.6.2 | OIDC/OAuth2 via WSO2 Asgardeo. Handles login, token refresh, PKCE |
| **Auth (server)** | `jose` — `createRemoteJWKSet` + `jwtVerify` | Validates the Asgardeo access token in the Worker against its JWKS |
| **Frontend** | React + Vite, served as Workers Assets | Single deployment unit with the API |
| **File storage** | Cloudflare R2 | Condition photos, receipts, odometer photos, ticket images |
| **Cache / config** | Workers KV | JWKS cache, messaging kill-switch, feature flags |
| **Scheduled work** | Cron Triggers | Due generation, day-card generation, reminder dispatch, paperwork warnings |
| **Async dispatch** | Cloudflare Queues | Message sending with retry, kept off the request path |
| **Messaging** | WhatsApp Business Cloud API | Per W-14/W-21 — the transport is deliberately swappable |

---

## 2. Auth: how Asgardeo fits

**Asgardeo is the identity provider; it is not the authorisation model.** It answers "who is this person"; the `business_member` table answers "what may they do here" (W-49). Keeping those separate matters because the driver role (W-13, view-only) and the manager role are business facts, not identity-provider facts.

```
React (@asgardeo/auth-react)
   │  login, PKCE, token refresh
   ▼
Asgardeo  ──────────────► access token (JWT)
   │
   │  Authorization: Bearer <jwt>
   ▼
Worker
   ├─ jwtVerify(token, JWKS, { issuer, audience })   ← jose, JWKS cached in KV
   ├─ payload.sub ──► app_user.asgardeo_sub
   ├─ app_user.id ──► business_member (role, business_id)
   └─ every query scoped by business_id
```

**Rules this imposes on every request handler:**

1. **`business_id` is never taken from the request body.** It is resolved from the verified `sub` via `business_member`. A client-supplied business id is the whole multi-tenancy bug in one line.
2. **The JWT is validated on every request.** No session table, no server-side session state — there is nowhere in Workers to keep it cheaply.
3. **JWKS is cached** in KV with a TTL, and refetched on `kid` miss. Fetching Asgardeo's JWKS per request would add a round trip to every call.
4. **A linked driver's token is the same shape as anyone else's.** The read-only boundary (INV-25) is enforced in the data layer by `driver_id` scoping, not by trusting a claim.

**Asgardeo config needed:** a Single-Page Application registered with the app's origin as an allowed redirect and CORS origin, and the Worker's audience value pinned in `jwtVerify`.

**Reaffirmed 31 July 2026, against a specific alternative.** An imported implementation blueprint proposed replacing this with **Neon Auth** (Managed Better Auth) — users and sessions in a `neon_auth` schema in our own database, EdDSA tokens, one fewer vendor. It was evaluated and declined: Neon Auth is **beta**, **AWS-region only**, and incompatible with Neon IP Allow and Private Networking. A ledger whose entire promise is being believed about money is a poor place to carry a beta dependency on identity.

*What makes the decision cheap to reverse, if that ever changes:* the identity provider is isolated behind two things — the JWKS verification in the Worker, and the `sub → app_user → business_member` lookup. Nothing downstream of `business_member` knows or cares who issued the token, which is the same separation §2 opens with. `implementation-guidelines.md` §1.2 holds the full comparison.

---

## 3. Data access pattern

```
src/
  index.ts              Worker entry, routing
  auth/verify.ts        jose JWKS validation, sub → app_user
  auth/policy.ts        W-49 capability checks, one function per capability
  db/client.ts          neon() for reads, Pool for transactional writes
  db/schema.ts          Drizzle schema — mirrors data-model.md
  db/migrations/        SQL migrations, forward-only
  domain/…              one module per flow group (F-2 leases, F-4 daily, …)
```

**Two connection modes, chosen deliberately:**

| Mode | Use | Why |
|---|---|---|
| `neon()` HTTP | Single-statement reads — reports, lists, lookups | One round trip, no connection to hold. The cheapest thing on the platform |
| `Pool` WebSocket | Anything writing more than one row | Interactive transactions. Recording a payment writes the receipt, its allocations, the obligation status and the audit row — all or nothing |

**Why not Hyperdrive for the writes.** Hyperdrive pools in transaction mode, and its own documentation advises against wrapping multiple operations in one transaction — the connection cannot be reused for the duration, which is exactly the cost it exists to avoid. This app's writes are transactional by nature, so the Neon WebSocket pool is the better fit. Hyperdrive remains a reasonable option later for read-heavy report traffic.

---

## 4. Scheduled work (Cron Triggers)

Everything the system does "without being asked" lives here. All of it is **idempotent** — a cron that fires twice must not double-charge or double-send.

| Job | Cadence | Does |
|---|---|---|
| `generate-day-cards` | daily, early | Creates `day_record` rows for pattern days (UC-05) |
| `generate-billing-periods` | daily | Rolls the next `billing_period` and its rent obligation (UC-10) |
| `dispatch-messages` | every 15 min inside the send window | Re-checks each queued message's condition **at dispatch** (INV-12), enqueues to Queues |
| `paperwork-warnings` | daily | Surfaces documents expiring within the warning window (UC-92) |
| `deposit-hold-release` | daily | Surfaces deposits whose hold window has expired (UC-16, W-29) |

**Idempotency is a schema property, not a code habit** — `day_record` is unique on `(daily_lease_id, business_date)`, `billing_period` on `(lease_id, seq)`, and `message` on `(trigger, subject, stage)`. A duplicate run hits a constraint and stops.

---

## 5. Timezone

**Workers run in UTC; the business does not.** Every "today", every billing-period roll, and the 08:00–20:00 send window use the business timezone (W-54, `Asia/Colombo`).

```ts
// The only correct way to get "today" in this codebase.
const businessDate = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // YYYY-MM-DD
```

`new Date().toISOString().slice(0,10)` is wrong here and will be off by one for five and a half hours every day. It is worth a lint rule.

---

## 6. Money in TypeScript

Postgres `bigint` minor units (INV-20). The trap is the boundary: `pg` and Drizzle return `bigint` columns as **strings** to avoid precision loss, and `JSON.stringify` cannot serialise a JS `BigInt`.

**The rule:** money is a `bigint` in domain code, a `string` on the wire, and never a `number` anywhere. One codec module, used at both edges. A money value that has passed through `Number` is a bug even when the arithmetic happens to be right — LKR cents stay well inside `Number.MAX_SAFE_INTEGER`, so the failure will not show up in testing, only in a rounding argument two years from now.

---

## 7. Platform constraints that shaped the data model

The four that mattered, each with its consequence in `data-model.md`:

| Constraint | Consequence |
|---|---|
| **No cross-request state.** Workers hold nothing between invocations | Every invariant that a long-lived server might guard in memory becomes a **database constraint**. INV-1 is a primary key; INV-11 is a unique index. This is why the schema carries more constraints than a typical app |
| **Transactions cost a pooled connection** (§3) | Write paths are designed to be *one* transaction with a bounded number of statements. Nothing loops over rows issuing queries — bulk operations use `insert … select` and `update … from` |
| **CPU time is limited per invocation** | Aggregation happens in SQL, never in the Worker. The report definitions in UC-70…UC-79 are written as queries, and the schema carries the indexes they need |
| **No filesystem** | Photos go to R2; the database stores only the object key, content type and size (`attachment`) |

One more that is a *choice* rather than a constraint: **Postgres does the enforcing.** Exclusion constraints, partial unique indexes, deferred checks and triggers are all used deliberately, because a rule enforced in a Worker is a rule enforced in one code path and forgotten in the next.

---

## 8. Environment

| Binding | Type | Holds |
|---|---|---|
| `DATABASE_URL` | Secret | Neon pooled connection string |
| `ASGARDEO_ISSUER` | Var | e.g. `https://api.asgardeo.io/t/<org>/oauth2/token` |
| `ASGARDEO_JWKS_URL` | Var | `…/oauth2/jwks` |
| `ASGARDEO_AUDIENCE` | Var | The registered application's audience |
| `WHATSAPP_TOKEN` | Secret | Business Cloud API token |
| `WHATSAPP_PHONE_ID` | Secret | Sending number id |
| `KV` | KV namespace | JWKS cache, kill switch |
| `R2` | R2 bucket | Attachments |
| `MESSAGE_QUEUE` | Queue | Outbound dispatch |

Secrets via `wrangler secret put`, never in `wrangler.jsonc`.

---

## 9. Deployment

| Environment | Branch | Database |
|---|---|---|
| Preview | any PR | Neon branch, seeded with the §9.1 golden fixtures |
| Production | `main` | Neon primary |

**Neon database branching is worth using deliberately here.** The golden fixtures in `user-flows.md` §9.1 are the regression suite; a preview branch seeded with them means every PR can assert that §7.1's `134,000` and §7.3's `7,500` still come out right against real Postgres, not a mock.

Migrations are **forward-only**. A money system that rolls a migration backwards over live data has a worse problem than the migration.

---

## 10. Neon organization

**Org:** `FleetSettle` (`org-cold-rice-64493165`), created 30 July 2026, **Free plan**.
**Project:** `fleetsettle` (`spring-sunset-96946055`), Postgres 17, `main` branch `br-odd-cherry-afx5394i`, database `neondb`.

`main` is **empty and deliberately so** — the schema in `data-model.md` was validated on disposable branches (`data-model.md` §16.0) and has not been applied to `main`. Applying it there is a migration, and migrations are forward-only (§9), so it waits until the schema is being built on rather than tested.

Free-plan limits that bound the §9 branching strategy:

| Limit | Free plan | Consequence for FleetSettle |
|---|---|---|
| Branches | 10/project | The per-PR preview branch strategy in §9 needs a cleanup step (delete on merge/close, or a [branch TTL](https://neon.com/docs/guides/branch-expiration)) — without one, branch creation starts failing once roughly 9 branches are open at a time |
| Protected branches | Not available (Launch plan and above) | Nothing at the platform level stops `main` from being deleted or reset by a branch operation; that guardrail has to come from who holds write access in the Neon console, not from Neon itself |
| Storage | 0.5 GB/project, shared across root + child branches | Enough for early development; the first ceiling likely to matter once real fleet/lease data accumulates |
| Compute | 100 CU-hours/project/month, scale-to-zero after 5 min (can't be disabled) | Matches the "handful of users, long idle stretches" usage pattern from §1 — no action needed |
| Public network transfer | 5 GB/month | Worth watching if the report/export endpoints (UC-70…UC-79) move meaningful data out |

Nothing here blocks building on Free. The two limits worth planning around before production traffic: **branch cleanup** for the preview workflow, and the **lack of protected branches** — upgrade to Launch first if that guardrail matters before go-live.
