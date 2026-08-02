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
- `NotAvailable`, `Provisional`, `SyncChip`, `OfflineBanner`, `FieldError` — done. `Provisional`'s stripe is a 4px `::before` pseudo-element (verified compiling to a real `repeating-linear-gradient` via a build check, not just a class-name assertion), never a full-element overlay (§5.3's GPU-jank caveat). `FieldError` reserves its 20px (`h-5`) slot unconditionally; the paired 1px→2px border swap lives on `Input` itself (`aria-[invalid=true]:border-2`, from the primitives batch) rather than being reimplemented here — a caller wires `aria-invalid`/`aria-describedby` onto its own control. The mobile-specific scroll-target math (§6.3: field height + 20px message + `scroll-padding-bottom`) is **not** implemented as custom JS — native focus-scroll plus `Screen`'s own `scroll-padding-bottom` covers the common case, and pixel-perfect verification needs real layout, not jsdom; flagged here rather than building unverifiable logic. `Field` (the label+control+error wrapper) is deferred to the next bullet, where `EntityPicker`/`DateField` actually need it
- `EntityPicker`, `DateField`, `PhotoCapture`, `BorneByPaidBy`, `Timeline` — done, plus the rest of §6.3's Input inventory that these need as companions: `Field` (label+control+`FieldError` wrapper — deferred from the previous bullet), `Disclosure`, `ReasonPicker`, `NoteField`. `DateField` takes `today` as a prop, never reading the device clock itself (CLAUDE.md → Time); its native `<input type="date">` is `sr-only` but still reachable via `showPicker()`, so the OS calendar overlay works without depending on the hidden input's own box size. `EntityPicker`'s trigger button carries the field's label in `aria-label` (a `<label htmlFor>` doesn't associate with a `<button>` per the HTML spec — this isn't a form control), since its visible text becomes just the chosen entity's name once a value is set; `BorneByPaidBy` composes two independent `EntityPicker`s, never one collapsed field (W-48). `PhotoCapture` is split into a real `lib/photo-pipeline.ts` (downscale via `createImageBitmap`/`OffscreenCanvas`, JPEG retry ladder at 0.75/0.6/0.45 against the 200KB cap — the retry logic is unit-tested with an injected encoder; the actual canvas calls aren't, since jsdom implements neither API) and the capture UI, which only reports an encoded photo upward — the actual presigned-R2 upload is left to the caller, since no upload endpoint exists yet. **Not built**: the Worker + 3s-timeout wrapper around the pipeline (§6.3's "where" row) — it still runs on the main thread; noted rather than half-built
- Setup flow; vehicle list and overview; people list — done. `CreateBusinessForm`, `CreateVehicleForm`, `VehicleListScreen`, `VehicleOverviewScreen`, `CreateDriverForm`, `CreateCustomerForm`, `PeopleListScreen`, plus the API layer they all sit on: `lib/api.ts`'s `createApiClient(baseUrl, getToken)` never imports the Asgardeo SDK (§12.1's token getter stays injected, so the P1 auth-provider reversal is still cheap on this side too), and `ApiProvider`/`useApi()` is the one door every screen reaches the Worker through. `VehicleOverviewScreen` deliberately renders only what P2 has data for — registration, type, arrangement — not the calendar/costs/leases/trips/paperwork tabs later phases own. No `TanStack Router` yet, a deliberate scoping call: P1's auth is blocked on Asgardeo console changes and there's no real navigation to wire, so screens take plain callback props (`onSelectVehicle`, `onCreated`, …) for now, to be lifted into route params once P1 unblocks.

  Found and fixed three recurring bug classes here, each fixed at the structural level rather than per-form, since every P3+ form inherits the same shape:
  1. **The wire/domain mismatch for any zod schema with `.transform()`** (money's `moneyWireSchema`, dates' `businessDateSchema`) — its `z.infer` (output) type differs from its `z.input` (wire) type, but `MoneyField`/`DateField` produce/consume the *domain* type (`Minor` bigint, `BusinessDate` string) directly. Fixed with a form-local schema built from `z.custom<Minor>`/`z.custom<BusinessDate>` (no transform), keeping the form's internal state in domain types throughout and converting to wire (`toWire()`; a no-op for dates, since `BusinessDate` *is* the wire string) only inside `mutationFn`, immediately before `api.post()`. `CreateDriverForm` needed the reverse too — `CreateDriverWireRequest = z.input<typeof createDriverRequestSchema>` for its `satisfies` check, since the request schema's *output* type is the wrong one to check a wire body against.
  2. **`""` vs `undefined` on optional text inputs** — a native `<input>` always yields `""` when untouched, but `z.string().min(1).optional()` only skips validation for `undefined`. Fixed once with `lib/optionalTextField.ts`'s `blankToUndefined = { setValueAs: (v) => (v === "" ? undefined : v) }`, spread into `register(name, blankToUndefined)`.
  3. **A cross-field validation error hidden inside a collapsed `Disclosure`** — W-55 (a person needs an NIC or a mobile) attaches its error to a field at level 2, invisible on a failed submit if that section is still collapsed. Fixed by adding `Disclosure`'s `forceOpen?: boolean` prop, driven by `errors.fieldName !== undefined`.

