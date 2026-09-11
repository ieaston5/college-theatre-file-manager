"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { driveProvider, ensureProductionFolder, ensureRootFolders } from "@/lib/google";
import {
  categorySchema,
  configSchema,
  firstError,
  memberSchema,
  productionSchema,
  templateSchema,
} from "@/lib/validation";
import { isSimulatedDriveId } from "@/lib/google/oauth";
import { extractDriveFileId, pluralize, slugify } from "@/lib/utils";
import { env } from "@/lib/env";
import { ROLE_META } from "@/lib/constants";
import { boardWelcome, sendEmail } from "@/lib/email";
import { bool, text, toActionState, type ActionState } from "./shared";

function refreshEverywhere() {
  revalidatePath("/", "layout");
}

/** Unique slug for a name, ignoring the row being edited. */
async function uniqueSlug(
  table: "production" | "category",
  name: string,
  ignoreId?: string,
): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing =
      table === "production"
        ? await prisma.production.findUnique({ where: { slug: candidate } })
        : await prisma.category.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === ignoreId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// --- productions ------------------------------------------------------------

export async function saveProductionAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const parsed = productionSchema.safeParse({
      id: text(form, "id"),
      name: text(form, "name") ?? "",
      abbreviation: text(form, "abbreviation"),
      season: text(form, "season"),
      status: text(form, "status") ?? "PLANNING",
      venue: text(form, "venue"),
      synopsis: text(form, "synopsis"),
      opensOn: text(form, "opensOn"),
      closesOn: text(form, "closesOn"),
      color: text(form, "color"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };
    const data = parsed.data;

    const common = {
      name: data.name,
      abbreviation: data.abbreviation ?? null,
      season: data.season ?? null,
      status: data.status,
      venue: data.venue ?? null,
      synopsis: data.synopsis ?? null,
      opensOn: parseDate(data.opensOn),
      closesOn: parseDate(data.closesOn),
      color: data.color ?? null,
    };

    const production = data.id
      ? await prisma.production.update({
          where: { id: data.id },
          data: { ...common, slug: await uniqueSlug("production", data.name, data.id) },
        })
      : await prisma.production.create({
          data: { ...common, slug: await uniqueSlug("production", data.name) },
        });

    const warnings: string[] = [];
    try {
      await ensureProductionFolder(production);
    } catch (error) {
      warnings.push(
        `Saved, but the Drive folder could not be created yet: ${(error as Error).message}`,
      );
    }

    await recordAudit({
      actor,
      action: data.id ? "production.update" : "production.create",
      targetType: "Production",
      targetId: production.id,
      summary: `${data.id ? "Updated" : "Created"} the production “${production.name}”`,
    });
    refreshEverywhere();
    return { ok: `“${production.name}” saved.`, warnings };
  } catch (error) {
    return toActionState(error);
  }
}

export async function setProductionStatusAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "ACTIVE");
  const production = await prisma.production.update({ where: { id }, data: { status } });
  await recordAudit({
    actor,
    action: "production.update",
    targetType: "Production",
    targetId: id,
    summary: `Set “${production.name}” to ${status.toLowerCase()}`,
  });
  refreshEverywhere();
}

// --- categories -------------------------------------------------------------

export async function saveCategoryAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const parsed = categorySchema.safeParse({
      id: text(form, "id"),
      name: text(form, "name") ?? "",
      description: text(form, "description"),
      icon: text(form, "icon") ?? "folder",
      color: text(form, "color") ?? "#6366f1",
      scope: text(form, "scope") ?? "BOTH",
      defaultDocType: text(form, "defaultDocType") ?? "",
      defaultVisibility: text(form, "defaultVisibility") ?? "BOARD",
      folderName: text(form, "folderName"),
      sortOrder: text(form, "sortOrder") ?? "0",
      companyVisible: bool(form, "companyVisible"),
      defaultEditAccess: text(form, "defaultEditAccess") ?? "BOARD",
      keywords: text(form, "keywords"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };
    const data = parsed.data;

    const common = {
      name: data.name,
      description: data.description ?? null,
      icon: data.icon,
      color: data.color,
      scope: data.scope,
      defaultDocType: data.defaultDocType ?? null,
      defaultVisibility: data.defaultVisibility,
      folderName: data.folderName ?? null,
      sortOrder: data.sortOrder,
      companyVisible: data.companyVisible,
      defaultEditAccess: data.defaultEditAccess,
      keywords: data.keywords ?? null,
    };

    const category = data.id
      ? await prisma.category.update({ where: { id: data.id }, data: common })
      : await prisma.category.create({
          data: { ...common, slug: await uniqueSlug("category", data.name) },
        });

    await recordAudit({
      actor,
      action: data.id ? "category.update" : "category.create",
      targetType: "Category",
      targetId: category.id,
      summary: `${data.id ? "Updated" : "Created"} the category “${category.name}”`,
    });
    refreshEverywhere();
    return { ok: `“${category.name}” saved.` };
  } catch (error) {
    return toActionState(error);
  }
}

