# Platform admin, self-registration and multi-business membership — design

**Written 17 August 2026. Status: design settled, independently re-verified twice, 17 August 2026 (§14 by re-reading; §15 against the code graph), nothing built, no specification document updated.**

This is a working design note, not a specification. `docs/` still decides; where this and `docs/` disagree, `docs/` wins — and §11 is precisely the list of what must be written *into* `docs/` before any of this is built. Nothing here has been absorbed into `TRACKER.md` or `Plan.md` yet, by explicit instruction: this document stands alone until the design is built or abandoned.

**Companion document, same date: `PLATFORM-ADMIN-AND-MULTI-BUSINESS-IMPLEMENTATION-PLAN-2026-08-17.md`** — the file-by-file blast radius, the corrected build sequence (§1 below summarizes the one correction that matters), and the data-isolation checklist. Read this document for *what and why*; read that one for *how, in what order, and what breaks if the order is wrong*.

Three things are being added at once, and they are separable at the feature level:

| Track | What | Depends on |
|---|---|---|
| **A** | Asgardeo claims fix — `email` / `display_name` actually populated | nothing |
| **B** | Platform admin panel, self-registration, business-creation approval | A (for names); **and, structurally, on C's schema half — see the correction below** |
| **C** | Multi-business membership and the business switcher | A (for names) |

**Correction, second validation pass, 17 August 2026 — B and C are not independent at the schema layer.** Track B's threshold logic (decision 4: businesses 1–5 auto-approve) cannot create a second business at all until `one_active_business_per_user` (Track C's own `DROP INDEX`, §6.2) is gone — that index is the *only* thing standing between today's `createBusiness`/`redeemInvite` and a second business, and it blocks with a 409 before Track B's threshold-counting code would ever run. See `PLATFORM-ADMIN-AND-MULTI-BUSINESS-IMPLEMENTATION-PLAN-2026-08-17.md` §1 for the full reasoning and the corrected build order (a "Phase 1" that pulls the index-drop and the `resolveMemberships` rewrite forward, ahead of Track B's threshold logic, and must ship as one atomic unit with it — dropping the index without the join rewrite reactivates §7.3's cross-product bug live). The admin-panel UI and the business-switcher UI remain genuinely independent of each other; only this one schema piece is a hard, previously-unstated prerequisite.

**Track A is confirmed blocked, live, as of this writing.** Verified against the QA branch 17 August 2026: `app_user.email` and `display_name` are NULL on the one real account. Half the fix is in this repo (the missing `email` scope); the other half is an Asgardeo console setting nobody who worked on this pass had access to check. See §9 and §12 Q5.

**Superseded by decision 28, 18 August 2026 — Track A no longer gates B or C.** The `email` scope ships immediately; every name-rendering path falls back `display_name ?? email ?? "Unnamed user"`, permanently, because `display_name` is nullable by schema regardless of how the console is configured. Names are a display nicety, not a correctness dependency — the "depends on A (for names)" entries in the table above are soft, and the hard dependency in that table is the schema one, below.

---

## 1. Where this sits

**What exists today.** Asgardeo OIDC with PKCE; `app_user` created just-in-time on first authenticated write, keyed on `asgardeo_sub`; one active business per user, enforced by a database index; a business switcher that does not exist because the product has never had two businesses to switch between. Tenancy is per-row `WHERE business_id = $1`, resolved server-side from the verified JWT, with cross-tenant reads returning 404 and a test class holding that line (`api/tests/integration/auth.test.ts:97`, `:115`).

**What is being added.** A platform tier above businesses — an admin who approves who may create a business — and, below it, the ability for one identity to belong to several businesses and move between them.

**What is emphatically not changing.** No money table is touched by any part of this. The golden fixtures — **134,000**, **15,000**, **7,500** (FL §9.1) — must not move. If they do, something in the implementation is wrong, and that is the cheapest tripwire available here.

---

## 2. The decisions, and who made them

Settled in conversation 17 August 2026. Recorded so the same ground is not re-argued from a stale draft.

| # | Question | Decision |
|---|---|---|
| 1 | Approve *accounts*, or approve *business creation*? | **Business creation.** Invite redemption is always auto-approved. |
| 2 | Pending business row, or held request? | **Held request.** No business row exists until approved. |
| 3 | May a platform admin read business money data? | **No. Never.** Enforced structurally — see §4. |
| 4 | Threshold before approval is required | **5.** Businesses 1–5 auto-approve; 6+ queue. |
| 5 | Where does the admin role live? | **A `platform_admin` table.** Not an Asgardeo group claim. |
| 6 | Can one person drive for two businesses on one login? | **Yes, one login.** `driver.linked_user_id` becomes per-business. |
| 7 | Is data ever shared between businesses? | **No.** No cross-business reports, ever. |
| 8 | Business selection mechanism | **`X-Business-Id` header, validated server-side** against the membership set derived from the token. |
| 9 | No header, more than one membership | **Hard error**, `BUSINESS_NOT_SELECTED`, HTTP 400. |
| 10 | Can a platform admin also be a business member? | **Yes.** |
| 11 | Self-approval of one's own request | **Allowed, and always logged and displayed as such.** |
| 12 | Rejected requests | **Re-requestable**, with the reason recorded and shown to the requester. |
| 13 | How does a requester learn the outcome? | **Refresh or re-login.** No notification, no email. |
| 14 | Admin panel form factor | **Mobile-first, like everything else** (M-1). A desktop portal is a later question. |
| 15 | Interim hand-run SQL instead of a panel? | **No.** Build the panel. |
| 16 | Update `docs/` now? | **No.** This document, standing alone, until built. |

### Settled 18 August 2026 — the twelve open questions, answered

Decisions 17-28 close open questions 1, 3, 5-7, 10-13, 15-17 from §12. Each is marked **closed** at its numbered entry there, with the reasoning that was weighed; this table is the decision itself.

