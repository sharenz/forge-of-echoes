import { randomUUID } from "node:crypto";
import { createAuthoritativeProfile } from "../domain/profile";
import type { MerchantId } from "../../app/game/config/merchants";
import { AccountHandleTakenError, AccountNotFoundError, CharacterNameTakenError, CharacterNotFoundError, ProfileRevisionConflict } from "./errors";
import type { AccountCredentials, AccountIdentity, AuthoritativeProfile, CharacterRosterEntry, CharacterSummary, CreatePlayerInput, PlayerIdentity, PlayerRepository } from "./PlayerRepository";

export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly accountsByHandle = new Map<string, AccountIdentity>();
  private readonly charactersByAccount = new Map<string, string[]>();
  private readonly byCharacterId = new Map<string, PlayerIdentity>();
  private readonly profiles = new Map<string, AuthoritativeProfile>();
  private readonly merchantEntitlementsByAccount = new Map<string, Set<MerchantId>>();
  private readonly passwordHashesByAccount = new Map<string, string>();
  private readonly authSessions = new Map<string, { accountId: string; expiresAt: number; revoked: boolean }>();

  async initialize(): Promise<void> {}

  async findAccountCredentials(rawHandle: string): Promise<AccountCredentials | null> {
    const account = this.accountsByHandle.get(rawHandle.trim().toLowerCase());
    if (!account) return null;
    return {
      account: { ...account, merchantEntitlements: this.accountMerchantEntitlements(account.accountId) },
      passwordHash: this.passwordHashesByAccount.get(account.accountId) ?? null,
    };
  }

  async createAuthenticatedAccount(rawHandle: string, passwordHash: string): Promise<AccountIdentity> {
    const handle = rawHandle.trim().toLowerCase();
    if (this.accountsByHandle.has(handle)) throw new AccountHandleTakenError();
    const account: AccountIdentity = { accountId: randomUUID(), handle, merchantEntitlements: [] };
    this.accountsByHandle.set(handle, account);
    this.charactersByAccount.set(account.accountId, []);
    this.merchantEntitlementsByAccount.set(account.accountId, new Set());
    this.passwordHashesByAccount.set(account.accountId, passwordHash);
    return structuredClone(account);
  }

  async createAuthSession(sessionId: string, accountId: string, expiresAt: number): Promise<void> {
    if (!this.charactersByAccount.has(accountId)) throw new AccountNotFoundError(accountId);
    this.authSessions.set(sessionId, { accountId, expiresAt, revoked: false });
  }

  async isAuthSessionActive(sessionId: string, accountId: string, now = Date.now()): Promise<boolean> {
    const session = this.authSessions.get(sessionId);
    return Boolean(session && session.accountId === accountId && !session.revoked && session.expiresAt > now);
  }

  async revokeAuthSession(sessionId: string, accountId: string): Promise<void> {
    const session = this.authSessions.get(sessionId);
    if (session?.accountId === accountId) session.revoked = true;
  }

  async createOrLoadAccount(rawHandle: string): Promise<AccountIdentity> {
    const handle = rawHandle.trim().toLowerCase();
    const existing = this.accountsByHandle.get(handle);
    if (existing) return { ...existing, merchantEntitlements: this.accountMerchantEntitlements(existing.accountId) };
    const account: AccountIdentity = { accountId: randomUUID(), handle, merchantEntitlements: [] };
    this.accountsByHandle.set(handle, account);
    this.charactersByAccount.set(account.accountId, []);
    this.merchantEntitlementsByAccount.set(account.accountId, new Set());
    return account;
  }

  async listCharacters(accountId: string): Promise<CharacterRosterEntry[]> {
    return (this.charactersByAccount.get(accountId) ?? []).flatMap((id) => {
      const character = this.byCharacterId.get(id);
      const profile = this.profiles.get(id);
      return character && profile ? [{ ...structuredClone(character), level: profile.profile.character.level }] : [];
    });
  }

  async createCharacter(accountId: string, input: Omit<CreatePlayerInput, "handle">): Promise<PlayerIdentity> {
    if (!this.charactersByAccount.has(accountId)) throw new AccountNotFoundError(accountId);
    const normalizedName = input.characterName.trim().toLowerCase();
    if ([...this.byCharacterId.values()].some((candidate) => candidate.characterName.toLowerCase() === normalizedName)) {
      throw new CharacterNameTakenError();
    }
    const player: PlayerIdentity = {
      accountId,
      characterId: randomUUID(),
      characterName: input.characterName.trim(),
      classId: input.classId,
    };
    this.byCharacterId.set(player.characterId, player);
    this.charactersByAccount.get(accountId)!.push(player.characterId);
    this.profiles.set(player.characterId, { profile: createAuthoritativeProfile({ ...input, handle: "server" }), revision: 1 });
    return player;
  }

  async findAccountCharacter(accountId: string, characterId: string): Promise<PlayerIdentity | null> {
    const character = this.byCharacterId.get(characterId);
    return character?.accountId === accountId ? structuredClone(character) : null;
  }

  async findCharacter(characterId: string): Promise<CharacterSummary | null> {
    const identity = this.byCharacterId.get(characterId);
    const profile = this.profiles.get(characterId);
    return identity && profile ? { ...identity, level: profile.profile.character.level } : null;
  }

  async findCharacters(characterIds: readonly string[]): Promise<CharacterSummary[]> {
    const unique = [...new Set(characterIds)];
    return unique.flatMap((characterId) => {
      const identity = this.byCharacterId.get(characterId);
      const profile = this.profiles.get(characterId);
      return identity && profile ? [{ ...identity, level: profile.profile.character.level }] : [];
    });
  }

  async listMerchantEntitlementsForCharacter(characterId: string): Promise<MerchantId[]> {
    const character = this.byCharacterId.get(characterId);
    return character ? this.accountMerchantEntitlements(character.accountId) : [];
  }

  grantMerchantEntitlement(accountId: string, merchantId: MerchantId): void {
    const entitlements = this.merchantEntitlementsByAccount.get(accountId);
    if (!entitlements) throw new AccountNotFoundError(accountId);
    entitlements.add(merchantId);
  }

  private accountMerchantEntitlements(accountId: string): MerchantId[] {
    return [...(this.merchantEntitlementsByAccount.get(accountId) ?? [])].sort();
  }

  async loadProfile(characterId: string): Promise<AuthoritativeProfile | null> {
    const saved = this.profiles.get(characterId);
    return saved ? structuredClone(saved) : null;
  }

  async saveProfile(characterId: string, expectedRevision: number, profile: AuthoritativeProfile["profile"]): Promise<AuthoritativeProfile> {
    const current = this.profiles.get(characterId);
    if (!current) throw new CharacterNotFoundError(characterId);
    if (current.revision !== expectedRevision) throw new ProfileRevisionConflict();
    const saved = { profile: structuredClone(profile), revision: current.revision + 1 };
    this.profiles.set(characterId, saved);
    return structuredClone(saved);
  }

  async mutateProfile(
    characterId: string,
    expectedRevision: number | null,
    transform: (profile: AuthoritativeProfile["profile"]) => AuthoritativeProfile["profile"],
  ): Promise<AuthoritativeProfile> {
    const current = this.profiles.get(characterId);
    if (!current) throw new CharacterNotFoundError(characterId);
    if (expectedRevision !== null && current.revision !== expectedRevision) throw new ProfileRevisionConflict();
    const next = transform(structuredClone(current.profile));
    const saved = { profile: structuredClone(next), revision: current.revision + 1 };
    this.profiles.set(characterId, saved);
    return structuredClone(saved);
  }

  async close(): Promise<void> {
    this.accountsByHandle.clear();
    this.charactersByAccount.clear();
    this.byCharacterId.clear();
    this.profiles.clear();
    this.merchantEntitlementsByAccount.clear();
    this.passwordHashesByAccount.clear();
    this.authSessions.clear();
  }
}
