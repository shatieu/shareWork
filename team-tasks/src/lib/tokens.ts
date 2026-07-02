import { randomBytes, createHash, timingSafeEqual } from "crypto";

export const TOKEN_PREFIX = "tt_";

/** Generate a new personal access token (shown to the user exactly once). */
export function generateToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** SHA-256 hex of the raw token — only the hash is ever stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare of two hex hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
