import { MULTIPLAYER_LIMITS } from "../../multiplayer/protocol";
import type { PartyCoordinator, PublicPartyListing } from "../coordination/PartyCoordinator";
import type { PlayerRepository } from "../persistence/PlayerRepository";

export async function listPublicPartyListings(
  parties: PartyCoordinator,
  players: PlayerRepository,
  excludeCharacterId?: string,
): Promise<PublicPartyListing[]> {
  const snapshots = (await parties.listPublic()).filter((party) => !excludeCharacterId || !party.memberCharacterIds.includes(excludeCharacterId));
  const leaders = new Map((await players.findCharacters(snapshots.map((party) => party.leaderCharacterId)))
    .map((leader) => [leader.characterId, leader]));
  return snapshots.flatMap((party) => {
    const leader = leaders.get(party.leaderCharacterId);
    if (!leader) return [];
    return [{
      id: party.id,
      name: `${leader.characterName}'s Party`,
      leader: {
        characterId: leader.characterId,
        characterName: leader.characterName,
        classId: leader.classId,
        level: leader.level,
      },
      memberCount: party.memberCharacterIds.length,
      maximumMembers: MULTIPLAYER_LIMITS.playersPerRoom,
      activity: party.activeMap ? "map" as const : "hideout" as const,
      activeMap: party.activeMap ? { name: party.activeMap.map.baseName, tier: party.activeMap.map.tier } : null,
    } satisfies PublicPartyListing];
  });
}
