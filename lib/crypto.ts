import crypto from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM at-rest encryption for the Google refresh token. That token
 * grants full access to the Drive of the account that owns every hub
 * document, so it should never sit in the database in plaintext.
 */

function key(): Buffer {
  const material = Buffer.from(env.encryptionKey, "base64");
  if (material.length === 32) return material;
  // Accept any passphrase by hashing it to 32 bytes, so a hand-typed key works.
  return crypto.createHash("sha256").update(env.encryptionKey).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new Error("Stored credential is not in the expected format.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Decrypt, but return null instead of throwing (e.g. after a key rotation). */
export function tryDecrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
