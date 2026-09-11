import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * The hub holds a club's internal paperwork and one Google account's refresh
 * token, so the cheap browser-side defences are worth having. Notes on the
 * choices that are not obvious:
 *
 * - `frame-ancestors 'none'` matters more than the others: it stops the hub
 *   being framed by another site, which is what makes a clickjacked "share
 *   with everybody" button possible.
 * - `'unsafe-inline'` is in `script-src` because Next inlines its bootstrap and
 *   flight data. Removing it needs per-request nonces through middleware; that
 *   is a fair Pass 4 improvement but it is not free, and every script here is
 *   first-party.
 * - `img-src` allows the Google avatar and Drive icon hosts that
 *   `images.remotePatterns` already permits, plus data/blob URLs for the
 *   thumbnails the upload form draws locally.
 * - `connect-src` allows the Drive resumable upload endpoint, because the
 *   browser sends file bytes straight to Google rather than through the hub.
 * - `'unsafe-eval'` is added in development only, where Next's fast refresh
 *   needs it. A production build does not.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://drive-thirdparty.googleusercontent.com https://ssl.gstatic.com",
  "font-src 'self' data:",
  // Wildcarded because Drive hands back a resumable session URL and does not
  // promise which googleapis host it will be on.
  "connect-src 'self' https://*.googleapis.com",
  "frame-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Only meaningful over HTTPS; browsers ignore it on http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const config: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Nothing the hub serves should be cached by a shared proxy: document
      // lists differ per viewer, and the file proxy streams private bytes.
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
  // This project may sit inside a folder that has its own lockfile; pin the
  // trace root to the app so builds don't reach outside it.
  outputFileTracingRoot: import.meta.dirname,
  // `npm run dev` writes to .next-dev (see package.json) so a production build
  // never clobbers the chunks a running dev server is serving. Production keeps
  // the default .next, which is what hosts like Vercel expect.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  /**
   * `googleapis` is left to Node rather than bundled. It is a very large
   * package and it is only reached through lib/google/lazy, which imports it
   * on demand; letting the bundler at it pulls it back into the build graph
   * and slows every build for no gain at runtime.
   */
  serverExternalPackages: ["googleapis"],
  experimental: {
    // Server actions are used for every mutation in this app.
    serverActions: { bodySizeLimit: "2mb" },
    /**
     * How long the browser may reuse a page it has already loaded before
     * asking the server again.
     *
     * Next's default for a dynamic page is zero, which means going back to the
     * dashboard — or clicking between the sidebar's links the way people
     * actually use the hub — re-ran the whole render every single time, even a
     * second later. Thirty seconds makes those trips instant while keeping the
     * data fresh enough for a shared document list; every mutation in the app
     * calls revalidatePath, which clears this cache outright, so an edit is
     * still visible the moment it is made.
     */
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "drive-thirdparty.googleusercontent.com" },
      { protocol: "https", hostname: "ssl.gstatic.com" },
    ],
  },
};

export default config;
