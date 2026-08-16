import { defineConfig } from "@playwright/test";

// M-1 / UI §4.1: every phase-1 flow completes on 360×640, one thumb, no
// horizontal scroll, and still reflows at 320px. This is the project that
// checks it — the golden viewport, not a device preset that happens to be
// close.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-360x640",
      testIgnore: "**/*.touch.spec.ts",
      use: { viewport: { width: 360, height: 640 } },
    },
    // GAP-104/GAP-134: `useCloseWatcherDismiss`'s coarse-pointer gate
    // (`matchMedia("(pointer: coarse)")`) is false under the default
    // project above — the viewport is phone-sized, but nothing tells
    // Chromium the input is touch, so the mobile close-watcher path can
    // never engage there. `hasTouch`/`isMobile` is what actually flips it,
    // which is why this is a separate project (kept off every other spec
    // via `testMatch`) rather than added to the default one.
    {
      name: "mobile-360x640-touch",
      testMatch: "**/*.touch.spec.ts",
      use: { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    // `VITE_AUTH_MODE=stub` is set on the *build*, not the preview server:
    // Vite inlines `import.meta.env` at build time, so setting it only on
    // `preview` would have no effect on the bundle being served. Without
    // it the token getter throws before any request is issued, and
    // `page.route()` has nothing to intercept (see e2e/smoke.spec.ts).
    command: "VITE_AUTH_MODE=stub npm run build && npm run preview -- --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
