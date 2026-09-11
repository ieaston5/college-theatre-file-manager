"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import {
  SHARING_CHUNK,
  drainSharingSlice,
  kickSharingQueue,
  queueAllSharing,
  sharingProgress,
  type SharingDrainResult,
  type SharingProgress,
} from "@/lib/sharing";

/**
 * The queue's front end.
 *
 * Whatever is open in the browser can watch the queue and help it along: the
 * status is a pair of counts, and a slice is a bounded amount of Drive work
 * that fits comfortably inside one request. Nothing here decides who may see
 * what — that is the hub's data, already saved — so board members and not only
 * admins may drive it, because they are the people who change a company's
 * roles in the first place.
 */

export type { SharingProgress, SharingDrainResult };

/** How far the current pass has got. Cheap enough to poll while watching. */
export async function sharingProgressAction(): Promise<SharingProgress> {
  await assertRole("BOARD");
  return sharingProgress();
}

/**
 * Push one slice of the queue.
 *
 * The background drain that follows a save normally finishes the job; this is
 * what makes a long queue visibly move for whoever is watching, and what
 * finishes one whose background drain ran out of time.
 */
export async function drainSharingAction(): Promise<SharingDrainResult> {
  const actor = await assertRole("BOARD");
  const result = await drainSharingSlice({ chunk: SHARING_CHUNK });
  revalidatePath("/admin/sharing");

  if (result.pending === 0 && result.processed > 0) {
    await recordAudit({
      actor,
      action: "sharing.sweep",
      summary: `Finished re-sharing ${result.done} document${result.done === 1 ? "" : "s"} in Drive${
        result.failures > 0 ? ` (${result.failures} failed in the last slice)` : ""
      }`,
    });
  }

  return result;
}

/**
 * Queue every shared document and start on it. The admin button for "push
 * everything again, whatever the hub thinks is already in step".
 */
export async function reshareEverythingAction(): Promise<SharingProgress> {
  await assertRole("ADMIN");
  await queueAllSharing();
  kickSharingQueue();
  revalidatePath("/admin/sharing");
  return sharingProgress();
}
