# FleetSettle Attachment Upload Implementation Plan

Date: 2026-08-09, revised 2026-08-09 after a deep review (same day — see "Revision log")  
Closes: GAP-16 (listed in `TRACKER.md` against A7, and its own phase rows P4, P5+, P7 and P8)  
Branch: `feature/image-upload` — not yet created; **cut from `build/p0-foundation`, not from `develop`** (see finding A)  
Primary scope: `api/` attachment endpoint and migration `0013`, `web/src` expense receipt capture and its receipt-viewing surface  
Status: plan re-validated against the working tree, then revised against a deep review; **not yet implemented**

## Objective

Give `attachment` its first row. The table has existed since migration `0001` and has never been written
to; `PhotoCapture` and `photo-pipeline.ts` are built and tested with **0 real callers**; both R2 buckets are
provisioned, CORS-verified and idle. Nothing in `api/src` has ever touched `env.R2`.

This branch builds the upload endpoint, the receipt-viewing surface that makes it actually visible to a
user (not only provable by API test — see decision 6 and DR-06 below), and proves it end to end on the two
simplest call sites — expense receipts. Condition sets and incident photos follow on a second branch, because
four of the five call sites only learn their `subject_id` after the record saves, and the lease wizard's
post-save ordering is the risky part.

## Non-Goals

- Do not build condition photo capture at lease start (F-2.1 step 6) or close (F-2.6 step 5).
- Do not build the side-by-side handover/return comparison — UC §9.1 puts it in phase 3 regardless.
- Do not build incident damage photos (`ReportIncidentSheet`).
- Do not close GAP-17. The pipeline still runs on the main thread with no Web Worker or 3s timeout, and it
  must not look closed by association.
- Do not build Worker-side resize of an oversized original.
- Do not add a hard delete for a wrongly-uploaded photo. A void marks the row; the object stays.
- Do not build a persistent, cross-session upload queue (IndexedDB or similar). Uploads must survive the
  entry sheet closing and route navigation while the app stays open, not a reload or the app being closed —
  decision 6 states the residual risk plainly rather than leaving it implicit.
- Do not build a driver-facing read path for attachments. This branch's only subject type (`expense`) is not
  driver-own data — decision 4.

## Decisions

These were required to be decided and recorded before any code is written (`Plan.md:423`).

### 1 · Upload through the Worker binding, not a presigned PUT

The client `POST`s the JPEG to the Worker, which calls `env.R2.put()` and inserts the `attachment` row in the
same request. Reads are served the same way. No presigning in either direction.

Presigned PUT was rejected on four counts:

- **It produces orphans as a routine outcome.** Presigning is necessarily sign → PUT → confirm. If the
  confirm never arrives, an object exists in R2 with no `attachment` row, and the row is the only index of
  what the bucket holds. UI §6.3 line 527 names the exact behaviour that produces this: "a manager who taps
  Save, sees a spinner, and closes the app." No reconciliation job exists to sweep it.
- **It moves authorisation off the write.** With the binding, every byte passes the same capability and
  business-scoped subject check as every other write. A presigned URL is a bearer capability, authorised once
  at signing time and forwardable for its whole lifetime. Given W-49, and that these photos show number
  plates, that is the wrong direction.
- **Two new secrets with no rotation story.** An `R2Bucket` binding cannot presign; it needs the S3 API, an
  access key and secret per environment, plus `aws4fetch`.
- **It breaks a stated client invariant.** `web/src/lib/ApiContext.tsx`: "Every screen reaches the Worker
  through this — never a direct fetch, so business_id scoping and the W-49 checks stay entirely server-side."

The binding's one real cost is losing byte-level upload progress, because `fetch` has no upload-progress
event. That does not matter here: `PhotoCapture`'s `uploadStatus` prop is already typed
`"uploading" | "uploaded" | "error"` — a three-state indicator, not a percentage. The component as built does
not want what presigning would buy. One request per photo, and per-photo retry, are both preserved.

### 2 · Reads go through the Worker too

IG §10.10 currently requires objects be served through presigned expiring URLs — **that is §10 "Security
baseline", numbered item 10, at `docs/engineering/implementation-guidelines.md:447`**, verified rather than
assumed, since this plan schedules a `doc-change` against it and a citation that resolves to nothing would
send that change to the wrong line. Presigning reads would reintroduce exactly the credentials decision 1
avoided. Serve reads through the Worker instead, authorised per request, and amend that item to say so.

This serves that rule's stated reason — condition photos are dispute evidence and often show number plates —
better than a presigned URL, because `business_id` is re-checked on every single read and no URL outlives its
authorisation check. Client consequence: an `<img src>` cannot carry a bearer header, so a thumbnail is
fetched as a blob and displayed via `URL.createObjectURL`, the same mechanism `PhotoCapture` already uses for
local previews.

### 3 · Void, never delete

Migration `0013` adds the void trio. A void marks the row; the R2 object stays. Deleting the object while the
row survives is precisely the row/object disagreement decision 1 exists to prevent, and these photos are
dispute evidence. A voided attachment 404s on read and is excluded from every list.

### 4 · Reads are gated exactly like writes in this branch — no driver read path

`expense` receipts map to `dailyOperations`, a capability a linked-driver token does not hold. This branch
does not add a `viewOwnData` read path for attachments, so a driver token gets a plain `403` on both upload
**and** read of any attachment — never a subject-specific `404` for "not theirs", because there is no "theirs"
to distinguish from yet. Nothing in F-8.x or the driver-view spec puts expense receipts in front of a driver,
so staff-only reads is the correct answer for the one subject type this branch ships, not merely the
convenient one.

This is deliberately deferred, not settled for good: the second branch adds `lease` condition photos, and
"can a driver see photos of their own vehicle's handover" is a real question there — one this branch's subject
set (`expense` only) never actually raises. Ask it when the subject that raises it exists.

### 5 · The subject-type `CHECK` is broader than this branch's API

