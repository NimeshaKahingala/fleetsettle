# Build tracker

**Not a specification.** `docs/` says what to build and why; this says what is done and in what order. It exists to be ticked off and eventually deleted. Where the two disagree, `docs/` is right.

Fifteen phases. P0–P3 are a strict chain; after that the graph opens up.

**Validated 31 July 2026** against UC §9.1 (product phasing), UI §15 (design build order), IG §12 (bootstrap) and DM §13 (the money-table list). Three corrections came out of that pass and are noted at the bottom.

---

## The five rules that decide the order

**1. `packages/shared` is the root of the dependency graph.** The money codec, the business-date helper and every resource's Zod schema live there and are imported by both sides. Nothing precedes it, and a bug in it is structural rather than local.

**2. The schema is the synchronisation point, and the main lever for parallelism.** Once a resource's Zod schema lands in `packages/shared`, the two tracks separate: the Worker builds against a real Neon branch, the client against mocks derived from *the same schema object*. Hand-mirrored types drift silently and what drifts is a money field (IG §2). So the schema is always a phase's first task, never its last.

**3. Auth blocks the client, not the Worker.** `tests/support/auth.ts` mocks the verifier and mints a user in each W-49 role (IG §8.3), so endpoints are built and fully tested before Asgardeo works. Only the browser needs the real thing.

**4. No cron is ever a prerequisite for a user action.** Confirming a day whose card was never generated creates it. Scheduled work lands *after* the flow it mirrors, never before, and never as the only path to a record.

**5. Reports come after the writes that feed them.** A report with no data behind it cannot be checked against the rule that matters — degrade to "not available", never to zero (W-56).

### Shape of the graph

```
P0 ─► P1 ─► P2 ─► P3 ─┬─► P4 ─┬─► P5 ─┐
 found.    entities   daily    │       ├─► P9 ──► P10 ──► P11 ──► P12 ──► P13 ──► P14
            + all      loop    ├─► P6 ─┤  close   write-  reports offline  cron   messaging
            components         ├─► P7 ─┤          offs
                               └─► P8 ─┘
```

P5, P6, P7 and P8 depend on P4 and on nothing among themselves. Their relative order is a free choice.

### Where the golden fixtures land

They are the regression suite and they gate three phases (FL §9.1). Any change that moves one is a breaking change and must fail loudly.

| Fixture | Figure | Reproduces at the end of |
|---|---|---|
| **G-3** Mileage on an open-ended rental | **7,500** | P5 |
| **G-2** One accident | **15,000** | P8 |
| **G-1** One month of the bus | **134,000** | P9 |

---

# P0 · Foundation

No product value. Everything depends on it. **Fully unblocked.**

**Shared**
- Money codec — `Minor = bigint`, parse, format, largest-remainder split
- Business-date helper — `Intl.DateTimeFormat('en-CA', { timeZone })`
- Error-code constants, used by the Worker's error shape and the client's handler

**Backend**
- `npm init -w api`; Hono, `@hono/zod-openapi`, `@neondatabase/serverless`, Drizzle, `jose` at the IG §14 floors
- `wrangler.jsonc` — local-only `name`, `workers_dev: false`, KV/R2 bindings
- The layer directories, empty (IG §3.1); error shape and structured logger (IG §3.3, §3.4)
- Per-request db middleware — `neon()` HTTP for reads, `Pool` for transactions
- **Migration runner** — Postgres advisory lock + SHA-256 checksum per filename
- **Migration `0001`** — the DM §16.0 DDL
- **Migration `0002`** — the `audit_log` trigger, *before any money table holds live data*
- `/api/health` (no DB) and `/api/ready` (`SELECT 1`)
- `/api/docs` returns 404 in production, **verified in CI** (IG §10.7)
- `tests/support/*` — `env`, `client`, `factories`, `auth` (user/role minting half) are built and proven against a real Neon branch; `fixtures.ts` (the §9.1 golden seeds) is deliberately deferred to P5/P8/P9, whichever a phase's own golden figure gates — writing it now would mean hand-seeding obligation/payment/incident rows with no domain code yet to exercise them. `auth.ts`'s verifier-mocking half is deferred to P1, for the same reason: nothing to mock before `auth/verify.ts` exists.
- Response schemas that actually `.parse()` outside production (IG §11)

