# Rosetta on FleetSettle — fact ledger

Snapshot date: 12 September 2026
Subject: [griddynamics/rosetta](https://github.com/griddynamics/rosetta), Apache-2.0, marketplace **3.1.13**
Status: **not yet enabled here.** Everything below is from published sources and from the
existing POC. Nothing in this file is yet an observation of Rosetta running on FleetSettle.

## This file is not the primary evaluation

The primary Rosetta evaluation already exists, in a separate repository:
`~/Desktop/Projects/POC/rosetta-poc`. It has run since 4 September 2026 and carries a
four-layer evidence system (`docs/EVALUATION-METHOD.md`), a cost ledger, dated session
records, and an argued synthesis (`docs/EVALUATION-FINDINGS.md`) that has been revised four
times. **Do not restate its findings here and do not re-derive its numbers.** Cite it.

This file covers only what **FleetSettle can answer and the POC cannot**, plus the
FleetSettle-specific adoption facts. Written to the discipline of [EVIDENCE.md](EVIDENCE.md):
dated, sourced, observation separated from interpretation.

---

## Why FleetSettle is worth adding at all

The POC states its own two structural limits, in its own words:

> **"No no-Rosetta baseline exists yet. Every figure here characterizes Rosetta's own
> process. There is no comparison."** — `docs/EVALUATION-METHOD.md`, known gap 4

> **"This is greenfield. Rosetta's marketed '2x' claim is about brownfield work.
> Do not report against it."** — known gap 6, echoed in `EVALUATION-FINDINGS.md` §6:
> the claim is one "this greenfield project is structurally unable to test."

FleetSettle is the other condition on both axes, and it is the only repository available
that is:

1. **Brownfield** — 163 pull requests, 31 July to 30 August 2026, deployed to two
   environments ([EVIDENCE.md](EVIDENCE.md)).
2. **Already instrumented** — a reviewer-performance baseline exists in EVIDENCE.md
   (Gitar 99 comments, Copilot 54, Claude 11, plus SonarCloud), recorded *before* Rosetta
   was ever considered. That is a genuine pre-existing control record, not one built to
   flatter or damn the tool.
3. **Already harnessed** — the condition Rosetta's own disclaimer is about. See F2.

**Stated plainly so it cannot be overclaimed later:** adding Rosetta here produces a
*before/after on one repository with one engineer*, not a controlled comparison. The repo
matured, the engineer learned, and models changed across the same period. It is stronger
than the POC's no-baseline position and much weaker than the same-task twin-run design
proposed in the POC's `ARTICLE-OPPORTUNITIES.md` topic 5. Both caveats travel with every
number taken from here.

### Baseline: the harness that already exists (12 September 2026)

| Mechanism | Where | Enforcement type |
| --- | --- | --- |
| Always-loaded rules | `CLAUDE.md`, 13,530 bytes | **Instructional** |
| Path rules | `.claude/rules/{sql,docs}.md` | **Instructional** |
| Pre-write hook | `.claude/hooks/protect-migrations.mjs` | **Structural** — blocks the write |
| Post-write hook | `.claude/hooks/guard.mjs` | **Structural** — fires at write time |
| Static guard | `scripts/check-forbidden.mjs`, 945 lines, 24 rule IDs | **Structural** |
| Project skills | `.claude/skills/{add-endpoint,add-screen,write-migration,doc-change,run-qa-pass}` | Procedural |
| Specification | `docs/`, seven documents, 115,397 words, closed citation system | Normative |
| Code graph | GitNexus — 5,839 symbols, 18,389 relationships, 300 flows | Analytical |
| Review stack | Gitar, Copilot, Claude review, SonarCloud | **Structural** — independent readers |

The structural/instructional column is deliberate. It is the axis the POC's central finding
turns on, and FleetSettle sits on the opposite side of it. See the experiment design below.

Counts carried from EVIDENCE.md's 30 August 2026 snapshot; re-verify before publication.

---

## Verified facts about Rosetta 3.1.13

Source key: `LLM` = `griddynamics.github.io/rosetta/llms-full.txt` · `MP` = `.claude-plugin/marketplace.json` ·
`PLG` = files under `plugins/core-claude*` · `GH` = GitHub contents API · `CC` = local Claude Code state.
All fetched or read 12 September 2026. Claude Code 2.1.263.

These are **new** facts, not in the POC's records, which predate this version check.

### Adoption mechanics

- **F1.** Already installed locally at **project scope for `~/Desktop/Projects/POC/rosetta-poc`
  only**, version 3.1.13, commit `785054e9`, installed 4 September 2026. It therefore reports
  as *disabled* from FleetSettle. The marketplace `rosetta` is registered user-wide. (`CC`
  `~/.claude/plugins/installed_plugins.json`) Enabling it here is a per-project decision, and
  `--scope local` keeps it out of the committed `.claude/settings.json`.
- **F2.** The documentation carries its own disclaimer, verbatim: *"if your existing harness
  already works well, you 99% don't need it."* (`LLM` §1) The FAQ repeats it: *"If you have a
  great single-workflow harness you may not need it."* (`LLM` §19)
  **FleetSettle is precisely the repository that disclaimer describes. Nobody has tested it.**
- **F3.** Conflicts are declared with JUXT, Superpowers, GSD and AI-DevKit. No claim is made
  about coexisting with a repo's own hooks and rules. (`LLM` §1)
- **F4.** Advises against Auto model selection and says high-reasoning/Opus tiers "burn tokens".
  (`LLM` §1) FleetSettle sessions run Opus 5.
- **F5.** Claims onboarding in ~15 minutes versus ~2 weeks, and 2×–5× per task, "commonly ≥2×
  on brownfield". No method or sample given. (`LLM` §3) **Vendor claim. Never publish as
  verified.** It is also the only claim FleetSettle is structurally able to examine.

### Footprint

- **F6.** 41 skills, 10 subagents, 70 workflow files (~18 top-level flows plus phase files),
  4 rules. (`GH`)
- **F7.** Always-on cost is one `SessionStart` hook injecting five blocks: plugin-files-mode,
  `bootstrap-alwayson` (4,754 bytes), a rules index, a workflows index, and the plugin path.
  `hooks.json` is 9,416 bytes. Order of 1.5–2K tokens per session; everything else is on demand.
  (`PLG`)
- **F8.** **The shipped Claude plugin registers `SessionStart` only.** The five advisory
  PreToolUse/PostToolUse bundles that `LLM` §15 says ship "w/ every plugin" —
  `dangerous-actions`, `loose-files`, `md-file-advisory`, `lint-format-advisory`,
  `codemap-refresh` — are **absent from `hooks.json`**. §15's own closing lines explain why
  (`pre_commit.py` pins `--deterministic-hooks false`), so the document contradicts itself
  inside one section. (`PLG` vs `LLM` §15)
  **Consequence, and the single most important compatibility fact for this repo: no collision
  with `guard.mjs` or `protect-migrations.mjs`.** Rosetta adds no write-time enforcement here.
  It adds prose and workflows.
- **F9.** The plugin is entirely local files — no MCP server, no RAGFlow, no OAuth, no network
  call at request time. The MCP/Redis/OAuth architecture in `LLM` §6 is the alternative
  delivery path for IDEs without plugin support. (`LLM` §12) Adoption is cheap to reverse and
  raises no data-egress question.

### The "light" profile is not a smaller instruction set

- **F10.** `rosetta-light` ships the **identical 41 skills and 70 workflow filenames** as
  `rosetta`. `agents/engineer.md`, `agents/architect.md`, `skills/coding/SKILL.md` and
  `rules/bootstrap-alwayson.md` are **byte-identical** across the two. (`GH`, `PLG`, md5/diff)
- **F11.** The difference is phase structure. `coding-flow.md` is 10,741 bytes full versus
  9,100 light; light **collapses** discovery, tech-plan and review into one architect pass with
  one reviewer gate and one HITL gate.
- **F12.** The marketplace describes light as "simpler workflows, **smaller models**" (`MP`),
  but light's collapsed architect step is pinned `subagent_required_model="claude-opus-5"`
  where full's discovery step is pinned `claude-sonnet-5`. For that step light specifies the
  *larger* model. (`PLG`) *Light means fewer round trips, not cheaper models.*
- **F13.** `rosetta-light` is **not mentioned anywhere in `llms-full.txt`**, the document
  presented as the single self-contained context for agents. (`LLM`, full-text search)

### Residue in the "core" set

- **F14.** Four of 41 core skills are Apache Solr–specific — `solr-query`, `solr-schema`,
  `solr-extending`, `solr-semantic-search` — shipped to every repository regardless of stack.
  FleetSettle is Cloudflare Workers, Neon Postgres and React. (`GH`)
- **F15.** `specflow-use` and `coding-agents-farm` reference sibling Grid Dynamics tooling. (`GH`)

### Instruction drift inside a tool about instruction quality

- **F16.** Rosetta's CI scores every changed instruction file against **21 gates** in six
  categories and blocks a PR on any issue of severity ≥ 3. Gates include *Reference Integrity*
  and *Precision & Explicitness*. (`LLM` §16B)
- **F17.** Their root `gain.json` — the file whose declared role is "Rosetta file locations;
  **wins in conflicts**" — says `"versions": {"rosetta": "2.0.19"}` while the marketplace ships
  **3.1.13**. (`GH` vs `MP`)
- **F18.** The same file contains `"e2e_tests": "din-repository"`, a typo for `in-repository`. (`GH`)
- **F19.** `self-help-flow` ships while marked DEPRECATED in its own body, and still appears in
  the always-injected workflows index. (`PLG`, `LLM` §9)

**Interpretation, flagged as such.** F17–F19 are cosmetic alone. They matter only because of
the exact parallel in this repository: `CLAUDE.md` carries a dated correction saying a
hand-copied number in an always-loaded context file is *"the worst place for this fact to
live, because it is read constantly and updated never,"* and fixes it by pointing at
`npm run migrate:status` instead of quoting a number. `gain.json` has the same disease and
has not taken the same cure. **A 21-gate prose auditor does not catch a stale integer**, because
no gate compares a declared version to a published one. That is a limit of instruction
linting — the same point as [04-missing-line-problem.md](04-missing-line-problem.md): static
rules detect forbidden presence far better than required correspondence. It is not a claim
about Grid Dynamics' competence, and must not be written as one.

---

## The structural conflict with this repository

Recorded before adoption so it cannot be softened afterwards.

`init-workspace-flow` **reverse-engineers architecture and business context out of the code**
into `docs/CONTEXT.md` and `docs/ARCHITECTURE.md` (`LLM` §4.1, §9, §12). In the POC this
produced a 27.5 KB `ARCHITECTURE.md` and a 5.7 KB `CONTEXT.md`, and cost 345,434 subagent
tokens across nine phases (`EVALUATION-FINDINGS.md` §3).

FleetSettle inverts the direction. `docs/` is **normative and precedes the code**: *"The
owning document decides. If a change contradicts `docs/product/use-cases.md`, that document is
right and the change is wrong."* Seven documents, a closed citation system (`UC §`, `FL §`,
`DM §`, …), and a rule that documents travel together.

