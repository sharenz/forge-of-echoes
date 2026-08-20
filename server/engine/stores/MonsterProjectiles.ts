import { SlotStore } from "./SlotStore";

export interface MonsterProjectileSpawn {
  ownerMonsterId: number;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  speed: number;
  range: number;
  radius: number;
  damage: number;
}

/** Fixed-capacity server-authoritative hostile projectiles. */
export class MonsterProjectileStore extends SlotStore {
  readonly ownerMonsterId: Uint32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityY: Float32Array;
  readonly remainingDistance: Float32Array;
  readonly radius: Float32Array;
  readonly damage: Float32Array;

  constructor(capacity: number) {
    super(capacity);
    this.ownerMonsterId = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.velocityX = new Float32Array(capacity);
    this.velocityY = new Float32Array(capacity);
    this.remainingDistance = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
  }

  spawn(spec: MonsterProjectileSpawn): number {
    const slot = this.allocateSlot();
    if (slot < 0) return 0;
    const length = Math.hypot(spec.directionX, spec.directionY) || 1;
    this.ownerMonsterId[slot] = spec.ownerMonsterId >>> 0;
    this.x[slot] = spec.x;
    this.y[slot] = spec.y;
    this.velocityX[slot] = spec.directionX / length * Math.max(0, spec.speed);
    this.velocityY[slot] = spec.directionY / length * Math.max(0, spec.speed);
    this.remainingDistance[slot] = Math.max(0, spec.range);
    this.radius[slot] = Math.max(0, spec.radius);
    this.damage[slot] = Math.max(0, spec.damage);
    return this.idAt(slot);
  }

  protected clearSlot(slot: number): void {
    this.ownerMonsterId[slot] = 0;
    this.velocityX[slot] = 0;
    this.velocityY[slot] = 0;
    this.remainingDistance[slot] = 0;
    this.damage[slot] = 0;
  }
}
