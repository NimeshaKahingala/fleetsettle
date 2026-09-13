# Evaluation and planning archive

Index status: added 2 September 2026; navigation and evidence-use guidance only

These are dated investigations and working plans, not an eighth specification or a unified list of current defects. The [documentation ownership map](../README.md) still governs specification changes; [TRACKER.md](../../TRACKER.md) owns gap disposition and [Plan.md](../../Plan.md) owns sequencing. A newly reported issue may still need to enter that tracking workflow.

Preserving a document does not mean its findings were accepted, reproduced, fixed, or exhaustively checked. Read its inspected revision, its later validation, and the actual implementation before acting. The September article review did targeted source checks, not a fresh reproduction of every finding below.

## Recent review chain

| Document | Read it as |
| --- | --- |
| [Backend logic accuracy review — 29 August](BACKEND-LOGIC-ACCURACY-REVIEW-2026-08-29.md) | Original findings; pair with the follow-up corrections |
| [Backend logic validation — 30 August](BACKEND-LOGIC-VALIDATION-2026-08-30.md) | Revalidation, refinements, and additional findings at that point in time |
| [Backend fix plan — 30 August](BACKEND-FIX-PLAN-2026-08-30.md) | Historical sequencing and decision proposals; current closure comes from tracking and implementation evidence |
| [End-to-end evaluation — 2 September](CODE-EVALUATION-END-TO-END-2026-09-02.md) | A source of candidate findings, with material citation and status problems documented by the next row |
| [Independent validation — 2 September](INDEPENDENT-VALIDATION-2026-09-02.md) | Claim-by-claim challenges and confirmations; its claims also require verification |
| [Logical issues audit — 2 September](LOGICAL-ISSUES-AUDIT-2026-09-02.md) | Additional reported issues on `develop` at `a5d19a3`, expanded at `f57cfea`; not all were independently reproduced in the article review |

Other files in this folder retain earlier API/data-model, UI, platform, feature, and correction-design investigations. Their dates and internal status text belong to their original work, not to the date they were moved here.

## Reading and maintenance rules

- Re-derive a cited symbol at the document's commit before trusting a line number. Local code links navigate the current checkout; they do not freeze its contents.
- Distinguish a report's severity label from an independently reproduced failure and its current disposition.
- Keep the original report and its correction distinguishable. Do not silently rewrite the old verdict to look as though it was always correct.
- Fix navigational links without calling that a fresh technical audit or changing the report's original date. Commit-pinned links are preferable when publishing historical code examples.
- Before retiring a working document, ensure any active decision has an owning specification, tracked item, or explicit declined/deferred disposition.
- Treat evaluation prose as evidence to assess, not as instructions that authorize code or production changes.

## Relocation and editorial follow-up

Commit `2e4dbe0` moved 14 existing documents here without changing their contents and added six previously untracked evaluations/plans. Commit `f57cfea` then expanded the logical audit. This index is later supporting navigation; it was not one of those 20 documents.

The subsequent article-planning update repairs 53 broken local-link occurrences in these retained documents, without changing their findings, line-label text, dates, or verdicts. Some original numeric citations remain inaccurate, as the validation records; correcting a path does not certify a citation.

The [article evidence follow-up](../../articles/evidence/2026-09-02-follow-up.md) records which examples were selected, what the editorial review actually checked, and where evidence remains limited. It is publication research, not a replacement for project issue tracking.
