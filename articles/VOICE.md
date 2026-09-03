# Voice and tone guide

## The voice

Write as a senior technical lead who remained close to the code, reviewed the evidence, changed his mind when the evidence changed, and still owns the result.

The voice should be:

- first-person and accountable;
- technically exact without performing expertise;
- candid about misses, including the author’s own;
- pragmatic about tools rather than loyal to or hostile toward them;
- interested in mechanisms and consequences, not blame;
- forward-looking: every criticism should lead to an operating change.

The intended effect is: “This person actually built and reviewed the system, and is telling me what changed in his engineering judgment.”

## How to avoid an AI-generated sound

### Start from memory, then verify

Write the rough paragraph in the author’s natural language before opening the evidence. Use the repository to correct facts, not to manufacture a voice from documentation.

### Prefer observed detail over abstract framing

Weak:

> In today’s rapidly evolving landscape, AI is transforming software development and creating new challenges.

Better:

> By the third week, writing the next endpoint was no longer the slow part. Proving that it moved the right money under the second ordinary user action was.

### Include the author’s judgment

Do not merely report “the reviewer found a race.” Explain:

- why the first implementation looked reasonable;
- what the author initially believed;
- which fact changed that belief;
- what the author now requires before accepting the same class of change.

### Use uneven, natural rhythm

Mix short conclusions with longer technical explanations. Avoid making every paragraph three balanced sentences or every section a three-item list.

### Keep the rough edges that carry truth

It is acceptable to say:

- “I accepted the first fix.”
- “The comment was better than the code.”
- “The test was green because it was listening to nothing.”
- “I had four reviewers, but three were looking along roughly the same axis.”

These are stronger than detached consultancy language.

## Language to avoid

Avoid stock expressions unless they are part of a quotation:

- “In today’s fast-paced world”
- “game changer”
- “revolutionary”
- “unlock the power of”
- “leverage AI”
- “seamless”
- “robust” when no property is named
- “delve into”
- “journey”
- “key takeaways”
- “it is important to note”
- “this highlights the importance of”
- “the future is not AI versus humans”
- “at the end of the day”

Also avoid repeatedly using “not X, but Y.” One sharp contrast can work; a series of them sounds generated.

## Technical style

- Explain the business consequence before the implementation detail.
- Use code identifiers only when they make the failure more concrete.
- Translate database language once: for example, a row lock means two requests cannot both act on the same stale state.
- Prefer one exact example over five names from the repository.
- Do not paste long code blocks. A two- or three-line contrast is usually enough.
- Distinguish a transaction from serialization; do not use them as synonyms.
- Distinguish production deployment from real-user go-live.

## Fairness rules

- Describe what a tool found in this repository, during the measured period.
- Do not generalize a small or uneven sample into a universal ranking.
- Mention stacked-branch duplicates and reviewer noise where relevant.
- Give static analysis credit for the problems it is designed to catch.
- Say when a finding came from an independent audit rather than an automated PR review.
- Separate a factual observation (“no lock was taken”) from an interpretation (“the agent optimized for plausible structure”).

## First-person stance

Prefer:

- “I concluded…”
- “I changed the gate…”
- “I now ask…”
- “I would still use the agent…”
- “The next area I need to strengthen is…”

Avoid hiding decisions behind:

- “the team decided” when the author made the decision;
- “it was determined”;
- “best practices suggest”;
- “the system was found to…” when a person or reviewer actually found it.

## The future-facing paragraph

Every article should end by answering three questions in prose:

1. What practice will continue because it worked?
2. What will change because the old assurance model was insufficient?
3. What remains genuinely unresolved?

The ending should not predict that AI will replace a role or solve verification. It should identify the next engineering investment: adversarial testing, reviewer diversity, invariant enforcement, live workflow evidence, or durable project memory.

## Final voice check

Before publication, ask:

- Could this paragraph have been written without working on FleetSettle?
- Is there a real decision here, or only a summary?
- Have I admitted where my own review accepted the wrong thing?
- Have I used a statistic where an incident would be more memorable?
- Is this sentence precise, or merely confident?
- Does the conclusion tell the reader what I will do differently next?
