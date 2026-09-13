# P14 — WhatsApp messaging: decision record and implementation plan

**Written 13 September 2026** against `develop` at `5e39edb`, after two independent static validation passes against the repository and against Meta's and Cloudflare's own documentation. **No code or database changed.**

**This document does not authorise anything by itself** (see this folder's [README](README.md)). The rules it builds to were absorbed into the specification in the same change — `use-cases.md` v1.2.20, `user-flows.md` v1.1.22, `data-model.md` v1.1.21, `tech-stack.md` v1.6, `implementation-guidelines.md` v1.10 — and where this document and those disagree, those are right. Build state lives in `TRACKER.md`; sequencing in `Plan.md` Wave 10. What this document keeps is the reasoning, the order, and what was not taken.

---

## 1. The decision

P14 was deferred entire on 17 August 2026, deliberately without firing any Meta approvals, because UC §8 lists W-14 (fully automatic messaging) as a decision to attack and production then held no real data to attack it with. The question was put back to the owner on 12–13 September, one question at a time:

| Question | Answer | What it settled |
|---|---|---|
| Is there real use? | Yes — one active business, a known tenant; its data can be migrated if the schema requires it | The evidence the deferral waited for exists |
| Can a number be dedicated that is not already on WhatsApp? | Yes | The Cloud API path is open |
| Meta business verification? | Deferred | Unverified limits are far above this volume (§9) |
| Will customers and drivers opt in? | Most or all | Automation reaches people, not a partial channel |
| Is delivered/read status wanted? | **Yes** | **Rules out assisted sending**, which cannot report delivery |

**Outcome: automatic sending (W-14 as specified) over the WhatsApp Cloud API, verification deferred, English and Sinhala.** Sinhala was never an open question — it closed on 31 July 2026 (UC §8); an unset `business_settings.second_language` does not reopen it.

## 2. What already exists — verified at `5e39edb`

| Exists | Where |
|---|---|
| `message`, `message_template`, `message_event`, `messaging_config` | `0001`, created with no code behind them |
| INV-11's `one_message_per_trigger` | `0001` — a standalone **unique index**, not a named constraint |
| INV-13's append-only rules on `message_event` | `0001` |
| Global kill switch, send window, second language | `business_settings.messaging_kill_switch`, `send_window_start`/`send_window_end`, `second_language` — `0001` |
| Recipient language, opt-in, verification timestamp | `driver` and `customer` — `0001` |
| `payment_correction.receipt_message_id` | `0001`; **no writer** — `insertPaymentCorrection` never sets it |
| `MESSAGE_QUEUE` producer | QA and production; the local binding reads `todo-provision-before-deploy`; **no consumer anywhere** |
| `businessToday(timeZone)` | `packages/shared/src/dates.ts` |

| Does not exist | Consequence |
|---|---|
| Any messaging domain code, route, handler or screen | Everything below is new |
| Drizzle models for the four messaging tables | W2 |
| `event.cron` routing in `scheduled()` | A second cron expression would run every existing job on it (W5) |
| A queue consumer, a webhook, an inbox | W6, W7 |
| Any endpoint that writes opt-in, language, pauses or messaging configuration — and any driver-edit endpoint at all | W8 |

**Found in `0001`:** `messaging_config`'s `UNIQUE (business_id, scope_type, scope_id, message_type)` has never bound at business scope, because `scope_id` is NULL there (DM D-20). **`message` is correctly absent from `assert_period_open()`** and must stay so. The archive guard (`0031`, `0037`) deliberately excludes `message` as correspondence that "wants a different answer"; D3 below gives it.

## 3. What "once" can promise

The first draft of this plan leaned on INV-11 alone. A unique index guarantees one message **row**. Cloudflare Queues delivers at least once, and a send whose response is lost looks exactly like a failed one, so one row can become two deliveries. The guarantee is therefore three layers (DM §11.1):

| Layer | Mechanism |
|---|---|
| Intent | `one_message_per_trigger` — one row per `(trigger, subject, stage)` |
| Claim | One transaction: `message` `queued` → `sending`, insert the attempt, write the `claimed` event; a partial unique index allows one in-flight attempt per message |
| Outcome | Each attempt has its own provider id and immutable snapshot; an abandoned or ambiguous attempt becomes `unknown` and is **never retried automatically** |

**Stated precisely (W-72, INV-46): the system prevents automatic duplicate sends and surfaces uncertainty. It cannot promise exactly one delivery once a person authorises a resend** — the earlier attempt may still arrive, and the resend screen says so.

## 4. Decisions gating code

| | Decision | Resolution | Owning record |
|---|---|---|---|
| D1 | A recurring summary under INV-11 | Stage carries its period — `summary:weekly:<period end>`, `summary:monthly:<YYYY-MM>`; subject the driver; a weekly period ends on the driver's settlement weekday when he settles weekly, otherwise on Sunday; business timezone | FL F-10.3, DM D-21 |
| D2 | "No number on file" cannot be logged | `recipient_number_at_time` nullable only when suppressed; every stop carries a non-empty reason | DM §11.1 |
| D3 | Archived recipient | Suppressed at send by the consumer's final check, reason `party_archived`; never blocks the money write | FL INV-47 |
| D4 | Per-person kill switch | `messaging_paused_at` on the party, outside the precedence chain | DM §11.1 |
| D5 | Second language | Already closed — Sinhala (`si_LK`) | UC §8 |
| D6 | §6.10 needs a first delivery without an amount | An amount-free verification message | UC W-71 |
| D7 | Recording attempts | `message_attempt`, one row per try, immutable snapshot, own provider id | DM D-18 |
| D8 | Ambiguous outcome | `unknown`, surfaced; a resend is a person's decision | UC W-72, FL INV-46 |
| D9 | Verification lifecycle | Hold, release into the ordinary checks, expire with a reason; bound to the exact number | UC W-71, FL INV-47, INV-48 |
| D10 | Re-arming after a reversal | A new round whose stage suffix is the correction's id; the old round's unsent reminders stopped in the same transaction | UC W-73, FL INV-49 |

## 5. The mechanics, in one place

Summarised here for sequencing; the rules are in FL F-10.3 and DM §11.1 and are not restated in full.

- **Enqueue inside the money transaction** with `INSERT … ON CONFLICT (business_id, trigger_type, subject_type, subject_id, stage) DO NOTHING`. Never a caught violation (the transaction is already aborted) and never `ON CONFLICT ON CONSTRAINT` (the index is not a constraint). No network call inside the transaction (IG §4.3).
- **Confirmations publish on commit** — UC-80, UC-82, UC-83, UC-84 and verification — via `waitUntil`. If the publish fails the row is still `queued` and the sweep publishes it. The row is the mechanism and the publish is the optimisation — the shape `releaseAllExpiredHolds` already has.
- **The sweep** (`dispatch-messages`, every 15 minutes) publishes due rows, releases verification holds whose recipient is verified, expires stale holds, marks abandoned claims `unknown`, and enqueues settlement summaries whose period has ended.
- **The consumer re-checks everything immediately before creating an attempt** (INV-47): scheduled time, the window unless a confirmation, opt-in, both pauses, archive, verification of the exact destination for a money message, and the trigger's own condition. A released hold is not an exemption.
- **Verification (W-71).** Opt-in with an unverified current number queues the verification message (stage `number:<E.164>`). A money message for that recipient is written `deferred_verification`. A delivery report for an attempt whose destination equals the current number sets `verified_number` and `number_verified_at` and releases the holds to `queued`; the sweep releases any hold the report raced past. Unreleased after the hold window (7 days proposed) → `expired`, surfaced.
- **Reversal (W-73).** In `correctPayment`'s own transaction: stop unsent reminders for the affected obligations as `superseded`; for a `back_to_arrears` correction enqueue the new round with `#c:<correction id>`; find the payment's receipt message (its latest attempt that was sent, delivered, read or unknown) and set `payment_correction.receipt_message_id`; enqueue the receipt correction (subject the correction, stage `once`). `absorbed_loss` re-arms nothing.
- **Webhook.** `GET` answers the subscription challenge with `WHATSAPP_VERIFY_TOKEN`; `POST` verifies `X-Hub-Signature-256` with `WHATSAPP_APP_SECRET` over the raw body, is exempt from `RATE_LIMITER`, and writes to `message_webhook_inbox` under a dedup key before anything else. A report whose provider id is not yet recorded waits there and is applied when the consumer records the id. Outcomes only move forward; the business is resolved through the attempt, never from the payload.
- **Inbound (W-45).** An inbound message gets one service-message auto-reply per sender per 24 hours; only the sender and time are kept.
- **Condition photos (UC-80, W-38).** After the lease confirmation, one image-header template message per photo, stage `photo:<attachment id>`; each photo is uploaded from R2 to Meta's media endpoint, never linked into the app.
- **Summaries.** `messaging_config.summary_cadence` per driver; the stage makes a second enqueue for the same period a no-op.

## 6. Build order — tests ship inside each PR

| | Work | Tests in the same PR | Waits on |
|---|---|---|---|
| W1 | Migration `0041` (DM §11.1), including the empty-table pre-check and the kill switch set on | Applies over `develop`'s schema; refuses over a non-empty `message`; D-20's uniqueness now binds; the attempt guard refuses snapshot edits and backward outcomes | — |
| W2 | Drizzle models and shared zod schemas for every messaging table | Typecheck; schema-drift assertion | W1 |
| W3 | `resolveMessagingConfig`, `enqueueMessage`, `renderTemplate`, the stage builder | Precedence and opt-in supremacy; both pauses; enqueue twice → one row; enqueue inside a transaction that then writes money → both commit | W2 |
| W4 | Enqueue at every trigger (`lease.ts`, `payment.ts`, `lease-closure.ts`, `offset.ts`, `deposit.ts`, `payment-correction.ts`), post-commit publish, W-73 | Each trigger writes its row with its money write and never without it; a failed publish leaves a sweepable row; A-40; `receipt_message_id` populated | W3 |
| W5 | `event.cron` routing, the sweep, summary cadence | Existing daily jobs do not run on the 15-minute expression; the sweep marks abandoned claims `unknown`; A-38 | W3 — **its own PR, because it changes existing jobs** |
| W6 | Consumer, claim, INV-47, `Transport`, a logging transport, dead-letter queue | A-34, A-35, A-36, A-37; a redelivered job → no second attempt; archived, paused, withdrawn and unverified → suppressed or held, with a reason | W4, W5 |
| W7 | Cloud API transport, webhook, inbox, auto-reply, photo upload | Bad signature → nothing written; A-39; A-41; duplicate and out-of-order reports; the rate limiter does not apply | W6, **template approval** |
| W8 | Endpoints — log, failures, per-record history, resend, other channel, handled; configuration, opt-in and withdrawal, language, pauses, start verification, driver edit | W-49 linked-driver isolation on every read; cross-tenant 404; missing capability 403; a resend creates a second attempt and says the first may arrive | W3 |
| W9 | Screens, after a `ui-ux-guidelines.md` change: Settings → Messaging, More → Message log, home failures (`failed`, `unknown`, `expired`), inline history | 360 × 640; U-2 level-1 save; reserved vocabulary; colour never alone | W8 |
| W10 | Integrated QA on `qa.fleetsettle.com`; `docs/qa/scenarios/suites/09-notifications/` rewritten against the real screens; TRACKER and Plan reconciled | EC-09-004 live; the kill switch turned off deliberately, on QA first | all |

## 7. Track M — Meta, starts now

1. A clean SIM — never active on WhatsApp, not VoIP.
2. WhatsApp Business Account, display name, the Cloud API app.
3. **Template wording in English and Sinhala**, strictly utility: verification, lease confirmation, condition photo, rent reminder (per stage where the wording differs), receipt, receipt correction, closing figures, driver paid, settlement summary. **The count is fixed here, not before.**
4. Submission; approved names, language codes, variable counts and bodies recorded into `message_template`.
5. App secret, webhook subscription and verify token, the W-45 auto-reply wording.
6. `wrangler secret put --env <name>` for `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`.

Only W7 waits on this track. W1–W6 and W8–W9 are built and tested against the logging transport — W-21's promise, kept.

## 8. Live-tenant safety

`messaging_kill_switch` defaults to *messaging allowed*. Nothing would send today only because no one has `opted_in_at` — luck, not design. **`0041` sets the switch on for the existing business**, and it is turned off deliberately after W10's pass. Merging `develop` into `main` deploys production with no pause, so W7 reaches `main` only after that pass.

## 9. Facts of record

| Fact | Status |
|---|---|
| An unverified portfolio may message **250 unique recipient numbers per rolling 24 hours outside a customer-service window, shared across the portfolio** | Confirmed — Meta, messaging limits |
| An unverified WhatsApp Business Account holds **250 templates, each language variant counted separately** (6,000 once verified with an approved display name) | Confirmed — Meta, message templates |
| Delivery and read webhooks do not depend on business verification | Confirmed |
| Sinhala is supported as `si_LK` | Confirmed by validation pass 1 — Meta, supported languages |
| Sri Lanka moves to a standalone utility rate card on **1 October 2026**, at lower rates | Confirmed — Meta, pricing |
| A Sri Lankan utility message costs about US$0.003 | **Not independently confirmed** — a third-party figure |
| Utility templates inside an open customer-service window stay free | Confirmed on Meta's pricing page, contradicting some third-party summaries. Irrelevant here (W-45) |
| Meta may send a webhook notification more than once and retries for up to seven days | Confirmed by validation pass 1 — Meta, webhooks |
| Cloudflare Queues delivers at least once | Confirmed by validation pass 1 — Cloudflare, delivery guarantees |
| `0041` is free on `develop` and `main` | Confirmed at `5e39edb` |

## 10. What was taken, what was fixed differently, what was declined

### Adopted as recommended

| From | Recommendation |
|---|---|
| Validation 1 | Claim atomically, keep durable attempt history, recover crashes, never blindly retry an ambiguous timeout; re-check every condition in the consumer |
| Validation 1 | A verification lifecycle, not just a template: hold, release, failure, and binding to the exact number |
| Validation 1 | Payment corrections and reminder re-arming belong to W4; correction wording belongs in the inventory |
| Validation 1 | A prompt post-commit publish for confirmations, with the row kept for recovery |
| Validation 1 | Writes as well as reads in W8, and a summary cadence that actually schedules |
| Validation 1 | Provider ids per attempt; duplicate, out-of-order and early callbacks; immutable snapshots including configuration provenance |
| Validation 1 | Webhook subscription and signature secret, inbound handling for W-45, a specified path for condition photos |
| Validation 1 | Tests inside each PR; W10 reserved for integrated QA |
| Validation 2 | `ON CONFLICT` by index inference, since `one_message_per_trigger` is an index |
| Validation 2 | `receipt_message_id` belongs to `payment_correction`, and W4 must populate it |
| Validation 2 | Deterministic reversal rounds, with the superseded round stopped in the same transaction |
| Validation 2 | A stale claim becomes `unknown`, never `queued`; the guarantee stated as "no automatic duplicate" |
| Validation 2 | Scheduling, window and exact-destination verification checked in the consumer; a released hold passes the same checks; a report racing the held row is recovered |
| Validation 2 | `user-flows.md` and `data-model.md` in the same documentation change, including how `message_event` names the new transitions |

### Adopted, but fixed differently

| Recommendation | What was done instead, and why |
|---|---|
| Validation 2: derive the reversal round from the correction's id **or** allocate it once transactionally | Derived. A counter needs its own row and lock to allocate safely; the correction's id already exists, is unique, and makes the round reproducible from the correction alone |
| Validation 1: record that a correction is owed, as UC-93 already said ("the closing or next message says so") | Recorded **and** a receipt-correction message sent at once (W-73). The next message may be a month away; a written receipt for money that never arrived should not stand uncorrected that long |

### Declined

| Declined | Why |
|---|---|
| Assisted, tap-to-send messaging | Cannot report delivery, so the owner's delivered/read requirement and §6.10's verification rule both fail |
| Automating only the rent reminder and settlement summary | Saves approvals; gives no delivery status on the other messages |
| Widening `message_event` to carry each attempt's provider id and snapshot | A log row per status change would repeat the snapshot, and its immutability would rest on convention rather than a trigger (DM D-18) |
| A write-time archive block through the archive guard | A message is correspondence; blocking its insert would block the money write carrying it. Checked at send instead |
| Condition photos as one combined image or PDF header | Needs a renderer this runtime does not have (GAP-136); one template per photo costs cents and keeps a delivery record per photo |
| Keeping the kill switch in KV, as TS §8's `KV` row implied | `business_settings.messaging_kill_switch` has existed since `0001`; one authority, in Postgres, read by the consumer. TS §8 corrected |

**No recommendation from either validation pass was rejected.**

### This plan's own drafts were wrong, and the corrections are kept

| Draft said | Was |
|---|---|
| Twelve Meta approvals | Never twelve — a verification message, a receipt correction and condition photos on top of the six |
| Meta's unverified template limit is undocumented | 250 per account, language variants counted individually |
| 250 business-initiated conversations per 24 hours | 250 unique recipient numbers outside the service window, portfolio-wide |
| The kill switch and send window need a migration | Both in `business_settings` since `0001`; only the per-person pause was missing |
| Next migration `0040`; UC-85 blocked by GAP-135 | Read from a branch 15 commits behind `develop`: `0040` is taken and GAP-135 closed 12 Sept |
| The second language is an open decision | Sinhala, closed 31 Jul 2026 |
| `ON CONFLICT ON CONSTRAINT one_message_per_trigger` | Fails — it is an index; use index inference |
| `obligation.receipt_message_id` | The column is on `payment_correction` |
| A single mutable `message.provider_message_id` | A late report for a replaced attempt would be unattributable (D-18) |
| Catching a unique violation counts as success inside the money transaction | The transaction is already aborted; the money write goes with it |
| A unique index guarantees one send | It guarantees one row (INV-46) |

## 11. Left open on purpose

| Item | Settled when |
|---|---|
| The final template inventory and wording | Track M step 3 |
| The verification hold window (7 days proposed) | W3, as a `business_settings` value, with the owner |
| Whether a second business would send under its own number | A second business asks to (DM D-21) |
| Retention of `message_webhook_inbox` | Alongside D-4's partitioning answer for `message_event` |

Sources: [Meta — messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits) · [Meta — message templates](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates) · [Meta — pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) · [Meta — supported languages](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/supported-languages) · [Meta — webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks) · [Cloudflare — Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
