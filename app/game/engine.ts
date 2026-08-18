import { BARGAINS } from "./content";
import type {
  Bargain,
  CharacterStats,
  MapItem,
  RunLoot,
  RunResult,
} from "./domain";
import { generateEquipment } from "./items";
import { mapRewardBonus } from "./maps";
import { shuffle } from "./random";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 620;
const TOTAL_WAVES = 6;

type RunPhase = "fighting" | "bargain" | "victory" | "defeat";
type EnemyKind = "swarm" | "brute" | "elite" | "boss";

interface Point {
  x: number;
  y: number;
}

interface Enemy extends Point {
  id: number;
  kind: EnemyKind;
  radius: number;
  life: number;
  maxLife: number;
  speed: number;
  damage: number;
  hitFlash: number;
  contactCooldown: number;
}

interface Projectile extends Point {
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  pierce: number;
  color: string;
}

interface Particle extends Point {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Hazard extends Point {
  radius: number;
  delay: number;
  life: number;
  damage: number;
  triggered: boolean;
}

interface AppliedScaling {
  pack: number;
  speed: number;
  health: number;
  damage: number;
  reward: number;
  extraElites: number;
}

export interface EngineSnapshot {
  phase: RunPhase;
  wave: number;
  totalWaves: number;
  life: number;
  maxLife: number;
  focus: number;
  maxFocus: number;
  lives: number;
  enemiesAlive: number;
  enemiesRemaining: number;
  enemiesSlain: number;
  elapsedSeconds: number;
  novaCooldown: number;
  dashCooldown: number;
  bargains: Bargain[];
  rewardMultiplier: number;
  loot: RunLoot;
}

interface EngineOptions {
  map: MapItem;
  stats: CharacterStats;
  onSnapshot: (snapshot: EngineSnapshot) => void;
  onFinished: (result: RunResult) => void;
}

export class GameEngine {
  private readonly map: MapItem;
  private readonly stats: CharacterStats;
  private readonly onSnapshot: EngineOptions["onSnapshot"];
  private readonly onFinished: EngineOptions["onFinished"];
  private phase: RunPhase = "fighting";
  private wave = 1;
  private lives = 3;
  private elapsed = 0;
  private player = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, life: 0, focus: 100, invulnerable: 0 };
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private hazards: Hazard[] = [];
  private keys = new Set<string>();
  private aim: Point = { x: WORLD_WIDTH / 2 + 100, y: WORLD_HEIGHT / 2 };
  private firing = false;
  private spawnQueue = 0;
  private spawnTimer = 0;
  private attackTimer = 0;
  private novaCooldown = 0;
  private dashCooldown = 0;
  private snapshotTimer = 0;
  private nextEnemyId = 1;
  private enemiesSlain = 0;
  private bargains: Bargain[] = [];
  private appliedBargains: Bargain[] = [];
  private loot: RunLoot = { materials: {}, items: [], xp: 0 };
  private finished = false;

  constructor(options: EngineOptions) {
    this.map = options.map;
    this.stats = options.stats;
    this.onSnapshot = options.onSnapshot;
    this.onFinished = options.onFinished;
    this.player.life = options.stats.maxLife;
    this.player.focus = options.stats.maxFocus;
    this.prepareWave();
    this.emitSnapshot();
  }

  setKey(code: string, pressed: boolean): void {
    if (pressed) this.keys.add(code);
    else this.keys.delete(code);
  }

  setPointer(point: Point, firing: boolean): void {
    this.aim = point;
    this.firing = firing;
  }

  useAbility(code: "nova" | "dash"): void {
    if (this.phase !== "fighting") return;
    if (code === "nova" && this.novaCooldown <= 0 && this.player.focus >= 30) {
      this.player.focus -= 30;
      this.novaCooldown = 4.5;
      for (let index = 0; index < 16; index += 1) {
        const angle = (Math.PI * 2 * index) / 16;
        this.projectiles.push({
          x: this.player.x,
          y: this.player.y,
          vx: Math.cos(angle) * 510,
          vy: Math.sin(angle) * 510,
          radius: 6,
          damage: this.stats.attackDamage * 0.78,
          life: 0.9,
          pierce: 1,
          color: "#ffb35c",
        });
      }
      this.burst(this.player.x, this.player.y, "#f08a3e", 24);
    }
    if (code === "dash" && this.dashCooldown <= 0 && this.player.focus >= 15) {
      this.player.focus -= 15;
      this.dashCooldown = 3.2;
      const direction = this.normalizedDirection(this.player, this.aim);
      this.player.x = this.clamp(this.player.x + direction.x * 125, 24, WORLD_WIDTH - 24);
      this.player.y = this.clamp(this.player.y + direction.y * 125, 24, WORLD_HEIGHT - 24);
      this.player.invulnerable = 0.28;
      this.burst(this.player.x, this.player.y, "#f7d6a0", 12);
    }
  }

