# Article 5 brief — We Deleted the Review Documents, Not the Decisions

Working title: **We Deleted the Review Documents, Not the Decisions**

Possible subtitle: *How I managed engineering memory across a month of agents, audits, corrections, and changing plans.*

## Thesis

Temporary reviews are useful working memory, but they become dangerous when treated as permanent sources of truth. Durable engineering memory requires a deliberate disposition: absorb the decision into the owning specification, convert it into a tracked gap or test, record why it was declined, and then retire the temporary document.

## Reader promise

The reader will get a practical documentation model for long-running agentic projects where context spans many sessions and review artifacts accumulate faster than a person can reread them.

## Opening scene

Open with the apparent contradiction: the repository’s history contains many deleted review documents. They were not discarded because the reviews were unimportant. They were deleted because leaving several active copies of the same conclusion would eventually create several different truths.

## Proposed structure

### 1. Why temporary evaluation documents multiplied

- Different audits examined API contracts, queries, flows, UI, live QA, data models, and later backend logic.
- Each document was useful for a bounded investigation.
- As implementation moved, their counts, line references, priorities, and “open” labels became stale.

### 2. The source hierarchy

Explain the model:

- product documents own intent;
- flows own mechanics;
- the data model owns schema and queries;
- `TRACKER.md` owns current build truth and gap disposition;
- `Plan.md` owns sequencing;
- Git history retains the original investigation.

This is change control, not documentation ceremony.

### 3. Record what was not accepted

One of the strongest practices was recording declined recommendations and reasons. Without this, a later reviewer raises the same idea and the project repeats the same argument with less context.

### 4. The documentation layer also failed

Be candid:

- migration counts in always-loaded guidance went stale;
- completed waves continued to look open;
- review summaries miscounted findings;
- documentation DDL drifted from migrations;
- comments described mechanisms that no longer existed.

The lesson is not “write more documentation.” It is to assign ownership, automate drift checks, and retire superseded artifacts.

### 5. The disposition workflow

For every finding:

1. verify it independently;
2. classify it as fix, defer, decline, supersede, or not-a-bug;
3. update the owning document if intent changed;
4. add a tracked gap and acceptance evidence if work remains;
5. add a test or guard where recurrence is mechanical;
6. record the declined reasoning;
7. retire the temporary review once nothing active depends on it.

### 6. What comes next

- Add automatic checks for document version tables and migration/schema drift.
- Keep dated evidence snapshots for publication and release decisions.
- Reduce narrative status logs before active work becomes hidden inside history.
- Maintain a compact decision index for cross-session agent context.
- Continue using Git history as the archive, not the active instruction set.

## Evidence to use

- Commit `efc7c42` and the 18 consolidated root documents.
- `TRACKER.md`’s explanation of compacting 31 dated narrative entries.
- `CLAUDE.md`’s correction of stale deployment and migration statements.
- `docs/README.md`’s source-priority and “documents travel together” rules.
- One example of a declined recommendation being re-raised and declined again.

## Avoid

- Turning the article into a documentation-tool tutorial.
- Claiming deletion is always the right answer.
- Describing temporary reviews as waste.
- Reproducing obsolete findings without their final disposition.

## LinkedIn adaptation

Lead with:

> During one month of agentic development, I deleted many of the project’s most useful review documents. I kept every decision that mattered.

Then show the disposition chain: review → verify → specification/gap/test → retire. End with the question technical leads should ask: if this document disappeared tomorrow, where would its active decision live?