**Frontend**
- `npm init -w web`; Vite + React 19 + TypeScript
- Tailwind v4, `tokens.css` per UI §12.3 — palette constants, `@theme`, both dark selectors, `:lang(si)`. A test compares the media-query dark block against the `[data-theme="dark"]` block declaration-by-declaration, per §12.3's own warning that a hand-diff is the cheaper alternative to the bug.
- Vitest + Testing Library (a smoke render); Playwright with a 360 × 640 project (a smoke spec — no horizontal scroll at 360 or 320px). The full §12.6 test table (axe-core per route, the level-1-only save test, the reserved-vocabulary lint) needs screens and forms that don't exist before P2
- `vite-plugin-pwa`; manifest from BR §5.2, icons copied from `docs/design/brand/png/`. Runtime caching (stale-while-revalidate reads, the paused mutation queue) is deferred to P12, which has the offline flows to prove it against — this is the shell precache only. iOS splash screens are deliberately not generated (BR §5.3's own recommendation)
- **Security headers on the assets Worker** — CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, via a native `public/_headers` file rather than Worker code (confirmed via Cloudflare's docs: `_headers`/`_redirects` are supported natively on Workers-with-assets). `connect-src` is `'self'`-only until P1 adds the real API and Asgardeo origins
- Found in passing: `stylelint.config.js`'s `tokens.css` override pointed at `web/src/styles/`, not `web/src/design/` (UI §12.2) — fixed. Two guard/lint rules were false-positiving on Tailwind v4's own reserved syntax (`--text-*` is the font-size namespace, not an untokenised colour; `--text-*--line-height` is its sanctioned paired-property suffix, not a kebab-case violation) — narrowed rather than suppressed per-occurrence, in `scripts/check-forbidden.mjs` and `stylelint.config.js`
- `eslint-plugin-jsx-a11y` deliberately not added yet — its published peer range caps at ESLint 8/9, and this repo is on ESLint 10; axe-core in Playwright (P2+) is the a11y gate until it catches up

**Ops** — CI creates, seeds and **deletes** a per-PR Neon branch. Not optional on the free plan: branch creation starts failing around nine open PRs, and it fails on someone else's PR for a reason that looks unrelated (IG §9.2). One workflow (`integration.yml`) does this, applies both migrations, runs the DM §13 drift check, then the api integration suite — deliberately one branch per PR rather than two. Still blocked on `secrets.NEON_API_KEY` / `vars.NEON_PROJECT_ID`, which don't exist in the repo yet.

Error monitoring — **deliberately deferred**, not wired. Asked: Tail Worker (no new vendor, but still needs a real alert destination — a webhook, Slack, email — that's a separate thing to provide) vs Sentry (needs an account and a DSN) vs defer. Decision: defer — Workers Logs (`observability.enabled`) stays the only observability until there's an actual on-call person and a channel to page; revisit then rather than build an alert that pages no one.

**Depends on** — nothing.

**Done means** — `npm run check` runs both workspaces instead of skipping. `0001` and `0002` are applied to a Neon branch and the DM §13 drift assertion returns zero rows. The codec's tests cover the U+2212 minus, the M-16 cents rule, and a split that sums back to the whole.

---

# P1 · Identity, tenancy and the access boundary

The one phase where a mistake is a security bug rather than a wrong number.

**Backend** — done.
- `jose` — `jwtVerify` against a **local** JWKS (`createLocalJWKSet`) fetched through KV rather than `createRemoteJWKSet`'s in-memory cache, which only helps the isolate that populated it — refetch-once on a `kid` the cached set doesn't have, then one undifferentiated 401 for every other failure (bad signature, wrong issuer/audience, expired), since none of those distinctions are the caller's to learn from
- `sub → app_user → business_member` **or** `driver.linked_user_id` in one query (`queries/identity.ts`), not three round trips — a linked driver never gets a `business_member` row (DM §3's CHECK constraint), so this is a real second path, not a variation of the first. No membership at all resolves to the same 404 a foreign business would; nothing in the product supports one user across multiple businesses, so this doesn't build a selector for a case that can't happen
- `auth/policy.ts` — one function per row of the W-49 matrix that *is* a flat role check. Two rows aren't: "ownership shares… (own vehicles)" needs P2's ownership records, and "see another driver's data" is `driver_id` scoping in the data layer, not a capability — both noted in the file rather than faked
- The status rule wired once: cross-tenant **404**, lacked capability **403** — proven by `NotFoundError`/`ForbiddenCapabilityError` through the real middleware chain, not asserted in isolation
- The linked-driver test class, exercised against real `vehicle`/`driver` rows via temporary `/api/_probe/*` routes (no CRUD exists before P2) — `GET /api/me` is the one permanent route this phase adds, and doubles as the frontend's role→shell signal
- Rate limiting via the Workers `ratelimit` binding, keyed by `CF-Connecting-IP`, mounted globally — confirmed locally via `wrangler dev` that `namespace_id` needs no separate provisioning step, unlike KV/R2/Queue
- Both Vitest projects (IG §8.1) now have real content: `unit` covers JWKS cache-hit/miss/kid-miss/refetch and the rate-limit middleware with a mocked `fetch`/fake KV, no Postgres; `integration` covers the full matrix above through `app.request()` against the real Neon branch, using a real ES256 keypair (`tests/support/jwks.ts`) to sign test tokens — `auth/verify.ts` is not mocked, only the IdP is

**Frontend**
- `@asgardeo/auth-react` provider, PKCE, refresh — **blocked on the console changes**
- API client with an **injected** token getter and a 401-retry-once backstop
- Role → shell selection; Operate / Review / Mine skeletons

**Depends on** — P0. Frontend additionally on Asgardeo: token type JWT, binding None, redirect URLs cleaned.

**Done means** — a probe endpoint passes the whole matrix: happy path · 401 missing header · 401 verifier throws · 403 capability · **404 for another business**. A linked-driver token gets 404 for another driver's row. `getAccessToken()` is on the wire, never the ID token (IG §7.3).

---

# P2 · Entities, setup and the component inventory

The biggest phase, and deliberately so. Nothing can hold money until a business, a vehicle and **an open accounting period** exist — and no screen should be built until the components it assembles are finished.

**Shared** — schemas for business, vehicle, driver, customer, arrangement, `accounting_period`.

**Backend**
- CRUD for business, vehicle, driver, customer — done
- The three arrangements and their terms, **with the original start date preserved** so billing periods land on the right day of the month — done. Scope drawn from DM §4.1's "how far ahead the calendar is materialised" table: a **trip's** `vehicle_day_allocation` is written in full at booking (bounded, INV-1 enforced now), but a **lease** or **daily lease's** calendar is a rolling-horizon cron responsibility (`generate-day-cards`, DM §4.1) — that's P13's, not this endpoint's, so INV-1 is not yet enforced for lease/daily-lease and a trip does not yet pause any `day_record` (P3's table). Recorded rather than silently skipped
- Opening balances (UC-08, UC-09) — done. `opening_balance_batch`/`opening_balance_entry` (DM §10.6) only — the vehicle/lease/daily-lease terms UC-09 also asks for go through F-1.1/F-2.1/F-1.7's own endpoints with a backdated `startDate`, not through this one. `PUT /api/opening-balance` fully replaces the one-per-business batch's entries (draft or, per the Alternates clause, a correction after commit); `POST /api/opening-balance/commit` flips it, idempotently. Gated by a new owners-only `manageOpeningBalances` capability, not the STAFF-wide `manageEntities` — getting the go-live numbers wrong has the same blast radius as closing a period. Not yet gated by "the first period has closed" (P9's territory; no business can reach that state yet, so nothing to enforce) — recorded rather than built against a state that can't occur
- Paperwork expiry *dates* on the vehicle (UC-92) — the warning job is P13 — done
- **Open the first accounting period.** The period trigger makes this a prerequisite for every later write — done (as part of business creation, F-0.1)

**Frontend** — UI §15's build order binds here: **tokens and the five load-bearing components come before any screen**, because every screen after them is assembly.
- shadcn primitives copied in and resized to 44px — done. `Button` (cta 56px / default min-44px / icon 44×44), `Input`, `Label`, `Checkbox` (Radix behind each). Found and fixed a real bug along the way: tailwind-merge's default config doesn't know FleetSettle's custom §5.2 font-size scale, so `text-body` was silently misclassified into the text-color group and dropped next to a real colour class — `web/src/lib/cn.ts` now extends `theme.text`/`theme.spacing`, with a regression test. Also added the missing `Testing Library` auto-cleanup (`vitest.config.ts` never set `test.globals`) and wired `eslint-plugin-react-hooks`/`-react-refresh`, both installed but never configured
- `AppShell`, `Screen`, `Sheet` (vaul, with the M-23 visible close), `ActionSheet`, `Dialog`, `Card`, `Section` — done. `Sheet` registers a mobile history entry via a new `useMobileHistoryDismiss` hook (gated on `pointer: coarse`, §3.3's "single most-missed Android behaviour"). `AppShell`'s tab bar is a true flex sibling below `Screen`'s content rather than a fixed overlay, and `Screen`'s sticky CTA is the last child inside its own scroll region with `scroll-padding-bottom` reserved — a deliberate simplification of §4.2's frame that trades a little under-bar scroll parallax for a layout that cannot silently overlap. `AppShell` accepts `shell: "operate" | "review" | "mine"` and renders the three fixed tab sets from §3.1 (Mine gets none); routing itself isn't wired in yet (no TanStack Router dependency added), so `activeTab`/`onTabChange` are plain controlled props for now, to be lifted into real route state when P2's screens land
- **The load-bearing five** — `DayCard`, `AmountPad`, `MoneyField`, `AllocationPreview`, `TwoBalances`. All take props and render against fixtures; **none needs an endpoint**, which is why they finish here rather than scattered across the phases that later use them — done, plus a new `components/Money.tsx` (§6.4's `Money` display primitive, needed by all five) and `@fleetsettle/shared` added as a `web` dependency for the first time. `AmountPad` builds minor units from the right (`value*10n+digit`) with no decimal-point state machine; its "." key renders (12-key grid parity) but is inert. `MoneyField`'s degraded variant formats on blur only, confirmed by test. `TwoBalances` never renders a signed net (W-2) — a sentence plus an unsigned `Money`. `AllocationPreview` takes a pre-ordered `lines` array and does no allocation math of its own; a positive remainder renders as "held as credit"
- `NotAvailable`, `Provisional`, `SyncChip`, `OfflineBanner`, `FieldError`
- `EntityPicker`, `DateField`, `PhotoCapture`, `BorneByPaidBy`, `Timeline`
- Setup flow; vehicle list and overview; people list

**Depends on** — P1.

**Done means** — a business with a bus, two cars, a driver and an open July period is created end to end, from the browser, at 360 × 640. Every component in UI §6 exists in a fixture-driven story, passes the 44px pass, and renders in both themes. `Rs 0` and `NotAvailable` are visibly different things.

---

# P3 · The daily loop

**The first vertical slice, and the flow the product is optimised for.** F-4.2, F-4.3, F-4.6.

**Shared** — `day_record`, `obligation`, `payment`, `allocation` schemas.

**Backend**
- `domain/confirmDay.ts` — four inserts in **one transaction**
- Idempotency on `(daily_lease_id, business_date)`; a second confirm is a no-op
- Day-card creation on demand when the card does not exist
- `PERIOD_CLOSED` mapped from the trigger violation — **no application pre-check**
- `earned` and `received` stored separately, never collapsed

**Frontend** — assembly, not construction. Everything it needs was built in P2.
- The home screen as an ordered stack, not a dashboard
- `DayCard` wired to the write path: optimistic, with the `SyncChip` until confirmed
- The "Something else" sheet — **both** figures, earned and received
- The "Didn't run" reason list, which **never includes `On charter`** (FL §4.1)

**Depends on** — P2.

**Done means** — one tap confirms the day; a second tap changes nothing. A write into a closed period returns `PERIOD_CLOSED` from the trigger, not from a pre-check.

---

# P4 · Costs, adjustments and driver money

F-3.x, F-6.x. The phase that unlocks four others.

**Shared** — `expense`, `adjustment`, `advance`, `advance_settlement`, `deposit_movement`, `offset_record` schemas.

**Backend**
- Expense with **`borne_by` and `paid_by` as two fields** (W-48)
- **Adjustments and waivers** — and a waiver never shares a bucket with a write-off (W-28)
- Driver advances and settlement; deposits as money held, **never income**
- `offset_record` — the only thing that moves both driver balances
- The two-balances query, which never nets
- R2 uploads through **presigned, expiring URLs**, never a public bucket — condition photos are evidence in disputes and often show number plates

**Frontend**
- The driver screen, assembling `TwoBalances`
- The fuel-fill ten-second flow (F-3.3); condition photo capture (W-30)
- The `＋` quick-add set (M-4)

**Depends on** — P3.

**Done means** — the manager buying the driver's fuel from his own pocket records as borne by the driver, paid by the manager. The two balances never net automatically; the net is displayed, muted and non-actionable, and only an explicit Offset moves both.

---

# P5 · Rent, billing periods and mileage

F-2.x. **Gates G-3.**

**Shared** — `lease`, `billing_period`, `mileage_assessment` schemas.

**Backend**
- Billing-period generation, idempotent on `(lease_id, seq)`
- Rent as a **fixed amount per period**; mileage allowance as **per day × days in the period** — the one place consistency would be a bug (W-25)
- Excess assessment, one-directional: under the allowance produces no refund, credit or carry-forward
- A billing period is **not** an accounting period; they coincide only by accident (W-40)

**Frontend** — F-2.1, the longest form in the product, and it still saves with level-1 fields only. Lease screens, mileage and excess display.

**Depends on** — P4.

**Done means** — **G-3 reproduces exactly**: `days_count` 31 / 28 / 31 / 30, allowances 3,100 / 2,800 / 3,100 / 3,000, excesses 3,500 · nothing · combined **7,500** split 152 / 148 and marked estimated.

---

# P6 · Trips and charters

F-5.x, F-1.5.

**Backend** — trip lifecycle and trip P&L; **INV-17** (closing a trip with an unreconciled advance returns 409); the vehicle calendar query (UC-95). **INV-1** (vehicle double-booking returns 409) already done in P2 — booking a trip writes its full-range `vehicle_day_allocation` at booking (DM §4.1), so the invariant existed as soon as the booking endpoint did. What's still missing here: pausing existing `day_record` rows to `paused_for_trip` when a trip is booked inside the horizon (F-5.1) — P2 had no `day_record` table yet (P3's), so a trip booked against a vehicle with daily cards already generated does not yet pause them.

**Frontend** — the trip screen serving two arrangements; the vehicle calendar.

**Depends on** — P4.

**Done means** — a vehicle on charter is paused rather than counted lost. The lost-day denominator stays `ran + lost` — it excludes days the pattern never scheduled and days paused for a charter.

---

# P7 · Partners, banking and cash

F-7.x.

**Shared** — `banking_event`, `partner_payout`, `capital_contribution` schemas.

**Backend** — banking with a pooled discrepancy attached to the **banking event**, not a guessed receipt (UC-65); partner capital and current accounts (UC-67); costs with no vehicle (UC-66).

**Frontend** — cash screens (F-7.4, F-7.5); partner screen (F-7.6).

**Depends on** — P4.

---

# P8 · Incidents, insurance and recoveries

F-3.4. **Gates G-2.**

**Shared** — `incident`, `incident_recovery`, `insurance_claim` schemas.

**Frontend components** — none new. Everything this phase renders was built in P2.

**Backend** — an incident with its costs and recoveries linked, so the net cost of one accident stays answerable years later (UC-12). Both new tables verified present in the `assert_period_open()` array before anything writes.

**Frontend** — the incident container. Side-by-side condition comparison is product-phase Second and waits for P11.

**Depends on** — P4.

**Done means** — **G-2 reproduces: 15,000.**

---

# P9 · Period close, corrections and the audit trail

F-9.1, UC-96, UC-97, UC-98. **Gates G-1.**

**Backend**
- Close and open an accounting period
- Late facts — `belongs_to_period_id` distinct from `posted_period_id` (W-35)
- **Void-and-replace corrections**, always referencing the original (W-50); `payment_correction`
- The `audit_log` writer proven over every money table
- **Once a business's first period can close, gate `PUT /api/opening-balance`** (P2, `domain/opening-balance.ts`) on it — F-0.2's Alternates clause allows a correction only "until the first period is closed, then it becomes an ordinary adjustment." P2 left this unenforced because no business could reach that state yet; it can once this phase lands

**Frontend** — the close-the-month screen; correction flows; `Timeline`.

**Depends on** — P3 at minimum; realistically P5–P8, for a month worth closing.

**Done means** — **G-1 reproduces: 134,000.** The seed walks the real lifecycle — open July, write July, close July, open August — because there is no way to write into a closed period, so UC-98 is exercised as a side effect.

---

# P10 · Write-offs and post-closure charges

UC-90, UC-91. Both are **product-phase Second** (UC §9.1) and both depend on close existing.

**Shared** — `write_off`, `write_off_recovery` schemas.

**Backend** — write-off, and recovery **against that write-off** rather than as fresh income. Without the link the two appear as a loss and an unrelated windfall in different months, and both figures mislead. Post-closure charges against a settled period.

**Frontend** — write-off and post-closure flows.

**Depends on** — P9.

---

# P11 · Reports, the Review shell and export

**Backend** — the DM §15 report queries **as written, not re-derived**. Ageing buckets per obligation against the business date passed as a parameter, never `CURRENT_DATE`. Export (UC-99).

**Frontend** — the Review shell and the passive owner's 60 seconds; report catalogue; Recharts lazily, Reports chunk only; `NotAvailable` and `Provisional` everywhere they belong.

**Order within the phase follows UC §9.1**: the phase-one reports first; receivables ageing (UC-78) and utilisation / per-km (UC-79) are Second and come after.

**Depends on** — P5 through P10. It needs data to be right about.

**Done means** — every report renders `NotAvailable`, never `0`, against the empty and partial fixtures. The three light-mode chart slots below 3:1 carry direct labels. The §7.1–7.3 figures render on screen.

---

# P12 · Offline, the PWA and the Mine shell

**Frontend**
- TanStack Query persistence and paused mutations — the M-12 queue
- Replay fetches a **fresh token per attempt**; a 401 pauses and re-authenticates rather than discarding
- Eviction warning while the queue is non-empty; the iOS "Add to Home Screen" hint, dismissible forever
- The Mine shell — the driver's own view (UC-07); side-by-side condition comparison

**Backend** — the linked-driver boundary tested across **reports and exports**, not only direct routes.

**Depends on** — P11.

**Done means** — four days confirmed on a Sunday with no signal replay on Monday. Nothing is discarded silently: those days exist nowhere else.

---

# P13 · Scheduled work

Cron Triggers: due generation, day-card generation, paperwork expiry warnings (UC-92).

**Also carries two things P2 deliberately left undone** (DM §4.1): `generate-day-cards` is what materialises `vehicle_day_allocation` on a rolling 90-day horizon for a **lease** (through `end_date`, or the horizon if open-ended) and for a **daily lease** (alongside each `day_record` it creates) — P2's lease/daily-lease endpoints write only the arrangement's own row(s), so INV-1 is not enforced for either until this job exists.

**Every job is a no-op on a second run** — idempotency lives in the constraints, and a unique violation on a cron path is success, not a page. **No job is a prerequisite for a user action**; a job that failed overnight must be invisible.

**Depends on** — the flows each job mirrors, which is why it sits here rather than earlier.

---

# P14 · Messaging

**Sequenced last by owner decision, 31 July 2026** (UC §9.1).

WhatsApp Business Cloud API behind Cloudflare Queues, the KV kill switch, the message log and failure strips, and the message ↔ record link so every message is readable from the due, driver or trip it concerned.

**Prerequisite with external lead time:** twelve Meta template approvals — six messages × English and Sinhala — at minutes to about two days each. Off the critical path, but done before this phase starts.

---

## Not in this tracker

UC §9.1 phase Third, and UI §15 phase Third. Listed so their absence is a decision rather than an oversight: depreciation and disposal · driver retainers and spare-vehicle reassignment · loan and lease schedules · tax, if it applies · offline capture of photos · the desktop analytical dashboard beyond UI §14's three changes.

## Blocked right now

| Blocked | Waiting on |
|---|---|
| P1 frontend — Asgardeo wiring | Console: token type → JWT, binding → None, redirect URL cleanup |
| P14 | Twelve Meta template approvals |

**Everything in P0 is unblocked.**

## What the validation pass changed

Three corrections, all from checking the plan against the documents rather than against itself.

1. **`adjustment` had no home.** It is in the DM §13 money-table list and in UC §9.1 phase one, and the first draft placed it nowhere. Now in P4, with the waiver-versus-write-off separation stated where it bites.
2. **Write-offs and post-closure charges were scheduled a phase too early.** The draft put them with incidents and with close; UC §9.1 puts both in phase **Second**. They are now P10, after close, which is also where their dependency actually points.
3. **The load-bearing five were scattered** across the phases that first use them. That reads sensibly and contradicts UI §15, which says tokens and the five come before *any* screen. They are all in P2 now, and P3 became assembly rather than construction.

**One open question for the owner, not resolved here.** UC §9.1's phase lists name incidents nowhere — not in First, Second or Third — yet **G-2, "one accident", is a golden fixture that must reproduce**. This tracker assumes incidents are phase one, since a fixture that cannot be satisfied by any scheduled phase is a gap rather than a plan. If that is wrong, UC §9.1 is the document to change, deliberately, with the reason recorded.
