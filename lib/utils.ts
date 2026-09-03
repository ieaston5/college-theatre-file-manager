export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

export function initials(name: string | null | undefined, email: string): string {
  const source = (name ?? "").trim() || email.split("@")[0].replace(/[._-]+/g, " ");
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const table: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.348, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let amount = seconds;
  for (const [step, unit] of table) {
    if (Math.abs(amount) < step) {
      return new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(
        -Math.round(amount),
        unit,
      );
    }
    amount /= step;
  }
  return formatDate(date);
}

export function truncate(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "budget, weekly , Budget" -> ["budget", "weekly"] */
export function parseTagInput(input: string | null | undefined): string[] {
  if (!input) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of input.split(/[,\n]/)) {
    const name = piece.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const slug = slugify(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push(name);
  }
  return out.slice(0, 12);
}

/**
 * Build the Drive file name from the org's naming template.
 * Tokens: {production} {category} {title} {date} {season}
 * Empty tokens collapse, so "[{production}] {title}" degrades to "{title}"
 * for organisation-wide documents rather than leaving stray brackets.
 */
export function applyNamingTemplate(
  template: string,
  values: { production?: string | null; category?: string; title: string; season?: string | null },
): string {
  const date = new Date().toISOString().slice(0, 10);
  let out = template;

  const replace = (token: string, value: string | null | undefined) => {
    if (value && value.trim()) {
      out = out.replaceAll(`{${token}}`, value.trim());
      return;
    }
    // Drop the token together with any wrapper punctuation around it.
    out = out
      .replaceAll(new RegExp(`\\s*[\\[\\(]\\s*\\{${token}\\}\\s*[\\]\\)]\\s*`, "g"), " ")
      .replaceAll(new RegExp(`\\s*[—–\\-·|]\\s*\\{${token}\\}`, "g"), "")
      .replaceAll(new RegExp(`\\{${token}\\}\\s*[—–\\-·|]\\s*`, "g"), "")
      .replaceAll(`{${token}}`, "");
  };

  replace("production", values.production);
  replace("category", values.category);
  replace("season", values.season);
  replace("date", date);
  replace("title", values.title);

  return out.replace(/\s{2,}/g, " ").trim() || values.title;
}

export function driveViewLink(fileId: string, docType: string): string {
  switch (docType) {
    case "DOC":
      return `https://docs.google.com/document/d/${fileId}/edit`;
    case "SHEET":
      return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
    case "SLIDES":
      return `https://docs.google.com/presentation/d/${fileId}/edit`;
    case "FOLDER":
      return `https://drive.google.com/drive/folders/${fileId}`;
    default:
      return `https://drive.google.com/file/d/${fileId}/view`;
  }
}

/** Pull a file id out of any Drive/Docs URL a member might paste. */
export function extractDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{20,})/,
    /\/folders\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\/forms\/d\/e\/([a-zA-Z0-9_-]{20,})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** ".pdf" from "Script draft 3.pdf". Empty string when there isn't one. */
export function fileExtension(fileName: string): string {
  const match = fileName.match(/\.([A-Za-z0-9]{1,12})$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

/**
 * Uploaded files keep their extension even though the hub renames them —
 * "[URINETOWN] Script — Scripts & scores.pdf" rather than a PDF that Drive and
 * every operating system then refuse to preview.
 */
export function withExtension(name: string, originalFileName: string): string {
  const ext = fileExtension(originalFileName);
  if (!ext) return name;
  return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
}

/** "Urinetown script draft 3.pdf" -> "Urinetown script draft 3" */
export function fileNameToTitle(fileName: string): string {
  const ext = fileExtension(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  return base.replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 160);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