  chooseBargain(id: string): void {
    if (this.phase !== "bargain") return;
    const bargain = this.bargains.find((candidate) => candidate.id === id);
    if (!bargain) return;
    this.appliedBargains.push(bargain);
    this.bargains = [];
    this.wave += 1;
    this.phase = "fighting";
    this.player.life = Math.min(this.stats.maxLife, this.player.life + this.stats.maxLife * 0.22);
    this.player.focus = this.stats.maxFocus;
    this.prepareWave();
    this.emitSnapshot();
  }

  abandon(): void {
    if (this.finished) return;
    this.finish(false);
  }

  tick(deltaSeconds: number): void {
    const delta = Math.min(deltaSeconds, 0.033);
    this.elapsed += delta;
    this.updateParticles(delta);
    if (this.phase !== "fighting") return;

    this.snapshotTimer -= delta;
    this.attackTimer -= delta;
    this.novaCooldown = Math.max(0, this.novaCooldown - delta);
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);
    this.player.invulnerable = Math.max(0, this.player.invulnerable - delta);
    const focusRecovery = this.map.modifiers.includes("exhausting") ? 5.6 : 8;
    this.player.focus = Math.min(this.stats.maxFocus, this.player.focus + focusRecovery * delta);

    this.updatePlayer(delta);
    this.updateSpawning(delta);
    this.updateProjectiles(delta);
    this.updateEnemies(delta);
    this.updateHazards(delta);

