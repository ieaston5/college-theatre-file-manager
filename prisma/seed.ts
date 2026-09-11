/**
 * Seeds a realistic-looking hub so it can be evaluated without setting up
 * Google first: categories tuned for a college theatre company, three shows,
 * a handful of board members and a spread of documents.
 *
 * Everything created here is tagged `"sample": true` in Document.metadata and
 * can be wiped from Admin → Settings → Remove sample data.
 *
 * Run with: npm run db:seed   (or npm run db:reset to start clean)
 */

// Load .env for a plain `tsx prisma/seed.ts` run.
try {
  process.loadEnvFile(".env");
} catch {
  // Either the file is missing or the runtime predates loadEnvFile; the
  // Prisma CLI usually populates DATABASE_URL for us anyway.
}

// Sample documents are always written to the simulated Drive, so seeding can
// never touch a real Google account.
process.env.DRIVE_MODE = "mock";
process.env.SESSION_SECRET ??= "seed-only-session-secret-value-not-used";
process.env.APP_ENCRYPTION_KEY ??= "seed-only-encryption-key-not-used";

// The shared client rather than one of its own: it is configured with the
// driver adapter the schema's engineType now requires, and lib/documents —
// which this script calls — writes through it anyway.
import { prisma } from "../lib/db";
import { createDocument } from "../lib/documents";
import { driveProvider, ensureRootFolders } from "../lib/google";
import { slugify } from "../lib/utils";

const SAMPLE_DOMAIN = "pennplayers.example";

/**
 * The seven categories a production company can be given access to. Everything
 * else (budgets, casting, box office, governance, grants, venue) stays
 * board-only and is never offered as "Company".
 */
