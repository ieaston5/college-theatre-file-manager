#!/usr/bin/env node
const target = (process.argv[2] ?? "").toLowerCase();
if (!["postgres", "postgresql", "pg"].includes(target)) {
  console.error("This build supports PostgreSQL only. See SETUP.md for a local database. No files changed.");
  process.exitCode = 1;
} else {
  console.log("PostgreSQL is already configured. Set DATABASE_URL and DIRECT_URL, then run npm run setup. No files changed.");
}
