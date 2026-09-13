# Article 5 brief — Project Memory Is Not Project Truth

Status: planning revised 2 September 2026; not a draft

Working title: **Project Memory Is Not Project Truth**

Possible subtitle: *What deleted reviews, retained evaluations, and stale findings taught me about keeping useful engineering memory.*

The filename stays stable for earlier links. “We Deleted the Review Documents, Not the Decisions” becomes a historical scene, not the whole thesis: the project now also retains evaluations in `docs/evaluations/`.

## Thesis

Preserving an investigation and trusting its claims are different acts. Engineering memory needs provenance, an explicit relationship to the owning specification, and a finding's later disposition. Deletion and archival can both work; neither makes an evaluation's citations or verdicts current.

## Reader promise

The reader will get a practical documentation model for long-running agentic work: retain enough history to understand a decision, without allowing old review prose to become new instructions or unverified evidence.

## Opening scene

Open with a concrete September contradiction: a comprehensive-looking evaluation reports a missing void filter, while the cited function already contains it. Following the actual symbol, rather than the report's stale line number, changes the conclusion. The independent validation is useful evidence, but must itself be checked.

Then return to the earlier deletion of review documents and the later decision to retain others in `docs/evaluations/`. The issue is what authority a document has after its investigation, not whether every audit should be deleted.

## Proposed structure

### 1. Why temporary evaluation documents multiplied

- Different audits examined API contracts, queries, flows, UI, live QA, data models, and later backend logic.
- Each document was useful for a bounded investigation.
- As implementation moved, their counts, line references, priorities, and “open” labels became stale.

### 2. Preserved does not mean authoritative

Compare the end-to-end evaluation with its independent validation and a few pinned source examples from [September S4](evidence/2026-09-02-follow-up.md#s4--the-evaluation-was-another-artifact-to-verify). Discuss unsupported findings, wrong line references, and a comparison ref that did not resolve in the inspected checkout.

Do not repeat “exhaustive” as an independently established coverage property or turn a handful of checked errors into a universal error rate. Even the validating document contains a minor search-count inaccuracy; a second review is another source to inspect, not an authority by title.

### 3. The source hierarchy

Explain the model:

- product documents own intent;
- flows own mechanics;
- the data model owns schema and queries;
- `TRACKER.md` owns current build truth and gap disposition;
- `Plan.md` owns sequencing;
- source and execution evidence establish what the inspected implementation did;
- Git history and the evaluations folder retain investigations; their date, inspected revision, and later disposition determine how they may be reused.

This is change control, not documentation ceremony.

### 4. Record what was not accepted

One of the strongest practices was recording declined recommendations and reasons. Without this, a later reviewer raises the same idea and the project repeats the same argument with less context. Mention PR #177's documented deferral only briefly; article 2 owns that decision story. The question here is where its reasoning and follow-up survive.

### 5. The documentation layer also failed

Be candid:

- migration counts in always-loaded guidance went stale;
- completed waves continued to look open;
- review summaries miscounted findings;
- documentation DDL drifted from migrations;
- comments described mechanisms that no longer existed;
- relocation left paths written relative to the old repository-root location pointing beneath `docs/evaluations/` instead;
- dated review findings were presented as current even when the code already contained the fix.

The lesson is not “write more documentation.” Assign ownership, record which revision an observation describes, check links and claims, and mark superseded material. A link repair restores navigation; it does not validate the finding or refresh its original date.

### 6. The disposition workflow

For every finding:

1. record the inspected commit, review date, and evidence source;
2. verify it independently, distinguishing source inspection from a reproduced failure;
3. classify it as fix, defer, decline, supersede, or not-a-bug;
4. update the owning document if intent changed;
5. add a tracked gap and acceptance evidence if work remains;
6. add a test or guard where recurrence is mechanical;
7. record the declined reasoning and any follow-up conditions;
8. retain the review as dated evidence or retire it once active decisions have durable homes; neither choice makes it the current specification.

### 7. What comes next

- Add automatic checks for document version tables and migration/schema drift.
- Keep revision-pinned evidence and capture times for publication and release decisions; a PR-number range alone does not freeze its comments.
- Reduce narrative status logs before active work becomes hidden inside history.
- Maintain a compact decision index for cross-session agent context.
- Use Git history and an indexed evaluations folder as archives, not competing instruction sets.
- Check whether a resumed agent's code-navigation index and cited source revision match the current work.

Confirm which practices reflect the author's actual workflow and which are next investments through [AUTHOR-NOTES.md](AUTHOR-NOTES.md).

## Evidence to use

- Commit `efc7c42` and the 18 consolidated root documents.
- `TRACKER.md`’s explanation of compacting 31 dated narrative entries.
- `CLAUDE.md`’s correction of stale deployment and migration statements.
- `docs/README.md`’s source-priority and “documents travel together” rules.
- [September S4](evidence/2026-09-02-follow-up.md#s4--the-evaluation-was-another-artifact-to-verify) for the audit/validation/source comparison.
- September S8 for the 14 unchanged relocations plus six newly versioned evaluations/plans, without implying every retained document was verified or closed.
- [Evaluation index](../docs/evaluations/README.md) for navigation and historical-status boundaries.
- PR #177's recorded disposition as a brief cross-reference, not a repeat of article 2.

## Avoid

- Turning the article into a documentation-tool tutorial.
- Claiming deletion is always the right answer.
- Describing temporary reviews as waste.
- Reproducing obsolete findings without their final disposition.
- Describing a retained evaluation as an additional specification merely because it now lives under `docs/`.
- Calling every old finding fabricated, or inferring that a missing branch name proves no historical branch existed.

## LinkedIn adaptation

Lead with one stale finding that changed when checked against the actual code. Explain the difference between retaining an investigation and accepting it as current truth. End with a practical question: if this review is opened next month, can its reader tell what was inspected, what was verified, and what decision still applies? Write the personal framing only after author confirmation.