const CATEGORIES = [
  {
    name: "Budgets & finance",
    keywords:
      "budget, receipts, reimbursement, invoice, expenses, spend, finance, deposit, petty cash, treasurer",
    icon: "budget",
    color: "#16a34a",
    scope: "BOTH",
    defaultDocType: "SHEET",
    description: "Show budgets, receipts and reimbursement trackers. One running sheet per show.",
    sortOrder: 10,
  },
  {
    name: "Schedules & calendars",
    keywords:
      "schedule, calendar, rehearsal schedule, call, tech week, timeline, dates, availability, when2meet",
    companyVisible: true,
    icon: "calendar",
    color: "#0ea5e9",
    scope: "BOTH",
    defaultDocType: "SHEET",
    description:
      "When you are called and where: rehearsal calendars, tech week, and the season at a glance.",
    sortOrder: 20,
  },
  {
    name: "Rehearsal reports",
    defaultEditAccess: "CREATOR_ONLY",
    keywords:
      "rehearsal report, report, nightly, notes, sm report",
    companyVisible: true,
    icon: "clipboard",
    color: "#6366f1",
    scope: "PRODUCTION",
    defaultDocType: "DOC",
    description:
      "What happened at each rehearsal — absences, injuries and notes for every department. One per night, from stage management.",
    sortOrder: 30,
  },
  {
    name: "Contact sheets",
    defaultEditAccess: "COMPANY",
    keywords:
      "contact, contacts, phone, roster, emergency, directory, cast list, crew list",
    companyVisible: true,
    icon: "users",
    color: "#7c3aed",
    scope: "BOTH",
    defaultDocType: "SHEET",
    description: "How to reach everyone on the show, in one place instead of six group chats.",
    sortOrder: 40,
  },
  {
    name: "Scripts & scores",
    defaultEditAccess: "CREATOR_ONLY",
    keywords:
      "script, score, libretto, book, cuts, sides, monologue, vocal, sheet music, perusal",
    companyVisible: true,
    icon: "script",
    color: "#b45309",
    scope: "PRODUCTION",
    defaultDocType: "DOC",
    description:
      "The script, the score, sides and the current cut list. Read them here rather than from whichever copy got forwarded to you.",
    sortOrder: 50,
  },
  {
    name: "Casting & auditions",
    defaultEditAccess: "CREATOR_ONLY",
    keywords:
      "audition, callback, casting, headshot, sign-up, signup, resume, tape",
    icon: "mic",
    color: "#db2777",
    scope: "PRODUCTION",
    defaultDocType: "SHEET",
    description: "Audition sign-ups, callback lists and casting decisions. Usually private first.",
    defaultVisibility: "PRIVATE",
    sortOrder: 60,
  },
  {
    name: "Design & tech",
    keywords:
      "light plot, lighting, sound, cue, plot, rider, tech, channel, hookup, projection, set, drawing, ground plan",
    companyVisible: true,
    icon: "palette",
    color: "#ea580c",
    scope: "PRODUCTION",
    defaultDocType: "DOC",
    description:
      "How the show gets built and run: light plots, sound cues, set drawings, riders and load-in plans.",
    sortOrder: 70,
  },
  {
    name: "Costumes & props",
    keywords:
      "costume, props, wardrobe, measurements, piece list, fitting, borrow, return, pull",
    companyVisible: true,
    icon: "costume",
    color: "#0d9488",
    scope: "PRODUCTION",
    defaultDocType: "SHEET",
    description:
      "What you are wearing and carrying, who it belongs to, and what has to go back after closing.",
    sortOrder: 80,
  },
  {
    name: "Marketing & publicity",
    keywords:
      "poster, publicity, marketing, social, press, promo, flyer, photo call, program, programme",
    icon: "marketing",
    color: "#e11d48",
    scope: "BOTH",
    defaultDocType: "DOC",
    description: "Poster copy, social calendars, press releases and photo call plans.",
    sortOrder: 90,
  },
  {
    name: "Box office & house",
    keywords:
      "box office, tickets, ticket sales, comp, house, front of house, usher, settlement, attendance",
    icon: "ticket",
    color: "#f59e0b",
    scope: "PRODUCTION",
    defaultDocType: "SHEET",
    description: "Ticket counts, comp lists, front-of-house assignments and settlement.",
    sortOrder: 100,
  },
  {
    name: "Board & governance",
    defaultEditAccess: "CREATOR_ONLY",
    keywords:
      "minutes, agenda, constitution, bylaws, board, election, policy, vote",
    icon: "gavel",
    color: "#475569",
    scope: "STANDING",
    defaultDocType: "DOC",
    description: "Meeting minutes, the constitution, elections and policy documents.",
    sortOrder: 110,
  },
  {
    name: "Venue & facilities",
    keywords:
      "venue, space request, room, key, access, safety, facilities, load-in, booking",
    icon: "venue",
    color: "#334155",
    scope: "STANDING",
    defaultDocType: "DOC",
    description: "Space requests, keys and access, safety paperwork, venue contacts.",
    sortOrder: 120,
  },
  {
    name: "Handbooks & onboarding",
    keywords:
      "handbook, onboarding, how to, guide, handover, transition, role description, training",
    companyVisible: true,
    icon: "script",
    color: "#4f46e5",
    scope: "STANDING",
    defaultDocType: "DOC",
    description:
      "How things are done here — guides for the job you are doing, and what to hand on to whoever does it next.",
    sortOrder: 130,
  },
  {
    name: "Grants & sponsorship",
    keywords:
      "grant, sac, funding, sponsor, sponsorship, application, donation, fundraising",
    icon: "sparkles",
    color: "#9333ea",
    scope: "STANDING",
    defaultDocType: "DOC",
    description: "SAC funding applications, sponsor decks and thank-you tracking.",
    sortOrder: 140,
  },
];

const MEMBERS = [
  { name: "Rowan Ellis", position: "President", role: "ADMIN", email: `rowan.ellis@${SAMPLE_DOMAIN}` },
  { name: "Priya Nandakumar", position: "Treasurer", role: "BOARD", email: `priya.n@${SAMPLE_DOMAIN}` },
  { name: "Diego Salas", position: "Technical Director", role: "BOARD", email: `diego.salas@${SAMPLE_DOMAIN}` },
  { name: "Maya Okonkwo", position: "Stage Manager", role: "BOARD", email: `maya.o@${SAMPLE_DOMAIN}` },
  { name: "Sam Whitfield", position: "Marketing Chair", role: "BOARD", email: `sam.w@${SAMPLE_DOMAIN}` },
  { name: "Jordan Lee", position: "Company member", role: "MEMBER", email: `jordan.lee@${SAMPLE_DOMAIN}` },
];