| # | Question | Decision | Closes |
|---|---|---|---|
| 17 | How does a requester see their own request's status? | **A `pendingRequest` field on `GET /api/session`** — `{ status, rejectionReason } | null`, from the caller's own `business_creation_request` row. Not a separate endpoint: it rides a call `FirstRunGate` already makes on every load, adds no round trip and no second key to clear on switch. | Q15, Q16, Q4 |
| 18 | Phase 1 and Phase 2 — one deploy or two? | **Two stacked PRs, one merge window.** Phase 2 targets Phase 1's branch; merge Phase 2 into Phase 1, then Phase 1 into `develop`. Two readable diffs, one QA migration, and `develop` never sits in the unlimited-creation state. | Q11 |
| 19 | What replaces the orphaned `one_active_business_per_user` catch? | **Re-point both catches at `business_member_active_pair`**, which survives and still means something real — "already a member of *this* business." Keeps the clean 409 on the surviving race (double-submitted invite redemption) and stays inside `pg-error.ts`'s "the constraint is the truth" convention. | Q6 |
| 20 | The threshold's check-then-act race | **Accepted, deliberately.** Worst case is one business past the limit; no money is wrong and no isolation breaks, in a product with two users. Recorded as a declined `SERIALIZABLE` fix in the domain function's own header comment, per *record what you did not take*. **Note the interaction with decision 22:** moving the threshold to a column does not close this race either — only a trigger would, and that was not chosen. | Q7 |
| 21 | `BusinessAlreadyExistsError` | **Narrowed and renamed to `AlreadyAMemberError`**, code `BUSINESS_ALREADY_MEMBER`, still 409. Follows from decision 19 — the re-pointed catch needs a class to throw, and the old name would then be describing a constraint that no longer exists. | Q12 |
| 22 | Is the threshold a constant or per-user? | **A per-user column, now** — `app_user.business_allowance int NOT NULL DEFAULT 5`. **This was taken against the recommendation in this pass**, which argued for a constant on the grounds that nobody is near 5 and the column is additive later. Taking it now adds an admin-panel screen to set it, its own `platform_audit_log` entries, and a test class — all of which belong in Phase 2's scope explicitly rather than being discovered mid-build. | Q3 |
| 23 | How does the business id reach `api.ts`'s two fetch call sites? | **A second parallel getter**, `getBusinessIdGetter: () => string | null`, mirroring `TokenGetter`'s shape and read fresh on every call. Threaded through `createApiClient` into **both** `request()` and `requestBlob()`. `auth-asgardeo.ts` and `auth-stub.ts` stay untouched — business selection is a membership fact, not an identity one, and must not become the auth modules' business. | Q13, Q8 |
| 24 | `platform_admin` audit trail | **A purpose-built trigger**, `platform_admin_audit`, `AFTER INSERT OR UPDATE`. Matches `business_member_audit`'s precedent and migration `0002`'s stated reason for triggers here — "cannot be forgotten in a new code path." `self_action` is computed in the trigger from the same session variable `withActor()` already sets for `write_audit_log()`. | Q14 |
| 25 | The `localStorage` key, and who clears it | **`fleetsettle.selectedBusinessId`**, exported from a new `web/src/lib/storage.ts`, **cleared in `AuthActionsContext`'s sign-out** — the one path both the real and the stub `signOut` route through, so neither can forget it. Not in `AuthGate`: that fires on every unauthenticated render, including a transient token refresh, and would wipe the selection under the user. Establishes the dot-namespace convention for any future key. | Q10 |
| 26 | A user revoked from their only business | **Distinguished, without detail.** `/api/session` returns `hadMembership: true` alongside `businesses: []`, and the client renders "You no longer have access to any business. Contact the business owner." It never names the business or the actor — the same existence-disclosure discipline as 404-not-403. | Q17 |
| 27 | An eighth citation prefix for the platform tier? | **No — extend the seven.** Platform concerns land in the documents that already own their shape (UC/FL/DM/IG/UI). An eighth prefix is a permanent tax on every future citation and a branch in `docs/README.md`'s read order that never merges back. | Q1 |
| 28 | Track A's Asgardeo console block | **Ship the `email` scope now; do not block B or C on it.** Real names are a display nicety, not a correctness dependency. Everywhere a name renders falls back `displayName ?? email ?? "Unnamed user"`. The console setting gets confirmed and the one existing row backfilled when someone with admin access is available. | Q5 |
| 29 | Does `docs/` change before or after the build? | **Before — §11's list ships as its own `doc-change` PR, merged ahead of Phase 1.** This **supersedes decision 16**, whose deferral was scoped to "until built" and therefore expires the moment building starts. The owning document decides (CLAUDE.md), so the specification must be true before code cites it; `data-model.md:130` in particular becomes false the day Phase 1 merges and cannot be left standing. Front-loading it also runs FL §8 / DM §16's traceability check while design changes are still cheap. | §11, decision 16 |

