import Phaser from "phaser";
import { ACTIVE_SKILLS, BASIC_ATTACK, rollHitDamage, shouldSpawnNextWave, type MapDrop, type RolledHitDamage } from "../game/combat";
import { ARENA_RULES } from "../game/config/arena";
import { DAMAGE_TYPE_DEFINITIONS } from "../game/config/damage";
import { MONSTER_PACK_RULES } from "../game/config/monster-packs";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "../game/config/monsters";
import type { SkillDefinition } from "../game/config/schema";
import type { CharacterClassId, DamageType, MonsterRarity, SkillLevels } from "../game/domain";
import { monsterPackModifierNames, resolveMonsterStats, rollMonsterPack } from "../game/encounters";
import { dropChances, rollEquipmentRarity } from "../game/loot";
import { monsterExperienceReward } from "../game/progression";
import { resolveSkillDefinition, type ResolvedSkillDefinition } from "../game/skills";
import { SkillAudio } from "./SkillAudio";
import type { WorldHudState, WorldRuntimeOptions, WorldStation } from "./types";

const VIEW_SIZE = 960;
const MAP_SIZE = VIEW_SIZE * 4;
const SPATIAL_CELL_SIZE = 64;
const SPATIAL_COLUMNS = Math.ceil(MAP_SIZE / SPATIAL_CELL_SIZE) + 2;
const FIXED_STEP = 1000 / 60;
const MAX_FRAME_DELTA = 50;
const PROJECTILE_POOL_SIZE = 160;
const ENEMY_PROJECTILE_POOL_SIZE = 240;
const DAMAGE_NUMBER_POOL_SIZE = 160;
const VFX_PARTICLE_POOL_SIZE = 240;
const HEALTH_BAR_WIDTH = 42;
const HEALTH_BAR_HEIGHT = 5;
const PLAYER_SCALE = 2.15;

type PlayerPose = "idle" | "walk" | "attack";

interface EnemyState {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  archetypeId: MonsterArchetypeId;
  rarity: MonsterRarity;
  modifierNames: string[];
  speed: number;
  contactDamage: number;
  armor: number;
  evadeChance: number;
  itemQuantity: number;
  itemRarity: number;
  baseScale: number;
  attackCooldown: number;
  jumpCooldown: number;
  jumpRemaining: number;
  jumpStartX: number;
  jumpStartY: number;
  jumpTargetX: number;
  jumpTargetY: number;
  homeX: number;
  homeY: number;
  phase: number;
  aggro: boolean;
  healthLabel: Phaser.GameObjects.Text | null;
}

interface ProjectileState {
  sprite: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  damage: number;
  damageType: DamageType;
  remaining: number;
  trailElapsed: number;
  remainingPierces: number;
  hitEnemies: Set<EnemyState>;
}

interface EnemyProjectileState extends ProjectileState {
  x: number;
  y: number;
}

interface GroundDropState {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  x: number;
  y: number;
  phase: number;
  drop: MapDrop;
}

interface VfxParticleState {
  sprite: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  remaining: number;
  lifetime: number;
  startScale: number;
  endScale: number;
  rotationSpeed: number;
}

const CLASS_COLORS: Record<CharacterClassId, { cloth: number; accent: number }> = {
  amazon: { cloth: 0x536b38, accent: 0xe4b85f },
  barbarian: { cloth: 0x7b352c, accent: 0xd97a4f },
  sorceress: { cloth: 0x49345e, accent: 0xff8548 },
};

const PACK_REGIONS = [
  [0.14, 0.15], [0.49, 0.13], [0.82, 0.16],
  [0.22, 0.34], [0.48, 0.36], [0.77, 0.36],
  [0.12, 0.54], [0.36, 0.56], [0.68, 0.55], [0.87, 0.58],
  [0.18, 0.79], [0.47, 0.81], [0.79, 0.8],
] as const;

class CraftyScene extends Phaser.Scene {
  private readonly options: WorldRuntimeOptions;
  private readonly audio = new SkillAudio();
  private player: Phaser.GameObjects.Sprite | null = null;
  private playerShadow: Phaser.GameObjects.Image | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  private enemies: EnemyState[] = [];
  private projectiles: ProjectileState[] = [];
  private enemyProjectiles: EnemyProjectileState[] = [];
  private groundDrops: GroundDropState[] = [];
  private enemyPool: Phaser.GameObjects.Group | null = null;
  private projectilePool: Phaser.GameObjects.Group | null = null;
  private enemyProjectilePool: Phaser.GameObjects.Group | null = null;
  private dropPool: Phaser.GameObjects.Group | null = null;
  private enemyHealthBars: Phaser.GameObjects.Graphics | null = null;
  private healthLabelPool: Phaser.GameObjects.Text[] = [];
  private damageNumberPool: Phaser.GameObjects.Text[] = [];
  private vfxPool: Phaser.GameObjects.Group | null = null;
  private vfxParticles: VfxParticleState[] = [];
  private spatialBuckets = new Map<number, EnemyState[]>();
  private accumulator = 0;
  private attackCooldown = 0;
  private novaCooldown = 0;
  private riftCharges = 0;
  private riftRecharge = 0;
  private resolvedBasic: ResolvedSkillDefinition;
  private resolvedNova: ResolvedSkillDefinition;
  private resolvedDash: ResolvedSkillDefinition;
  private life: number;
  private focus: number;
  private lives = 3;
  private wave = 1;
  private waveElapsedSeconds = 0;
  private slain = 0;
  private lootCollected = 0;
  private elapsedSeconds = 0;
  private hudElapsed = 0;
  private arenaComplete = false;
  private lastFacing = 1;
  private playerAnimationLock = 0;

  constructor(options: WorldRuntimeOptions) {
    super("crafty-world");
    this.options = options;
    this.resolvedBasic = resolveSkillDefinition(BASIC_ATTACK, 1);
    this.resolvedNova = resolveSkillDefinition(ACTIVE_SKILLS.nova, options.skillLevels.nova);
    this.resolvedDash = resolveSkillDefinition(ACTIVE_SKILLS.dash, options.skillLevels.dash);
    this.riftCharges = this.resolvedDash.maxCharges;
    this.life = options.arenaBalance?.maxLife ?? 100;
    this.focus = options.arenaBalance?.maxFocus ?? 100;
  }

  preload(): void {
    this.load.image("pixel-forge", "/pixel-forge-hideout.webp");
    this.load.image("ashen-wilderness", "/pixel-ashen-wilderness.webp");
    this.load.image("ember-sigil", "/ember-sigil.png");
  }

  create(): void {
    this.createTextures();
    const worldSize = this.options.mode === "arena" ? MAP_SIZE : VIEW_SIZE;
    const backgroundKey = this.options.mode === "arena" ? "ashen-wilderness" : "pixel-forge";
    const background = this.add.image(worldSize / 2, worldSize / 2, backgroundKey).setDisplaySize(worldSize, worldSize);
    if (this.options.mode === "class-select") {
      background.setTint(0x746d67);
      this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE, VIEW_SIZE, 0x07090b, 0.5);
      this.buildClassShowcase();
      return;
    }