const PRODUCTIONS = [
  {
    name: "Urinetown",
    abbreviation: "URINETOWN",
    season: "Fall 2026",
    status: "ACTIVE",
    venue: "Iron Gate Theatre",
    synopsis: "Fall mainstage. Rehearsals started 25 Aug, opens 16 Oct.",
    opensOn: new Date("2026-10-16"),
    closesOn: new Date("2026-10-24"),
    sortOrder: 10,
  },
  {
    name: "The Spelling Bee",
    abbreviation: "BEE",
    season: "Spring 2027",
    status: "PLANNING",
    venue: "Harold Prince Theatre",
    synopsis: "Spring musical. Auditions in November, budget still being drafted.",
    opensOn: new Date("2027-02-19"),
    sortOrder: 20,
  },
  {
    name: "Much Ado About Nothing",
    abbreviation: "MUCHADO",
    season: "Spring 2026",
    status: "CLOSED",
    venue: "Iron Gate Theatre",
    synopsis: "Closed 4 Apr 2026. Kept for budget and marketing reference.",
    opensOn: new Date("2026-03-27"),
    closesOn: new Date("2026-04-04"),
    sortOrder: 30,
  },
];

type DocSpec = {
  title: string;
  category: string;
  production?: string;
  docType: "DOC" | "SHEET" | "SLIDES";
  visibility?: "PRIVATE" | "COMPANY" | "BOARD";
  creator: string; // member email or "admin"
  description?: string;
  tags?: string;
  pinned?: boolean;
  archived?: boolean;
  registered?: boolean;
};