**Depends on** — P1.

**Done means** — a business with a bus, two cars, a driver and an open July period is created end to end, from the browser, at 360 × 640. Every component in UI §6 exists in a fixture-driven story, passes the 44px pass, and renders in both themes. `Rs 0` and `NotAvailable` are visibly different things.

**Verification pass** — done. `npm run check` clean across `api`/`web`/`packages/shared` (179 tests). The 44px targets are asserted per-component in Vitest (`toHaveClass("min-h-tap"/"size-tap")`, per IG §16.1's table — real layout isn't available under jsdom, so this is the leftmost mechanism that can see it). For the both-themes/360px-no-scroll pass, temporarily mounted the new screens behind `AppShell` in place of the placeholder `App` and drove Chromium via Playwright at 360×640 (`colorScheme: "light"|"dark"`) — `PeopleListScreen`, `VehicleListScreen`, `CreateVehicleForm`, the `Add` `ActionSheet`, and a nested `CreateDriverForm` `Sheet`, all correct in both themes, no horizontal scroll. One near-bug surfaced and was chased down: dark mode looked broken (page background stayed light) when a screen was mounted without its real `AppShell` wrapper — `AppShell` is what sets `bg-page` on the root, so that was the harness omitting it, not a token or component defect (confirmed via `getComputedStyle`, which showed the color tokens were already correct). The harness itself was scratch-only and was not committed; `App.tsx` stays the placeholder until P1 unblocks real assembly. The existing Playwright smoke spec (`e2e/smoke.spec.ts`, 360 and 320px reflow) still passes unchanged.

---

# P3 · The daily loop

**The first vertical slice, and the flow the product is optimised for.** F-4.2, F-4.3, F-4.6.

**Shared** — `day_record`, `obligation`, `payment`, `allocation` schemas.

