import { SpatialGrid } from "./SpatialGrid";
import type { Clock } from "./clock";
import { SystemClock } from "./clock";
import { WorldEventBuffer, WorldEventType, WorldOutcomeBuffer, type WorldEvent } from "./events";
import type { RandomSource } from "./rng";
import { SeededRng } from "./rng";
import { MonsterFlags, MonsterStore, type MonsterSpawn } from "./stores/Monsters";
import { MonsterProjectileStore } from "./stores/MonsterProjectiles";
import { PlayerStore, type PlayerSpawn, type WorldPlayer } from "./stores/Players";
import { ProjectileStore, type ProjectileSpawn } from "./stores/Projectiles";

export const enum MonsterArchetype {
  Melee = 0,
  Ranged = 1,
  Jumper = 2,
}

export const enum DamageTypeCode {
  Physical = 0,
  Fire = 1,
  Cold = 2,
  Lightning = 3,
}

export interface WorldConfig {
  width: number;
  height: number;
  fixedStepMilliseconds: number;
  maximumCatchUpSteps: number;
  monsterCapacity: number;
  projectileCapacity: number;
  monsterProjectileCapacity: number;
  playerCapacity: number;
  maximumProjectilesPerPlayer: number;
  maximumInputsPerTick: number;
  maximumEventsPerTick: number;
  spatialCellSize: number;
  monsterRadius: number;
  playerRadius: number;
  thinkIntervalTicks: number;
  activationRadius: number;
  sleepThinkIntervalTicks: number;
  separationRadius: number;
  separationStrength: number;
  forceAllMonstersActive: boolean;
  playerContactCooldownSeconds: number;
  tickWarningMilliseconds: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  width: 3_840,
  height: 3_840,
  fixedStepMilliseconds: 50,
  maximumCatchUpSteps: 4,
  monsterCapacity: 8_192,
  projectileCapacity: 4_096,
  monsterProjectileCapacity: 4_096,
  playerCapacity: 4,
  maximumProjectilesPerPlayer: 64,
  maximumInputsPerTick: 256,
  maximumEventsPerTick: 8_192,
  spatialCellSize: 128,
  monsterRadius: 18,
  playerRadius: 18,
  thinkIntervalTicks: 4,
  activationRadius: 1_050,
  sleepThinkIntervalTicks: 4,
  separationRadius: 30,
  separationStrength: 30,
  forceAllMonstersActive: false,
  playerContactCooldownSeconds: 0.9,
  tickWarningMilliseconds: 20,
};

export type WorldInput =
  | { kind: "movement"; playerIndex: number; sequence: number; x: number; y: number }
  | {
      kind: "projectileBurst";
      playerIndex: number;
      sequence: number;
      directions: ReadonlyArray<{ x: number; y: number }>;
      speed: number;
      range: number;
      radius: number;
      damage: number;
      damageType: number;
      pierces: number;
      skillId: number;
    }
  | { kind: "ward"; playerIndex: number; sequence: number; durationSeconds: number; damageReduction: number; skillId: number }
  | { kind: "dash"; playerIndex: number; sequence: number; directionX: number; directionY: number; distance: number; skillId: number };

export interface WorldDependencies {
  clock?: Clock;
  rng?: RandomSource;
  onSlowTick?: (durationMilliseconds: number, tick: number) => void;
}

export interface WorldHealthMetrics {
  droppedSimulationSteps: number;
  droppedCosmeticEvents: number;
  slowTicks: number;
  slowestTickMilliseconds: number;
}

const PLAYER_ENTITY_FLAG = 0x8000_0000;

