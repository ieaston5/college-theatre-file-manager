import type { Prisma } from "@prisma/client";

/**
 * The one behavioural difference between the two databases this app runs on.
 *
 * SQLite's LIKE is case-insensitive for ASCII, which is what Prisma's
 * `contains` compiles to — so searching "budget" finds "Budget" for free.
 * Postgres's LIKE is case-sensitive, and the fix there is `mode:
 * "insensitive"` — a field Prisma only generates types for when the datasource
 * provider is postgresql.
 *
 * Rather than have search silently start missing results the day the app moves
 * to Postgres, every text search goes through here. The cast is deliberate and
 * is the only place in the codebase that needs one: on SQLite the generated
 * `StringFilter` has no `mode`, so it cannot be expressed without it.
 */

/** Set to "postgresql" in the environment when the datasource is Postgres. */
export const dbProvider = (process.env.DATABASE_PROVIDER ?? "sqlite").toLowerCase();

export const supportsCaseInsensitiveMode = dbProvider === "postgresql";

/** A case-insensitive "contains" filter that behaves the same on both. */
export function containsInsensitive(term: string): Prisma.StringFilter {
  return {
    contains: term,
    ...(supportsCaseInsensitiveMode ? { mode: "insensitive" } : {}),
  } as Prisma.StringFilter;
}

/** Nullable columns need the nullable filter type. */
export function containsInsensitiveNullable(term: string): Prisma.StringNullableFilter {
  return {
    contains: term,
    ...(supportsCaseInsensitiveMode ? { mode: "insensitive" } : {}),
  } as Prisma.StringNullableFilter;
}
