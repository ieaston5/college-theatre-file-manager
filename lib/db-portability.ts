import type { Prisma } from "@prisma/client";

/** The runtime and schema both use PostgreSQL. */
export const dbProvider = "postgresql";
export const supportsCaseInsensitiveMode = true;
export function containsInsensitive(term: string): Prisma.StringFilter {
  return { contains: term, mode: "insensitive" };
}
export function containsInsensitiveNullable(term: string): Prisma.StringNullableFilter {
  return { contains: term, mode: "insensitive" };
}
