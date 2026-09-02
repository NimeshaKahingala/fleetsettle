# FleetSettle article programme

Status: planning  
Evidence snapshot: 30 August 2026  
Author position: senior technical lead / software architect writing from direct use

## Purpose

This collection will turn the FleetSettle build into a practical account of agentic software development. It is not a product announcement, an AI success story, or a catalogue of defects. Its subject is how engineering leadership changes when implementation becomes much faster than independent verification.

The central claim is:

> Agentic coding moved the bottleneck from producing code to proving that the code represented the intended business fact.

The writing should show that conclusion being earned through concrete incidents: money writes, concurrency, tenancy, migrations, test design, live QA, review disagreement, and documentation drift.

## Audience

Primary readers:

- senior engineers, technical leads, and software architects using or evaluating coding agents;
- engineering managers deciding how AI-assisted work should be reviewed;
- hands-on developers who have discovered that more generated code also creates more verification work.

Readers do not need to know FleetSettle or its business vocabulary. Each article must explain only the minimum domain context needed for its example.

## Editorial position

The series is deliberately neither promotional nor anti-AI.

- Agentic coding produced a pace and breadth that would have been difficult to reach alone.
- The resulting code was often thoughtful, tested, and well documented.
- Serious defects still survived because code, comments, tests, and reviews were sometimes based on the same assumption.
- Production confidence came from independent challenges: source audits, real database tests, live browser work, competing reviewers, and recorded corrections.
- The practical response is to redesign assurance, not to retreat from agentic development.

## Publication model

Publish one flagship article first. The follow-ups are standalone pieces, not mandatory “Part 2/3/4” reading. Cross-link them after publication, but make each one useful on its own.

| Order | Working title | Role in the collection | Brief |
| --- | --- | --- | --- |
| 1 | **Agentic Coding Changed My Bottleneck: From Writing Code to Proving It** | Flagship and statement of position | [01-bottleneck-from-writing-to-proving.md](01-bottleneck-from-writing-to-proving.md) |
| 2 | **Four Reviewers, Almost No Overlap** | How to construct a review stack by failure mode | [02-four-reviewers-almost-no-overlap.md](02-four-reviewers-almost-no-overlap.md) |
| 3 | **A Green Pipeline Is Evidence, Not Proof** | Why tests need independence from the implementation | [03-green-pipeline-evidence-not-proof.md](03-green-pipeline-evidence-not-proof.md) |
| 4 | **The Missing-Line Problem** | Why absence-based defects evade pattern guardrails | [04-missing-line-problem.md](04-missing-line-problem.md) |
| 5 | **We Deleted the Review Documents, Not the Decisions** | Engineering memory across agents, reviews, and long-running work | [05-decisions-not-review-docs.md](05-decisions-not-review-docs.md) |

The flagship should be drafted and published before deciding whether all four follow-ups deserve full Medium articles. A follow-up may instead become a shorter LinkedIn post if its argument does not need long form.

## Shared narrative spine

Every article should move through the same four beats without using them as formulaic headings:

1. **A real event.** Begin with something that happened in the repository or live QA.
2. **The initial interpretation.** Explain what looked correct and why a competent reviewer could accept it.
3. **The deeper failure.** Identify the missing fact, assumption, or independence boundary.
4. **The operating change.** State what changed in the engineering process and what should happen next.

The reader should finish with a practice they can apply, not only an interesting anecdote.

## Themes that belong across the collection

- Correct-looking code is not the same as enforced behaviour.
- A test written from the implementation’s assumption may restate the implementation.
- Static rules detect forbidden presence better than required absence.
- Reviewer volume is not reviewer diversity.
- Live workflow validation finds gaps that file-by-file review cannot see.
- Temporary audits are useful only when their decisions become durable.
- “Production ready” should describe the evidence accumulated, not the confidence of the latest implementation session.

## Boundaries

Do not:

- present internal testing as real-user production usage;
- claim that one reviewer is universally better than another;
- turn a small business’s financial details into spectacle;
- reveal credentials, private identifiers, customer data, or operational secrets;
- use mutable counts without a dated snapshot;
- imply that every finding was caused by AI—many are ordinary software failures amplified by speed, volume, and shared context;
- inflate the story with lines-of-code totals or productivity multipliers that cannot be reproduced.

## Drafting workflow

For each article:

1. Select one thesis and no more than three principal incidents.
2. Confirm every count and technical claim against [EVIDENCE.md](EVIDENCE.md) and the current repository.
3. Write the first draft in first person from memory and judgment, using the sources only to verify details.
4. Add exact technical evidence after the story works without it.
5. Run the voice review in [VOICE.md](VOICE.md).
6. Run a factual review: business rule, code behaviour, PR link, date, and current production status.
7. Run a fairness review: separate observed evidence from interpretation and acknowledge uneven reviewer samples.
8. Produce a Medium version and then a shorter native LinkedIn version; do not make the LinkedIn post a bare link announcement.

## Definition of ready to publish

An article is ready only when:

- its thesis fits in one sentence;
- the opening contains a concrete event rather than general AI commentary;
- every number is dated and sourced;
- at least one paragraph explains where the author’s own judgment was wrong or incomplete;
- the article names a process change that followed the finding;
- the “what next” section contains specific engineering priorities;
- the prose passes the anti-generic checks in `VOICE.md`;
- a reader can understand it without reading another article in the collection.

## Current next step

Draft article 1 from its brief. Do not draft the whole collection in parallel. The flagship will establish the voice, level of technical detail, and balance between experience and prescription that the later pieces should inherit.
