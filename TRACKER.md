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
- `tests/support/*` — all five, including the `TEST_DATABASE_URL ≠ DATABASE_URL` guard
- Response schemas that actually `.parse()` outside production (IG §11)

**Frontend**
- `npm init -w web`; Vite + React 19 + TypeScript
- Tailwind v4, `tokens.css` per UI §12.3 — palette constants, `@theme`, both dark selectors, `:lang(si)`
- Vitest + Testing Library; Playwright with a 360 × 640 project
- `vite-plugin-pwa`; manifest from BR §5.2, icons from `docs/design/brand/png/`
- **Security headers on the assets Worker** — CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`. IG §10 calls this the highest value-to-effort item on its list

**Ops** — CI creates, seeds and **deletes** a per-PR Neon branch. Not optional on the free plan: branch creation starts failing around nine open PRs, and it fails on someone else's PR for a reason that looks unrelated (IG §9.2). Error monitoring wired at the same time, because structured logs nobody alerts on are forensics rather than monitoring.

**Depends on** — nothing.

**Done means** — `npm run check` runs both workspaces instead of skipping. `0001` and `0002` are applied to a Neon branch and the DM §13 drift assertion returns zero rows. The codec's tests cover the U+2212 minus, the M-16 cents rule, and a split that sums back to the whole.

---

# P1 · Identity, tenancy and the access boundary

The one phase where a mistake is a security bug rather than a wrong number.

**Backend**
- `jose` — `createRemoteJWKSet` + `jwtVerify`, JWKS cached in KV, refetch on `kid` miss
- `sub → app_user → business_member`, then `c.set("businessId", …)`
- `auth/policy.ts` — one function per row of the W-49 matrix
- The status rule wired once: cross-tenant **404**, lacked capability **403**
- The linked-driver test class, as a harness later phases extend
- Rate limiting via the Workers binding — never a token row per request (IG §13)

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
- CRUD for business, vehicle, driver, customer
- The three arrangements and their terms, **with the original start date preserved** so billing periods land on the right day of the month
- Opening balances (UC-08, UC-09)
- Paperwork expiry *dates* on the vehicle (UC-92) — the warning job is P13
- **Open the first accounting period.** The period trigger makes this a prerequisite for every later write

**Frontend** — UI §15's build order binds here: **tokens and the five load-bearing components come before any screen**, because every screen after them is assembly.
- shadcn primitives copied in and resized to 44px
- `AppShell`, `Screen`, `Sheet` (vaul, with the M-23 visible close), `ActionSheet`, `Dialog`, `Card`, `Section`
- **The load-bearing five** — `DayCard`, `AmountPad`, `MoneyField`, `AllocationPreview`, `TwoBalances`. All take props and render against fixtures; **none needs an endpoint**, which is why they finish here rather than scattered across the phases that later use them
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

**Backend** — trip lifecycle and trip P&L; **INV-17** (closing a trip with an unreconciled advance returns 409); **INV-1** (vehicle double-booking returns 409); the vehicle calendar query (UC-95).

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
