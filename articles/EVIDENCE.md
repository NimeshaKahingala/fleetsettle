# Evidence ledger

Snapshot date: 30 August 2026

This file records publication-safe facts and examples. Re-check mutable counts immediately before publishing.

## Source priority

When sources disagree:

1. `docs/` owns product intent and specified behaviour.
2. `TRACKER.md` owns what was built, found, closed, deferred, or declined.
3. `Plan.md` owns sequencing but is historical in several sections.
4. Source code and migrations prove current implementation mechanics.
5. GitHub PR comments prove what a reviewer reported at that time.
6. Temporary evaluation documents are evidence of the review process, not current specification.

## Verified repository facts

As of this snapshot:

- GitHub contains **163 pull requests**: 152 merged, eight open, and three closed without merge.
- The PR period runs from 31 July through 30 August 2026.
- `scripts/check-forbidden.mjs` is **945 lines** and contains **24 distinct named rule IDs**.
- The seven specification documents contain **115,397 words** in total.
- The application is deployed to production and QA infrastructure, but production is still internal testing. It is not yet open to real users, and current data is disposable.
- `TRACKER.md` records the signup-role defect as having survived **386 green integration tests**.

Do not publish a current total test count, repository line count, or productivity multiplier until it is reproduced in the publication pass.

## Reviewer snapshot

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

Use for articles 1 and 4.

### The rationale promised a lock that was absent

PR #118 identified a void operation whose own rationale described the required `FOR UPDATE` lock while the code did not take it.

Use for article 4. Avoid claiming this proves a universal property of AI-generated code; present it as the event that sharpened the author’s review practice.

### The printed statement that looked complete

PR #143 found that a reusable section component rendered only three rows until “Show all” was clicked. The remaining rows did not exist in the print DOM, so a financial statement could appear complete while silently omitting activity.

Use for articles 1 or 2. It demonstrates a state/sequence failure rather than a line-level style problem.

### Live QA exposed successful no-ops

Recovered live-browser findings from 10 August recorded opening balances that changed status to committed without materializing the ledger records reports consumed. The same pass found mobile actions that appeared to complete while discarding the intended state change.

Use for article 1. Describe it as internal QA, not customer production.

### Deleting a secret is not revoking it

PR #133 noted that removing a credential from current source did not remove it from Git history; rotation and deployed-secret updates were still required.

Use only if an article needs an example of a reviewer following operational state beyond the diff. Never publish the credential value.

## Engineering-memory evidence

- On 10 August, commit `efc7c42` deliberately removed 18 temporary root review/planning documents after their active findings had been consolidated.
- Deleted documents included API-contract, backend-query, flow-inventory, static-source, live-browser, QA, and UI/UX reviews.
- Later review documents were similarly retired after their conclusions were absorbed.
- The durable convention became: specifications own intent, `TRACKER.md` owns build truth, `Plan.md` owns sequencing, and declined recommendations are recorded with reasons.
- The repository also records several cases where `Plan.md`, version tables, migration counts, or comments went stale. Documentation is an assurance layer that itself needs verification.

Use for article 5.

## Claims requiring special care

- “Production-level” is acceptable when describing engineering maturity or deployed infrastructure. “Handling real production money” is currently false.
- “Four reviewers saw the same codebase” is true at repository scale; they did not all review every PR or receive equal samples.
- “Only Gitar found race conditions” needs a dated and carefully scoped formulation. Prefer saying that Gitar produced the project’s sustained sequence of concurrency findings during the measured PR period.
- “The agent wrote the tests” may be true for individual sessions but needs direct authorship evidence before being generalized to the entire suite.
- “One engineer built 90,000 lines” and similar output claims are excluded until independently reproduced and scoped.
- Reviewer counts, PR counts, and open/merged status must be refreshed on publication day.

## Publication links

- Repository PRs: `https://github.com/NimeshaKahingala/fleetsettle/pull/<number>`
- Use direct PR links for public evidence.
- Prefer paraphrasing review comments; quote only a short phrase when the exact wording matters.
