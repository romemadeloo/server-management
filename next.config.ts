import type { NextConfig } from "next";

/**
 * Notes on what is deliberately absent:
 *
 *   - No `rewrites` to the legacy server. The old app in `server/` + `public/`
 *     stays runnable via `npm run legacy` on its own port, but nothing here
 *     proxies to it — the two are independent until the cutover in
 *     docs/04-MIGRATION-PLAN.md Phase 13 deletes the old one.
 *
 *   - `public/` still holds the legacy app's index.html and js/. Next serves
 *     that directory as static assets, so those files remain reachable at
 *     /index.html and /js/*.js. Harmless (they were already public), and they
 *     go away with the old app.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The board carries internal hostnames and ticket keys. None of it should be
  // framed by another site, sniffed into a different content type, or leak a
  // referrer to an external repo URL a user clicks through to.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
