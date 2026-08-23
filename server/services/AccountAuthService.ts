import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../auth/password";
import { AccountHandleTakenError } from "../persistence/errors";
import type { AccountIdentity, PlayerRepository } from "../persistence/PlayerRepository";

const SESSION_LIFETIME_MILLISECONDS = 12 * 60 * 60 * 1_000;
const dummyHash = hashPassword("not-a-real-account-password");

export class AccountAuthError extends Error {
  constructor(readonly code: "invalid_credentials" | "account_exists") {
    super(code);
  }
}

export interface AuthenticatedAccount {
  account: AccountIdentity;
  sessionId: string;
  expiresAt: number;
}

export class AccountAuthService {
  constructor(private readonly players: PlayerRepository) {}

  async authenticate(handle: string, password: string, mode: "login" | "register"): Promise<AuthenticatedAccount> {
    const account = mode === "register"
      ? await this.register(handle, password)
      : await this.login(handle, password);
    const sessionId = randomUUID();
    const expiresAt = Date.now() + SESSION_LIFETIME_MILLISECONDS;
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
    const credentials = await this.players.findAccountCredentials(handle);
    const passwordHash = credentials?.passwordHash ?? await dummyHash;
    if (!await verifyPassword(password, passwordHash) || !credentials?.passwordHash) {
      throw new AccountAuthError("invalid_credentials");
    }
    return credentials.account;
  }
}
