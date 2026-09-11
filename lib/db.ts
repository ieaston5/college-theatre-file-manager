import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The database client.
 *
 * Prisma talks to Postgres through node-postgres here (`engineType = "client"`
 * in the schema, plus the adapter below) rather than through its native query
 * engine. The engine is a 17.5 MB binary that was being copied into the
 * serverless function of all forty routes — the single largest thing in any of
 * them — and started up again on every cold instance. The WASM query compiler
 * that replaces it is under 2 MB, and both were promoted out of preview in
 * Prisma 6.19.
 *
 * Connection settings still come from DATABASE_URL, so pooler hostnames,
 * `sslmode` and `connection_limit` are configured exactly where they were —
 * see connectionSettings for what it takes to keep that true.
 */

/**
 * Make one DATABASE_URL mean the same thing to node-postgres that it meant to
 * Prisma's engine. Several parameters are read differently and they all matter.
 *
 * `sslmode`: Prisma followed libpq, where `require` means "encrypt, and do not
 * check whose certificate it is". node-postgres currently treats `require`,
 * `prefer` and `verify-ca` as aliases for `verify-full` instead, so a database
 * behind a pooler — whose certificate frequently does not match the hostname
 * you dialled — would start refusing connections that have always worked.
 * `uselibpqcompat=true` asks for the libpq reading, which is the one this app
 * has been deployed against. Anyone who does want the certificate checked can
 * still say so: `sslmode=verify-full` means verify-full either way.
 *
 * A missing `sslmode` is the more dangerous case. Prisma defaulted to libpq's
 * `prefer` — encrypt when the server offers it — whereas node-postgres sends
 * everything in the clear. Defaulting it here keeps a URL without an explicit
 * mode encrypted rather than quietly downgrading the hub's traffic.
 *
 * `connection_limit` and `connect_timeout`: Prisma's own parameters, which
 * node-postgres has never heard of and therefore ignores. Left alone it would
 * open its own default of ten connections per instance whatever the URL asked
 * for — and a limit of one is exactly what somebody puts there when their
 * database or pooler cannot take more, so ignoring it is how a handful of
 * concurrent instances exhaust a small Postgres. They are translated into the
 * pool's own settings instead.
 *
 * `schema`: Prisma read it from the connection string. node-postgres does not
 * know the parameter, so it is pulled out and handed to the adapter, which is
 * what sets the search path.
 */
function connectionSettings(configured: string) {
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    // Not parseable — hand it over untouched and let the driver say why.
    return { pool: { connectionString: configured }, schema: undefined };
  }

  const params = url.searchParams;
  const schema = params.get("schema") ?? undefined;

  if (!params.has("uselibpqcompat")) {
    if (!params.has("sslmode")) params.set("sslmode", "prefer");
    params.set("uselibpqcompat", "true");
  }

  const positiveInt = (name: string) => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };

  const max = positiveInt("connection_limit");
  const connectTimeoutSeconds = positiveInt("connect_timeout");

  return {
    pool: {
      connectionString: url.toString(),
      ...(max === undefined ? {} : { max }),
      ...(connectTimeoutSeconds === undefined
        ? {}
        : { connectionTimeoutMillis: connectTimeoutSeconds * 1000 }),
    },
    schema,
  };
}

function buildAdapter(): PrismaPg {
  const configured = process.env.DATABASE_URL;
  if (!configured) {
    throw new Error("Missing DATABASE_URL in .env — see SETUP.md.");
  }

  const { pool, schema } = connectionSettings(configured);
  return new PrismaPg(pool, schema ? { schema } : undefined);
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: buildAdapter(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
