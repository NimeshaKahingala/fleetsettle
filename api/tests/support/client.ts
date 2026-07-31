import app from "../../src/index.js";
import { TEST_ENV } from "./env.js";

// A stand-in for the fourth argument `app.request()` accepts (Hono's own
// test entry point): there is no real Workers runtime here to supply one.
// `waitUntil` just needs to exist — `dbMiddleware` calls it to close the pool
// off the request path, and nothing in these tests depends on when that
// actually finishes.
const testExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => {
    void promise;
  },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/**
 * The real Hono app via `app.request()` against a real Neon test branch — no
 * server, the full middleware chain (IG §8.1). Never mock the database; this
 * schema's correctness is largely its constraints, and a mock has none of them.
 */
export const request = (path: string, init?: RequestInit) =>
  app.request(path, init, TEST_ENV, testExecutionContext);
