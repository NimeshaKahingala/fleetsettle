# Evidence ledger

Ledger updated: 2 September 2026

Status: planning evidence, not a release-readiness certificate

This file preserves the original August baseline. The [September follow-up](evidence/2026-09-02-follow-up.md) records later fixes, review disagreements, and release evidence separately. Do not replace an older observation with a newer total and leave its original date attached.

## Evidence rules

- Separate what a reviewer **reported**, what source inspection **supports**, what a test **reproduced**, and what was **merged/deployed**. A successful deployment does not prove every invariant.
- Use a commit-pinned source link for historical code and a direct comment link for a review. Record the PR base when a stacked diff matters.
- A PR-number cutoff selects a cohort; it does not freeze comments, review submissions, or merge state. Record retrieval time and preserve the relevant output when making a new quantitative claim.
- Re-check current readiness on publication day, but keep historical figures labeled historical. No current database contents or full-suite test totals were newly measured in the September editorial review.
- Repository records do not supply the author's personal voice. Confirm that through [AUTHOR-NOTES.md](AUTHOR-NOTES.md).

## Source priority

When sources disagree:

1. The seven specifications ordered in [docs/README.md](../docs/README.md) own product intent and specified behaviour; being under `docs/` does not make an evaluation a specification.
2. `TRACKER.md` owns what was built, found, closed, deferred, or declined.
3. `Plan.md` owns sequencing but is historical in several sections.
4. Source code and migrations prove current implementation mechanics.
5. GitHub PR comments prove what a reviewer reported at that time.
6. [Evaluation documents](../docs/evaluations/README.md) are dated evidence of the review process, not proof of their own findings or current specification. Check disputed claims against the pinned source and later disposition.

## August 2026 baseline

Repository revision: `47434bfc0cb7d4363893f1b9821bc8dcecd4369f` (30 August 2026).

GitHub cohort: PRs **#1–#163 inclusive**, including comments on those PRs captured in the original review. PR #164 was created at `2026-08-31T00:03:40Z`; that bounds the PR-creation cohort, not the comment-retrieval time.

**Reproducibility limit:** the original raw GitHub responses and exact collection timestamp were not saved. The counts below were retained and rechecked for that cohort during the earlier review, but are not an immutable API snapshot. Later merges and comment edits mean a new query for #1–#163 will not necessarily reproduce them. Before publishing an exact reviewer statistic, preserve a fresh, clearly scoped retrieval or use the linked incidents instead.

At that recorded baseline:

- The cohort contained **163 pull requests**: 152 merged, eight open, and three closed without merge.
- The cohort's PR-creation period runs from 31 July through 30 August 2026 (America/Chicago).
- `scripts/check-forbidden.mjs` is **945 lines** and contains **24 distinct named rule IDs**.
- The seven specification documents contain **115,397 words** in total.
- `CLAUDE.md` described production and QA as deployed, with production for internal testing rather than real users and its data disposable. Do not convert this dated status into a claim about present usage without checking again.
- `TRACKER.md` records the signup-role defect as having survived **386 green integration tests**.

Do not publish a current total test count, repository line count, or productivity multiplier until it is reproduced in the publication pass.

## August reviewer snapshot

These are activity counts, not defect-detection rates or an overlap study. Review submissions, inline findings, acknowledgements, and issue comments are different units. The newer evidence changes the interpretation of reviewer roles, not the recorded August figures.

### Gitar

- 99 inline comments in total.
- 91 finding comments and eight acknowledgements/follow-ups.
- Finding categories: 18 bugs, 35 edge cases, 31 quality findings, five performance findings, and two security findings.
- 24 finding comments were later marked fixed in the discussion.

Representative findings:

- PR #42: archive and void check/write races.
- PR #48: voiding an applied deposit movement restored the deposit but did not restore the obligation.
- PR #118: a `FOR UPDATE` lock promised by the rationale was absent from the implementation.
- PR #136: moving a check into a transaction still did not serialize the race.
- PR #143: a printed driver statement silently omitted every row after the third in each section.

### Copilot

- 52 review submissions and 54 inline comments in the snapshot.
- Strong examples include stale or contradictory prose, accessibility focus gaps, incomplete schema validation, test-isolation issues, and cases where a test did not assert the HTTP status it depended on.
- One particularly useful finding explained that `Object.freeze(new Set())` does not make the set’s contents immutable.

### Claude review

- 11 review submissions and 11 inline comments in the snapshot.
- Representative findings include unmapped database-trigger errors, archive-guard omissions, documentation/migration drift, a distributable-cash formula error, missing migration backfill, missing wire fields, and a mileage-period regression.
- The sample is substantially smaller than Gitar or Copilot and must not be presented as a fair head-to-head comparison.

### SonarCloud

- 161 bot issue comments in the snapshot.
- 23 comments explicitly reported a failed quality gate; ten named new-code duplication as a failed condition.
- Other failures involved security, reliability, and maintainability ratings.
- Current check conclusions can differ from the comment snapshot because stacked branches and reruns move independently. Use date-stamped wording.

