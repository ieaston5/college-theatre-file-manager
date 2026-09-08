/**
 * Shared shapes for server actions.
 *
 * This module is imported by client components (for `ActionState`), so it must
 * never pull in anything server-only — importing `next/headers` here breaks
 * every form that uses it. Guards that need the request live in lib/auth.ts.
 */
import { GoogleCallError, GoogleNotConnectedError } from "@/lib/google/types";

export type ActionState = {
  error?: string;
  hint?: string;
  ok?: string;
  warnings?: string[];
  /** Set when a document was created, so the form can offer to open it. */
  documentId?: string;
  openUrl?: string;
};

export const emptyState: ActionState = {};

export function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function bool(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === "on" || value === "true" || value === "1";
}

/** Turn any thrown error into something a board member can act on. */
export function toActionState(error: unknown): ActionState {
  if (error instanceof GoogleNotConnectedError) {
    return {
      error: error.message,
      hint: "Admin → Google connection has a one-click connect button.",
    };
  }
  if (error instanceof GoogleCallError) {
    return { error: error.message, hint: error.hint };
  }
  if (error instanceof Error) {
    // Prisma unique-constraint noise is not useful to a member.
    if (error.message.includes("Unique constraint")) {
      return { error: "Something with that name or link already exists on the hub." };
    }
    return { error: error.message };
  }
  return { error: "Something went wrong. Try again." };
}
