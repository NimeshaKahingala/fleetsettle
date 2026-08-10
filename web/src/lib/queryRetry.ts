import { ApiError } from "./api.js";

/**
 * UI §9.5 ("retrying a decided answer is not resilience"): a 4xx is the
 * server's considered response, not a hiccup, so TanStack Query's default
 * three-attempt exponential backoff only delays `isError` turning true —
 * `FirstRunGate` hit this locally and worked around it with `retry: false`
 * before this existed as a shared policy. 5xx and network failures (not an
 * `ApiError` at all) keep the ladder, because those genuinely do resolve.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 3;
}