const DOCUMENTS: DocSpec[] = [
  {
    title: "Running budget",
    category: "Budgets & finance",
    production: "Urinetown",
    docType: "SHEET",
    creator: `priya.n@${SAMPLE_DOMAIN}`,
    description: "Every line of spend for the fall mainstage. Update after each purchase.",
    tags: "budget, weekly",
    pinned: true,
  },
  {
    title: "Reimbursement requests",
    category: "Budgets & finance",
    docType: "SHEET",
    creator: `priya.n@${SAMPLE_DOMAIN}`,
    description: "Rolling form responses. Treasurer clears these every Sunday.",
    tags: "reimbursement",
  },
  {
    title: "Season budget 2026–27",
    category: "Budgets & finance",
    docType: "SHEET",
    creator: `priya.n@${SAMPLE_DOMAIN}`,
    description: "Board-approved allocation across both shows plus overhead.",
    registered: true,
  },
  {
    title: "Rehearsal calendar",
    category: "Schedules & calendars",
    production: "Urinetown",
    docType: "SHEET",
    visibility: "COMPANY",
    creator: `maya.o@${SAMPLE_DOMAIN}`,
    description: "Who is called when, through opening. Changes are announced in the group chat.",
    tags: "weekly",
    pinned: true,
  },
  {
    title: "Tech week schedule",
    category: "Schedules & calendars",
    production: "Urinetown",
    docType: "SHEET",
    visibility: "COMPANY",
    creator: `diego.salas@${SAMPLE_DOMAIN}`,
    description: "Load-in through final dress, hour by hour.",
    tags: "tech, load-in",
  },
  {
    title: "Rehearsal report — 28 Aug",
    category: "Rehearsal reports",
    production: "Urinetown",
    docType: "DOC",
    visibility: "COMPANY",
    creator: `maya.o@${SAMPLE_DOMAIN}`,
    description: "Act I blocking. Two absences, one prop request.",
  },
  {
    title: "Rehearsal report — 30 Aug",
    category: "Rehearsal reports",
    production: "Urinetown",
    docType: "DOC",
    visibility: "COMPANY",
    creator: `maya.o@${SAMPLE_DOMAIN}`,
  },
  {
    title: "Cast & crew contacts",
    category: "Contact sheets",
    production: "Urinetown",
    docType: "SHEET",
    visibility: "COMPANY",
    creator: `maya.o@${SAMPLE_DOMAIN}`,
    description: "Phone, email and emergency contact for everyone on the show.",
    tags: "contacts",
  },
  {
    title: "Vendor & rental contacts",
    category: "Contact sheets",
    docType: "SHEET",
    creator: `diego.salas@${SAMPLE_DOMAIN}`,
    description: "Lighting rental, costume shops, print shop — with who we last dealt with.",
  },
  {
    title: "Audition sign-ups",
    category: "Casting & auditions",
    production: "The Spelling Bee",
    docType: "SHEET",
    visibility: "PRIVATE",
    creator: "admin",
    description: "Slots and monologue choices. Private until casting is announced.",
  },
  {
    title: "Callback notes",
    category: "Casting & auditions",
    production: "The Spelling Bee",
    docType: "DOC",
    visibility: "PRIVATE",
    creator: "admin",
    description: "Panel notes. Deliberately not shared with the board.",
  },
  {
    title: "Light plot & instrument schedule",
    category: "Design & tech",
    production: "Urinetown",
    docType: "SHEET",
    visibility: "COMPANY",
    creator: `diego.salas@${SAMPLE_DOMAIN}`,
    description: "Channel hookup, dimmer assignments and focus notes.",
    tags: "lighting",
  },
  {
    title: "Sound cue list",
    category: "Design & tech",
    production: "Urinetown",
    docType: "SHEET",
    visibility: "COMPANY",
    creator: `diego.salas@${SAMPLE_DOMAIN}`,
  },
  {
    title: "Tech rider",
    category: "Design & tech",
    production: "Urinetown",
    docType: "DOC",
    creator: `diego.salas@${SAMPLE_DOMAIN}`,
    description: "What we need from the venue. Send with every space request.",
  },
  {
    title: "Props tracking",
    category: "Costumes & props",
    production: "Urinetown",
    docType: "SHEET",
    visibility: "COMPANY",
    creator: `maya.o@${SAMPLE_DOMAIN}`,
    description: "Borrowed, bought, built — and what has to go back after closing.",
    tags: "props, returns",
  },
  {
    title: "Costume piece list",
    category: "Costumes & props",
    production: "Urinetown",
    docType: "SHEET",
    visibility: "COMPANY",
    creator: `sam.w@${SAMPLE_DOMAIN}`,
  },
  {
    title: "Publicity plan",
    category: "Marketing & publicity",
    production: "Urinetown",
    docType: "DOC",
    creator: `sam.w@${SAMPLE_DOMAIN}`,
    description: "Poster drop, social calendar, class announcements and press list.",
    tags: "sponsors",
  },
  {
    title: "Social media calendar",
    category: "Marketing & publicity",
    docType: "SHEET",
    creator: `sam.w@${SAMPLE_DOMAIN}`,
    description: "Everything scheduled across both shows.",
  },
  {
    title: "Front of house assignments",
    category: "Box office & house",
    production: "Urinetown",
    docType: "SHEET",
    creator: `sam.w@${SAMPLE_DOMAIN}`,
    description: "Ushers, box office shifts and comp list per performance.",
  },
  {
    title: "Board minutes — 26 Aug 2026",
    category: "Board & governance",
    docType: "DOC",
    creator: "admin",
    description: "Includes the decision on the spring slot and the new reimbursement rule.",
    tags: "minutes",
  },
  {
    title: "Constitution & bylaws",
    category: "Board & governance",
    docType: "DOC",
    creator: "admin",
    description: "Last amended April 2026.",
    registered: true,
  },
  {
    title: "Space request process",
    category: "Venue & facilities",
    docType: "DOC",
    creator: `diego.salas@${SAMPLE_DOMAIN}`,
    description: "How to book the Iron Gate, who signs off, and how far ahead.",
  },
  {
    title: "Production manager handbook",
    category: "Handbooks & onboarding",
    docType: "DOC",
    creator: "admin",
    description: "What this job actually involves, week by week. Written for next year's PM.",
    pinned: true,
  },
  {
    title: "Treasurer handbook",
    category: "Handbooks & onboarding",
    docType: "DOC",
    creator: `priya.n@${SAMPLE_DOMAIN}`,
  },
  {
    title: "SAC funding application — spring",
    category: "Grants & sponsorship",
    docType: "DOC",
    creator: `priya.n@${SAMPLE_DOMAIN}`,
    description: "Draft. Due mid-November.",
  },
  {
    title: "Much Ado closing budget",
    category: "Budgets & finance",
    production: "Much Ado About Nothing",
    docType: "SHEET",
    creator: `priya.n@${SAMPLE_DOMAIN}`,
    description: "Final numbers from spring. Useful for comparison.",
    archived: true,
  },
];

/**
 * Production roles decide which of the company-visible categories each person
 * gets. Everyone gets the schedule, the contact sheet and the handbooks;
 * design & tech and costumes & props go to the people who need them.
 */
