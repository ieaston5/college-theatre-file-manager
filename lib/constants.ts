/**
 * Enum-ish vocabularies. Prisma cannot express enums on SQLite, so these are
 * the single source of truth for the string columns in the schema.
 */

// --- Roles ------------------------------------------------------------------

export const ROLES = ["ADMIN", "BOARD", "MEMBER", "COMPANY"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_META: Record<Role, { label: string; rank: number; blurb: string }> = {
  ADMIN: {
    label: "Admin",
    rank: 3,
    blurb: "Everything a board member can do, plus members, categories, productions and the Google connection.",
  },
  BOARD: {
    label: "Board",
    rank: 2,
    blurb: "Create and edit documents, see everything shared with the board.",
  },
  MEMBER: {
    label: "Member",
    rank: 1,
    blurb: "Read-only access to documents shared with the board.",
  },
  COMPANY: {
    label: "Company",
    rank: 0,
    blurb:
      "No board access at all. Sees only what their production role allows, on the shows they are cast or crewed on.",
  },
};

/** Board roles see board documents; company members never do. */
export function isBoardRole(role: string | null | undefined): boolean {
  return atLeast(role, "MEMBER");
}

/** Roles an admin can hand out on the board side of the Members screen. */
export const BOARD_ROLES = ["ADMIN", "BOARD", "MEMBER"] as const;

export function atLeast(role: string | undefined | null, min: Role): boolean {
  if (!role || !isRole(role)) return false;
  return ROLE_META[role].rank >= ROLE_META[min].rank;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

// --- User status ------------------------------------------------------------

export const USER_STATUSES = ["INVITED", "ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_META: Record<UserStatus, { label: string; tone: Tone }> = {
  INVITED: { label: "Invited", tone: "amber" },
  ACTIVE: { label: "Active", tone: "green" },
  DISABLED: { label: "Disabled", tone: "slate" },
};

// --- Document types ---------------------------------------------------------

export const CREATABLE_DOC_TYPES = ["DOC", "SHEET", "SLIDES", "FORM"] as const;
export type CreatableDocType = (typeof CREATABLE_DOC_TYPES)[number];

/** What the "What should it be?" picker offers. */
export const CREATION_MODES = ["DOC", "SHEET", "SLIDES", "FORM", "UPLOAD", "CANVA"] as const;
export type CreationMode = (typeof CREATION_MODES)[number];

export const DOC_TYPES = [
  "DOC",
  "SHEET",
  "SLIDES",
  "FORM",
  "PDF",
  "IMAGE",
  "AUDIO",
  "VIDEO",
  "ARCHIVE",
  "FOLDER",
  "LINK",
  "CANVA",
  "OTHER",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Types whose bytes the hub uploaded, so a new version can be uploaded over them. */
export const UPLOADED_DOC_TYPES: DocType[] = [
  "PDF",
  "IMAGE",
  "AUDIO",
  "VIDEO",
  "ARCHIVE",
  "OTHER",
];

/** Refused above this; Drive itself allows far more but a club does not need it. */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

// --- Canva ------------------------------------------------------------------

/**
 * Canva's Connect API has no way to grant a person access to a design — there
 * is no design-permission scope or endpoint, and the URLs the API returns are
 * single-user and expire after 30 days. So the hub mirrors a design instead:
 * it exports the design and files the export in Drive, where the hub's own
 * Private/Company/Board model already works. Canva stays the editing surface.
 */
export const CANVA_EXPORT_FORMATS = ["pdf", "pptx"] as const;
export type CanvaExportFormat = (typeof CANVA_EXPORT_FORMATS)[number];

export const CANVA_FORMAT_META: Record<
  CanvaExportFormat,
  { label: string; blurb: string; mimeType: string; extension: string }
> = {
  pdf: {
    label: "PDF",
    blurb: "Opens anywhere, on any phone, with no Canva account. Best for scripts, posters and anything the company just needs to read.",
    mimeType: "application/pdf",
    extension: ".pdf",
  },
  pptx: {
    label: "PowerPoint",
    blurb: "Editable slides, for a deck somebody else has to present or rework outside Canva.",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: ".pptx",
  },
};

/** The scopes the hub asks of the Canva account that owns the exports. */
export const CANVA_SCOPES = ["design:meta:read", "design:content:read", "profile:read"];

export const DOC_TYPE_META: Record<
  DocType,
  { label: string; mimeType: string | null; icon: string; color: string; short: string }
> = {
  DOC: {
    label: "Google Doc",
    mimeType: "application/vnd.google-apps.document",
    icon: "doc",
    color: "#3b82f6",
    short: "Doc",
  },
  SHEET: {
    label: "Google Sheet",
    mimeType: "application/vnd.google-apps.spreadsheet",
    icon: "sheet",
    color: "#16a34a",
    short: "Sheet",
  },
  SLIDES: {
    label: "Google Slides",
    mimeType: "application/vnd.google-apps.presentation",
    icon: "slides",
    color: "#f59e0b",
    short: "Slides",
  },
  FORM: {
    label: "Google Form",
    mimeType: "application/vnd.google-apps.form",
    icon: "form",
    color: "#7c3aed",
    short: "Form",
  },
  PDF: { label: "PDF", mimeType: "application/pdf", icon: "pdf", color: "#dc2626", short: "PDF" },
  IMAGE: { label: "Image", mimeType: null, icon: "image", color: "#0891b2", short: "Image" },
  AUDIO: { label: "Audio", mimeType: null, icon: "music", color: "#7c3aed", short: "Audio" },
  VIDEO: { label: "Video", mimeType: null, icon: "film", color: "#be123c", short: "Video" },
  ARCHIVE: { label: "Archive", mimeType: null, icon: "props", color: "#a16207", short: "Zip" },
  CANVA: { label: "Canva design", mimeType: null, icon: "canva", color: "#00c4cc", short: "Canva" },
  FOLDER: {
    label: "Drive folder",
    mimeType: "application/vnd.google-apps.folder",
    icon: "folder",
    color: "#64748b",
    short: "Folder",
  },
  LINK: { label: "External link", mimeType: null, icon: "link", color: "#0ea5e9", short: "Link" },
  OTHER: { label: "File", mimeType: null, icon: "file", color: "#64748b", short: "File" },
};

/**
 * Best-effort mapping from a MIME type to one of our buckets. Anything we do
 * not recognise lands in OTHER, which is a first-class type — "all file types
 * are supported" means unknown ones still work, they just get a generic icon.
 */
export function docTypeFromMime(mimeType: string | null | undefined): DocType {
  if (!mimeType) return "OTHER";
  const mime = mimeType.toLowerCase();

  const exact = (Object.entries(DOC_TYPE_META) as [DocType, { mimeType: string | null }][]).find(
    ([, meta]) => meta.mimeType === mime,
  );
  if (exact) return exact[0];

  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime.startsWith("video/")) return "VIDEO";
  if (
    /(zip|x-7z|x-rar|x-tar|gzip|compressed)/.test(mime) ||
    mime === "application/x-apple-diskimage"
  ) {
    return "ARCHIVE";
  }
  // Office files stay OTHER on purpose: an .xlsx is not a Google Sheet, and
  // pretending otherwise would mislead people about what they can edit.
  return "OTHER";
}

// --- Visibility -------------------------------------------------------------

export const VISIBILITIES = ["PRIVATE", "COMPANY", "BOARD"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(value: string | null | undefined): value is Visibility {
  return typeof value === "string" && (VISIBILITIES as readonly string[]).includes(value);
}

export const VISIBILITY_META: Record<
  Visibility,
  { label: string; blurb: string; icon: string; tone: Tone }
> = {
  PRIVATE: {
    label: "Private",
    blurb: "Only you (and anyone you add by hand). Never listed on the dashboard for other members and never shared with the group in Google Drive.",
    icon: "lock",
    tone: "amber",
  },
  COMPANY: {
    label: "Company",
    blurb:
      "The board, plus everyone working on this production whose role covers this category. Shared with each of them in Drive as a viewer.",
    icon: "theater",
    tone: "green",
  },
  BOARD: {
    label: "Board",
    blurb: "Listed on the dashboard for everyone with hub access and shared with the board's Google Group in Drive. Not visible to anyone outside the group.",
    icon: "users",
    tone: "indigo",
  },
};

export const MEMBER_STATUSES = ["ACTIVE", "REMOVED"] as const;

// --- who can change a file's contents ---------------------------------------

/**
 * Edit access is a second, narrower ladder than visibility: everyone who can
 * see a document reads it, and this says how far up the same ladder writing
 * goes. It governs Google file contents only — hub curation (category,
 * production, visibility, deletion) always stays with the creator and admins,
 * so an editor can never widen who sees something.
 */
export const EDIT_ACCESS_LEVELS = ["CREATOR_ONLY", "BOARD", "COMPANY"] as const;
export type EditAccess = (typeof EDIT_ACCESS_LEVELS)[number];

export const EDIT_ACCESS_META: Record<
  EditAccess,
  { label: string; blurb: string; icon: string; tint: string }
> = {
  CREATOR_ONLY: {
    label: "Only me",
    blurb:
      "Everyone who can see it reads it. Only you — and anyone you name — can change the file. Right for scripts, reports and anything that should not be edited by committee.",
    icon: "lock",
    tint: "#d97706",
  },
  BOARD: {
    label: "The board",
    blurb: "Board members can edit the file. A company that can see it still only reads.",
    icon: "users",
    tint: "#5b3de0",
  },
  COMPANY: {
    label: "Everyone who can see it",
    blurb:
      "Anyone the document is shared with can edit the file, including the company. Right for a contact sheet people fill in themselves.",
    icon: "theater",
    tint: "#16a34a",
  },
};

/** Editors must be a subset of viewers, so the ladder is capped by visibility. */
export function allowedEditAccess(visibility: string): EditAccess[] {
  if (visibility === "PRIVATE") return ["CREATOR_ONLY"];
  if (visibility === "COMPANY") return ["CREATOR_ONLY", "BOARD", "COMPANY"];
  return ["CREATOR_ONLY", "BOARD"];
}

export function clampEditAccess(visibility: string, editAccess: string): EditAccess {
  const allowed = allowedEditAccess(visibility);
  return allowed.includes(editAccess as EditAccess) ? (editAccess as EditAccess) : allowed[0];
}

// --- how board documents reach the board ------------------------------------

export const SHARE_MODES = ["GROUP", "MEMBERS"] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

export const SHARE_MODE_META: Record<
  ShareMode,
  { label: string; blurb: string; icon: string; tint: string }
> = {
  GROUP: {
    label: "The board's Google Group",
    blurb:
      "One permission per file. Simple, but the hub cannot see who is in the group, so disabling someone here does not remove their access in Drive.",
    icon: "users",
    tint: "#5b3de0",
  },
  MEMBERS: {
    label: "Each board member by name",
    blurb:
      "One permission per person per file. Drive access matches the member list exactly, so disabling someone removes their access everywhere on the next sweep.",
    icon: "user-cog",
    tint: "#16a34a",
  },
};

// --- Document source & status ----------------------------------------------

export const DOC_SOURCES = ["CREATED", "REGISTERED", "LINK", "CANVA"] as const;
export type DocSource = (typeof DOC_SOURCES)[number];

export const DOC_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

// --- Productions ------------------------------------------------------------

export const PRODUCTION_STATUSES = ["PLANNING", "ACTIVE", "CLOSED", "ARCHIVED"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const PRODUCTION_STATUS_META: Record<
  ProductionStatus,
  { label: string; tone: Tone; blurb: string }
> = {
  PLANNING: { label: "In planning", tone: "sky", blurb: "Announced, not yet in rehearsal." },
  ACTIVE: { label: "In production", tone: "green", blurb: "Currently rehearsing or running." },
  CLOSED: { label: "Closed", tone: "slate", blurb: "Finished; paperwork still being wrapped up." },
  ARCHIVED: { label: "Archived", tone: "slate", blurb: "Hidden from the main dashboard." },
};

// --- Category scope ---------------------------------------------------------

export const CATEGORY_SCOPES = ["PRODUCTION", "STANDING", "BOTH"] as const;
export type CategoryScope = (typeof CATEGORY_SCOPES)[number];

export const CATEGORY_SCOPE_META: Record<CategoryScope, { label: string; blurb: string }> = {
  PRODUCTION: {
    label: "Per production",
    blurb: "Documents here must be attached to a show.",
  },
  STANDING: {
    label: "Organisation-wide",
    blurb: "Documents here are not tied to any one show.",
  },
  BOTH: { label: "Either", blurb: "A show is optional." },
};

// --- Access levels ----------------------------------------------------------

export const ACCESS_LEVELS = ["READER", "WRITER"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

// --- Shared UI tones --------------------------------------------------------

export type Tone = "indigo" | "green" | "amber" | "rose" | "sky" | "slate" | "violet";

export const DRIVE_SCOPES = [
  // The hub has to know which account it just connected, so it can show it in
  // Admin and compare file ownership against it. Without an identity scope the
  // access token is good for Drive and refused by the userinfo endpoint, which
  // answers "Request is missing required authentication credential" — an error
  // that sounds like a broken token rather than a missing scope.
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  // Forms are the one Google file type the Drive API cannot create — a blank
  // one has to come from the Forms API. Copying an existing form is a Drive
  // operation, so template-based forms would work without this, but creating
  // one from scratch would not.
  "https://www.googleapis.com/auth/forms.body",
  // Lets the hub send its own mail — onboarding, private-share notices and the
  // weekly digest — from the hub account rather than through a third party.
  "https://www.googleapis.com/auth/gmail.send",
];

export const EMAIL_KINDS = ["WELCOME_BOARD", "WELCOME_COMPANY", "SHARE", "DIGEST"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_KIND_META: Record<EmailKind, { label: string; blurb: string }> = {
  WELCOME_BOARD: {
    label: "Board welcome",
    blurb: "Sent when an admin adds somebody to the board list.",
  },
  WELCOME_COMPANY: {
    label: "Company welcome",
    blurb: "Sent when cast or crew are added to a show.",
  },
  SHARE: {
    label: "Private share",
    blurb: "Sent when somebody gives you access to a private document.",
  },
  DIGEST: {
    label: "Weekly digest",
    blurb: "What changed, and what has gone quiet. Opt-out per person.",
  },
};

/** Placeholders replaced inside template copies. */
export const TEMPLATE_TOKENS = [
  "{{TITLE}}",
  "{{PRODUCTION}}",
  "{{CATEGORY}}",
  "{{SEASON}}",
  "{{OWNER}}",
  "{{DATE}}",
  "{{ORG}}",
] as const;

export const LOGIN_SCOPES = ["openid", "email", "profile"];

export const STANDING_BUCKET = "Organisation-wide";
