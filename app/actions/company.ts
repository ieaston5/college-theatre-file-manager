"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { kickSharingQueue, queueCompanySharing } from "@/lib/sharing";
import {
  addCompanyMembersSchema,
  firstError,
  membershipSchema,
  productionRoleSchema,
} from "@/lib/validation";
import { parsePeopleInput, pluralize, slugify } from "@/lib/utils";
import { env } from "@/lib/env";
import { getConfig } from "@/lib/config";
import { companyWelcome, sendEmailQuietly } from "@/lib/email";
import { bool, text, toActionState, type ActionState } from "./shared";

function refreshEverywhere() {
  revalidatePath("/", "layout");
}

/**
 * Hand Drive's half of an access change to the queue, and start draining it
 * behind the response.
 *
 * Returns the sentence to add to the confirmation, or null when there was
 * nothing to re-share. The wording carries as much weight as the mechanism: on
 * the hub the change has already happened, Drive is a moment behind, and
 * nobody has to sit and watch it — so the message says all three rather than
 * leaving somebody wondering whether closing the tab broke something.
 */
async function catchDriveUp(options: {
  /** Limit to one show's company documents; omit for every one of them. */
  productionId?: string;
  /** Access being taken away, which jumps the queue. See lib/sharing.ts. */
  urgent?: boolean;
}): Promise<string | null> {
  const queued = await queueCompanySharing(options);
  if (queued === 0) return null;
  kickSharingQueue();
  return `Drive is catching up on ${queued} ${pluralize(
    queued,
    "document",
  )} in the background — it carries on without you, so you can leave this page.`;
}

/**
 * Add people to a production from a pasted list.
 *
 * Deliberately one step: paste, pick what they are doing, done. The cast list
 * already exists somewhere — usually the contact sheet — so the fastest path
 * is to paste that column rather than fill in a form per person.
 */
export async function addCompanyMembersAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await assertRole("BOARD");
    const parsed = addCompanyMembersSchema.safeParse({
      productionId: text(form, "productionId") ?? "",
      roleId: text(form, "roleId") ?? "",
      people: text(form, "people") ?? "",
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const [production, role] = await Promise.all([
      prisma.production.findUnique({ where: { id: parsed.data.productionId } }),
      prisma.productionRole.findUnique({ where: { id: parsed.data.roleId } }),
    ]);
    if (!production) return { error: "That production no longer exists." };
    if (!role) return { error: "That role no longer exists." };

    const people = parsePeopleInput(parsed.data.people);
    if (people.length === 0) {
      return {
        error: "No email addresses found in that. Paste one per line, or a column from a sheet.",
      };
    }

    let added = 0;
    let updated = 0;
    const newcomers: Array<{ email: string; name: string | null }> = [];

    for (const person of people) {
      const existing = await prisma.user.findUnique({ where: { email: person.email } });

      // Someone already on the board keeps their board role — being cast in a
      // show must never take away their board access.
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: { name: existing.name ?? person.name ?? null },
          })
        : await prisma.user.create({
            data: {
              email: person.email,
              name: person.name ?? null,
              role: "COMPANY",
              status: "INVITED",
              invitedById: actor.id,
            },
          });

      const membership = await prisma.productionMember.findUnique({
        where: { productionId_userId: { productionId: production.id, userId: user.id } },
      });

      if (membership) {
        await prisma.productionMember.update({
          where: { id: membership.id },
          data: {
            roleId: role.id,
            title: person.title ?? membership.title,
            status: "ACTIVE",
          },
        });
        updated += 1;
      } else {
        await prisma.productionMember.create({
          data: {
            productionId: production.id,
            userId: user.id,
            roleId: role.id,
            title: person.title ?? null,
            addedById: actor.id,
          },
        });
        newcomers.push({ email: user.email, name: user.name });
        added += 1;
      }
    }

    // Tell the people who were newly added, once their access exists.
    const config = await getConfig();
    const roleCategories = await prisma.category.findMany({
      where: { productionRoles: { some: { id: role.id } }, archived: false },
      orderBy: { sortOrder: "asc" },
      select: { name: true },
    });
    for (const person of newcomers) {
      sendEmailQuietly({
        to: person.email,
        relatedId: production.id,
        message: companyWelcome({
          orgName: config.orgName,
          appUrl: env.appUrl,
          name: person.name,
          productionName: production.name,
          roleName: role.name,
          categoryNames: roleCategories.map((category) => category.name),
          addedBy: actor.name ?? actor.email,
        }),
      });
    }

    // Give the new people access to what is already filed. Queued, so adding
    // a company of twenty-five returns as soon as they are on the hub — which
    // is the moment they can sign in and see the list — rather than after
    // Drive has been told about every one of them on every document.
    const catchUp = await catchDriveUp({ productionId: production.id });

    await recordAudit({
      actor,
      action: "company.add",
      targetType: "Production",
      targetId: production.id,
      summary: `Added ${added} and updated ${updated} company ${
        added + updated === 1 ? "member" : "members"
      } on ${production.name} as ${role.name}`,
      metadata: { emails: people.map((person) => person.email) },
    });

    refreshEverywhere();
    const summary =
      added > 0
        ? `${added} ${added === 1 ? "person" : "people"} added to ${production.name}${
            updated > 0 ? `, ${updated} updated` : ""
          }. They can sign in with Google straight away.`
        : `${updated} ${updated === 1 ? "person was" : "people were"} already on ${
            production.name
          } — their role has been updated.`;
    return { ok: catchUp ? `${summary} ${catchUp}` : summary };
  } catch (error) {
    return toActionState(error);
  }
}

