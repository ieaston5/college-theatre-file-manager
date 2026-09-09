import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { prisma } from "../db";
import { encrypt, randomToken, tryDecrypt } from "../crypto";
import { driveRedirectUri, env, loginRedirectUri } from "../env";
import { DRIVE_SCOPES, LOGIN_SCOPES } from "../constants";
import { GoogleNotConnectedError } from "./types";

function client(redirectUri: string): OAuth2Client {
  if (!env.googleConfigured) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env — see SETUP.md step 2.",
    );
  }
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, redirectUri);
}

// --- one-time state values --------------------------------------------------

export async function createOAuthState(purpose: "login" | "drive", redirect?: string) {
  const state = randomToken(24);
  await prisma.oAuthState.create({ data: { state, purpose, redirect: redirect ?? null } });
  // Opportunistic cleanup of anything older than an hour.
  await prisma.oAuthState.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  return state;
}

export async function consumeOAuthState(state: string | null, purpose: "login" | "drive") {
  if (!state) return null;
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row || row.purpose !== purpose) return null;
  await prisma.oAuthState.delete({ where: { state } }).catch(() => {});
  if (row.createdAt.getTime() < Date.now() - 60 * 60 * 1000) return null;
  return row;
}

// --- member sign-in ---------------------------------------------------------

export function loginAuthUrl(state: string): string {
  return client(loginRedirectUri()).generateAuthUrl({
    scope: LOGIN_SCOPES,
    include_granted_scopes: true,
    prompt: "select_account",
    state,
  });
}

export type GoogleIdentity = { sub: string; email: string; name?: string; picture?: string };

export async function exchangeLoginCode(code: string): Promise<GoogleIdentity> {
  const oauth = client(loginRedirectUri());
  const { tokens } = await oauth.getToken(code);
  if (!tokens.id_token) throw new Error("Google did not return an identity token.");
  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) throw new Error("Google did not return an email address.");
  if (payload.email_verified === false) throw new Error("That Google email is not verified.");
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name,
    picture: payload.picture,
  };
}

// --- the hub's document-owning account --------------------------------------

export function driveAuthUrl(state: string): string {
  return client(driveRedirectUri()).generateAuthUrl({
    scope: DRIVE_SCOPES,
    access_type: "offline",
    prompt: "consent", // force a refresh token even on re-connect
    include_granted_scopes: true,
    state,
  });
}

export async function exchangeDriveCode(code: string) {
  const oauth = client(driveRedirectUri());
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove the hub from the account's third-party access list and try again.",
    );
  }
  oauth.setCredentials(tokens);

  /**
   * Which account did we just connect?
   *
   * Read it from the id_token, which the `openid`/`email` scopes in
   * DRIVE_SCOPES make Google return alongside the access token. That is one
   * fewer network call than asking the userinfo endpoint, and it cannot fail
   * for lack of a scope — the failure mode that made this step return
   * "Request is missing required authentication credential" the first time it
   * ever ran against real Google.
   *
   * The userinfo call stays as a fallback for a token minted before the scope
   * was added, and a failure there is reported for what it is rather than
   * discarding a refresh token we have just been given.
   */
  let email = "";
  let name: string | null = null;

  if (tokens.id_token) {
    try {
      const ticket = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.googleClientId,
      });
      const payload = ticket.getPayload();
      email = (payload?.email ?? "").toLowerCase();
      name = payload?.name ?? null;
    } catch (error) {
      console.error("[google] could not read the id_token from the drive connect", error);
    }
  }

  if (!email) {
    try {
      const info = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get();
      email = (info.data.email ?? "").toLowerCase();
      name = info.data.name ?? name;
    } catch (error) {
      throw new Error(
        "Connected to Google, but the hub could not read which account it was. " +
          "This usually means the OAuth client is missing the openid/email scopes. " +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (!email) {
    throw new Error("Google did not say which account was connected. Try connecting again.");
  }

  return { tokens, email, name };
}

export async function saveDriveCredentials(params: {
  email: string;
  name: string | null;
  accessToken?: string | null;
  refreshToken: string;
  expiresAt?: Date | null;
  scope?: string | null;
  connectedByUserId?: string | null;
}) {
  const data = {
    email: params.email,
    name: params.name,
    accessToken: params.accessToken ? encrypt(params.accessToken) : null,
    refreshToken: encrypt(params.refreshToken),
    expiresAt: params.expiresAt ?? null,
    scope: params.scope ?? DRIVE_SCOPES.join(" "),
    connectedByUserId: params.connectedByUserId ?? null,
    connectedAt: new Date(),
  };
  return prisma.driveAccount.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    // The folder ids are deliberately cleared on every connect. They may
    // belong to a different account, or — the case that actually happened —
    // to the simulated Drive, in which case every later call would fail
    // looking for a folder that exists nowhere. ensureRootFolders() resolves
    // them again by name straight afterwards and reuses the real folders when
    // they are already there, so reconnecting the same account is a no-op.
    update: { ...data, rootFolderId: null, productionsFolderId: null, standingFolderId: null },
  });
}

/** Ids from the simulated Drive, which are useless against the real API. */
export function isSimulatedDriveId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^(fld|doc|upl|perm)_/.test(id);
}

/**
 * An OAuth client authenticated as the hub's document-owning account, with
 * refreshed access tokens persisted back to the database.
 */
export async function driveClient(): Promise<OAuth2Client> {
  const account = await prisma.driveAccount.findUnique({ where: { id: "singleton" } });
  const refreshToken = tryDecrypt(account?.refreshToken);
  if (!account || !refreshToken) throw new GoogleNotConnectedError();

  const oauth = client(driveRedirectUri());
  oauth.setCredentials({
    refresh_token: refreshToken,
    access_token: tryDecrypt(account.accessToken) ?? undefined,
    expiry_date: account.expiresAt ? account.expiresAt.getTime() : undefined,
  });

  oauth.on("tokens", (tokens) => {
    void prisma.driveAccount
      .update({
        where: { id: "singleton" },
        data: {
          accessToken: tokens.access_token ? encrypt(tokens.access_token) : undefined,
          refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        },
      })
      .catch((error) => console.error("[google] could not persist refreshed token", error));
  });

  return oauth;
}
