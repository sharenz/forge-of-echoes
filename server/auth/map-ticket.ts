import { createHmac, timingSafeEqual } from "node:crypto";
import { mapTicketClaimsSchema, type MapTicketClaims } from "../../multiplayer/protocol";

const encode = (value: string): string => Buffer.from(value).toString("base64url");

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signMapTicket(claims: MapTicketClaims, secret: string): string {
  const payload = encode(JSON.stringify(mapTicketClaimsSchema.parse(claims)));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyMapTicket(token: string, secret: string, now = Date.now()): MapTicketClaims | null {
  const [payload, receivedSignature, extra] = token.split(".");
  if (!payload || !receivedSignature || extra) return null;
  const expected = signature(payload, secret);
  const received = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) return null;
  try {
    const parsed = mapTicketClaimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.expiresAt > now ? parsed : null;
  } catch {
    return null;
  }
}
