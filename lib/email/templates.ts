import type { EmailKind } from "../constants";

/**
 * Plain-text email, deliberately.
 *
 * Everything the hub sends is a short internal note between people who know
 * each other, and plain text survives every client, never looks like
 * marketing, and cannot leak tracking. The only formatting is a blank line.
 */

export type Composed = { subject: string; body: string; kind: EmailKind };

const sign = (orgName: string, appUrl: string) =>
  `\n—\n${orgName} hub · ${appUrl}\nYou're getting this because you're on the hub's member list.`;

export function boardWelcome(input: {
  orgName: string;
  appUrl: string;
  name: string | null;
  roleLabel: string;
  roleBlurb: string;
  addedBy: string;
  googleSignIn: boolean;
}): Composed {
  const greeting = input.name ? `Hi ${input.name.split(" ")[0]},` : "Hi,";
  const paragraphs = [
    greeting,
    `${input.addedBy} added you to the ${input.orgName} hub — one place for the club's budgets, schedules, contact sheets and everything else, instead of hunting through Drive.`,
    `Sign in at ${input.appUrl}${
      input.googleSignIn ? " with the Google account this email arrived at." : "."
    }`,
    `You're set up as ${input.roleLabel}: ${input.roleBlurb}`,
    ...(input.googleSignIn
      ? [
          "The first time you sign in, Google may warn you that the app isn't verified. That's expected for a club's own tool — choose Advanced, then continue.",
        ]
      : []),
    "Anything you create from the hub gets named, filed and shared correctly without you thinking about it.",
  ];

  return {
    kind: "WELCOME_BOARD",
    subject: `You've been added to the ${input.orgName} hub`,
    body: paragraphs.join("\n\n") + sign(input.orgName, input.appUrl),
  };
}

export function companyWelcome(input: {
  orgName: string;
  appUrl: string;
  name: string | null;
  productionName: string;
  roleName: string;
  categoryNames: string[];
  addedBy: string;
}): Composed {
  const greeting = input.name ? `Hi ${input.name.split(" ")[0]},` : "Hi,";
  return {
    kind: "WELCOME_COMPANY",
    subject: `${input.productionName}: everything you need is in one place`,
    body: [
      greeting,
      "",
      `You're on ${input.productionName} with ${input.orgName}, and ${input.addedBy} has set you up on the club's hub.`,
      "",
      `Sign in at ${input.appUrl} with the Google account this email arrived at.`,
      "",
      `As ${input.roleName} you'll find: ${
        input.categoryNames.length > 0
          ? input.categoryNames.join(", ").toLowerCase()
          : "whatever the production team shares with your role"
      }.`,
      "",
      "You'll only see things shared with the company — there's nothing to get lost in, and nothing you can break.",
      "",
      "The first time you sign in, Google may warn you the app isn't verified. That's expected for a club's own tool — choose Advanced, then continue.",
      sign(input.orgName, input.appUrl),
    ].join("\n"),
  };
}

export function privateShareNotice(input: {
  orgName: string;
  appUrl: string;
  name: string | null;
  sharedBy: string;
  documentTitle: string;
  documentUrl: string;
  accessLevel: "READER" | "WRITER";
}): Composed {
  const greeting = input.name ? `Hi ${input.name.split(" ")[0]},` : "Hi,";
  return {
    kind: "SHARE",
    subject: `${input.sharedBy} shared "${input.documentTitle}" with you`,
    body: [
      greeting,
      "",
      `${input.sharedBy} gave you ${
        input.accessLevel === "WRITER" ? "edit" : "view"
      } access to a private document on the ${input.orgName} hub:`,
      "",
      `  ${input.documentTitle}`,
      `  ${input.documentUrl}`,
      "",
      "It's private, so it isn't listed for anyone else — only you, the person who filed it, and anyone else they've added by hand.",
      sign(input.orgName, input.appUrl),
    ].join("\n"),
  };
}

export type DigestData = {
  orgName: string;
  appUrl: string;
  name: string | null;
  since: Date;
  /** The full count; `changed` is only the first few, for display. */
  changedCount: number;
  changed: Array<{ title: string; categoryName: string; productionName: string | null }>;
  created: number;
  quietCategories: string[];
  staleCanva: string[];
  emptyForProduction: Array<{ production: string; categories: string[] }>;
  notSignedIn: number;
};

export function weeklyDigest(input: DigestData): Composed {
  const greeting = input.name ? `Hi ${input.name.split(" ")[0]},` : "Hi,";
  const lines: string[] = [greeting, ""];

  if (input.changedCount === 0) {
    lines.push(`Nothing on the ${input.orgName} hub changed this week.`);
  } else {
    lines.push(
      `${input.changedCount} ${
        input.changedCount === 1 ? "document" : "documents"
      } changed on the ${input.orgName} hub this week${
        input.created > 0 ? `, ${input.created} of them new` : ""
      }:`,
      "",
      ...input.changed
        .slice(0, 12)
        .map(
          (document) =>
            `  · ${document.title} — ${document.categoryName}${
              document.productionName ? ` (${document.productionName})` : ""
            }`,
        ),
    );
    const shown = Math.min(input.changed.length, 12);
    if (input.changedCount > shown) {
      lines.push(`  · and ${input.changedCount - shown} more`);
    }
  }

  // The useful half of a digest is what *hasn't* happened.
  const gaps: string[] = [];
  if (input.quietCategories.length > 0) {
    gaps.push(`Nothing filed in a fortnight: ${input.quietCategories.join(", ")}.`);
  }
  for (const entry of input.emptyForProduction) {
    gaps.push(`${entry.production} still has nothing in: ${entry.categories.join(", ")}.`);
  }
  if (input.staleCanva.length > 0) {
    gaps.push(
      `Canva designs edited since the hub's copy was made: ${input.staleCanva.join(", ")}. Re-export them so the company sees the current version.`,
    );
  }
  if (input.notSignedIn > 0) {
    gaps.push(
      `${input.notSignedIn} ${
        input.notSignedIn === 1 ? "person has" : "people have"
      } been added but never signed in.`,
    );
  }

  if (gaps.length > 0) {
    lines.push("", "Worth a look:", "", ...gaps.map((gap) => `  · ${gap}`));
  }

  lines.push("", input.appUrl, sign(input.orgName, input.appUrl));
  return {
    kind: "DIGEST",
    subject: `${input.orgName} hub: ${
      input.changedCount === 0 ? "a quiet week" : `${input.changedCount} changes this week`
    }`,
    body: lines.join("\n"),
  };
}
