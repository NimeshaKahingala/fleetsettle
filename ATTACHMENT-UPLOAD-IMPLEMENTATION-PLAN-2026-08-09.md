# FleetSettle Attachment Upload Implementation Plan

Date: 2026-08-09  
Closes: GAP-16 (listed in `TRACKER.md` against A7, P7 and P8)  
Branch: `feature/image-upload`  
Primary scope: `api/` attachment endpoint and migration `0012`, `web/src` expense receipt capture  
Status: plan re-validated against the working tree; not yet implemented

## Objective

Give `attachment` its first row. The table has existed since migration `0001` and has never been written
to; `PhotoCapture` and `photo-pipeline.ts` are built and tested with **0 real callers**; both R2 buckets are
provisioned, CORS-verified and idle. Nothing in `api/src` has ever touched `env.R2`.

This branch builds the upload endpoint and proves it end to end on the two simplest call sites — expense
receipts. Condition sets and incident photos follow on a second branch, because four of the five call sites
only learn their `subject_id` after the record saves, and the lease wizard's post-save ordering is the risky
part.

## Non-Goals

- Do not build condition photo capture at lease start (F-2.1 step 6) or close (F-2.6 step 5).
- Do not build the side-by-side handover/return comparison — UC §9.1 puts it in phase 3 regardless.
- Do not build incident damage photos (`ReportIncidentSheet`).
- Do not close GAP-17. The pipeline still runs on the main thread with no Web Worker or 3s timeout, and it
  must not look closed by association.
- Do not build Worker-side resize of an oversized original.
- Do not add a hard delete for a wrongly-uploaded photo. A void marks the row; the object stays.

## Decisions

These three were required to be decided and recorded before any code is written (`Plan.md:423`).

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

IG §10.10 currently requires objects be served through presigned expiring URLs. Presigning reads would
reintroduce exactly the credentials decision 1 avoided. Serve reads through the Worker instead, authorised
per request, and amend IG §10.10 to say so.

This serves that rule's stated reason — condition photos are dispute evidence and often show number plates —
better than a presigned URL, because `business_id` is re-checked on every single read and no URL outlives its
authorisation check. Client consequence: an `<img src>` cannot carry a bearer header, so a thumbnail is
fetched as a blob and displayed via `URL.createObjectURL`, the same mechanism `PhotoCapture` already uses for
local previews.

### 3 · Void, never delete

Migration `0012` adds the void trio. A void marks the row; the R2 object stays. Deleting the object while the
row survives is precisely the row/object disagreement decision 1 exists to prevent, and these photos are
dispute evidence. A voided attachment 404s on read and is excluded from every list.

## Findings From Re-Validation

Five things were checked against the working tree rather than assumed, and each changed the plan.

### A · Four undeployed migrations sit in front of this one

`DEPLOYMENT.md` lines 115–116 record both Neon branches as migrated `0001`–`0007`. The working tree contains
`0008`–`0011`. Merging this branch to `main` therefore applies five migrations to production, four of which
this branch did not write:

| Migration                                | What it carries                                     |
| ---------------------------------------- | --------------------------------------------------- |
| `0008_void_respects_closed_period.sql`   | changes void behaviour against a closed period      |
| `0009_obligation_kind_trip_fare.sql`     | a new obligation kind                               |
| `0010_business_member_invite.sql`        | a new table                                         |
| `0011_management_fee_obligation.sql`     | the idempotency key A10a's generator needs          |
| `0012` (this branch)                     | attachment void trio and subject index              |

`CLAUDE.md` states that merging to `main` deploys production automatically and nothing pauses afterwards.
This is not a reason to change the plan, but **the pull request description must say plainly that it carries
four inherited migrations**, so the deploy decision is made with that in view rather than discovered after.

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

Fix it in this branch: wrap in `try`/`finally`, clear the encoding flag, and surface the failure through the
existing `"error"` status so the existing Retry affordance works.

### D · The capability must be keyed on `subjectType`

`api/src/auth/policy.ts` documents `dailyOperations` as "daily cards, trips, expenses, collections", which is
correct for `expense_receipt`. Condition photos belong to `leaseAndTripLifecycle`. All three relevant
capabilities map to `STAFF` today, so a single hardcoded gate would be functionally identical and silently
wrong, invisible until the matrix is tightened. Build the gate as a map from `subjectType` to `Capability`
from day one, even though this branch populates only one row of it.

### E · Corrected references

- `web/src/features/costs/RecordExpenseSheet.tsx:184` — the `NotAvailable` placeholder, inside the
  `Disclosure` at line 161.