export class World {
  readonly monsters: MonsterStore;
  readonly projectiles: ProjectileStore;
  readonly monsterProjectiles: MonsterProjectileStore;
  readonly players: PlayerStore;
  readonly grid: SpatialGrid;
  readonly events: WorldEventBuffer;
  readonly outcomes: WorldOutcomeBuffer;
  readonly config: WorldConfig;
  readonly metrics: WorldHealthMetrics = {
    droppedSimulationSteps: 0,
    droppedCosmeticEvents: 0,
    slowTicks: 0,
    slowestTickMilliseconds: 0,
  };
  tickNumber = 0;
  simulationSeconds = 0;
  rejectedInputs = 0;
  rejectedProjectiles = 0;
  private readonly clock: Clock;
  private readonly rng: RandomSource;
  private readonly onSlowTick?: WorldDependencies["onSlowTick"];
  private readonly queuedInputs: WorldInput[] = [];
  private readonly projectileCountsByPlayer: Uint16Array;
  private readonly reservedProjectileCountsByPlayer: Uint16Array;
  private reservedProjectileCount = 0;
  private readonly packTargetPlayer: Int8Array;
  private readonly packLastThinkTick: Uint32Array;
  private separationSlot = -1;
  private separationRadius = 0;
  private separationX = 0;
  private separationY = 0;
  private separationNeighbors = 0;
  private projectileQuerySlot = -1;
  private projectileQueryStartX = 0;
  private projectileQueryStartY = 0;
  private projectileQueryEndX = 0;
  private projectileQueryEndY = 0;
  private projectileQueryHitRadius = 0;
  private projectileQueryExpired = false;
  private readonly separationVisitor = (otherSlot: number): void => {
    const slot = this.separationSlot;
    if (otherSlot === slot || !this.monsters.active[otherSlot] || this.separationNeighbors >= 8) return;
    const offsetX = this.monsters.x[slot] - this.monsters.x[otherSlot];
    const offsetY = this.monsters.y[slot] - this.monsters.y[otherSlot];
    const squared = offsetX * offsetX + offsetY * offsetY;
    const radius = this.separationRadius;
    if (squared <= 0 || squared >= radius * radius) return;
    const distance = Math.sqrt(squared);
    const weight = 1 - distance / radius;
    this.separationX += (offsetX / distance) * weight;
    this.separationY += (offsetY / distance) * weight;
    this.separationNeighbors += 1;
  };
  private readonly projectileHitVisitor = (monsterSlot: number): void => {
    const monsters = this.monsters;
    const projectiles = this.projectiles;
    const slot = this.projectileQuerySlot;
    if (this.projectileQueryExpired || !monsters.active[monsterSlot] || monsters.life[monsterSlot] <= 0
      || monsters.damageThisTick[monsterSlot] >= monsters.life[monsterSlot]) return;
    const monsterId = monsters.idAt(monsterSlot);
    if (projectiles.hasHit(slot, monsterId)) return;
    if (!segmentIntersectsCircle(
      this.projectileQueryStartX,
      this.projectileQueryStartY,
      this.projectileQueryEndX,
      this.projectileQueryEndY,
      monsters.x[monsterSlot],
      monsters.y[monsterSlot],
      this.projectileQueryHitRadius,
    )) return;
    if (!projectiles.recordHit(slot, monsterId)) {
      this.projectileQueryExpired = true;
      return;
    }
    if (this.rng.next() >= monsters.evadeChance[monsterSlot]) {
      const mitigated = projectiles.damage[slot] * 100 / (100 + monsters.armor[monsterSlot]);
      const previousDamage = monsters.damageThisTick[monsterSlot];
      monsters.damageThisTick[monsterSlot] += mitigated;
      const ownerIndex = projectiles.ownerPlayer[slot];
      if (ownerIndex < monsters.damageOwnerCapacity) {
        const ownerOffset = monsterSlot * monsters.damageOwnerCapacity + ownerIndex;
        monsters.damageByOwnerThisTick[ownerOffset] += mitigated;
        monsters.damageTypeByOwnerThisTick[ownerOffset] = projectiles.damageType[slot];
        monsters.damageSkillByOwnerThisTick[ownerOffset] = projectiles.skillId[slot];
        monsters.damageSequenceByOwnerThisTick[ownerOffset] = projectiles.sequence[slot];
      }
      if (previousDamage < monsters.life[monsterSlot] && monsters.damageThisTick[monsterSlot] >= monsters.life[monsterSlot]) {
        monsters.damageTypeThisTick[monsterSlot] = projectiles.damageType[slot];
        monsters.damageOwnerThisTick[monsterSlot] = ownerIndex;
        monsters.damageSkillThisTick[monsterSlot] = projectiles.skillId[slot];
        monsters.damageSequenceThisTick[monsterSlot] = projectiles.sequence[slot];
      }
    }
    if (projectiles.remainingPierces[slot] <= 0) this.projectileQueryExpired = true;
    else projectiles.remainingPierces[slot] -= 1;
  };
  private accumulatorMilliseconds = 0;
  private lastClockMilliseconds: number | null = null;