Migration `0013` constrains `subject_type`/`kind` to every combination the schema will ever legally hold, not
only the one pair this branch builds — see "The subject dispatch table". **Legal in the database** and
**supported by this branch's API** are two separate gates from day one: the `CHECK` makes an impossible pair
unstorable forever; the handler separately rejects every pair besides `expense`/`expense_receipt` with a
deliberate `400`, so an unbuilt subject type fails predictably rather than by an unhandled map lookup or, worse,
by the database `CHECK` being the only thing that stood in its way.

### 6 · The upload queue survives the sheet closing, not the app closing

The uploader is a module-level singleton so a photo queued in `RecordExpenseSheet` keeps uploading after the
sheet unmounts and the user navigates elsewhere — that much is required, since both sheets close on success
before their photos can possibly have finished. It does **not** persist across a page reload, a tab close, or
mobile background eviction; there is no IndexedDB-backed resume in this branch.

**The residual risk is real and is stated rather than hidden**: a user who force-closes the app in the few
seconds between the sheet closing and the upload finishing loses that photo from the app's perspective. The
expense record itself is unaffected — it saved on level-1 fields already, per U-2 — so no money fact is lost,
only a photo, and the receipt-viewing surface (decision 7 / DR-06) is exactly where that loss becomes visible
and fixable: reopen the expense, see it has no receipt, take another. A fully durable queue is a deliberate
non-goal for this branch, not an oversight.

**UI §6.3 is the authority here and it already resolved this**, which is worth quoting because it turns an
accepted risk into the owning document's own answer rather than this plan's convenience: *"The failure that
matters is not a slow upload — it is a manager who taps Save, sees a spinner, and closes the app. So the
record saves first and the photos follow it."* The spec names the exact scenario and protects **the record**,
not the photo. This decision implements that literally. If a durable photo queue is ever wanted, UI §6.3 is
where that requirement has to appear first.

### 7 · A receipt-viewing surface ships with this branch, not after it

"Done means reopening the expense shows both thumbnails" is not true today for any expense, on any screen —
`ExpenseCostRow` opens straight to `VoidExpenseSheet` and there is no expense detail route. Building the
upload endpoint without also building somewhere to see its result would make GAP-16 look closed while still
being unusable, the exact "built but not reachable" gap this tracker has hit before (A0, B0b). This branch adds
a small indicator on `ExpenseCostRow` when attachments exist, opening a lazy-loaded receipt strip — see Client
Implementation. GAP-81's void-on-tap behaviour is preserved alongside it, not replaced by it.

## Findings From Re-Validation

Five things were checked against the working tree rather than assumed, and each changed the plan.

### A · Five undeployed migrations sit in front of this one — and that is a branch-state fact, not a permanent one

`DEPLOYMENT.md` lines 115–116 record both Neon branches as migrated `0001`–`0007`. The working tree contains
`0008`–`0012`. Merging this branch to `main` therefore applies six migrations to production, five of which
this branch did not write:

| Migration                                | What it carries                                     |
| ----------------------------------------- | --------------------------------------------------- |
| `0008_void_respects_closed_period.sql`   | changes void behaviour against a closed period      |
| `0009_obligation_kind_trip_fare.sql`     | a new obligation kind                               |
| `0010_business_member_invite.sql`        | a new table                                         |
| `0011_management_fee_obligation.sql`     | the idempotency key A10a's generator needs          |
| `0012_incident_recovery_obligation_fk.sql` | a real FK on `incident_recovery.obligation_id` (A10b) |
| `0013` (this branch)                     | attachment void trio, subject index and pair checks |

`CLAUDE.md` states that merging to `main` deploys production automatically and nothing pauses afterwards.
This is not a reason to change the plan, but **the pull request description must say plainly that it carries
five inherited migrations**, so the deploy decision is made with that in view rather than discovered after.
**Re-check the migration number immediately before opening the pull request** — `0013` is free only until
another branch claims it first (see DR-01 in the revision log).

**Why this branch is cut from `build/p0-foundation` rather than `develop`.** `DEPLOYMENT.md:70` documents the
flow as `feature/* ──PR──► develop ──PR──► main`, and ordinarily this branch would come off `develop`. It
cannot: `0008`–`0012` and everything A10a/A10b/A13/A15/A16 built live on `build/p0-foundation`, which has
**not** merged to `develop` yet (`Plan.md` row 11c, outstanding since 8 Aug). A branch cut from `develop`
today would be missing the schema this one builds on top of.

**The clean order, if it is available: merge `build/p0-foundation` → `develop` first, then cut this branch.**
Then it carries `0013` alone, its pull request is about one migration instead of six, and the inherited-
migration warning above stops applying entirely. That merge is already the top of its own queue and blocks
QA verification of three other fixes regardless. **If it has not happened by the time this work starts, cut
from `build/p0-foundation` and carry the inheritance knowingly** — but re-read this section before writing
the PR description either way, because which of the two situations applies changes what that description
has to say.

### B · The repo is not installed and has no test database

`node_modules` does not exist, and `api/.dev.vars` does not exist. `api/tests/support/env.ts` lines 30–41
throw at import unless `TEST_DATABASE_URL` is set and differs from `DATABASE_URL`. Nothing can be verified
until both are in place, on a disposable Neon branch — never the QA or production branch, because cleanup
deletes real rows.

### C · `PhotoCapture` has a latent bug this branch makes reachable

`web/src/components/PhotoCapture.tsx` lines 40–48 have no `try`/`catch` around `downscaleAndEncode`, and
every caller invokes `handleFile` as `void handleFile(...)` (lines 59, 71, 84). If `createImageBitmap`
rejects — a HEIC file from an iPhone, a corrupt image, memory pressure on a 2GB device — the tile spins
forever, `onCapture` never fires, and the rejection is unhandled. Having zero real callers is the only reason
this has never been seen.

Fix it in this branch, and fix more than the decode path alone — see "Client Implementation" for the full
scope (URL revocation, the save-while-encoding race), found by the deep review and folded in rather than left
as a narrower patch that would need revisiting immediately.

### D · The capability must be keyed on `subjectType`

`api/src/auth/policy.ts` documents `dailyOperations` as "daily cards, trips, expenses, collections", which is
correct for `expense_receipt`. Condition photos belong to `leaseAndTripLifecycle`. All three relevant
capabilities map to `STAFF` today, so a single hardcoded gate would be functionally identical and silently
wrong, invisible until the matrix is tightened. Build the gate as a map from `subjectType` to `Capability`
from day one, even though this branch populates only one row of it — and see decision 5 for why a row's
*absence* from that map must itself be a deliberate `400`, not a silent fall-through.