Generating `docs/ARCHITECTURE.md` from the source of a repo whose `docs/engineering/` already
specifies the architecture normatively creates a second, *derived* answer to a question that
already has a *governing* one — the precise failure `AGENTS.md` names when it explains why it
keeps no second copy of `CLAUDE.md`: **"two copies of a rule become two different rules."**

`load-project-context` requires `docs/CONTEXT.md` and `docs/ARCHITECTURE.md` to be read
**entirely, every session** (`PLG` `skills/load-project-context/SKILL.md`). It also accepts an
optional area prefix — `docs/[<area>-]CONTEXT.md` — and treats a missing file as non-fatal.
That is the seam through which the requirement can be satisfied with thin pointer files
instead of generated duplicates.

**This is not a defect in Rosetta.** It is a brownfield-onboarding tool doing what it says.
It is a mismatch between a tool that assumes documentation is downstream of code and a project
that decided documentation is upstream of it. Which is right is arguable, and the argument is
the article.

---

## What FleetSettle is for: the experiment

The POC's central finding is that **structure worked and instruction prose did not**:

> "naming a failure mode in an instruction does not prevent that failure mode … What did work
> was **structural** rather than instructional — gates that stop and wait for a human,
> reviewers who did not write what they review, and execution against a real system."
> — `EVALUATION-FINDINGS.md` §1