  constructor(config: Partial<WorldConfig> = {}, dependencies: WorldDependencies = {}) {
    this.config = { ...DEFAULT_WORLD_CONFIG, ...config };
    this.clock = dependencies.clock ?? new SystemClock();
    this.rng = dependencies.rng ?? new SeededRng(1);
    this.onSlowTick = dependencies.onSlowTick;
    this.monsters = new MonsterStore(this.config.monsterCapacity, this.config.playerCapacity);
    this.projectiles = new ProjectileStore(this.config.projectileCapacity);
    this.monsterProjectiles = new MonsterProjectileStore(this.config.monsterProjectileCapacity);
    this.players = new PlayerStore(this.config.playerCapacity);
    this.grid = new SpatialGrid(this.config.width, this.config.height, this.config.spatialCellSize, this.config.monsterCapacity);
    this.events = new WorldEventBuffer(this.config.maximumEventsPerTick);
    this.outcomes = new WorldOutcomeBuffer();
    this.projectileCountsByPlayer = new Uint16Array(this.config.playerCapacity);
    this.reservedProjectileCountsByPlayer = new Uint16Array(this.config.playerCapacity);
    this.packTargetPlayer = new Int8Array(0x1_0000);
    this.packTargetPlayer.fill(-1);
    this.packLastThinkTick = new Uint32Array(0x1_0000);
  }

  addPlayer(spawn: PlayerSpawn): WorldPlayer | null {
    return this.players.add(spawn);
  }

  removePlayer(characterId: string): boolean {
    return this.players.remove(characterId);
  }

  spawnMonster(spec: MonsterSpawn): number {
    return this.monsters.spawn(spec);
  }

  spawnProjectile(spec: ProjectileSpawn, emitEvent = true): number {
    if (spec.ownerPlayer >= this.projectileCountsByPlayer.length
      || this.projectileCountsByPlayer[spec.ownerPlayer] >= this.config.maximumProjectilesPerPlayer) {
      this.rejectedProjectiles += 1;
      return 0;
    }
    const id = this.projectiles.spawn(spec);
    if (id === 0) {
      this.rejectedProjectiles += 1;
      return 0;
    }
    this.projectileCountsByPlayer[spec.ownerPlayer] += 1;
    if (emitEvent) {
      const angle = Math.atan2(spec.directionY, spec.directionX);
      const quantizedAngle = Math.round(((angle + Math.PI) / (Math.PI * 2)) * 65_535);
      this.pushEvent(WorldEventType.ProjectileSpawn, this.playerEntityId(spec.ownerPlayer), id, spec.speed, spec.x, spec.y, quantizedAngle, spec.skillId ?? 0, spec.sequence ?? 0);
    }
    return id;
  }

  enqueueInput(input: WorldInput): boolean {
    if (this.queuedInputs.length >= this.config.maximumInputsPerTick) {
      this.rejectedInputs += 1;
      return false;
    }
    if (input.kind === "projectileBurst") {
      const count = input.directions.length;
      if (count < 1 || input.playerIndex >= this.projectileCountsByPlayer.length
        || this.projectileCountsByPlayer[input.playerIndex] + this.reservedProjectileCountsByPlayer[input.playerIndex] + count > this.config.maximumProjectilesPerPlayer
        || this.projectiles.count + this.reservedProjectileCount + count > this.projectiles.capacity) {
        this.rejectedProjectiles += Math.max(1, count);
        return false;
      }
      this.reservedProjectileCountsByPlayer[input.playerIndex] += count;
      this.reservedProjectileCount += count;
    }
    this.queuedInputs.push(input);
    return true;
  }

  stepToClock(onTick?: (events: WorldEventBuffer, outcomes: readonly WorldEvent[]) => void): number {
    const now = this.clock.nowMilliseconds();
    if (this.lastClockMilliseconds === null) {
      this.lastClockMilliseconds = now;
      return 0;
    }
    const elapsed = Math.max(0, now - this.lastClockMilliseconds);
    this.lastClockMilliseconds = now;
    return this.advance(elapsed, onTick);
  }

