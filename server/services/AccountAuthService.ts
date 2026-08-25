import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../auth/password";
import { AccountHandleTakenError } from "../persistence/errors";
import type { AccountIdentity, PlayerRepository } from "../persistence/PlayerRepository";

const SESSION_LIFETIME_MILLISECONDS = 12 * 60 * 60 * 1_000;
const dummyHash = hashPassword("not-a-real-account-password");

// Progressive per-handle lockout blunts distributed brute-force attempts that
// IP rate limiting cannot see. In-process by design: a restart clears it and
// PostgreSQL remains the source of truth for accounts (ARCHITECTURE.md).
const LOGIN_LOCKOUT_THRESHOLD_FAILURES = 5;
const LOGIN_LOCKOUT_BASE_MILLISECONDS = 60_000;
const LOGIN_LOCKOUT_MAXIMUM_MILLISECONDS = 15 * 60_000;
const LOGIN_THROTTLE_SWEEP_SIZE = 1_024;

interface LoginThrottleEntry {
  failures: number;
  lastFailureMilliseconds: number;
  lockedUntilMilliseconds: number;
}

export class AccountAuthError extends Error {
  constructor(readonly code: "invalid_credentials" | "account_exists" | "account_locked") {
    super(code);
  }
}

export interface AuthenticatedAccount {
  account: AccountIdentity;
  sessionId: string;
  expiresAt: number;
}

export class AccountAuthService {
  private readonly loginThrottles = new Map<string, LoginThrottleEntry>();
  private readonly now: () => number;

  constructor(private readonly players: PlayerRepository, dependencies: { now?: () => number } = {}) {
    this.now = dependencies.now ?? Date.now;
  }

  async authenticate(handle: string, password: string, mode: "login" | "register"): Promise<AuthenticatedAccount> {
    const account = mode === "register"
      ? await this.register(handle, password)
      : await this.login(handle, password);
    const sessionId = randomUUID();
    const expiresAt = this.now() + SESSION_LIFETIME_MILLISECONDS;
    await this.players.createAuthSession(sessionId, account.accountId, expiresAt);
    return { account, sessionId, expiresAt };
  }

  private async register(handle: string, password: string): Promise<AccountIdentity> {
    if (await this.players.findAccountCredentials(handle)) throw new AccountAuthError("account_exists");
    const passwordHash = await hashPassword(password);
    try {
      return await this.players.createAuthenticatedAccount(handle, passwordHash);
    } catch (error) {
      if (error instanceof AccountHandleTakenError) throw new AccountAuthError("account_exists");
      throw error;
    }
  }

  private async login(handle: string, password: string): Promise<AccountIdentity> {
    const throttle = this.loginThrottles.get(handle);
    if (throttle && throttle.lockedUntilMilliseconds > this.now()) {
      // Reject before any scrypt work so a locked handle costs no CPU.
      throw new AccountAuthError("account_locked");
    }
    const credentials = await this.players.findAccountCredentials(handle);
    const passwordHash = credentials?.passwordHash ?? await dummyHash;
    if (!await verifyPassword(password, passwordHash) || !credentials?.passwordHash) {
      this.recordLoginFailure(handle);
      throw new AccountAuthError("invalid_credentials");
    }
    this.loginThrottles.delete(handle);
    return credentials.account;
  }

  private recordLoginFailure(handle: string): void {
    const nowMilliseconds = this.now();
    this.sweepLoginThrottles(nowMilliseconds);
    const previous = this.loginThrottles.get(handle);
    const failures = (previous?.failures ?? 0) + 1;
    const overThreshold = failures - LOGIN_LOCKOUT_THRESHOLD_FAILURES;
    const lockedUntilMilliseconds = overThreshold >= 0
      ? nowMilliseconds + Math.min(
          LOGIN_LOCKOUT_MAXIMUM_MILLISECONDS,
          LOGIN_LOCKOUT_BASE_MILLISECONDS * 2 ** Math.min(overThreshold, 16),
        )
      : previous?.lockedUntilMilliseconds ?? 0;
    this.loginThrottles.set(handle, { failures, lastFailureMilliseconds: nowMilliseconds, lockedUntilMilliseconds });
  }

  private sweepLoginThrottles(nowMilliseconds: number): void {
    if (this.loginThrottles.size < LOGIN_THROTTLE_SWEEP_SIZE) return;
    const staleBeforeMilliseconds = nowMilliseconds - LOGIN_LOCKOUT_MAXIMUM_MILLISECONDS;
    for (const [handle, entry] of this.loginThrottles) {
      if (entry.lastFailureMilliseconds < staleBeforeMilliseconds) this.loginThrottles.delete(handle);
    }
  }
}