const PRODUCTION_ROLES = [
  {
    name: "Cast",
    description: "Performers. Schedule, script, contact sheet, rehearsal reports.",
    isDefault: true,
    sortOrder: 10,
    categories: [
      "Schedules & calendars",
      "Rehearsal reports",
      "Contact sheets",
      "Scripts & scores",
      "Handbooks & onboarding",
    ],
  },
  {
    name: "Stage management",
    description: "Runs the room. Sees everything a company member can see, and files reports.",
    sortOrder: 20,
    canCreate: true,
    categories: [
      "Schedules & calendars",
      "Rehearsal reports",
      "Contact sheets",
      "Scripts & scores",
      "Design & tech",
      "Costumes & props",
      "Handbooks & onboarding",
    ],
  },
  {
    name: "Design & tech",
    description: "Designers, board operators, crew. Plots, riders and piece lists.",
    sortOrder: 30,
    categories: [
      "Schedules & calendars",
      "Rehearsal reports",
      "Contact sheets",
      "Design & tech",
      "Costumes & props",
      "Handbooks & onboarding",
    ],
  },
  {
    name: "Costumes & props",
    description: "Wardrobe and props crew.",
    sortOrder: 40,
    categories: [
      "Schedules & calendars",
      "Contact sheets",
      "Costumes & props",
      "Handbooks & onboarding",
    ],
  },
  {
    name: "Music",
    description: "Orchestra and music staff. Score, schedule, contacts.",
    sortOrder: 50,
    categories: [
      "Schedules & calendars",
      "Rehearsal reports",
      "Contact sheets",
      "Scripts & scores",
      "Handbooks & onboarding",
    ],
  },
];

/** A sample company for the active show, so the access layer is visible. */
const COMPANY = [
  { name: "Nadia Brooks", email: "nadia.brooks@pennplayers.example", role: "Cast", title: "Hope Cladwell" },
  { name: "Theo Marchetti", email: "theo.m@pennplayers.example", role: "Cast", title: "Bobby Strong" },
  { name: "Ines Duarte", email: "ines.duarte@pennplayers.example", role: "Cast", title: "Ensemble" },
  { name: "Wes Kaplan", email: "wes.kaplan@pennplayers.example", role: "Design & tech", title: "Lighting Designer" },
  { name: "Amara Osei", email: "amara.osei@pennplayers.example", role: "Design & tech", title: "Sound Designer" },
  { name: "Bea Lindqvist", email: "bea.l@pennplayers.example", role: "Costumes & props", title: "Wardrobe Supervisor" },
  { name: "Curtis Yang", email: "curtis.yang@pennplayers.example", role: "Music", title: "Conductor" },
];

const TEMPLATES = [
  {
    name: "Rehearsal report",
    docType: "DOC" as const,
    category: "Rehearsal reports",
    description: "Standard nightly report — absences, injuries, notes for each department.",
  },
  {
    name: "Show budget skeleton",
    docType: "SHEET" as const,
    category: "Budgets & finance",
    description: "Pre-built categories, formulas and a summary tab.",
  },
  {
    name: "Contact sheet",
    docType: "SHEET" as const,
    category: "Contact sheets",
    description: "Columns for role, phone, email and emergency contact.",
  },
];

