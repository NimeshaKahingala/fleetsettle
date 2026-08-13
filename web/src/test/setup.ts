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

// jsdom implements no layout at all, so Recharts' `ResponsiveContainer`
// (B4/§6) — which measures its container via `ResizeObserver` before
// deciding whether to render anything — throws outright without this and
// renders at 0×0 with it, since jsdom's `offsetWidth`/`offsetHeight` are
// always 0. Chart *data correctness* is tested through each report's own
// pure view-model functions (the same reason `chartAxis.test.ts` exists as
// its own file); a chart's actual pixel geometry is a real-browser
// question, the same category GAP-50's a11y-tree note already carries.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {
      /* no-op under jsdom — nothing to measure */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  };
}

// jsdom has no Blob URL registry — PhotoCapture (and anything else that
// previews a captured Blob) calls URL.createObjectURL/revokeObjectURL.
// createImageBitmap (the browser decode gate used by receipt thumbnails)
// does not exist under jsdom either, so the default is a successful decode;
// tests that need corrupt image behavior override it directly.
if (typeof URL !== "undefined" && !URL.createObjectURL) {
  URL.createObjectURL = () => "blob:mock-url";
  URL.revokeObjectURL = () => undefined;
}

if (typeof globalThis.createImageBitmap === "undefined") {
  const createImageBitmapMock: typeof createImageBitmap = () =>
    Promise.resolve({ close: () => undefined, height: 1, width: 1 });
  globalThis.createImageBitmap = createImageBitmapMock;
}
