import type { User } from "@prisma/client";
import { prisma } from "./db";
import { getConfig } from "./config";
import { recordAudit } from "./audit";
import { driveProvider, ensureRootFolders } from "./google";
import { resyncCompanySharing } from "./documents";

/**
 * Season rollover.
 *
 * Board turnover is the moment institutional memory actually gets lost: the
 * outgoing board stops logging in, their shows stay "active" forever, and the
 * documents only they own quietly become unreachable. This does the whole
 * sequence in one pass and, crucially, tells you what it *cannot* do — nobody
 * can hand over somebody else's private documents for them.
 */

export type RolloverPlan = {
  currentSeason: string | null;
  showsToArchive: Array<{ id: string; name: string; season: string | null; status: string }>;
  membersToDisable: Array<{
    id: string;
    name: string | null;
    email: string;
    role: string;
    lastLoginAt: Date | null;
    privateCount: number;
    ownedInDriveCount: number;
    /** Current shows they are cast or crewed on, which they keep either way. */
    activeMemberships: number;
  }>;
  companyToRetire: number;
  lastRolloverAt: Date | null;
};

/** What a rollover would touch, without touching it. */
export async function planRollover(): Promise<RolloverPlan> {
  const config = await getConfig();
  const staleBefore = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);

  const [shows, board, account] = await Promise.all([
    prisma.production.findMany({
      where: { status: { in: ["CLOSED", "ACTIVE", "PLANNING"] } },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, season: true, status: true, closesOn: true },
    }),
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "BOARD", "MEMBER"] }, status: { not: "DISABLED" } },
      select: { id: true, name: true, email: true, role: true, lastLoginAt: true },
    }),
    prisma.driveAccount.findUnique({ where: { id: "singleton" } }),
  ]);

  // Suggest archiving shows that have closed, or that closed by date.
  const showsToArchive = shows.filter(
    (show) => show.status === "CLOSED" || (show.closesOn && show.closesOn < new Date()),
  );

  const membersToDisable = await Promise.all(
    board
      // Only suggest people who have not signed in for a long while; the
      // decision is always the admin's, per person.
      .filter((member) => !member.lastLoginAt || member.lastLoginAt < staleBefore)
      .map(async (member) => ({
        ...member,
        privateCount: await prisma.document.count({
          where: { creatorId: member.id, visibility: "PRIVATE", status: "ACTIVE" },
        }),
        ownedInDriveCount: account?.email
          ? await prisma.document.count({
              where: { driveOwnerEmail: member.email, status: "ACTIVE" },
            })
          : 0,
        activeMemberships: await prisma.productionMember.count({
          where: {
            userId: member.id,
            status: "ACTIVE",
            production: {
              status: { not: "ARCHIVED" },
              // A show being archived in this same pass no longer counts.
              id: { notIn: showsToArchive.map((show) => show.id) },
            },
          },
        }),
      })),
  );

  const companyToRetire = await prisma.productionMember.count({
    where: { status: "ACTIVE", productionId: { in: showsToArchive.map((show) => show.id) } },
  });

  return {
    currentSeason: config.currentSeason,
    showsToArchive,
    membersToDisable,
    companyToRetire,
    lastRolloverAt: config.lastRolloverAt,
  };
}

export type RolloverResult = {
  archivedShows: string[];
  disabledMembers: string[];
  /** Kept on the hub as company members because they are still on a show. */
  steppedDownMembers: string[];
  foldersMoved: number;
  documentsResynced: number;
  warnings: string[];
};

