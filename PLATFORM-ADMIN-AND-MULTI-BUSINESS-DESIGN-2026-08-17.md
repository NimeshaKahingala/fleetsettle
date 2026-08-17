# Platform admin, self-registration and multi-business membership — design

**Written 17 August 2026. Status: design settled, nothing built, no specification document updated.**

This is a working design note, not a specification. `docs/` still decides; where this and `docs/` disagree, `docs/` wins — and §11 is precisely the list of what must be written *into* `docs/` before any of this is built. Nothing here has been absorbed into `TRACKER.md` or `Plan.md` yet, by explicit instruction: this document stands alone until the design is built or abandoned.

Three things are being added at once, and they are separable:

| Track | What | Depends on |
|---|---|---|
| **A** | Asgardeo claims fix — `email` / `display_name` actually populated | nothing |
| **B** | Platform admin panel, self-registration, business-creation approval | A (for names) |
| **C** | Multi-business membership and the business switcher | A (for names) |

B and C are independent of each other and may ship in either order.

**Track A is confirmed blocked, live, as of this writing.** Verified against the QA branch 17 August 2026: `app_user.email` and `display_name` are NULL on the one real account. Half the fix is in this repo (the missing `email` scope); the other half is an Asgardeo console setting nobody who worked on this pass had access to check. See §9 and §12 Q5 — B and C should not start until this is closed and re-verified.

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

---

## 3. What was declined, and why

Repo convention (CLAUDE.md → *Record what you did not take*).

- **Account-level approval.** Rejected because it blocks *invited* members, and the inviting owner has already vouched for them — routing a new manager past a platform admin adds a stranger to a decision the business already made. It also buys nothing: a signed-up user with no membership is already inert, because `authMiddleware` 404s them on every route except `POST /api/business` and `/api/invite/*`. Gating those two is equivalent, minus the friction.

- **A `status` column on `business`.** Rejected because every one of the 30+ existing routes would then have to check it, forever, or someone posts money into an unapproved business. That is a new invariant threaded through the whole money path, and CLAUDE.md's own history — "the list is hand-maintained and has drifted once already" — says such lists drift. Holding the *request* instead touches zero existing routes.

- **A platform-admin claim in the Asgardeo token.** Rejected because it makes authorisation an identity-provider fact, which TS §2 and W-49 rule out by name: "Asgardeo answers who is this person; `business_member` answers what may they do here."

- **Relaxing `audit_log.business_id` to nullable.** Rejected. That column being `NOT NULL` (`api/migrations/0001_initial_schema.sql:875`) is part of what makes a tenant-scoped audit query trustworthy. Platform actions get their own table instead.

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

```
platform_audit_log
  id          bigserial PK   -- allow: append-only log, never in a URL
  action      text NOT NULL CHECK (action IN
                ('request_approved','request_rejected','admin_granted','admin_revoked'))
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

The threshold is a named constant, and it counts **businesses where the user currently holds an active `owner`/`owner_manager` membership** — not businesses ever created by them. Otherwise leaving a business permanently consumes a slot.

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

**A tension to record.** M-3 says three shells, never a fourth, and never a role switcher (`Plan.md:636-647`). The admin panel is not a fourth *role* shell: it is a platform surface orthogonal to business membership, reached from within whichever shell the user already has, or standing alone when they have none. The distinction is real — the role still follows the business and is never chosen — but it is thin enough that UI §1.1 needs one explicit sentence when `docs/` is eventually updated, or the next reader will read this as M-3 being quietly reversed.

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

1. **The missing `email` scope**, above — fixable in `auth-asgardeo.ts`.
2. **Whether Asgardeo puts `name`/`email` on the access token at all**, independent of scope — a setting on the Asgardeo application's user-attribute/claims mapping, in the Asgardeo console, not visible or fixable from this repository. `testCred.md`'s credentials are an application login, not Asgardeo admin console access, so this could not be checked as part of this pass.

Add the `email` scope, then have someone with Asgardeo admin console access confirm and enable "include in access token" for `email`/`name` on the registered application, then backfill the one existing row by hand. IG §7 already flags the ID-token-versus-access-token trap by name; the name for a header comes from the ID token, the `Authorization` credential from the access token.

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

Deferred by decision 16 — but this is the list, and none of it is optional once the design leaves this file.

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

1. **Does the platform tier get an eighth citation prefix, or extend the seven?** `docs/README.md:37-43` fixes seven documents and seven prefixes (`UC §`, `FL §`, `DM §`, `TS §`, `IG §`, `UI §`, `BR §`), and those prefixes are load-bearing in code comments throughout the repo. An eighth is a permanent tax on every future citation; folding platform concerns into documents that are otherwise strictly business-scoped muddies them. Leaning toward extending the seven. **Not blocking** — it only bites when §11 is executed.

2. **Migration numbers for Tracks B and C.** `0029` and `0030` are proposed above. If the two tracks are built on parallel branches they will collide. Decide before either starts.

3. **Is the threshold of 5 per-user, forever?** As specified it is a fixed constant counting active owner memberships. If it ever needs to be per-user (a trusted operator allowed twenty), that is a column on `app_user` and a different design — cheap now, awkward later.

4. **Does the requester see their pending request?** Decision 13 says no notification, refresh to see. That implies the "Get started" screen must render a pending request as a state — "your request is being reviewed" — rather than offering the create form again, which would hit the one-pending-per-user index and produce a confusing error. Assumed, not confirmed.

5. **Is the Asgardeo application registration configured to place `email`/`name` claims on the access token?** **This one blocks Track A, and therefore B and C.** Confirmed live 17 August 2026 (§9) that the deployed QA app does not — the one real account's `app_user.email`/`display_name` are NULL, and the write path is proven innocent (a NULL row means the token carried nothing). The fix, if one is needed, is an Asgardeo-console change to the application's user-attribute/claims mapping — outside this repository, and outside what `testCred.md`'s application-level credentials can check or change. Needs someone with Asgardeo admin console access: check the current mapping, add `email`/`name` to the access token's claims if absent, then re-verify against QA and backfill the one existing row.

---

## 13. Confidence and gaps in this document

Verified directly against the tree at `docs/tracker-plan-accuracy-2026-08-16`, 17 August 2026: the two constraints in §6.2 and their call sites; `audit_log`'s shape and rules; the `resolveMembership` join in §7.3; the guard rule at `check-forbidden.mjs:101`; the react-query keys in §8.1; the Asgardeo scope in §9; the two inverting tests in §7.6.

**Verified live against QA and production, 17 August 2026** (§9): `app_user.email`/`display_name` are NULL for the one real QA account; production holds zero rows in `app_user` and `business`, matching CLAUDE.md.

**Not verified, and assumed:** the generated constraint name on `driver.linked_user_id` (§6.2 says to confirm it, and does not guess); whether Asgardeo's application registration is configured to place `email`/`name` on the access token — this needs Asgardeo admin console access, which was not available in this pass (§9); whether Asgardeo exposes a sign-up-direct authorization parameter (§8.3 declines to assume one).
