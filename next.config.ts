import type { NextConfig } from "next";

const config: NextConfig = {
  // This project may sit inside a folder that has its own lockfile; pin the
  // trace root to the app so builds don't reach outside it.
  outputFileTracingRoot: import.meta.dirname,
  // `npm run dev` writes to .next-dev (see package.json) so a production build
  // never clobbers the chunks a running dev server is serving. Production keeps
  // the default .next, which is what hosts like Vercel expect.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    // Server actions are used for every mutation in this app.
    serverActions: { bodySizeLimit: "2mb" },
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
