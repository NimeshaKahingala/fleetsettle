import { expect, test } from "vitest";
import { ApiError } from "./api.js";
import { shouldRetryQuery } from "./queryRetry.js";

test("a 4xx ApiError never retries — it is a decided answer, not a hiccup", () => {
  expect(shouldRetryQuery(0, new ApiError(401, "INVALID_TOKEN", "no token", "req-1"))).toBe(false);
  expect(shouldRetryQuery(0, new ApiError(403, "FORBIDDEN_CAPABILITY", "nope", "req-1"))).toBe(
    false,
  );
  expect(shouldRetryQuery(0, new ApiError(404, "NOT_FOUND", "gone", "req-1"))).toBe(false);
  expect(shouldRetryQuery(0, new ApiError(409, "PERIOD_CLOSED", "closed", "req-1"))).toBe(false);
});

test("a 5xx ApiError keeps the default three-attempt ladder", () => {
  const err = new ApiError(500, "INTERNAL_ERROR", "boom", "req-1");
  expect(shouldRetryQuery(0, err)).toBe(true);
  expect(shouldRetryQuery(2, err)).toBe(true);
  expect(shouldRetryQuery(3, err)).toBe(false);
});

test("a non-ApiError (network failure, thrown token getter) keeps the default ladder", () => {
  const err = new TypeError("Failed to fetch");
  expect(shouldRetryQuery(0, err)).toBe(true);
  expect(shouldRetryQuery(3, err)).toBe(false);
});