FleetSettle already has structural enforcement the POC never had: a write-time hook running
24 rule IDs, a migration guard that blocks the edit, four independent reviewers, and live QA
against real Postgres. It also already has the instructional layer, in `CLAUDE.md`.

**So the question FleetSettle uniquely answers is the one F2 raises and nobody has tested:**

> When Rosetta lands on a repository that *already* has the structure the POC found to be
> the effective ingredient, does it add anything — or does it add prose to a repo that already
> had prose, and workflows around gates that already existed?

Sub-questions, each answerable here and not in the POC:

1. **Does F8 make Rosetta inert on this repo's failure classes?** Rosetta contributes no
   write-time hook. FleetSettle's defects — the money/time/tenancy classes — are caught by
   `guard.mjs` at write time. Test whether any Rosetta phase catches something `guard.mjs`,
   the four reviewers and live QA do not.
2. **Does F21 hold — do the `CLAUDE.md` invariants still bind?** Rosetta's declared precedence
   places `bootstrap-alwayson` **above** `CLAUDE.md`/`AGENTS.md`, while claiming it "MERGES
   (rarely overrides)" (`LLM` §7, `PLG`). On a repo whose whole promise is being believed about
   money, that ordering is the adoption risk. **This must be tested before any money-touching
   work runs under a Rosetta flow.**
