import { CANVA_FORMAT_META, type CanvaExportFormat } from "../constants";
import { canvaAccessToken } from "./oauth";
import {
  CanvaCallError,
  type CanvaDesign,
  type CanvaExportResult,
  type CanvaProvider,
} from "./types";

const API = "https://api.canva.com/rest/v1";

/** The stable URL a person can be given, unlike the API's 30-day per-user one. */
export function canvaDesignUrl(designId: string, mode: "view" | "edit" = "view") {
  return `https://www.canva.com/design/${designId}/${mode}`;
}

function seconds(value: unknown): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

export class CanvaConnectProvider implements CanvaProvider {
  readonly mode = "canva" as const;

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await canvaAccessToken();
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (response.status === 404) {
      throw new CanvaCallError(
        "Canva does not have that design, or the hub's Canva account cannot see it.",
        "Share the design with the hub's Canva account, or check the link.",
      );
    }
    if (response.status === 403) {
      throw new CanvaCallError(
        "Canva refused the request for that design.",
        "The hub's Canva account needs at least view access to the design.",
      );
    }
    if (response.status === 429) {
      throw new CanvaCallError(
        "Canva is rate-limiting the hub.",
        "Exports are capped per design and per account. Wait a few minutes and try again.",
      );
    }
    if (!response.ok) {
      const body = await response.text();
      throw new CanvaCallError(`Canva returned ${response.status}: ${body.slice(0, 400)}`);
    }
    return (await response.json()) as T;
  }

  async accountLabel(): Promise<string | null> {
    try {
      const profile = await this.request<{ display_name?: string }>("/users/me/profile");
      return profile.display_name ?? null;
    } catch {
      return null;
    }
  }

  async getDesign(designId: string): Promise<CanvaDesign | null> {
    type Response = {
      design: {
        id: string;
        title?: string;
        owner?: { user_id?: string; team_id?: string };
        design_types?: string[];
        page_count?: number;
        created_at?: number;
        updated_at?: number;
        thumbnail?: { url?: string };
      };
    };

    try {
      const { design } = await this.request<Response>(`/designs/${encodeURIComponent(designId)}`);
      return {
        id: design.id,
        title: design.title ?? null,
        // Deliberately not design.urls.* — those are single-user and expire
        // after 30 days, so they are useless as a stored link.
        url: canvaDesignUrl(design.id),
        designTypes: design.design_types ?? [],
        pageCount: design.page_count ?? null,
        updatedAt: seconds(design.updated_at),
        createdAt: seconds(design.created_at),
        ownerUserId: design.owner?.user_id ?? null,
        ownerTeamId: design.owner?.team_id ?? null,
        thumbnailUrl: design.thumbnail?.url ?? null,
      };
    } catch (error) {
      if (error instanceof CanvaCallError && error.message.includes("does not have that design")) {
        return null;
      }
      throw error;
    }
  }

  async exportDesign(designId: string, format: CanvaExportFormat): Promise<CanvaExportResult> {
    type Job = {
      job: {
        id: string;
        status: "in_progress" | "success" | "failed";
        urls?: string[];
        error?: { code?: string; message?: string };
      };
    };

    let job = (
      await this.request<Job>("/exports", {
        method: "POST",
        body: JSON.stringify({
          design_id: designId,
          // Always regular quality: a "pro" export fails outright when the
          // design contains premium elements the account has not bought.
          format: { type: format, export_quality: "regular" },
        }),
      })
    ).job;

    // Poll with a gentle backoff; exports of a normal deck take a few seconds.
    const deadline = Date.now() + 90_000;
    let delay = 1200;
    while (job.status === "in_progress" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.4, 6000);
      job = (await this.request<Job>(`/exports/${encodeURIComponent(job.id)}`)).job;
    }

    if (job.status === "in_progress") {
      throw new CanvaCallError(
        "Canva is still working on that export after 90 seconds.",
        "Try again in a minute — big designs can take a while.",
      );
    }
    if (job.status === "failed" || !job.urls?.length) {
      throw new CanvaCallError(
        `Canva could not export that design: ${job.error?.message ?? job.error?.code ?? "no reason given"}`,
        job.error?.code === "license_required"
          ? "The design uses Canva premium elements that this account has not purchased."
          : job.error?.code === "approval_required"
            ? "The design is waiting on reviewer approval inside Canva."
            : undefined,
      );
    }

    // PDF and PPTX come back as a single file; other formats are one per page,
    // which is why the hub only offers those two.
    const download = await fetch(job.urls[0]);
    if (!download.ok) {
      throw new CanvaCallError(
        `Could not download the finished export (${download.status}). Canva's download links are only valid for 24 hours.`,
      );
    }

    return {
      bytes: Buffer.from(await download.arrayBuffer()),
      mimeType: CANVA_FORMAT_META[format].mimeType,
      format,
      extraFileCount: Math.max(0, job.urls.length - 1),
    };
  }
}
