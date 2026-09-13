# Article 1 brief — Agentic Coding Changed My Bottleneck

Status: planning revised 2 September 2026; awaiting author notes, not a draft

Working title: **Agentic Coding Changed My Bottleneck: From Writing Code to Proving It**

Possible subtitle: *What a month of building—and then reviewing the reviews—changed in my work as a technical lead and software architect.*

Format: flagship Medium article, adapted into a shorter native LinkedIn post.

## Thesis

The author's observed implementation gains moved the bottleneck into deciding what was true and proving that writes preserved it under real sequences. That verification includes the reviewer's diagnosis and the proposed repair, not just the initial code. Confirm the author's experience of speed before making the first-person claim; do not imply a measured multiplier.

## Reader promise

The reader will get a practical operating model for leading agentic development on correctness-sensitive software—not a tool comparison or a list of prompts.

## Personal position

Proposed position to confirm in [AUTHOR-NOTES.md](AUTHOR-NOTES.md): the author would use agentic coding again, but would evaluate implementation speed alongside the cost of verification. Explore whether senior attention moved toward invariants, evidence, and review decisions. These are interview prompts until the author confirms them, not invented recollections.

## Opening scene

Open with PR #176: a repair for deposits still marked held after refunding. The initial explanation attributed the rows to test-data insertion; checking the posting history pointed to the application's ordinary opening-balance correction path. Fixing that path then needed further review because refunding the original amount could leave a later top-up still held.

Explain the business consequence first: a status change could remove real held funds from a report without making the funds disappear. The verification work was determining which story about the data was true and whether the repair preserved that truth.

Avoid opening with PR counts. Introduce the scale after the reader understands the problem.

## Proposed structure

### 1. What accelerated

- Specification-to-code work, migrations, endpoints, screens, and tests could move in one continuous loop.
- The agent carried a large rule set and navigated a broad codebase effectively.
- Small, scoped implementation work became cheap enough that several alternatives could be explored before committing.

The tone here should be generous and specific. This is why the author is continuing with agentic development.

### 2. The bottleneck moved

Carry the main story through the [September evidence register, S1](evidence/2026-09-02-follow-up.md#s1--the-deposit-repair-needed-its-own-review): initial diagnosis, evidence of the producer, repair of existing data plus the writer, the top-up case, and the conditional repair/refusal with regression coverage.

Use at most two short supporting references: the signup role behind 386 historical green integration tests, and the later discovery that an evaluation itself contained stale claims. Their full mechanics belong to articles 3 and 5. Keep the 10 August opening-balance no-op distinct from this September deposit-correction incident.

The shared pattern is not “AI made mistakes.” It is that implementation, explanation, and verification could all agree on the same incomplete model.

### 3. What proving meant in practice

Describe the assurance layers:

- owning specifications and explicit invariants;
- database constraints and transactions;
- targeted and interleaved integration tests;
- static guardrails for known forbidden patterns;
- multiple reviewers with different reasoning surfaces;
- real browser and live-database workflows;
- consolidation of findings into durable decisions.

Explain that no one layer was sufficient, including the author’s own review.

### 4. What changed in the technical-lead role

The author’s work shifted toward:

- deciding which document owns a disputed behaviour;
- asking what happens on the second ordinary action, not only the happy path;
- verifying that tests challenge rather than restate implementation;
- distinguishing atomicity, transactionality, and serialization;
- choosing reviewers for different defect classes;
- verifying a finding before accepting its diagnosis, remedy, or claimed scope;
- separating a sound recommendation from the decision to include it in a release;
- deciding which findings are real, noise, deferred, or declined;
- preserving the decision after temporary review context disappears.

### 5. What needs attention next

Use author-confirmed priorities, distinguishing completed changes from proposed investments:

- Expand adversarial and two-connection concurrency tests around money-state transitions.
- Require every absence-based test to be demonstrated red before accepting it green.
- Audit complete business flows from specification to UI, API, database, reports, and correction path.
- Check reviewer coverage and availability, with neither disagreement nor agreement treated as a verdict by itself.
- Test migrations against representative pre-existing states as well as clean databases.
- Require evidence of sibling-path coverage before saying a defect class is closed.
- Automate documentation and migration drift where possible.
- Treat internal production deployment as a verification environment until real-user go-live evidence exists.

### 6. Closing position

Return to the bottleneck. The agent reduced the cost of expressing a design. It increased the importance of independently proving that the design survived contact with time, concurrency, correction, and ordinary user behaviour.

End with the author's answer to what they will keep, change, and leave unresolved. Avoid a polished closing slogan before those answers exist. The final position should acknowledge the practical benefit of agents while explaining the verification work the author still owns.

## Evidence to use

- [EVIDENCE.md](EVIDENCE.md) for snapshot and publication boundaries.
- [September S1](evidence/2026-09-02-follow-up.md#s1--the-deposit-repair-needed-its-own-review) for the principal incident, source links, and the distinction between inspected tests and historically reported red/green results.
- `TRACKER.md` §5 for the brief signup-role reference.
- September S4 for one sentence about verifying the review; save the detailed comparison for article 5.
- The September production-deploy result establishes deployment, not real-user usage or closure of every finding.

## What to leave for follow-ups

- Detailed review overlap, category counts, and accept/defer/decline cases.
- Full explanation of presence- versus absence-based guardrails.
- Detailed test-helper mechanics.
- PR #118/#136's lock mechanics and the newer residual recovery-read issue.
- Documentation-disposition history.

Mention these briefly only when they support the flagship thesis.

## LinkedIn adaptation

Target one central observation and the deposit-repair incident. Explain the changed diagnosis, the risk in the repair, and one author-confirmed operating change. The LinkedIn version should deliver a complete lesson without requiring the click; adapt the opening only after the author's natural wording has been captured.
