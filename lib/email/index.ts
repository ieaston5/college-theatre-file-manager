import { prisma } from "../db";
import { env } from "../env";
import { getConfig, getDriveAccount } from "../config";
import { gmailApi } from "../google/lazy";
import { driveClient } from "../google/oauth";
import type { Composed } from "./templates";

export * from "./templates";

/**
 * The hub sends its own mail, from the Google account that already owns the
 * documents, using the Gmail API.
 *
 * Chosen over a mail vendor because it needs no new account, no domain, no DNS
 * and no third party holding the board's addresses — and because mail from
 * the club's own address is what people expect. The cost is one extra OAuth
 * scope (gmail.send), which means reconnecting the account once.
 *
 * Nothing is sent until an admin turns email on, and every message is recorded
 * either way, so the whole thing is reviewable before it reaches anybody.
 */

export type SendOptions = {
  to: string;
  message: Composed;
  relatedId?: string | null;
  /** Digest mail respects the per-person opt-out; transactional mail does not. */
  respectOptOut?: boolean;
};

export type SendResult = { status: "SENT" | "LOGGED" | "FAILED" | "SKIPPED"; error?: string };

function rfc822(input: { from: string; to: string; subject: string; body: string }): string {
  // Subjects can contain em dashes and quotes, so encode rather than assume ASCII.
  const subject = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;
  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].join("\r\n");
}

export async function sendEmail(options: SendOptions): Promise<SendResult> {
  const config = await getConfig();
  const to = options.to.trim().toLowerCase();

  if (options.respectOptOut) {
    const recipient = await prisma.user.findUnique({ where: { email: to } });
    if (recipient?.digestOptOut) return { status: "SKIPPED" };
    if (recipient?.status === "DISABLED") return { status: "SKIPPED" };
  }

  const record = async (status: SendResult["status"], error?: string) => {
    if (status === "SKIPPED") return;
    await prisma.emailMessage
      .create({
        data: {
          to,
          subject: options.message.subject,
          body: options.message.body,
          kind: options.message.kind,
          status,
          error: error ?? null,
          relatedId: options.relatedId ?? null,
          sentAt: status === "SENT" ? new Date() : null,
        },
      })
      .catch((cause) => console.error("[email] could not record message", cause));
  };

  // Off, or no real Google connection: keep the message so it can be reviewed.
  if (!config.emailEnabled || env.driveMode !== "google") {
    await record("LOGGED");
    return { status: "LOGGED" };
  }

  try {
    const account = await getDriveAccount();
    const from = account?.email;
    if (!from) throw new Error("The hub's Google account is not connected.");

    const auth = await driveClient();
    const raw = Buffer.from(rfc822({ from, to, subject: options.message.subject, body: options.message.body }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const gmail = await gmailApi();
    await gmail({ version: "v1", auth }).users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    await record("SENT");
    return { status: "SENT" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // A missing scope is the overwhelmingly likely cause, so say so.
    const hint = /insufficient|scope|permission/i.test(message)
      ? `${message} — the hub's Google account probably needs reconnecting to grant gmail.send.`
      : message;
    await record("FAILED", hint);
    console.error("[email] send failed", hint);
    return { status: "FAILED", error: hint };
  }
}

/** Fire-and-forget: a failed notification must never fail the user's action. */
export function sendEmailQuietly(options: SendOptions): void {
  void sendEmail(options).catch((error) => console.error("[email] unexpected", error));
}

export async function emailStatus() {
  const [config, account, counts] = await Promise.all([
    getConfig(),
    getDriveAccount(),
    prisma.emailMessage.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const hasGmailScope = Boolean(account?.scope?.includes("gmail.send"));
  return {
    enabled: config.emailEnabled,
    canSend: config.emailEnabled && env.driveMode === "google" && hasGmailScope,
    hasGmailScope,
    fromAddress: account?.email ?? null,
    driveConnected: Boolean(account?.refreshToken),
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Record<
      string,
      number
    >,
    lastDigestAt: config.lastDigestAt,
  };
}
