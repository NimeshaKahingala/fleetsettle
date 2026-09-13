# Article 2 brief — AI Code Reviews Still Need an Owner

Status: planning revised 2 September 2026; not a draft

Working title: **AI Code Reviews Still Need an Owner**

Possible subtitle: *What overlapping findings, misleading scope complaints, and a deferred fix taught me about owning the review decision.*

The filename remains stable for earlier links. “Four Reviewers, Almost No Overlap” is retired: no overall overlap rate was measured, and PR #170 provides a direct example of overlap.

## Thesis

Multiple reviewers increase the available evidence, but do not decide whether a finding is real, whether the proposed fix is safe, or whether it belongs in the current release. Those remain separate engineering judgments, even when reviewers agree.

## Reader promise

The reader will get a practical way to assess and dispose of review findings, including overlap, false positives, branch context, and valid recommendations deliberately deferred. This is a technical-lead account, not a vendor leaderboard.

## Opening scene

Open with PR #170: two reviewers independently objected to the same `TypeError → 400` mapping. The implementation's justification cited a search for explicit throws, but omitted errors raised by the JavaScript engine. The finding mattered because the mapping also changed diagnostics and exposed internal error text—not just an HTTP status.

Agreement was useful. The work still included checking the mechanism and the narrower `WireFormatError` remedy. Attribute the author's personal response only after confirming it in [AUTHOR-NOTES.md](AUTHOR-NOTES.md).

## Proposed structure

### 1. Why several review surfaces were useful

Briefly establish the correctness sensitivity and the value of static analysis alongside PR review. State the unequal samples and changing reviewer availability. Keep Sonar's duplication findings as legitimate quality feedback, without equating duplication counts with money-correctness coverage.

### 2. Agreement did not remove the need to verify

Use PR #170 in depth. Distinguish explicit throw sites from runtime behaviour, then explain why a dedicated error type was a narrower remedy. This is one demonstrated overlap, not an estimate of the whole review stack's overlap rate.

The older Gitar state-transition examples and newer Copilot concurrency examples should prevent fixed tool-specialty labels. Coverage roles are questions to ask of a review, not permanent attributes of a brand.

### 3. A review can be wrong about scope and right about code

Use PR #164: the response explains the stacked base rather than splitting an already scoped change, while accepting the archive-lock finding and placing its fix in PR #163. Inspect each part of a comment independently; neither wholesale acceptance nor wholesale dismissal follows from one error.

Discuss the cost honestly:

- stacked branches repeated findings;
- some findings were wrong or low value;
- resolving comments consumed senior attention;
- unequal samples prevent a fair ranking;
- a working indicator or plan-limit notice is not evidence of a completed review.

### 4. A valid diagnosis need not become a release-time patch

Use PR #177's legacy write-off concern. The response accepts the calculation, records a database reachability check, and defers a money-void change from the release. Explain what was accepted, why immediate implementation was declined, and what remained unresolved. Do not claim the follow-up has shipped or that the reported database state remains current.

### 5. The operating model to take forward

Separate confirmed practices from proposals. For each finding:

- establish the actual revision and diff base;
- reproduce the mechanism or label the evidence as source inspection;
- assess the remedy and its sibling paths separately from the diagnosis;
- decide fix, defer, decline, or supersede with reasons and an owner for remaining work;
- add regression evidence or an enforceable rule when appropriate.

### 6. What comes next

- Track findings by defect class rather than reviewer brand.
- Measure repeated and false-positive findings.
- Convert repeated valid findings into tests, constraints, or local guard rules.
- Give reviewers invariant and business context, while still keeping at least one independent challenge outside the implementation session.
- Record whether the reviewer actually ran and which revision it saw. Do not use comment volume as the denominator for a detection-rate claim.

## Evidence to use

- [EVIDENCE.md](EVIDENCE.md) for historical counts and their limitations.
- [September S2](evidence/2026-09-02-follow-up.md#s2--two-reviewers-caught-the-same-error-handling-problem), S6, and S7: PRs #170, #177, and #164 are the three principal incidents.
- September S8 for review availability and CI surface distinctions.
- PR #171's applied-migration comment as an alternative short example, not a fourth full story.

## Avoid

- “Reviewer X won.”
- Treating all comments as equally severe.
- Claiming every reviewer saw every PR.
- Claiming near-zero overlap or assigning each tool a fixed reasoning specialty.
- Treating a deferred change as a disproven finding or a completed fix.
- Presenting historical database checks from a PR response as measurements performed for this article.
- Treating a green bot summary, an unavailable review, and a successful deployment as interchangeable signals.

## LinkedIn adaptation

Tell the PR #170 overlap story or the PR #177 deferral story, not both. End with the author's confirmed distinction between accepting a diagnosis, accepting a remedy, and accepting release timing. Avoid a four-brand scorecard.
