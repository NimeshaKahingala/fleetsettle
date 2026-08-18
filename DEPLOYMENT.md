# Deployment — Cloudflare Workers, QA and production

**A runbook, not a specification.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done; [Plan.md](Plan.md) says what remains to build. This says how the thing gets *deployed*, in what order, and which steps cannot be undone. Where they disagree: `docs/` first, then `TRACKER.md`, then this.

**Written 5 August 2026**, from `2822193`, against a Cloudflare account and a `fleetsettle.com` zone that were inspected directly rather than assumed. Each step is written so it can be picked up cold.

**Updated 5 August 2026 — QA is deployed and smoke-green at `https://qa.fleetsettle.com`.** All infrastructure, both `wrangler.jsonc` files, the migration guard, the deploy scripts and the four workflows are done. Production waits on its `DATABASE_URL`, its schema, and GitHub configuration. See [Progress](#progress) for exactly what exists and what is outstanding.

Several claims in the original draft turned out to be wrong when executed — including the whole premise that DNS was blocked — and are corrected in place, with the reasoning kept under [Corrections](#corrections-to-the-original-draft) rather than quietly edited away.

---

## What is already true

Verified against the live account and Neon project on 5 August 2026. These are the values every later step needs.

| | |
|---|---|
| Cloudflare account | `dfcfd8b8dc03df1fa279a33cda595b36` (Nimesha.isholi94@gmail.com) |
| Zone | `fleetsettle.com` — `49fe369505ef5c9dbdd21b70b026d09b`, active, Free plan |
| **DNS records on that zone** | **none** |
| KV namespaces | none |
| R2 buckets | none |
| Queues | none |
| Workers deployed | `nimesha-portfolio` only, on the unrelated `nimesha.dev` zone |
| Neon org / project | `org-cold-rice-64493165` / `fleetsettle` = `spring-sunset-96946055`, Postgres 17 |
| Neon branches | `main` (`br-odd-cherry-afx5394i`, **empty schema**), `test`, `test-parallel` — 3 of the free plan's 10 |
| Workers plan | Free — 10 ms CPU/request, 100k requests/day, 5 cron triggers/account |

Facts that shape the work and are easy to rediscover the hard way:

- **The local wrangler OAuth token can write R2, KV and Queues, but not DNS.** `wrangler whoami`'s scope list is **not** a reliable guide — it omits R2 entirely, yet `wrangler r2 bucket create` works. What it gets right is `zone (read)`: there is no DNS write scope, and creating a DNS record with that token returns a bare `10000: Authentication error`. **Test a permission before planning around it; do not infer from the scope list.**
- **Two Cloudflare credentials are in play and they differ.** The `cloudflare-api` MCP's generic executor is read-only for R2 and DNS — it 401s on writes. The dedicated `cloudflare-bindings` MCP tools and the wrangler CLI both have write access. When a write 401s, try the other path before concluding it is impossible.
- **The account has two Cloudflare accounts on the token**, so every non-interactive wrangler command needs `CLOUDFLARE_ACCOUNT_ID=dfcfd8b8dc03df1fa279a33cda595b36` or it exits with "More than one account available".
- **`wrangler r2 bucket cors set` needs `--file`**, not `--rules`, and the JSON must be `{"rules":[{"allowed":{"origins":[…],"methods":[…],"headers":[…]},"exposeHeaders":[…],"maxAgeSeconds":N}]}` — the flat `AllowedOrigins`/`AllowedMethods` shape in Cloudflare's own CORS doc is the S3-style dashboard format and is rejected by the CLI.
- **Queues is on the free plan** (since 4 February 2026, 10,000 operations/day, 24-hour retention). This was not true when `tech-stack.md` was written and no longer needs planning around.

---

## Architecture — two Workers, one hostname per environment

```
custom domain  fleetsettle.com        ──►  fleetsettle-web      (all paths, and creates its own DNS)
route          fleetsettle.com/api/*  ──►  fleetsettle-api      (more specific — runs first)

custom domain  qa.fleetsettle.com        ──►  fleetsettle-web-qa
route          qa.fleetsettle.com/api/*  ──►  fleetsettle-api-qa
```

Frontend and backend are separate deploy units, separately versioned and separately rollback-able, but they share an origin. That last part is what makes the split cost **no new application code**: `api/src/index.ts` already mounts every route under `/api/*`, and `web/src/main.tsx:18` already defaults `VITE_API_BASE_URL` to `""` — relative paths. No CORS middleware, no preflight on mutations, and `connect-src 'self'` in `web/public/_headers` stays accurate as written.

It also means **no `VITE_*` value differs between QA and production**, so the bundle QA exercises is the bundle production gets.

One consequence lands outside deployment and is worth knowing before it is rediscovered: relative `/api` paths resolve against the Vite dev server on `localhost:5173`, not against `wrangler dev` on `:8787`. That costs nothing today — local dev deliberately does not talk to a local API yet (`web/src/lib/auth-stub.ts` says so, and the e2e suite intercepts with `page.route()`), and a proxy alone would not change it, because the stub token cannot pass JWKS verification. Whoever wires local auth adds a `server.proxy` entry for `/api` in `web/vite.config.ts` at the same time. It belongs with that work, not with this.

The web Worker takes the hostname as a **Custom Domain** and the api Worker takes a **route** on the same hostname. Two platform behaviours make that work, both confirmed against Cloudflare's documentation and then against the live QA deploy:

- **Routes run before the Custom Domain Worker.** Cloudflare's own example: a Custom Domain for `api.example.com` pointing at `api-worker`, plus a route `api.example.com/auth` pointing at `auth-worker`, sends `/auth` to `auth-worker`. That is exactly this shape, so `/api/*` reaches the API Worker and everything else falls to the client.
- **A Custom Domain creates its own DNS record and certificate on deploy.** Cloudflare wrote `qa.fleetsettle.com AAAA 100:: proxied` by itself — the same originless placeholder the earlier draft of this plan asked someone to create by hand, minus the hand.

That second point is why this shape was chosen over two `/*`-and-`/api/*` routes: **it needs no DNS credential.** Worker routes require a pre-existing DNS record, and neither available credential can write one. A Custom Domain sidesteps the blocker entirely, using the `workers_routes` and `ssl_certs` scopes wrangler already has. It also removes a placeholder record that would otherwise have to be remembered and maintained.

Universal SSL covers the apex and first-level subdomains, and the Custom Domain issues its own certificate regardless, so `qa.fleetsettle.com` needed no manual certificate work.

---

## The pipeline

```
feature/*  ──PR──►  develop  ──PR──►  main
              │        │              ▲  │
   checks.yml + integration.yml       │  │
   (ephemeral Neon branch, deleted)   │  │
                       │       the human gate
                       ▼         (see below) │
       push to develop, automatic:           ▼
              migrate  qa branch      merge to main, automatic:
              deploy   web then api      guard: fail if migrations pending
              smoke    qa.fleetsettle.com deploy   web then api
                                          smoke    fleetsettle.com
```

| | Git branch | Hostname | Workers | Neon branch | `ENVIRONMENT` |
|---|---|---|---|---|---|
| **PR gate** | PR → `develop` or `main` | — | — | ephemeral, deleted after | — |
| **QA** | `develop` | `qa.fleetsettle.com` | `fleetsettle-{api,web}-qa` | `qa` (long-lived) | `preview` |
| **Production** | `main` | `fleetsettle.com` | `fleetsettle-{api,web}` | `main` | `production` |

`ENVIRONMENT` is already a `"development" | "preview" | "production"` union in `api/src/types.ts`, and `api/src/routes/docs.ts` 404s `/api/docs` only on `"production"` — so the API spec stays browsable in QA, which is where you want it.

**Both Workers deploy together within an environment**, rather than path-filtering per workspace. `packages/shared` is imported by both, so a shared schema change must reach both at once; a path filter would let it ship to the client and not the Worker. Independent Workers still give independent versioning and rollback, which is the benefit that actually matters.

**Migrations run automatically in QA and never automatically in production.** QA is where the forward-only path gets proven; production is a one-way door on real money data. `deploy-production.yml` instead opens with a guard that fails the deploy when a migration is unapplied, so production code can never arrive ahead of its schema.

**Merging to `main` deploys production, automatically, with no approval step after the merge.** There is no post-merge gate available: required reviewers are an environment protection rule, and those do not exist on a private repository on the free plan — the API answers `422 — Please ensure the billing plan supports the required reviewers protection rule`. Environment **secrets** work on every plan; only the protection **rules** are gated.

**So the human gate is the pull request into `main`.** That is a normal continuous-delivery shape, but it relocates the decision: review that PR as the deploy decision it is, because nothing downstream will ask a second time. Three things still stand between a merge and a bad production deploy — `checks.yml`, the `migrate:check` guard that refuses to deploy code ahead of its schema, and the smoke suite that asserts the result — but none of them is a person.

Upgrading the plan or making the repo public would allow a required reviewer on top of the push trigger, which is strictly stronger. `workflow_dispatch` is kept alongside so production can be re-deployed without inventing a commit.

---

## Progress

**Done — cloud infrastructure.** Every value below is real and verified by reading it back, not by trusting the create call.

| Resource | Name | Id / state |
|---|---|---|
| KV (QA) | `fleetsettle-kv-qa` | `1dfcd1efb71846e49f6da9756a64523e` |
| KV (production) | `fleetsettle-kv` | `1c639491546d48319637f67d6db77b5a` |
| R2 (QA) | `fleetsettle-attachments-qa` | created · CORS verified · **ENAM** |
| R2 (production) | `fleetsettle-attachments` | created · CORS verified · **ENAM** |
| Queue (QA) | `fleetsettle-messages-qa` | created |
| Queue (production) | `fleetsettle-messages` | created |
| Neon branch (QA) | `qa` | `br-square-sound-afb68wft` · **migrated 0001–0007** · drift clean |
| Neon branch (production) | `main` | `br-odd-cherry-afx5394i` · **migrated 0001–0007** · drift clean |
| Worker (QA) | `fleetsettle-api-qa` | **deployed** · 4 bindings · route · cron |
| Worker (QA) | `fleetsettle-web-qa` | **deployed** · custom domain · 14 assets |
| Secret (QA) | `DATABASE_URL` | set on `fleetsettle-api-qa` |
| DNS | `qa.fleetsettle.com` | `AAAA 100::` proxied — **created by Cloudflare**, not by hand |

Both CORS policies read back as: origins `https://qa.fleetsettle.com` / `https://fleetsettle.com` · methods `PUT, GET, HEAD` · headers `content-type` · exposed `etag` · max-age 3600. Public access is off on both buckets, which is the R2 default and was not changed.

**Done — repository changes.** Both `wrangler.jsonc` files carry `env.qa` and `env.production` with every non-inheritable key restated and distinct rate-limit namespaces (`1002` / `1003`). `migrate.mjs` has `--check`. Deploy scripts are in all three `package.json` files. `pr.yml` and `integration.yml` now trigger on `[develop, main]`. The three deploy workflows exist. A local `develop` branch pointer was created from `main` **without checkout and without push**, so the in-flight work on `build/p0-foundation` was never disturbed.

`migrate.mjs --check` was verified against the real QA branch in both directions: exit 1 with "7 migration(s) pending" beforehand, exit 0 with "nothing pending" after. That is the guard `deploy-production.yml` depends on, so it was worth proving rather than assuming.

**All four wrangler configs pass `--dry-run`, with every binding resolving.** This is the specific check that catches the non-inheritable-key trap, and it is worth running again after any edit to either `wrangler.jsonc`:

```
cd api && npx wrangler deploy --env qa --dry-run          # KV, MESSAGE_QUEUE, R2, RATE_LIMITER + 4 vars
cd api && npx wrangler deploy --env production --dry-run  # same four, production ids, ENVIRONMENT=production
cd web && npx wrangler deploy --env qa --dry-run          # reads ./dist, "No bindings found" is correct here
cd web && npx wrangler deploy --env production --dry-run
```

A dropped binding shows up here as a missing row, silently, with a still-successful dry run — so read the list rather than the exit code. Both api environments must show **four** bindings plus four vars, with the ids differing between them.

### QA is live and green

`https://qa.fleetsettle.com` is deployed and passes the full smoke suite:

```
ok   /api/health    200      Worker up, no database touched
ok   /api/ready     200      Neon qa reachable and migrated
ok   /api/home      401      auth boundary live — and /api/* reached the API Worker
ok   /api/docs      200      spec browsable in QA, as intended
ok   /              200      assets Worker serving
ok   /leases/x      200      SPA fallback intact
ok   CSP + HSTS
```

The whole path-split design is therefore proven end to end, against real infrastructure, before production is touched. **DNS is no longer a blocker for either environment** — the Custom Domain creates it.

### The QA pipeline has now run for real, end to end

`develop` is pushed and `deploy-qa.yml` completed green — gate, migrate, drift check, both Worker deploys, smoke:

```
checks / gate   5m10s    guard · lint · lint:css · format · typecheck · tests · build
deploy            47s    nothing to apply · drift clean · web · api · smoke passed
```

It is no longer a design on paper: it migrated, deployed and verified with no human in the loop.

### Production is ready; one step remains

Schema migrated, secret set, workflow armed. **The only remaining action is merging `develop` into `main`, and that merge deploys.**

**No approval gate exists on that path.** The required-reviewer rule is unavailable on this plan and automatic deploy-on-merge was chosen regardless, so the pull request into `main` is the only place a person decides. See step 9.

One consequence worth knowing: **`fleetsettle.com` does not resolve yet.** Only QA has been deployed, and the production Custom Domain is created *by* the production deploy. The apex stays NXDOMAIN until that merge — the better state to be parked in.

---

## Execution checklist

Ordered by dependency. Steps 1–3 produce the ids that steps 4–5 hard-code, so they come first.

### 1 · Cloudflare resources — two isolated sets ✅ done

- [x] KV namespace `fleetsettle-kv-qa` — `1dfcd1efb71846e49f6da9756a64523e`
- [x] KV namespace `fleetsettle-kv` — `1c639491546d48319637f67d6db77b5a`
- [x] R2 bucket `fleetsettle-attachments-qa` — **public access off**
- [x] R2 bucket `fleetsettle-attachments` — **public access off**
- [x] Queue `fleetsettle-messages-qa`
- [x] Queue `fleetsettle-messages`
- [x] CORS policy on each bucket, verified by reading it back

Isolation is the point: a QA run must never be able to write into the production bucket or enqueue onto the production queue. Public access stays off on both buckets per IG §10.10 — condition photos are evidence in disputes and usually show number plates.

> **Both buckets are in ENAM, not APAC.** The `--location=apac` hint was passed and accepted, and the buckets still report `ENAM`. Cloudflare's own documentation is explicit that Location Hints "are a best effort and not a guarantee". Not worth chasing for a two-user fleet whose data is small and whose reads go through a Worker anyway, but the runbook should say what is rather than what was asked for. If placement ever matters, the only reliable lever is a **jurisdiction**, which is a different feature and is set at creation.

### 2 · DNS — ✅ nothing to do, the Custom Domain handles it

- [x] `qa.fleetsettle.com` — created by Cloudflare on the first QA web deploy
- [ ] `fleetsettle.com` — will be created by the first production web deploy

**No hand-made records, and no DNS credential needed.** This step originally asked for two `AAAA 100:: proxied` placeholders and was blocked, because neither available credential can write DNS. Switching the web Worker from a `/*` route to a **Custom Domain** removed the requirement rather than working around it: Cloudflare creates the record itself, and it creates exactly the originless placeholder this plan had specified by hand.

Verified after the QA deploy — the zone now holds precisely one record, `qa.fleetsettle.com AAAA 100:: proxied`.

`www` would still need its own record plus a redirect rule. Worth adding later; deliberately not part of this.

### 3 · Neon ✅ done

- [x] Long-lived branch **`qa`** created from `main` — `br-square-sound-afb68wft`
- [x] Migrations `0001`–`0007` applied to `qa`
- [x] DM §13 drift check against `qa` — "clean — every posted_period_id table has both triggers"

Takes the project to 4 of 10 free-plan branches, leaving headroom for the per-PR ephemeral branches `integration.yml` already creates and deletes. IG §9.2 records why that headroom matters: branch creation starts failing around nine open PRs, in CI, on someone else's PR, for a reason that looks unrelated.

Migrating QA by hand here was deliberate: it proves the forward-only path from an empty database — the same path a brand new environment takes — before `deploy-qa.yml` ever runs it unattended, and before production is asked to do it for real.

### 4 · `api/wrangler.jsonc` — add `env.qa` and `env.production` ✅ done

- [x] Top level left exactly as it was — `fleetsettle-api-local`, `workers_dev: false`, `preview_urls: false`. IG §9.4's guarantee survives untouched.
- [x] `name` — `fleetsettle-api-qa` / `fleetsettle-api`
- [x] `routes` — `qa.fleetsettle.com/api/*` and `fleetsettle.com/api/*`, both with `zone_name`
- [x] `vars` — `ENVIRONMENT` (`preview` / `production`) plus the three `ASGARDEO_*` values
- [x] `kv_namespaces`, `r2_buckets`, `queues`, `ratelimits` — all four restated in full, in both blocks
- [x] `ratelimits.namespace_id` — local `1001` (unchanged), QA `1002`, production `1003`
- [x] `triggers` and `observability` in both
- [x] Placeholder `todo-provision-before-deploy` ids replaced with the real ones

The top-level block still carries the `todo-provision-before-deploy` placeholders, deliberately: it is the local-dev config, `wrangler dev` persists KV/R2/Queue locally and never resolves them remotely, and leaving them fake is one more reason a bare `wrangler deploy` cannot reach anything real.

> **The trap.** `vars`, `kv_namespaces`, `r2_buckets`, `queues` and the binding-shaped `ratelimits` are **non-inheritable keys** in wrangler. Override any one of them in an environment and every one of them must be redeclared there — otherwise the binding silently vanishes from the deployed Worker. This is the single most likely way to ship a broken deploy that still returns 200 on `/api/health`, because `/api/health` deliberately touches nothing.

> **The second trap, in the same block.** Rate-limit counters are keyed on `namespace_id` **across the whole account**, not per Worker — Cloudflare's own documentation says two bindings sharing a `namespace_id`, "even across different Workers on the same account", share the counters, and that this is deliberate. So copying `1001` into both environments would let a burst of QA traffic consume production's budget and start 429-ing the two people who actually use this. The existing comment in `api/wrangler.jsonc` calls `namespace_id` "account-unique", which is correct and is precisely why each environment needs its own.

Cron on QA is deliberate: QA firing the scheduled path nightly against QA data is the only automatic proof that day-card generation still works before it matters in production. Two of the free plan's five cron slots.

### 5 · `web/wrangler.jsonc` — add `env.qa` and `env.production` ✅ done

- [x] `name` — `fleetsettle-web-qa` / `fleetsettle-web`
- [x] `routes` — `{ pattern: "<host>", custom_domain: true }`, **not** a `/*` route
- [x] `assets` restated in both blocks

No `binding` key: that is only valid alongside a `main`, and this Worker deliberately has none.

**`custom_domain: true` rather than `/*`** — see step 2. A `/*` route needs a DNS record that must already exist and that no available credential could create; a Custom Domain makes Cloudflare create it. The api Worker keeps a plain route, because a hostname can carry only one Custom Domain and the api Worker is the one that needs the *narrower* pattern anyway.

### 6 · `api/scripts/migrate.mjs` — add `--check` ✅ done

- [x] `--check`: read-only, **exit 1 if anything is pending**
- [x] `migrate:check` script wired into `api/package.json`

The outstanding count is a counter incremented inside the loop, not `pending().length` — `pending()` is misleadingly named and returns every migration on disk. `--status` behaviour is unchanged; the shared `reportOnly` flag is what keeps `--check` from applying anything.

**Verified against the real QA branch in both directions**, because a guard that has only been reasoned about is not a guard: exit 1 / "7 migration(s) pending" before migrating, exit 0 / "nothing pending" after.

### 7 · Deploy scripts ✅ done

- [x] `api/package.json` — `deploy:qa`, `deploy:production`
- [x] `web/package.json` — the same two, each chained after `npm run build`
- [x] Root aliases, web before api

The chaining is not a nicety. `web/wrangler.jsonc` uploads whatever is sitting in `./dist`, so an unchained deploy script will happily ship a stale bundle from last week — or, on a clean checkout, a directory that does not exist.

The root aliases deploy **web first, then api**. With both Workers on one hostname the api route is the more specific pattern, so deploying it last means the API is never live against a client bundle that predates it.

### 8 · Secrets and the production migration

Two different places need the database URL, and putting it in only one of them is the mistake that fails the first QA deploy.

**In Cloudflare, for the running Worker:**

- [x] `wrangler secret put DATABASE_URL --env qa` — pooled string for the Neon `qa` branch
- [ ] `wrangler secret put DATABASE_URL --env production` — the **pooled** string for Neon `main`

**In GitHub, for the CI runner:**

- [ ] `DATABASE_URL` as an environment secret on the `qa` GitHub environment
- [ ] `DATABASE_URL` as an environment secret on the `production` GitHub environment

> Setting the QA secret **created an empty Worker named `fleetsettle-api-qa`** — `wrangler secret put` offers to do this when the Worker does not exist yet, and in a non-interactive shell it takes the offer. Harmless: it holds no code and no routes until the first deploy. Worth knowing so its appearance in the dashboard is not mistaken for a deploy that already happened.

`migrate.mjs` and `check-drift.mjs` both resolve the URL from `process.env.DATABASE_URL`, falling back to `api/.dev.vars` — and a GitHub runner has neither. A secret that lives only in Cloudflare is invisible to them, and the migrate step dies with `DATABASE_URL is not set, and api/.dev.vars does not define it`. Every CI step that runs either script must pass it explicitly:

```yaml
- run: npm run migrate -w @fleetsettle/api
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Never a `var`. Vars are plaintext in the deployed bundle (TS §8, IG §9.4). `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` wait for P14.

Then the production schema — ✅ **applied 5 August 2026**:

```
node api/scripts/migrate.mjs --status      # 7 PENDING, nothing already applied
node api/scripts/migrate.mjs               # applied 7 migration(s)
node api/scripts/check-drift.mjs           # clean — every posted_period_id table has both triggers
node api/scripts/migrate.mjs --check       # nothing pending  → the deploy guard now passes
```

> **This was the one-way door.** Migrations are forward-only; a money system that rolls one backwards over live data has a worse problem than the migration. The `--status` output was read before applying, and showed exactly the expected seven with nothing already present.

Two things confirmed it was the right database before writing: the pooled host is `ep-cold-hall-…`, distinct from QA's `ep-morning-feather-…`, and `--status` reported all seven pending rather than a partial set. The same three commands had already run clean against `qa` from empty — the rehearsal this step exists to have.

### 9 · Branch and workflows — files done, GitHub configuration outstanding

- [x] Local `develop` branch pointer created from `main` — **not checked out, not pushed**, so the in-flight work on `build/p0-foundation` was never disturbed
- [x] `pr.yml` and `integration.yml` — trigger changed to `[develop, main]`, nothing else touched
- [x] `deploy-qa.yml` — push to `develop`, environment `qa`: checks → migrate → drift → deploy web → deploy api → smoke
- [x] `deploy-production.yml` — **push to `main`** (plus `workflow_dispatch`), environment `production`: checks → `migrate:check` guard → deploy web → deploy api → smoke
- [x] `migrate-production.yml` — `workflow_dispatch` only, prints `--status` before applying
- [x] `qa` and `production` GitHub environments created, three secrets each (`DATABASE_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) — verified present
- [x] Repo-level `NEON_API_KEY` and `NEON_PROJECT_ID` confirmed still in place for `integration.yml`
- [ ] **Push `develop`** and set it as the PR base branch
- [~] **Required-reviewer rule on `production`** — **unavailable on this plan**, and the pipeline runs without it by decision

> **The reviewer gate does not exist and cannot be created here.** GitHub returned `422 — Please ensure the billing plan supports the required reviewers protection rule`: environment protection rules are unavailable on private repositories on the free plan. Both environments exist and hold their secrets — that works on every plan — but `production` has an empty `protection_rules` array.
>
> Automatic deployment on merge was chosen anyway, deliberately. **The consequence to hold onto: the PR into `main` is the only human decision point in the production path.** Approving that PR ships to production; nothing afterwards pauses. `checks.yml`, the `migrate:check` guard and the smoke suite all still run, but they check correctness, not intent.

Smoke suite — `.github/scripts/smoke.sh <origin> <docs-status>`, shared by both deploy workflows so the two environments clear a bit-identical bar:

| Path | Expected | Proves |
|---|---|---|
| `/api/health` | 200 `{"ok":true}` | Worker is up; touches no database |
| `/api/ready` | 200 `{"ok":true}` | database reachable and migrated |
| `/api/home` | 401 | auth boundary live — **and that `/api/*` reached the API Worker** |
| `/` | 200 + CSP, HSTS | assets Worker and its headers |
| `/leases/x` | 200 | SPA fallback intact |
| `/api/docs` | 404 prod, 200 QA | IG §10.7 — passed in as the second argument |

> **Every assertion retries, and that is not defensive padding.** A freshly deployed route takes seconds to propagate, and *during that window `/api/*` still falls through to the web Worker and answers 200 with `index.html`* — identical to a real routing bug if you only look once. This was observed on the first QA deploy: `/api/home` returned 200, then 401 a minute later with nothing changed. Asserting once would have made the pipeline red on every deploy and green on every re-run, which is the kind of flake people learn to ignore.

The script was checked in both directions against live QA: exit 0 with the correct expectations, exit 1 with a clear `want 404, got 200` when given the wrong one. A smoke test that has never been seen to fail is not yet a test.

**The API token is yours to create** — it cannot be minted from here, and it should not be. A scoped token with: Account → *Workers Scripts:Edit*, *Workers KV Storage:Edit*, *Workers R2 Storage:Edit*, *Queues:Edit*, *Account Settings:Read*; Zone (`fleetsettle.com`) → *Workers Routes:Edit*, *Zone:Read*. **DNS:Edit is not required** — the Custom Domain handles records under the Workers scopes. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to both GitHub environments, alongside the `DATABASE_URL` from step 8. `NEON_API_KEY` and `NEON_PROJECT_ID` already exist for `integration.yml`.

### 10 · First deploy, by hand

- [x] `guard`, `lint`, `format:check` clean; all four wrangler configs pass `--dry-run`
- [x] **QA deployed and smoke-green** — `fleetsettle-web-qa` then `fleetsettle-api-qa`, https://qa.fleetsettle.com
- [ ] Production: same, once its `DATABASE_URL` secret and schema are in place

Deploy order is **web first, then api**, which the root `deploy:*` aliases enforce. The api route is the more specific pattern, so deploying it last means the API is never live against a client bundle that predates it.

### 11 · Documents travel together

Due when the work lands, not before — a change to mechanics that leaves its document lying about it is half a change.

- [ ] **TS §8** — real binding values per environment, replacing the placeholder table
- [ ] **TS §9** — the environment table reads Local / Preview / Production; rewrite as Local / PR / QA / Production with the promotion rule
- [ ] **TS §1** — it says "single deployment unit with the API". That is now deliberately not the case and needs correcting *with its reason*, per the rule that the owning document decides
- [ ] **TS §10** — Neon `main` is no longer empty, and a long-lived `qa` branch now stands against the 10-branch cap
- [ ] **IG §9.1 / §9.4** — environments and deploy safety, now the `--env qa` / `--env production` split
- [ ] **`web/public/_headers`** — its comment's premise ("the deployed API Worker and the Asgardeo issuer are different origins") is false for the API. `connect-src 'self'` is correct *because* the API is same-origin. The Asgardeo origin still gets added with P1 Track B, not here.
- [ ] **CLAUDE.md** — "Repository state: documentation only" has been wrong for a while and will be conspicuously wrong once this is live
- [ ] **TRACKER.md / Plan.md** — record what shipped

### 12 · Platform admin bootstrap *(added 18 Aug 2026, due when Phase 2 ships)*

**The one-time SQL below is a bootstrap for the *first* row only, not a maintenance mechanism** — every admin after it is granted through the panel (F-11.2). Ordering matters, because production holds zero `app_user` rows at the time this is written (`CLAUDE.md`), so there is no row yet to point the first `platform_admin` row at.

- [ ] **1.** Track A (the `email` scope) and Phase 1 (multi-membership plumbing) are both live — this bootstrap has no meaning before either is.
- [ ] **2.** Enable self-registration in Asgardeo, deploy Phase 2.
- [ ] **3.** Sign in once through the normal flow, and submit a business-creation request (or trigger `/api/session`'s own `app_user` upsert on first call, `IG §7.5`) — `app_user` is written just-in-time on the first authenticated *write*, so signing in alone creates nothing yet.
- [ ] **4.** Confirm the row exists: `SELECT id, email FROM app_user WHERE asgardeo_sub = '…';`
- [ ] **5.** Insert the first `platform_admin` row against that id — **`set_config` first, in the same statement batch**, or the insert 500s:
  ```sql
  SELECT set_config('fleetsettle.actor_id', '<the-id-from-step-4>', false);
  INSERT INTO platform_admin (user_id, granted_by) VALUES ('<the-id-from-step-4>', NULL);
  ```
  **Found running this against an ephemeral test branch, not assumed**: `platform_admin_audit` (migration 0030) writes `platform_audit_log.actor_id` from `audit_actor()`, which reads `fleetsettle.actor_id` — nothing sets that outside a real request's `withActor()` wrapper, and that column is `NOT NULL`. A bare `INSERT INTO platform_admin` with no `set_config` first fails on that constraint every time, self-grant or not. The bootstrap admin sets it to their own id — the same self-granted shape decision 11 already names.
- [ ] **6.** **Verify it took** — `SELECT user_id FROM platform_admin WHERE revoked_at IS NULL;` A silent no-op here is the worst outcome available: the panel renders as "not an admin," with nothing telling whoever is looking why. `SELECT * FROM platform_audit_log ORDER BY created_at DESC LIMIT 1;` should show one `admin_granted` row with `self_action = true`.

Record the actual ids and timestamps used, in this section, once run for real — the same discipline every other step in this checklist already keeps.

---

## What this does not deliver

Worth keeping in front of whoever picks this up, because a live site and a green pipeline imply more than will be true.

- **The QA gate is a smoke suite, not end-to-end tests.** `web/e2e/smoke.spec.ts` runs against `localhost:4173` with `VITE_AUTH_MODE=stub` and `page.route()` mocks — by design its token is unsigned, and a real Worker returns 401 for it. It therefore cannot run against deployed QA. What does gate: the full `npm run check` bar, the integration suite against a real Neon branch at PR time, and the post-deploy smoke suite above.
- **Real Asgardeo auth is not wired.** `web/src/main.tsx:25` uses `createUnwiredTokenGetter()`. Both environments will load, render, and fail every API call with 401. TRACKER.md:215 puts the remaining work at ~10 minutes of console changes plus the client swap, on Track B. This deployment neither changes that nor blocks it — and QA is the right place to do it first.
- **R2 will be provisioned and idle** in both environments. The presigned-upload endpoint is **A7** in [Plan.md](Plan.md) and is not built; it unblocks five recorded gaps against an `attachment` table that is already generic and polymorphic.

  **A7 inherits a CSP decision from this deployment.** `web/public/_headers` pins `connect-src` and `img-src` to `'self'`, so the answer depends on a design choice A7 has not made yet. If the browser talks **directly to R2** through a presigned URL, `_headers` must allow that bucket origin in both directives, and every condition photo in the app is then a cross-origin image. If instead the Worker **proxies** the object after checking `business_id` — same origin, no CSP change, and the W-49 driver boundary is enforced per request rather than delegated to a bearer URL that can be forwarded. IG §10.10 asks for presigned expiring URLs; it is worth re-reading that against this before building, because a presigned URL is a capability that leaves the system.
- **QA is publicly reachable.** `X-Robots-Tag: noindex` is the minimum. Cloudflare Access in front of `qa.fleetsettle.com` is the stronger answer and the account has the scope for it, but it makes the smoke job need a service token — a follow-up, not part of this.
- **Workers Free gives 10 ms CPU per request.** Almost certainly fine: the average Worker uses ~2.2 ms and this one aggregates in SQL by design. The report endpoints are where it would bite. Watch `exceededCpu` in observability; the fix is the $5/month Paid plan, not a code change.

---

## Verification

Against QA first, then production, changing only the host:

```
curl -s  https://qa.fleetsettle.com/api/health      # {"ok":true}
curl -s  https://qa.fleetsettle.com/api/ready       # {"ok":true} — DB reachable and migrated
curl -so /dev/null -w '%{http_code}' https://qa.fleetsettle.com/api/home    # 401, not 500
curl -so /dev/null -w '%{http_code}' https://qa.fleetsettle.com/api/docs    # 200 in QA, 404 in prod
curl -sI  https://qa.fleetsettle.com/               # 200 + CSP and HSTS
curl -so /dev/null -w '%{http_code}' https://qa.fleetsettle.com/leases/x    # 200 — SPA fallback
```

**The `/api/home` 401 is the line that matters.** It means the request reached the API Worker's auth middleware. A 200 with an HTML body there would mean `/api/*` is being swallowed by the web Worker — the one way this routing design fails, and it fails looking healthy.

Then the pipeline itself, which is the actual deliverable: open a trivial PR into `develop`, watch `checks` and `integration` gate it, merge, watch QA migrate–deploy–smoke go green, open the promotion PR into `main`, and confirm it **stops for approval** before touching production.

Plus: `wrangler deployments list --env qa|production` in each workspace; the dashboard showing the cron trigger registered and all four bindings attached to each API Worker; and a browser load at 360 × 640 rendering the shell.

---

## Corrections to the original draft

Found by executing step 1. Recorded rather than silently edited, because both were stated confidently and a reader who acted on either would have wasted real time.

**"The local wrangler OAuth token has no R2 scope."** Wrong. It creates R2 buckets and sets their CORS policy without complaint. The claim came from reading `wrangler whoami`'s scope list, which simply does not enumerate R2 — an absence I read as a denial. What the list *does* get right is `zone (read)`: DNS writes really are blocked, and that was confirmed by attempting one, not by inference. **The general lesson, which cost the most time here: probe the permission, do not read the list.** The corrected account of which credential can do what is in "What is already true".

**"Location hint APAC."** Passed, accepted, and ignored — both buckets are in ENAM. The original draft asserted the hint as though it were a setting. It is documented as best-effort. Recorded at step 1.

Two smaller ones, both mechanical and both costing a failed command: `wrangler r2 bucket cors set` takes `--file`, not `--rules`; and the CORS JSON must use the nested `{"rules":[{"allowed":{…}}]}` shape rather than the flat `AllowedOrigins`/`AllowedMethods` form that Cloudflare's CORS documentation shows most prominently — that one is the dashboard's S3-style format and the CLI rejects it.

**`checks.yml` had outgrown Node's default heap, and nothing had noticed.** The first full run of the gate since the codebase grew died at Lint with `exit 134` — SIGABRT, from "Ineffective mark-compacts near heap limit — JavaScript heap out of memory" at ~2 GB. It passes locally on the same default cap, because a laptop is not otherwise loaded. Type-aware `typescript-eslint` rules hold the whole program graph in memory, so this scaled with the project and would have landed on some commit regardless of which. Fixed with `NODE_OPTIONS: --max-old-space-size=4096` at job level — 4 GB and not more, because a private repo's runner has 7 GB total and the OS and npm need room. **Worth remembering that exit 134 is a crash, not a lint failure**; reading it as "lint is broken" sends you looking in the wrong file entirely.

Found by executing steps 2, 5 and 10:

**"DNS is blocked; create the two records by hand."** True of the *approach*, not of the *goal*. Both `/*`-route-plus-placeholder and Custom-Domain reach the same topology, and only the first needs a DNS credential. The plan had committed to routes for both Workers early — for good reasons about path splitting — and then treated the DNS record they imply as an immovable prerequisite. It was not: a Custom Domain on the web Worker plus a route on the api Worker splits paths identically and provisions its own DNS. **The lesson is narrower than "check permissions": when a step is blocked, re-examine whether the requirement is inherent to the goal or only to the route chosen toward it.**

**The smoke suite needed retries, and single-shot assertions would have hidden a real failure mode behind a flake.** Immediately after the first QA deploy, `/api/home` answered **200 with `index.html`** — the exact signature this document names as the one way the routing design fails. It was propagation lag, and it cleared within a minute. Two things follow. The workflows now retry every assertion (`.github/scripts/smoke.sh`). And the diagnostic that settled it was reading the **body and content-type**, not the status: `{"error":"Authorization header is required"}` proved the API Worker was being reached, where the status code alone was ambiguous.

---

## Review absorbed, 5 August 2026

`DEPLOYMENT_REVIEW.md` raised six findings. Three changed this document, two were already covered and only sharpened it, one was re-scoped. Recorded so the same six are not raised again.

**Adopted.**

- **`DATABASE_URL` as a GitHub environment secret** (step 8). The strongest finding and a genuine hole: `wrangler secret put` reaches the Worker, not the runner, and both `migrate.mjs` and `check-drift.mjs` resolve from `process.env` with a fallback to `api/.dev.vars` that does not exist in CI. The first QA deploy would have failed on its first migration step. The review said this applies to `check:drift` too; checked, and it does.
- **Distinct `ratelimits.namespace_id` per environment** (step 4). Verified against Cloudflare's documentation rather than accepted: bindings sharing a `namespace_id` share counters *across Workers on the same account*, deliberately. QA traffic really could have eaten production's budget.
- **The CSP consequence for A7** ("What this does not deliver"), but stated conditionally rather than as an unconditional "must update `_headers`". Whether the browser ever contacts an R2 origin depends on a design choice A7 has not made, and the alternative — proxying through the Worker — is the one that keeps the W-49 driver boundary enforced per request. Framing it as a settled requirement would have quietly decided that.

**Already covered; the review sharpened the wording.**

- **`--check` exit logic** (step 6) was already specified as "exit 1 if anything is pending". What the finding did surface, from reading the script, is a real trap: `pending()` returns *every* migration on disk despite its name, so the suggested `pendingMigrations.length` test would not compile against this file. That trap is now written down.
- **Chaining build before web deploy** (step 7) was already stated in prose. Now it is the literal script string, because prose describing a script is not a script.

**Not adopted as written: the Vite dev proxy.**

Recorded instead as a one-line consequence in the architecture section. The finding's premise — that the missing proxy "completely breaks local development" — is not true today: local dev deliberately does not talk to a local API, `web/src/lib/auth-stub.ts` documents that as a deferred piece of the same TRACKER item, and the e2e suite intercepts every call with `page.route()`. A proxy on its own would turn 404s into 401s, because the stub token is unsigned by design and cannot pass JWKS verification. It is also not a deployment concern. The work is real and belongs with wiring local auth, where the proxy and a token the Worker accepts land together.
