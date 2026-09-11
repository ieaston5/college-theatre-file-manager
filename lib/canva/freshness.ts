/**
 * Whether a Canva mirror is behind the design it was exported from.
 *
 * This lives on its own, away from lib/documents, because the document list
 * rows call it on every render. Importing it from the document service pulled
 * the whole Drive/Canva stack — and with it `googleapis`, which costs the best
 * part of a second to evaluate — into the server bundle of every page that
 * shows a list. The rule itself is four lines of date arithmetic and needs
 * none of that.
 */
export function canvaMirrorIsStale(document: {
  canvaExportedAt: Date | null;
  canvaDesignUpdatedAt: Date | null;
}): boolean {
  if (!document.canvaExportedAt || !document.canvaDesignUpdatedAt) return false;
  // A minute of slack: Canva's updated_at ticks over as the export is taken.
  return document.canvaDesignUpdatedAt.getTime() > document.canvaExportedAt.getTime() + 60_000;
}
