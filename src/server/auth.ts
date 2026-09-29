// Credentials: scrypt password hashes with a per-account salt, random session tokens stored only as
// SHA-256 hashes, and the player-facing validation of usernames and passwords (contracts/net.ts).
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Session lifetime: 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
/** Upper bound keeps scrypt input (and request bodies) sane. */
export const PASSWORD_MAX = 200;

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * scrypt runs on the libuv thread pool — the same threads that compress WebSocket frames, and ws holds
 * every later frame of a socket (snapshots included) until a pending compression finishes. A burst of
 * logins must not occupy the whole pool, or every player's stream hitches: at most this many hashes run
 * at once, the rest wait their turn (main.ts also enlarges the pool).
 */
export const MAX_CONCURRENT_HASHES = 2;
let activeHashes = 0;
const hashQueue: (() => void)[] = [];

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeHashes >= MAX_CONCURRENT_HASHES) await new Promise<void>((resolve) => hashQueue.push(resolve));
  else activeHashes++;
  try {
    return await fn();
  } finally {
    // Hand the slot straight to the next waiter (the count stays), or free it.
    const next = hashQueue.shift();
    if (next) next();
    else activeHashes--;
  }
}

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return withHashSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key)));
      }),
  );
}

/** Hashes running / waiting right now (diagnostics and tests). */
export function hashLoad(): { active: number; queued: number } {
  return { active: activeHashes, queued: hashQueue.length };
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return { hash: key.toString('hex'), salt: salt.toString('hex') };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const key = await scryptAsync(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(key, expected);
}

/** Burn the same scrypt time for unknown usernames, so response timing does not reveal which names exist. */
const DUMMY_SALT = randomBytes(16);
export async function burnPasswordCheck(password: string): Promise<void> {
  await scryptAsync(password, DUMMY_SALT);
}

/** A fresh session token (32 random bytes, base64url) — only its hash is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Tokens are exactly the 43-char base64url form of 32 bytes; anything else is rejected before hashing. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string' || username.length === 0) return 'Choose a username.';
  if (username.length < 3) return 'Usernames need at least 3 characters.';
  if (username.length > 20) return 'Usernames can be at most 20 characters.';
  if (!USERNAME_RE.test(username)) return 'Usernames may only use letters, digits and underscores.';
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Choose a password.';
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Passwords can be at most ${PASSWORD_MAX} characters.`;
  return null;
}
