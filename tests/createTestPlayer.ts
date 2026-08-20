import type { CreatePlayerInput, PlayerIdentity, PlayerRepository } from "../server/persistence/PlayerRepository";

/** Test fixture helper that exercises the same account and roster operations as production. */
export async function createTestPlayer(repository: PlayerRepository, input: CreatePlayerInput): Promise<PlayerIdentity> {
  const account = await repository.createOrLoadAccount(input.handle);
  const [existing] = await repository.listCharacters(account.accountId);
  if (existing) {
    return {
      accountId: existing.accountId,
      characterId: existing.characterId,
      characterName: existing.characterName,
      classId: existing.classId,
    };
  }
  return repository.createCharacter(account.accountId, input);
}
