import fs from "node:fs";
import path from "node:path";
import { CANVA_FORMAT_META, type CanvaExportFormat } from "../constants";
import { canvaDesignUrl } from "./real";
import type { CanvaDesign, CanvaExportResult, CanvaProvider } from "./types";

/**
 * A stand-in for the Canva Connect API, so the mirroring flow — register a
 * design, export it, file the export in Drive, notice when the original moves
 * ahead of the copy — can be exercised without Canva credentials.
 *
 * State lives in .mock-canva/designs.json. `touchMockDesign` exists so the
 * "the Canva original has changed since this copy" case can be demonstrated
 * on demand rather than waited for.
 */

type MockDesign = {
  id: string;
  title: string;
  designTypes: string[];
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

type MockState = { accountLabel: string; designs: Record<string, MockDesign> };

const STORE_DIR = path.join(process.cwd(), ".mock-canva");
const STORE_FILE = path.join(STORE_DIR, "designs.json");
const MOCK_ACCOUNT = "Penn Players Hub (simulated Canva)";

function load(): MockState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as MockState;
    if (parsed?.designs) return parsed;
  } catch {
    /* fresh store */
  }
  return { accountLabel: MOCK_ACCOUNT, designs: {} };
}

function save(state: MockState) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  // Write-then-rename: several requests can be mutating this store at once,
  // and a reader must never catch a half-written file — a truncated read would
  // look like an empty store and silently wipe the simulation.
  const temporary = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, STORE_FILE);
}

function titleFromId(designId: string) {
  return `Simulated Canva design ${designId.slice(-4).toUpperCase()}`;
}

/** Pretend somebody edited the design in Canva just now. */
export function touchMockDesign(designId: string): boolean {
  const state = load();
  const design = state.designs[designId];
  if (!design) return false;
  design.updatedAt = new Date().toISOString();
  design.revision += 1;
  save(state);
  return true;
}

export function readMockCanvaState(): MockState {
  return load();
}

/** A small but genuinely valid PDF, so the mirrored file actually opens. */
function placeholderPdf(lines: string[]): Buffer {
  const content = lines
    .map((line, index) => {
      const escaped = line.replace(/([()\\])/g, "\\$1");
      return `BT /F1 ${index === 0 ? 18 : 11} Tf 40 ${300 - index * 26} Td (${escaped}) Tj ET`;
    })
    .join("\n");

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 460 340]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

export class MockCanvaProvider implements CanvaProvider {
  readonly mode = "mock" as const;

  async accountLabel() {
    return load().accountLabel;
  }

  async getDesign(designId: string): Promise<CanvaDesign | null> {
    const state = load();
    let design = state.designs[designId];
    if (!design) {
      const now = new Date().toISOString();
      design = {
        id: designId,
        title: titleFromId(designId),
        designTypes: ["presentation"],
        pageCount: 6,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      state.designs[designId] = design;
      save(state);
    }

    return {
      id: design.id,
      title: design.title,
      url: canvaDesignUrl(design.id),
      designTypes: design.designTypes,
      pageCount: design.pageCount,
      updatedAt: new Date(design.updatedAt),
      createdAt: new Date(design.createdAt),
      ownerUserId: "mock-user",
      ownerTeamId: "mock-team",
      thumbnailUrl: null,
    };
  }

  async exportDesign(designId: string, format: CanvaExportFormat): Promise<CanvaExportResult> {
    const design = await this.getDesign(designId);
    // Always a PDF: a .pptx full of placeholder bytes would be a broken file,
    // and every mirrored artifact should actually open.
    const bytes = placeholderPdf([
      design?.title ?? titleFromId(designId),
      "Simulated Canva export",
      `Design ${designId}`,
      `Exported ${new Date().toLocaleString("en-US")}`,
      "The real integration exports the actual design.",
    ]);

    return {
      bytes,
      mimeType: CANVA_FORMAT_META.pdf.mimeType,
      format: "pdf",
      extraFileCount: 0,
      note:
        format === "pdf"
          ? undefined
          : "The simulated Canva always returns a PDF, so this copy is a PDF rather than a PowerPoint.",
    };
  }
}
