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
  createOrLoadAccount(handle: string): Promise<AccountIdentity>;
  listCharacters(accountId: string): Promise<CharacterRosterEntry[]>;
  createCharacter(accountId: string, input: Omit<CreatePlayerInput, "handle">): Promise<PlayerIdentity>;
  findAccountCharacter(accountId: string, characterId: string): Promise<PlayerIdentity | null>;
  findCharacter(characterId: string): Promise<CharacterSummary | null>;
  listMerchantEntitlementsForCharacter(characterId: string): Promise<MerchantId[]>;
  loadProfile(characterId: string): Promise<AuthoritativeProfile | null>;
  saveProfile(characterId: string, expectedRevision: number, profile: PlayerProfile): Promise<AuthoritativeProfile>;
  close(): Promise<void>;
}