- `web/src/features/costs/FuelFillSheet.tsx:155` — the same, inside the `Disclosure` at line 116, whose
  `sectionName` is already "Litres, borne by and photo". The copy already promises this feature.

## Migration `0012_attachment_void_and_subject_index.sql`

Additive only, per the forward-only rule.

- `ADD COLUMN voided_at timestamptz`, `voided_by uuid REFERENCES app_user(id)`, `void_reason text`.
- `CREATE INDEX attachment_subject ON attachment (subject_type, subject_id) WHERE voided_at IS NULL`. No
  index on the subject pair exists today, and it is the lookup every read path performs.
- `CHECK (size_bytes > 0)`.
- `CHECK (subject_type IN (...))` — see the dispatch table below. `kind` has had a `CHECK` since `0001`, but
  `subject_type` is bare `text` with no constraint and no documented value list, while being the key the
  whole polymorphic design turns on. **Adding this `CHECK` is only free because the table is empty**, which
  will never be true again; a `CHECK` added later would need a backfill and a validation pass.

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

Metadata travels as Zod-validated **query params**, exactly like `listExpensesRoute`. The image is the **raw
request body, not declared in the route-def**; the handler reads it with `c.req.arrayBuffer()`.

Declaring the binary body in `createRoute` was avoided deliberately: `@hono/zod-openapi` ^1.5.1 is not
installed, so its handling of a non-`application/json` content type could not be verified, and this design
depends on nothing unverified. Document the body in the route's `description` — that is a documentation
cost, not a correctness one.

Base64 in a JSON body was considered and rejected. It would be fully conventional and need no new client
method, but it inflates every payload by 33%. UI §6.3's budget line states a six-photo condition set is
≈1.2MB; base64 makes it ≈1.6MB on a mobile-first product built for 4G.

### Routes

| Route                                                | Purpose                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `POST /api/attachment?kind=&subjectType=&subjectId=` | Raw image body, `env.R2.put()` plus row insert, returns 201           |
| `GET /api/attachment/{id}`                           | Business-scoped, void-checked, streams the object, `private, no-store` |
| `GET /api/attachment?subjectType=&subjectId=`        | Metadata list for one subject                                        |
| `POST /api/attachment/{id}/void`                     | JSON body carrying the reason, mirroring `voidExpenseRoute`          |

### The subject dispatch table

`subject_type` is the key the whole polymorphic design turns on, and nothing currently defines its legal
values — `data-model.md:1210` carries only the W-30 comment, and the column has no `CHECK`. This table is
therefore the definition, and it lands in three places at once: the `CHECK` in migration `0012`, a shared
const in `packages/shared`, and the handler's dispatch map.

| `subject_type`    | `kind`                                       | Ownership check              | Capability              | This branch |
| ----------------- | -------------------------------------------- | ---------------------------- | ----------------------- | ----------- |
| `expense`         | `expense_receipt`                            | `findExpenseForBusiness`     | `dailyOperations`       | yes         |
| `lease`           | `condition_handover`, `condition_return`     | `findLeaseForBusiness`       | `leaseAndTripLifecycle` | no          |
| `incident`        | `incident`                                   | `findIncidentForBusiness`    | `dailyOperations`       | no          |
| `odometer_reading`| `odometer`                                   | via its lease                | `dailyOperations`       | no          |
| `post_closure_charge` | `ticket`                                 | `findLeaseForBusiness`       | `leaseAndTripLifecycle` | no          |

Two rules the table encodes, both worth stating because neither is enforceable in SQL:

- **`kind` and `subject_type` are not independent.** A `condition_handover` whose subject is an `expense` is
  nonsense the database would happily store. Validate the pair in the schema layer with a Zod `superRefine`,
  not with two independent enums.
- **Only the `expense` row is built here.** Populate the map with one entry and let the others fail the
  `CHECK`; do not stub them as permissive, or the first condition-set branch inherits an open door.

Note that W-30's "the handover/return SET is one artefact" means the condition-set subject is the **lease**,
not the vehicle, and `kind` alone distinguishes handover from return. That is why `lease` appears once with
two kinds rather than twice.

### Idempotency — the Retry button makes this mandatory

The plan previously had no idempotency story. IG §4.3 is explicit that it covers not only cron but
**"retried mutations"**, and that the guarantee "is in the constraints, not in code". `PhotoCapture` ships a
**Retry affordance** wired to `onRetryUpload`, so a retry is a designed-in user action, not a rare edge.

Without a key, the sequence "upload succeeds → response lost on a flaky 4G link → user taps Retry" writes a
second row and a second R2 object. The user sees one photo, the database holds two, and the second is
undiscoverable.

