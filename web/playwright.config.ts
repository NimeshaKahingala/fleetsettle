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
      use: { viewport: { width: 360, height: 640 } },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
