import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The manifest lives here, not in tokens.css or index.html, because
// background_color/theme_color/icons are identity decisions (BR §5.2) — the
// content below is copied from that section verbatim, not re-derived.
export default defineConfig({
  // DEPLOYMENT.md §"local dev": relative `/api` paths otherwise resolve
  // against this dev server, not `wrangler dev` on :8787, and fall through
  // to the SPA's index.html. Requires `wrangler dev` running locally and
  // `npm run dev:no-auth-stub` (a real Asgardeo login) — the stub token
  // cannot pass `authMiddleware`'s JWKS verification either way.
  server: {
    proxy: {
      "/api": "http://localhost:8787",
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
        background_color: "#F1F1EC",
        theme_color: "#256ABF",
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
});
