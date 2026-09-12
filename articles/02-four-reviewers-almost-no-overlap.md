# Article 2 brief — Four Reviewers, Almost No Overlap

Working title: **Four Reviewers, Almost No Overlap**

Possible subtitle: *What SonarCloud, Copilot, Gitar, and Claude actually found across one month of pull requests.*

## Thesis

Review coverage should be designed around distinct failure modes. Adding more reviewers on the same reasoning axis creates comment volume, not independent assurance.

## Reader promise

The reader will learn how to assign different jobs to static analysis, diff readers, execution-path reviewers, and cross-layer reviewers without turning the article into a vendor leaderboard.

## Opening scene

Open with two simultaneous truths from a single period:

- SonarCloud was correctly blocking duplicated new code.
- A separate reviewer was finding that a void or correction left the financial state wrong.

Both mattered. Neither substituted for the other.

## Proposed structure

### 1. Why four reviewers were used

Briefly establish the volume and correctness sensitivity of the work. State the unequal sample sizes immediately.

### 2. What each review surface was good at

- **SonarCloud:** static rules, ratings, duplication, maintainability, and repeatable gates.
- **Copilot:** close diff reading, prose/code contradictions, incomplete assertions, accessibility and schema details.
- **Gitar:** sustained state-transition, concurrency, and multi-step lifecycle findings in this snapshot.
- **Claude review:** a smaller sample, with useful cross-layer findings spanning migrations, wire schemas, domain logic, and reports.

Use one representative finding per reviewer. Avoid listing everything.

### 3. The near-zero overlap was the result

The important result is not which tool had more comments. It is that categories differed enough that removing one review surface would have removed a distinct kind of evidence.

Discuss noise honestly:

- stacked branches repeated findings;
- some findings were wrong or low value;
- resolving comments consumed senior attention;
- unequal samples prevent a fair ranking.

### 4. The operating model that followed

Recommend review roles:

- static gate for mechanically enforceable rules;
- contract/diff review for local consistency;
- execution-state review for sequences and races;
- periodic architecture audit for whole-system blind spots;
- human disposition for accept, fix, decline, defer, or convert into a permanent guard.

### 5. What comes next

- Track findings by defect class rather than reviewer brand.
- Measure repeated and false-positive findings.
- Convert repeated valid findings into tests, constraints, or local guard rules.
- Give reviewers invariant and business context, while still keeping at least one independent challenge outside the implementation session.

## Evidence to use

- Reviewer counts and caveats from `EVIDENCE.md`.
- Sonar duplication failures as a legitimate static-analysis success.
- PR #143 for a stateful printed-statement failure.
- One Copilot contradiction or incomplete-test example.
- One Claude cross-layer example, explicitly noting the smaller sample.

## Avoid

- “Reviewer X won.”
- Treating all comments as equally severe.
- Claiming every reviewer saw every PR.
- Using mutable counts without “as of 30 August 2026.”

## LinkedIn adaptation

Use a four-row comparison with one sentence per reviewer, followed by the conclusion: build the stack by reasoning boundary, not by logo count.
