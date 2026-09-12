# Article 4 brief — The Missing-Line Problem

Working title: **The Missing-Line Problem in Agentic Software Development**

Alternative title: **You Cannot Grep for the Line That Was Never Written**

## Thesis

Most automated guardrails are naturally good at detecting something forbidden that is present. Many of the most consequential correctness defects are obligations that are absent: a lock, a backfill, a tenant predicate, an invalidation, an error mapping, or a correction step.

## Reader promise

The reader will get a technical framework for reviewing required-but-absent behaviour and converting repeated omissions into enforceable architecture.

## Opening scene

Use PR #118: the rationale correctly explained that the void check needed a row lock. The read, check, and write were present. The lock was not.

The striking detail is that the code read like the correct design. Review-by-plausibility therefore had little friction to catch on.

## Proposed structure

### 1. Presence rules were working

Describe the 945-line guard and its 24 named rules. It caught server dates, inexact money types, unsafe tenant sources, secret patterns, destructive migrations, raw enum copy, and other known violations.

Give these rules credit. They reduced recurrence of known textual mistakes.

### 2. The important omissions

Group examples by missing obligation:

- **Concurrency:** missing row lock or conditional update.
- **Migration:** missing backfill for existing data.
- **Tenancy:** missing `business_id` predicate on a nested write.
- **Client state:** missing query invalidation after a successful mutation.
- **Error contract:** missing translation from a database constraint to a meaningful API response.
- **Correction:** missing reversal of the related financial state.

Use no more than three examples in depth.

### 3. Why good prose can make this harder

Introduce “rationale-shaped code” as a working term, not a universal theory. A confident comment can satisfy the reviewer’s mental model before the enforcing line is checked.

### 4. How to review for absence

- Turn every invariant into an enforcement question: where is it prevented, serialized, or reconciled?
- Review state transitions, not only changed lines.
- Trace the second action and the correction action.
- Use schema constraints for facts the database can own.
- Require migration backfill and rollback-of-behaviour analysis for new derived columns.
- Check API consumers after changing a server-side financial field.
- Use execution-path and impact tooling to identify obligations across layers.

### 5. What comes next

- Build an invariant-to-enforcement matrix for high-risk money and tenancy rules.
- Expand guardrails from regex presence to structural checks where feasible.
- Use database-level assertions for invariants that should not depend on every caller remembering a line.
- Keep periodic independent audits because no finite checklist can enumerate every future omission.

## Evidence to use

- Verified guard size and rule count from `EVIDENCE.md`.
- PR #118 for the missing lock beneath the correct rationale.
- PR #136 for “inside a transaction” not meaning serialized.
- PR #158 for a missing migration backfill and missing wire field.
- PR #128/#129 for a missing incident-detail invalidation, if a client example is needed.

## Avoid

- Claiming regex guards are primitive or useless.
- Presenting “rationale-shaped code” as unique to AI.
- Listing every missing-line example; preserve one coherent argument.
- Publishing code or financial detail unnecessary to the lesson.

## LinkedIn adaptation

Use the contrast:

> The comment said the row was locked before the check. The code performed the read, the check, and the write. The lock was the only thing missing.

Then explain why presence-based guardrails could not find it and give a short absence-review checklist.
