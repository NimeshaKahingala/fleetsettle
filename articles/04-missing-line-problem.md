# Article 4 brief — The Missing-Line Problem

Status: planning revised 2 September 2026; unresolved examples require later disposition checks

Working title: **The Missing-Line Problem in Agentic Software Development**

Alternative title: **You Cannot Grep for the Line That Was Never Written**

Possible subtitle: *Why fixing one path did not establish the invariant everywhere.*

## Thesis

The project's pattern-based guardrails detect forbidden text that is present. Required-but-absent behaviour needs other evidence: a lock, a backfill, a tenant predicate, an invalidation, an error mapping, or a correction step. Finding the enforcing line in one path does not prove that every sibling path satisfies the same invariant.

## Reader promise

The reader will get a technical framework for reviewing required-but-absent behaviour and converting repeated omissions into enforceable architecture.

## Opening scene

Use PR #118: the rationale correctly explained that the void check needed a row lock. The read, check, and write were present. The lock was not.

The striking detail is that the code read like the correct design. Review-by-plausibility therefore had little friction to catch on.

## Proposed structure

### 1. Presence rules were working

Describe the August baseline's 945-line guard and 24 named rules, if the counts help the story. It targeted server dates, inexact money types, unsafe tenant sources, secret patterns, destructive migrations, raw enum copy, and other known violations. Keep those counts historical rather than claiming the guard is unchanged.

Give these rules credit. They reduced recurrence of known textual mistakes.

### 2. The important omissions

Group examples by missing obligation:

- **Concurrency:** missing row lock or conditional update.
- **Migration:** missing backfill for existing data.
- **Tenancy:** missing `business_id` predicate on a nested write.
- **Client state:** missing query invalidation after a successful mutation.
- **Error contract:** missing translation from a database constraint to a meaningful API response.
- **Correction:** missing reversal of the related financial state.

Use no more than three examples in depth. Prefer PR #118's missing lock, PR #163's follow-up archive-lock correction, and—if later verified and dispositioned—the residual recovery-read example in September S5. PR #158's backfill/wire omission is a backup if the open case is unsuitable for publication.

### 3. Why good prose can make this harder

Introduce “rationale-shaped code” as a working term, not a universal theory. A confident comment can satisfy the reviewer’s mental model before the enforcing line is checked.

### 4. The sibling was still relying on the old assumption

Use [September S5](evidence/2026-09-02-follow-up.md#s5--residual-issues-are-not-completed-fix-stories) carefully. The recovery query's comment says callers take the lock, but the receipt path still captures `paymentId` before its transaction. Its later UPDATE can serialize writes while the earlier snapshot remains stale. Verify the actual interleaving before describing a reproduced failure; do not call it “not a concurrency bug.”

The separately reported generic partial-refund path is a short cross-reference, not a retelling of article 1. An opening-balance writer fixed in PR #176 and an unresolved generic movement writer can coexist. That is why a closed PR is not the same as closing a defect family.

### 5. How to review for absence

- Turn every invariant into an enforcement question: where is it prevented, serialized, or reconciled?
- Review state transitions, not only changed lines.
- Trace the second action and the correction action.
- Use schema constraints for facts the database can own.
- Require migration backfill and rollback-of-behaviour analysis for new derived columns.
- Check API consumers after changing a server-side financial field.
- Use execution-path and impact tooling to identify obligations across layers.
- Check that the navigation index matches the inspected commit; a stale index is not evidence of current coverage.
- Enumerate sibling writers and consumers after a local fix, including alternate correction and migration paths.

### 6. What comes next

- Build an invariant-to-enforcement matrix for high-risk money and tenancy rules.
- Expand guardrails from regex presence to structural checks where feasible.
- Use database-level assertions for invariants that should not depend on every caller remembering a line.
- Keep periodic independent audits because no finite checklist can enumerate every future omission.
- Record which paths were actually inspected or tested instead of claiming whole-family closure from one fix. Confirm with the author which of these practices is already used versus proposed.

## Evidence to use

- Historical guard size and rule count from [EVIDENCE.md](EVIDENCE.md).
- PR #118 for the missing lock beneath the correct rationale.
- PR #163 for the archive-lock follow-up, linked in [September S2](evidence/2026-09-02-follow-up.md#s2--two-reviewers-caught-the-same-error-handling-problem).
- September S5 for current-at-review residual mechanisms and their verification limits; check later code and remediation status before using them.
- PR #136 as a backup for “inside a transaction” not meaning serialized.
- PR #158 for a missing migration backfill and missing wire field.
- PR #128/#129 for a missing incident-detail invalidation, if a client example is needed.

## Avoid

- Claiming regex guards are primitive or useless.
- Presenting “rationale-shaped code” as unique to AI.
- Listing every missing-line example; preserve one coherent argument.
- Publishing code or financial detail unnecessary to the lesson.
- Presenting source-inspected residuals as fixed, runtime-reproduced, or responsible for real-user losses.
- Suggesting a row lock outside the transaction, or a lock taken only after a stale read, protects the whole read-modify-write sequence.

## LinkedIn adaptation

Use the contrast:

> The comment said the row was locked before the check. The code performed the read, the check, and the write. The lock was the only thing missing.

Then explain why these presence-based guards did not establish the required lock and give a short absence-review checklist, ending with a sibling-path question. Do not imply all automated analysis is incapable of detecting missing enforcement.
