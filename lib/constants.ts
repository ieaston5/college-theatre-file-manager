/**
 * Enum-ish vocabularies. Prisma cannot express enums on SQLite, so these are
 * the single source of truth for the string columns in the schema.
 */

// --- Roles ------------------------------------------------------------------

export const ROLES = ["ADMIN", "BOARD", "MEMBER"] as const;
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
};

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

export const CREATABLE_DOC_TYPES = ["DOC", "SHEET", "SLIDES"] as const;
export type CreatableDocType = (typeof CREATABLE_DOC_TYPES)[number];

/** What the "What should it be?" picker offers. */
export const CREATION_MODES = ["DOC", "SHEET", "SLIDES", "UPLOAD"] as const;
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

export const VISIBILITIES = ["PRIVATE", "BOARD"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

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
  BOARD: {
    label: "Board",
    blurb: "Listed on the dashboard for everyone with hub access and shared with the board's Google Group in Drive. Not visible to anyone outside the group.",
    icon: "users",
    tone: "indigo",
  },
};

// --- Document source & status ----------------------------------------------

export const DOC_SOURCES = ["CREATED", "REGISTERED", "LINK"] as const;
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
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
];

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
