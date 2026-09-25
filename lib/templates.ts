import { DOC_TYPE_META, type CreatableDocType } from "./constants";
import { GoogleCallError, type DriveFileInfo, type DriveProvider } from "./google/types";

/** Validate the source, not just whether its link can be opened. */
export async function resolveTemplateFile(
  provider: Pick<DriveProvider, "getFile">,
  fileId: string,
  docType: CreatableDocType,
): Promise<DriveFileInfo> {
  const seen = new Set<string>();
  let id = fileId;
  while (!seen.has(id) && seen.size < 10) {
    seen.add(id);
    const file = await provider.getFile(id);
    if (!file || file.trashed) {
      throw new GoogleCallError(
        "The template file is missing, in the trash, or unavailable to the hub's Google account.",
        "Ask an admin to restore the file or share it with the account shown in Admin → Google connection, then update the template link.",
      );
    }
    if (file.mimeType === "application/vnd.google-apps.shortcut" && file.shortcutTargetId) {
      id = file.shortcutTargetId;
      continue;
    }
    const expected = DOC_TYPE_META[docType];
    if (file.mimeType !== expected.mimeType) {
      throw new GoogleCallError(
        `This template must be a ${expected.label} file.`,
        "Use the original Google file's link and select its matching file type. Folders and uploaded Office files cannot be used as Google templates.",
      );
    }
    if (file.canCopy === false) {
      throw new GoogleCallError(
        "The template owner has not allowed the hub to make a copy.",
        "Ask the owner to allow viewers to copy the file, or give the hub's Google account edit access, then try again.",
      );
    }
    return file;
  }
  throw new GoogleCallError("The template shortcut could not be resolved.", "Use the original Google file's link instead.");
}
