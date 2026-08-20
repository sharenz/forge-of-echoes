import { createHmac, timingSafeEqual } from "node:crypto";
import { accountSessionClaimsSchema, type AccountSessionClaims } from "../../multiplayer/protocol";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`account:${payload}`).digest();
}

export function signAccountToken(claims: AccountSessionClaims, secret: string): string {
  const verified = accountSessionClaimsSchema.parse(claims);
  const payload = encode(JSON.stringify(verified));
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyAccountToken(token: string, secret: string, now = Date.now()): AccountSessionClaims | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (suppliedSignature !== supplied.toString("base64url")) return null;
  const expected = signature(payload, secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claims = accountSessionClaimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return claims.expiresAt > now ? claims : null;
  } catch {
    return null;
  }
}
