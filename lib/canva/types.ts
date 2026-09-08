import type { CanvaExportFormat } from "../constants";

export type CanvaDesign = {
  id: string;
  title: string | null;
  /** The durable Canva UI URL, built from the id — not the API's temporary one. */
  url: string;
  designTypes: string[];
  pageCount: number | null;
  updatedAt: Date | null;
  createdAt: Date | null;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  thumbnailUrl: string | null;
};

export type CanvaExportResult = {
  /** The exported bytes, ready to be filed in Drive. */
  bytes: Buffer;
  mimeType: string;
  format: CanvaExportFormat;
  /** Set when the design exported to more than one file and we kept the first. */
  extraFileCount: number;
  /** Anything the caller should pass on to the person who asked. */
  note?: string;
};

export interface CanvaProvider {
  readonly mode: "canva" | "mock";
  /** Who the hub is acting as; null when nothing is connected. */
  accountLabel(): Promise<string | null>;
  getDesign(designId: string): Promise<CanvaDesign | null>;
  exportDesign(designId: string, format: CanvaExportFormat): Promise<CanvaExportResult>;
}

export class CanvaNotConnectedError extends Error {
  constructor() {
    super(
      "The hub's Canva account is not connected yet. An admin needs to connect it in Admin → Canva connection.",
    );
    this.name = "CanvaNotConnectedError";
  }
}

export class CanvaCallError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "CanvaCallError";
  }
}