3. **Does mandatory HITL help or only cost, when the rules are already in hooks?** The POC
   found the HITL gate produced nearly all real defect-finding — 45 findings over 9 rounds,
   of which the AI side raised 2. But that was a greenfield design with no encoded rules. Here
   the rules are encoded and fire automatically. HITL cannot be disabled by permission mode;
   the only opt-out is the literal phrase "fully autonomous" or "no HITL" (`LLM` §19).
   This runs directly against the recorded working preference for steady unblocked progress.
4. **Is prep-every-session worth it when `CLAUDE.md` is always loaded?** Prep is a blocking
   phase-0 gate for all request sizes including one-liners (`LLM` §7, §19).
5. **Does any of the 41-skill / 18-workflow surface get used, or do two flows carry everything?**
   The POC used four flows in a week. Four of the 41 skills are for Solr (F14).

**If the honest answer across these is "it adds little here", that is the article** — and per
F2 the authors would not be surprised. That finding is worth more than another endorsement,
and it is only available from a repository that already had a working harness.

### Measurement that does not depend on self-report

`claude plugin eval` (Claude Code 2.1.263) runs a set of test prompts several times with and
without a plugin loaded and reports what the plugin changes. The POC's cost figures are
subagent completion self-reports, which its own §7 flags as unverified — and one subagent
miscounted its own findings table. An eval harness is external to the agent's self-assessment
and so answers a question the POC's method structurally cannot. Worth a run before and after
enabling, on prompts drawn from real FleetSettle tasks.

---

## Open questions this ledger must answer

1. All five experiment sub-questions above, with dated session records.
2. Whether the `docs/` reconciliation (thin pointer files) holds, or whether Rosetta keeps
   pushing to run `init-workspace-flow` and generate duplicates.
3. Whether ASD-STE100 Simplified Technical English, mandated in `bootstrap-alwayson`, degrades
   prose written in a Rosetta-active session — including drafts of this article. A
   `natural-writing` skill exists to counteract it. Drafting an article about a tool *inside a
   session that tool is shaping* is itself a fact worth recording.

## Rules for using this ledger

- Date every entry and name the session.
- Separate what happened from what it means, per [VOICE.md](VOICE.md).
- Record the sessions where Rosetta helped with the same care as the ones where it did not.
  A ledger that logs only friction is as untrustworthy as a vendor case study.
- Never publish F5, or any productivity multiple, as verified.
- Carry the before/after caveat with every comparative number: one repo, one engineer,
  changing over time.
- Re-verify version numbers and counts immediately before publication. Per F17, numbers in
  checked-in files go stale — including in this one.
