---
name: doc-change
description: Change one of the FleetSettle specification documents, or absorb a review into them. Use when editing anything in docs/ — it carries the ownership hierarchy, the traceability that must stay closed, and the convention of recording what was declined.
---

# Changing a document

## First: which document owns it?

| Change | Starts in |
|---|---|
| What the business does, or why | `docs/product/use-cases.md` |
| Exact behaviour, a state machine, an invariant | `docs/product/user-flows.md` |
| A table, constraint, query | `docs/engineering/data-model.md` |
| A stack choice | `docs/engineering/tech-stack.md` |
| How to build on the stack | `docs/engineering/implementation-guidelines.md` |
| A screen, component, token | `docs/design/ui-ux-guidelines.md` |
| The mark, lockups, voice | `docs/design/brand-guidelines.md` |

**Ownership runs downhill.** A change that starts in the flows document and contradicts the use cases is a change that has skipped its own justification — go back up. `docs/README.md` holds the full ordering.

## The rules

1. **Documents travel together.** A change to intent that alters mechanics is one change, not two. Shipping half leaves the pair lying about each other.
2. **Traceability closes both directions.** Every use case has a flow, every flow a use case, every invariant an enforcement. If you add one, add its counterpart and update FL §8 / DM §16.
3. **Give it an ID.** `W-n` decisions and `U-n` rules in the use cases, `INV-n` and `F-n` in the flows, `D-n` in the data model, `M-n` in the UI guidelines, `B-n` in brand. Mark anything you decided rather than the user with ⚑.
4. **Prefix cross-document references** — `UC §`, `FL §`, `DM §`, `TS §`, `IG §`, `UI §`, `BR §`. A bare `§` means the current document. Three documents have a §6 about different things.
5. **Bump the Status line and the date**, and update the status table in `docs/README.md`.

## Absorbing a review

The repository has a settled convention and it is the most valuable one here:

**Record what you did *not* take, and why.** Every document that has absorbed a review has such a section — UC §8, FL §14, UI §17, IG §1. Without it the next reviewer raises the same point and the same argument happens twice.

Structure it in three groups:

- **Adopted as recommended** — a table is enough.
- **Adopted, but fixed differently** — state the recommended fix, why it was wrong, and what was done instead. This is the highest-value section; a review that is right about a problem is often wrong about the remedy.
- **Rejected** — with the reasoning, stated well enough that a reasonable person could still disagree.

And if the review is right about a **measured value**, say so plainly and fix it. One published contrast figure was wrong because it had been assumed rather than measured, in a table whose entire value was that the numbers were measured. That is worth recording, not glossing.

## Never

- **Change a golden-fixture figure.** UC §7's walkthroughs reconcile to **134,000**, **15,000** and **7,500**; FL §9.1 encodes them as the regression suite. If a change moves one, the change is wrong until proven otherwise.
- **Restate another document's rule in full.** Reference it. Two copies of a rule become two different rules.
- **Silently reopen a settled decision.** IG §1 lists the imported guidance that was overruled precisely so it is not restored by copying from an older draft.