**The client generates the attachment id** (UUIDv7, the same `newId()` convention the Worker uses) and sends
it as a query param. The insert then relies on the existing primary key: a unique violation on `id` is
**treated as success**, and the handler returns the existing row rather than 409. That is the same doctrine
`day_record` and `billing_period` already follow.

The compensating `env.R2.delete()` must not fire on that path — a duplicate insert means the first attempt
already stored the object correctly, so deleting it would destroy a good upload. Guard the compensation to
genuine insert failures only. This is the single easiest thing in this design to get wrong.

### Handler order

Resolve the capability from `subjectType` via the dispatch map (finding D) → `requireCapability` →
`requireBusinessId` → validated query → **re-check that the subject belongs to this business** → domain call.

That subject check is the entire tenancy story. `subject_id` is polymorphic and carries no foreign key, so
nothing in the database prevents a crafted `subjectId` from pointing at another business's expense.

### Domain and storage

`env.R2.put()` then `INSERT`, with a compensating `env.R2.delete()` if the insert throws. This is the
atomicity decision 1 buys; make it explicit rather than incidental.

The `r2_key` is an opaque `crypto.randomUUID()` (v4), unrelated to the row id — not the attachment id, which
is UUIDv7 and therefore time-ordered and partly predictable (`Plan.md:433`).

Validation is a content-type allowlist (`image/jpeg`, `image/png`, `image/webp`) and a 5 MiB cap. The cap
cannot be 200KB, because `web/src/lib/photo-pipeline.ts:63` returns the original un-downscaled `File` when
there is no 2D context. Note in the doc comment that Worker-side resize is not built.

### Error codes

Added to `ERROR_CODES` in `packages/shared/src/errors.ts` and as subclasses in `api/src/errors/app-error.ts`:

- `ATTACHMENT_TOO_LARGE` — 413
- `ATTACHMENT_TYPE_UNSUPPORTED` — 400
- `ATTACHMENT_ALREADY_VOIDED` — 409

`api/src/errors/handler.ts` builds a raw `Response`, so a 413 needs no typed-status accommodation.

### Linking

`subject_type` and `subject_id` are the canonical link. Do **not** also write `expense.attachment_id` — two
link paths become two disagreeing answers, and only the polymorphic pair supports more than one photo. Record
those reverse-pointer columns as redundant in `TRACKER.md`.

## Tests

`api/tests/support/env.ts:108` is `unavailableBinding<R2Bucket>("R2")`, a `Proxy` that throws on any property
access. Replace it with an in-memory fake supporting `put`, `get`, `delete` and `head` over a `Map`,
following `fakeKV()` at line 64 of the same file. The database stays real.

`api/tests/integration/attachment.test.ts` covers the standard matrix — happy path, 401 missing header, 401
verifier throws, 403 capability, 404 subject in another business, 409 double void — plus:

- 413 over the size cap, and 400 on a disallowed content type
- 404 when reading a voided attachment
- 400 on a `kind`/`subjectType` pair that does not match the dispatch table
- a test proving the compensating delete leaves no orphan object when the insert fails
- **idempotency**: the same request sent twice yields one row, one object, and two 2xx responses — and the
  second call must leave the first object intact, which is the failure mode the compensation guard exists to
  prevent
- the **linked-driver class** via `mintLinkedDriver`: 403 on upload, and 404 on every read of a subject that
  is not theirs

## Client Implementation

- `web/src/lib/api.ts` — add `postBinary<T>(path, blob, contentType)` and `getBlob(path)` to `ApiClient`,
  reusing the existing `ApiError` mapping. The current `request()` hardcodes `Content-Type: application/json`
  before spreading `init?.headers`, so an override works, but must be passed deliberately.
- `web/src/components/PhotoCapture.tsx` — fix finding C.
- `web/src/lib/attachmentUploader.ts` (new) — the one genuinely novel piece. Both sheets close on success, so
  the upload must outlive the component. A module-level queue with a subscribe API, deliberately **not** a
  react-query mutation (UI §6.3 line 524 says so explicitly). It exposes exactly what `PhotoCapture` already
  consumes: a status record and `retry(key)`. A thin `usePhotoUpload` hook subscribes for display.

  **The uploader mints the attachment id once, when the photo is queued, and reuses it for every retry of
  that photo.** That is the whole client half of the idempotency guarantee above — a fresh id per attempt
  would defeat it entirely, and it is an easy thing to write by accident.