export async function runRollover(
  actor: User,
  input: {
    newSeason?: string | null;
    showIds: string[];
    memberIds: string[];
    moveFolders: boolean;
  },
): Promise<RolloverResult> {
  const config = await getConfig();
  const warnings: string[] = [];
  const archivedShows: string[] = [];
  const disabledMembers: string[] = [];
  const steppedDownMembers: string[] = [];
  let foldersMoved = 0;
  let documentsResynced = 0;

  // 1. Archive the shows. Company access ends with the show, in the hub and
  //    in Drive — getViewerContext ignores archived productions and the
  //    sharing pass drops their people.
  for (const showId of input.showIds) {
    const show = await prisma.production.findUnique({ where: { id: showId } });
    if (!show) continue;

    await prisma.production.update({ where: { id: showId }, data: { status: "ARCHIVED" } });
    archivedShows.push(show.name);

    if (input.moveFolders && show.driveFolderId) {
      try {
        const provider = driveProvider();
        const { rootFolderId } = await ensureRootFolders();
        const archiveRoot =
          config.archiveFolderId ?? (await provider.ensureFolder("Archive", rootFolderId));
        if (!config.archiveFolderId) {
          await prisma.orgConfig.update({
            where: { id: "singleton" },
            data: { archiveFolderId: archiveRoot },
          });
        }
        const seasonFolder = await provider.ensureFolder(
          show.season ?? config.currentSeason ?? "Past seasons",
          archiveRoot,
        );
        await provider.moveFile(show.driveFolderId, seasonFolder);
        foldersMoved += 1;
      } catch (error) {
        warnings.push(`Could not move ${show.name}'s Drive folder: ${(error as Error).message}`);
      }
    }

    const resync = await resyncCompanySharing({ productionId: showId });
    documentsResynced += resync.total;
    if (resync.failures > 0) {
      warnings.push(
        `${resync.failures} of ${show.name}'s documents could not be re-shared; run the sweep in Admin → Sharing.`,
      );
    }
  }

  // 2. Retire the departing board. Their documents stay; their board access
  //    stops. Anyone still cast or crewed on a show that survived step 1 is
  //    stepped down to a company member instead of being disabled: their term
  //    is over, but they are still in the building, and cutting them off from
  //    their own show's schedule would be a bug rather than a tidy-up.
  for (const memberId of input.memberIds) {
    if (memberId === actor.id) {
      warnings.push("You cannot disable your own account, so you were left alone.");
      continue;
    }
    const member = await prisma.user.findUnique({ where: { id: memberId } });
    if (!member) continue;

    if (member.role === "ADMIN") {
      const remaining = await prisma.user.count({
        where: { role: "ADMIN", status: "ACTIVE", id: { not: memberId } },
      });
      if (remaining === 0) {
        warnings.push(
          `${member.email} is the last admin, so they were left enabled. Promote somebody first.`,
        );
        continue;
      }
    }

    const stillOnAShow = await prisma.productionMember.count({
      where: {
        userId: memberId,
        status: "ACTIVE",
        production: { status: { not: "ARCHIVED" } },
      },
    });

    if (stillOnAShow > 0) {
      await prisma.user.update({ where: { id: memberId }, data: { role: "COMPANY" } });
      steppedDownMembers.push(member.email);
    } else {
      await prisma.user.update({ where: { id: memberId }, data: { status: "DISABLED" } });
      disabledMembers.push(member.email);
    }
  }

  if (steppedDownMembers.length > 0) {
    warnings.push(
      `${steppedDownMembers.join(", ")} ${
        steppedDownMembers.length === 1 ? "is" : "are"
      } still working on a current show, so they were taken off the board rather than disabled. They keep company access to that show and nothing else.`,
    );
  }

  // 3. The new season.
  if (input.newSeason && input.newSeason !== config.currentSeason) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { currentSeason: input.newSeason },
    });
  }

  await prisma.orgConfig.update({
    where: { id: "singleton" },
    data: { lastRolloverAt: new Date() },
  });

  // Either way the board is smaller than Drive thinks it is, so mark
  // everything stale rather than re-sharing hundreds of files inline.
  const retired = disabledMembers.length + steppedDownMembers.length;
  if (retired > 0) {
    await prisma.orgConfig.update({
      where: { id: "singleton" },
      data: { sharingSweepStartedAt: new Date() },
    });
    warnings.push(
      `${retired} ${
        retired === 1 ? "person is" : "people are"
      } off the board. Run the sweep in Admin → Sharing to take their Drive access to board documents away.`,
    );
  }

  await recordAudit({
    actor,
    action: "rollover.run",
    summary: `Rolled over to ${input.newSeason ?? config.currentSeason ?? "a new season"} — archived ${archivedShows.length} ${
      archivedShows.length === 1 ? "show" : "shows"
    }, disabled ${disabledMembers.length}, stepped ${steppedDownMembers.length} down to company`,
    metadata: { archivedShows, disabledMembers, steppedDownMembers },
  });

  return {
    archivedShows,
    disabledMembers,
    steppedDownMembers,
    foldersMoved,
    documentsResynced,
    warnings,
  };
}

/**
 * Private documents belonging to people being disabled. The hub deliberately
 * cannot read or reassign these, so all it can do is name them and tell you to
 * ask before the account goes quiet.
 */
export async function handoverAsks(memberIds: string[]) {
  if (memberIds.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: memberIds } },
    select: {
      id: true,
      name: true,
      email: true,
      _count: {
        select: {
          documents: { where: { visibility: "PRIVATE", status: "ACTIVE" } },
        },
      },
    },
  });
  return rows
    .filter((row) => row._count.documents > 0)
    .map((row) => ({
      email: row.email,
      name: row.name,
      privateCount: row._count.documents,
    }));
}
