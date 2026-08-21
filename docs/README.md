# FleetSettle documentation

Seven documents, each owning exactly one thing. **Where two disagree, the one further up this list wins** — that ordering is the whole change-control mechanism, so it is worth knowing before you edit anything.

| # | Document | Owns | Never decides |
|---|---|---|---|
| 1 | [product/use-cases.md](product/use-cases.md) | **Intent.** What the business does, the 57 `W-n` decisions, the usability contract `U-1…U-9` | Screens, schema, technology |
| 2 | [product/user-flows.md](product/user-flows.md) | **Mechanics.** State machines, the 30 invariants `INV-n`, the 62 flows `F-n`, acceptance criteria, the test plan | Intent — it executes §1, it does not revise it |
| 3 | [engineering/data-model.md](engineering/data-model.md) | **The schema.** DDL, constraints, triggers, the report queries, the flow-to-table matrix | Behaviour |
| 4 | [engineering/tech-stack.md](engineering/tech-stack.md) | **The stack.** Runtime, database, driver, auth, storage, and the four platform constraints that shaped the schema | How to build on it |
| 5 | [engineering/implementation-guidelines.md](engineering/implementation-guidelines.md) | **How to build on it.** Layering, error shape, transactions, testing, CI | The stack itself |
| 6 | [design/ui-ux-guidelines.md](design/ui-ux-guidelines.md) | **Surface.** The mobile-first design system, `M-1…M-30`, components, per-flow screen specs, the React client | Behaviour — it renders §1 and §2 |
| 7 | [design/brand-guidelines.md](design/brand-guidelines.md) | **Identity.** The mark, lockups, icon assets, voice | Colour and type — those are §6 |

Supporting material: [engineering/fixtures/](engineering/fixtures/) holds the golden-fixture and report scripts that run §2's walkthroughs against live Postgres. [design/brand/](design/brand/) holds the SVG sources and generated icon set. [testing/](testing/) (35 files, ~4,900 lines) is retired reference material, not acceptance evidence — GAP-58 found it was aspirational test design that had never been run, and its own README says so; [`LIVE-TEST-PLAN.md`](../LIVE-TEST-PLAN.md) is the live-browser queue that replaced it.

---

## Read order

**Joining the project:** 1 → 2 → 3. Nothing else makes sense until those three do.

**About to write backend code:** 4 → 5, then 3 for the tables you are touching.

**About to write a screen:** 6, then the flow's own entry in 2.

**Changing what the product does:** 1 first, always. A change that starts in 2, 3 or 6 is a change that has skipped its own justification.

---

## Citing across documents

Four documents number their sections from 1, and three have a §6 about different things. So every cross-document reference carries a prefix, and a bare `§` always means the document you are currently reading.

| Prefix | Document |
|---|---|
| `UC §n` | product/use-cases.md |
| `FL §n` | product/user-flows.md |
| `DM §n` | engineering/data-model.md |
| `TS §n` | engineering/tech-stack.md |
| `IG §n` | engineering/implementation-guidelines.md |
| `UI §n` | design/ui-ux-guidelines.md |
| `BR §n` | design/brand-guidelines.md |

Identifier prefixes are global and never redefined: `W-n` decisions and `U-n` usability rules live in **1**, `INV-n` and `F-n` in **2**, `D-n` design notes in **3**, `M-n` mobile decisions in **6**, `B-n` brand decisions in **7**.

**Decided 18 Aug 2026 — the platform tier gets no eighth prefix.** A design pass raised the question directly (`PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md` decision 27): platform administration and multi-business membership could have earned their own document and prefix, since they sit structurally above every business. Decided against — the tier's flows are `FL §`, its schema is `DM §`, its structural boundary is `IG §`, its screens are `UI §`, exactly like everything else, and the seven above stay the complete list. An eighth prefix would be a permanent tax on every future citation for a tier small enough to fit inside the existing seven.

---

## Change control

