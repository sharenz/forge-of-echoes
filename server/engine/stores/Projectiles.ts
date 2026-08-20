import { SlotStore } from "./SlotStore";

export interface ProjectileSpawn {
  ownerPlayer: number;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  speed: number;
  range: number;
  radius: number;
  damage: number;
  damageType: number;
  pierces: number;
  skillId?: number;
  sequence?: number;
}

export class ProjectileStore extends SlotStore {
  static readonly maximumHitRecords = 16;
  readonly ownerPlayer: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly previousX: Float32Array;
  readonly previousY: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityY: Float32Array;
  readonly remainingDistance: Float32Array;
  readonly radius: Float32Array;
  readonly damage: Float32Array;
  readonly damageType: Uint8Array;
  readonly remainingPierces: Int16Array;
  readonly skillId: Uint8Array;
  readonly sequence: Uint32Array;
  readonly hitCount: Uint8Array;
  readonly hitMonsterIds: Uint32Array;

  constructor(capacity: number) {
    super(capacity);
    this.ownerPlayer = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousY = new Float32Array(capacity);
    this.velocityX = new Float32Array(capacity);
    this.velocityY = new Float32Array(capacity);
    this.remainingDistance = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
    this.damageType = new Uint8Array(capacity);
    this.remainingPierces = new Int16Array(capacity);
    this.skillId = new Uint8Array(capacity);
    this.sequence = new Uint32Array(capacity);
    this.hitCount = new Uint8Array(capacity);
    this.hitMonsterIds = new Uint32Array(capacity * ProjectileStore.maximumHitRecords);
  }

  spawn(spec: ProjectileSpawn): number {
    const slot = this.allocateSlot();
    if (slot < 0) return 0;
    const length = Math.hypot(spec.directionX, spec.directionY) || 1;
    this.ownerPlayer[slot] = spec.ownerPlayer & 0xff;
    this.x[slot] = this.previousX[slot] = spec.x;
    this.y[slot] = this.previousY[slot] = spec.y;
    this.velocityX[slot] = (spec.directionX / length) * spec.speed;
    this.velocityY[slot] = (spec.directionY / length) * spec.speed;
    this.remainingDistance[slot] = Math.max(0, spec.range);
    this.radius[slot] = Math.max(0, spec.radius);
    this.damage[slot] = Math.max(0, spec.damage);
    this.damageType[slot] = spec.damageType & 0xff;
    this.remainingPierces[slot] = Math.max(0, spec.pierces);
    this.skillId[slot] = spec.skillId ?? 0;
    this.sequence[slot] = spec.sequence ?? 0;
    this.hitCount[slot] = 0;
    return this.idAt(slot);
  }

  hasHit(slot: number, monsterId: number): boolean {
    const offset = slot * ProjectileStore.maximumHitRecords;
    for (let index = 0; index < this.hitCount[slot]; index += 1) {
      if (this.hitMonsterIds[offset + index] === monsterId) return true;
    }
    return false;
  }

  recordHit(slot: number, monsterId: number): boolean {
    if (this.hasHit(slot, monsterId)) return false;
    const count = this.hitCount[slot];
    if (count >= ProjectileStore.maximumHitRecords) return false;
    this.hitMonsterIds[slot * ProjectileStore.maximumHitRecords + count] = monsterId;
    this.hitCount[slot] = count + 1;
    return true;
  }

  protected clearSlot(slot: number): void {
    this.velocityX[slot] = 0;
    this.velocityY[slot] = 0;
    this.remainingDistance[slot] = 0;
    this.remainingPierces[slot] = 0;
    this.hitCount[slot] = 0;
  }
}
