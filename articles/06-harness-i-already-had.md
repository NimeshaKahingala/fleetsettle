# Article 6 brief — The Harness I Already Had

Working title: **The Harness I Already Had**

Possible subtitle: *What a general instruction framework for AI agents brought to a project that had spent a month encoding its own rules — and where the two stopped agreeing.*

Alternates: *Two Harnesses, One Problem* · *A Framework That Tells You Not to Use It*

**Editorial note.** This sits adjacent to articles 1–5 rather than inside their argument. The
collection is about verification outpacing implementation; this piece is about instruction
layers and harness design. Decide before drafting whether it joins the collection as 6 or
opens a second strand. It cross-links either way — its central argument is downstream of
article 3's and article 4's.

## Thesis

A general framework can teach an agent how to think. It cannot teach it that deposits are not
income. The boundary between generic engineering discipline and domain-specific encoding is
sharper than either side's marketing admits, and it falls in a predictable place.

## Reader promise

The reader will learn how to decide whether an instruction framework adds anything to a
harness they already have — by comparing mechanisms rather than feature lists, and by knowing
which category of rule no general tool can carry for them.

## The disclosure this article depends on

**State it in the first two hundred words, not in a footnote.** Rosetta has been run on a
separate greenfield project for one week. It has **not** been run on FleetSettle. This is a
design comparison between two harnesses, not an evaluation of one against the other. No claim
about defect catch, cost, or productivity belongs here.

Without that sentence the piece reads as an evaluation with no evidence. With it, the piece is
honest about being what it is — and the follow-up that does run it becomes more credible, not
less, because the predictions were made in public first.

## Opening scene

The real decision moment, in first person: a week of running Rosetta on a greenfield POC, then
going to install it on FleetSettle — and stopping.

The reason to stop is in the tool's own documentation:

> "if your existing harness already works well, you 99% don't need it."

A framework that tells you not to use it is an unusual thing to read, and it forces the
question the article answers: **did mine work well?** Not as a rhetorical setup — as a question
that required going through both systems mechanism by mechanism.

## Proposed structure

### 1. Two harnesses, built for opposite reasons

Establish both briefly, and be fair to both.

Rosetta: open source, Apache-2.0, built by Grid Dynamics to make hundreds of engineers behave
consistently across an organization. Roughly 41 skills, 10 subagent roles, 18 workflows. The
problem it solves is *institutional* — knowledge siloed in senior heads, everyone writing their
own prompts, no consistency at scale.

FleetSettle's harness: built by one person for one small ledger, accumulated rule by rule
across a month, where every rule exists because breaking it produced a number that was wrong,
plausible, and unnoticed for months. The problem it solves is *local*.

The point is not that one is better. They are answers to different questions that happen to
overlap heavily in mechanism. That overlap is section 2.

### 2. Where they independently converged — and why that matters most

Four mechanisms, arrived at separately. Present as the article's strongest observation: two
efforts with no contact landed on the same shapes.

| Both landed on | FleetSettle | Rosetta |
| --- | --- | --- |
| Structural enforcement over exhortation | `guard.mjs` at write time, 24 rule IDs | advisory hooks |
| Review by someone who didn't write it | four independent reviewers | reviewer subagent, fresh context |
| Execution over inspection | `run-qa-pass`, golden fixtures | execution-validation phase |
| Durable memory across sessions | TRACKER.md, recorded declines | `agents/MEMORY.md` |

Convergence is evidence that these four are not stylistic preferences. Say so, then complicate
it in section 3.

### 3. The first divergence: who holds the gate

Rosetta's answer to "agents forget the rules" is better prose in context plus a human approval
gate. FleetSettle's answer is to make the rule fire mechanically at write time, so the human is
not the gate.

**This is the paragraph the article exists for**, and it must be argued carefully, because the
evidence for FleetSettle's answer came out of running Rosetta:

The POC's own finding was that the always-on instructions named the failure modes that happened
anyway — "trust but verify," "coded ≠ done," "confidence ≠ evidence" — loaded into every single
session, and the failures they describe occurred regardless. What worked there was structural:
gates that stop and wait, reviewers who did not write what they review, execution against a
real system.

Handle fairly. This is not "their prose is bad." The prose is accurate and well written. The
finding is that **naming a failure mode does not prevent it**, because compliance was
self-assessed and self-assessment is the faculty the failure impairs. That is a claim about
instruction layers in general, including FleetSettle's own `CLAUDE.md`.

