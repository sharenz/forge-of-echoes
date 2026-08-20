export interface PlayerSpawn {
  characterId: string;
  x: number;
  y: number;
  life: number;
  focus: number;
  armor?: number;
  evadeChance?: number;
  moveSpeed: number;
}

export interface WorldPlayer extends Omit<PlayerSpawn, "armor" | "evadeChance"> {
  index: number;
  armor: number;
  evadeChance: number;
  maxLife: number;
  maxFocus: number;
  facingX: number;
  facingY: number;
  movementX: number;
  movementY: number;
  lastMovementSequence: number;
  lastAttackSequence: number;
  wardUntilSeconds: number;
  wardDamageReduction: number;
  nextContactDamageAtSeconds: number;
  connected: boolean;
}

export class PlayerStore {
  private readonly entries: Array<WorldPlayer | null>;
  private readonly indexByCharacter = new Map<string, number>();

  constructor(readonly capacity: number) {
    this.entries = Array.from({ length: capacity }, () => null);
  }

  add(spawn: PlayerSpawn): WorldPlayer | null {
    const existing = this.getByCharacterId(spawn.characterId);
    if (existing) return existing;
    const index = this.entries.findIndex((entry) => entry === null);
    if (index < 0) return null;
    const player: WorldPlayer = {
      ...spawn,
      index,
      maxLife: spawn.life,
      maxFocus: spawn.focus,
      armor: spawn.armor ?? 0,
      evadeChance: spawn.evadeChance ?? 0,
      facingX: 1,
      facingY: 0,
      movementX: 0,
      movementY: 0,
      lastMovementSequence: 0,
      lastAttackSequence: 0,
      wardUntilSeconds: 0,
      wardDamageReduction: 0,
      nextContactDamageAtSeconds: 0,
      connected: true,
    };
    this.entries[index] = player;
    this.indexByCharacter.set(spawn.characterId, index);
    return player;
  }

  remove(characterId: string): boolean {
    const index = this.indexByCharacter.get(characterId);
    if (index === undefined) return false;
    this.entries[index] = null;
    this.indexByCharacter.delete(characterId);
    return true;
  }

  get(index: number): WorldPlayer | null {
    return this.entries[index] ?? null;
  }

  getByCharacterId(characterId: string): WorldPlayer | null {
    const index = this.indexByCharacter.get(characterId);
    return index === undefined ? null : this.entries[index];
  }

  forEach(callback: (player: WorldPlayer) => void): void {
    for (const player of this.entries) if (player) callback(player);
  }

  values(): WorldPlayer[] {
    return this.entries.filter((player): player is WorldPlayer => player !== null);
  }
}