export async function setCategoryArchivedAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  const archived = form.get("archived") === "true";
  const inUse = await prisma.document.count({ where: { categoryId: id, status: "ACTIVE" } });
  if (archived && inUse > 0) {
    throw new Error(
      `${inUse} active document${inUse === 1 ? "" : "s"} still use that category. Move them first.`,
    );
  }
  const category = await prisma.category.update({ where: { id }, data: { archived } });
  await recordAudit({
    actor,
    action: "category.archive",
    targetType: "Category",
    targetId: id,
    summary: `${archived ? "Archived" : "Restored"} the category “${category.name}”`,
  });
  refreshEverywhere();
}

// --- templates --------------------------------------------------------------

export async function saveTemplateAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const parsed = templateSchema.safeParse({
      id: text(form, "id"),
      name: text(form, "name") ?? "",
      description: text(form, "description"),
      docType: text(form, "docType") ?? "DOC",
      link: text(form, "link") ?? "",
      categoryId: text(form, "categoryId"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const fileId = extractDriveFileId(parsed.data.link);
    if (!fileId) {
      return {
        error: "That does not look like a Google Drive link — paste the template's share link.",
      };
    }

    // Make sure the hub's account can actually read the template.
    const warnings: string[] = [];
    const file = await driveProvider().getFile(fileId);
    if (!file) {
      const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
      return {
        error: `The hub's Google account (${account?.email ?? "not connected"}) cannot open that template.`,
        hint: "Share the template file with that address, at least as a viewer, then save again.",
      };
    }

    const common = {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      docType: parsed.data.docType,
      googleFileId: fileId,
      categoryId: parsed.data.categoryId ?? null,
    };
    const template = parsed.data.id
      ? await prisma.template.update({ where: { id: parsed.data.id }, data: common })
      : await prisma.template.create({ data: common });

    await recordAudit({
      actor,
      action: parsed.data.id ? "template.update" : "template.create",
      targetType: "Template",
      targetId: template.id,
      summary: `${parsed.data.id ? "Updated" : "Added"} the template “${template.name}”`,
    });
    refreshEverywhere();
    return { ok: `“${template.name}” saved.`, warnings };
  } catch (error) {
    return toActionState(error);
  }
}

export async function deleteTemplateAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  const template = await prisma.template.delete({ where: { id } });
  await recordAudit({
    actor,
    action: "template.delete",
    targetType: "Template",
    targetId: id,
    summary: `Removed the template “${template.name}”`,
  });
  refreshEverywhere();
}

// --- members ----------------------------------------------------------------

export async function saveMemberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const parsed = memberSchema.safeParse({
      id: text(form, "id"),
      email: text(form, "email") ?? "",
      name: text(form, "name"),
      position: text(form, "position"),
      role: text(form, "role") ?? "MEMBER",
    });
    if (!parsed.success) return { error: firstError(parsed.error) };
    const data = parsed.data;

    if (data.id) {
      const target = await prisma.user.findUnique({ where: { id: data.id } });
      if (!target) return { error: "That member no longer exists." };
      // Don't let the last admin demote themselves out of the console.
      if (target.role === "ADMIN" && data.role !== "ADMIN") {
        const admins = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
        if (admins <= 1) {
          return { error: "There has to be at least one admin. Promote someone else first." };
        }
      }
      const member = await prisma.user.update({
        where: { id: data.id },
        data: {
          email: data.email,
          name: data.name ?? null,
          position: data.position ?? null,
          role: data.role,
        },
      });
      await recordAudit({
        actor,
        action: "member.update",
        targetType: "User",
        targetId: member.id,
        summary: `Updated ${member.email} (${data.role.toLowerCase()})`,
      });
      refreshEverywhere();
      return { ok: `${member.email} updated.` };
    }

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return { error: `${data.email} is already on the hub.` };
    }
    const member = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name ?? null,
        position: data.position ?? null,
        role: data.role,
        status: "INVITED",
        invitedById: actor.id,
      },
    });
    await recordAudit({
      actor,
      action: "member.invite",
      targetType: "User",
      targetId: member.id,
      summary: `Added ${member.email} as ${data.role.toLowerCase()}`,
    });

    const config = await getConfig();
    const welcome = boardWelcome({
      orgName: config.orgName,
      appUrl: env.appUrl,
      name: member.name,
      roleLabel: ROLE_META[data.role].label,
      roleBlurb: ROLE_META[data.role].blurb,
      addedBy: actor.name ?? actor.email,
      googleSignIn: env.googleConfigured,
    });
    const delivery = await sendEmail({ to: member.email, message: welcome, relatedId: member.id });

    refreshEverywhere();
    return {
      ok:
        delivery.status === "SENT"
          ? `${member.email} has been added and emailed how to sign in.`
          : `${member.email} can now sign in with Google. ${
              delivery.status === "FAILED"
                ? "The welcome email failed to send — see Admin → Email."
                : "Email is off, so tell them the hub's address yourself (the message is saved in Admin → Email)."
            }`,
    };
  } catch (error) {
    return toActionState(error);
  }
}