Then the honest turn: FleetSettle's `CLAUDE.md` is also prose, and also always loaded, and is
subject to exactly the same limit. What distinguishes the harness is not the document — it is
the 945-line guard that fires whether or not the document was read.

### 4. The second divergence: which direction documentation points

Rosetta's onboarding reverse-engineers `CONTEXT.md` and `ARCHITECTURE.md` **out of the code**.
FleetSettle made `docs/` normative and upstream of it: if a change contradicts the
specification, the change is wrong.

Same filenames, opposite arrow. Explain the consequence concretely: generating a derived
architecture document beside a governing one creates two answers to one question, which is the
exact failure `AGENTS.md` names when it explains why it holds no second copy of `CLAUDE.md` —
two copies of a rule become two different rules.

Be fair: derived documentation is the right default for the brownfield repository Rosetta
expects, where no specification exists and the code is the only truth. FleetSettle is the
unusual case. The interesting question for the reader is which case *they* are in, and most
readers are in Rosetta's.

### 5. Where a general framework necessarily stops

The thesis section. A framework can carry: verify before claiming, review what you did not
write, run it before saying it works, one transaction per unit of work.

It cannot carry: deposits and advances are money you hold, never income. `earned` and
`received` are separate facts and never collapse in storage. The lost-day denominator is
`ran + lost`. A waiver and a write-off never share a bucket.

Use **one** of these, fully explained, not the list. The deposit rule is the best candidate: a
reader with no domain knowledge understands immediately why booking held money as income
inflates a month and forces a reversal out of a period already closed — and understands that no
general framework could ever have known it.

Then the generalization the reader can act on: the rules that matter most in your system are
the ones no vendor can ship you, and the harness's real job is making those fire automatically.
A framework's contribution is the scaffolding around them, not the rules themselves.

### 6. So does a framework add anything here?

Answer honestly and without a verdict the evidence does not support.

Redundant on this repository, and say why for each: HITL gates against four existing reviewers;
a generic `coding` skill against `add-endpoint`, which carries period triggers, bigint money,
`business_id` scoping and the linked-driver test class; guardrail prose against a write-time
hook.

Additive, and name them plainly — two, not zero:

- **A separate test-quality lens.** FleetSettle's `add-endpoint` specifies a thorough test
  matrix — *what must be covered* — and nothing asks whether the tests assert anything. That is
  article 3's thesis, structurally unaddressed. In the POC, the phase that reviewed tests
  against already-passing tests found the largest coverage gap in the project.
- **Plan and specification state persisted to disk**, making long work resumable across
  sessions rather than ad hoc.

Note the asymmetry that makes this readable as fair: the framework's best contribution here is
a *phase*, which can be adopted without adopting the framework.

### 7. What comes next

- The empirical follow-up: run it here, on real gaps, and report against these predictions
  including where they were wrong.
- The general question this leaves open: whether any instruction layer can encode
  domain-specific truth, or whether that must always be local.
- What remains unresolved: whether convergence on four mechanisms means they are correct, or
  only that both authors read the same decade of engineering writing.

## Evidence to use

- The disclaimer, verbatim, from `llms-full.txt` §1 and §19.
- The POC's central finding, cited as from a separate greenfield project, one week, one
  feature set, sample size one.
- FleetSettle's harness inventory and the structural/instructional split from
  [ROSETTA-FACTS.md](ROSETTA-FACTS.md).
- Version **3.1.13**, dated 12 September 2026, per the ledger's re-verification rule.
- One deposit-or-income example explained in full.
- Cross-links: article 3 for the test-quality gap, article 4 for why absence-based rules evade
  static detection.

## Avoid

- Any claim that Rosetta would or would not have caught a specific FleetSettle defect.
- Cost or productivity numbers of any kind, including the vendor's "2×" — it is a brownfield
  claim, and the only project that has run the tool is greenfield.
- A verdict framed as "bespoke beats framework." The sample is one repository and one engineer,
  and the framework's target user has hundreds of both.
- Treating documentation typos or a stale version string in their repository as evidence of
  anything. Cosmetic drift is not a finding, and using it as one would be cheap.
- Implying the comparison is an evaluation. See the disclosure section.
- Writing about the tool's marketing rather than its mechanisms.

## LinkedIn adaptation

Lead with the disclaimer — a framework whose documentation says you probably don't need it —
and the question it forced. Then the convergence table as four rows, then the one-line thesis:
a framework can teach an agent how to think, but it cannot know that deposits are not income.
Close on the practical test: list the rules in your system nobody could have shipped you, and
check whether anything makes them fire automatically.
