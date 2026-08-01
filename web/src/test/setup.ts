import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// vitest.config.ts does not set `test.globals`, so Testing Library's own
// auto-cleanup (which relies on a global `afterEach`) never registers —
// without this, a component rendered in one test stays in the DOM for the
// next, and two tests that render the same accessible name collide.
afterEach(() => {
  cleanup();
});
