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

/**
 * Rewrite the whole datasource block, rather than only the provider word.
 *
 * Postgres on a serverless host needs `directUrl` as well: the app talks to a
 * pooler, and migrations have to bypass it because a pooler will not pass
 * through the advisory locks they take. Leaving that line for somebody to add
 * by hand is how a deployment ends up with no tables.
 */
const block =
  target === "postgresql"
    ? `datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  // Migrations bypass the pooler; the app does not.
  directUrl = env("DIRECT_URL")
}`
    : `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`;

const updated = schema.replace(/datasource db \{[^}]*\}/, block);
fs.writeFileSync(SCHEMA, updated);

console.log(`Switched prisma/schema.prisma from ${current} to ${target}.`);
console.log(
  target === "postgresql"
    ? "The datasource now reads DATABASE_URL (pooled) and DIRECT_URL (direct).\n"
    : "The datasource now reads DATABASE_URL only.\n",
);

if (target === "postgresql") {
  console.log(`Next, in this order:

  1. Point .env at the database. Two URLs, because migrations need a direct
     connection while the app should use the pooled one:

       DATABASE_URL="postgresql://…?pgbouncer=true&connection_limit=1"
       DIRECT_URL="postgresql://…"          # no pooler
       DATABASE_PROVIDER="postgresql"        # turns on case-insensitive search

     BOTH are required, here and on the host: Prisma refuses to generate at
     all if DIRECT_URL is missing. If your database has no pooler, set
     DIRECT_URL to the same string as DATABASE_URL.

  2. Create the first migration, which also applies it:

       npx prisma migrate dev --name init

  3. Load the starting categories, production roles and checklist:

       npm run db:seed

     (Then Admin -> Settings -> Remove sample data once you are signed in.)

  4. COMMIT prisma/schema.prisma AND prisma/migrations/. The deployment runs
     "prisma migrate deploy" during its build, so without the migration files
     the host builds fine and then has no tables.

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
     DIRECT_URL is no longer read, so it can stay or go.
  2. npx prisma db push && npm run db:seed

  Note that prisma/migrations/ holds Postgres SQL. Leave it alone rather than
  deleting it — SQLite here uses db push and ignores it, and the deployment
  still needs it.`);
}
