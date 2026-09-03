"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { resyncCompanySharing } from "@/lib/documents";
import {
  addCompanyMembersSchema,
  firstError,
  membershipSchema,
  productionRoleSchema,
} from "@/lib/validation";
import { parsePeopleInput, slugify } from "@/lib/utils";
import { bool, text, toActionState, type ActionState } from "./shared";

function refreshEverywhere() {
  revalidatePath("/", "layout");
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
    const warnings: string[] = [];

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
        added += 1;
      }
    }

    // Give the new people access to what is already filed.
    const resync = await resyncCompanySharing({ productionId: production.id });
    if (resync.failures > 0) {
      warnings.push(
        `${resync.failures} of ${resync.total} documents could not be re-shared in Drive. Try “Re-share with the company” again in a minute.`,
      );
    }

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
    return {
      ok:
        added > 0
          ? `${added} ${added === 1 ? "person" : "people"} added to ${production.name}${
              updated > 0 ? `, ${updated} updated` : ""
            }. They can sign in with Google straight away.`
          : `${updated} ${updated === 1 ? "person was" : "people were"} already on ${
              production.name
            } — their role has been updated.`,
      warnings,
    };
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

    // A different role means a different set of categories, so Drive access
    // has to follow.
    await resyncCompanySharing({ productionId: membership.productionId });

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
    return { ok: "Updated." };
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
  // Revokes their Drive access to that production's company documents.
  await resyncCompanySharing({ productionId: membership.productionId });

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

  const result = await resyncCompanySharing({ productionId });
  await recordAudit({
    actor,
    action: "company.resync",
    targetType: "Production",
    targetId: productionId,
    summary: `Re-shared ${result.total} company ${
      result.total === 1 ? "document" : "documents"
    } for ${production.name}${result.failures ? ` (${result.failures} failed)` : ""}`,
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
    // into line across every production.
    const resync = await resyncCompanySharing({});

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
      ok: `“${role.name}” saved. ${resync.total} company ${
        resync.total === 1 ? "document" : "documents"
      } re-shared to match.`,
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
