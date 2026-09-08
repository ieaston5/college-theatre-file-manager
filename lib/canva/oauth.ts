import crypto from "node:crypto";
import { prisma } from "../db";
import { encrypt, randomToken, tryDecrypt } from "../crypto";
import { canvaRedirectUri, env } from "../env";
import { CANVA_SCOPES } from "../constants";
import { CanvaCallError, CanvaNotConnectedError } from "./types";

/**
 * Canva OAuth: authorization code flow with PKCE (S256), which Canva requires.
 *
 * Two Canva-specific wrinkles shape this file:
 *
 *  - the code_verifier has to survive the round trip server-side, so it is
 *    stored on the OAuthState row rather than in a cookie;
 *  - refresh tokens rotate on every use, so each refresh rewrites both tokens.
 */

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

function credentials() {
  if (!env.canvaConfigured) {
    throw new CanvaCallError(
      "CANVA_CLIENT_ID / CANVA_CLIENT_SECRET are not set in .env.",
      "See SETUP.md — you need a Canva integration in the Canva Developer Portal.",
    );
  }
  return {
    clientId: env.canvaClientId!,
    secret: env.canvaClientSecret!,
    basic: Buffer.from(`${env.canvaClientId}:${env.canvaClientSecret}`).toString("base64"),
  };
}

/** PKCE pair. The verifier must be 43–128 unreserved characters. */
export function createPkcePair() {
  const verifier = crypto.randomBytes(64).toString("base64url").slice(0, 96);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function beginCanvaAuthorization(userId: string) {
  const { clientId } = credentials();
  const { verifier, challenge } = createPkcePair();
  const state = randomToken(24);

  await prisma.oAuthState.create({
    data: { state, purpose: "canva", userId, codeVerifier: verifier, redirect: "/admin" },
  });
  await prisma.oAuthState.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", CANVA_SCOPES.join(" "));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", canvaRedirectUri());
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const { basic } = credentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string };
      detail = parsed.error_description ?? parsed.error ?? text;
    } catch {
      /* keep the raw body */
    }
    throw new CanvaCallError(
      `Canva refused the token request (${response.status}): ${detail}`,
      response.status === 401
        ? "Check CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in .env."
        : "Check that the redirect URI registered with Canva matches the one shown in Admin exactly.",
    );
  }
  return JSON.parse(text) as TokenResponse;
}

export async function exchangeCanvaCode(code: string, codeVerifier: string) {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: canvaRedirectUri(),
    }),
  );
}

export async function saveCanvaCredentials(params: {
  tokens: TokenResponse;
  connectedByUserId?: string | null;
  profile?: { userId?: string | null; teamId?: string | null; displayName?: string | null };
  capabilities?: string[];
}) {
  const data = {
    accessToken: encrypt(params.tokens.access_token),
    refreshToken: encrypt(params.tokens.refresh_token),
    expiresAt: new Date(Date.now() + params.tokens.expires_in * 1000),
    scope: params.tokens.scope ?? CANVA_SCOPES.join(" "),
    canvaUserId: params.profile?.userId ?? null,
    canvaTeamId: params.profile?.teamId ?? null,
    displayName: params.profile?.displayName ?? null,
    capabilities: params.capabilities ? JSON.stringify(params.capabilities) : null,
    connectedByUserId: params.connectedByUserId ?? null,
    connectedAt: new Date(),
  };
  return prisma.canvaAccount.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });
}

/**
 * A valid access token for the hub's Canva account, refreshing it when it is
 * close to expiry. Canva rotates the refresh token on every use, so the new
 * pair is persisted immediately.
 */
export async function canvaAccessToken(): Promise<string> {
  const account = await prisma.canvaAccount.findUnique({ where: { id: "singleton" } });
  const refreshToken = tryDecrypt(account?.refreshToken);
  if (!account || !refreshToken) throw new CanvaNotConnectedError();

  const accessToken = tryDecrypt(account.accessToken);
  const stillFresh =
    accessToken && account.expiresAt && account.expiresAt.getTime() - Date.now() > 60_000;
  if (stillFresh) return accessToken;

  const tokens = await requestToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  await prisma.canvaAccount.update({
    where: { id: "singleton" },
    data: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope ?? account.scope,
    },
  });
  return tokens.access_token;
}
