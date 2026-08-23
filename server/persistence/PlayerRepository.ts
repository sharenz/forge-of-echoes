import type { CharacterClassId, PlayerProfile } from "../../app/game/domain";
import type { MerchantId } from "../../app/game/config/merchants";

export interface PlayerIdentity {
  accountId: string;
  characterId: string;
  characterName: string;
  classId: CharacterClassId;
}

export interface CharacterSummary extends PlayerIdentity {
  level: number;
}

export interface CharacterRosterEntry extends PlayerIdentity {
  level: number;
}

export interface AccountIdentity {
  accountId: string;
  handle: string;
  merchantEntitlements: MerchantId[];
}

export interface AccountCredentials {
  account: AccountIdentity;
  passwordHash: string | null;
}

export interface AuthoritativeProfile {
  profile: PlayerProfile;
  revision: number;
}

export interface CreatePlayerInput {
  handle: string;
  characterName: string;
  classId: CharacterClassId;
}

export interface PlayerRepository {
  initialize(): Promise<void>;
  findAccountCredentials(handle: string): Promise<AccountCredentials | null>;
  createAuthenticatedAccount(handle: string, passwordHash: string): Promise<AccountIdentity>;
  createAuthSession(sessionId: string, accountId: string, expiresAt: number): Promise<void>;
  isAuthSessionActive(sessionId: string, accountId: string, now?: number): Promise<boolean>;
  revokeAuthSession(sessionId: string, accountId: string): Promise<void>;
  createOrLoadAccount(handle: string): Promise<AccountIdentity>;
  listCharacters(accountId: string): Promise<CharacterRosterEntry[]>;
  createCharacter(accountId: string, input: Omit<CreatePlayerInput, "handle">): Promise<PlayerIdentity>;
  findAccountCharacter(accountId: string, characterId: string): Promise<PlayerIdentity | null>;
  findCharacter(characterId: string): Promise<CharacterSummary | null>;
  findCharacters(characterIds: readonly string[]): Promise<CharacterSummary[]>;
  listMerchantEntitlementsForCharacter(characterId: string): Promise<MerchantId[]>;
  loadProfile(characterId: string): Promise<AuthoritativeProfile | null>;
  saveProfile(characterId: string, expectedRevision: number, profile: PlayerProfile): Promise<AuthoritativeProfile>;
  /**
   * Locks, hydrates, transforms, and persists one profile on a single database
   * connection. A null expected revision means "latest authoritative state".
   * Implementations must serialize mutations per character.
   */
  mutateProfile(
    characterId: string,
    expectedRevision: number | null,
    transform: (profile: PlayerProfile) => PlayerProfile,
  ): Promise<AuthoritativeProfile>;
  close(): Promise<void>;
}
