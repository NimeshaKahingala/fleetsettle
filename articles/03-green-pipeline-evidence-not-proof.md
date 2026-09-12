# Article 3 brief — A Green Pipeline Is Evidence, Not Proof

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

Explain the helper pattern in plain language. The tests verified behaviour after supplying the key decision themselves; they did not verify what production chose.

### 2. The test pinned to the bug

The more important failure was not missing coverage. It was a test that encoded the same mistaken expectation and made the defect look intentional.

### 3. A second green test was listening to nothing

Use the accessibility-warning example. Headless Chromium had not enabled the subsystem that emitted the warning, so “no warning occurred” was permanently green.

The durable lesson:

> Before trusting a test that asserts an absence, create the forbidden condition and watch the test fail.

### 4. Why agentic development increases correlation

Be careful here. Do not claim only agents produce correlated tests. Explain that speed and same-session generation make the correlation larger and less visible: implementation, fixture, assertion, and explanation can all come from one model of the problem.

### 5. The new test discipline

- For setup paths, read back what the system decided.
- Run regression tests against pre-fix code or an intentionally broken variant.
- Add tests written from business invariants, not implementation structure.
- Use two real database connections for race conditions.
- Include second-action, correction, retry, and closed-period scenarios.
- Keep at least one live workflow that crosses UI, API, database, and report output.

### 6. What comes next

- Identify tests whose fixtures bypass the decision being tested.
- Add mutation or deliberate-red checks to high-risk invariants.
- Separate “implementation tests” from “independent acceptance evidence.”
- Improve scenario coverage before real-user go-live rather than using raw test count as the readiness signal.

## Evidence to use

- `TRACKER.md` §5 for both principal incidents.
- The historical 386-test count, explicitly tied to that moment rather than presented as the current total.
- One later concurrency test that was shown red against the pre-fix implementation.

## Avoid

- “Tests are useless.”
- Implying integration tests had no value.
- Using a current total test count without re-running the suites.
- Saying every test was written by the agent without direct evidence.

## LinkedIn adaptation

Tell only the signup-role story. End with three questions for any provisioning test:

1. Did the test supply the decision it claims to verify?
2. Has the test been seen failing for the intended reason?
3. Is the expected value derived independently of the implementation?