async function main() {
  const bootstrapEmail =
    (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase() ||
    "admin@pennplayers.example";

  /**
   * Seeding a *deployed* database while the hub is on the simulated Drive is a
   * trap worth naming out loud, because it happened.
   *
   * The sample content needs somewhere to put files, so in simulated mode the
   * seed writes an account row with mock folder ids and no Google token. On a
   * laptop that is exactly right. Against the database a real deployment uses,
   * it leaves what looks like a working Google connection and templates
   * pointing at files that exist nowhere — and the deployment, which is in
   * Google mode, cannot file anything.
   */
  const simulated = (process.env.DRIVE_MODE ?? "auto") !== "google" && !process.env.GOOGLE_CLIENT_ID;
  const remoteDatabase = !(process.env.DATABASE_URL ?? "").startsWith("file:");
  if (simulated && remoteDatabase) {
    console.log(
      [
        "",
        "  ⚠  Seeding a remote database while the Drive is simulated.",
        "",
        "     The categories, roles, people and checklists are all real and are",
        "     what you want. But the sample documents, the templates and the",
        "     Google account row will hold simulated ids, and a deployment",
        "     running in Google mode cannot use any of them.",
        "",
        "     After signing in to the deployment:",
        "       Admin → Settings → Remove sample data   (clears all three)",
        "       Admin → Google connection → Connect     (the real account)",
        "",
      ].join("\n"),
    );
  }

  console.log("→ configuration");
  await prisma.orgConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      orgName: "Penn Players",
      currentSeason: "Fall 2026",
      // Placeholder so the board/private distinction is visible straight away.
      // Change it in Admin → Settings before connecting a real Google account.
      groupEmail: "pennplayers-board@googlegroups.com",
      groupCanEdit: true,
      namingTemplate: "[{production}] {title} — {category}",
      driveRootName: "Penn Players Hub",
      stampDocHeader: true,
    },
    update: {},
  });

  console.log("→ people");
  const admin = await prisma.user.upsert({
    where: { email: bootstrapEmail },
    create: {
      email: bootstrapEmail,
      name: "Production Manager",
      position: "Production Manager",
      role: "ADMIN",
      status: "ACTIVE",
    },
    update: { role: "ADMIN", status: "ACTIVE" },
  });

  const members = new Map<string, { id: string; email: string; name: string | null; role: string }>();
  members.set("admin", admin);
  members.set(admin.email, admin);
  for (const person of MEMBERS) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      create: { ...person, status: "ACTIVE" },
      update: { name: person.name, position: person.position, role: person.role },
    });
    members.set(person.email, user);
  }

  console.log("→ categories");
  const categories = new Map<string, { id: string; name: string }>();
  for (const category of CATEGORIES) {
    const slug = slugify(category.name);
    const row = await prisma.category.upsert({
      where: { slug },
      create: {
        slug,
        name: category.name,
        description: category.description,
        icon: category.icon,
        color: category.color,
        scope: category.scope,
        defaultDocType: category.defaultDocType,
        defaultVisibility: category.defaultVisibility ?? "BOARD",
        companyVisible: category.companyVisible ?? false,
        defaultEditAccess: category.defaultEditAccess ?? "BOARD",
        keywords: category.keywords ?? null,
        sortOrder: category.sortOrder,
      },
      update: {
        name: category.name,
        description: category.description,
        icon: category.icon,
        color: category.color,
        scope: category.scope,
        defaultDocType: category.defaultDocType,
        defaultVisibility: category.defaultVisibility ?? "BOARD",
        companyVisible: category.companyVisible ?? false,
        defaultEditAccess: category.defaultEditAccess ?? "BOARD",
        keywords: category.keywords ?? null,
        sortOrder: category.sortOrder,
      },
    });
    categories.set(category.name, row);
  }

  console.log("→ productions");
  const productions = new Map<string, { id: string; name: string }>();
  for (const production of PRODUCTIONS) {
    const slug = `sample-${slugify(production.name)}`;
    const row = await prisma.production.upsert({
      where: { slug },
      create: { ...production, slug },
      update: { ...production, slug },
    });
    productions.set(production.name, row);
  }

  console.log("→ production roles");
  const roles = new Map<string, { id: string; name: string }>();
  for (const role of PRODUCTION_ROLES) {
    const slug = slugify(role.name);
    const categoryIds = role.categories
      .map((name) => categories.get(name)?.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id }));
    const row = await prisma.productionRole.upsert({
      where: { slug },
      create: {
        slug,
        name: role.name,
        description: role.description,
        isDefault: role.isDefault ?? false,
        canCreate: role.canCreate ?? false,
        sortOrder: role.sortOrder,
        categories: { connect: categoryIds },
      },
      update: {
        name: role.name,
        description: role.description,
        isDefault: role.isDefault ?? false,
        canCreate: role.canCreate ?? false,
        sortOrder: role.sortOrder,
        categories: { set: categoryIds },
      },
    });
    roles.set(role.name, row);
  }

  console.log("→ company for the active show");
  const activeShow = productions.get("Urinetown");
  if (activeShow) {
    for (const person of COMPANY) {
      const user = await prisma.user.upsert({
        where: { email: person.email },
        create: {
          email: person.email,
          name: person.name,
          role: "COMPANY",
          status: "ACTIVE",
        },
        update: { name: person.name },
      });
      const roleId = roles.get(person.role)?.id ?? null;
      await prisma.productionMember.upsert({
        where: { productionId_userId: { productionId: activeShow.id, userId: user.id } },
        create: {
          productionId: activeShow.id,
          userId: user.id,
          roleId,
          title: person.title,
          addedById: admin.id,
        },
        update: { roleId, title: person.title },
      });
    }
  }

  console.log("→ checklist template");
  const { DEFAULT_CHECKLIST } = await import("../lib/checklist");
  const existingTemplate = await prisma.checklistTemplateItem.count();
  if (existingTemplate === 0) {
    let order = 0;
    for (const item of DEFAULT_CHECKLIST) {
      order += 10;
      await prisma.checklistTemplateItem.create({
        data: {
          label: item.label,
          hint: item.hint ?? null,
          sortOrder: order,
          categoryId: item.categorySlug
            ? ((await prisma.category.findUnique({ where: { slug: item.categorySlug } }))?.id ??
              null)
            : null,
        },
      });
    }
  }

  console.log("→ checklists for each show");
  const { seedChecklistFor } = await import("../lib/checklist");
  for (const production of productions.values()) {
    await seedChecklistFor(production.id);
  }

  console.log("→ drive folders (simulated)");
  await ensureRootFolders();

  console.log("→ templates");
  const provider = driveProvider();
  const { rootFolderId } = await ensureRootFolders();
  const templateFolderId = await provider.ensureFolder("Templates", rootFolderId);
  for (const template of TEMPLATES) {
    const existing = await prisma.template.findFirst({ where: { name: template.name } });
    if (existing) continue;
    const file = await provider.createDocument({
      name: `TEMPLATE — ${template.name}`,
      docType: template.docType,
      parentFolderId: templateFolderId,
      description: template.description,
    });
    await prisma.template.create({
      data: {
        name: template.name,
        description: template.description,
        docType: template.docType,
        googleFileId: file.id,
        categoryId: categories.get(template.category)?.id ?? null,
      },
    });
  }

  console.log("→ documents");
  const existingCount = await prisma.document.count();
  if (existingCount > 0) {
    console.log(`   ${existingCount} documents already present — skipping sample documents.`);
  } else {
    let created = 0;
    for (const spec of DOCUMENTS) {
      const creator = members.get(spec.creator) ?? admin;
      const category = categories.get(spec.category);
      if (!category) throw new Error(`Unknown sample category: ${spec.category}`);

      const { document } = await createDocument(creator as never, {
        title: spec.title,
        description: spec.description,
        docType: spec.docType,
        categoryId: category.id,
        productionId: spec.production ? productions.get(spec.production)?.id : undefined,
        visibility: spec.visibility ?? "BOARD",
        tags: spec.tags,
      });

      await prisma.document.update({
        where: { id: document.id },
        data: {
          pinned: spec.pinned ?? false,
          status: spec.archived ? "ARCHIVED" : "ACTIVE",
          source: spec.registered ? "REGISTERED" : "CREATED",
          metadata: JSON.stringify({ sample: true, createdVia: "seed" }),
          // Spread the timestamps out so "recently updated" looks real.
          updatedAt: new Date(Date.now() - created * 7 * 60 * 60 * 1000),
        },
      });
      created += 1;
    }
    console.log(`   created ${created} sample documents`);
  }

  console.log("→ a private document shared with one person");
  const privateDoc = await prisma.document.findFirst({
    where: { visibility: "PRIVATE", creatorId: admin.id },
  });
  const treasurer = members.get(`priya.n@${SAMPLE_DOMAIN}`);
  if (privateDoc && treasurer) {
    await prisma.documentShare.upsert({
      where: { documentId_userId: { documentId: privateDoc.id, userId: treasurer.id } },
      create: {
        documentId: privateDoc.id,
        userId: treasurer.id,
        accessLevel: "READER",
        grantedById: admin.id,
      },
      update: {},
    });
  }

  const counts = {
    documents: await prisma.document.count(),
    categories: await prisma.category.count(),
    productions: await prisma.production.count(),
    members: await prisma.user.count(),
  };

  console.log("\nSeeded:", counts);
  console.log(`\nSign in as ${admin.email} (local sign-in works with no Google set up).`);
  console.log(
    "Reminder: the sample board group is pennplayers-board@googlegroups.com — change it in Admin → Settings before connecting a real Google account.",
  );
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