/**
 * Take somebody off the board without taking them off the hub.
 *
 * A board term ending is not the same thing as leaving the club: plenty of
 * outgoing board members are still cast or crewed on a current show, and
 * disabling the account would cut them off from the schedule and the script
 * they are entitled to. Dropping the role to COMPANY keeps exactly the access
 * their production memberships grant and nothing else — if they are on no
 * current show, that is nothing at all.
 */
export async function stepDownFromBoardAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  if (id === actor.id) {
    throw new Error("You cannot take yourself off the board — ask another admin.");
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new Error("That person is no longer on the hub.");
  if (target.role === "ADMIN") {
    const admins = await prisma.user.count({
      where: { role: "ADMIN", status: "ACTIVE", id: { not: id } },
    });
    if (admins === 0) throw new Error("That is the only admin — promote someone else first.");
  }

  await prisma.user.update({ where: { id }, data: { role: "COMPANY" } });
  const kept = await prisma.productionMember.count({
    where: { userId: id, status: "ACTIVE", production: { status: { not: "ARCHIVED" } } },
  });

  // Board documents carry a Drive permission per person on the members list,
  // so Drive has to be told as well. Marking the sweep beats re-sharing
  // hundreds of files inline.
  const config = await getConfig();
  if (!config.sharingSweepStartedAt) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { sharingSweepStartedAt: new Date() },
    });
  }
  await recordAudit({
    actor,
    action: "member.board.stepdown",
    targetType: "User",
    targetId: id,
    summary: `Took ${target.email} off the board${
      kept > 0 ? ` — they keep company access to ${kept} current ${kept === 1 ? "show" : "shows"}` : ""
    }`,
  });
  refreshEverywhere();
}

export async function setMemberStatusAction(form: FormData) {
  const actor = await assertRole("ADMIN");
  const id = String(form.get("id") ?? "");
  const disable = form.get("status") === "DISABLED";

  if (disable) {
    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.role === "ADMIN") {
      const admins = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      if (admins <= 1) throw new Error("That is the only admin — promote someone else first.");
    }
    if (id === actor.id) throw new Error("You cannot disable your own account.");
  }

  const member = await prisma.user.update({
    where: { id },
    data: { status: disable ? "DISABLED" : "ACTIVE" },
  });
  await recordAudit({
    actor,
    action: disable ? "member.disable" : "member.enable",
    targetType: "User",
    targetId: id,
    summary: `${disable ? "Disabled" : "Re-enabled"} ${member.email}`,
  });
  refreshEverywhere();
}

/**
 * Bring every existing title into line with the naming rule.
 *
 * Offered rather than done silently on save: an admin editing the rule is
 * often mid-thought, and renaming three hundred documents under them is not
 * something to do on a keystroke. Safe to run twice — the name is composed
 * from the stored base title, so a second pass changes nothing.
 */
export async function applyNamingRuleAction(): Promise<void> {
  const actor = await assertRole("ADMIN");
  const { normaliseDocumentTitles } = await import("@/lib/documents");
  const result = await normaliseDocumentTitles();
  if (result.changed > 0) {
    await recordAudit({
      actor,
      action: "config.retitle",
      summary: `Applied the naming rule to ${result.changed} of ${result.scanned} ${pluralize(
        result.scanned,
        "title",
      )}`,
      metadata: { examples: result.examples },
    });
  }
  refreshEverywhere();
}

// --- settings & Google connection ------------------------------------------