**Backend**
- `domain/confirmDay.ts` — four inserts in **one transaction** — done. One endpoint, `POST /api/day-record/confirm`, serves all three of F-4.2's buttons and F-4.4 via a `action: "paid_in_full" | "something_else" | "did_not_run"` discriminated union — `paid_in_full`'s earned/received are resolved server-side from `findDailyLeaseRateForDate` (the rate in force *on that date*, not just today's, since a catch-up day's rate can differ — F-4.3's effective-dating), never sent by the client. `obligation.settled_minor`/`status` are computed once, correctly, from the given earned/received at insert time — never a follow-up `UPDATE`, which is what keeps this "four inserts" rather than "four inserts plus one". A `did_not_run` day writes only `day_record` (INV-6: no obligation for a day nothing was owed on)
- Idempotency on `(daily_lease_id, business_date)`; a second confirm is a no-op — done. `domain/confirmDay.ts` checks for an existing row *inside* the transaction (any state at all counts as settled — there's no `generate-day-cards` yet to ever leave one at the pre-generated-card `open` state, so that branch is dead code today and documented as such rather than half-built against a state that can't occur) and returns it unchanged; a concurrent double-tap is additionally caught as a unique-violation-is-success at the `day_record_daily_lease_id_business_date_key` constraint (CLAUDE.md's cron idempotency rule, extended to this user-triggered action, the same way `opening-balance`'s commit endpoint already does)
- Day-card creation on demand when the card does not exist — done, by construction: confirming inserts `day_record` directly in its final confirmed state (never an intermediate `open` row), so there is nothing separate to "generate" first
- `PERIOD_CLOSED` mapped from the trigger violation — **no application pre-check** — done. New `isPeriodClosedViolation()` (`db/pg-error.ts`) disambiguates `assert_period_open()`'s `RAISE EXCEPTION` from the schema's other bare-SQLSTATE triggers (`assert_shares_total`/`assert_advances_settled`/`assert_split_sums`, all still `P0001`) by message text, the same role a constraint name plays for `isUniqueViolation`/`isExclusionViolation`. New `queries/accounting-period.ts`'s `resolvePeriodLinkage()` is the first real use of W-35's `posted_period_id`/`belongs_to_period_id` split outside opening balances — `posted_period_id` is always the currently-open period, `belongs_to_period_id` is set only when the business date falls in a *different*, earlier period (there is only ever one period per business until P9 can close one, so this is correct now and already shaped for when that stops being true)
- `earned` and `received` stored separately, never collapsed — done (INV-2). `day_record.earned_minor` is a real column; `receivedMinor` on the wire is assembled from the day's `obligation.settled_minor` (DM §1.3) — a new `GET /api/day-record/{dailyLeaseId}/{businessDate}` (F-4.1, added alongside since the frontend needs it to know a day is already confirmed on load) does this same join to answer "what happened today," returning 404 for "not yet confirmed" rather than a fabricated zero row (day_record rows are never deleted, so 404 here only ever means "no such row yet")

**Not built this phase, and recorded rather than silently skipped**: F-4.3's "make this the new daily amount from …" (inserting a new effective-dated `daily_lease_rate`, closing out the old one) and F-4.6's bulk week-confirm (`payment` covering several days, oldest-first allocation, a shared preview-before-write). Both are real, separate features roughly the size of F-4.2 itself; the "Done means" bar below is F-4.2/F-4.4's, which is what this phase actually ships end to end.

**Frontend** — assembly, not construction. Everything it needs was built in P2.
- `ConfirmDayCard` (`features/daily/`) assembles `DayCard` + a new `SomethingElseSheet` + the existing `ReasonPicker`, wired to `POST /api/day-record/confirm` and the new `GET`, via TanStack Query — done. Takes `dailyLeaseId` plus caller-resolved labels as props, the same no-router-yet composition as P2's screens (P1 still blocks real navigation)
- `DayCard` wired to the write path: optimistic, with the `SyncChip` until confirmed — done. Every action already carries the values the backend would derive the same state from (the tapped button, or what was typed into `SomethingElseSheet`/chosen in `ReasonPicker`), so the settled summary renders immediately, mirroring `domain/confirmDay.ts`'s own state derivation client-side for the pending window only — overwritten by the real response via `queryClient.setQueryData` the moment it lands. Verified in a real browser, both themes, 360×640 (same scratch-harness-behind-`AppShell` technique as P2's verification pass): the unconfirmed card, the optimistic-then-settled transition with `SyncChip`, and both sheets, all correct
- The "Something else" sheet — **both** figures, earned and received — done (`SomethingElseSheet.tsx`). Two `MoneyField`s, Save disabled until both are set, and `receivedMinor > earnedMinor` is rejected client-side with an explanation (that's F-4.5's credit, a different flow) — mirroring the same check `confirmDayRequestSchema`'s `.refine()` makes server-side
- The "Didn't run" reason list, which **never includes `On charter`** (FL §4.1) — done, via the existing `ReasonPicker` and the 6-value `lostReasonSchema` enum (`on_charter` isn't just excluded from the picker's list — the DB `CHECK` doesn't accept it as a value at all)

**Depends on** — P2.

**Done means** — one tap confirms the day; a second tap changes nothing. A write into a closed period returns `PERIOD_CLOSED` from the trigger, not from a pre-check. All done: 13 new integration tests (`test:integration`, run separately from `npm run check` per the existing convention — needs the live Neon test DB) cover the one-tap path, the earned/received split, the zero-received case (no payment row, matching `payment.amount_minor`'s `CHECK > 0`), `did_not_run`, the idempotent no-op, 401/403/404/409, plus the new `GET`'s own matrix; `npm run check` clean across all three workspaces (187 unit/component tests + the 79-test integration suite, all passing).

---

# P4 · Costs, adjustments and driver money

F-3.x, F-6.x. The phase that unlocks four others.

**Shared** — `expense`, `adjustment`, `advance`, `advance_settlement`, `deposit_movement`, `offset_record` schemas.

**Backend**
- Expense with **`borne_by` and `paid_by` as two fields** (W-48) — done. `POST /api/expense`; `vehicleId` absent is a valid overhead cost (UC-66, INV-24), never an error. UC §6.7's default-owner matrix is resolved server-side against the vehicle's *current* arrangement (the same simplification P3 already made for daily-lease rates) — `domain/expense.ts`'s `resolveBorneByDefault` looks up the vehicle's active lease (arrangement A → customer) or active daily lease (arrangement B → driver), falling back to `us` when nobody currently holds the vehicle ("customer's while he has it, ours between rentals," generalised past cleaning to every category the matrix defaults away from `us`). Verified against all three arrangements, including the tolls A→customer/B→driver/C→us flip the matrix exists to prove. `paid_by_user_id` defaults to the caller and is recorded, but does **not** yet create a partner current-account entry for "the business now owes this person" (F-3.1's "no extra step") — that ledger is P7's `capital_contribution`/partner-payout table, not built yet; recorded here rather than faked
- **Adjustments and waivers** — and a waiver never shares a bucket with a write-off (W-28) — done. `POST /api/adjustment` against an existing `obligation`. A waiver (or system `auto_waiver`) raises `waived_minor` only — `amount_minor` stays "the 340 charged" (DM §10.3's own example, so the month can show both the charge and the waiver); every other type (goodwill/rounding/agreed_discount/late_fee/extra_charge) is a real change to what is owed and adjusts `amount_minor` itself by `sign × amount`. A new `computeObligationStatus()` (`domain/obligation-status.ts`) is now the one place `pending`/`part_paid`/`paid`/`waived` is derived — P3's `confirmDay.ts` was refactored to call it too, rather than let a second copy of the same rule drift. A **manual** waiver above the business's own `autoWaiveThresholdMinor` escalates from `dailyOperations` to the owners-only `writeOffOrWaiveAboveThreshold` (OQ-3: the threshold defaults to 0, so any positive manual waiver needs an owner until one is set) — `auto_waiver` itself is system-generated (a future below-threshold mileage waiver, P5) and isn't expected to arrive through this manual endpoint
- Driver advances and settlement; deposits as money held, **never income** — done. `POST /api/advance` + `.../settle` (UC-53: "the advance closes at zero" — each settlement is its own row, summed against the original amount to derive `open`/`part_settled`/`settled`, no stored running total to drift); `POST /api/deposit` + `.../movement` (F-6.7/W-8/INV-4 — the held balance is the SUM of its movements, DM §10.4's own design, never a column this write has to keep in sync; `refunded`/`retained` are terminal, everything else leaves it `held`)
- `offset_record` — the only thing that moves both driver balances — done (F-6.4/UC-56/INV-3). `POST /api/offset` allocates the **same** amount against both directions' oldest-`due_on`-first outstanding obligations in one transaction (mirroring §6.5's allocation discipline), rejecting an amount that exceeds either side's outstanding total. Verified end-to-end against §6.4's own walkthrough numbers: 8,000 owed / 12,000 owed, an 8,000 offset, landing at 0 / 4,000
- The two-balances query, which never nets — done. `GET /api/driver/{id}/balances`; two independent `SUM`s grouped by `direction`, no subtraction anywhere in the query or the response schema — a caller may compute and *display* a net, but there is no field it could mistake for a stored one (W-2)
- R2 uploads through presigned, expiring URLs — **not built this pass**, recorded rather than half-built. Condition-photo capture (W-30) and expense receipt photos both need it; `attachment` (DM §12) is already a generic, polymorphic table so one presigning endpoint would serve both, but presigning against a real R2 bucket needs its own verification this session didn't reach

**Found and fixed along the way**: the audit trigger (`write_audit_log()`, migration 0002) attaches to "every table carrying `posted_period_id`" by design, and unconditionally reads `NEW.business_id` — but seven such tables were missing that column entirely (`advance_settlement`, `deposit_movement`, plus five no phase has written to yet: `incident_recovery`, `insurance_claim`, `mileage_assessment`, `payment_correction`, `write_off_recovery`). Invisible until the first INSERT, which `advance_settlement` and `deposit_movement` just became (`42703: record "new" has no field "business_id"`). Fixed with migration `0004_business_id_on_audited_child_tables.sql` — all seven were verified empty first, so a `NOT NULL` column needed no backfill; applied to both the dev and integration-test databases, and the DM §13 drift assertion (`api/scripts/check-drift.mjs`) is clean against both afterward. The other five tables are P5/P8/P9/P10's problem to have *not* hit, now that the column exists ahead of them.

**Frontend** — **not built this pass**, recorded rather than half-built alongside the R2 gap above (the driver screen and fuel-fill flow both want photo capture wired to a real upload before they're worth building against): the driver screen assembling `TwoBalances`, the fuel-fill ten-second flow (F-3.3), condition photo capture (W-30), the `＋` quick-add set (M-4).

**Depends on** — P3.

**Verification** — 30 new integration tests (`expense.test.ts`, `adjustment.test.ts`, `driver-money.test.ts`, run via `test:integration` against the live Neon test DB) plus 13 new shared-schema unit tests; `npm run check` clean across all three workspaces (200 unit/component tests, 109 integration tests, all passing).

**Done means** — the manager buying the driver's fuel from his own pocket records as borne by the driver, paid by the manager. The two balances never net automatically; the net is displayed, muted and non-actionable, and only an explicit Offset moves both.

---

# P5 · Rent, billing periods and mileage

F-2.x. **Gates G-3.**

**Shared** — `lease-billing` schemas (`billingPeriodResponseSchema`, `recordOdometerReadingRequestSchema`, `mileageAssessmentResponseSchema` + its splits, `renewLeaseRequestSchema`, `recordPaymentRequestSchema`); `startLeaseRequestSchema` (arrangement.ts) gained the handover-odometer fields. A new `splitInteger` (packages/shared/src/split.ts) is the largest-remainder primitive on plain integers — `money.ts`'s `split` now wraps it rather than duplicating the algorithm, so kilometre splitting (below) and money splitting share one tested implementation. `dates.ts` gained `addCalendarMonths` — day-of-month-preserving, clamped to the target month's length — which is the one line making §7.3's 31/28/31/30 reproducible arithmetic instead of drift accumulated period-over-period.

**Backend**
- Billing-period generation, idempotent on `(lease_id, seq)` — done. `domain/billing-period.ts`'s `generateNextBillingPeriodTx` computes period *N*'s boundaries from the lease's own anchor date (`addCalendarMonths(startDate, N-1)` through the day before `addCalendarMonths(startDate, N)`), never chained off the previous period's end, and raises that period's rent `obligation` in the same transaction — "a billing period on its own owes nobody anything" (F-2.1). The public `generateNextBillingPeriod` wraps it in its own transaction and catches a `billing_period_lease_id_seq_key` collision as the idempotent-replay path (concurrent double-submission, not sequential re-calls — calling it twice in sequence legitimately advances the schedule by two periods, since this function has no notion of "today"; deciding *when* to call it is P13's cron's job once it exists). `POST /api/lease/{id}/billing-period` (generate) + `GET .../billing-period` (list) stand in for that cron until it exists
- `POST /api/lease` now writes the lease, its handover `odometer_reading` (INV-19, required by schema whenever a mileage limit is set) and the **first** billing period in one transaction (`domain/lease.ts`'s `startLease`, composing `generateNextBillingPeriodTx` inside the same transaction rather than opening a second one) — the first rent due is no longer left for a cron that doesn't exist yet (CLAUDE.md → Writes: "no cron is a prerequisite for a user action"). This is a real behaviour change from P2: starting a lease now requires an open accounting period, the same as every other money write
- Rent as a **fixed amount per period**; mileage allowance as **per day × days in the period** — the one place consistency would be a bug (W-25) — done, `allowance_km = daily_limit_km × days_count`, `days_count` read back from the generated column, never computed twice
- Excess assessment, one-directional: under the allowance produces no refund, credit or carry-forward — done. `domain/mileage.ts`'s `assessMileage`: which billing period(s) a reading closes out is derived from the date range since the *previous* reading (`findBillingPeriodsInRange`), never chosen by the caller. One period → a plain assessment; more than one (a missing boundary reading, §7.3's March case) → combined against their summed allowance, excess split by days via `splitInteger` (largest-remainder, INV-26), marked `isEstimated`. An excess at or below `businessSettings.autoWaiveThresholdMinor` auto-waives on the spot — obligation `waived_minor` set, plus an `auto_waiver` adjustment row (F-2.4) — reusing P4's `computeObligationStatus` and `adjustmentType` machinery rather than a second implementation. Idempotent on `(lease_id, read_on)` — migration `0005_odometer_reading_lease_date_unique.sql` adds the partial unique index (partial because `odometer_reading` also serves trip/oversight readings with no `lease_id`, W-12); the up-front existence check matters as much as the catch, since by the time of a genuine replay the just-recorded reading is itself the *latest* one for the lease, and computing "driven since the previous reading" from it would silently produce a nonsensical zero-period assessment instead of replaying the original result — the same lesson P3's `confirmDay` idempotency already encodes, applied here a second time. `POST /api/mileage-assessment`
- A billing period is **not** an accounting period; they coincide only by accident (W-40) — done, no code path derives one from the other
- F-2.5 renew — done. `PATCH /api/lease/{id}/renew`: old periods keep their old figure (already frozen onto `billing_period` at generation time); this only changes what the *next* generated period picks up — a plain field update, no effective-dated history table needed
- F-2.2 collect payment, generalised — done, ahead of schedule because `AllocationPreview` (P2) had no backend behind it yet. `POST /api/payment`: oldest-`due_on`-first allocation (§6.5) against a party's outstanding `owed_to_us` obligations, reusing the exact allocation shape P4's offset already proved (`findOutstandingObligationsForParty` generalises `findOutstandingObligationsForDriver` by party type). A surplus beyond every outstanding due comes back as `unallocatedMinor` rather than silently dropped — F-2.2's "overpayment held as customer credit" — though actually applying it forward against a future due isn't wired yet (recorded rather than faked, same convention as P4's partner current-account gap)

**Found and fixed along the way**: the existing P2 lease-creation test assumed no accounting period was needed to start a lease — true before this phase, false after (money now moves at creation). Updated rather than left red.

**Frontend** — **not built this pass**, joining P4/web's gap (deferred alongside the driver screen/fuel-fill flow/quick-add set — R2 uploads still block condition-photo capture either way): F-2.1's own form, lease screens, mileage/excess display.

**Depends on** — P4.

**Verification** — 22 new integration tests (`mileage-assessment.test.ts`'s G-3 reproduction plus auto-waive/idempotency/error cases, `payment.test.ts`, plus additions to `lease.test.ts` for renew/billing-period/the new 409) run via `test:integration` against the live Neon test DB, and `lease.test.ts`'s pre-existing happy path updated for the new open-period requirement; 18 new shared unit tests (`split.test.ts`, `lease-billing.test.ts`, `arrangement.test.ts`, `addCalendarMonths` cases in `dates.test.ts`). `npm run check` clean across all three workspaces; `npm run check:drift` clean against both the dev and test databases after migration `0005`.

**Done means** — **G-3 reproduces exactly**: `days_count` 31 / 28 / 31 / 30, allowances 3,100 / 2,800 / 3,100 / 3,000, excesses 3,500 · nothing · combined **7,500** split 152 / 148 and marked estimated. Reproduced end-to-end through the real endpoints (lease creation → four `POST .../billing-period` calls → three `POST /api/mileage-assessment` calls), not derived in isolation — `mileage-assessment.test.ts`'s first test *is* §7.3.

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
