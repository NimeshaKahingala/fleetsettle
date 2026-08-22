import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The manifest lives here, not in tokens.css or index.html, because
// background_color/theme_color/icons are identity decisions (BR §5.2) — the
// content below is copied from that section verbatim, not re-derived.
export default defineConfig(({ mode }) => {
  // Loaded here (not read from `import.meta.env`, which only reaches the
  // client bundle) so a gitignored `.env.development.local` can override
  // the proxy target without touching this tracked file. The one intended
  // use is pointing a local web-only checkout at a hosted API — QA's
  // Asgardeo app already accepts `http://localhost:5173/auth/callback`
  // (`.env.development`'s own comment), so `VITE_PROXY_TARGET=
  // https://qa.fleetsettle.com npm run dev:no-auth-stub` needs no local
  // `wrangler dev` and no Worker-side CORS change: the browser still talks
  // same-origin to this dev server, which forwards server-to-server.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    // DEPLOYMENT.md §"local dev": relative `/api` paths otherwise resolve
    // against this dev server, not `wrangler dev` on :8787, and fall through
    // to the SPA's index.html. Requires `wrangler dev` running locally and
    // `npm run dev:no-auth-stub` (a real Asgardeo login) — the stub token
    // cannot pass `authMiddleware`'s JWKS verification either way.
    server: {
      proxy: {
        "/api": {
          target: env["VITE_PROXY_TARGET"] ?? "http://localhost:8787",
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "icons/favicon.svg",
          "icons/favicon-16.png",
          "icons/apple-touch-icon-180.png",
        ],
        manifest: {
          name: "FleetSettle",
          short_name: "FleetSettle",
          start_url: "/",
          display: "standalone",
          background_color: "#EDEFF3",
          theme_color: "#0F2E63",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/icons/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        // The runtime-caching strategy (stale-while-revalidate API reads, a
        // short TTL on money reads, the paused mutation queue) is P12 — the
        // phase that has the offline flows to prove it against. This is the
        // shell precache only.
      }),
    ],
  };
});
