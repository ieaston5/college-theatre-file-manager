import { z } from "zod";
import {
  ACCESS_LEVELS,
  CANVA_EXPORT_FORMATS,
  CATEGORY_SCOPES,
  EDIT_ACCESS_LEVELS,
  CREATABLE_DOC_TYPES,
  DOC_TYPES,
  PRODUCTION_STATUSES,
  ROLES,
  SHARE_MODES,
  UPLOAD_MAX_BYTES,
  VISIBILITIES,
} from "./constants";

const title = z
  .string()
  .trim()
  .min(2, "Give it a name of at least 2 characters.")
  .max(160, "Keep the name under 160 characters.");

const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const createDocumentSchema = z.object({
  title,
  description: optionalText(1000),
  docType: z.enum(CREATABLE_DOC_TYPES),
  categoryId: z.string().min(1, "Pick a category."),
  productionId: z
    .string()
    .optional()
    .transform((value) => (value && value !== "none" ? value : undefined)),
  visibility: z.enum(VISIBILITIES),
  editAccess: z.enum(EDIT_ACCESS_LEVELS).optional(),
  templateId: z
    .string()
    .optional()
    .transform((value) => (value && value !== "blank" ? value : undefined)),
  tags: optionalText(400),
});
export type CreateDocumentInputRaw = z.input<typeof createDocumentSchema>;

export const registerDocumentSchema = z.object({
  title,
  description: optionalText(1000),
  link: z.string().trim().min(4, "Paste the link to the file."),
  categoryId: z.string().min(1, "Pick a category."),
  productionId: z
    .string()
    .optional()
    .transform((value) => (value && value !== "none" ? value : undefined)),
  visibility: z.enum(VISIBILITIES),
  editAccess: z.enum(EDIT_ACCESS_LEVELS).optional(),
  tags: optionalText(400),
  /** Move the file into the hub's Drive folder tree (needs edit access). */
  organize: z.coerce.boolean().optional().default(false),
  /** Treat as a plain external link and skip Drive entirely. */
  externalOnly: z.coerce.boolean().optional().default(false),
  docType: z.enum(DOC_TYPES).optional(),
});

export const updateDocumentSchema = z.object({
  id: z.string().min(1),
  title,
  description: optionalText(1000),
  categoryId: z.string().min(1),
  productionId: z
    .string()
    .optional()
    .transform((value) => (value && value !== "none" ? value : undefined)),
  visibility: z.enum(VISIBILITIES),
  editAccess: z.enum(EDIT_ACCESS_LEVELS).optional(),
  tags: optionalText(400),
  pinned: z.coerce.boolean().optional().default(false),
});

/** Mirroring a Canva design: the link, plus the usual filing fields. */
export const canvaMirrorSchema = z.object({
  link: z.string().trim().min(8, "Paste the link to the Canva design."),
  title: optionalText(160),
  description: optionalText(1000),
  categoryId: z.string().min(1, "Pick a category."),
  productionId: z
    .string()
    .optional()
    .transform((value) => (value && value !== "none" ? value : undefined)),
  visibility: z.enum(VISIBILITIES),
  editAccess: z.enum(EDIT_ACCESS_LEVELS).optional(),
  tags: optionalText(400),
  format: z.enum(CANVA_EXPORT_FORMATS).default("pdf"),
});

/** The metadata the browser sends before it starts pushing bytes. */
export const uploadStartSchema = z.object({
  mode: z.enum(["new", "version"]).default("new"),
  documentId: z.string().optional(),
  title: z.string().trim().max(160).optional(),
  description: optionalText(1000),
  categoryId: z.string().optional(),
  productionId: z
    .string()
    .optional()
    .transform((value) => (value && value !== "none" ? value : undefined)),
  visibility: z.enum(VISIBILITIES).optional(),
  editAccess: z.enum(EDIT_ACCESS_LEVELS).optional(),
  tags: optionalText(400),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().min(1).max(255).default("application/octet-stream"),
  sizeBytes: z.coerce.number().int().min(0).max(UPLOAD_MAX_BYTES, {
    message: "That file is larger than the 100 MB limit.",
  }),
});

export const uploadFinishSchema = z.object({
  uploadId: z.string().min(1),
  fileId: z.string().min(1).optional(),
});

export const productionSchema = z.object({
  id: z.string().optional(),
  name: title,
  abbreviation: optionalText(24),
  season: optionalText(60),
  status: z.enum(PRODUCTION_STATUSES),
  venue: optionalText(120),
  synopsis: optionalText(2000),
  opensOn: optionalText(20),
  closesOn: optionalText(20),
  color: optionalText(12),
});

export const categorySchema = z.object({
  id: z.string().optional(),
  name: title,
  description: optionalText(400),
  icon: z.string().trim().min(1).max(40).default("folder"),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #6366f1")
    .default("#6366f1"),
  scope: z.enum(CATEGORY_SCOPES),
  defaultDocType: z
    .union([z.enum(CREATABLE_DOC_TYPES), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  defaultVisibility: z.enum(VISIBILITIES),
  folderName: optionalText(120),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  companyVisible: z.coerce.boolean().optional().default(false),
  defaultEditAccess: z.enum(EDIT_ACCESS_LEVELS).default("BOARD"),
  keywords: optionalText(400),
});

export const templateSchema = z.object({
  id: z.string().optional(),
  name: title,
  description: optionalText(400),
  docType: z.enum(CREATABLE_DOC_TYPES),
  link: z.string().trim().min(4, "Paste the link to the template file."),
  categoryId: z
    .string()
    .optional()
    .transform((value) => (value && value !== "any" ? value : undefined)),
});

export const memberSchema = z.object({
  id: z.string().optional(),
  email: z.string().trim().toLowerCase().email("That does not look like an email address."),
  name: optionalText(120),
  position: optionalText(120),
  role: z.enum(ROLES),
});

// --- production companies ---------------------------------------------------

export const addCompanyMembersSchema = z.object({
  productionId: z.string().min(1, "Pick a production."),
  roleId: z.string().min(1, "Pick what they are doing on the show."),
  people: z.string().trim().min(3, "Paste at least one email address."),
});

export const membershipSchema = z.object({
  id: z.string().min(1),
  roleId: z.string().min(1),
  title: optionalText(120),
});

export const productionRoleSchema = z.object({
  id: z.string().optional(),
  name: title,
  description: optionalText(400),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isDefault: z.coerce.boolean().optional().default(false),
  canCreate: z.coerce.boolean().optional().default(false),
  categoryIds: z.array(z.string()).default([]),
});

export const configSchema = z.object({
  orgName: z.string().trim().min(2).max(120),
  shareMode: z.enum(SHARE_MODES).default("GROUP"),
  groupEmail: z
    .union([z.string().trim().toLowerCase().email("That does not look like an email address."), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  groupCanEdit: z.coerce.boolean().optional().default(false),
  namingTemplate: z.string().trim().min(3).max(200),
  driveRootName: z.string().trim().min(2).max(120),
  currentSeason: optionalText(60),
  stampDocHeader: z.coerce.boolean().optional().default(false),
});

export const groupAuditSchema = z.object({
  members: z.string().trim().min(3, "Paste the group's member list."),
});

export const shareSchema = z.object({
  documentId: z.string().min(1),
  userId: z.string().min(1),
  accessLevel: z.enum(ACCESS_LEVELS),
});

/** Turn a ZodError into a single readable sentence for the form banner. */
export function firstError(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Something in that form was not valid.";
}