- `RecordExpenseSheet.tsx` and `FuelFillSheet.tsx` — replace the `NotAvailable` placeholders with
  `<PhotoCapture />` in free-grid mode (`slots` omitted). Photos are held locally; the existing mutation's
  `onSuccess` supplies the expense id, and the blobs are handed to the uploader with `kind: "expense_receipt"`
  and `subjectType: "expense"`. **U-2 holds** — the form still saves on level-1 fields alone, and photos are
  never required.
- `EncodedPhoto.flagged` has no consumer today. Upload it anyway, since it is far under the 5 MiB server cap,
  and show no badge. It is a compression-quality note, not a user-facing failure. Record the decision.

Tests sit beside each file in the house style — Vitest and Testing Library, mocked at the module boundary,
because jsdom has no canvas and `web/src/test/setup.ts` deliberately declines to stub `createImageBitmap` and
`OffscreenCanvas`.

## Implementation Sequence

Six commits, each one reviewable alone and each leaving the gate green. The order is chosen so the
server is provably correct before any screen depends on it.

1. **Schema.** Migration `0012`, the `attachment` `pgTable`, and the `subject_type` const shared between the
   `CHECK` and the dispatch map. Nothing calls it yet.
2. **Contract.** The three error codes in `packages/shared` and their `AppError` subclasses, plus the Zod
   schemas including the `kind`/`subjectType` `superRefine`.
3. **Server.** Queries, domain, route-defs, handlers, routes, and the mount in `index.ts`.
4. **Server tests.** The in-memory R2 fake replacing the throwing stub, then the full matrix. **Commits 1–4
   close GAP-16 on the server and are independently mergeable** even if the client work slips.
5. **`PhotoCapture` fix.** Finding C, on its own, because it is a bug fix in existing shipped code and should
   not be buried inside a feature commit.
6. **Client.** `api.ts` binary methods, `attachmentUploader.ts`, and the two sheets.

Documents travel with the commit that makes them true, not in a batch at the end: UI §6.3 and IG §10.10 with
commit 3, DM §12 with commit 1, TRACKER and Plan with commit 6.

## Done Means

- A fuel fill recorded with two receipt photos closes its sheet immediately, and both photos finish uploading
  after the sheet is gone.
- Reopening that expense shows both thumbnails, fetched as blobs through the Worker — never from a public
  bucket URL, and never with a URL that outlives its authorisation check.
- Tapping Retry on a photo that actually succeeded leaves exactly one row and one object.
- A linked-driver token gets 403 on upload and 404 on every read of a subject that is not theirs.
- A file that fails to decode shows an error with a working Retry, rather than a tile that spins forever.
- `GET /api/attachment/{id}` for another business's attachment returns 404, not 403.
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
- **Migration number collision.** `0012` is free today, but any other branch adding a migration takes it
  first. Re-check the number immediately before opening the pull request.
- **What happens to receipts when their expense is voided?** They currently survive, which seems right —
  a voided expense is still evidence of what was claimed. Stated so it is a choice rather than an accident.

## Documents That Travel With This Change

- `docs/design/ui-ux-guidelines.md` §6.3 line 524 — "Presigned R2 PUT" becomes upload through the Worker
  binding, with the reason. The declined alternative is recorded in §17.
- `docs/engineering/implementation-guidelines.md` §10.10 — amended per decision 2.
- `docs/engineering/data-model.md` §12 — the void trio and the subject index.
- `TRACKER.md` and `Plan.md` A7 — GAP-16 closed for expenses only; the three remaining call sites and GAP-17
  recorded as still open. GAP-16's P7 and P8 rows need updating too, not only A7's.

## Verification

1. `npm install`, then create `api/.dev.vars` with `TEST_DATABASE_URL` pointing at a disposable Neon branch
   (finding B).
2. `npm run guard` and `npm run check` — the full gate.
3. Apply `0012` to the disposable branch, then `npm run check:drift -w @fleetsettle/api`, and confirm it
   reports clean and says nothing about `attachment`.
4. `npm test` and `npm run test:integration -w @fleetsettle/api`. **The golden fixtures must still land on
   134,000, 15,000 and 7,500.** Nothing here should move them; if one moves, the change is wrong.
5. Deploy to QA, then on a 360 × 640 viewport: record a fuel fill with two receipt photos, confirm the sheet
   closes immediately and the uploads finish after it is gone, reopen the expense and confirm both thumbnails
   load, void one and confirm it disappears and 404s.
6. By hand, not only in the suite: confirm a linked-driver token gets 403 on upload.
7. Feed `PhotoCapture` a file that fails to decode, and confirm the tile shows an error with a working Retry
   rather than spinning forever (finding C).
