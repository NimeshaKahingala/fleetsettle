# I gave my AI agent 24 rules it couldn't break. It broke one none of them could see.

*Post 1 of 3 — What the agent didn't write*

For the past month I've been building a ledger for a small vehicle-rental business: one bus, two cars, two partners. One partner does all the data entry, the other reads the reports. It handles real money, and its entire promise is being believed about numbers.

That constraint shaped how I set up the agent. I wasn't interested in whether an AI could produce a working screen — I've read enough of those posts. I wanted to know whether it could be trusted with a figure that someone would argue about eighteen months later.

So I built the scaffold before I built the product.

## The setup

**An always-loaded rules file**, organised by failure mode rather than by topic — money, time, tenancy, writes, and a section called "numbers that go wrong quietly." Every rule carries its reason, and the reason is always a specific way a number ends up wrong. Not "use integers for money," but "use integers because a floating-point round-trip will never fail a test — it will only fail a rounding argument two years from now."

**Seven specification documents, roughly 170,000 words**, each with a citation prefix, so the agent cites its source instead of paraphrasing from memory.

**Five custom skills.** The one for adding an API endpoint is fifty lines: a fixed eight-step layer order, a table of which status code each kind of failure returns, and a mandatory seven-case test matrix that includes a cross-tenant case — because a tenancy boundary without a test is a hope.

**Two hooks.** One blocks any edit to a database migration that has already been applied. The other runs a 945-line guard with 24 named rules on every file write — not in CI, at the moment the file is saved. It catches `CURRENT_DATE` in SQL, because Postgres evaluates that in the server's timezone and this business lives in another one. It catches floating-point types anywhere near money. It catches a tenant identifier read from a request body instead of from the verified token. Exemptions are allowed, but only with a written reason, so every exception appears in the diff.

I'm listing all this to close off the easy objection. What follows is not what happens when you vibe-code. It's what happens when you don't.

## The bug

I asked the agent to close a race condition on a void operation — the ordinary kind, where two requests both read a row, both see it hasn't been voided yet, and both write.

It came back with a fix. Inside the fix was a comment explaining, correctly and in detail, why the row had to be locked before the check, and what would happen if it wasn't.

Underneath that comment: the read, the check, the write. No lock.

I read that diff. I agreed with it. The reasoning was sitting right there, and it was *good* reasoning — sharper than the comment I would have written myself. The code beneath it did not do the thing the comment said it did.

Then it got worse. The second attempt, written after the miss was pointed out, moved the check inside a transaction and still didn't serialise anything — because a transaction by itself doesn't stop two concurrent readers from seeing the same pre-write state. A fix for the race that didn't fix the race, now with a confident comment about transactions.

Across the project there were eleven of these. Eleven check-then-write sequences with no lock, in a codebase whose always-loaded context file says *every money write is one transaction* in bold, and whose endpoint skill repeats it.

## Naming it

The failure isn't that the agent wrote bad code. It's that it wrote code shaped exactly like correct reasoning. The comment is right. The names are right. The structure is right. The one line that enforces the rule is absent.

I've started calling this **rationale-shaped code**, and its defining property is that it defeats review-by-reading. When you read a diff, you are mostly checking whether the code makes sense. Rationale-shaped code makes complete sense. Sense is what it's made of.

It is also, I'd argue, the predictable output of a system trained to produce text that reads as correct. We should have expected the failure mode to be *plausibility*, not nonsense.

## Why 24 rules couldn't help

Here's the part I didn't anticipate, and the thing I'd most want another engineering lead to take away.

All 24 of those guard rules match **text**. Each one finds something that is wrong and *present*: a forbidden function call, a wrong type, a value read from the wrong place. Every one of them is, at bottom, a very well-written grep.

A missing lock is not present. Neither is a transaction that was never opened, nor an error branch that was never written, nor a bounds check nobody thought about. **You cannot grep for the line that isn't there.**

And rationale-shaped code is defined entirely by what isn't there — sitting directly underneath a comment explaining why it should be.

Every cheap defence we have detects presence. The characteristic failure of agentic coding is absence.

Which left me with a question I spent the rest of the month answering. If a 945-line guard can't see it, and reading the diff can't see it, what can?

I had four automated reviewers running on every pull request. Only one of them ever found these.

That's the next post.