    this.createPlayer();
    if (this.options.mode === "hideout") this.buildHideoutStations();
    if (this.options.mode === "arena") {
      this.enemyPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 1000, runChildUpdate: false });
      this.projectilePool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: PROJECTILE_POOL_SIZE, runChildUpdate: false });
      this.enemyProjectilePool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: ENEMY_PROJECTILE_POOL_SIZE, runChildUpdate: false });
      this.dropPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 300, runChildUpdate: false });
      this.vfxPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: VFX_PARTICLE_POOL_SIZE, runChildUpdate: false });
      this.enemyHealthBars = this.add.graphics().setDepth(470);
      this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
      this.cameras.main.startFollow(this.player!, true, 1, 1);
      this.cameras.main.setDeadzone(360, 360);
      this.cameras.main.roundPixels = true;
      this.startWave(1);
    }

    this.keys = this.input.keyboard?.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      upAlt: Phaser.Input.Keyboard.KeyCodes.UP,
      leftAlt: Phaser.Input.Keyboard.KeyCodes.LEFT,
      downAlt: Phaser.Input.Keyboard.KeyCodes.DOWN,
      rightAlt: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      attack: Phaser.Input.Keyboard.KeyCodes.SPACE,
      nova: Phaser.Input.Keyboard.KeyCodes.Q,
      dash: Phaser.Input.Keyboard.KeyCodes.E,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.options.mode === "arena" && !this.options.paused) this.tryBasicAttack();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.audio.dispose());
  }

  update(_time: number, delta: number): void {
    if (!this.player || this.options.paused) {
      this.accumulator = 0;
      return;
    }
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.nova)) this.useSkill("nova");
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.dash)) this.useSkill("dash");
    this.accumulator += Math.min(delta, MAX_FRAME_DELTA);
    while (this.accumulator >= FIXED_STEP) {
      this.fixedUpdate(FIXED_STEP / 1000);
      this.accumulator -= FIXED_STEP;
    }
  }

  useSkill(skill: "nova" | "dash"): void {
    if (this.options.mode !== "arena" || !this.player || this.options.paused) return;
    if (skill === "nova" && this.novaCooldown <= 0 && this.focus >= this.resolvedNova.focusCost) {
      this.focus -= this.resolvedNova.focusCost;
      this.novaCooldown = this.resolvedNova.cooldown;
      this.playSkillPresentation(this.resolvedNova);
      for (let index = 0; index < this.resolvedNova.projectileCount; index += 1) {
        const angle = (Math.PI * 2 * index) / this.resolvedNova.projectileCount;
        this.spawnProjectile(Math.cos(angle), Math.sin(angle), this.resolvedNova);
      }
    }
    if (skill === "dash" && this.riftCharges > 0 && this.focus >= this.resolvedDash.focusCost) {
      this.focus -= this.resolvedDash.focusCost;
      this.riftCharges -= 1;
      if (this.riftRecharge <= 0) this.riftRecharge = this.resolvedDash.recharge;
      const pointer = this.input.activePointer;
      const dx = pointer.worldX - this.player.x;
      const dy = pointer.worldY - this.player.y;
      const length = Math.hypot(dx, dy) || 1;
      const startX = this.player.x;
      const startY = this.player.y;
      this.player.x += (dx / length) * 105;
      this.player.y += (dy / length) * 105;
      this.clampPlayer();
      this.playSkillPresentation(this.resolvedDash, startX, startY);
    }
  }

  getHud(): WorldHudState {
    return {
      fps: Math.round(this.game.loop.actualFps || 0),
      mode: this.options.mode,
      wave: this.wave,
      enemies: this.enemies.length,
      nextWaveIn: this.wave < (this.options.arenaBalance?.waves ?? ARENA_RULES.totalWaves)
        ? Math.max(0, ARENA_RULES.waveSpawnIntervalSeconds - this.waveElapsedSeconds)
        : null,
      life: Math.max(0, this.life),
      maxLife: this.options.arenaBalance?.maxLife ?? 100,
      focus: this.focus,
      maxFocus: this.options.arenaBalance?.maxFocus ?? 100,
      groundDrops: this.groundDrops.length,
      lootCollected: this.lootCollected,
      novaCooldown: this.novaCooldown,
      riftCharges: this.riftCharges,
      riftMaxCharges: this.resolvedDash.maxCharges,
      riftRecharge: this.riftRecharge,
    };
  }

  updateArenaBalance(balance: NonNullable<WorldRuntimeOptions["arenaBalance"]>): void {
    const previousMaxLife = this.options.arenaBalance?.maxLife ?? balance.maxLife;
    const previousMaxFocus = this.options.arenaBalance?.maxFocus ?? balance.maxFocus;
    this.life = Phaser.Math.Clamp(this.life * (balance.maxLife / previousMaxLife), 1, balance.maxLife);
    this.focus = Phaser.Math.Clamp(this.focus * (balance.maxFocus / previousMaxFocus), 0, balance.maxFocus);
    this.options.arenaBalance = balance;
    this.options.onHud(this.getHud());
  }

  updateSkillLevels(skillLevels: SkillLevels): void {
    const previousMaxCharges = this.resolvedDash.maxCharges;
    this.resolvedNova = resolveSkillDefinition(ACTIVE_SKILLS.nova, skillLevels.nova);
    this.resolvedDash = resolveSkillDefinition(ACTIVE_SKILLS.dash, skillLevels.dash);
    this.riftCharges = Phaser.Math.Clamp(
      this.riftCharges + Math.max(0, this.resolvedDash.maxCharges - previousMaxCharges),
      0,
      this.resolvedDash.maxCharges,
    );
    if (this.riftCharges === this.resolvedDash.maxCharges) this.riftRecharge = 0;
    this.options.skillLevels = skillLevels;
    this.options.onHud(this.getHud());
  }

  private fixedUpdate(delta: number): void {
    if (!this.player) return;
    this.elapsedSeconds += delta;
    this.waveElapsedSeconds += delta;
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.novaCooldown = Math.max(0, this.novaCooldown - delta);
    this.playerAnimationLock = Math.max(0, this.playerAnimationLock - delta);
    if (this.riftCharges < this.resolvedDash.maxCharges) {
      this.riftRecharge = Math.max(0, this.riftRecharge - delta);
      if (this.riftRecharge <= 0) {
        this.riftCharges += 1;
        this.riftRecharge = this.riftCharges < this.resolvedDash.maxCharges ? this.resolvedDash.recharge : 0;
      }
    }
    this.focus = Math.min(this.options.arenaBalance?.maxFocus ?? 100, this.focus + delta * (this.options.arenaBalance?.focusRegen ?? ARENA_RULES.baseFocusRegen));

    let xInput = 0;
    let yInput = 0;
    if (this.keys) {
      xInput = Number(this.keys.right.isDown || this.keys.rightAlt.isDown) - Number(this.keys.left.isDown || this.keys.leftAlt.isDown);
      yInput = Number(this.keys.down.isDown || this.keys.downAlt.isDown) - Number(this.keys.up.isDown || this.keys.upAlt.isDown);
    }
    const length = Math.hypot(xInput, yInput) || 1;
    if (xInput || yInput) {
      const speed = (this.options.arenaBalance?.moveSpeed ?? 5.6) * 34;
      this.player.x += (xInput / length) * speed * delta;
      this.player.y += (yInput / length) * speed * delta;
      if (xInput) this.lastFacing = Math.sign(xInput);
      this.player.setFlipX(this.lastFacing < 0);
      this.clampPlayer();
    }
    if (this.playerAnimationLock <= 0) {
      this.playPlayerPose(xInput || yInput ? "walk" : "idle");
    }
    this.playerShadow?.setPosition(this.player.x, this.player.y + 15);
    this.player.setDepth(Math.round(this.player.y / 10) + 11);
    this.playerShadow?.setDepth(Math.round(this.player.y / 10) + 9);

    if (this.options.mode === "arena") {
      if (this.keys?.attack.isDown || this.input.activePointer.isDown) this.tryBasicAttack();
      this.updateEnemies(delta);
      this.updateEnemyProjectiles(delta);
      this.rebuildSpatialBuckets();
      this.applyEnemyContactDamage(delta);
      this.updateProjectiles(delta);
      this.updateVfxParticles(delta);
      this.renderEnemyHealth();
      this.updateGroundDrops(delta);
      this.advanceWaveIfReady();
    }

    this.hudElapsed += delta;
    if (this.hudElapsed >= 0.2) {
      this.hudElapsed = 0;
      this.options.onHud(this.getHud());
    }
  }

  private createTextures(): void {
    this.createPlayerTextures("amazon");
    this.createPlayerTextures("barbarian");
    this.createPlayerTextures("sorceress");
    this.createPlayerAnimations();
    Object.values(MONSTER_ARCHETYPES).forEach((definition) => this.createEnemyTexture(definition));
    const projectile = this.make.graphics({ x: 0, y: 0 });
    projectile.fillStyle(0x8f241e, 0.45).fillCircle(7, 7, 7);
    projectile.fillStyle(0xff5428, 0.9).fillCircle(7, 7, 5);
    projectile.fillStyle(0xffd479).fillCircle(7, 7, 2);
    projectile.fillStyle(0xfff3c4).fillRect(6, 5, 2, 2);
    projectile.generateTexture("projectile", 14, 14).destroy();
    const enemyProjectile = this.make.graphics({ x: 0, y: 0 });
    enemyProjectile.fillStyle(0x6a2d83).fillRect(1, 1, 9, 9);
    enemyProjectile.fillStyle(0xf0a2ff).fillRect(4, 4, 3, 3);
    enemyProjectile.generateTexture("enemy-projectile", 11, 11).destroy();
    const shadow = this.make.graphics({ x: 0, y: 0 });
    shadow.fillStyle(0x071011, 0.5).fillEllipse(0, 0, 27, 9);
    shadow.generateTexture("shadow", 28, 10).destroy();
    const spark = this.make.graphics({ x: 0, y: 0 });
    spark.fillStyle(0xffffff).fillRect(3, 0, 2, 8).fillRect(0, 3, 8, 2);
    spark.fillStyle(0xffd26a).fillRect(2, 2, 4, 4);
    spark.generateTexture("vfx-spark", 8, 8).destroy();
    this.createDropTexture("drop-scrap", 0xc17a42, 0xf1c071);
    this.createDropTexture("drop-essence", 0x6c4ca4, 0xc6a5ff);
    this.createDropTexture("drop-mapDust", 0x317f89, 0x92e4df);
    this.createDropTexture("drop-equipment-normal", 0x7c756c, 0xded5c9);
    this.createDropTexture("drop-equipment-magic", 0x4c64a4, 0x96b4ff);
    this.createDropTexture("drop-equipment-rare", 0x9b782e, 0xffd867);
  }

  private createDropTexture(key: string, outerColor: number, innerColor: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x08090b, 0.7).fillRect(2, 3, 12, 12);
    graphics.fillStyle(outerColor).fillRect(3, 1, 10, 14);
    graphics.fillStyle(innerColor).fillRect(6, 4, 4, 7);
    graphics.fillStyle(0xffffff, 0.8).fillRect(7, 3, 2, 2);
    graphics.generateTexture(key, 16, 17).destroy();
  }

  private createEnemyTexture(definition: (typeof MONSTER_ARCHETYPES)[MonsterArchetypeId]): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x171015).fillRect(3, 7, 18, 15);
    graphics.fillStyle(definition.visual.body).fillRect(5, 5, 14, 14);
    graphics.fillStyle(definition.visual.accent).fillRect(7, 3, 4, 4).fillRect(14, 3, 4, 4);
    graphics.fillStyle(0xffdc78).fillRect(8, 10, 2, 2).fillRect(15, 10, 2, 2);
    if (definition.behavior === "ranged") graphics.fillStyle(definition.visual.accent).fillRect(20, 9, 4, 4).fillRect(22, 10, 2, 2);
    if (definition.behavior === "jumper") graphics.fillStyle(0x7ae0dc).fillRect(2, 18, 7, 4).fillRect(16, 18, 7, 4);
    if (definition.id === "ironhide-brute") graphics.fillStyle(0xc2a070).fillRect(2, 6, 4, 14).fillRect(18, 6, 4, 14);
    if (definition.id === "ember-skitter") graphics.fillStyle(0xffbd56).fillRect(1, 19, 7, 3).fillRect(16, 19, 7, 3);
    graphics.fillStyle(0x1b1116).fillRect(4, 20, 5, 3).fillRect(16, 20, 5, 3);
    graphics.generateTexture(`enemy-${definition.id}`, 24, 24).destroy();
  }

  private createPlayerTextures(classId: CharacterClassId): void {
    const frames: Record<PlayerPose, number> = { idle: 2, walk: 4, attack: 4 };
    (Object.entries(frames) as [PlayerPose, number][]).forEach(([pose, frameCount]) => {
      for (let frame = 0; frame < frameCount; frame += 1) this.createPlayerFrame(classId, pose, frame);
    });
  }

  private createPlayerFrame(classId: CharacterClassId, pose: PlayerPose, frame: number): void {
    const colors = CLASS_COLORS[classId];
    const bob = pose === "walk" && (frame === 1 || frame === 3) ? -1 : pose === "idle" && frame === 1 ? -1 : 0;
    const stride = pose === "walk" ? [0, 2, 0, -2][frame] : 0;
    const lunge = pose === "attack" ? [0, 2, 5, 2][frame] : 0;
    const bodyX = 7 + lunge;
    const bodyY = 13 + bob;
    const graphics = this.make.graphics({ x: 0, y: 0 });
    const leftFootX = bodyX + 2 + Math.max(0, stride);
    const rightFootX = bodyX + 14 + Math.max(0, -stride);
    graphics.fillStyle(0x100f16).fillRect(leftFootX - 1, 34 + bob, 8, 5).fillRect(rightFootX - 1, 34 + bob, 8, 5);
    graphics.fillStyle(0x382922).fillRect(leftFootX, 33 + bob, 6, 4).fillRect(rightFootX, 33 + bob, 6, 4);
    graphics.fillStyle(0x17141c).fillRect(bodyX - 2, bodyY - 2, 24, 23);
    graphics.fillStyle(colors.cloth).fillRect(bodyX, bodyY, 20, 19);
    graphics.fillStyle(0xffffff, 0.16).fillRect(bodyX + 2, bodyY + 2, 3, 14);
    graphics.fillStyle(0x16131a, 0.35).fillRect(bodyX + 14, bodyY + 2, 6, 17);
    graphics.fillStyle(colors.accent).fillRect(bodyX, bodyY + 10, 20, 4).fillRect(bodyX + 8, bodyY, 4, 19);
    graphics.fillStyle(0x22171a).fillRect(bodyX + 1, 3 + bob, 18, 12);
    graphics.fillStyle(0xc9845e).fillRect(bodyX + 3, 5 + bob, 14, 10);
    graphics.fillStyle(0xe5a077).fillRect(bodyX + 5, 6 + bob, 5, 4);
    graphics.fillStyle(0x2a1b1a).fillRect(bodyX + 2, 2 + bob, 16, 5);
    graphics.fillStyle(0xf8dfb7).fillRect(bodyX + 6, 9 + bob, 2, 2).fillRect(bodyX + 13, 9 + bob, 2, 2);
    graphics.fillStyle(0x16141b).fillRect(bodyX + 7, 13 + bob, 6, 2);
    const armReach = pose === "attack" ? [0, 4, 8, 4][frame] : 0;
    graphics.fillStyle(0x17141c).fillRect(bodyX + 18, bodyY + 1, 5 + armReach, 7);
    graphics.fillStyle(colors.accent).fillRect(bodyX + 19, bodyY + 2, 3 + armReach, 4);

    if (classId === "amazon") {
      const weaponX = pose === "attack" ? bodyX + 23 : bodyX + 26;
      const weaponY = pose === "attack" ? bodyY + 4 : 3 + bob;
      graphics.fillStyle(0xd7ad59).fillRect(weaponX, weaponY, pose === "attack" ? 15 : 2, pose === "attack" ? 2 : 31);
      graphics.fillStyle(0xf1d287).fillTriangle(weaponX + (pose === "attack" ? 15 : -2), weaponY - 2, weaponX + (pose === "attack" ? 15 : 4), weaponY + 1, weaponX + (pose === "attack" ? 15 : -2), weaponY + 4);
      graphics.fillStyle(0x6f8542).fillRect(bodyX - 2, bodyY + 3, 4, 14);
    }
    if (classId === "barbarian") {
      const weaponX = bodyX + 23 + armReach;
      graphics.fillStyle(0x8d6a48).fillRect(weaponX, bodyY - 4, 3, 24);
      graphics.fillStyle(0xb9b6ac).fillRect(weaponX - 4, bodyY - 6, 10, 7).fillRect(weaponX + 4, bodyY - 3, 4, 4);
      graphics.fillStyle(0xe7d4b4).fillRect(bodyX + 1, bodyY - 1, 5, 7);
    }
    if (classId === "sorceress") {
      const staffX = bodyX + 25 + Math.floor(armReach * 0.5);
      graphics.fillStyle(0x79529a).fillRect(staffX, 6 + bob, 3, 29);
      graphics.fillStyle(0xff4e2d, 0.75).fillCircle(staffX + 1, 5 + bob, 5);
      graphics.fillStyle(0xffd57a).fillCircle(staffX + 1, 5 + bob, 2);
      graphics.fillStyle(0x492e61).fillRect(bodyX - 1, bodyY + 5, 4, 17);
    }
    graphics.generateTexture(`player-${classId}-${pose}-${frame}`, 48, 42).destroy();
  }

  private createPlayerAnimations(): void {
    (['amazon', 'barbarian', 'sorceress'] as CharacterClassId[]).forEach((classId) => {
      const animation = (pose: PlayerPose, frames: number, frameRate: number, repeat: number) => this.anims.create({
        key: `player-${classId}-${pose}`,
        frames: Array.from({ length: frames }, (_, frame) => ({ key: `player-${classId}-${pose}-${frame}` })),
        frameRate,
        repeat,
      });
      animation("idle", 2, 2.5, -1);
      animation("walk", 4, 9, -1);
      animation("attack", 4, 18, 0);
    });
  }

  private buildClassShowcase(): void {
    (["amazon", "barbarian", "sorceress"] as CharacterClassId[]).forEach((classId, index) => {
      const x = 285 + index * 195;
      this.add.ellipse(x, 520, 112, 34, 0x0b0c0f, 0.7);
      const sprite = this.add.sprite(x, 468, `player-${classId}-idle-0`).setScale(3.4).setOrigin(0.5, 1);
      sprite.play(`player-${classId}-idle`);
      this.tweens.add({ targets: sprite, y: sprite.y - 4, duration: 1100 + index * 130, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    });
  }

  private createPlayer(): void {
    const x = this.options.mode === "arena" ? MAP_SIZE / 2 : 480;
    const y = this.options.mode === "arena" ? MAP_SIZE / 2 : 700;
    this.playerShadow = this.add.image(x, y + 15, "shadow").setScale(1.6).setDepth(8);
    this.player = this.add.sprite(x, y, `player-${this.options.classId}-idle-0`).setScale(PLAYER_SCALE).setDepth(10);
    this.player.play(`player-${this.options.classId}-idle`);
  }

  private playPlayerPose(pose: PlayerPose): void {
    if (!this.player) return;
    const key = `player-${this.options.classId}-${pose}`;
    if (this.player.anims.currentAnim?.key !== key || !this.player.anims.isPlaying) {
      this.player.anims.timeScale = 1;
      this.player.play(key, true);
    }
  }

  private playSkillPresentation(skill: SkillDefinition, startX?: number, startY?: number): void {
    if (!this.player) return;
    this.audio.play(skill.presentation.audio);
    if (skill.presentation.animation === "attack" || skill.presentation.animation === "cast") {
      const animationSpeed = skill.presentation.animation === "attack"
        ? Phaser.Math.Clamp(this.options.arenaBalance?.attackSpeed ?? 1, 0.8, 2.5)
        : 1;
      this.player.anims.timeScale = animationSpeed;
      this.player.play(`player-${this.options.classId}-attack`);
      this.playerAnimationLock = skill.presentation.animation === "cast" ? 0.28 : 0.22 / animationSpeed;
    } else {
      this.playerAnimationLock = 0.14;
      this.player.setScale(PLAYER_SCALE * 1.08, PLAYER_SCALE * 0.9);
      this.tweens.add({ targets: this.player, scaleX: PLAYER_SCALE, scaleY: PLAYER_SCALE, duration: 140, ease: "Cubic.easeOut" });
    }

    if (skill.presentation.vfx === "ember-lance") {
      const facing = this.lastFacing;
      for (let index = 0; index < 3; index += 1) {
        this.emitVfxParticle(this.player.x + facing * 23, this.player.y - 5, 0xff7a35, facing * Phaser.Math.Between(30, 70), Phaser.Math.Between(-35, 15), 0.16, 0.75, 0.08);
      }
    } else if (skill.presentation.vfx === "ember-nova") {
      const sigil = this.add.image(this.player.x, this.player.y + 5, "ember-sigil")
        .setScale(0.06)
        .setAlpha(0.92)
        .setDepth(Math.round(this.player.y / 10) + 8)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: sigil,
        scale: 0.48,
        alpha: 0,
        angle: 35,
        duration: 360,
        ease: "Cubic.easeOut",
        onComplete: () => sigil.destroy(),
      });
      this.emitRadialVfx(this.player.x, this.player.y, 12, 0xff6834, 110, 0.32);
    } else if (skill.presentation.vfx === "rift-step") {
      const fromX = startX ?? this.player.x;
      const fromY = startY ?? this.player.y;
      for (let index = 0; index < 3; index += 1) {
        const progress = index / 3;
        const afterimage = this.add.image(
          Phaser.Math.Linear(fromX, this.player.x, progress),
          Phaser.Math.Linear(fromY, this.player.y, progress),
          this.player.texture.key,
        ).setScale(PLAYER_SCALE)
          .setFlipX(this.player.flipX)
          .setTint(0x9f75d8)
          .setAlpha(0.3 - index * 0.06)
          .setDepth(Math.round(Phaser.Math.Linear(fromY, this.player.y, progress) / 10) + 10);
        this.tweens.add({ targets: afterimage, alpha: 0, scale: PLAYER_SCALE * 0.92, duration: 190 + index * 30, onComplete: () => afterimage.destroy() });
      }
      for (let index = 0; index < 8; index += 1) {
        const progress = index / 7;
        this.emitVfxParticle(
          Phaser.Math.Linear(fromX, this.player.x, progress),
          Phaser.Math.Linear(fromY, this.player.y, progress) + Phaser.Math.Between(-8, 8),
          0xad83ee,
          Phaser.Math.Between(-20, 20),
          Phaser.Math.Between(-24, 8),
          0.24,
          0.65,
          0.04,
        );
      }
    }
  }

  private emitRadialVfx(x: number, y: number, count: number, tint: number, speed: number, lifetime: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count + Phaser.Math.FloatBetween(-0.08, 0.08);
      const velocity = speed * Phaser.Math.FloatBetween(0.75, 1.15);
      this.emitVfxParticle(x, y, tint, Math.cos(angle) * velocity, Math.sin(angle) * velocity, lifetime, 0.8, 0.05);
    }
  }

  private emitVfxParticle(x: number, y: number, tint: number, vx: number, vy: number, lifetime: number, startScale: number, endScale: number): void {
    const sprite = this.vfxPool?.get(x, y, "vfx-spark") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setTexture("vfx-spark")
      .setActive(true)
      .setVisible(true)
      .setPosition(x, y)
      .setTint(tint)
      .setAlpha(0.9)
      .setScale(startScale)
      .setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2))
      .setDepth(Math.round(y / 10) + 85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.vfxParticles.push({
      sprite,
      vx,
      vy,
      remaining: lifetime,
      lifetime,
      startScale,
      endScale,
      rotationSpeed: Phaser.Math.FloatBetween(-5, 5),
    });
  }

  private updateVfxParticles(delta: number): void {
    for (let index = this.vfxParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.vfxParticles[index];
      particle.remaining -= delta;
      particle.sprite.x += particle.vx * delta;
      particle.sprite.y += particle.vy * delta;
      particle.vx *= Math.pow(0.03, delta);
      particle.vy *= Math.pow(0.03, delta);
      particle.sprite.rotation += particle.rotationSpeed * delta;
      const progress = Phaser.Math.Clamp(1 - particle.remaining / particle.lifetime, 0, 1);
      particle.sprite.setAlpha(0.9 * (1 - progress)).setScale(Phaser.Math.Linear(particle.startScale, particle.endScale, progress));
      if (particle.remaining > 0) continue;
      this.vfxParticles.splice(index, 1);
      this.vfxPool?.killAndHide(particle.sprite);
    }
  }

  private buildHideoutStations(): void {
    this.addStation("stash", 116, 352, 135, 115, "STASH");
    this.addStation("bench", 817, 372, 150, 135, "CRAFT");
    this.addStation(this.options.portalActive ? "portal" : "map-device", 480, 177, 155, 145, this.options.portalActive ? "ENTER MAP" : "MAP DEVICE");
    const merchant = this.add.sprite(248, 600, "player-sorceress-idle-0").setScale(2.35).setTint(0xd9ad76).setDepth(12);
    merchant.play("player-sorceress-idle");
    this.tweens.add({ targets: merchant, y: merchant.y - 3, duration: 1250, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.addStation("merchant", 248, 592, 125, 105, "MAP MERCHANT");
    if (this.options.portalActive) {
      const aura = this.add.ellipse(480, 202, 105, 34, 0xff6a2e, 0.24).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: aura, alpha: 0.55, scaleX: 1.18, scaleY: 1.18, duration: 760, yoyo: true, repeat: -1 });
    }
  }

  private addStation(station: WorldStation, x: number, y: number, width: number, height: number, label: string): void {
    const zone = this.add.zone(x, y, width, height).setInteractive({ cursor: "pointer" });
    zone.on(Phaser.Input.Events.POINTER_DOWN, () => this.options.onStation(station));
    const text = this.add.text(x, y + height / 2 + 8, label, {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#f4bf78",
      backgroundColor: "#11100ddd",
      padding: { x: 7, y: 4 },
    }).setOrigin(0.5).setDepth(20).setAlpha(0.72);
    this.tweens.add({ targets: text, alpha: 1, duration: 900, yoyo: true, repeat: -1 });
  }

  private clampPlayer(): void {
    if (!this.player) return;
    if (this.options.mode === "arena") {
      this.player.x = Phaser.Math.Clamp(this.player.x, 90, MAP_SIZE - 90);
      this.player.y = Phaser.Math.Clamp(this.player.y, 90, MAP_SIZE - 90);
      return;
    }
    this.player.x = Phaser.Math.Clamp(this.player.x, 175, 785);
    this.player.y = Phaser.Math.Clamp(this.player.y, 310, 805);
  }

  private startWave(wave: number): void {
    this.wave = wave;
    this.waveElapsedSeconds = 0;
    const balance = this.options.arenaBalance;
    if (!balance) throw new Error("Arena balance is required before spawning a wave");
    const waveStats = balance.waveStats[wave - 1];
    if (!waveStats) throw new Error(`Missing resolved arena stats for wave ${wave}`);
    const count = waveStats.monsterCount;
    const groupCount = Math.min(PACK_REGIONS.length, 4 + Math.ceil(wave / 2));
    const playerX = this.player?.x ?? MAP_SIZE / 2;
    const playerY = this.player?.y ?? MAP_SIZE / 2;
    const nearestRegion = [...PACK_REGIONS].sort((left, right) => (
      Math.hypot(left[0] * MAP_SIZE - playerX, left[1] * MAP_SIZE - playerY)
      - Math.hypot(right[0] * MAP_SIZE - playerX, right[1] * MAP_SIZE - playerY)
    ))[0];
    const otherRegions = Phaser.Utils.Array.Shuffle(PACK_REGIONS.filter((region) => region !== nearestRegion));
    const regions = [nearestRegion, ...otherRegions].slice(0, groupCount);
    let remaining = count;
    regions.forEach(([normalizedX, normalizedY], groupIndex) => {
      const members = Math.ceil(remaining / (regions.length - groupIndex));
      remaining -= members;
      const pack = rollMonsterPack(members, wave, balance.tier, waveStats.monsterRarity);
      const centerX = normalizedX * MAP_SIZE;
      const centerY = normalizedY * MAP_SIZE;
      for (let member = 0; member < members; member += 1) {
        const angle = (member / members) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
        const radius = Phaser.Math.Between(24, 105);
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        const archetypeId = pack.archetypeIds[member];
        const archetype = MONSTER_ARCHETYPES[archetypeId];
        const rarity: MonsterRarity = pack.rarity === "magic"
          ? "magic"
          : pack.rarity === "rare" && pack.rareLeaderIndex === member ? "rare" : "normal";
        const modifierIds = rarity === "normal" ? [] : pack.modifierIds;
        const stats = resolveMonsterStats(archetypeId, waveStats, rarity, modifierIds);
        const texture = `enemy-${archetypeId}`;
        const sprite = this.enemyPool?.get(x, y, texture) as Phaser.GameObjects.Image | null;
        if (!sprite) break;
        const rarityScale = rarity === "rare" ? 1.3 : rarity === "magic" ? 1.08 : 1;
        const baseScale = archetype.visual.scale * rarityScale;
        sprite.setTexture(texture).clearTint();
        if (rarity === "magic") sprite.setTint(MONSTER_PACK_RULES.magicTint);
        if (rarity === "rare") sprite.setTint(MONSTER_PACK_RULES.rareTint);
        sprite.setActive(true).setVisible(true).setPosition(x, y).setScale(baseScale).setDepth(Math.round(y / 10) + 10);
        this.enemies.push({
          sprite,
          x,
          y,
          archetypeId,
          rarity,
          modifierNames: monsterPackModifierNames(modifierIds),
          homeX: x,
          homeY: y,
          phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
          aggro: false,
          life: stats.maxLife,
          maxLife: stats.maxLife,
          speed: Phaser.Math.FloatBetween(stats.moveSpeed.min, stats.moveSpeed.max),
          contactDamage: stats.damage,
          armor: stats.armor,
          evadeChance: stats.evadeChance,
          itemQuantity: stats.itemQuantity,
          itemRarity: stats.itemRarity,
          baseScale,
          attackCooldown: Math.random() * (archetype.ranged?.cooldown ?? 1),
          jumpCooldown: Math.random() * (archetype.jump?.cooldown ?? 1),
          jumpRemaining: 0,
          jumpStartX: x,
          jumpStartY: y,
          jumpTargetX: x,
          jumpTargetY: y,
          healthLabel: null,
        });
      }
    });
    this.rebuildSpatialBuckets();
  }

  private updateEnemies(delta: number): void {
    if (!this.player) return;
    for (const enemy of this.enemies) {
      const archetype = MONSTER_ARCHETYPES[enemy.archetypeId];
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
      enemy.jumpCooldown = Math.max(0, enemy.jumpCooldown - delta);
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < archetype.aggroRange) enemy.aggro = true;
      if (enemy.jumpRemaining > 0 && archetype.jump) {
        enemy.jumpRemaining = Math.max(0, enemy.jumpRemaining - delta);
        const progress = 1 - enemy.jumpRemaining / archetype.jump.duration;
        enemy.x = Phaser.Math.Linear(enemy.jumpStartX, enemy.jumpTargetX, progress);
        enemy.y = Phaser.Math.Linear(enemy.jumpStartY, enemy.jumpTargetY, progress);
        enemy.sprite.setScale(enemy.baseScale * (1 + Math.sin(progress * Math.PI) * 0.42));
        if (enemy.jumpRemaining <= 0) {
          enemy.sprite.setScale(enemy.baseScale);
          if (Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) < 52) {
            this.damagePlayer(enemy.contactDamage * archetype.jump.damageEffectiveness);
          }
        }
      } else if (enemy.aggro && archetype.behavior === "ranged" && archetype.ranged) {
        const rangeOffset = distance - archetype.ranged.preferredRange;
        if (Math.abs(rangeOffset) > 42) {
          const direction = rangeOffset > 0 ? 1 : -1;
          enemy.x += (dx / distance) * enemy.speed * delta * direction;
          enemy.y += (dy / distance) * enemy.speed * delta * direction;
        } else {
          enemy.x += (-dy / distance) * enemy.speed * delta * 0.32;
          enemy.y += (dx / distance) * enemy.speed * delta * 0.32;
        }
        if (enemy.attackCooldown <= 0) {
          this.spawnEnemyProjectile(enemy, dx / distance, dy / distance, archetype.ranged.projectileSpeed, archetype.ranged.damageEffectiveness);
          enemy.attackCooldown = archetype.ranged.cooldown * Phaser.Math.FloatBetween(0.85, 1.15);
        }
      } else if (enemy.aggro && archetype.behavior === "jumper" && archetype.jump && enemy.jumpCooldown <= 0 && distance < archetype.jump.distance * 2.4) {
        const travel = Math.min(archetype.jump.distance, Math.max(55, distance - 22));
        enemy.jumpStartX = enemy.x;
        enemy.jumpStartY = enemy.y;
        enemy.jumpTargetX = Phaser.Math.Clamp(enemy.x + (dx / distance) * travel, 60, MAP_SIZE - 60);
        enemy.jumpTargetY = Phaser.Math.Clamp(enemy.y + (dy / distance) * travel, 60, MAP_SIZE - 60);
        enemy.jumpRemaining = archetype.jump.duration;
        enemy.jumpCooldown = archetype.jump.cooldown * Phaser.Math.FloatBetween(0.85, 1.15);
      } else if (enemy.aggro) {
        enemy.x += (dx / distance) * enemy.speed * delta;
        enemy.y += (dy / distance) * enemy.speed * delta;
      } else {
        enemy.phase += delta * 0.8;
        const idleX = enemy.homeX + Math.cos(enemy.phase) * 14;
        const idleY = enemy.homeY + Math.sin(enemy.phase * 0.8) * 10;
        enemy.x += (idleX - enemy.x) * delta * 1.8;
        enemy.y += (idleY - enemy.y) * delta * 1.8;
      }
      enemy.sprite.setPosition(Math.round(enemy.x), Math.round(enemy.y)).setFlipX(dx < 0).setDepth(Math.round(enemy.y / 10) + 10);
    }
  }

  private spawnEnemyProjectile(enemy: EnemyState, directionX: number, directionY: number, speed: number, damageEffectiveness: number): void {
    const sprite = this.enemyProjectilePool?.get(enemy.x, enemy.y, "enemy-projectile") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setTexture("enemy-projectile").setActive(true).setVisible(true).setPosition(enemy.x, enemy.y).setScale(enemy.rarity === "rare" ? 1.55 : 1.25).setDepth(82).setBlendMode(Phaser.BlendModes.ADD);
    this.enemyProjectiles.push({
      sprite,
      x: enemy.x,
      y: enemy.y,
      vx: directionX * speed,
      vy: directionY * speed,
      damage: enemy.contactDamage * damageEffectiveness,
      damageType: "fire",
      remaining: 2.8,
      trailElapsed: 0,
      remainingPierces: 0,
      hitEnemies: new Set(),
    });
  }

  private updateEnemyProjectiles(delta: number): void {
    if (!this.player) return;
    for (let index = this.enemyProjectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.enemyProjectiles[index];
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      projectile.remaining -= delta;
      projectile.sprite.setPosition(projectile.x, projectile.y).setRotation(projectile.sprite.rotation + delta * 5);
      if (Math.hypot(this.player.x - projectile.x, this.player.y - projectile.y) < 22) {
        this.damagePlayer(projectile.damage);
        projectile.remaining = 0;
      }
      if (projectile.remaining <= 0) {
        this.enemyProjectiles.splice(index, 1);
        this.enemyProjectilePool?.killAndHide(projectile.sprite);
      }
    }
  }

  private acquireHealthLabel(): Phaser.GameObjects.Text {
    const existing = this.healthLabelPool.find((label) => !label.active);
    if (existing) return existing.setActive(true).setVisible(false);
    const label = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#fff0d1",
      stroke: "#08090b",
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(471).setVisible(false);
    this.healthLabelPool.push(label);
    return label;
  }

  private releaseHealthLabel(label: Phaser.GameObjects.Text): void {
    label.setActive(false).setVisible(false);
  }

  private renderEnemyHealth(): void {
    const graphics = this.enemyHealthBars;
    if (!graphics) return;
    graphics.clear();
    const view = this.cameras.main.worldView;
    for (const enemy of this.enemies) {
      const visible = enemy.x >= view.left - HEALTH_BAR_WIDTH && enemy.x <= view.right + HEALTH_BAR_WIDTH
        && enemy.y >= view.top - 55 && enemy.y <= view.bottom + 25;
      if (!visible) {
        if (enemy.healthLabel) this.releaseHealthLabel(enemy.healthLabel);
        enemy.healthLabel = null;
        continue;
      }
      if (!enemy.healthLabel) enemy.healthLabel = this.acquireHealthLabel();
      enemy.healthLabel.setVisible(true);
      const left = Math.round(enemy.x - HEALTH_BAR_WIDTH / 2);
      const top = Math.round(enemy.y - 34);
      const ratio = Phaser.Math.Clamp(enemy.life / enemy.maxLife, 0, 1);
      graphics.fillStyle(0x08090b, 0.9).fillRect(left - 1, top - 1, HEALTH_BAR_WIDTH + 2, HEALTH_BAR_HEIGHT + 2);
      graphics.fillStyle(0x39211f, 1).fillRect(left, top, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
      const lifeColor = enemy.rarity === "rare" ? 0xe0a637 : enemy.rarity === "magic" ? 0x668ee2 : ratio > 0.5 ? 0xc95745 : ratio > 0.25 ? 0xdc8a3d : 0xe4b34b;
      graphics.fillStyle(lifeColor, 1).fillRect(left, top, Math.max(0, HEALTH_BAR_WIDTH * ratio), HEALTH_BAR_HEIGHT);
      const rarityLabel = enemy.rarity === "normal" ? "" : `${enemy.rarity.toUpperCase()} `;
      const modifierLabel = enemy.modifierNames.length > 0 ? `${enemy.modifierNames.join("/")} ` : "";
      const healthText = `${rarityLabel}${modifierLabel}${Math.ceil(Math.max(0, enemy.life))}/${Math.ceil(enemy.maxLife)}`;
      if (enemy.healthLabel.text !== healthText) enemy.healthLabel.setText(healthText);
      enemy.healthLabel.setPosition(Math.round(enemy.x), top - 8);
    }
  }

  private showDamageNumber(x: number, y: number, damage: RolledHitDamage | "EVADE"): void {
    let label = this.damageNumberPool.find((candidate) => !candidate.active);
    if (!label && this.damageNumberPool.length < DAMAGE_NUMBER_POOL_SIZE) {
      label = this.add.text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "16px",
        fontStyle: "bold",
        color: "#ffd978",
        stroke: "#35110c",
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(510).setActive(false).setVisible(false);
      this.damageNumberPool.push(label);
    }
    if (!label) return;
    this.tweens.killTweensOf(label);
    const damageText = damage === "EVADE"
      ? damage
      : `${Math.max(1, Math.round(damage.amount))} (${DAMAGE_TYPE_DEFINITIONS[damage.type].label})`;
    label.setColor(damage === "EVADE" ? "#aeb4bd" : DAMAGE_TYPE_DEFINITIONS[damage.type].color);
    label.setText(damageText)
      .setPosition(Math.round(x + Phaser.Math.Between(-7, 7)), Math.round(y - 24))
      .setAlpha(1)
      .setScale(1)
      .setActive(true)
      .setVisible(true);
    this.tweens.add({
      targets: label,
      y: label.y - 30,
      alpha: 0,
      scale: 1.18,
      duration: 620,
      ease: "Cubic.easeOut",
      onComplete: () => label?.setActive(false).setVisible(false),
    });
  }

  private applyEnemyContactDamage(delta: number): void {
    if (!this.player) return;
    for (const enemy of this.nearbyEnemies(this.player.x, this.player.y)) {
      if (Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y) < 30) {
        this.damagePlayer(delta * enemy.contactDamage);
      }
    }
  }

  private damagePlayer(rawDamage: number): void {
    if (!this.player) return;
    const evadeMultiplier = 1 - (this.options.arenaBalance?.evadeChance ?? 0) / 100;
    const armor = this.options.arenaBalance?.armor ?? 0;
    const armorMultiplier = 100 / (100 + armor);
    this.life -= rawDamage * evadeMultiplier * armorMultiplier;
    if (this.life <= 0) {
      this.lives -= 1;
      this.life = this.options.arenaBalance?.maxLife ?? 100;
      this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
      this.releaseEnemyProjectiles();
      if (this.lives <= 0) {
        this.lives = 3;
        this.releaseAllEnemies();
        this.startWave(1);
      }
    }
  }

  private rebuildSpatialBuckets(): void {
    this.spatialBuckets.clear();
    for (const enemy of this.enemies) {
      const key = this.bucketKey(enemy.x, enemy.y);
      const bucket = this.spatialBuckets.get(key);
      if (bucket) bucket.push(enemy);
      else this.spatialBuckets.set(key, [enemy]);
    }
  }

  private bucketKey(x: number, y: number): number {
    return Math.floor(x / SPATIAL_CELL_SIZE) + Math.floor(y / SPATIAL_CELL_SIZE) * SPATIAL_COLUMNS;
  }

  private nearbyEnemies(x: number, y: number): EnemyState[] {
    const result: EnemyState[] = [];
    const cellX = Math.floor(x / SPATIAL_CELL_SIZE);
    const cellY = Math.floor(y / SPATIAL_CELL_SIZE);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const bucket = this.spatialBuckets.get(cellX + offsetX + (cellY + offsetY) * SPATIAL_COLUMNS);
        if (bucket) result.push(...bucket);
      }
    }
    return result;
  }

  private tryBasicAttack(): void {
    if (this.attackCooldown > 0 || !this.player) return;
    const pointer = this.input.activePointer;
    const dx = pointer.worldX - this.player.x;
    const dy = pointer.worldY - this.player.y;
    const length = Math.hypot(dx, dy) || 1;
    if (Math.abs(dx) > 2) {
      this.lastFacing = Math.sign(dx);
      this.player.setFlipX(this.lastFacing < 0);
    }
    this.playSkillPresentation(this.resolvedBasic);
    this.spawnProjectile(dx / length, dy / length, this.resolvedBasic);
    this.attackCooldown = 1 / Math.max(0.01, this.options.arenaBalance?.attackSpeed ?? 1);
  }

  private spawnProjectile(directionX: number, directionY: number, skill: ResolvedSkillDefinition): void {
    if (!this.player || !skill.damage) return;
    const sprite = this.projectilePool?.get(this.player.x, this.player.y, "projectile") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setActive(true).setVisible(true).setScale((skill.projectileScale ?? 1) * 1.35).setDepth(80).setBlendMode(Phaser.BlendModes.ADD);
    const rolledDamage = rollHitDamage(this.options.arenaBalance?.attackDamage ?? 15, skill.damage);
    this.projectiles.push({
      sprite,
      vx: directionX * 520,
      vy: directionY * 520,
      damage: rolledDamage.amount,
      damageType: rolledDamage.type,
      remaining: 1.35,
      trailElapsed: 0,
      remainingPierces: skill.piercing,
      hitEnemies: new Set(),
    });
  }

  private updateProjectiles(delta: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.sprite.x += projectile.vx * delta;
      projectile.sprite.y += projectile.vy * delta;
      projectile.remaining -= delta;
      projectile.trailElapsed += delta;
      if (projectile.trailElapsed >= 0.045) {
        projectile.trailElapsed = 0;
        this.emitVfxParticle(
          projectile.sprite.x,
          projectile.sprite.y,
          0xff7138,
          -projectile.vx * 0.025 + Phaser.Math.Between(-12, 12),
          -projectile.vy * 0.025 + Phaser.Math.Between(-12, 12),
          0.18,
          0.55,
          0.03,
        );
      }
      const hit = this.nearbyEnemies(projectile.sprite.x, projectile.sprite.y).find((enemy) => !projectile.hitEnemies.has(enemy) && Math.hypot(projectile.sprite.x - enemy.x, projectile.sprite.y - enemy.y) < 25);
      if (hit) {
        projectile.hitEnemies.add(hit);
        const evaded = Math.random() < hit.evadeChance / 100;
        const damage = evaded ? 0 : projectile.damage * (100 / (100 + hit.armor));
        if (!evaded) hit.life -= damage;
        this.showDamageNumber(hit.x, hit.y, evaded ? "EVADE" : { amount: damage, type: projectile.damageType });
        this.emitRadialVfx(hit.x, hit.y, evaded ? 3 : 6, evaded ? 0x9aa3ad : 0xff9a4b, evaded ? 45 : 82, 0.2);
        if (projectile.remainingPierces > 0) projectile.remainingPierces -= 1;
        else projectile.remaining = 0;
        if (hit.life <= 0) this.releaseEnemy(hit);
      }
      if (projectile.remaining <= 0) {
        this.projectiles.splice(index, 1);
        this.projectilePool?.killAndHide(projectile.sprite);
      }
    }
  }

  private releaseEnemy(enemy: EnemyState): void {
    const index = this.enemies.indexOf(enemy);
    if (index < 0) return;
    this.enemies.splice(index, 1);
    this.enemyPool?.killAndHide(enemy.sprite);
    if (enemy.healthLabel) this.releaseHealthLabel(enemy.healthLabel);
    this.slain += 1;
    this.options.onExperienceGain(monsterExperienceReward(
      enemy.archetypeId,
      this.wave,
      this.options.arenaBalance?.tier ?? 1,
      enemy.rarity,
    ));
    this.rollGroundDrop(enemy);
  }

  private rollGroundDrop(enemy: EnemyState): void {
    const chances = dropChances(enemy.itemQuantity);
    const roll = Math.random();
    let drop: MapDrop | null = null;
    if (roll < chances.equipment) {
      drop = { kind: "equipment", rarity: rollEquipmentRarity(enemy.itemRarity) };
    } else if (roll < chances.equipment + chances.material) {
      const materialRoll = Math.random();
      drop = materialRoll < 0.08
        ? { kind: "currency", currency: "mapDust", amount: 1 }
        : materialRoll < 0.28
          ? { kind: "currency", currency: "essence", amount: 1 }
          : { kind: "currency", currency: "scrap", amount: Phaser.Math.Between(1, 2) };
    }
    if (!drop) return;
    this.spawnGroundDrop(enemy.x, enemy.y, drop);
  }

  private spawnGroundDrop(x: number, y: number, drop: MapDrop): void {
    const texture = drop.kind === "equipment" ? `drop-equipment-${drop.rarity}` : `drop-${drop.currency}`;
    const sprite = this.dropPool?.get(x, y, texture) as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setTexture(texture).setActive(true).setVisible(true).setPosition(x, y).setScale(1.8).setDepth(Math.round(y / 10) + 30);
    const labelText = drop.kind === "equipment"
      ? `${drop.rarity.toUpperCase()} ITEM`
      : `${drop.amount} ${drop.currency === "mapDust" ? "MAP DUST" : drop.currency.toUpperCase()}`;
    const color = drop.kind === "equipment"
      ? drop.rarity === "rare" ? "#ffda68" : drop.rarity === "magic" ? "#9bb8ff" : "#ded5c9"
      : drop.currency === "essence" ? "#c6a5ff" : drop.currency === "mapDust" ? "#92e4df" : "#e2ac70";
    const label = this.add.text(x, y - 22, labelText, {
      fontFamily: "monospace",
      fontSize: "14px",
      color,
      backgroundColor: "#08090bcc",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(Math.round(y / 10) + 31);
    this.groundDrops.push({ sprite, label, x, y, phase: Phaser.Math.FloatBetween(0, Math.PI * 2), drop });
  }

  private updateGroundDrops(delta: number): void {
    if (!this.player) return;
    for (let index = this.groundDrops.length - 1; index >= 0; index -= 1) {
      const groundDrop = this.groundDrops[index];
      groundDrop.phase += delta * 3;
      const bob = Math.sin(groundDrop.phase) * 3;
      groundDrop.sprite.setPosition(groundDrop.x, groundDrop.y + bob);
      groundDrop.label.setPosition(groundDrop.x, groundDrop.y - 22 + bob);
      if (Math.hypot(this.player.x - groundDrop.x, this.player.y - groundDrop.y) >= 38) continue;
      if (!this.options.onLootPickup(groundDrop.drop)) continue;
      this.lootCollected += 1;
      this.groundDrops.splice(index, 1);
      this.dropPool?.killAndHide(groundDrop.sprite);
      groundDrop.label.destroy();
      const pickupText = this.add.text(groundDrop.x, groundDrop.y - 28, "COLLECTED", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#fff1c8",
        stroke: "#08090b",
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(500);
      this.tweens.add({ targets: pickupText, y: pickupText.y - 24, alpha: 0, duration: 650, onComplete: () => pickupText.destroy() });
    }
  }

  private releaseAllEnemies(): void {
    for (const enemy of this.enemies) {
      this.enemyPool?.killAndHide(enemy.sprite);
      if (enemy.healthLabel) this.releaseHealthLabel(enemy.healthLabel);
    }
    this.enemies = [];
    this.enemyHealthBars?.clear();
    this.releaseEnemyProjectiles();
  }

  private releaseEnemyProjectiles(): void {
    for (const projectile of this.enemyProjectiles) this.enemyProjectilePool?.killAndHide(projectile.sprite);
    this.enemyProjectiles = [];
  }

  private advanceWaveIfReady(): void {
    if (this.arenaComplete) return;
    const finalWave = this.options.arenaBalance?.waves ?? ARENA_RULES.totalWaves;
    if (shouldSpawnNextWave(this.wave, finalWave, this.enemies.length, this.waveElapsedSeconds)) {
      this.startWave(this.wave + 1);
      return;
    }
    if (this.wave < finalWave || this.enemies.length > 0) return;
    if (this.groundDrops.length > 0) return;
    this.arenaComplete = true;
    this.options.onArenaComplete({ wave: this.wave, enemiesSlain: this.slain, elapsedSeconds: Math.round(this.elapsedSeconds) });
  }
}

export class PhaserRuntime {
  private readonly options: WorldRuntimeOptions;
  private game: Phaser.Game | null = null;
  private scene: CraftyScene | null = null;

  constructor(options: WorldRuntimeOptions) {
    this.options = options;
  }

  initialize(): void {
    const scene = new CraftyScene(this.options);
    this.scene = scene;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.options.parent,
      width: VIEW_SIZE,
      height: VIEW_SIZE,
      backgroundColor: "#071011",
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      render: { antialias: false, pixelArt: true, roundPixels: true, powerPreference: "high-performance" },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene,
      fps: { target: 60, smoothStep: true },
      banner: false,
    });
  }

  useSkill(skill: "nova" | "dash"): void {
    this.scene?.useSkill(skill);
  }

  updateSkillLevels(skillLevels: SkillLevels): void {
    this.scene?.updateSkillLevels(skillLevels);
  }

  setPaused(paused: boolean): void {
    this.options.paused = paused;
  }

  updateArenaBalance(balance: NonNullable<WorldRuntimeOptions["arenaBalance"]>): void {
    this.scene?.updateArenaBalance(balance);
  }

  resize(): void {
    this.game?.scale.refresh();
  }

  dispose(): void {
    this.game?.destroy(true);
    this.scene = null;
    this.game = null;
  }
}