export async function saveConfigAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await assertRole("ADMIN");
    const parsed = configSchema.safeParse({
      orgName: text(form, "orgName") ?? "",
      groupEmail: text(form, "groupEmail") ?? "",
      namingTemplate: text(form, "namingTemplate") ?? "",
      driveRootName: text(form, "driveRootName") ?? "",
      currentSeason: text(form, "currentSeason"),
      stampDocHeader: bool(form, "stampDocHeader"),
    });
    if (!parsed.success) return { error: firstError(parsed.error) };

    const before = await getConfig();
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: {
        orgName: parsed.data.orgName,
        groupEmail: parsed.data.groupEmail ?? null,
        namingTemplate: parsed.data.namingTemplate,
        driveRootName: parsed.data.driveRootName,
        currentSeason: parsed.data.currentSeason ?? null,
        stampDocHeader: parsed.data.stampDocHeader,
      },
    });

    const warnings: string[] = [];
    // The group address is the one the hub takes *off* files, so pointing it
    // somewhere else changes which stale permission a pass will clean up.
    const groupChanged = before.groupEmail !== (parsed.data.groupEmail ?? null);

    if (groupChanged) {
      const affected = await prisma.document.count({
        where: { visibility: { not: "PRIVATE" }, googleFileId: { not: null }, status: "ACTIVE" },
      });
      if (affected > 0) {
        // Start a sweep rather than trying to re-share everything inline:
        // per-member sharing is one Google call per person per file.
        await prisma.orgConfig.update({
          where: { id: "singleton" },
          data: { sharingSweepStartedAt: new Date() },
        });
        warnings.push(
          `The board's group address changed, so ${affected} existing document${
            affected === 1 ? "" : "s"
          } need another pass to clear the old group's access. Run the sweep in “Sharing in Drive” below — it can be stopped and resumed.`,
        );
      }
    }

    await recordAudit({
      actor,
      action: "config.update",
      summary: "Updated hub settings",
      metadata: { groupEmail: parsed.data.groupEmail ?? null },
    });
    refreshEverywhere();
    return { ok: "Settings saved.", warnings };
  } catch (error) {
    return toActionState(error);
  }
}

export async function bootstrapFoldersAction() {
  const actor = await assertRole("ADMIN");
  const folders = await ensureRootFolders();
  await recordAudit({
    actor,
    action: "drive.bootstrap",
    summary: "Created the hub's Drive folder structure",
    metadata: { rootFolderId: folders.rootFolderId },
  });
  refreshEverywhere();
}

export async function disconnectDriveAction() {
  const actor = await assertRole("ADMIN");
  await prisma.driveAccount.deleteMany({ where: { id: "singleton" } });
  await recordAudit({
    actor,
    action: "drive.disconnect",
    summary: "Disconnected the hub's Google account",
  });
  refreshEverywhere();
  redirect("/admin?disconnected=1");
}

/** Re-push every board document's sharing (after changing the group address). */
export async function reapplySharingAction(): Promise<void> {
  const actor = await assertRole("ADMIN");
  const { syncSharing } = await import("@/lib/documents");
  const documents = await prisma.document.findMany({
    where: { googleFileId: { not: null }, status: "ACTIVE" },
    select: {
      id: true,
      visibility: true,
      source: true,
      creatorId: true,
      googleFileId: true,
      docType: true,
      categoryId: true,
      productionId: true,
      editAccess: true,
    },
    take: 500,
  });
  let failures = 0;
  for (const document of documents) {
    try {
      await syncSharing(document);
    } catch {
      failures += 1;
    }
  }
  await recordAudit({
    actor,
    action: "config.update",
    summary: `Re-applied sharing on ${documents.length} document${documents.length === 1 ? "" : "s"}${
      failures ? ` (${failures} failed)` : ""
    }`,
  });
  refreshEverywhere();
}

/** Wipe the seeded demo content once the hub is being used for real. */
export async function removeSampleDataAction() {
  const actor = await assertRole("ADMIN");
  const sample = await prisma.document.findMany({
    where: { metadata: { contains: '"sample":true' } },
    select: { id: true },
  });
  await prisma.document.deleteMany({ where: { id: { in: sample.map((doc) => doc.id) } } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: "@pennplayers.example" }, documents: { none: {} } },
  });
  await prisma.production.deleteMany({
    where: { slug: { startsWith: "sample-" }, documents: { none: {} } },
  });

  // Anything else the simulated Drive left behind. Seeding while the hub is in
  // simulated mode writes mock file ids and an account row with no token; on a
  // real install those are worse than useless, because they look like a
  // working connection and like usable templates.
  const templates = await prisma.template.findMany({ select: { id: true, googleFileId: true } });
  const simulatedTemplates = templates.filter((t) => isSimulatedDriveId(t.googleFileId));
  if (simulatedTemplates.length > 0) {
    await prisma.template.deleteMany({
      where: { id: { in: simulatedTemplates.map((t) => t.id) } },
    });
  }

  const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
  const droppedAccount = Boolean(account && !account.refreshToken);
  if (droppedAccount) {
    await prisma.driveAccount.deleteMany({ where: { id: "singleton" } });
  }

  await recordAudit({
    actor,
    action: "config.update",
    summary: [
      `Removed ${sample.length} sample document${sample.length === 1 ? "" : "s"} and the demo members`,
      simulatedTemplates.length > 0
        ? `${simulatedTemplates.length} simulated template${simulatedTemplates.length === 1 ? "" : "s"}`
        : null,
      droppedAccount ? "the simulated Google account row" : null,
    ]
      .filter(Boolean)
      .join(", "),
  });
  refreshEverywhere();
  redirect("/admin?sample_removed=1");
}
