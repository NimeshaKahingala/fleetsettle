# FleetSettle article programme

Status: planning revised 2 September 2026; article drafting not started

Evidence: [August baseline and September follow-up](EVIDENCE.md) — separate snapshots

Author position: senior technical lead / software architect writing from direct use

## Purpose

This collection will turn the FleetSettle build into a practical account of agentic software development. It is not a product announcement, an AI success story, or a catalogue of defects. Its subject is how engineering leadership changes when implementation becomes much faster than independent verification.

The central claim is:

> Agentic coding moved the bottleneck from producing code to proving that the code represented the intended business fact.

The writing should show that conclusion being earned through concrete incidents: money writes, concurrency, tenancy, migrations, test design, live QA, review disagreement, and documentation drift.

The September work extends that claim: the review and the proposed repair need independent verification too. A correct diagnosis can lead to an incomplete fix; a comprehensive-looking evaluation can carry stale or unsupported findings.

## Audience

Primary readers:

- senior engineers, technical leads, and software architects using or evaluating coding agents;
- engineering managers deciding how AI-assisted work should be reviewed;
- hands-on developers who have discovered that more generated code also creates more verification work.

Readers do not need to know FleetSettle or its business vocabulary. Each article must explain only the minimum domain context needed for its example.

## Editorial position

The series is deliberately neither promotional nor anti-AI.

- Agentic coding's perceived gains in pace and breadth should be described through the author's confirmed experience, not an unmeasured productivity multiplier.
- The resulting code was often thoughtful, tested, and well documented.
- Serious defects still survived because code, comments, tests, and reviews were sometimes based on the same assumption.
- Release confidence came from independent challenges: source audits, real database tests, live browser work, competing reviewers, and recorded corrections.
- Accepting a finding, choosing its remedy, and deciding when to ship it are separate technical-lead decisions.
- A verified local fix does not establish that the same defect class is closed throughout the system.
- The practical response is to redesign assurance, not to retreat from agentic development.

## Publication model

Publish one flagship article first. The follow-ups are standalone pieces, not mandatory “Part 2/3/4” reading. Cross-link them after publication, but make each one useful on its own.

| Order | Working title | Role in the collection | Brief |
| --- | --- | --- | --- |
| 1 | **Agentic Coding Changed My Bottleneck: From Writing Code to Proving It** | Flagship and statement of position | [01-bottleneck-from-writing-to-proving.md](01-bottleneck-from-writing-to-proving.md) |
| 2 | **A Green Pipeline Is Evidence, Not Proof** | Tests must challenge assumptions and reproduce operational ordering | [Article 3 brief](03-green-pipeline-evidence-not-proof.md) |
| 3 | **AI Code Reviews Still Need an Owner** | Judge findings, remedies, overlap, and release timing | [Article 2 brief](02-four-reviewers-almost-no-overlap.md) |
| 4 | **The Missing-Line Problem** | Required-but-absent behaviour and fixes that miss sibling paths | [Article 4 brief](04-missing-line-problem.md) |
| 5 | **Project Memory Is Not Project Truth** | Preserve investigations without promoting stale claims into authority | [Article 5 brief](05-decisions-not-review-docs.md) |

File numbers are stable planning IDs, not the publication order. Existing filenames are retained so earlier links keep working; the titles of articles 2 and 5 above supersede their original working titles. The older pieces in `temp/` remain historical drafts, not approved copy or evidence.

The flagship should be drafted and published before deciding whether all four follow-ups deserve full Medium articles. A follow-up may instead become a shorter LinkedIn post if its argument does not need long form.

## Ownership of the principal stories

| Story | Full treatment belongs in | Use elsewhere |
| --- | --- | --- |
| PR #176: deposit repair, corrected diagnosis, and a repair that needed review | Article 1 | Article 3 may briefly contrast an empty-database gate with existing data; article 4 may mention sibling coverage |
| Signup-role defect, accessibility absence test, PR #160's scheduler ordering | Article 3 | A short signup example in the flagship, without repeating its mechanics |
| PR #170's overlapping reviews; PR #164's stack context; PR #177's deferral | Article 2 | Brief reference to judgment in the flagship |
| PR #118's missing lock, PR #163's archive-lock follow-up, residual recovery read | Article 4 | No detailed concurrency case in the flagship |
| Deleted reviews, relocation to `docs/evaluations/`, and disputed September audit claims | Article 5 | One sentence about checking the review in the flagship |

