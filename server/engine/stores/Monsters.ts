import { SlotStore } from "./SlotStore";
import { MonsterFlags } from "../../../multiplayer/wire/monster-flags";

export { MonsterFlags } from "../../../multiplayer/wire/monster-flags";

export interface MonsterSpawn {
  x: number;
  y: number;
  archetype: number;
  behavior?: number;
  rarity: number;
  packId?: number;
  life: number;
  damage: number;
  armor?: number;
  evadeChance?: number;
  moveSpeed: number;
  attackRange?: number;
  attackCooldownSeconds?: number;
  projectileSpeed?: number;
  projectileRange?: number;
  projectileRadius?: number;
  experience?: number;
  itemQuantity?: number;
  itemRarity?: number;
}

export class MonsterStore extends SlotStore {
  readonly damageOwnerCapacity: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly previousX: Float32Array;
  readonly previousY: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityY: Float32Array;
  readonly formationX: Float32Array;
  readonly formationY: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly damage: Float32Array;
  readonly armor: Float32Array;
  readonly evadeChance: Float32Array;
  readonly moveSpeed: Float32Array;
  readonly attackRange: Float32Array;
  readonly attackCooldownSeconds: Float32Array;
  readonly projectileSpeed: Float32Array;
  readonly projectileRange: Float32Array;
  readonly projectileRadius: Float32Array;
  readonly nextActionAt: Float64Array;
  readonly experience: Float32Array;
  readonly itemQuantity: Float32Array;
  readonly itemRarity: Float32Array;
  readonly archetype: Uint8Array;
  readonly behavior: Uint8Array;
  readonly rarity: Uint8Array;
  readonly flags: Uint8Array;
  readonly packId: Uint16Array;
  readonly targetPlayer: Int8Array;
  readonly damageThisTick: Float32Array;
  readonly damageByOwnerThisTick: Float32Array;
  readonly damageTypeByOwnerThisTick: Uint8Array;
  readonly damageSkillByOwnerThisTick: Uint8Array;
  readonly damageSequenceByOwnerThisTick: Uint32Array;
  readonly damageTypeThisTick: Uint8Array;
  readonly damageOwnerThisTick: Uint8Array;
  readonly damageSkillThisTick: Uint8Array;
  readonly damageSequenceThisTick: Uint32Array;

  constructor(capacity: number, damageOwnerCapacity = 4) {
    super(capacity);
    this.damageOwnerCapacity = damageOwnerCapacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousY = new Float32Array(capacity);
    this.velocityX = new Float32Array(capacity);
    this.velocityY = new Float32Array(capacity);
    this.formationX = new Float32Array(capacity);
    this.formationY = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
    this.armor = new Float32Array(capacity);
    this.evadeChance = new Float32Array(capacity);
    this.moveSpeed = new Float32Array(capacity);
    this.attackRange = new Float32Array(capacity);
    this.attackCooldownSeconds = new Float32Array(capacity);
    this.projectileSpeed = new Float32Array(capacity);
    this.projectileRange = new Float32Array(capacity);
    this.projectileRadius = new Float32Array(capacity);
    this.nextActionAt = new Float64Array(capacity);
    this.experience = new Float32Array(capacity);
    this.itemQuantity = new Float32Array(capacity);
    this.itemRarity = new Float32Array(capacity);
    this.archetype = new Uint8Array(capacity);
    this.behavior = new Uint8Array(capacity);
    this.rarity = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.packId = new Uint16Array(capacity);
    this.targetPlayer = new Int8Array(capacity);
    this.targetPlayer.fill(-1);
    this.damageThisTick = new Float32Array(capacity);
    this.damageByOwnerThisTick = new Float32Array(capacity * damageOwnerCapacity);
    this.damageTypeByOwnerThisTick = new Uint8Array(capacity * damageOwnerCapacity);
    this.damageSkillByOwnerThisTick = new Uint8Array(capacity * damageOwnerCapacity);
    this.damageSequenceByOwnerThisTick = new Uint32Array(capacity * damageOwnerCapacity);
    this.damageTypeThisTick = new Uint8Array(capacity);
    this.damageOwnerThisTick = new Uint8Array(capacity);
    this.damageSkillThisTick = new Uint8Array(capacity);
    this.damageSequenceThisTick = new Uint32Array(capacity);
  }

  spawn(spec: MonsterSpawn): number {
    const slot = this.allocateSlot();
    if (slot < 0) return 0;
    this.x[slot] = this.previousX[slot] = spec.x;
    this.y[slot] = this.previousY[slot] = spec.y;
    this.life[slot] = this.maxLife[slot] = Math.max(1, spec.life);
    this.damage[slot] = Math.max(0, spec.damage);
    this.armor[slot] = Math.max(0, spec.armor ?? 0);
    this.evadeChance[slot] = Math.max(0, Math.min(0.95, spec.evadeChance ?? 0));
    this.moveSpeed[slot] = Math.max(0, spec.moveSpeed);
    this.attackRange[slot] = Math.max(1, spec.attackRange ?? 32);
    this.attackCooldownSeconds[slot] = Math.max(0.05, spec.attackCooldownSeconds ?? 1);
    this.projectileSpeed[slot] = Math.max(1, spec.projectileSpeed ?? 245);
    this.projectileRange[slot] = Math.max(1, spec.projectileRange ?? 520);
    this.projectileRadius[slot] = Math.max(1, spec.projectileRadius ?? 8);
    this.experience[slot] = Math.max(0, spec.experience ?? 0);
    this.itemQuantity[slot] = Math.max(0, spec.itemQuantity ?? 100);
    this.itemRarity[slot] = Math.max(0, spec.itemRarity ?? 100);
    this.archetype[slot] = spec.archetype & 0xff;
    this.behavior[slot] = (spec.behavior ?? spec.archetype) & 0xff;
    this.rarity[slot] = spec.rarity & 0xff;
    this.packId[slot] = spec.packId ?? 0;
    const formationAngle = (slot % 8) / 8 * Math.PI * 2;
    const formationRadius = 18 + (slot % 3) * 10;
    this.formationX[slot] = Math.cos(formationAngle) * formationRadius;
    this.formationY[slot] = Math.sin(formationAngle) * formationRadius;
    this.flags[slot] = MonsterFlags.Alive | MonsterFlags.Spawned;
    this.targetPlayer[slot] = -1;
    return this.idAt(slot);
  }

  protected clearSlot(slot: number): void {
    this.flags[slot] = MonsterFlags.None;
    this.velocityX[slot] = 0;
    this.velocityY[slot] = 0;
    this.life[slot] = 0;
    this.targetPlayer[slot] = -1;
    this.damageThisTick[slot] = 0;
    const ownerOffset = slot * this.damageOwnerCapacity;
    this.damageByOwnerThisTick.fill(0, ownerOffset, ownerOffset + this.damageOwnerCapacity);
    this.damageTypeByOwnerThisTick.fill(0, ownerOffset, ownerOffset + this.damageOwnerCapacity);
    this.damageSkillByOwnerThisTick.fill(0, ownerOffset, ownerOffset + this.damageOwnerCapacity);
    this.damageSequenceByOwnerThisTick.fill(0, ownerOffset, ownerOffset + this.damageOwnerCapacity);
    this.damageOwnerThisTick[slot] = 0;
    this.damageSkillThisTick[slot] = 0;
    this.damageSequenceThisTick[slot] = 0;
  }
}
