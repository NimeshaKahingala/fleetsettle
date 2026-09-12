# I ran four automated reviewers over the same codebase. Only one saw the race conditions.

*Post 2 of 3 — What the agent didn't write*

In the [last post](#) I described a failure mode I've started calling rationale-shaped code: the agent writes a comment explaining exactly why a row needs locking, then writes the read, the check and the write with no lock. Eleven of those in one month, in a money system, behind a 945-line write-time guard that never fired — because every rule in it matches text, and a missing lock is an absence.

So I went looking for what *did* catch them. Over 155 pull requests I had four automated reviewers running: **SonarQube Cloud**, **GitHub Copilot**, **gitar-bot**, and **Claude**. Their combined output was about 300 comments.

Their overlap was close to zero. That turned out to be the most useful thing I learned all month.

## Sort them by what they reason over, not by who makes them

**SonarQube** reasons over *rules applied to code shape*. It posted a quality-gate result on all 155 pull requests and failed 20 of them. Eight failures were duplication on new code — one at 75%, which was a completely fair call on a batch of near-identical audit checks I'd let the agent generate. The rest were reliability, security and maintainability ratings.

Real value, consistently delivered. But in 155 pull requests, no money-logic finding ever surfaced in a pull request comment. (Its individual issues live in its own dashboard, so I'm describing what reached the review surface — which is, in practice, what a team actually reads.)

**Copilot** reasons over *the diff as a careful reader*. Fifty inline comments, and it was genuinely excellent at one specific thing: catching prose that disagreed with the code next to it. A docstring claiming "two round trips" for a function that now made three. A comment describing four columns where the code had five. In one pull request, four separate contradictions between four different planning documents — the kind of drift that survives every test suite ever written and then misleads someone six weeks later.

My favourite: it caught a `Object.freeze()` wrapped around a `Set`, pointing out that freezing does nothing to a Set's contents because mutations change internal slots, not properties. The comment claimed immutability. The code was decoration.

Notice what that is, though. In every case, the wrongness was **on the page**. A false claim, a redundant call, a stale count — all present, all readable. Copilot is superb at text that contradicts itself.

It found zero race conditions. Its only use of the word "race" in 155 pull requests was a comment reviewing a *test* I'd written to cover a race that a different bot had already found.

**gitar-bot** reasons over *execution paths and state*. Ninety-one findings: 18 bugs, 35 edge cases, 31 quality, 5 performance, 2 security. And all eleven concurrency findings in the entire project.

Not just "add a lock here." It found that voiding a deposit which had already been applied to a debt didn't restore the debt — money silently forgiven by a correction. It found that a printed statement handed to a driver silently omitted every row past the third in each section, so the document was arithmetically wrong in a way that looked complete. Both of those require holding a sequence of states in mind. Neither is visible in any single line.

**Claude** I ran as a reviewer only occasionally — eight comments — so I won't pretend that's a fair sample. Worth stating rather than quietly folding into the comparison.

## The lesson

Three of my four reviewers were reading text. I had them stacked on the same axis and mistook the volume for depth.

Text-oriented review is not weak — Copilot's cross-document work found drift I would have shipped, and Sonar's duplication gate was right every time it fired. But a reviewer that checks textual consistency **cannot** catch rationale-shaped code, and not because it isn't clever enough. It's a category limit. Rationale-shaped code is textually consistent by construction. That's the whole shape of it.

If your defect class is *the missing line*, you need at least one reviewer in the stack that simulates execution rather than reading it. That's a different purchase from "we have AI code review."

## Two honest caveats

**The bots generate noise, and stacked branches multiply it.** Ninety-one findings, ninety unique — the same one re-raised across four pull requests because my branches were stacked and each one re-reviewed the same file. Some findings were also simply wrong, and evaluating them cost real time.

**They found bugs in the guard I built to catch the agent.** Eight separate findings against my own 945-line rule script: regexes that matched inside comments and strings, an exemption that suppressed warnings file-wide when it should have been scoped to one line, a brace-counting heuristic that silently stopped working past the first match. The thing I wrote to keep the agent honest needed a reviewer too.

## Where this leaves us

The guard matches patterns and can't see absence. Three of four reviewers read text and can't see absence.

There's one line of defence left, and it's the one every engineer trusts most: the tests.

In my case there were 386 of them passing, and the bug was in the one path none of them took.

That's the last post.
