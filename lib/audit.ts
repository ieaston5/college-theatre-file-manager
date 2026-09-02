import type { User } from "@prisma/client";
import { prisma } from "./db";

type AuditInput = {
  actor?: Pick<User, "id" | "email"> | null;
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

/**
 * Append-only activity trail. Summaries for private documents deliberately
 * omit the title — an admin reading the log should not learn the contents of
 * something a member marked private.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        summary: input.summary,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  } catch (error) {
    // Never fail a user action because the audit write failed.
    console.error("[audit] failed to record", input.action, error);
  }
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login.denied": "Sign-in denied",
  "auth.logout": "Signed out",
  "document.create": "Created a document",
  "document.register": "Registered an existing file",
  "document.update": "Updated a document",
  "document.visibility": "Changed visibility",
  "document.archive": "Archived a document",
  "document.restore": "Restored a document",
  "document.delete": "Removed a document from the hub",
  "document.share": "Shared a document",
  "document.unshare": "Removed a share",
  "document.sync": "Synced with Drive",
  "production.create": "Created a production",
  "production.update": "Updated a production",
  "category.create": "Created a category",
  "category.update": "Updated a category",
  "category.archive": "Archived a category",
  "template.create": "Added a template",
  "template.update": "Updated a template",
  "template.delete": "Removed a template",
  "member.invite": "Invited a member",
  "member.update": "Updated a member",
  "member.disable": "Disabled a member",
  "member.enable": "Re-enabled a member",
  "config.update": "Updated settings",
  "drive.connect": "Connected the Google account",
  "drive.disconnect": "Disconnected the Google account",
  "drive.bootstrap": "Created the Drive folder structure",
};

export function auditLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