**Not decisions, but tasks these answers imply** — recorded so they are not mistaken for still-open questions: the `getBlob` header fix (Q8, folded into decision 23), the `check-forbidden.mjs` header rule needing a structurally new pattern (Q18), the `addBusinessMembership` test helper (Q9), the `PartnerDetailScreen.tsx` regression test (Q19), the migration renumbering (Q2, answered by the implementation plan's §1), and the open-question numbering reconciliation (Q20, done).

---

## 3. What was declined, and why

Repo convention (CLAUDE.md → *Record what you did not take*).

- **Account-level approval.** Rejected because it blocks *invited* members, and the inviting owner has already vouched for them — routing a new manager past a platform admin adds a stranger to a decision the business already made. It also buys nothing: a signed-up user with no membership is already inert, because `authMiddleware` 404s them on every route except `POST /api/business` and `/api/invite/*`. Gating those two is equivalent, minus the friction.

- **A `status` column on `business`.** Rejected because every one of the 30+ existing routes would then have to check it, forever, or someone posts money into an unapproved business. That is a new invariant threaded through the whole money path, and CLAUDE.md's own history — "the list is hand-maintained and has drifted once already" — says such lists drift. Holding the *request* instead touches zero existing routes.

- **A platform-admin claim in the Asgardeo token.** Rejected because it makes authorisation an identity-provider fact, which TS §2 and W-49 rule out by name: "Asgardeo answers who is this person; `business_member` answers what may they do here."

- **Relaxing `audit_log.business_id` to nullable.** Rejected. That column being `NOT NULL` (`api/migrations/0001_initial_schema.sql:876`, corrected from `:875`) is part of what makes a tenant-scoped audit query trustworthy. Platform actions get their own table instead.

- **A separate Worker or origin for the admin panel.** Rejected for now: a second deployment pipeline is real operational cost, and the isolation that matters is achieved structurally within one Worker (§4). Revisit if the panel ever grows features that read more than it does today.

- **Two logins for a driver working in two businesses.** Rejected: it means two email addresses for one person, Asgardeo rejecting the reuse, and manual account administration forever. Isolation lives at `business_id` scope, not at identity — one login is equally safe (§7.3).

- **Blocking self-approval.** Rejected as pointless at this size, where the platform admin and the business owner are the same two people. Made visible instead.

---

## 4. The hard boundary

**A platform admin must never be able to read business money data.** This is the single most important constraint in this document.

Cross-tenant isolation is currently airtight and tested, and it is a stated security requirement, not a preference (W-49, CLAUDE.md → *Tenancy and access*). The moment a role exists that can see across businesses, the guarantee becomes "isolated, except for one role" — and for a ledger whose whole promise is being believed about money, that is a different product with a different promise.

**The admin tier's entire data scope:**

| May read | May never read |
|---|---|
| `app_user` — email, display name, created | any money table |
| `business` — name, created, member count | `day_record`, `payment`, `expense`, `obligation`, … |
| `business_member` — counts and roles, for the member column | any report, export, or aggregate over them |
| `business_creation_request` | `audit_log` (it is tenant-scoped, and not the platform's) |
| `platform_admin`, `platform_audit_log` | |

**Enforced structurally, not by convention:**

1. Admin routes mount on `/api/admin/*` behind `platformAdminMiddleware`, **never** `authMiddleware`. They have no `businessId` and must not have one — there is no business in scope, and any code that acquires one has escaped the tier.
2. Admin queries live in `api/src/queries/platform/`, and a new `check-forbidden.mjs` rule bars that directory from importing money-table schema. This is the same mechanism the repo already uses for `tenancy/from-request` (`scripts/check-forbidden.mjs:101`), and it is the only kind of rule that survives a year of edits.
3. The rule takes an inline `-- allow: <reason>` exemption like every other, so an exception is possible but visible in the diff.

---

## 5. The platform admin record

**A table, `platform_admin`, is the record of truth.** The one-time SQL statement is a bootstrap for the *first* row only, not a maintenance mechanism.

**Bootstrap ordering, which matters.** Production currently holds zero rows (CLAUDE.md), so there is no `app_user` row to point at. Sequence:

1. Enable self-registration in Asgardeo and deploy Track B.
2. Sign in once through the normal flow. This creates nothing yet — `app_user` is written just-in-time on the first authenticated *write*, so also submit a business-creation request, or add a trivial `app_user` upsert to the session endpoint (see §7.1, which does exactly this).
3. Confirm the row exists: `SELECT id, email FROM app_user WHERE asgardeo_sub = '…';`
4. Insert the first `platform_admin` row against that id.
5. **Verify it took.** A `SELECT`-based seed that silently matches nothing is the worst outcome here — the panel would render as "not an admin" with no explanation.

Record the exact steps in `DEPLOYMENT.md` when this ships.

**Thereafter the table is maintained through the panel.** An existing admin grants or revokes another; every change lands in `platform_audit_log`; and `assert_platform_has_admin()` stops the last active admin being removed.

**Why that trigger exists.** Migration `0010` added `assert_business_has_owner` for one reason: the moment member administration exists, the first thing it enables is an owner revoking themselves and locking the business out permanently, with no endpoint able to undo it (INV-31). The platform tier has the identical failure one level up, and worse — there is no higher authority to restore it, only hand-run SQL against production. Same shape, same reasoning: a deferred constraint trigger on `UPDATE`, counting active admins.

---

## 6. Schema

Migrations are hand-written, numbered, forward-only. Current head is `0028`. **Tracks B and C will both reach for `0029` if developed on parallel branches — fix the numbers before either starts.**

### 6.1 Track B — `0029_platform_tier.sql` (proposed number)

```
platform_admin
  user_id      uuid PK REFERENCES app_user(id)   -- one row per admin, re-grantable
  granted_by   uuid REFERENCES app_user(id)      -- null for the bootstrap row
  granted_at   timestamptz NOT NULL DEFAULT now()
  revoked_at   timestamptz

  UNIQUE INDEX platform_admin_active ON (user_id) WHERE revoked_at IS NULL
  CONSTRAINT TRIGGER platform_has_admin  -- AFTER UPDATE, DEFERRABLE INITIALLY DEFERRED
```

```
business_creation_request
  id               uuid PK
  requested_by     uuid NOT NULL REFERENCES app_user(id)
  name             text NOT NULL
  currency_code    char(3) NOT NULL
  timezone         text NOT NULL
  status           text NOT NULL CHECK (status IN ('pending','approved','rejected'))
  decided_by       uuid REFERENCES app_user(id)
  decided_at       timestamptz
  rejection_reason text
  business_id      uuid REFERENCES business(id)   -- set on approval, null otherwise
  created_at       timestamptz NOT NULL DEFAULT now()

  UNIQUE INDEX business_creation_request_one_pending ON (requested_by) WHERE status = 'pending'
```

The partial unique index is what stops a rejected requester queueing fifty retries — re-requesting is allowed, but only one request may be outstanding at a time. It is the same idiom the repo already uses for `one_active_business_per_user` and `business_member_active_pair`.

Decision 22 adds one column to an existing table in this same migration:

```sql
ALTER TABLE app_user ADD COLUMN business_allowance int NOT NULL DEFAULT 5;
```

Not a money column, not period-scoped; `app_user` is outside the `assert_period_open()` array for the same reason the three new tables are. The DEFAULT reproduces decision 4's constant exactly, so no backfill is needed and no existing behaviour changes.

```
platform_audit_log
  id          bigserial PK   -- allow: append-only log, never in a URL
  action      text NOT NULL CHECK (action IN
                ('request_approved','request_rejected','admin_granted','admin_revoked',
                 'allowance_changed'))   -- decision 22
  subject_id  uuid NOT NULL  -- the request or the admin's user_id
  actor_id    uuid NOT NULL REFERENCES app_user(id)
  self_action boolean NOT NULL DEFAULT false   -- decision 11: actor == requester
  detail_json jsonb
  created_at  timestamptz NOT NULL DEFAULT now()

  RULE platform_audit_log_no_update AS ON UPDATE DO INSTEAD NOTHING
  RULE platform_audit_log_no_delete AS ON DELETE DO INSTEAD NOTHING
```

Mirrors `audit_log`'s append-only rules (`0001:886`). It is a **separate table** because `audit_log.business_id` is `NOT NULL` and platform actions have no business — see §3.

**None of these three are money tables.** They carry no `posted_period_id`, so they are correctly skipped by both `assert_period_open()`'s trigger array and `write_audit_log()`'s discovery loop. Say so in the migration header; the `write-migration` skill checks for exactly this, and a reviewer who does not find the reasoning will assume an omission.

### 6.2 Track C — `0030_multi_business_membership.sql` (proposed number)

```sql
DROP INDEX one_active_business_per_user;
```

No `-- allow:` needed — the destructive-migration guard matches `DROP TABLE|COLUMN|CONSTRAINT|TYPE`, not `DROP INDEX`. `business_member_active_pair` stays: it still correctly stops the same person joining the same business twice.

```sql
ALTER TABLE driver DROP CONSTRAINT <generated_name>;  -- allow: <reason>
CREATE UNIQUE INDEX driver_linked_user_per_business ON driver (business_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL;
```

`driver.linked_user_id` is declared inline as `uuid UNIQUE` (`0001:182`), so its constraint name is generated. **Confirm the real name against the live branch before writing this** — `SELECT conname FROM pg_constraint WHERE conrelid = 'driver'::regclass;` — exactly as `0010` did for `business_member_business_id_user_id_key` rather than assuming it.

---

## 7. Server changes

### 7.1 `GET /api/session` — new, and it fixes an existing wart

Mounted behind `verifyTokenMiddleware` (the pre-business tier, alongside `POST /api/business` and `/api/invite/*`), because it must answer before any business is selected.

```
{ userId, isPlatformAdmin, businesses: [{ businessId, name, role, driverId? }] }
```

**Why this is needed at all.** Decision 10 lets a platform admin also be a business member — but also lets one hold *no* membership. `/api/me` sits behind `authMiddleware`, which requires a resolved business, so such an admin would 404 there and never learn they are an admin. This endpoint is the only place that can say so.

**What it also fixes.** `FirstRunGate` currently infers first-run state by sniffing a 404 from `/api/me`, and its own comment concedes this conflates a brand-new identity with a *revoked* one, because `resolveMembership` returns `null` for both. `/api/session` states the situation explicitly instead of inferring it from an absence.

This endpoint should upsert `app_user` on first call, which also solves the bootstrap problem in §5 step 2.

`/api/me` is unchanged in purpose and gains `businessName`.

### 7.2 `authMiddleware` — the five-step rule

The header is a **filter over memberships the server derived from the token**, never a grant.

1. Verify the JWT → `sub`.
2. `resolveMemberships(reader, sub)` → the businesses this identity belongs to, **from the database, never from the token**.
3. Header present → find it in that set. Not in the set → **404, never 403** (a 403 confirms the business exists — CLAUDE.md → *Tenancy*).
4. Header absent, set size 1 → use it. Absent, set size > 1 → `BUSINESS_NOT_SELECTED`, 400.
5. Set `businessId` **from the matched membership row**, never from the header string.

Step 5 reads as pedantry — the two values are equal — but it is what leaves no assignment from request data for a later refactor to reach for. It is the difference between a validated selector and a trusted claim.

### 7.3 `resolveMemberships` — a rewrite, not a `.limit(1)` deletion

`api/src/queries/identity.ts` currently left-joins `business_member` and `driver` off `app_user`, then joins `business` on `or(business.id = businessMember.businessId, business.id = driver.businessId)`.

That `or` already produces a cross-product in which you cannot tell which business belongs to which membership. It works today **only** because `.limit(1)` hides it and the two constraints being dropped guaranteed at most one row of each kind. Remove them and it returns ambiguous rows.

Rewrite as a `UNION ALL` of the two membership shapes, each joined to its own business. Still one round trip — this is the hottest query in the system and each `reader` call is its own HTTP request — but it needs its own test, including the case of a user who is a member of business A and a linked driver in business B.

**Driver isolation is unaffected.** `driverId` follows the *selected* membership, so the existing linked-driver test class holds unchanged: he reads his own row in the selected business and 404s on everything else — including his own driver row in the other business, while this one is selected.

### 7.4 `POST /api/business` — same path, new response

Keeps its path and its client form. Returns a discriminated union:

- **Under threshold** → runs the existing `createBusiness` transaction *unchanged*, writes an `approved` request row alongside it, returns the business as it does today.
- **At or over threshold** → writes a `pending` request row and returns that.

The threshold counts **businesses where the user currently holds an active `owner`/`owner_manager` membership** — not businesses ever created by them. Otherwise leaving a business permanently consumes a slot.

**Superseded by decision 22, 18 August 2026 — the threshold is a per-user column, not a named constant.** `app_user.business_allowance int NOT NULL DEFAULT 5`, added in Phase 2's migration and read per request. The default reproduces decision 4's behaviour exactly, so nothing changes for a user nobody has adjusted. What the column adds to Phase 2's scope, and what must not be forgotten:

- **An admin-panel screen to set it** — otherwise the column is unreachable and the DEFAULT is the only value it will ever hold, which is the constant with extra steps.
- **`platform_audit_log` entries for changes to it.** Raising someone's allowance is a platform-tier grant, the same shape as `admin_granted`, and it needs its own `action` value in the CHECK constraint (`allowance_changed`) plus the before/after in `detail_json`.
- **Its own test class** — allowance 0 (can create nothing), allowance raised mid-session, allowance lowered below the count the user already holds (existing businesses are never taken away; only the next creation queues).
- **It does not close the race in decision 20.** A column is still read-then-decide; only a trigger would make it a constraint, and that was weighed and not taken. The race stays accepted.

### 7.5 Admin endpoints

`/api/admin/*`, behind `platformAdminMiddleware`: list and decide creation requests; list businesses (name, created, member count — **no money**); list users; grant and revoke admin; read the platform log.

### 7.6 Retiring `BUSINESS_ALREADY_EXISTS`

A bounded, enumerable change — a second business is now legal up to the threshold, and exceeding it is a *pending status*, not an error. Nine references in `api/src`, the enum entry at `packages/shared/src/errors.ts:20`, and two integration tests.

**Those two tests currently assert the constraint being removed** — `api/tests/integration/business.test.ts:149` and `api/tests/integration/invite.test.ts:149`. They are not deleted. They **invert**, and become the regression test that a second business and a second invite now succeed.

### 7.7 Guard extension

`tenancy/from-request` (`scripts/check-forbidden.mjs:101`) matches `body|payload|input|query|params . business_id`. A header read does not match, so the rule would develop a hole exactly where it starts mattering. Extend the pattern to catch `c.req.header(…)` business-id reads, exempted in the one middleware file with an `-- allow:` reason.

---

## 8. Client changes

### 8.1 Business switching

- Selection persisted in `localStorage`; sent as `X-Business-Id` from the single `request()` in `web/src/lib/api.ts:56` — one place, the same injection shape the token getter already uses.
- **On switch: `queryClient.clear()` and a hard remount.** Not `invalidateQueries`. No react-query key in this client contains a business id — every key is business-implicit (`["vehicles"]`, `["expenses"]`, `["reports","cash-position"]`). Without a clear, business A's money renders under business B's name. **This is the highest-severity failure mode in this entire plan**: a confident, plausible, wrong number.
- `main.tsx`'s `QueryCache.onError` currently branches only on 403 → invalidate `["me"]`. It gains a branch for `BUSINESS_NOT_SELECTED` → clear the stored selection and show the picker. Someone hitting that error sees the switcher, never an error screen.
- Business name in the app bar. `Screen` takes a `title` for the screen; the business name is shell-level chrome, a different element.
- The switcher is a `Sheet`, not a `Dialog` — §6.1 reserves `Dialog` for irreversible actions, and switching is neither destructive nor one-way. `MoreScreen`'s sign-out confirm is the pattern to copy.
- `FirstRunGate` rebuilt on `/api/session`: picker when several memberships, admin entry point when `isPlatformAdmin`, and a fallback to the picker when the stored selection is no longer valid (revoked from that business).

### 8.2 The admin panel

**Mobile-first, like everything else** (decision 14). Every phase-1 rule applies unchanged: 360 × 640 with no horizontal scroll (M-1), 44 × 44 minimum targets, no raw hex — `--color-*` tokens only, colour never carrying meaning alone. It reuses `Screen`, `Card`, `Sheet` and the existing primitives rather than introducing a parallel design system.

Rejecting a request is re-requestable, therefore reversible, therefore a `Sheet` — not a `Dialog`. Revoking an admin is likewise re-grantable.

Screens: request queue (approve / reject with reason), businesses list, users list, admin management, platform log. A self-approved request must render **visibly distinct** from an arms-length one (decision 11) — the `self_action` flag exists for exactly this, and it is the kind of thing that cannot be added credibly after the fact.

**A tension to record.** M-3 says three shells, never a fourth, and never a role switcher (`Plan.md:584-595` — corrected from an earlier `636-647` citation, which as of this tree's current line numbers falls in an unrelated A3/GAP-39 passage; the actual "declined: a role switcher" reasoning is at `Plan.md:593`). The admin panel is not a fourth *role* shell: it is a platform surface orthogonal to business membership, reached from within whichever shell the user already has, or standing alone when they have none. The distinction is real — the role still follows the business and is never chosen — but it is thin enough that UI §1.1 needs one explicit sentence when `docs/` is eventually updated, or the next reader will read this as M-3 being quietly reversed.

Likewise, a *business* switcher is not the *role* switcher that `Plan.md:636-647` rejected. The argument there was that a client-supplied role is a privilege claim and makes `audit_log.changed_by` ambiguous. Neither applies: the role is not chosen, it follows whichever membership the selected business carries, and `audit_log.business_id` comes from the row being written. **That argument must be made explicitly in the docs, not assumed.**

### 8.3 Sign-up

`AuthGate` keeps its single "Sign in to FleetSettle" button. Once self-registration is enabled, Asgardeo's own hosted login page carries the "Create an account" link — zero client change. A distinct FleetSettle-side sign-up button would need an extra authorization-request parameter, which should be verified against current Asgardeo documentation rather than assumed.

---

## 9. Track A — the claims fix

Small, independent, and it must go first, because both other tracks list businesses and people **by name**.

- `web/src/lib/auth-asgardeo.ts` requests `["openid", "profile"]` — **no `email` scope**.
- `middleware/auth.ts` reads `payload.email` and `payload.name` off the **access** token, and writes them into `app_user` on creation.

**Confirmed against the live QA branch, 17 August 2026** (`br-square-sound-afb68wft`): the one real `app_user` row — the account behind `testCred.md`, `nimesha.isholi94@gmail.com`, created 6 Aug 2026, one business ("TESTA", `owner_manager`) — has `email` and `display_name` both NULL. The write path is provably not the fault: `setup.ts`/`membership.ts` write these fields straight through whenever `payload.email`/`payload.name` are present, so a NULL row means the token itself carried nothing. Production (`br-odd-cherry-afx5394i`) holds zero rows in either table, matching CLAUDE.md.

Two causes, only one fixable from this repo:

1. **The missing `email` scope**, above — fixable in `auth-asgardeo.ts`. **Decision 28 ships this now**, independently of cause 2 below.
2. **Whether Asgardeo puts `name`/`email` on the access token at all**, independent of scope — a setting on the Asgardeo application's user-attribute/claims mapping, in the Asgardeo console, not visible or fixable from this repository. `testCred.md`'s credentials are an application login, not Asgardeo admin console access, so this could not be checked as part of this pass.

Add the `email` scope, then have someone with Asgardeo admin console access confirm and enable "include in access token" for `email`/`name` on the registered application, then backfill the one existing row by hand. IG §7 already flags the ID-token-versus-access-token trap by name; the name for a header comes from the ID token, the `Authorization` credential from the access token.

**Decision 28, 18 August 2026 — this no longer blocks B or C.** The scope fix ships now; the console setting is confirmed whenever access is available. Until then, and permanently as a safety net, **everywhere a person's name renders falls back `display_name ?? email ?? "Unnamed user"`** — one helper, used by the switcher, the members list, the admin panel's users and requests screens, and anywhere else a name appears. Two consequences worth stating rather than discovering:

- **Deploying the scope fix to QA and signing in once is itself the test** for whether cause 2 is real. If `app_user.email` populates, Track A is simply done and no console change is needed. If it stays NULL, that is the proof to hand whoever owns the console.
- **The fallback is not temporary scaffolding to remove later.** `display_name` is nullable by schema and a user may genuinely never have set one; a name-rendering path with no fallback is a crash or a blank waiting for the first such account, console setting or not.

---

## 10. Tests

**Track C — extend the `auth.test.ts` class.** It is the file that already holds this line and it should keep holding it.

- A user in two businesses gets 404 for a third.
- A valid token plus a header for business A cannot read business B.
- A header naming a business the user was revoked from → 404.
- No header, two memberships → `BUSINESS_NOT_SELECTED`.
- A linked driver in two businesses reads only the selected one's driver row.
- `business.test.ts:149` and `invite.test.ts:149` inverted (§7.6).
- Client: switching business clears the query cache.

**Track B.**

- A non-admin gets 404 on every `/api/admin/*` route.
- An admin with no business membership resolves through `/api/session` and reaches the panel.
- Request 6 queues; approval runs `createBusiness` and produces a working business; rejection creates nothing.
- A rejected requester may re-request; a pending requester may not queue a second.
- The last active admin cannot be revoked.
- Self-approval succeeds and is flagged `self_action`.

**Both tracks.** The 39 golden fixtures must pass unchanged. No number moves.

---

## 11. What must be written into `docs/` before this is built

**Decision 29, 18 August 2026 — this list is now the first PR, not a deferred one.** It ships as one `doc-change` pass merged into `develop` *ahead of* Phase 1, superseding decision 16 (whose deferral was scoped to "until built" and expires when building starts). Sequence: this PR, then Phase 1, then Phase 2 stacked on Phase 1 per decision 18.

Two things to carry into that PR beyond the table below: every decision in §2 rows 17-29 is a specification fact now and belongs in whichever document owns it (decision 27 says that is one of the existing seven), and the traceability tables (FL §8, DM §16) must close in both directions before it merges — that check is the cheapest place a remaining design gap will surface.

| Document | Change |
|---|---|
| `use-cases.md` | The platform tier; multi-business membership; a second business |
| `user-flows.md` | F-0.1 amended for a second business; F-1.4 amended for accepting an invite while already a member; new flows for switching, requesting, approving, rejecting |
| `data-model.md` §3 | Delete "This product has no multi-business membership… or a switcher" (`docs/engineering/data-model.md:130`) and replace it with what supersedes it. **This paragraph is currently a lie in waiting.** |
| `ui-ux-guidelines.md` §1.1 | The M-3 fourth-shell sentence (§8.2); where the business name lives; the switcher's shape |
| `implementation-guidelines.md` §7 | The five-step header rule; the platform tier's structural boundary |
| `tech-stack.md` §2 | Self-registration enabled; the claims configuration from Track A |
| `docs/README.md` | Its "Nothing is open across the suite" claim, and whether the platform tier gets an eighth citation prefix or extends the seven — **open, see §12** |
| `DEPLOYMENT.md` | The bootstrap sequence from §5 |

Traceability closes in both directions (`docs/README.md:55`): every use case gets a flow, every flow a use case, every invariant an enforcement. FL §8 and DM §16 are those tables and they are checked, not assumed.

---

## 12. Open questions

1. **[CLOSED 18 Aug 2026 — decision 27: extend the seven, no eighth prefix.]** **Does the platform tier get an eighth citation prefix, or extend the seven?** `docs/README.md:37-43` fixes seven documents and seven prefixes (`UC §`, `FL §`, `DM §`, `TS §`, `IG §`, `UI §`, `BR §`), and those prefixes are load-bearing in code comments throughout the repo. An eighth is a permanent tax on every future citation; folding platform concerns into documents that are otherwise strictly business-scoped muddies them. Leaning toward extending the seven. **Not blocking** — it only bites when §11 is executed.

2. **Migration numbers for Tracks B and C.** `0029` and `0030` are proposed above. If the two tracks are built on parallel branches they will collide. Decide before either starts.

3. **[CLOSED 18 Aug 2026 — decision 22: a per-user `app_user.business_allowance` column, taken against this pass's recommendation.]** **Is the threshold of 5 per-user, forever?** As specified it is a fixed constant counting active owner memberships. If it ever needs to be per-user (a trusted operator allowed twenty), that is a column on `app_user` and a different design — cheap now, awkward later.

4. **[CLOSED 18 Aug 2026 — decision 17: yes — decision 17's field is what makes it renderable.]** **Does the requester see their pending request?** Decision 13 says no notification, refresh to see. That implies the "Get started" screen must render a pending request as a state — "your request is being reviewed" — rather than offering the create form again, which would hit the one-pending-per-user index and produce a confusing error. Assumed, not confirmed.

5. **[CLOSED 18 Aug 2026 — decision 28: ship the `email` scope, do not block B/C, fall back to email for display.]** **Is the Asgardeo application registration configured to place `email`/`name` claims on the access token?** **This one blocks Track A, and therefore B and C.** Confirmed live 17 August 2026 (§9) that the deployed QA app does not — the one real account's `app_user.email`/`display_name` are NULL, and the write path is proven innocent (a NULL row means the token carried nothing). The fix, if one is needed, is an Asgardeo-console change to the application's user-attribute/claims mapping — outside this repository, and outside what `testCred.md`'s application-level credentials can check or change. Needs someone with Asgardeo admin console access: check the current mapping, add `email`/`name` to the access token's claims if absent, then re-verify against QA and backfill the one existing row.

**Added, second validation pass, 17 August 2026 — questions 6-14 below** (corrected — the original text of this line said "6-11" while nine items, 6 through 14, were actually appended; the implementation plan's own §6 independently renumbers a subset of these 6-12 with different content behind the same numbers — see open question 20 below, added third pass, which reconciles it). **Full reasoning for each in `PLATFORM-ADMIN-AND-MULTI-BUSINESS-IMPLEMENTATION-PLAN-2026-08-17.md`, cited per item.**

6. **[CLOSED 18 Aug 2026 — decision 19: re-point both catches at `business_member_active_pair`.]** **What replaces the removed `isUniqueViolation(err, "one_active_business_per_user")` catch in `createBusiness` (`api/src/domain/setup.ts:96-98`) and `redeemInvite` (`api/src/domain/membership.ts:255-257`)?** Both are the only two places a `business_member` row is ever created, and both rely on this exact index — dropping it (§6.2) without deciding what these two catch blocks become leaves dead code matching nothing, silently, until a double-submit race surfaces an uncaught 500 where a clean 409 used to be. Not blocking design review, but blocking Phase 1 implementation (implementation plan §1) — this cannot be deferred past that point.

7. **[CLOSED 18 Aug 2026 — decision 20: race accepted, recorded as a declined `SERIALIZABLE` fix.]** **Does the 5-business threshold (decision 4) need a `SERIALIZABLE`-transaction fix for its check-then-act race, or is the race accepted?** Two concurrent `POST /api/business` requests from a user at their 4th active ownership can both read count = 4 and both auto-approve, exceeding the threshold with no queued request. This is a real departure from `api/src/db/pg-error.ts`'s own stated convention ("the constraint is the truth, do not pre-check in application code") — every other invariant in this codebase is enforced by a DB constraint or trigger the application catches a violation from; this one, as designed, is an application-level count-then-decide. Given this product's actual concurrency (one or two people), accepting the race explicitly may be the right call, but it should be a recorded decision per this repository's own "record what you did not take" convention, not an unexamined gap.

8. **[CLOSED 18 Aug 2026 — decision 23: folded into decision 23; both call sites carry the header.]** **`web/src/lib/api.ts`'s `X-Business-Id` injection needs to land in two places, not one.** `request()` (line 56) is one fetch call site; `requestBlob()` (`getBlob`, line 90) builds its own header object independently and was missed by this document's original "one place" claim in §8.1. Not open in the sense of undecided — both need the header — flagged here so it isn't silently narrowed back to one call site during implementation.

9. **`api/tests/support/auth.ts` has no helper for a second membership on an existing user.** `mintUser` (line 49-66) always creates a brand-new `app_user`. Track C's own first listed test (§10: "a user in two businesses gets 404 for a third") cannot be written until a sibling helper exists that adds a `business_member` row to an *existing* user id. Needs building as part of Phase 1's test support, not discovered mid-way through writing Track C's tests.

10. **[CLOSED 18 Aug 2026 — decision 25: `fleetsettle.selectedBusinessId`, cleared in `AuthActionsContext`.]** **`localStorage` key name and who clears it on sign-out.** §8.1 is the first use of browser storage anywhere in `web/src` (confirmed by grep — zero existing call sites) — there is no convention to inherit for the key name, and neither `AuthGate` nor the stub `signOut` currently touches storage, since there was never anything to clear. Needs a name and an explicit owner before the first PR touching this, not decided ad hoc inside that PR.

11. **[CLOSED 18 Aug 2026 — decision 18: two stacked PRs, one merge window.]** **Should Phase 1 (the index drop + `resolveMemberships` rewrite) and Phase 2 (the platform tier / threshold logic) ship as one deploy or two adjacent ones?** There is no safe intermediate state where Phase 1 is live in `develop`/QA and Phase 2 isn't — once the index is gone, nothing but Phase 2's threshold check limits business creation. QA migrates automatically on every push to `develop` (`DEPLOYMENT.md`), so "intermediate" here is a matter of minutes between merges at worst, not a deliberate soak, but it is worth a deliberate answer rather than an accident of PR scheduling.
12. **[CLOSED 18 Aug 2026 — decision 21: narrowed and renamed to `AlreadyAMemberError`.]** **Does `BusinessAlreadyExistsError` (`api/src/errors/app-error.ts:72-80`) get retired outright, or narrowed and kept for the same-business-twice case that `business_member_active_pair` still legitimately blocks?** Its own doc comment currently asserts the single-business premise this design overturns — false the moment Phase 1 ships regardless of which way this is decided. Either way, `web/src/features/setup/CreateBusinessForm.test.tsx:60,66` hard-codes its exact message and needs rewriting — found only by an independent code sweep, not by this document's own first pass, and not covered by §7.6's list of the two integration tests that invert.
13. **[CLOSED 18 Aug 2026 — decision 23: a second parallel getter, threaded into both call sites.]** **`web/src/lib/api.ts`'s `createApiClient` has no parameter for a business id today** — `request()`'s closure only captures `getToken` (`TokenGetter = () => Promise<string>`, line 9), constructed once in `main.tsx:52` before any business-selection state exists. §8.1's "same injection shape the token getter already uses" is directionally right but understates the change: a second getter (or a widened one) needs threading through `createApiClient`'s signature into both `request()` and `requestBlob()`, not a single header line added in place. See the implementation plan §2 (Phase 3) and its open question 11 for the two ways to shape it.
14. **[CLOSED 18 Aug 2026 — decision 24: a purpose-built `platform_admin_audit` trigger.]** **Does `platform_admin` grant/revoke get a DB trigger into `platform_audit_log`, or an explicit application-level write?** `business_member`'s own grant/revoke history is protected two ways — never an in-place `UPDATE` (Plan.md's A11) *and* a trigger (`business_member_audit`, migration `0010`) that "cannot be forgotten in a new code path" (migration `0002`'s own stated reason for using triggers at all in this schema). `platform_admin`'s PK is `user_id` itself (§6.1 — a sound shape, matching `business_settings`'s existing precedent, §14 below), which structurally rules out the two-row trick: a re-grant is necessarily an in-place `UPDATE`. If `platform_audit_log`'s entries are written by hand in each domain function rather than by a trigger, a future admin endpoint that doesn't go through those functions produces no audit trail, silently — the same class of gap this codebase's own trigger philosophy exists to prevent. `write_audit_log()` itself can't be reused (it requires `business_id`, and can't compute the `self_action` flag), but a small purpose-built trigger following its shape is worth weighing against an explicit-write decision recorded as such.

**Added, third validation pass (GitNexus code-graph verification), 17 August 2026 — questions 15-20. Full reasoning at §15.**

15. **[CLOSED 18 Aug 2026 — decision 17: a `pendingRequest` field on `GET /api/session`.]** **Nothing gives a requester a way to learn their own request's status on page load.** Decision 13 says "refresh or re-login" is how a requester learns the outcome — but `GET /api/session` (§7.1)'s response shape, `{ userId, isPlatformAdmin, businesses }`, carries no field for the caller's own `business_creation_request`. `POST /api/business`'s discriminated union (§7.4) is a response to the *write*, not something re-fetchable on the next page load. Refreshing gives the client nothing to distinguish "no request exists," "pending," and "rejected: `<reason>`" — the three states decisions 12 and 13 together require `CreateBusinessForm` to render. **This blocks open question 4 from having an implementable answer, not just a UX detail to fill in later.** Needs either a fourth field on `/api/session` (e.g. `pendingRequest: { status, rejectionReason } | null`) or a dedicated `GET` endpoint — not listed anywhere in §7, §8, or the implementation plan's Phase 2 file list.
16. **[CLOSED 18 Aug 2026 — decision 17: three render branches, fed by decision 17's field.]** **`CreateBusinessForm` needs three render branches, not two.** The implementation plan's §2 (Phase 2, client) describes "a second render branch ('your request is being reviewed')" — but decision 12 requires *pending* (no reason, blocked from re-requesting by `business_creation_request_one_pending`) and *rejected* (has a reason, re-requestable) to render differently from each other, as well as from the default create form. That's two additional branches, not one. Direct consequence of question 15 — both need that endpoint to exist first.
17. **[CLOSED 18 Aug 2026 — decision 26: `hadMembership: true`, message without detail.]** **A user revoked from their only membership is indistinguishable from a first-time signup.** §8.1's closing bullet has `FirstRunGate` fall back to the picker "when the stored selection is no longer valid (revoked from that business)" — but that assumes at least one *other* membership remains to pick from. Revoked from the only one, `/api/session` returns `businesses: []`, identical in shape to someone who has never requested a business at all. Whether that's fine (decision 13's "no notification" policy already accepts silence) or needs its own message is not decided anywhere in §8.1 or §11's flow list — recorded here so it's a choice, not an accident. Same question applies to a driver unlinked from their only business.
18. **The proposed `check-forbidden.mjs` extension (§7.7) doesn't actually catch a header read, as literally written.** Verified against `scripts/check-forbidden.mjs:100-106`: `tenancy/from-request`'s pattern is `/\b(body|payload|input|query|params)\s*(\?\.|\.|\[["'])\s*business_?[iI]d/g` — property-access syntax only (`word.business_id`, `word["business_id"]`). `c.req.header("X-Business-Id")` is a call expression whose argument is a string literal; it contains no `.business_id` property access anywhere in its text. Adding `header` to that alternation group changes nothing — the regex still requires a following `.business_id`/`["business_id"]` that never appears. The rule needs a structurally different pattern (e.g. matching `c.req.header(...)` calls whose argument is an `X-Business-Id`-shaped string literal), not an extension of the existing one. Affects §7.7 and the corresponding `scripts/check-forbidden.mjs` entry in the implementation plan's §2 Phase 1.
19. **The single cited instance of a money-bearing, user-id-only query key undercounts by three, all in one file.** §8.1 and the implementation plan's §3/§5 name exactly one: `["partner", me.userId]` (`ReviewMoneyScreen.tsx:37`, `ReviewThisMonthScreen.tsx:119`). Grepping `web/src` for the same shape finds three more families — `["partner", userId]`, `["capital-contribution", userId]`, `["partner-payout", userId]`, `["banking-event", userId]` — all four concentrated in `PartnerDetailScreen.tsx:208,212,217,221` (with matching `invalidateQueries` calls at `:84-85,149-150`). The `queryClient.clear()`-on-switch policy already covers all of them by the same reasoning the design gives for the one it names, so this is not a new isolation gap — but `PartnerDetailScreen.tsx` is the highest-concentration file for this exact failure class and should be named in the regression-test list (§10, implementation plan §5), not only the two `Review*` screens.
20. **The two documents' open-question numbering has drifted apart and now collides.** This document's own §12 assigns numbers 6-14 to nine items added in the second pass (see the corrected note above question 6). The implementation plan's §6 independently assigns numbers 6-12 to seven of the *same* questions, in different words, under different numbers — e.g. "Phase 1/Phase 2 one deploy or two" is this document's #11 but the implementation plan's #6; "`BusinessAlreadyExistsError` retire or narrow" is this document's #12 but the implementation plan's #10. A reader citing "open question 7" gets a different question depending which file they're holding — exactly the "documents lying about each other" failure CLAUDE.md's *Process* section warns against. This document's numbering (1-19, continuing to 20 here) should be treated as canonical; the implementation plan's §6 needs its own numbers retired in favour of cross-references to these. Not blocking design review — blocking before either document is absorbed into `docs/` per §11.

---

## 13. Confidence and gaps in this document

Verified directly against the tree at `docs/tracker-plan-accuracy-2026-08-16`, 17 August 2026: the two constraints in §6.2 and their call sites; `audit_log`'s shape and rules; the `resolveMembership` join in §7.3; the guard rule at `check-forbidden.mjs:101`; the react-query keys in §8.1; the Asgardeo scope in §9; the two inverting tests in §7.6.

**Verified live against QA and production, 17 August 2026** (§9): `app_user.email`/`display_name` are NULL for the one real QA account; production holds zero rows in `app_user` and `business`, matching CLAUDE.md.

**Not verified, and assumed:** the generated constraint name on `driver.linked_user_id` (§6.2 says to confirm it, and does not guess); whether Asgardeo's application registration is configured to place `email`/`name` on the access token — this needs Asgardeo admin console access, which was not available in this pass (§9); whether Asgardeo exposes a sign-up-direct authorization parameter (§8.3 declines to assume one).

---

## 14. Second validation pass, 17 August 2026

Independent re-verification against the same tree, plus a full implementation-level companion: **`PLATFORM-ADMIN-AND-MULTI-BUSINESS-IMPLEMENTATION-PLAN-2026-08-17.md`**, which carries the file-by-file blast radius, a corrected build sequence, and the data-isolation checklist this document's §4 states as intent but does not itself verify line by line.

**Everything this document's original pass cited and marked verified came back confirmed on re-check** — `identity.ts`'s cross-product join, the audit_log/period-trigger shapes, the 203 react-query keys, the two inverting integration tests, the Asgardeo scope, `docs/README.md`'s citation table, `data-model.md:130`'s multi-business paragraph. Two citations were off by a small, immaterial amount (`audit_log.business_id NOT NULL` is line 876, not 875; the `Plan.md` role-switcher rejection is at line 584-595 under the current tree, not 636-647 — both corrected in place above) — recorded so a future reader isn't left hunting.

**What this pass found that the first pass's own scope didn't reach:**

- **The one correction that matters: Track B and Track C are not independent at the schema layer** (§1's table, corrected in place). `createBusiness` and `redeemInvite` both depend on `one_active_business_per_user` — Track C's own index — to produce the clean 409 that stands in for "no threshold logic exists yet." Track B's threshold behaviour is unreachable until that index is gone, and the index cannot be dropped without `resolveMemberships`'s rewrite landing in the same unit of work, or the cross-product bug §7.3 already describes as latent goes live. Full reasoning, corrected migration order and a three-phase resequencing: implementation plan §1.
- Open questions 6-13 above, all sourced from code the first pass either cited as unverified (§13) or never reached — the removed `BusinessAlreadyExistsError` catch clauses, the threshold's check-then-act race, the `getBlob` header gap, the missing test-support helper, the `localStorage` precedent this client has never needed before, and `api.ts`'s missing parameter slot for a business id.
- One thing checked and found **not** to be a gap, worth recording so it isn't re-litigated: `Can.tsx`/`ReportsCatalogueScreen.tsx` read `["me"]` synchronously in more places than `FirstRunGate` alone, but §8.1's "hard remount, not `invalidateQueries`" policy already closes the stale-role window this would otherwise open — no separate fix needed, only the one already specified.
- **One thing checked and found to be *better*-grounded than the document itself claims:** `platform_admin`'s shape in §6.1 (`user_id uuid PK REFERENCES app_user(id)`, no separate surrogate `id`) reads like a deviation from this schema's usual `id uuid PRIMARY KEY` convention — every other table in `0001_initial_schema.sql` follows that shape. It isn't a deviation: `business_settings` (`0001:40-41`, `business_id uuid PRIMARY KEY REFERENCES business(id)`) is the exact existing precedent for "one row per parent entity, primary-keyed on the parent's own id" — `platform_admin` to `app_user` is the identical relationship one level up. Worth citing that precedent explicitly wherever this migration is written, since a reviewer who doesn't already know `business_settings` exists will otherwise flag it as an inconsistency that isn't one.

---

## 15. Third validation pass, 17 August 2026 — GitNexus code-graph verification

The first two passes read the tree by hand (grep, file reads, citation checking). This pass instead re-indexed the repository into GitNexus's call/import graph (`node .gitnexus/run.cjs analyze` — the checked-in index was three commits stale and had a corrupted shadow-page file from an earlier interrupted write; both were fixed as a side effect of this pass) and used structural queries — upstream/downstream impact, symbol context, call tracing — to check claims the first two passes could only check by reading, plus a couple of plain greps across patterns the earlier passes' targeted reads didn't happen to run.

**Confirmed exactly as stated, by graph traversal rather than by reading:**

- `resolveMembership` (`api/src/queries/identity.ts`) has exactly one caller, `authMiddleware` (`api/src/middleware/auth.ts`), which in turn is wired in exactly one place, `api/src/index.ts` — matches §7.2/§7.3's premise that there is one call site to rewrite, not several scattered ones.
- `linkDriverToUser` (`api/src/queries/driver.ts:70-81`) has exactly one caller, `redeemInvite` — matches implementation plan §2's claim about where the new `driver_linked_user_per_business` violation needs its own catch clause.
- `driver.linked_user_id` is declared `uuid UNIQUE REFERENCES app_user(id)` at `api/migrations/0001_initial_schema.sql:182` — the design's own citation, confirmed to the line.
- The migration head is `0028` (`0028_vehicle_service_interval_km.sql`) — no `0029`/`0030` exists yet on this branch, consistent with the implementation plan's `git ls-tree`-based claim.
- No existing code anywhere references `X-Business-Id`, `business_creation_request`, or `platform_admin` — confirmed by full-tree grep. The new vocabulary doesn't collide with anything already written.
- `api/src/queries/vehicle-scope.ts`'s two functions (`listVehicleIdsOwnedByUser`, `listVehicleIdsManagedByUserForPeriod`) — the other place in this codebase that resolves "which vehicles belong to this user" — already take `businessId` as an explicit parameter and filter on it. Checked because it's structurally the same shape of question as the query-key findings below; it isn't a gap.

**New findings, not reached by the first two passes: open questions 15-19 above** (missing API contract for a requester's own request status; the consequent third `CreateBusinessForm` render branch; the revoked-to-zero-membership flow; the header-guard regex needing a structurally new pattern rather than an extended one; and the wider, `PartnerDetailScreen`-concentrated instance of the user-id-only query-key pattern). Open question 20 records a numbering collision between this document's own §12 and the implementation plan's §6 that neither earlier pass caught, because neither pass cross-checked the two files' question numbers against each other.