## High-value incidents

### The role with no screen

`TRACKER.md` §5 records that test helpers took a role as an argument, so the suite did not exercise the role real signup assigned. The one endpoint test positioned to catch the problem asserted the incorrect role as correct.

Use for:

- article 1 as evidence of the verification bottleneck;
- article 3 as the principal test-independence example.

### The accessibility test listening to nothing

`TRACKER.md` §5 records that headless Chromium computes the accessibility tree lazily. A console-warning test passed against a known violation until the test explicitly enabled the accessibility domain.

Use for article 3. The process lesson is stronger than the browser detail: make an absence test fail deliberately before trusting it.

### A transaction that did not serialize

PR #136’s review showed that moving a check inside a transaction did not close the race. Both concurrent operations could still observe a compatible pre-write state because neither side locked the same row.

Use in depth only for article 4; the flagship may mention concurrency briefly.

### The rationale promised a lock that was absent

PR #118 identified a void operation whose own rationale described the required `FOR UPDATE` lock while the code did not take it.

Use for article 4. Avoid claiming this proves a universal property of AI-generated code; present it as the event that sharpened the author’s review practice.

### The printed statement that looked complete

PR #143 found that a reusable section component rendered only three rows until “Show all” was clicked. The remaining rows did not exist in the print DOM, so a financial statement could appear complete while silently omitting activity.

Reserve as a backup example for article 2. It demonstrates a state/sequence failure rather than a line-level style problem; avoid adding it as another full story to the flagship.

### Live QA exposed successful no-ops

Recovered live-browser findings from 10 August recorded opening balances that changed status to committed without materializing the ledger records reports consumed. The same pass found mobile actions that appeared to complete while discarding the intended state change.

Historical context for article 1, not its new principal incident. The September opening-balance deposit correction in PR #176 is a separate, later failure; do not collapse the two into one event. Describe both as internal QA, not customer production.

### Deleting a secret is not revoking it

PR #133 noted that removing a credential from current source did not remove it from Git history; rotation and deployed-secret updates were still required.

Use only if an article needs an example of a reviewer following operational state beyond the diff. Never publish the credential value.

## Engineering-memory evidence

- On 10 August, commit `efc7c42` deliberately removed 18 temporary root review/planning documents after their active findings had been consolidated.
- Deleted documents included API-contract, backend-query, flow-inventory, static-source, live-browser, QA, and UI/UX reviews.
- Some later reviews were retired after their conclusions were absorbed. Others were retained and moved into `docs/evaluations/` on 2 September. Relocation does not establish that their findings were verified or closed.
- The durable convention became: specifications own intent, `TRACKER.md` owns build truth, `Plan.md` owns sequencing, and declined recommendations are recorded with reasons.
- The repository also records several cases where `Plan.md`, version tables, migration counts, or comments went stale. Documentation is an assurance layer that itself needs verification.

Use for article 5.

## September 2026 follow-up

Read [the dated follow-up](evidence/2026-09-02-follow-up.md) before selecting new material. Its source register covers:

- **S1:** PR #176, the deposit repair and the repair's own defect — flagship incident.
- **S2:** PR #170, Claude/Copilot overlap on `TypeError` mapping — article 2.
- **S3:** PR #160, a test changed to reproduce the scheduler's ordering — article 3.
- **S4:** the September evaluation's disputed claims — article 5.
- **S5:** source-supported residual issues, not closed fixes — article 4 only after publication-time verification.
- **S6:** PR #177, a technically valid concern deferred with recorded reasons — article 2.
- **S7:** PR #171's applied-migration comment and PR #164's stack context — supporting decision examples.
- **S8:** evaluation retention, review availability, and CI evidence limits.

## Claims requiring special care

- Prefer specific deployed and tested properties to an unqualified “production-level” claim. The reviewed repository guidance describes internal testing; evidence of real-user production usage has not been established here.
- “Four reviewers saw the same codebase” is true at repository scale; they did not all review every PR or receive equal samples.
- “Only Gitar found race conditions” and fixed tool-specialty claims must not be used: the September evidence contains Copilot concurrency findings. The original Gitar examples remain useful individually.
- “Almost no overlap” is not supported by a measured overlap study; PR #170 positively demonstrates overlap. That article title has been retired.
- “The agent wrote the tests” may be true for individual sessions but needs direct authorship evidence before being generalized to the entire suite.
- “One engineer built 90,000 lines” and similar output claims are excluded until independently reproduced and scoped.
- Refresh claims about current PR or review status on publication day. Preserve historical counts with their cohort, retrieval limitations, and date rather than silently relabeling them current.

## Publication links

- Repository PRs: `https://github.com/NimeshaKahingala/fleetsettle/pull/<number>`
- Use direct PR links for public evidence.
- Check whether readers can actually access the repository and whether disclosure is approved; do not assume a GitHub URL is public. The article must explain its evidence without requiring private access.
- Prefer paraphrasing review comments; quote only a short phrase when the exact wording matters.
