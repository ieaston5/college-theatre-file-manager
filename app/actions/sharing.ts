"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { runSharingSweep, sharingSweepStatus } from "@/lib/documents";

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
