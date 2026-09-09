/** Environment access with friendly failures. Server-only. */

function raw(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

function required(key: string): string {
  const value = raw(key);
  if (!value) {
    throw new Error(
      `Missing ${key} in .env. Copy .env.example to .env and fill it in (see SETUP.md).`,
    );
  }
  return value;
}

/**
 * Make APP_URL usable whatever was pasted in.
 *
 * Every OAuth redirect URI is built from this value, and a missing scheme is
 * silently catastrophic: `example.com/api/auth/google/callback` is not a URL
 * Google will ever match, so sign-in fails with `redirect_uri_mismatch` and
 * nothing in the message mentions the real cause. A trailing slash does the
 * same thing more subtly, via a doubled slash in the path.
 */
function normaliseAppUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(trimmed);
  return `${local ? "http" : "https"}://${trimmed}`;
}

export const env = {
  get appUrl() {
    const configured = raw("APP_URL");
    return configured ? normaliseAppUrl(configured) : "http://localhost:3000";
  },
  /** True when APP_URL had to be repaired, so the admin page can say so. */
  get appUrlWasIncomplete() {
    const configured = raw("APP_URL");
    return Boolean(configured && configured.trim() !== normaliseAppUrl(configured));
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get encryptionKey() {
    return required("APP_ENCRYPTION_KEY");
  },
  get googleClientId() {
    return raw("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return raw("GOOGLE_CLIENT_SECRET");
  },
  get canvaClientId() {
    return raw("CANVA_CLIENT_ID");
  },
  get canvaClientSecret() {
    return raw("CANVA_CLIENT_SECRET");
  },
  get canvaConfigured() {
    return Boolean(raw("CANVA_CLIENT_ID") && raw("CANVA_CLIENT_SECRET"));
  },
  /**
   * "canva" talks to the Connect API; "mock" simulates it so the mirroring
   * flow can be demonstrated without credentials; "off" hides the feature.
   */
  get canvaMode(): "canva" | "mock" | "off" {
    const mode = (raw("CANVA_MODE") ?? "auto").toLowerCase();
    if (mode === "canva" || mode === "mock" || mode === "off") return mode;
    return this.canvaConfigured ? "canva" : "mock";
  },
  get bootstrapAdminEmails(): string[] {
    return (raw("BOOTSTRAP_ADMIN_EMAILS") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get allowDevLogin() {
    return raw("ALLOW_DEV_LOGIN") === "true" && process.env.NODE_ENV !== "production";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** Whether a real Google OAuth client is configured. */
  get googleConfigured() {
    return Boolean(raw("GOOGLE_CLIENT_ID") && raw("GOOGLE_CLIENT_SECRET"));
  },
  /** "google" talks to Drive for real; "mock" fakes it entirely. */
  get driveMode(): "google" | "mock" {
    const mode = (raw("DRIVE_MODE") ?? "auto").toLowerCase();
    if (mode === "google") return "google";
    if (mode === "mock") return "mock";
    return this.googleConfigured ? "google" : "mock";
  },
};

export function loginRedirectUri() {
  return `${env.appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function driveRedirectUri() {
  return `${env.appUrl.replace(/\/$/, "")}/api/google/callback`;
}

/**
 * Canva rejects `localhost` as a redirect URI but accepts `127.0.0.1`, so the
 * host is swapped for the Canva flow only. Its callback therefore has to work
 * without a session cookie — see the userId column on OAuthState.
 */
export function canvaRedirectUri() {
  const base = env.appUrl.replace(/\/$/, "").replace("://localhost", "://127.0.0.1");
  return `${base}/api/canva/callback`;
}