export async function updateMembershipAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await assertRole("BOARD");
    const parsed = membershipSchema.safeParse({
      id: text(form, "id") ?? "",
      roleId: text(form, "roleId") ?? "",
      title: text(form, "title"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const membership = await prisma.productionMember.update({
      where: { id: parsed.data.id },
      data: { roleId: parsed.data.roleId, title: parsed.data.title ?? null },
      include: { user: true, production: true, role: true },
    });

    /**
     * A different role means a different set of categories, so Drive access
     * has to follow — but not while somebody waits for it.
     *
     * This is the change that used to take the longest in the whole hub: one
     * dropdown, and then a request that re-shared every company document of
     * the show, one Google call per person per file, before it would answer.
     * The membership row itself is a single write, and it is what decides what
     * the person sees on the hub, so the save is finished the moment it lands.
     * Drive catches up behind the response.
     */
    const catchUp = await catchDriveUp({ productionId: membership.productionId });

    await recordAudit({
      actor,
      action: "company.update",
      targetType: "Production",
      targetId: membership.productionId,
      summary: `${membership.user.email} is now ${membership.role?.name ?? "unassigned"} on ${
        membership.production.name
      }`,
    });
    refreshEverywhere();
    return {
      ok: catchUp
        ? `Saved — ${membership.user.name ?? membership.user.email} is now ${
            membership.role?.name ?? "unassigned"
          }. ${catchUp}`
        : "Updated.",
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function removeMembershipAction(form: FormData) {
  const actor = await assertRole("BOARD");
  const id = String(form.get("id") ?? "");
  const membership = await prisma.productionMember.findUnique({
    where: { id },
    include: { user: true, production: true },
  });
  if (!membership) return;

  await prisma.productionMember.delete({ where: { id } });
  /**
   * Revokes their Drive access to that production's company documents.
   *
   * Queued like every other access change, but marked urgent so it goes to the
   * front: they have already stopped seeing the documents listed on the hub,
   * and the only thing outstanding is Drive still letting them open a file
   * they have a link to. Taking access away should never queue behind work
   * that merely hands access out.
   */
  await queueCompanySharing({ productionId: membership.productionId, urgent: true });
  kickSharingQueue();

  await recordAudit({
    actor,
    action: "company.remove",
    targetType: "Production",
    targetId: membership.productionId,
    summary: `Removed ${membership.user.email} from ${membership.production.name}`,
  });
  refreshEverywhere();
}

/** Re-push Drive sharing for a production's company documents. */
export async function resyncProductionSharingAction(form: FormData) {
  const actor = await assertRole("BOARD");
  const productionId = String(form.get("productionId") ?? "");
  const production = await prisma.production.findUnique({ where: { id: productionId } });
  if (!production) return;

  const queued = await queueCompanySharing({ productionId });
  kickSharingQueue();
  await recordAudit({
    actor,
    action: "company.resync",
    targetType: "Production",
    targetId: productionId,
    summary: `Queued ${queued} company ${pluralize(queued, "document")} for re-sharing on ${
      production.name
    }`,
  });
  refreshEverywhere();
}

// --- roles ------------------------------------------------------------------

export async function saveProductionRoleAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const parsed = productionRoleSchema.safeParse({
      id: text(form, "id"),
      name: text(form, "name") ?? "",
      description: text(form, "description"),
      sortOrder: text(form, "sortOrder") ?? "0",
      isDefault: bool(form, "isDefault"),
      canCreate: bool(form, "canCreate"),
      categoryIds: form.getAll("categoryIds").map(String).filter(Boolean),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };
    const data = parsed.data;

    // Only categories an admin has opened up to companies can be granted.
    const allowed = await prisma.category.findMany({
      where: { id: { in: data.categoryIds }, companyVisible: true, archived: false },
      select: { id: true, name: true },
    });
    const rejected = data.categoryIds.length - allowed.length;

    const common = {
      name: data.name,
      description: data.description ?? null,
      sortOrder: data.sortOrder,
      isDefault: data.isDefault,
      canCreate: data.canCreate,
      categories: { set: allowed.map((category) => ({ id: category.id })) },
    };

    const role = data.id
      ? await prisma.productionRole.update({ where: { id: data.id }, data: common })
      : await prisma.productionRole.create({
          data: {
            ...common,
            slug: await uniqueRoleSlug(data.name),
            categories: { connect: allowed.map((category) => ({ id: category.id })) },
          },
        });

    if (data.isDefault) {
      await prisma.productionRole.updateMany({
        where: { id: { not: role.id } },
        data: { isDefault: false },
      });
    }

    // Category changes move who can see what, so Drive has to be brought back
    // into line across every production — which is the widest access change
    // the hub has, and the one it is least sensible to make somebody watch.
    const catchUp = await catchDriveUp({});

    await recordAudit({
      actor,
      action: data.id ? "role.update" : "role.create",
      targetType: "ProductionRole",
      targetId: role.id,
      summary: `${data.id ? "Updated" : "Created"} the production role “${role.name}” (${
        allowed.length
      } ${allowed.length === 1 ? "category" : "categories"})`,
      metadata: { categories: allowed.map((category) => category.name) },
    });

    refreshEverywhere();
    return {
      ok: catchUp
        ? `“${role.name}” saved, and it decides what these people see on the hub from now. ${catchUp}`
        : `“${role.name}” saved.`,
      warnings:
        rejected > 0
          ? [
              `${rejected} of the categories you picked are board-only, so they were left out. Open the category up to companies first if the cast should see it.`,
            ]
          : [],
    };
  } catch (error) {
    return toActionState(error);
  }
}

export async function setRoleArchivedAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  const archived = form.get("archived") === "true";

  if (archived) {
    const inUse = await prisma.productionMember.count({ where: { roleId: id, status: "ACTIVE" } });
    if (inUse > 0) {
      throw new Error(
        `${inUse} ${inUse === 1 ? "person is" : "people are"} still on that role. Move them first.`,
      );
    }
  }

  const role = await prisma.productionRole.update({ where: { id }, data: { archived } });
  await recordAudit({
    actor,
    action: "role.update",
    targetType: "ProductionRole",
    targetId: id,
    summary: `${archived ? "Archived" : "Restored"} the production role “${role.name}”`,
  });
  refreshEverywhere();
}

async function uniqueRoleSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.productionRole.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