  advance(elapsedMilliseconds: number, onTick?: (events: WorldEventBuffer, outcomes: readonly WorldEvent[]) => void): number {
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) throw new RangeError("World advance must be finite and non-negative");
    const maximumAccumulated = this.config.fixedStepMilliseconds * this.config.maximumCatchUpSteps;
    let accumulated = this.accumulatorMilliseconds + elapsedMilliseconds;
    if (accumulated > maximumAccumulated) {
      // Skip whole stale steps instead of letting the simulation tick clock
      // permanently drift behind monotonic wall time. Entity state is not
      // simulated for skipped time, but every replicated timeline remains
      // correctly aligned and clients can resume interpolation immediately.
      const droppedSteps = Math.ceil((accumulated - maximumAccumulated) / this.config.fixedStepMilliseconds);
      this.tickNumber += droppedSteps;
      this.simulationSeconds += droppedSteps * this.config.fixedStepMilliseconds / 1_000;
      this.metrics.droppedSimulationSteps += droppedSteps;
      accumulated -= droppedSteps * this.config.fixedStepMilliseconds;
    }
    this.accumulatorMilliseconds = Math.max(0, accumulated);
    let steps = 0;
    while (this.accumulatorMilliseconds >= this.config.fixedStepMilliseconds && steps < this.config.maximumCatchUpSteps) {
      this.tick(this.config.fixedStepMilliseconds / 1_000);
      onTick?.(this.events.view(), this.outcomes.view());
      this.accumulatorMilliseconds -= this.config.fixedStepMilliseconds;
      steps += 1;
    }
    return steps;
  }

  tick(deltaSeconds = this.config.fixedStepMilliseconds / 1_000): WorldEventBuffer {
    const startedAt = this.clock.nowMilliseconds();
    this.events.clear();
    this.outcomes.clear();
    this.tickNumber += 1;
    this.simulationSeconds += deltaSeconds;
    this.applyInputs();
    this.thinkMonsters();
    this.movePlayers(deltaSeconds);
    this.moveMonsters(deltaSeconds);
    this.rebuildGrid();
    this.emitNewMonsterEvents();
    this.moveProjectiles(deltaSeconds);
    this.moveMonsterProjectiles(deltaSeconds);
    this.performMonsterActions();
    this.applyMonsterDamage();
    const duration = this.clock.nowMilliseconds() - startedAt;
    this.metrics.droppedCosmeticEvents += this.events.dropped;
    if (duration > this.config.tickWarningMilliseconds) {
      this.metrics.slowTicks += 1;
      this.metrics.slowestTickMilliseconds = Math.max(this.metrics.slowestTickMilliseconds, duration);
      this.onSlowTick?.(duration, this.tickNumber);
    }
    return this.events.view();
  }

  snapshotDigest(): string {
    let hash = 2_166_136_261;
    const mix = (value: number) => {
      hash ^= value >>> 0;
      hash = Math.imul(hash, 16_777_619) >>> 0;
    };
    mix(this.tickNumber);
    for (let index = 0; index < this.monsters.count; index += 1) {
      const slot = this.monsters.activeSlots[index];
      mix(this.monsters.idAt(slot));
      mix(Math.round(this.monsters.x[slot] * 4));
      mix(Math.round(this.monsters.y[slot] * 4));
      mix(Math.round(this.monsters.life[slot] * 16));
    }
    for (let index = 0; index < this.projectiles.count; index += 1) {
      const slot = this.projectiles.activeSlots[index];
      mix(this.projectiles.idAt(slot));
      mix(Math.round(this.projectiles.x[slot] * 4));
      mix(Math.round(this.projectiles.y[slot] * 4));
    }
    for (let index = 0; index < this.monsterProjectiles.count; index += 1) {
      const slot = this.monsterProjectiles.activeSlots[index];
      mix(this.monsterProjectiles.idAt(slot));
      mix(Math.round(this.monsterProjectiles.x[slot] * 4));
      mix(Math.round(this.monsterProjectiles.y[slot] * 4));
    }
    this.players.forEach((player) => {
      mix(player.index);
      mix(Math.round(player.x * 4));
      mix(Math.round(player.y * 4));
      mix(Math.round(player.life * 16));
    });
    return hash.toString(16).padStart(8, "0");
  }

  private applyInputs(): void {
    for (const input of this.queuedInputs.splice(0)) {
      if (input.kind === "projectileBurst") {
        const count = input.directions.length;
        this.reservedProjectileCountsByPlayer[input.playerIndex] = Math.max(0, this.reservedProjectileCountsByPlayer[input.playerIndex] - count);
        this.reservedProjectileCount = Math.max(0, this.reservedProjectileCount - count);
      }
      const player = this.players.get(input.playerIndex);
      if (!player?.connected) continue;
      if (input.kind === "movement") {
        if (input.sequence <= player.lastMovementSequence) continue;
        player.lastMovementSequence = input.sequence;
        const length = Math.hypot(input.x, input.y);
        player.movementX = length > 1 ? input.x / length : input.x;
        player.movementY = length > 1 ? input.y / length : input.y;
        if (player.movementX !== 0 || player.movementY !== 0) {
          player.facingX = player.movementX;
          player.facingY = player.movementY;
        }
        continue;
      }
      if (input.sequence <= player.lastAttackSequence) continue;
      player.lastAttackSequence = input.sequence;
      const direction = input.kind === "projectileBurst" ? input.directions[0]
        : input.kind === "dash" ? { x: input.directionX, y: input.directionY }
          : { x: player.facingX, y: player.facingY };
      const directionAngle = Math.atan2(direction?.y ?? 0, direction?.x ?? 1);
      const quantizedDirection = Math.round(((directionAngle + Math.PI) / (Math.PI * 2)) * 65_535);
      this.pushEvent(WorldEventType.Skill, this.playerEntityId(player.index), 0, 0, player.x, player.y, input.skillId, quantizedDirection, input.sequence);
      if (input.kind === "ward") {
        player.wardUntilSeconds = Math.max(player.wardUntilSeconds, this.simulationSeconds + input.durationSeconds);
        player.wardDamageReduction = Math.max(0, Math.min(0.95, input.damageReduction));
        continue;
      }
      if (input.kind === "dash") {
        const length = Math.hypot(input.directionX, input.directionY) || 1;
        player.x = this.clampX(player.x + (input.directionX / length) * input.distance);
        player.y = this.clampY(player.y + (input.directionY / length) * input.distance);
        player.facingX = input.directionX / length;
        player.facingY = input.directionY / length;
        continue;
      }
      for (const direction of input.directions) {
        this.spawnProjectile({
          ownerPlayer: player.index,
          x: player.x,
          y: player.y,
          directionX: direction.x,
          directionY: direction.y,
          speed: input.speed,
          range: input.range,
          radius: input.radius,
          damage: input.damage,
          damageType: input.damageType,
          pierces: input.pierces,
          skillId: input.skillId,
          sequence: input.sequence,
        });
      }
    }
  }

  private thinkMonsters(): void {
    const interval = Math.max(1, this.config.thinkIntervalTicks);
    for (let index = 0; index < this.monsters.count; index += 1) {
      const slot = this.monsters.activeSlots[index];
      const packId = this.monsters.packId[slot];
      if (this.packLastThinkTick[packId] === this.tickNumber) {
        this.monsters.targetPlayer[slot] = this.packTargetPlayer[packId];
        continue;
      }
      const thinkInterval = this.monsters.flags[slot] & MonsterFlags.Sleeping
        ? interval * Math.max(1, this.config.sleepThinkIntervalTicks)
        : interval;
      if ((this.tickNumber + packId) % thinkInterval !== 0) continue;
      let closest = -1;
      let closestDistanceSquared = Number.POSITIVE_INFINITY;
      this.players.forEach((player) => {
        if (!player.connected || player.life <= 0) return;
        const dx = player.x - this.monsters.x[slot];
        const dy = player.y - this.monsters.y[slot];
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < closestDistanceSquared) {
          closest = player.index;
          closestDistanceSquared = distanceSquared;
        }
      });
      this.packTargetPlayer[packId] = closest;
      this.packLastThinkTick[packId] = this.tickNumber;
      this.monsters.targetPlayer[slot] = closest;
    }
  }

  private movePlayers(deltaSeconds: number): void {
    this.players.forEach((player) => {
      if (!player.connected || player.life <= 0) return;
      player.x = this.clampX(player.x + player.movementX * player.moveSpeed * deltaSeconds);
      player.y = this.clampY(player.y + player.movementY * player.moveSpeed * deltaSeconds);
    });
  }

  private moveMonsters(deltaSeconds: number): void {
    const rangedStopDistance = 210;
    for (let index = 0; index < this.monsters.count; index += 1) {
      const slot = this.monsters.activeSlots[index];
      this.monsters.flags[slot] &= ~MonsterFlags.Moved;
      const player = this.players.get(this.monsters.targetPlayer[slot]);
      if (!player?.connected || player.life <= 0) continue;
      const rawDx = player.x - this.monsters.x[slot];
      const rawDy = player.y - this.monsters.y[slot];
      const rawDistance = Math.hypot(rawDx, rawDy) || 1;
      if (!this.config.forceAllMonstersActive && rawDistance > this.config.activationRadius) {
        this.monsters.flags[slot] |= MonsterFlags.Sleeping;
        this.monsters.velocityX[slot] = 0;
        this.monsters.velocityY[slot] = 0;
        continue;
      }
      this.monsters.flags[slot] &= ~MonsterFlags.Sleeping;
      if (!(this.monsters.flags[slot] & MonsterFlags.Aggroed)) {
        this.monsters.flags[slot] |= MonsterFlags.Aggroed;
        this.pushEvent(
          WorldEventType.MonsterAggro,
          this.monsters.idAt(slot),
          this.playerEntityId(player.index),
          0,
          this.monsters.x[slot],
          this.monsters.y[slot],
          this.monsters.archetype[slot],
          0,
          0,
        );
      }
      const targetX = player.x + this.monsters.formationX[slot];
      const targetY = player.y + this.monsters.formationY[slot];
      const dx = targetX - this.monsters.x[slot];
      const dy = targetY - this.monsters.y[slot];
      const distance = Math.hypot(dx, dy) || 1;
      const stopDistance = this.monsters.behavior[slot] === MonsterArchetype.Ranged
        ? rangedStopDistance
        : this.monsters.attackRange[slot] * 0.8;
      if (distance <= stopDistance) {
        this.monsters.velocityX[slot] = 0;
        this.monsters.velocityY[slot] = 0;
        continue;
      }
      const speed = this.monsters.moveSpeed[slot];
      const separationRadius = this.config.separationRadius;
      this.separationSlot = slot;
      this.separationRadius = separationRadius;
      this.separationX = 0;
      this.separationY = 0;
      this.separationNeighbors = 0;
      this.grid.queryAabb(
        this.monsters.x[slot] - separationRadius,
        this.monsters.y[slot] - separationRadius,
        this.monsters.x[slot] + separationRadius,
        this.monsters.y[slot] + separationRadius,
        this.separationVisitor,
      );
      this.monsters.velocityX[slot] = (dx / distance) * speed + this.separationX * this.config.separationStrength;
      this.monsters.velocityY[slot] = (dy / distance) * speed + this.separationY * this.config.separationStrength;
      this.monsters.previousX[slot] = this.monsters.x[slot];
      this.monsters.previousY[slot] = this.monsters.y[slot];
      this.monsters.x[slot] = this.clampX(this.monsters.x[slot] + this.monsters.velocityX[slot] * deltaSeconds);
      this.monsters.y[slot] = this.clampY(this.monsters.y[slot] + this.monsters.velocityY[slot] * deltaSeconds);
      this.monsters.flags[slot] |= MonsterFlags.Moved;
    }
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (let index = 0; index < this.monsters.count; index += 1) {
      const slot = this.monsters.activeSlots[index];
      this.grid.insert(slot, this.monsters.x[slot], this.monsters.y[slot]);
    }
  }

  private emitNewMonsterEvents(): void {
    for (let index = 0; index < this.monsters.count; index += 1) {
      const slot = this.monsters.activeSlots[index];
      if (!(this.monsters.flags[slot] & MonsterFlags.Spawned)) continue;
      this.monsters.flags[slot] &= ~MonsterFlags.Spawned;
    }
  }

  private moveProjectiles(deltaSeconds: number): void {
    const projectiles = this.projectiles;
    const combinedRadius = this.config.monsterRadius;
    let activeIndex = 0;
    while (activeIndex < projectiles.count) {
      const slot = projectiles.activeSlots[activeIndex];
      const id = projectiles.idAt(slot);
      const distance = Math.min(projectiles.remainingDistance[slot], Math.hypot(projectiles.velocityX[slot], projectiles.velocityY[slot]) * deltaSeconds);
      const velocityLength = Math.hypot(projectiles.velocityX[slot], projectiles.velocityY[slot]) || 1;
      const startX = projectiles.x[slot];
      const startY = projectiles.y[slot];
      const endX = startX + (projectiles.velocityX[slot] / velocityLength) * distance;
      const endY = startY + (projectiles.velocityY[slot] / velocityLength) * distance;
      projectiles.previousX[slot] = startX;
      projectiles.previousY[slot] = startY;
      projectiles.x[slot] = endX;
      projectiles.y[slot] = endY;
      projectiles.remainingDistance[slot] -= distance;
      const hitRadius = projectiles.radius[slot] + combinedRadius;
      this.projectileQuerySlot = slot;
      this.projectileQueryStartX = startX;
      this.projectileQueryStartY = startY;
      this.projectileQueryEndX = endX;
      this.projectileQueryEndY = endY;
      this.projectileQueryHitRadius = hitRadius;
      this.projectileQueryExpired = false;
      this.grid.querySegment(startX, startY, endX, endY, hitRadius, this.projectileHitVisitor);
      if (this.projectileQueryExpired || projectiles.remainingDistance[slot] <= 0) this.expireProjectile(slot, id, endX, endY);
      else activeIndex += 1;
    }
  }

  private performMonsterActions(): void {
    for (let index = 0; index < this.monsters.count; index += 1) {
      const slot = this.monsters.activeSlots[index];
      if (this.monsters.nextActionAt[slot] > this.simulationSeconds) continue;
      const player = this.players.get(this.monsters.targetPlayer[slot]);
      if (!player?.connected || player.life <= 0) continue;
      const dx = player.x - this.monsters.x[slot];
      const dy = player.y - this.monsters.y[slot];
      const distance = Math.hypot(dx, dy);
      const archetype = this.monsters.behavior[slot];
      const actionRange = archetype === MonsterArchetype.Ranged ? 360 : archetype === MonsterArchetype.Jumper ? 190 : this.monsters.attackRange[slot];
      if (distance > actionRange) continue;
      this.monsters.nextActionAt[slot] = this.simulationSeconds + this.monsters.attackCooldownSeconds[slot];
      if (archetype === MonsterArchetype.Ranged) {
        const projectileId = this.monsterProjectiles.spawn({
          ownerMonsterId: this.monsters.idAt(slot),
          x: this.monsters.x[slot],
          y: this.monsters.y[slot],
          directionX: dx,
          directionY: dy,
          speed: this.monsters.projectileSpeed[slot],
          range: this.monsters.projectileRange[slot],
          radius: this.monsters.projectileRadius[slot],
          damage: this.monsters.damage[slot],
        });
        if (projectileId !== 0) {
          const directionAngle = Math.atan2(dy, dx);
          const quantizedDirection = Math.round(((directionAngle + Math.PI) / (Math.PI * 2)) * 65_535);
          this.pushEvent(
            WorldEventType.MonsterAction,
            this.monsters.idAt(slot),
            this.playerEntityId(player.index),
            this.monsters.projectileSpeed[slot],
            this.monsters.x[slot],
            this.monsters.y[slot],
            archetype,
            quantizedDirection,
            projectileId,
          );
        }
        continue;
      }
      if (archetype === MonsterArchetype.Jumper && distance > this.monsters.attackRange[slot]) {
        const travel = Math.min(150, Math.max(0, distance - this.monsters.attackRange[slot] * 0.7));
        const length = distance || 1;
        this.monsters.x[slot] = this.clampX(this.monsters.x[slot] + (dx / length) * travel);
        this.monsters.y[slot] = this.clampY(this.monsters.y[slot] + (dy / length) * travel);
      }
      const canDamage = this.simulationSeconds >= player.nextContactDamageAtSeconds;
      const damage = canDamage ? this.resolveMonsterDamage(player, this.monsters.damage[slot]) : 0;
      if (canDamage) {
        player.nextContactDamageAtSeconds = this.simulationSeconds + this.config.playerContactCooldownSeconds;
        player.life = Math.max(0, player.life - damage);
      }
      this.pushEvent(
        WorldEventType.MonsterAction,
        this.monsters.idAt(slot),
        this.playerEntityId(player.index),
        damage,
        this.monsters.x[slot],
        this.monsters.y[slot],
        archetype,
        0,
        0,
      );
    }
  }

  private moveMonsterProjectiles(deltaSeconds: number): void {
    const projectiles = this.monsterProjectiles;
    let activeIndex = 0;
    while (activeIndex < projectiles.count) {
      const slot = projectiles.activeSlots[activeIndex];
      const id = projectiles.idAt(slot);
      const speed = Math.hypot(projectiles.velocityX[slot], projectiles.velocityY[slot]);
      const distance = Math.min(projectiles.remainingDistance[slot], speed * deltaSeconds);
      const startX = projectiles.x[slot];
      const startY = projectiles.y[slot];
      const endX = speed > 0 ? startX + projectiles.velocityX[slot] / speed * distance : startX;
      const endY = speed > 0 ? startY + projectiles.velocityY[slot] / speed * distance : startY;
      projectiles.x[slot] = endX;
      projectiles.y[slot] = endY;
      projectiles.remainingDistance[slot] -= distance;
      let hitPlayer: WorldPlayer | null = null;
      this.players.forEach((player) => {
        if (hitPlayer || !player.connected || player.life <= 0) return;
        if (segmentIntersectsCircle(startX, startY, endX, endY, player.x, player.y, projectiles.radius[slot] + this.config.playerRadius)) {
          hitPlayer = player;
        }
      });
      if (hitPlayer) {
        const player = hitPlayer as WorldPlayer;
        const damage = this.resolveMonsterDamage(player, projectiles.damage[slot]);
        player.life = Math.max(0, player.life - damage);
        this.pushEvent(
          WorldEventType.MonsterProjectileHit,
          projectiles.ownerMonsterId[slot],
          this.playerEntityId(player.index),
          damage,
          endX,
          endY,
          0,
          0,
          id,
        );
        projectiles.release(id);
        continue;
      }
      if (projectiles.remainingDistance[slot] <= 0) {
        this.pushEvent(
          WorldEventType.MonsterProjectileExpire,
          projectiles.ownerMonsterId[slot],
          0,
          0,
          endX,
          endY,
          0,
          0,
          id,
        );
        projectiles.release(id);
        continue;
      }
      activeIndex += 1;
    }
  }

  private applyMonsterDamage(): void {
    let activeIndex = 0;
    while (activeIndex < this.monsters.count) {
      const slot = this.monsters.activeSlots[activeIndex];
      const damage = this.monsters.damageThisTick[slot];
      if (damage <= 0) {
        activeIndex += 1;
        continue;
      }
      this.monsters.damageThisTick[slot] = 0;
      this.monsters.life[slot] = Math.max(0, this.monsters.life[slot] - damage);
      const ownerOffset = slot * this.monsters.damageOwnerCapacity;
      for (let ownerIndex = 0; ownerIndex < this.monsters.damageOwnerCapacity; ownerIndex += 1) {
        const index = ownerOffset + ownerIndex;
        const ownerDamage = this.monsters.damageByOwnerThisTick[index];
        if (ownerDamage <= 0) continue;
        this.pushEvent(
          WorldEventType.Damage,
          this.playerEntityId(ownerIndex),
          this.monsters.idAt(slot),
          ownerDamage,
          this.monsters.x[slot],
          this.monsters.y[slot],
          this.monsters.damageTypeByOwnerThisTick[index],
          this.monsters.damageSkillByOwnerThisTick[index],
          this.monsters.damageSequenceByOwnerThisTick[index],
        );
        this.monsters.damageByOwnerThisTick[index] = 0;
      }
      if (this.monsters.life[slot] > 0) {
        activeIndex += 1;
        continue;
      }
      const id = this.monsters.idAt(slot);
      const ownerIndex = this.monsters.damageOwnerThisTick[slot];
      const ownerId = this.playerEntityId(ownerIndex);
      const sequence = this.monsters.damageSequenceThisTick[slot];
      this.pushOutcome(
        WorldEventType.Kill,
        ownerId,
        id,
        this.monsters.experience[slot],
        this.monsters.x[slot],
        this.monsters.y[slot],
        this.monsters.archetype[slot],
        this.monsters.rarity[slot],
        sequence,
      );
      // The room owns item generation, but every kill emits exactly one loot-roll
      // intent. Applying a probability here as well would square the configured
      // drop chance and make the item-quantity stat dishonest.
      this.pushOutcome(WorldEventType.Drop, id, ownerId, this.monsters.itemQuantity[slot], this.monsters.x[slot], this.monsters.y[slot], this.monsters.itemRarity[slot], this.monsters.rarity[slot], sequence);
      this.pushOutcome(WorldEventType.MonsterDespawn, id, 0, 0, this.monsters.x[slot], this.monsters.y[slot], 0, 0, 0);
      this.pushEvent(WorldEventType.MonsterDespawn, id, 0, 0, this.monsters.x[slot], this.monsters.y[slot], 0, 0, 0);
      this.monsters.release(id);
    }
  }

  private resolveMonsterDamage(player: WorldPlayer, rawDamage: number): number {
    if (this.rng.next() < Math.max(0, Math.min(0.95, player.evadeChance))) return 0;
    const armorMitigated = rawDamage * 100 / (100 + Math.max(0, player.armor));
    return player.wardUntilSeconds > this.simulationSeconds ? armorMitigated * (1 - player.wardDamageReduction) : armorMitigated;
  }

  private expireProjectile(slot: number, id: number, x: number, y: number): void {
    const owner = this.projectiles.ownerPlayer[slot];
    if (owner < this.projectileCountsByPlayer.length && this.projectileCountsByPlayer[owner] > 0) this.projectileCountsByPlayer[owner] -= 1;
    this.pushEvent(WorldEventType.ProjectileExpire, this.playerEntityId(owner), id, 0, x, y, this.projectiles.damageType[slot], this.projectiles.skillId[slot], this.projectiles.sequence[slot]);
    this.projectiles.release(id);
  }

  private pushEvent(type: WorldEventType, actorId: number, targetId: number, amount: number, x: number, y: number, auxA: number, auxB: number, sequence: number): void {
    this.events.pushValues(type, this.tickNumber, actorId, targetId, amount, x, y, auxA, auxB, sequence);
  }

  private pushOutcome(type: WorldEventType, actorId: number, targetId: number, amount: number, x: number, y: number, auxA: number, auxB: number, sequence: number): void {
    this.outcomes.push({ type, tick: this.tickNumber, actorId, targetId, amount, x, y, auxA, auxB, sequence });
  }

  private playerEntityId(index: number): number {
    return (PLAYER_ENTITY_FLAG | index) >>> 0;
  }

  private clampX(x: number): number {
    return Math.max(0, Math.min(this.config.width, x));
  }

  private clampY(y: number): number {
    return Math.max(0, Math.min(this.config.height, y));
  }
}

function segmentIntersectsCircle(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, radius: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lengthSquared));
  const nearestX = x1 + dx * projection;
  const nearestY = y1 + dy * projection;
  const offsetX = cx - nearestX;
  const offsetY = cy - nearestY;
  return offsetX * offsetX + offsetY * offsetY <= radius * radius;
}
