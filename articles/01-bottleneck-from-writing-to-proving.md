# Article 1 brief — Agentic Coding Changed My Bottleneck

Working title: **Agentic Coding Changed My Bottleneck: From Writing Code to Proving It**

Possible subtitle: *What building a financial ledger in one intensive month changed in my work as a technical lead and software architect.*

Format: flagship Medium article, adapted into a shorter native LinkedIn post.

## Thesis

Agentic coding made implementation dramatically faster, but it did not remove the engineering bottleneck. It moved the bottleneck into deciding what was true, proving that writes preserved that truth under real sequences, and creating assurance independent of the agent’s original understanding.

## Reader promise

The reader will get a practical operating model for leading agentic development on correctness-sensitive software—not a tool comparison or a list of prompts.

## Personal position

The author would use agentic coding again. The changed view is that implementation speed cannot be evaluated separately from the cost of proving the implementation. Senior technical leadership moves closer to invariants, evidence, and review design rather than farther from the code.

## Opening scene

Open in the third week of the project, when producing another endpoint or screen was no longer the slowest activity. The slow work was answering a harder question: if the same financial action happens twice, is corrected later, crosses a closed month, or is performed by another role, does the system still represent the same business fact?

Avoid opening with PR counts. Introduce the scale after the reader understands the problem.

## Proposed structure

### 1. What accelerated

- Specification-to-code work, migrations, endpoints, screens, and tests could move in one continuous loop.
- The agent carried a large rule set and navigated a broad codebase effectively.
- Small, scoped implementation work became cheap enough that several alternatives could be explored before committing.

The tone here should be generous and specific. This is why the author is continuing with agentic development.

### 2. The bottleneck moved

Introduce three incidents:

1. The signup role that had no screen, behind 386 green integration tests.
2. A concurrency correction whose rationale described serialization while its code did not take the required lock.
3. Internal live QA showing a “committed” opening balance that had not created the ledger facts reports used.

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
- deciding which findings are real, noise, deferred, or declined;
- preserving the decision after temporary review context disappears.

### 5. What needs attention next

Use first-person commitments:

- Expand adversarial and two-connection concurrency tests around money-state transitions.
- Require every absence-based test to be demonstrated red before accepting it green.
- Audit complete business flows from specification to UI, API, database, reports, and correction path.
- Keep review models diverse instead of stacking several text-oriented readers.
- Automate documentation and migration drift where possible.
- Treat internal production deployment as a verification environment until real-user go-live evidence exists.

### 6. Closing position

Return to the bottleneck. The agent reduced the cost of expressing a design. It increased the importance of independently proving that the design survived contact with time, concurrency, correction, and ordinary user behaviour.

End with a personal statement, not a slogan. Candidate direction:

> I am not planning to write less with agents. I am planning to spend more of my senior attention on the evidence that their output cannot supply for itself.

Rewrite this in the author’s natural voice during drafting.

## Evidence to use

- Dated PR snapshot from `EVIDENCE.md`.
- `TRACKER.md` §5 for the signup-role and accessibility-test lessons.
- PR #118 or #136 for the concurrency example—use one in depth, not both.
- Recovered 10 August live-browser finding for opening balances.
- The 24-rule guard as evidence of substantial preparation, not as proof of safety.

## What to leave for follow-ups

- Detailed reviewer scorecard and category counts.
- Full explanation of presence- versus absence-based guardrails.
- Detailed test-helper mechanics.
- Documentation-disposition history.

Mention these briefly only when they support the flagship thesis.

## LinkedIn adaptation

Target one central observation and one incident. Suggested opening direction:

> After a month of agentic coding, writing code was no longer my bottleneck. Proving it was.

Then give the concurrency or signup-role example, three practices that changed, and a link to the full article. The LinkedIn version should still deliver a complete lesson without requiring the click.
