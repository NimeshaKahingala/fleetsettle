---
paths:
  - "docs/**/*.md"
---

# Changing a specification document

The full procedure is the `doc-change` skill. Three things that are easy to get wrong and expensive to discover later:

**The owning document decides.** `docs/README.md` holds the table. A change that starts in the flows document and contradicts the use cases has skipped its own justification — go back up. Never restate another document's rule in full; reference it with its prefix (`UC §`, `FL §`, `DM §`, `TS §`, `IG §`, `UI §`, `BR §`). Two copies of a rule become two different rules.

**Record what you did *not* take.** Every document that has absorbed a review has such a section — UC §8, FL §14, UI §17, IG §1. It is the convention that stops the same argument happening twice, and it is the first one that erodes. Structure it as adopted / adopted-but-fixed-differently / rejected, with the reasoning stated well enough that a reasonable person could still disagree.

**Never change a golden-fixture figure.** UC §7 reconciles to **134,000**, **15,000** and **7,500**; FL §9.1 encodes them as the regression suite. If a change moves one, the change is wrong until proven otherwise.

Bump the Status line and the date, and update the status table in `docs/README.md`. Prettier deliberately does not touch `docs/` — reflowing a specification makes a changed number look like whitespace.