One flagship incident should carry the narrative. Do not turn it into summaries of all four follow-ups.

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
- The project's pattern checks target forbidden text; their presence does not establish every required enforcement.
- Reviewer volume is not reviewer diversity.
- Reviewer agreement is useful corroboration, not automatic proof; absence of a finding is not proof that a review ran.
- Live workflow validation finds gaps that file-by-file review cannot see.
- Temporary audits are useful only when their decisions become durable.
- “Production ready” should describe the evidence accumulated, not the confidence of the latest implementation session.

## Boundaries

Do not:

- present internal testing as real-user production usage;
- claim that one reviewer is universally better than another;
- turn a small business’s financial details into spectacle;
- reveal credentials, private identifiers, customer data, or operational secrets;
- use mutable counts without a recorded cohort, code revision, capture date, and any known evidence limitations;
- conflate reported findings, source-inspected mechanisms, reproduced failures, merged fixes, and deployed releases;
- imply that every finding was caused by AI—many are ordinary software failures amplified by speed, volume, and shared context;
- inflate the story with lines-of-code totals or productivity multipliers that cannot be reproduced.

## Drafting workflow

For each article:

1. Capture the author's own recollection and judgments in [AUTHOR-NOTES.md](AUTHOR-NOTES.md). Do not infer them from account-authored PR replies.
2. Select one thesis and no more than three principal incidents, respecting the story ownership above.
3. Confirm technical claims against [EVIDENCE.md](EVIDENCE.md), the incident's pinned revision, and its later disposition. Historical claims and present readiness need separate checks.
4. When the author is ready to start drafting, write from those confirmed notes; use the sources to verify details, not invent memories.
5. Add exact technical evidence after the story works without it.
6. Run the voice review in [VOICE.md](VOICE.md).
7. Run a factual review: business rule, code behaviour, PR link, reproduction status, date, and current production status. Inspect each evaluation claim before reusing it.
8. Run a fairness review: separate observation from interpretation; acknowledge unequal samples, overlapping findings, and unavailable review runs.
9. Produce a Medium version and then a shorter native LinkedIn version; do not make the LinkedIn post a bare link announcement.

## Definition of ready to publish

An article is ready only when:

- its thesis fits in one sentence;
- the opening contains a concrete event rather than general AI commentary;
- every number is dated and sourced, with retrieval limits disclosed;
- personal reactions and changed judgments have been confirmed by the author;
- at least one paragraph explains an author-confirmed mistake, uncertainty, or incomplete judgment; do not manufacture an admission to satisfy the structure;
- the article names a process change that followed the finding;
- the “what next” section contains specific engineering priorities;
- the prose passes the anti-generic checks in `VOICE.md`;
- a reader can understand it without reading another article in the collection;
- private repository links and examples have been checked for public accessibility and disclosure permission; the prose is understandable even if a source remains private.

## Review disposition — 2 September 2026

**Adopted:** retain the flagship plus four optional standalone follow-ups; lead the flagship with PR #176; put the testing article next; capture author notes before drafting; update the evidence boundaries and repair relocated evaluation links.

**Adopted, but changed in form:** replace article 2's near-zero-overlap claim with ownership of review decisions. PR #170 provides direct overlap, and the newer Copilot findings do not fit a narrow diff-only specialty. Broaden article 5 beyond deletion: the archive now preserves evaluations whose validity and disposition must still be checked.

**Not taken:** do not create a sixth article yet; the new themes fit the existing collection. Do not rewrite the historical evaluations to make their original claims appear correct. Do not overwrite August figures with September totals, treat all newly reported issues as proven, or claim real-user production incidents. Detailed current remediation belongs in the project tracking workflow, not in article briefs.

## Current next step

Planning is updated; actual article creation is intentionally deferred. Next, the author can fill in the short notes worksheet or answer its questions conversationally. Once those notes are confirmed and drafting is requested, draft article 1 only. The flagship will establish the voice and technical depth that later pieces inherit.