### E · Corrected references

- `web/src/features/costs/RecordExpenseSheet.tsx:184` — the `NotAvailable` placeholder, inside the
  `Disclosure` at line 161.
- `web/src/features/costs/FuelFillSheet.tsx:155` — the same, inside the `Disclosure` at line 116, whose
  `sectionName` is already "Litres, borne by and photo". The copy already promises this feature.

### F · `ExpenseCostRow` is a single full-width `<button>`, so the receipt indicator cannot simply be added to it

`web/src/features/costs/ExpenseCostRow.tsx:59` wraps the row's entire contents in
`<button type="button" onClick={() => setVoidOpen(true)} className="w-full text-left">`. **A receipt
thumbnail or count button cannot be nested inside it** — a `<button>` inside a `<button>` is invalid HTML,
and React will render it while browsers disagree about what the inner click does.

This changes the shape of commit 7, and it is worth knowing before starting rather than discovering at the
first nested-interactive warning. Three ways out, in the order they are worth trying:

1. **Split the row into two sibling targets** — the existing tap area shrinks to the text block, and the
   receipt indicator becomes its own adjacent button. Both stay ≥ 44 × 44 with ≥ 8px between them (M-1), which
   is the real constraint on how small the text target may become.
2. **Promote the row to a details view** and put both void and receipts inside it — cleaner long-term, but it
   is a bigger change than this branch needs and it moves GAP-81's void action a level deeper, which decision
   7 explicitly says not to do casually.
3. **Make the row a `<div>` with an explicit `role`/keyboard handling** — rejected: hand-rolling button
   semantics to dodge a nesting rule trades a validity problem for an accessibility one, and this repo has
   GAP-83 and GAP-46 open for exactly that class of shortcut.

Option 1 is the recommendation. Whichever is chosen, **GAP-81's requirement stands**: voiding a live expense
stays reachable and obvious, not buried.

### G · The dev R2 binding is still a placeholder; only QA and production are real

`api/wrangler.jsonc:34` — the top-level `r2_buckets` binding is still
`{ "binding": "R2", "bucket_name": "todo-provision-before-deploy" }`. The real buckets exist only in the
environment overrides: `fleetsettle-attachments-qa` (line 82) and `fleetsettle-attachments` (line 114).

**This does not block local work** — `wrangler dev` simulates R2 locally and will happily create a local
bucket under the placeholder name — and it does not block the tests, which use the in-memory fake instead. But
the name is a lie sitting in the file the whole branch is about, and the top-level block is the one a reader
checks first. Rename it to something honest (`fleetsettle-attachments-dev`) as part of commit 3, and note that
IG §9.4 / `wrangler.jsonc:61-64` warn that `r2_buckets` is non-inheritable: the two environment blocks must
keep restating it in full, so changing the top-level name must not be mistaken for changing theirs.

## Migration `0013_attachment_void_and_subject_index.sql`

Additive only, per the forward-only rule. Numbered `0013` because `0012` was claimed by
`incident_recovery_obligation_fk.sql` before this branch started (see finding A) — re-check the number again
immediately before opening the pull request.

- `ADD COLUMN voided_at timestamptz`, `voided_by uuid REFERENCES app_user(id)`, `voided_reason text` — the
  house-style column name every other money table uses (`voided_reason`, not `void_reason`).
- A void-consistency `CHECK`, so a half-voided row can never exist:
  ```sql
  CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
        AND voided_reason IS NOT NULL AND voided_reason <> '')
  )
  ```
- `CREATE INDEX attachment_subject_live ON attachment (business_id, subject_type, subject_id, uploaded_at DESC)
  WHERE voided_at IS NULL` — tenant-scoped and ordered newest-first, matching the actual list-query shape,
  rather than the bare `(subject_type, subject_id)` pair originally planned. No index on the subject pair
  exists today.
- `CHECK (size_bytes > 0)`.
- `CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))` — `content_type` has been free text
  since `0001`; this is exactly the allowlist the handler enforces (see "Domain and storage"). If a later
  branch needs PDF tickets or another type, that is a migration, deliberately, not a reason to leave the
  column unconstrained now.
- `CHECK` on the `kind`/`subject_type` pair, covering **every legal combination the schema will ever hold**,
  not only the one pair this branch's API accepts:
  ```sql
  CHECK (
    (subject_type = 'expense' AND kind = 'expense_receipt')
    OR (subject_type = 'lease' AND kind IN ('condition_handover', 'condition_return'))
    OR (subject_type = 'incident' AND kind = 'incident')
    OR (subject_type = 'odometer_reading' AND kind = 'odometer')
    OR (subject_type = 'post_closure_charge' AND kind = 'ticket')
  )
  ```
  **A pair the `CHECK` allows is not necessarily a pair the API accepts yet** — see "The subject dispatch
  table" and decision 5 for why those are two separate gates.

**Adding these `CHECK`s is only free because the table is empty**, which will never be true again; a `CHECK`
added later would need a backfill and a validation pass.

The header comment must state why `attachment` stays out of the `assert_period_open()` array: the trigger
body reads `NEW.posted_period_id`, which `attachment` does not have, so adding it throws `42703` on first
insert — the failure `0004`'s own header documents. The same reasoning excludes it from `write_audit_log()`,
which discovers its tables by walking `posted_period_id`. `api/scripts/check-drift.mjs` selects only
`posted_period_id` tables, so it will correctly stay silent; that silence is intended, not drift.

Record the consequence honestly: **attachment writes are neither period-gated nor audit-logged.**

## API Implementation

Follow the `add-endpoint` skill and the `changeVehicleArrangement` chain. Reuse `requireCapability`,
`requireBusinessId` and `requireUserId` from `api/src/auth/context.ts`, `newId()`, and `isUniqueViolation`
from `api/src/db/pg-error.ts`.

