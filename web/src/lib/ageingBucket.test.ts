import { asBusinessDate } from "@fleetsettle/shared";
import { expect, test } from "vitest";
import { computeAgeingBucket } from "./ageingBucket.js";

const today = asBusinessDate("2026-08-16");

test("not yet due, or due today, is current", () => {
  expect(computeAgeingBucket("2026-08-20", today)).toBe("current");
  expect(computeAgeingBucket("2026-08-16", today)).toBe("current");
});

test("buckets at the 30/60/90-day boundaries, matching listAgeingBuckets exactly", () => {
  expect(computeAgeingBucket("2026-07-17", today)).toBe("1-30"); // 30 days late
  expect(computeAgeingBucket("2026-07-16", today)).toBe("31-60"); // 31 days late
  expect(computeAgeingBucket("2026-06-17", today)).toBe("31-60"); // 60 days late
  expect(computeAgeingBucket("2026-06-16", today)).toBe("61-90"); // 61 days late
  expect(computeAgeingBucket("2026-05-18", today)).toBe("61-90"); // 90 days late
  expect(computeAgeingBucket("2026-05-17", today)).toBe("over-90"); // 91 days late
});

/**
 * GAP-134's PR review (gitar-bot): this function takes whatever date
 * string it's handed, so the real guarantee that it agrees with
 * `listAgeingBuckets` lives at the call site — `CustomerDetailScreen`
 * passing `due.effectiveDueOn`, not `due.dueOn` — not in this function's
 * own logic. Documented here so a future call site regression has a test
 * name pointing at why it matters, even though this file can't see the
 * call site itself.
 */
test("is agnostic to which date field the caller passes — correctness is the call site's responsibility, not this function's", () => {
  expect(computeAgeingBucket("2026-06-16", today)).toBe(computeAgeingBucket("2026-06-16", today));
});