    if (this.spawnQueue === 0 && this.enemies.length === 0 && this.phase === "fighting") {
      this.completeWave();
    }
    if (this.snapshotTimer <= 0) {
      this.snapshotTimer = 0.1;
      this.emitSnapshot();
    }
  }

  draw(context: CanvasRenderingContext2D, width: number, height: number): void {
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    const offsetX = (width - WORLD_WIDTH * scale) / 2;
    const offsetY = (height - WORLD_HEIGHT * scale) / 2;
    context.save();
    context.clearRect(0, 0, width, height);
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);
    this.drawArena(context);
    this.drawHazards(context);
    this.drawProjectiles(context);
    this.drawEnemies(context);
    this.drawPlayer(context);
    this.drawParticles(context);
    context.restore();
  }

  toWorld(clientX: number, clientY: number, rect: DOMRect): Point {
    const scale = Math.min(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const offsetX = (rect.width - WORLD_WIDTH * scale) / 2;
    const offsetY = (rect.height - WORLD_HEIGHT * scale) / 2;
    return {
      x: this.clamp((clientX - rect.left - offsetX) / scale, 0, WORLD_WIDTH),
      y: this.clamp((clientY - rect.top - offsetY) / scale, 0, WORLD_HEIGHT),
    };
  }

  getSnapshot(): EngineSnapshot {
    return {
      phase: this.phase,
      wave: this.wave,
      totalWaves: TOTAL_WAVES,
      life: Math.max(0, this.player.life),
      maxLife: this.stats.maxLife,
      focus: this.player.focus,
      maxFocus: this.stats.maxFocus,
      lives: this.lives,
      enemiesAlive: this.enemies.length,
      enemiesRemaining: this.spawnQueue,
      enemiesSlain: this.enemiesSlain,
      elapsedSeconds: this.elapsed,
      novaCooldown: this.novaCooldown,
      dashCooldown: this.dashCooldown,
      bargains: this.bargains,
      rewardMultiplier: this.getScaling().reward,
      loot: this.loot,
    };
  }

  private prepareWave(): void {
    const scaling = this.getScaling();
    const baseCount = 6 + this.wave * 4;
    this.spawnQueue = Math.round(baseCount * scaling.pack);
    if (this.wave === TOTAL_WAVES) this.spawnQueue += this.map.modifiers.includes("twin-crowned") ? 2 : 1;
    this.spawnTimer = 0.25;
  }

  private updatePlayer(delta: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dy -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dy += 1;
    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      this.player.x = this.clamp(this.player.x + (dx / length) * this.stats.moveSpeed * delta, 18, WORLD_WIDTH - 18);
      this.player.y = this.clamp(this.player.y + (dy / length) * this.stats.moveSpeed * delta, 18, WORLD_HEIGHT - 18);
    }
    if ((this.firing || this.keys.has("Space")) && this.attackTimer <= 0) this.fireBasic();
  }

  private fireBasic(): void {
    const direction = this.normalizedDirection(this.player, this.aim);
    this.attackTimer = 0.3 / this.stats.attackSpeed;
    this.projectiles.push({
      x: this.player.x + direction.x * 18,
      y: this.player.y + direction.y * 18,
      vx: direction.x * 620,
      vy: direction.y * 620,
      radius: 5,
      damage: this.stats.attackDamage,
      life: 1.05,
      pierce: 0,
      color: "#f3c47b",
    });
  }

  private updateSpawning(delta: number): void {
    if (this.spawnQueue <= 0) return;
    this.spawnTimer -= delta;
    if (this.spawnTimer > 0) return;
    const restless = this.map.modifiers.includes("restless");
    this.spawnTimer = restless ? 0.18 : 0.3;
    this.spawnEnemy();
    this.spawnQueue -= 1;
  }

  private spawnEnemy(): void {
    const scaling = this.getScaling();
    const edge = Math.floor(Math.random() * 4);
    const padding = 34;
    const point =
      edge === 0
        ? { x: Math.random() * WORLD_WIDTH, y: padding }
        : edge === 1
          ? { x: WORLD_WIDTH - padding, y: Math.random() * WORLD_HEIGHT }
          : edge === 2
            ? { x: Math.random() * WORLD_WIDTH, y: WORLD_HEIGHT - padding }
            : { x: padding, y: Math.random() * WORLD_HEIGHT };

    const remainingBosses = this.wave === TOTAL_WAVES && this.spawnQueue <= (this.map.modifiers.includes("twin-crowned") ? 2 : 1);
    const eliteFrequency = this.map.modifiers.includes("commanded") ? 5 : 9;
    const isExtraElite = this.enemies.filter((enemy) => enemy.kind === "elite").length < scaling.extraElites && this.spawnQueue < 3;
    const kind: EnemyKind = remainingBosses ? "boss" : isExtraElite || this.spawnQueue % eliteFrequency === 0 ? "elite" : Math.random() > 0.76 ? "brute" : "swarm";
    const base = {
      swarm: { radius: 11, life: 25, speed: 108, damage: 8 },
      brute: { radius: 18, life: 74, speed: 61, damage: 16 },
      elite: { radius: 22, life: 145, speed: 76, damage: 20 },
      boss: { radius: 38, life: 700, speed: 54, damage: 28 },
    }[kind];
    const wavePower = 1 + (this.wave - 1) * 0.18 + (this.map.tier - 1) * 0.06;
    const maxLife = base.life * wavePower * scaling.health;
    this.enemies.push({
      id: this.nextEnemyId++,
      kind,
      ...point,
      radius: base.radius,
      life: maxLife,
      maxLife,
      speed: base.speed * scaling.speed,
      damage: base.damage * wavePower * scaling.damage,
      hitFlash: 0,
      contactCooldown: 0,
    });
    this.burst(point.x, point.y, "#9f5d3b", 5);
  }

  private updateProjectiles(delta: number): void {
    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      projectile.life -= delta;
      for (const enemy of this.enemies) {
        if (projectile.life <= 0) break;
        if (Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) < projectile.radius + enemy.radius) {
          enemy.life -= projectile.damage;
          enemy.hitFlash = 0.1;
          this.burst(projectile.x, projectile.y, "#ffd08a", 3);
          if (projectile.pierce > 0) projectile.pierce -= 1;
          else projectile.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter(
      (projectile) => projectile.life > 0 && projectile.x > -30 && projectile.x < WORLD_WIDTH + 30 && projectile.y > -30 && projectile.y < WORLD_HEIGHT + 30,
    );
  }

  private updateEnemies(delta: number): void {
    const dead: Enemy[] = [];
    for (const enemy of this.enemies) {
      if (enemy.life <= 0) {
        dead.push(enemy);
        continue;
      }
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta);
      enemy.contactCooldown = Math.max(0, enemy.contactCooldown - delta);
      const direction = this.normalizedDirection(enemy, this.player);
      enemy.x += direction.x * enemy.speed * delta;
      enemy.y += direction.y * enemy.speed * delta;
      const distance = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (distance < enemy.radius + 15 && enemy.contactCooldown <= 0 && this.player.invulnerable <= 0) {
        const mitigated = enemy.damage * (100 / (100 + this.stats.armor));
        this.player.life -= mitigated;
        enemy.contactCooldown = enemy.kind === "swarm" ? 0.7 : 1.05;
        this.player.invulnerable = 0.12;
        this.burst(this.player.x, this.player.y, "#d45d4c", 8);
      }
      if (this.map.modifiers.includes("vampiric") && enemy.life < enemy.maxLife) {
        enemy.life = Math.min(enemy.maxLife, enemy.life + enemy.maxLife * 0.007 * delta);
      }
    }
    dead.forEach((enemy) => this.killEnemy(enemy));
    if (dead.length > 0) {
      const ids = new Set(dead.map((enemy) => enemy.id));
      this.enemies = this.enemies.filter((enemy) => !ids.has(enemy.id));
    }
    if (this.player.life <= 0) this.handlePlayerDeath();
  }

  private updateHazards(delta: number): void {
    for (const hazard of this.hazards) {
      hazard.delay -= delta;
      if (hazard.delay <= 0 && !hazard.triggered) {
        hazard.triggered = true;
        const distance = Math.hypot(this.player.x - hazard.x, this.player.y - hazard.y);
        if (distance < hazard.radius && this.player.invulnerable <= 0) {
          this.player.life -= hazard.damage;
          this.player.invulnerable = 0.18;
        }
        this.burst(hazard.x, hazard.y, "#ef6d34", 18);
      }
      if (hazard.triggered) hazard.life -= delta;
    }
    this.hazards = this.hazards.filter((hazard) => hazard.life > 0);
  }

  private updateParticles(delta: number): void {
    for (const particle of this.particles) {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= 0.96;
      particle.vy *= 0.96;
      particle.life -= delta;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private killEnemy(enemy: Enemy): void {
    this.enemiesSlain += 1;
    const reward = this.getScaling().reward;
    this.loot.xp += Math.round((enemy.kind === "boss" ? 70 : enemy.kind === "elite" ? 20 : 6) * reward);
    const scrapChance = Math.min(0.85, 0.23 * reward);
    if (Math.random() < scrapChance) this.addLootMaterial("scrap", enemy.kind === "boss" ? 4 : 1);
    if (Math.random() < 0.055 * reward || enemy.kind === "boss") this.addLootMaterial("essence", 1);
    if (Math.random() < 0.014 * reward) this.addLootMaterial("mapDust", 1);
    if (enemy.kind === "elite" && Math.random() < 0.18 * reward) this.addLootMaterial("threatGlyph", 1);
    if (enemy.kind === "boss" || Math.random() < 0.012 * reward) {
      const forced = enemy.kind === "boss" ? (Math.random() > 0.7 ? "rare" : "magic") : undefined;
      this.loot.items.push(generateEquipment(this.map.tier * 5 + this.wave, forced));
    }
    if (this.map.modifiers.includes("volcanic") && enemy.kind !== "boss") {
      this.hazards.push({ x: enemy.x, y: enemy.y, radius: 58, delay: 0.62, life: 1.1, damage: 18, triggered: false });
    }
    this.burst(enemy.x, enemy.y, enemy.kind === "boss" ? "#f6bc63" : "#a84f3a", enemy.kind === "boss" ? 32 : 9);
  }

  private completeWave(): void {
    if (this.wave >= TOTAL_WAVES) {
      this.phase = "victory";
      this.finish(true);
      return;
    }
    this.phase = "bargain";
    this.bargains = shuffle(BARGAINS).slice(0, 3);
    this.emitSnapshot();
  }

  private handlePlayerDeath(): void {
    this.lives -= 1;
    if (this.lives <= 0) {
      this.phase = "defeat";
      this.finish(false);
      return;
    }
    this.player.x = WORLD_WIDTH / 2;
    this.player.y = WORLD_HEIGHT / 2;
    this.player.life = this.stats.maxLife;
    this.player.focus = this.stats.maxFocus;
    this.player.invulnerable = 2;
    this.projectiles = [];
  }

  private finish(completed: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.emitSnapshot();
    this.onFinished({
      completed,
      wave: this.wave,
      enemiesSlain: this.enemiesSlain,
      elapsedSeconds: this.elapsed,
      loot: this.loot,
    });
  }

  private getScaling(): AppliedScaling {
    const scaling: AppliedScaling = {
      pack: 1,
      speed: 1,
      health: 1,
      damage: 1,
      reward: 1 + mapRewardBonus(this.map) / 100,
      extraElites: this.map.modifiers.includes("commanded") ? 1 : 0,
    };
    if (this.map.modifiers.includes("teeming")) scaling.pack *= 1.3;
    if (this.map.modifiers.includes("restless")) scaling.speed *= 1.12;
    this.appliedBargains.forEach((bargain) => {
      scaling.pack *= bargain.packMultiplier ?? 1;
      scaling.speed *= bargain.speedMultiplier ?? 1;
      scaling.health *= bargain.healthMultiplier ?? 1;
      scaling.damage *= bargain.damageMultiplier ?? 1;
      scaling.reward *= bargain.rewardMultiplier;
      if (bargain.id === "bountiful") scaling.extraElites += 1;
    });
    return scaling;
  }

  private addLootMaterial(key: keyof RunLoot["materials"], amount: number): void {
    const current = this.loot.materials[key] ?? 0;
    this.loot.materials[key] = current + amount;
  }

  private normalizedDirection(from: Point, to: Point): Point {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  private burst(x: number, y: number, color: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 150;
      const life = 0.25 + Math.random() * 0.55;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: 1.5 + Math.random() * 4,
        color,
      });
    }
  }

  private emitSnapshot(): void {
    this.onSnapshot(this.getSnapshot());
  }

  private drawArena(context: CanvasRenderingContext2D): void {
    context.fillStyle = "#16130f";
    context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    context.strokeStyle = "rgba(222, 173, 107, 0.08)";
    context.lineWidth = 1;
    for (let x = 20; x < WORLD_WIDTH; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, WORLD_HEIGHT);
      context.stroke();
    }
    for (let y = 20; y < WORLD_HEIGHT; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(WORLD_WIDTH, y);
      context.stroke();
    }
    context.strokeStyle = "rgba(235, 142, 66, 0.22)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 145, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 220, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "rgba(223, 181, 119, 0.35)";
    context.strokeRect(8, 8, WORLD_WIDTH - 16, WORLD_HEIGHT - 16);
  }

  private drawPlayer(context: CanvasRenderingContext2D): void {
    const direction = this.normalizedDirection(this.player, this.aim);
    context.save();
    context.translate(this.player.x, this.player.y);
    context.rotate(Math.atan2(direction.y, direction.x));
    context.globalAlpha = this.player.invulnerable > 0 ? 0.55 + Math.sin(this.elapsed * 24) * 0.25 : 1;
    context.fillStyle = "#f5d39a";
    context.beginPath();
    context.moveTo(20, 0);
    context.lineTo(-12, -13);
    context.lineTo(-8, 0);
    context.lineTo(-12, 13);
    context.closePath();
    context.fill();
    context.strokeStyle = "#7b4026";
    context.lineWidth = 3;
    context.stroke();
    context.restore();
  }

  private drawEnemies(context: CanvasRenderingContext2D): void {
    const colors: Record<EnemyKind, string> = {
      swarm: "#8d4034",
      brute: "#764436",
      elite: "#ae713e",
      boss: "#c4934f",
    };
    for (const enemy of this.enemies) {
      context.fillStyle = enemy.hitFlash > 0 ? "#fff0d5" : colors[enemy.kind];
      context.beginPath();
      context.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = enemy.kind === "boss" ? "#f8c56f" : "#2a1713";
      context.lineWidth = enemy.kind === "boss" ? 4 : 2;
      context.stroke();
      if (enemy.kind === "elite" || enemy.kind === "boss") {
        const width = enemy.radius * 2.2;
        context.fillStyle = "#281a16";
        context.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 11, width, 4);
        context.fillStyle = enemy.kind === "boss" ? "#e3ad57" : "#cc6a46";
        context.fillRect(enemy.x - width / 2, enemy.y - enemy.radius - 11, width * (enemy.life / enemy.maxLife), 4);
      }
    }
  }

  private drawProjectiles(context: CanvasRenderingContext2D): void {
    for (const projectile of this.projectiles) {
      context.fillStyle = projectile.color;
      context.shadowColor = projectile.color;
      context.shadowBlur = 12;
      context.beginPath();
      context.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
    }
  }

  private drawParticles(context: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      context.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    context.globalAlpha = 1;
  }

  private drawHazards(context: CanvasRenderingContext2D): void {
    for (const hazard of this.hazards) {
      const pulse = 0.65 + Math.sin(this.elapsed * 16) * 0.2;
      context.fillStyle = hazard.triggered ? "rgba(236, 91, 35, 0.22)" : `rgba(238, 124, 49, ${0.12 * pulse})`;
      context.strokeStyle = hazard.triggered ? "#ef7139" : "#b75a31";
      context.lineWidth = hazard.triggered ? 5 : 2;
      context.beginPath();
      context.arc(hazard.x, hazard.y, hazard.radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
