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

// jsdom does not implement matchMedia at all — any component that reads a
// media query (dark-mode detection, useMobileHistoryDismiss's `pointer:
// coarse` check) throws under test without this. Defaults to "no match"
// (a mouse-and-keyboard desktop, no dark-mode override); a test that needs
// the opposite overrides `window.matchMedia` itself, as
// useMobileHistoryDismiss.test.tsx does.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) satisfies MediaQueryList;
}

// jsdom also has no Pointer Events capture API — vaul's (and Radix's) drag
// handling calls setPointerCapture/releasePointerCapture/hasPointerCapture
// on every pointerdown, which otherwise throws and fails the test file even
// when every assertion in it passed.
if (typeof Element !== "undefined" && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
}
