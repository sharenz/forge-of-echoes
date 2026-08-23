import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const KEY_BYTES = 32;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, keyBytes: number, cost: number, blockSize: number, parallelism: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyBytes, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: MAX_MEMORY,
    }, (error, value) => error ? reject(error) : resolve(value));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, KEY_BYTES, COST, BLOCK_SIZE, PARALLELISM);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, costRaw, blockSizeRaw, parallelismRaw, saltRaw, expectedRaw, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || extra) return false;
  const cost = Number(costRaw);
  const blockSize = Number(blockSizeRaw);
  const parallelism = Number(parallelismRaw);
  if (cost !== COST || blockSize !== BLOCK_SIZE || parallelism !== PARALLELISM || !saltRaw || !expectedRaw) return false;
  try {
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(expectedRaw, "base64url");
    if (salt.toString("base64url") !== saltRaw || expected.toString("base64url") !== expectedRaw || expected.length !== KEY_BYTES) return false;
    const derived = await derive(password, salt, expected.length, cost, blockSize, parallelism);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