**Documents travel together.** A change to intent (1) that alters mechanics (2) is one change, not two, and shipping half of it leaves the pair lying about each other.

Three rules that have already earned their place:

1. **Traceability closes in both directions.** Every use case has a flow; every flow has a use case; every invariant has an enforcement. FL §8 and DM §16 are those tables, and they are checked, not assumed.
2. **What was *not* taken is written down.** Every document that has absorbed a review records the recommendations it declined and why — UC §8, FL §14, UI §17, IG §1. Without that, the next reviewer raises the same point and the same argument is had twice.
3. **The golden fixtures are the regression suite.** FL §9.1 encodes UC §7's three walkthroughs with real figures, proven against Postgres 17. Any change that moves **134,000**, **15,000** or **7,500** is a breaking change and must fail loudly.

---

## Status

| Document | Version | Date |
|---|---|---|
| use-cases | v1.2.14 | 18 Aug 2026 |
| user-flows | v1.1.15 | 18 Aug 2026 |
| data-model | v1.1.12 | 20 Aug 2026 |
| tech-stack | v1.4 | 18 Aug 2026 |
| implementation-guidelines | v1.7 | 18 Aug 2026 |
| ui-ux-guidelines | v1.6 | 21 Aug 2026 |
| brand-guidelines | v1.0.3 | 21 Aug 2026 |

**Nothing is open across the suite.** The last item — the second template language — closed on 31 July 2026: **Sinhala** (UC §8, FL OQ-6, UI §16, BR §7).

**A platform tier above the business, and multi-business membership, absorbed 18 Aug 2026.** All seven affected documents above carry the same date. Settles `PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md` (decisions 1-29, three independent validation passes) and its companion implementation plan — both retired as standalone notes now that their content lives here, per decision 29. Nothing here is a money-table change; the golden fixtures (**134,000**, **15,000**, **7,500**) are untouched. What ships next, in order: Phase 1 (multi-membership plumbing — the schema and middleware this pass specifies), Phase 2 (the platform tier's tables and panel), Phase 3 (the client switcher) — `TRACKER.md`/`Plan.md` own the build state from here.

**Three acceptance criteria are deliberately unmet, recorded 17 August 2026.** Nothing here is an open *question* — each was decided — but the suite now states which of its promises are built, so this index does not read as claiming more than the product delivers:

| Criterion | Status | Why |
|---|---|---|
| **FL F-6.6** — shareable without a login | printed slip built; **share link deferred** | It would be the first route outside the login, carrying a full financial position (UC-57) |
| **FL F-9.3** — a statement to PDF | CSV built; **PDF deferred** | No renderer has a home in this runtime, `TS §8` (UC-99) |
| **FL F-4.5** — a weekly settler is not in arrears on Thursday | **unbuilt, and refused rather than mis-served** | `effective_due_on` is never derived from `settlement_rhythm`; the write path errors instead of recording a wrong date (`DM §17` D-5) |

All three criteria stand as written — they are right, and are not withdrawn. **`TRACKER.md` carries each one's gap id and owns when they get built; this table only records that they are not built yet.**

**Two owner decisions of 31 July 2026 that changed sequencing rather than behaviour:**

- **WhatsApp dispatch is built last** (UC §9.1). Meta template approval leaves the critical path; the Queue binding and the kill switch are not needed at bootstrap. What messaging depends on — condition photo capture (W-30) and the message ↔ record link (UC §9.2) — stays in phase one, or it gets built twice.
- **Auth is Asgardeo**, with the application registration owned by the business rather than by this repository (TS §2, IG §1.2).

**One gap closed 6 August 2026, found by a business trying to add its second partner: nothing ever specified how anyone after the first user gets an account.** UC-03 said "pick the user" without saying from where. **W-57** (⚑ proposed, UC §1.1) settles it — code-based, the same shape W-42 already used for a driver — and folds UC-07 (the driver's own view) into phase one alongside it (UC §9.1, FL §11.2), since both were the identical unanswered question.
