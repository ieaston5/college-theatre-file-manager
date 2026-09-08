#!/usr/bin/env node
/**
 * Switch the Prisma datasource between SQLite and Postgres.
 *
 * Prisma will not take the provider from an environment variable — it has to
 * be a literal in the schema — so moving to Postgres means editing the schema
 * and regenerating. This does that edit predictably, and prints the two or
 * three commands that have to follow, rather than leaving somebody to
 * remember them at deployment time.
 *
 *   node scripts/use-database.mjs postgresql
 *   node scripts/use-database.mjs sqlite
 */

import fs from "node:fs";
import path from "node:path";

const SCHEMA = path.join(process.cwd(), "prisma", "schema.prisma");
const ALIASES = { postgres: "postgresql", pg: "postgresql", postgresql: "postgresql", sqlite: "sqlite" };
const target = ALIASES[(process.argv[2] ?? "").toLowerCase()];

if (!target) {
  console.error("Usage: npm run use-db -- <sqlite|postgres>");
  process.exit(1);
}

const schema = fs.readFileSync(SCHEMA, "utf8");
const current = schema.match(/datasource db \{[^}]*provider\s*=\s*"([a-z]+)"/)?.[1];

if (!current) {
  console.error("Could not find the datasource provider in prisma/schema.prisma.");
  process.exit(1);
}

if (current === target) {
  console.log(`Already using ${target}. Nothing to do.`);
  process.exit(0);
}

const updated = schema.replace(
  /(datasource db \{[^}]*provider\s*=\s*")[a-z]+(")/,
  `$1${target}$2`,
);
fs.writeFileSync(SCHEMA, updated);

console.log(`Switched prisma/schema.prisma from ${current} to ${target}.\n`);

if (target === "postgresql") {
  console.log(`Next, in this order:

  1. Point .env at the database. Two URLs, because migrations need a direct
     connection while the app should use the pooled one:

       DATABASE_URL="postgresql://…?pgbouncer=true&connection_limit=1"
       DIRECT_URL="postgresql://…"          # no pooler
       DATABASE_PROVIDER="postgresql"        # turns on case-insensitive search

  2. Add the direct URL to the datasource block, which Prisma needs for
     migrations against a pooled database:

       datasource db {
         provider  = "postgresql"
         url       = env("DATABASE_URL")
         directUrl = env("DIRECT_URL")
       }

  3. Create the first migration against the empty database:

       npx prisma migrate dev --name init

  4. Seed it, or import your existing data:

       npm run db:seed

  5. Reconnect Google in Admin, because the encrypted refresh token does not
     travel with a new APP_ENCRYPTION_KEY.

  Do NOT copy prisma/dev.db across — SQLite and Postgres files are not
  interchangeable. To bring existing data over, take a dump from the old
  database and restore it into the new one:

    npm run backup                          # against SQLite, before switching
    npm run restore -- backups/<file>.json  # against Postgres, after step 3

  Failing that, npm run rebuild reconstructs the documents from the labels the
  hub left on the files in Drive.`);
} else {
  console.log(`Next:

  1. Set DATABASE_URL="file:./dev.db" and remove DATABASE_PROVIDER from .env.
  2. Remove directUrl from the datasource block if it is there.
  3. npx prisma db push && npm run db:seed`);
}
