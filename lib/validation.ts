import { z } from "zod";
import {
  ACCESS_LEVELS,
  CATEGORY_SCOPES,
  CREATABLE_DOC_TYPES,
  DOC_TYPES,
  PRODUCTION_STATUSES,
  ROLES,
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
  tags: optionalText(400),
  pinned: z.coerce.boolean().optional().default(false),
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

export const configSchema = z.object({
  orgName: z.string().trim().min(2).max(120),
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
