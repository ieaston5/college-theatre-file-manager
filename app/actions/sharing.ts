"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { runSharingSweep, sharingSweepStatus } from "@/lib/documents";
import { firstError, groupAuditSchema } from "@/lib/validation";
import { parsePeopleInput } from "@/lib/utils";
import { text, toActionState, type ActionState } from "./shared";

export type SweepProgress = {
  processed: number;
  remaining: number;
  total: number;
  failures: number;
  started: boolean;
};

/**
 * Do one slice of the re-share sweep. The client keeps calling this until
 * nothing is left, which keeps each request short enough to survive a
 * serverless timeout however many documents there are.
 */
export async function sweepSharingAction(): Promise<SweepProgress> {
  await assertRole("ADMIN");
  const config = await getConfig();

  if (!config.sharingSweepStartedAt) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { sharingSweepStartedAt: new Date() },
    });
  }

  const result = await runSharingSweep({ chunk: 12 });
  revalidatePath("/admin/sharing");

  if (result.remaining === 0) {
    const actor = await assertRole("ADMIN");
    await recordAudit({
      actor,
      action: "sharing.sweep",
      summary: `Finished re-sharing ${result.total} document${result.total === 1 ? "" : "s"} in Drive${
        result.failures > 0 ? ` (${result.failures} failed)` : ""
      }`,
    });
  }

  return { ...result, started: true };
}

export async function startSweepAction() {
  await assertRole("ADMIN");
  await prisma.orgConfig.update({
    where: { id: "singleton" },
    data: { sharingSweepStartedAt: new Date() },
  });
  revalidatePath("/admin/sharing");
}

export async function sweepStatusAction(): Promise<SweepProgress> {
  await assertRole("ADMIN");
  const status = await sharingSweepStatus();
  return {
    processed: 0,
    remaining: status.remaining,
    total: status.total,
    failures: 0,
    started: status.running,
  };
}

/**
 * Reconcile the hub's member list against the Google Group.
 *
 * There is no API for consumer Google Group membership — that needs a
 * Workspace domain and admin console — so the honest version is: export the
 * member list from the Groups UI, paste it here, and see both directions of
 * the difference.
 */
export async function auditGroupAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    await assertRole("ADMIN");
    const parsed = groupAuditSchema.safeParse({ members: text(form, "members") ?? "" });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const pasted = new Set(parsePeopleInput(parsed.data.members).map((person) => person.email));
    if (pasted.size === 0) {
      return { error: "No email addresses found in that. Paste the group's member list." };
    }

    const config = await getConfig();
    const hubBoard = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] } },
      select: { email: true, name: true, status: true },
    });

    const hubEmails = new Set(hubBoard.map((member) => member.email.toLowerCase()));
    const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
    const expected = new Set([
      ...hubEmails,
      ...(account?.email ? [account.email.toLowerCase()] : []),
      ...(config.groupEmail ? [config.groupEmail.toLowerCase()] : []),
    ]);

    const inGroupNotOnHub = [...pasted].filter((email) => !expected.has(email));
    const onHubNotInGroup = hubBoard
      .filter((member) => member.status !== "DISABLED" && !pasted.has(member.email.toLowerCase()))
      .map((member) => member.email);
    const disabledStillInGroup = hubBoard
      .filter((member) => member.status === "DISABLED" && pasted.has(member.email.toLowerCase()))
      .map((member) => member.email);

    const warnings: string[] = [];
    if (inGroupNotOnHub.length > 0) {
      warnings.push(
        `In the group but not on the hub (${inGroupNotOnHub.length}): ${inGroupNotOnHub.join(", ")}. They can open every board document in Drive but cannot see the hub — usually people who have moved on.`,
      );
    }
    if (disabledStillInGroup.length > 0) {
      warnings.push(
        `Disabled on the hub but still in the group (${disabledStillInGroup.length}): ${disabledStillInGroup.join(", ")}. Remove them from the group, or switch to per-member sharing so the hub can do it for you.`,
      );
    }
    if (onHubNotInGroup.length > 0) {
      warnings.push(
        `On the hub but not in the group (${onHubNotInGroup.length}): ${onHubNotInGroup.join(", ")}. They will see documents listed on the hub but get "you need access" from Drive.`,
      );
    }

    return {
      ok:
        warnings.length === 0
          ? `The group and the hub agree — ${pasted.size} addresses, no differences.`
          : `Checked ${pasted.size} group members against ${hubBoard.length} on the hub.`,
      warnings,
    };
  } catch (error) {
    return toActionState(error);
  }
}