`api/src/db/schema.ts` needs the `attachment` `pgTable` added; it does not exist yet, although
`odometer_reading.attachment_id` and `expense.attachment_id` already reference the table.

### Request shape

Metadata travels as Zod-validated **query params**, built with `URLSearchParams` on the client rather than
hand concatenation, exactly like `listExpensesRoute`. The image is the **raw request body, not declared in
the route-def**; the handler reads it with `c.req.arrayBuffer()`.

Declaring the binary body in `createRoute` was avoided deliberately: `@hono/zod-openapi` ^1.5.1 is not
installed, so its handling of a non-`application/json` content type could not be verified, and this design
depends on nothing unverified. Document the body in the route's `description` — that is a documentation
cost, not a correctness one.

Base64 in a JSON body was considered and rejected. It would be fully conventional and need no new client
method, but it inflates every payload by 33%. UI §6.3's budget line states a six-photo condition set is
≈1.2MB; base64 makes it ≈1.6MB on a mobile-first product built for 4G.

### Routes

| Route                                                     | Purpose                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/attachment?id=&kind=&subjectType=&subjectId=` | Raw image body, `env.R2.put()` plus row insert, `201` on create, `200` on an idempotent replay of the same `id` |
| `GET /api/attachment/{id}`                                | Business-scoped, void-checked, streams the object, `private, no-store`, `nosniff` |
| `GET /api/attachment?subjectType=&subjectId=`             | Metadata list for one subject                                          |
| `POST /api/attachment/{id}/void`                          | JSON body carrying the reason, mirroring `voidExpenseRoute`            |

The client mints `id` (UUIDv7, `newId()`) once per photo and resends the same value on every retry — this is
the whole idempotency contract, stated in the route itself rather than left implicit (see "Idempotency").

### The subject dispatch table

`subject_type` is the key the whole polymorphic design turns on. This table now has two distinct jobs, kept
deliberately separate (decision 5): which pairs are **legal in the database** (migration `0013`'s `CHECK`,
covering every subject type below), and which pairs this **branch's API supports** (one row).

| `subject_type`    | `kind`                                       | Ownership check              | Capability              | Legal in DB (`0013`) | Built this branch |
| ----------------- | --------------------------------------------- | ----------------------------- | ------------------------ | :---: | :---: |
| `expense`         | `expense_receipt`                            | `findExpenseForBusiness`     | `dailyOperations`       | yes | **yes** |
| `lease`           | `condition_handover`, `condition_return`     | `findLeaseForBusiness`       | `leaseAndTripLifecycle` | yes | no |
| `incident`        | `incident`                                   | `findIncidentForBusiness`    | `dailyOperations`       | yes | no |
| `odometer_reading`| `odometer`                                   | via its lease                | `dailyOperations`       | yes | no |
| `post_closure_charge` | `ticket`                                 | `findLeaseForBusiness`       | `leaseAndTripLifecycle` | yes | no |

Two rules the table encodes, enforced twice each on purpose:

- **`kind` and `subject_type` are not independent.** Migration `0013`'s `CHECK` is the backstop that makes an
  impossible pair unstorable no matter what writes it. A Zod `superRefine` on the request schema is the first
  gate, ahead of it, because a `400` with a field-level Zod message is a better error than a raw Postgres
  constraint violation reaching a user. Neither replaces the other.
- **Only the `expense` row is built here, even though every row above is legal in the database.** The handler
  rejects every other `subjectType`/`kind` pair with `400 ATTACHMENT_SUBJECT_UNSUPPORTED` *before* consulting
  the dispatch map — do not let an unbuilt subject type manifest as a missing-map-entry exception, and do not
  rely on the database `CHECK` to be the only thing standing between a crafted request and an attempted write
  for a subject type nothing else in this branch checks ownership or capability for. Write this as an explicit
  contract test (see Tests), the same way an unimplemented route would deliberately 404 rather than half-work.

Note that W-30's "the handover/return SET is one artefact" means the condition-set subject is the **lease**,
not the vehicle, and `kind` alone distinguishes handover from return. That is why `lease` appears once with
two kinds rather than twice — relevant to the second branch, not built here.

### Idempotency — the Retry button makes this mandatory, and the compensation rule has to be exact

IG §4.3 is explicit that it covers not only cron but **"retried mutations"**, and that the guarantee "is in
the constraints, not in code". `PhotoCapture` ships a **Retry affordance** wired to `onRetryUpload`, so a
retry is a designed-in user action, not a rare edge.

**The client generates the attachment id** (UUIDv7, `newId()`) once, when the photo is queued, and resends
that same id on every attempt for that photo — including retries. The route contract states this out loud:
`POST /api/attachment?id=&kind=&subjectType=&subjectId=`.

A first-pass design — always write R2, then insert, then treat a primary-key unique violation as success — is
not sufficient on its own. Trace the sequence that breaks it:

1. First upload succeeds: R2 object A is written, row `att_1` points to object A.
2. The response is lost on a flaky 4G link.
3. The user taps Retry, resending the identical `id`.
4. The Worker writes **a second** R2 object, B, before it ever discovers the id collision — `env.R2.put()`
   runs before the insert does.
5. The insert hits `attachment_pkey`.
6. Object B is now an orphan. The compensation guard correctly refuses to delete the *existing* row's object
   (A) — but nothing deletes B either, because "must not delete on this path" was written with A in mind, not
   B.

**The corrected sequence:**

1. **Pre-read before writing anything.** Look up `id`, scoped to this business, first.
   - Found, `kind`/`subjectType`/`subjectId` all match, and not voided → an idempotent replay. Return the
     existing row, `200`. Touch neither R2 nor the database again.
   - Found, and any of `kind`/`subjectType`/`subjectId` differ → the same id is being reused for a different
     fact. Reject with `409 ATTACHMENT_ID_CONFLICT`. Do not overwrite.
   - Not found → proceed to write.
2. **Write R2, then insert**, exactly as before — this attempt's `r2_key` is generated fresh, once, and used
   only by this attempt.
3. **If the insert fails**, inspect why:
   - A unique violation on `id` — a second request for the same photo raced this one between the pre-read and
     the insert, since the pre-read is not a lock — delete **this attempt's own `r2_key`**, re-read the
     now-existing row, and return it exactly as the idempotent-replay path does. This is the only path allowed
     to delete an object this same request just wrote.
   - Any other failure → delete this attempt's `r2_key` (nothing else could have written it) and re-raise.
4. The original warning still holds, narrowed to what it actually protects: the compensating delete must never
   target *another* attempt's object — only ever the object the current request itself just wrote, and only
   when the current request's own insert is what failed.

This is **best-effort row/object consistency, not atomicity** — R2 and Postgres are not one transaction, and a
Worker crash between `env.R2.put()` and the `INSERT` can still orphan an object no request will ever clean up.
That residual gap is accepted, not solved; every compensating-action-after-a-non-transactional-side-effect in
a Worker has the identical shape, and it is a smaller consequence than a lost photo would be.

**Test obligation:** two requests carrying the same `id`, fired concurrently, must resolve to exactly one row
and one object — the race the pre-read alone cannot fully close; only the insert's own unique constraint can.

### Handler order

Resolve `subjectType` against the branch-support gate (decision 5) → resolve the capability from `subjectType`
via the dispatch map (finding D) → `requireCapability` → `requireBusinessId` → validated query → **re-check
that the subject belongs to this business and, for uploads, is not voided** (see "Domain and storage") →
domain call.

That subject check is the entire tenancy story. `subject_id` is polymorphic and carries no foreign key, so
nothing in the database prevents a crafted `subjectId` from pointing at another business's expense.

**Reads are gated the same way as writes, deliberately (decision 4).** `expense` maps to `dailyOperations`,
which a linked-driver token does not hold — so a driver gets `403` on both upload and read of any `expense`
attachment. There is no subject-specific `404` for "not theirs" in this branch, because this branch gives
drivers no attachment read path to begin with.

### Domain and storage

Storage follows the idempotency sequence above: pre-read, `env.R2.put()`, `INSERT`, with the compensating
`env.R2.delete()` scoped exactly as described there.

The `r2_key` is an opaque `crypto.randomUUID()` (v4), generated fresh per attempt and unrelated to the row id
— not the attachment id, which is UUIDv7 and therefore time-ordered and partly predictable (`Plan.md:433`).

Validation is a content-type allowlist (`image/jpeg`, `image/png`, `image/webp`, matching migration `0013`'s
`CHECK`) and a **5 MiB** cap.

**That 5 MiB does not contradict UI §6.3's "Cap — 200KB hard", and the difference must be stated in the doc
comment or someone will "fix" one of them.** They are two different caps on two different things: 200KB is
the *client encoder's* target, which `photo-pipeline.ts` pursues by re-encoding at 0.75 → 0.6 → 0.45 and then
accepting whatever the third pass gives and setting `flagged`. The server cap is a **backstop against the
path where the encoder never ran at all** — `photo-pipeline.ts:63` returns the original, un-downscaled `File`
untouched when `canvas.getContext("2d")` yields null. A 200KB server cap would reject exactly the photos that
degraded path produces, which is a rejection landing on the least capable device in the fleet. Note in the doc
comment that Worker-side resize is not built (UI §6.3's own "on timeout, upload the original and let the
Worker resize it" describes a capability this branch does not add — see Non-Goals).

**Uploading to a voided subject is rejected.** For `expense`, `findExpenseForBusiness` already returns
`voidedAt`; treat `voidedAt !== null` as not attachable and return `404` — the same status a subject in
another business gets, so a voided expense stays indistinguishable from an unavailable one rather than
confirming its own voided-ness to a crafted request. Reads and lists are unaffected: an attachment uploaded
before the expense was voided stays visible, because it is evidence of what was claimed at the time — receipts
do not retroactively disappear when the expense they document is later corrected.

### Read semantics

`GET /api/attachment/{id}` sets:

- `Content-Type` from the stored row, not sniffed from the bytes.
- `Cache-Control: private, no-store` — decision 2's whole point is that no copy of this response outlives its
  own authorisation check.
- `X-Content-Type-Options: nosniff` — the allowlist at write time does not make sniffing at read time safe.
- `Content-Length`, from the stored `size_bytes`.

**Row exists, object missing is corruption, not an ordinary not-found.** The response to the caller is still
`404` — nothing about the failure should be observable that isn't also observable for a genuinely voided or
foreign-business row — but it must be logged as an error, with the request id, `business_id`, attachment id
and `r2_key`, because it means the row and the bucket have disagreed, exactly the failure mode decision 1 was
chosen to prevent. If this ever fires, decision 1's central claim needs revisiting, not silent swallowing.

### Error codes

Added to `ERROR_CODES` in `packages/shared/src/errors.ts` and as subclasses in `api/src/errors/app-error.ts`:

- `ATTACHMENT_TOO_LARGE` — 413
- `ATTACHMENT_TYPE_UNSUPPORTED` — 400 (content type not in the allowlist)
- `ATTACHMENT_ALREADY_VOIDED` — 409 (voiding an already-voided attachment)
- `ATTACHMENT_SUBJECT_UNSUPPORTED` — 400 (a `subjectType`/`kind` pair that is legal in the database but not
  built by this branch's API — decision 5)
- `ATTACHMENT_ID_CONFLICT` — 409 (the same `id` reused with different `kind`/`subjectType`/`subjectId`)

`api/src/errors/handler.ts` builds a raw `Response`, so a 413 needs no typed-status accommodation.

### Linking

`subject_type` and `subject_id` are the canonical link. Do **not** also write `expense.attachment_id` — two
link paths become two disagreeing answers, and only the polymorphic pair supports more than one photo. Record
those reverse-pointer columns as redundant in `TRACKER.md`.

## Tests

`api/tests/support/env.ts:108` is `unavailableBinding<R2Bucket>("R2")`, a `Proxy` that throws on any property
access. Replace it with an in-memory fake supporting `put`, `get`, `delete` and `head` over a `Map`, following
`fakeKV()` at line 64 of the same file, and expose an object count for assertions. The database stays real.

`api/tests/integration/attachment.test.ts` covers the standard matrix — happy path, 401 missing header, 401
verifier throws, 403 capability, 404 subject in another business, 409 double void — plus:

- 413 over the size cap, and 400 on a disallowed content type
- 404 when reading a voided attachment
- 404 when *uploading* to a voided subject (a voided expense)
- 400 on a `kind`/`subjectType` pair the Zod schema itself rejects (malformed)
- 400 on a `kind`/`subjectType` pair that is legal in the database `CHECK` but unsupported by this branch's
  handler (`ATTACHMENT_SUBJECT_UNSUPPORTED`) — a distinct case from the one above, and the one the deep review
  found this plan would otherwise have let fall through to an unhandled map lookup
- a test proving the compensating delete leaves no orphan object when the insert fails for a non-idempotency
  reason
- **idempotency**: the identical request sent twice yields one row, one object, and two 2xx responses (`201`
  then `200`) — and the second call must leave the first object intact
- **concurrency**: two requests carrying the same `id`, fired without waiting for either to finish, still
  resolve to exactly one row and one object — the case the pre-read alone cannot close and only the unique
  constraint can
- **row/object corruption**: the row exists but the R2 object is missing → `404` to the caller, logged as an
  error; the object exists but the row is voided → `404`, no log needed (that is the ordinary void path)
- the **linked-driver class** via `mintLinkedDriver`: **403 on upload and 403 on read** of any attachment,
  matching decision 4 — not the 404-for-cross-tenant shape used elsewhere, since this branch gives drivers no
  attachment read path at all

## Client Implementation

- `web/src/lib/api.ts` — add `postBinary<T>(path, blob, contentType)` and `getBlob(path)` to `ApiClient`,
  built carefully rather than as a thin wrapper around `request<T>()`, since it assumes JSON success today:
  - `postBinary` sets the caller-provided image `Content-Type`, never the JSON default the current `request()`
    hardcodes before spreading `init?.headers`; keeps the bearer-token path identical; parses a JSON error body
    into `ApiError`; parses a JSON success body as the attachment metadata response.
  - `getBlob` keeps the bearer-token path identical, parses a JSON error body into `ApiError`, and returns the
    blob plus response metadata the UI needs, at minimum `contentType`.
  - Query strings (`id`, `kind`, `subjectType`, `subjectId`) are built with `URLSearchParams`, not
    concatenation.
  - `web/src/lib/api.test.ts` covers both methods, including a 404 JSON error surfacing correctly from a blob
    read.
- `web/src/components/PhotoCapture.tsx` — fix finding C, with the fuller scope the deep review found:
  1. Wrap `downscaleAndEncode` in `try`/`catch`/`finally` so the encoding flag always clears.
  2. Represent a local decode failure through the existing `"error"` status, distinct in wording from an
     upload failure but using the same visual state and Retry affordance.
  3. Revoke every `URL.createObjectURL()` result on retake and on unmount — the component creates preview URLs
     today and never releases any of them.
  4. `accept="image/*"` can admit formats the server allowlist rejects (HEIC, for one). Give the user a clear
     local error before Save rather than a background upload failure with no sheet left to show it in.
  5. Define what happens if Save is tapped while a photo is still encoding: photos are optional, so the
     expense must not be blocked — but a photo selected before Save must not be silently dropped just because
     its encode finishes after the sheet has already closed. Hand it to the uploader queue the moment encoding
     resolves, keyed by the slot the queue already opened for it.
- `web/src/lib/attachmentUploader.ts` (new) — the one genuinely novel piece. Both sheets close on success, so
  the upload must outlive the component. A module-level queue with a subscribe API, deliberately **not** a
  react-query mutation (UI §6.3 line 524 says so explicitly). It exposes exactly what `PhotoCapture` already
  consumes: a status record and `retry(key)`. A thin `usePhotoUpload` hook subscribes for display.

  **The uploader mints the attachment id once, when the photo is queued, and reuses it for every retry of
  that photo.** That is the whole client half of the idempotency guarantee above — a fresh id per attempt
  would defeat it entirely, and it is an easy thing to write by accident.

  **It mints it with the same `newId()` the Worker uses**, imported from `@fleetsettle/shared` — verified: it
  is `packages/shared/src/id.ts:9` (`uuid`'s `v7`), and `web/package.json:19` already depends on
  `@fleetsettle/shared`, which `web/src/lib/api.ts` and four other client files already import from. So the
  client and server agree on id shape by sharing one function rather than by two implementations that happen
  to match today — the same reasoning the two-track rule applies to schemas.

  **Persistence scope is decision 6, stated here again because it is the file that implements it**: the queue
  survives the sheet unmounting and the user navigating elsewhere, because it is a module singleton, not
  component state. It does not survive a reload or the app closing — there is no IndexedDB-backed resume in
  this branch, and that gap is the reason the receipt-viewing surface below exists.
- `RecordExpenseSheet.tsx` and `FuelFillSheet.tsx` — replace the `NotAvailable` placeholders with
  `<PhotoCapture />` in free-grid mode (`slots` omitted). Photos are held locally; the existing mutation's
  `onSuccess` supplies the expense id, and the blobs are handed to the uploader with `kind: "expense_receipt"`
  and `subjectType: "expense"`. **U-2 holds** — the form still saves on level-1 fields alone, and photos are
  never required.
- **Receipt-viewing and retry surface (new — decision 7 / DR-06, not in the original plan).** `ExpenseCostRow`
  gains a small receipt indicator when the expense has attachments — a count or a single thumbnail button —
  and tapping it opens a lazy-loaded receipt strip that fetches blobs only once shown, never eagerly for every
  row on every vehicle/trip/incident screen. This is also where a photo that failed to upload after its sheet
  closed becomes visible and retryable, since `PhotoCapture`'s own Retry affordance is gone once the sheet is
  gone — the uploader's status record (keyed by attachment id) must be readable from here too, not only from
  the sheet that queued it. **GAP-81's void-on-tap behaviour is preserved**: if the row's tap target now opens
  a details/receipts view instead of jumping straight to `VoidExpenseSheet`, voiding must stay one clearly
  visible tap away, not buried a level deeper. Whether the indicator needs a new field on the expense list
  response (an attachment count) or a second bulk `GET /api/attachment?subjectType=&subjectId=` call scoped to
  the visible rows is a decision for whoever builds this commit — pick whichever is cheaper against real
  traffic, but do not fetch blobs eagerly either way.
- `EncodedPhoto.flagged` has no consumer today. Upload it anyway, since it is far under the 5 MiB server cap,
  and show no badge. It is a compression-quality note, not a user-facing failure. Record the decision.

Tests sit beside each file in the house style — Vitest and Testing Library, mocked at the module boundary,
because jsdom has no canvas and `web/src/test/setup.ts` deliberately declines to stub `createImageBitmap` and
`OffscreenCanvas`.

## Implementation Sequence

Seven commits, each one reviewable alone and each leaving the gate green. The order is chosen so the server
is provably correct before any screen depends on it, and so GAP-16 is not marked closed until a user can
actually see what they uploaded.

1. **Schema.** Migration `0013`, the `attachment` `pgTable`, and the `subject_type`/`kind` pair const shared
   between the SQL `CHECK`, the Zod `superRefine`, and the dispatch map. Nothing calls it yet.
2. **Contract.** The five error codes in `packages/shared` and their `AppError` subclasses, plus the Zod
   query schema (`id`, `kind`, `subjectType`, `subjectId`) including the pair `superRefine` and the
   branch-support gate.
3. **Server.** Queries, domain (idempotency pre-read and compensation, voided-subject rejection), route-defs,
   handlers, routes, read-response headers and corruption logging, and the mount in `index.ts`.
4. **Server tests.** The in-memory R2 fake replacing the throwing stub, then the full matrix including the
   concurrency and corruption cases. **Commits 1–4 close GAP-16 on the server and are independently
   mergeable** even if the client work slips.
5. **`PhotoCapture` fix.** Finding C's full scope, on its own, because it is a bug fix in existing shipped
   code and should not be buried inside a feature commit.
6. **Client upload infrastructure.** `api.ts` binary methods with their own tests, `attachmentUploader.ts`,
   and the two sheets wired to it.
7. **Receipt display and retry surface.** The `ExpenseCostRow` indicator (or receipt sheet), lazy blob fetch,
   and the failed-after-close retry path. **GAP-16 is not honestly "closed" in TRACKER/Plan until this commit
   lands** — closing it at commit 6 would repeat the exact "Done Means claims a screen that doesn't exist"
   gap the deep review found in the first draft of this plan.

Documents travel with the commit that makes them true, not in a batch at the end: UI §6.3 and IG §10.10 with
commit 3, DM §12 with commit 1, TRACKER and Plan with commit 7.

## Done Means

- A fuel fill recorded with two receipt photos closes its sheet immediately, and both photos finish uploading
  after the sheet is gone.
- Reopening that expense shows both thumbnails via the receipt-viewing surface built in commit 7, fetched as
  blobs through the Worker — never from a public bucket URL, and never with a URL that outlives its
  authorisation check.
- Tapping Retry on a photo that actually succeeded leaves exactly one row and one object.
- A receipt upload that fails **after** the expense sheet has already closed remains visible as failed from
  the expense's own display surface — not only from the now-gone sheet — and tapping Retry there reuses the
  same attachment id, producing exactly one row and one object once it succeeds.
- A linked-driver token gets `403` on both upload and read of any attachment — this branch gives drivers no
  attachment read path at all (decision 4).
- A file that fails to decode shows an error with a working Retry, rather than a tile that spins forever.
- `GET /api/attachment/{id}` for another business's attachment returns 404, not 403.
- Uploading to an already-voided expense is rejected with 404; an attachment already on an expense that is
  later voided stays visible.
- Two requests racing on the same client-generated id still leave exactly one row and one object.
- The golden fixtures still land on 134,000, 15,000 and 7,500.

## Open Questions

Recorded rather than guessed at, in the convention of the rest of the repo.

- **Retention is undefined.** No document states how long an attachment lives, and `attachment` has no
  archival column. Condition photos are dispute evidence, so "forever" may well be right — but it should be
  a decision, not an omission. Out of scope here; worth a GAP entry.
- **The streaming response and OpenAPI.** `@hono/zod-openapi` validates requests, not responses, so a route
  returning `image/jpeg` should be unproblematic — but this is the same unverified surface as the binary
  request body (see "Request shape"). Confirm on the first run rather than assuming; the fallback is to
  declare the route with a plain `Response` and describe it in prose.

## Documents That Travel With This Change

- `docs/design/ui-ux-guidelines.md` §6.3 line 524 — "Presigned R2 PUT" becomes upload through the Worker
  binding, with the reason. The declined alternative is recorded in §17.
- `docs/engineering/implementation-guidelines.md` §10.10 — amended per decision 2.
- `docs/engineering/data-model.md` §12 — the void trio, the pair `CHECK` and the tenant-scoped subject index.
- `TRACKER.md` and `Plan.md` A7 — GAP-16 closed for expenses only; the three remaining call sites and GAP-17
  recorded as still open. **GAP-16's P4, P5+, P7 and P8 rows in TRACKER.md §2 all need updating, not only
  A7's** — all four currently list GAP-16 as open.

## Verification

1. `npm install`, then create `api/.dev.vars` with `TEST_DATABASE_URL` pointing at a disposable Neon branch
   (finding B).
2. `npm run guard` and `npm run check` — the full gate.
3. Apply `0013` to the disposable branch, then `npm run check:drift -w @fleetsettle/api`, and confirm it
   reports clean and says nothing about `attachment`.
4. `npm test` and `npm run test:integration -w @fleetsettle/api`. **The golden fixtures must still land on
   134,000, 15,000 and 7,500.** Nothing here should move them; if one moves, the change is wrong.
5. Deploy to QA, then on a 360 × 640 viewport: record a fuel fill with two receipt photos, confirm the sheet
   closes immediately and the uploads finish after it is gone, reopen the expense and confirm both thumbnails
   load through the new receipt surface, void one and confirm it disappears and 404s.
6. By hand, not only in the suite: confirm a linked-driver token gets 403 on both upload and read.
7. Feed `PhotoCapture` a file that fails to decode, and confirm the tile shows an error with a working Retry
   rather than spinning forever (finding C).
8. By hand: fire two upload requests with the same client-generated id back to back (or via a short script)
   and confirm exactly one row and one object exist afterward.

## Revision log

**2026-08-09 — a deep review absorbed into the plan above, rather than left as a standalone critique.** A
source-grounded review checked the first draft against the current migrations, API/auth/schema conventions,
`PhotoCapture`/`photo-pipeline`/`ApiClient`, and the shipped UI, and found twelve issues, two of them P0. All
twelve are now folded into the sections above — a plan that disagrees with its own body is worse than an
outdated one. What changed, compacted:

- **Migration renumbered `0012` → `0013`.** `0012` was claimed by `incident_recovery_obligation_fk.sql`
  before this branch started. The branch now inherits five migrations, not four (DR-01).
- **Idempotency compensation rewritten.** The original "unique-violation-means-success" design could still
  orphan the *second* attempt's R2 object on a race between two requests carrying the same id; the corrected
  sequence pre-reads the id before writing anything and only ever deletes an object the current request itself
  just wrote (DR-02).
- **The migration tightens `attachment` while it is still empty.** `voided_reason` (house style, not
  `void_reason`), a `content_type` allowlist `CHECK`, a `kind`/`subject_type` pair `CHECK` covering every
  future-legal combination, a tenant-scoped `(business_id, subject_type, subject_id, uploaded_at DESC)` index,
  and a void-consistency `CHECK` (DR-03).
- **"Legal in the database" and "supported by this branch's API" are now two explicit gates**, not one
  conflated table — every subject type stays storable per the `CHECK`, but only `expense`/`expense_receipt` is
  accepted by the handler this branch ships; everything else is a deliberate `400`, not a silently-passing
  `CHECK` (DR-04).
- **Linked-driver reads resolved as a stated decision, not left inconsistent.** This branch gates reads the
  same way as writes (`dailyOperations`), so a driver token gets `403` on both, never a subject-specific `404`
  — decision 4, because `expense` receipts are not driver-own data (DR-05).
- **A receipt-viewing surface is now in scope**, as commit 7 and decision 7. "Done Means" claimed reopening an
  expense shows its thumbnails, and no screen did that; GAP-16's "closed" claim in TRACKER/Plan now waits for
  commit 7, not commit 6 (DR-06).
- **The upload queue's persistence scope is now a stated decision (6), not an implicit one.** Survives sheet
  close and navigation while the tab stays open; does not survive a reload or app close. The residual risk is
  recorded, and the receipt-viewing surface from DR-06 is also where a failed-after-close upload becomes
  visible and retryable (DR-07).
- **`PhotoCapture`'s fix grew** from a bare `try`/`catch` to also cover object-URL revocation and the
  save-while-encoding race (DR-08).
- **The binary client methods get their own test obligations** — caller-supplied `Content-Type` only,
  `URLSearchParams` for the query params, and a 404-JSON-error-from-a-blob-read test (DR-09).
- **Read responses get explicit headers and a corruption path.** `nosniff`, `Content-Length`, and a
  row-exists-object-missing case that 404s to the caller but logs as an error, since it means decision 1's
  central guarantee has failed somewhere (DR-10).
- **Uploading to an already-voided subject is now rejected** (404, matching cross-tenant), while existing
  attachments on a since-voided subject stay visible — they are evidence of what was claimed (DR-11).
- **A twelfth "Done Means" criterion** covers the fail-after-close-then-retry path directly, rather than
  leaving it provable only by inference from the other bullets (DR-12).

Full source-evidence citations for each finding (file paths, line numbers) are in this file's git history —
the revision immediately before this one carries the original DR-01 through DR-12 write-up in full.

**2026-08-09, third pass — the deep review's own citations validated against source.** This repo's standing
rule is that an external review is checked claim by claim before it is scheduled (TRACKER §6, nine passes so
far), and the pass above absorbed one wholesale without applying that rule to it. Applied now. **Every client
citation held exactly** — `PhotoCapture`'s missing `try`/`catch` (lines 42–43) and its three `void handleFile`
call sites (59, 71, 84), `photo-pipeline.ts:63`'s no-2D-context path, both `NotAvailable` placeholders
(`RecordExpenseSheet.tsx:184`, `FuelFillSheet.tsx:155`), `api.ts:44`'s hardcoded JSON `Content-Type`,
`env.ts:108`'s throwing R2 stub and `fakeKV()` at line 64. So did the schema and migration claims. Four things
the review did not have, all now folded into the body above:

- **Finding F — `ExpenseCostRow.tsx:59` wraps the whole row in a `<button>`.** DR-06 asked for a receipt
  indicator on that row without noticing it cannot be nested inside one. This changes commit 7's shape, and
  the three ways out are now written down with a recommendation.
- **Finding G — `wrangler.jsonc:34`'s top-level R2 binding is still `todo-provision-before-deploy`.** Only the
  QA and production overrides carry real buckets. Harmless locally, and a lie in the file this whole branch is
  about.
- **The branch's base is a real decision, not a formality.** `DEPLOYMENT.md:70` routes `feature/*` into
  `develop`, but `develop` does not have `0008`–`0012` yet — so this branch must come off
  `build/p0-foundation`, *unless* that merges first, in which case the entire five-migration inheritance
  warning evaporates. Finding A now says so and names the preferred order.
- **Two citations made precise rather than left approximate.** IG §10.10 resolves to §10 item 10, line 447 —
  confirmed, because a `doc-change` is scheduled against it. And UI §6.3's "Cap — 200KB hard" sits beside this
  plan's 5 MiB server cap; they govern different things and the plan now says which, so neither gets "fixed"
  into the other later.

One thing found and deliberately **not** acted on here: `DEPLOYMENT.md`'s Progress section (lines 166–172)
still reads as though production has never been deployed — "the only remaining action is merging `develop`
into `main`", "`fleetsettle.com` does not resolve yet" — while `CLAUDE.md` and `TRACKER.md` both record both
environments live since 5 August. `DEPLOYMENT.md` is dated 5 Aug and is simply stale. It is not this branch's
document and fixing it here would be an unrelated change riding in on a plan commit; flagged so the next
person to open that runbook knows before trusting it.
