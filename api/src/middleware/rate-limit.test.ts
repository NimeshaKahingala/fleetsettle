import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { rateLimitMiddleware } from "./rate-limit.js";
import type { Env } from "../types.js";

function fakeContext(limitResult: { success: boolean }) {
  return {
    req: { header: () => "203.0.113.7" },
    env: { RATE_LIMITER: { limit: () => Promise.resolve(limitResult) } },
  } as unknown as Context<Env, string>;
}

describe("rateLimitMiddleware", () => {
  it("calls next() when the binding allows the request", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await rateLimitMiddleware()(fakeContext({ success: true }), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("throws RateLimitedError (429) instead of calling next() when the binding refuses", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await expect(
      rateLimitMiddleware()(fakeContext({ success: false }), next),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(next).not.toHaveBeenCalled();
  });
});
