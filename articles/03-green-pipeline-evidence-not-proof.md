# Article 3 brief — A Green Pipeline Is Evidence, Not Proof

Status: planning revised 2 September 2026; proposed first follow-up after the flagship

Working title: **A Green Pipeline Is Evidence, Not Proof**

Alternative title: **The Test Passed Because It Agreed With the Bug**

## Thesis

Tests provide independent evidence only when they can contradict the implementation’s assumptions. In agentic development, code and tests produced from the same context can become highly correlated while their volume suggests the opposite.

## Reader promise

The reader will leave with concrete ways to test the test: exercise real provisioning paths, read back system decisions, deliberately make absence assertions fail, and introduce adversarial scenarios outside the implementation’s happy path.

## Opening scene

Open with the real signup endpoint assigning a role that had no usable interface. Hundreds of integration tests were green because their helper accepted the role as input. One test did exercise the endpoint—and asserted the wrong role as correct.

## Proposed structure

### 1. How a sensible helper removed the decision under test

Explain the helper pattern in plain language. The tests verified behaviour after supplying the key decision themselves; they did not verify what the real signup endpoint chose.

### 2. The test pinned to the bug

The more important failure was not missing coverage. It was a test that encoded the same mistaken expectation and made the defect look intentional.

### 3. A second green test was listening to nothing

Use the accessibility-warning example. Headless Chromium had not enabled the subsystem that emitted the warning, so “no warning occurred” was permanently green.

The durable lesson:

> Before trusting a test that asserts an absence, create the forbidden condition and watch the test fail.

### 4. A realistic calculation in an unrealistic sequence

Use PR #160 as the third principal incident. The next billing period needed to exist before the mileage reading, as it would after the scheduler ran. Generating it afterward removed the under-billing scenario from the test. The review response records that the amended scenario failed without the query fix; distinguish that historical report from a test newly rerun for publication.

Optional short sidebar: PR #176's index failed on populated QA even though the clean-database integration path could build it. This is a different property being tested, not evidence that integration tests are useless. Keep the repair story itself in article 1; replace another incident if this sidebar grows into a full case.

### 5. Why shared context is a risk

Do not claim only agents produce correlated tests or that this project measured the size of that effect. Implementation, fixture, assertion, and explanation can all inherit one model of the problem; same-session generation makes that a practical risk to examine, not a quantified universal conclusion.

### 6. The new test discipline

- For setup paths, read back what the system decided.
- Run regression tests against pre-fix code or an intentionally broken variant.
- Add tests written from business invariants, not implementation structure.
- Use two real database connections for race conditions.
- Include second-action, correction, retry, and closed-period scenarios.
- Reproduce scheduler-created state and ordering, not only the endpoint's immediate setup.
- Exercise migration upgrades on representative legacy states as well as clean schemas.
- Keep at least one live workflow that crosses UI, API, database, and report output.

### 7. What comes next

- Identify tests whose fixtures bypass the decision being tested.
- Add mutation or deliberate-red checks to high-risk invariants.
- Separate “implementation tests” from “independent acceptance evidence.”
- Improve scenario coverage before real-user go-live rather than using raw test count as the readiness signal.

These are candidate priorities for the author's confirmation, not claims that every practice is implemented across the repository.

## Evidence to use

- `TRACKER.md` §5 for the signup and accessibility incidents.
- The historical 386-test count, explicitly tied to that moment rather than presented as the current total.
- [September S3](evidence/2026-09-02-follow-up.md#s3--the-test-needed-the-schedulers-ordering) for the mileage scenario, direct review, and recorded pre-fix failure.
- September S1 for the optional populated-data migration contrast; S8 for why individual check surfaces must be named precisely.

## Avoid

- “Tests are useless.”
- Implying integration tests had no value.
- Using a current total test count without re-running the suites.
- Saying every test was written by the agent without direct evidence.
- Repeating carried-forward test totals from an evaluation as a fresh measurement.
- Saying “all CI was green” when the evidence only names particular tests, PR gates, or deployments.

## LinkedIn adaptation

Tell only the signup-role story. End with three questions for any provisioning test:

1. Did the test supply the decision it claims to verify?
2. Has the test been seen failing for the intended reason?
3. Is the expected value derived independently of the implementation?
