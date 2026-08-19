import Phaser from "phaser";
import { ACTIVE_SKILLS, BASIC_ATTACK, isArenaCleared, rollHitDamage, shouldActivateFinalWaveRage, shouldSpawnNextWave, type ArenaSummary, type MapDrop, type RolledHitDamage } from "../game/combat";
import { ARENA_RULES } from "../game/config/arena";
import {
  CHARACTER_ANIMATIONS,
  characterDefaultSpriteSheetKey,
  characterDirectionVector,
  characterSpriteSheetKey,
  characterVisualOffsetY,
  resolveCharacterDirection,
  type CharacterDirection,
  type CharacterSpriteSheetId,
} from "../game/config/character-animations";
import { DAMAGE_TYPE_DEFINITIONS } from "../game/config/damage";
import { CURRENCY_DEFINITIONS } from "../game/config/currencies";
import { FLASK_DEFINITIONS, type FlaskDefinition } from "../game/config/flasks";
import { MONSTER_PACK_RULES } from "../game/config/monster-packs";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "../game/config/monsters";
import { MAP_COMPLETION_REWARDS } from "../game/config/rewards";
import type { SkillDefinition } from "../game/config/schema";
import type { CharacterClassId, DamageType, FlaskBelt, InventoryItem, MonsterRarity, SkillLevels } from "../game/domain";
import { monsterPackModifierNames, resolveMonsterStats, rollMonsterPack } from "../game/encounters";
import { advanceFlaskRecovery } from "../game/flasks";
import { isCurrencyItem, isEquipmentItem, isFlaskItem, isMapItem } from "../game/inventory";
import { equipmentDropPresentation, dropChances, rollEquipmentRarity, rollFlaskDrop } from "../game/loot";
import { generateEquipment } from "../game/items";
import { monsterExperienceReward } from "../game/progression";
import { createMapCompletionRewards } from "../game/rewards";
import { resolveSkillDefinition, type ResolvedSkillDefinition } from "../game/skills";
import { CharacterAnimator } from "./CharacterAnimator";
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
const MOVEMENT_ACCELERATION = 18;
const MOVEMENT_DECELERATION = 24;

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

interface CorpseState {
  sprite: Phaser.GameObjects.Image;
  age: number;
}

interface ReturnPortalState {
  x: number;
  y: number;
  elapsed: number;
  particleElapsed: number;
  summary: ArenaSummary;
  glow: Phaser.GameObjects.Ellipse;
  outerRing: Phaser.GameObjects.Ellipse;
  innerRing: Phaser.GameObjects.Ellipse;
  sigil: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  prompt: Phaser.GameObjects.Text;
  interaction: Phaser.GameObjects.Zone;
}

interface CompletionChestState {
  x: number;
  y: number;
  elapsed: number;
  opened: boolean;
  glow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  prompt: Phaser.GameObjects.Text;
  interaction: Phaser.GameObjects.Zone;
}

const CLASS_COLORS: Record<CharacterClassId, { magic: number }> = {
  amazon: { magic: 0xf6c76f },
  barbarian: { magic: 0xff7345 },
  sorceress: { magic: 0xb77cff },
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
  private playerVisual: Phaser.GameObjects.Sprite | null = null;
  private playerAnimator: CharacterAnimator | null = null;
  private playerShadow: Phaser.GameObjects.Image | null = null;
  private playerAura: Phaser.GameObjects.Image | null = null;
  private playerWard: Phaser.GameObjects.Image | null = null;
  private playerResourceBars: Phaser.GameObjects.Graphics | null = null;
  private playerLifeLabel: Phaser.GameObjects.Text | null = null;
  private playerManaLabel: Phaser.GameObjects.Text | null = null;
  private cameraTarget: Phaser.GameObjects.Zone | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  private enemies: EnemyState[] = [];
  private projectiles: ProjectileState[] = [];
  private enemyProjectiles: EnemyProjectileState[] = [];
  private groundDrops: GroundDropState[] = [];
  private corpses: CorpseState[] = [];
  private enemyPool: Phaser.GameObjects.Group | null = null;
  private projectilePool: Phaser.GameObjects.Group | null = null;
  private enemyProjectilePool: Phaser.GameObjects.Group | null = null;
  private dropPool: Phaser.GameObjects.Group | null = null;
  private corpsePool: Phaser.GameObjects.Group | null = null;
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
  private wardCooldown = 0;
  private wardRemaining = 0;
  private flameWaveCooldown = 0;
  private lifeRecoveryRemaining = 0;
  private manaRecoveryRemaining = 0;
  private lifeRecoveryRate = 0;
  private manaRecoveryRate = 0;
  private resolvedBasic: ResolvedSkillDefinition;
  private resolvedNova: ResolvedSkillDefinition;
  private resolvedDash: ResolvedSkillDefinition;
  private resolvedWard: ResolvedSkillDefinition;
  private resolvedFlameWave: ResolvedSkillDefinition;
  private life: number;
  private focus: number;
  private wave = 1;
  private waveElapsedSeconds = 0;
  private slain = 0;
  private lootCollected = 0;
  private elapsedSeconds = 0;
  private hudElapsed = 0;
  private arenaComplete = false;
  private finalWaveRageActive = false;
  private returnPortal: ReturnPortalState | null = null;
  private returnPortalUsed = false;
  private completionChest: CompletionChestState | null = null;
  private arenaFailed = false;
  private footstepElapsed = 0;
  private previousPlayerX = 0;
  private previousPlayerY = 0;
  private playerVelocityX = 0;
  private playerVelocityY = 0;

  constructor(options: WorldRuntimeOptions) {
    super("crafty-world");
    this.options = options;
    this.resolvedBasic = resolveSkillDefinition(BASIC_ATTACK, 1);
    this.resolvedNova = resolveSkillDefinition(ACTIVE_SKILLS.nova, options.skillLevels.nova);
    this.resolvedDash = resolveSkillDefinition(ACTIVE_SKILLS.dash, options.skillLevels.dash);
    this.resolvedWard = resolveSkillDefinition(ACTIVE_SKILLS.ward, options.skillLevels.ward);
    this.resolvedFlameWave = resolveSkillDefinition(ACTIVE_SKILLS.flameWave, options.skillLevels.flameWave);
    this.riftCharges = this.resolvedDash.maxCharges;
    this.life = options.arenaBalance?.maxLife ?? 100;
    this.focus = options.arenaBalance?.maxFocus ?? 100;
  }

  preload(): void {
    this.load.image("pixel-forge", "/pixel-forge-hideout.webp");
    this.load.image("ashen-wilderness", "/pixel-ashen-wilderness.webp");
    this.load.image("ember-sigil", "/ember-sigil.png");
    this.load.image("class-roster", "/class-roster-v2.png");
    this.load.image("player-sorceress-rendered", "/player-sorceress-v4.png");
    if (this.options.mode === "arena") {
      for (const definition of Object.values(MONSTER_ARCHETYPES)) {
        this.load.image(`monster-${definition.id}`, definition.visual.sprite);
        this.load.image(`corpse-${definition.id}`, definition.visual.corpse);
      }
    }
    if (this.options.mode !== "class-select") {
      const definition = CHARACTER_ANIMATIONS[this.options.classId];
      for (const [sheetId, sheet] of Object.entries(definition.sheets)) {
        if (!sheet) continue;
        this.load.spritesheet(characterSpriteSheetKey(this.options.classId, sheetId as CharacterSpriteSheetId), sheet.url, {
          frameWidth: sheet.frameWidth,
          frameHeight: sheet.frameHeight,
        });
      }
    }
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
    this.dropPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 300, runChildUpdate: false });
    if (this.options.mode === "hideout") this.buildHideoutStations();
    if (this.options.mode === "arena") {
      this.enemyPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 1000, runChildUpdate: false });
      this.projectilePool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: PROJECTILE_POOL_SIZE, runChildUpdate: false });
      this.enemyProjectilePool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: ENEMY_PROJECTILE_POOL_SIZE, runChildUpdate: false });
      this.corpsePool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: ARENA_RULES.corpses.maximumVisible, runChildUpdate: false });
      this.vfxPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: VFX_PARTICLE_POOL_SIZE, runChildUpdate: false });
      this.enemyHealthBars = this.add.graphics().setDepth(470);
      this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
      this.cameras.main.startFollow(this.cameraTarget!, true, 0.16, 0.16);
      this.cameras.main.roundPixels = false;
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
      ward: Phaser.Input.Keyboard.KeyCodes.R,
      flameWave: Phaser.Input.Keyboard.KeyCodes.F,
      flask1: Phaser.Input.Keyboard.KeyCodes.ONE,
      flask2: Phaser.Input.Keyboard.KeyCodes.TWO,
      flask3: Phaser.Input.Keyboard.KeyCodes.THREE,
      flask4: Phaser.Input.Keyboard.KeyCodes.FOUR,
      flask5: Phaser.Input.Keyboard.KeyCodes.FIVE,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.options.mode === "arena" && !this.options.paused && !this.arenaComplete) this.tryBasicAttack();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.playerAnimator?.destroy();
      this.audio.dispose();
    });
  }

  update(_time: number, delta: number): void {
    if (!this.player || this.options.paused) {
      this.accumulator = 0;
      return;
    }
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.nova)) this.useSkill("nova");
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.dash)) this.useSkill("dash");
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.ward)) this.useSkill("ward");
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.flameWave)) this.useSkill("flameWave");
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.flask1)) this.useFlask(0);
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.flask2)) this.useFlask(1);
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.flask3)) this.useFlask(2);
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.flask4)) this.useFlask(3);
    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.flask5)) this.useFlask(4);
    this.accumulator += Math.min(delta, MAX_FRAME_DELTA);
    while (this.accumulator >= FIXED_STEP) {
      this.previousPlayerX = this.player.x;
      this.previousPlayerY = this.player.y;
      this.fixedUpdate(FIXED_STEP / 1000);
      this.accumulator -= FIXED_STEP;
    }
    this.renderPlayer(this.accumulator / FIXED_STEP);
  }

  useSkill(skill: "basic" | "nova" | "dash" | "ward" | "flameWave"): void {
    if (this.options.mode !== "arena" || !this.player || this.options.paused) return;
    if (skill === "basic") {
      this.tryBasicAttack();
      return;
    }
    if (skill === "nova" && this.novaCooldown <= 0 && this.focus >= this.resolvedNova.focusCost) {
      const pointer = this.input.activePointer;
      const direction = resolveCharacterDirection(pointer.worldX - this.player.x, pointer.worldY - this.player.y, this.playerAnimator?.currentDirection);
      const started = this.beginSkillAction(this.resolvedNova, direction, () => {
        for (let index = 0; index < this.resolvedNova.projectileCount; index += 1) {
          const angle = (Math.PI * 2 * index) / this.resolvedNova.projectileCount;
          this.spawnProjectile(Math.cos(angle), Math.sin(angle), this.resolvedNova);
        }
      });
      if (!started) return;
      this.focus -= this.resolvedNova.focusCost;
      this.novaCooldown = this.resolvedNova.cooldown;
    }
    if (skill === "dash" && this.riftCharges > 0 && this.focus >= this.resolvedDash.focusCost) {
      const pointer = this.input.activePointer;
      const dx = pointer.worldX - this.player.x;
      const dy = pointer.worldY - this.player.y;
      const length = Math.hypot(dx, dy) || 1;
      const startX = this.player.x;
      const startY = this.player.y;
      const direction = resolveCharacterDirection(dx, dy, this.playerAnimator?.currentDirection);
      const started = this.beginSkillAction(this.resolvedDash, direction, () => {
        if (!this.player) return;
        this.player.x += (dx / length) * 105;
        this.player.y += (dy / length) * 105;
        this.clampPlayer();
        this.playerAnimator?.setWorldTransform(this.player.x, this.player.y, Math.round(this.player.y / 10) + 11);
      }, startX, startY);
      if (!started) return;
      this.focus -= this.resolvedDash.focusCost;
      this.riftCharges -= 1;
      if (this.riftRecharge <= 0) this.riftRecharge = this.resolvedDash.recharge;
    }
    if (skill === "ward" && this.wardCooldown <= 0 && this.focus >= this.resolvedWard.focusCost) {
      const pointer = this.input.activePointer;
      const direction = resolveCharacterDirection(pointer.worldX - this.player.x, pointer.worldY - this.player.y, this.playerAnimator?.currentDirection);
      const started = this.beginSkillAction(this.resolvedWard, direction, () => {
        this.wardRemaining = this.resolvedWard.duration ?? 0;
      });
      if (!started) return;
      this.focus -= this.resolvedWard.focusCost;
      this.wardCooldown = this.resolvedWard.cooldown;
    }
    if (skill === "flameWave" && this.flameWaveCooldown <= 0 && this.focus >= this.resolvedFlameWave.focusCost) {
      const pointer = this.input.activePointer;
      const dx = pointer.worldX - this.player.x;
      const dy = pointer.worldY - this.player.y;
      const centerAngle = Math.atan2(dy, dx);
      const direction = resolveCharacterDirection(dx, dy, this.playerAnimator?.currentDirection);
      const started = this.beginSkillAction(this.resolvedFlameWave, direction, () => {
        const projectileCount = this.resolvedFlameWave.projectileCount;
        const spreadRadians = 0.78;
        for (let index = 0; index < projectileCount; index += 1) {
          const offset = projectileCount === 1 ? 0 : (index / (projectileCount - 1) - 0.5) * spreadRadians;
          const angle = centerAngle + offset;
          this.spawnProjectile(Math.cos(angle), Math.sin(angle), this.resolvedFlameWave);
        }
      });
      if (!started) return;
      this.focus -= this.resolvedFlameWave.focusCost;
      this.flameWaveCooldown = this.resolvedFlameWave.cooldown;
    }
  }

  dropInventoryItem(item: InventoryItem): boolean {
    if (!this.player || this.options.mode === "class-select") return false;
    const worldSize = this.options.mode === "arena" ? MAP_SIZE : VIEW_SIZE;
    const direction = characterDirectionVector(this.playerAnimator?.currentDirection ?? "south");
    let x = Phaser.Math.Clamp(this.player.x + direction.x * 64, 24, worldSize - 24);
    let y = Phaser.Math.Clamp(this.player.y + direction.y * 64, 24, worldSize - 24);
    if (Math.hypot(this.player.x - x, this.player.y - y) < 48) {
      x = Phaser.Math.Clamp(this.player.x - direction.x * 64, 24, worldSize - 24);
      y = Phaser.Math.Clamp(this.player.y - direction.y * 64, 24, worldSize - 24);
    }
    return this.spawnGroundDrop(x, y, { kind: "inventory", item });
  }

  useFlask(slotIndex: number): void {
    if (this.options.mode !== "arena" || !this.player || this.options.paused) return;
    const flask = this.options.flaskBelt[slotIndex];
    if (!flask || flask.stackSize <= 0) return;
    const configured = FLASK_DEFINITIONS[flask.baseId];
    const maxLife = this.options.arenaBalance?.maxLife ?? 100;
    const maxMana = this.options.arenaBalance?.maxFocus ?? 100;
    if (configured.resource === "life" && this.life >= maxLife) return;
    if (configured.resource === "mana" && this.focus >= maxMana) return;
    const consumed = this.options.onFlaskUse(slotIndex);
    if (!consumed) return;
    this.queueFlaskRecovery(consumed);
    this.playFlaskVfx(consumed);
    this.options.onHud(this.getHud());
  }

  getHud(): WorldHudState {
    const finalWave = this.options.arenaBalance?.waves ?? ARENA_RULES.totalWaves;
    return {
      fps: Math.round(this.game.loop.actualFps || 0),
      mode: this.options.mode,
      wave: this.wave,
      enemies: this.enemies.length,
      nextWaveIn: this.wave < finalWave
        ? Math.max(0, ARENA_RULES.waveSpawnIntervalSeconds - this.waveElapsedSeconds)
        : null,
      finalRageIn: this.wave === finalWave && !this.finalWaveRageActive && !this.arenaComplete
        ? Math.max(0, ARENA_RULES.finalWaveRageDelaySeconds - this.waveElapsedSeconds)
        : null,
      finalRageActive: this.finalWaveRageActive,
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
      wardCooldown: this.wardCooldown,
      wardRemaining: this.wardRemaining,
      flameWaveCooldown: this.flameWaveCooldown,
      arenaComplete: this.arenaComplete,
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
    this.resolvedWard = resolveSkillDefinition(ACTIVE_SKILLS.ward, skillLevels.ward);
    this.resolvedFlameWave = resolveSkillDefinition(ACTIVE_SKILLS.flameWave, skillLevels.flameWave);
    this.riftCharges = Phaser.Math.Clamp(
      this.riftCharges + Math.max(0, this.resolvedDash.maxCharges - previousMaxCharges),
      0,
      this.resolvedDash.maxCharges,
    );
    if (this.riftCharges === this.resolvedDash.maxCharges) this.riftRecharge = 0;
    this.options.skillLevels = skillLevels;
    this.options.onHud(this.getHud());
  }

  updateFlaskBelt(flaskBelt: FlaskBelt): void {
    this.options.flaskBelt = flaskBelt;
  }

  private fixedUpdate(delta: number): void {
    if (!this.player || this.arenaFailed) return;
    this.elapsedSeconds += delta;
    this.waveElapsedSeconds += delta;
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.novaCooldown = Math.max(0, this.novaCooldown - delta);
    this.wardCooldown = Math.max(0, this.wardCooldown - delta);
    this.flameWaveCooldown = Math.max(0, this.flameWaveCooldown - delta);
    this.wardRemaining = Math.max(0, this.wardRemaining - delta);
    this.updateFlaskRecovery(delta);
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
    const inputLength = Math.hypot(xInput, yInput) || 1;
    const speed = (this.options.arenaBalance?.moveSpeed ?? 5.6) * 34;
    const hasInput = Boolean(xInput || yInput);
    const targetVelocityX = hasInput ? (xInput / inputLength) * speed : 0;
    const targetVelocityY = hasInput ? (yInput / inputLength) * speed : 0;
    const response = hasInput ? MOVEMENT_ACCELERATION : MOVEMENT_DECELERATION;
    const velocityBlend = 1 - Math.exp(-response * delta);
    this.playerVelocityX = Phaser.Math.Linear(this.playerVelocityX, targetVelocityX, velocityBlend);
    this.playerVelocityY = Phaser.Math.Linear(this.playerVelocityY, targetVelocityY, velocityBlend);
    if (!hasInput && Math.hypot(this.playerVelocityX, this.playerVelocityY) < 0.5) {
      this.playerVelocityX = 0;
      this.playerVelocityY = 0;
    }

    const movementSpeed = Math.hypot(this.playerVelocityX, this.playerVelocityY);
    const isMoving = movementSpeed > 2;
    if (isMoving) {
      this.player.x += this.playerVelocityX * delta;
      this.player.y += this.playerVelocityY * delta;
      this.clampPlayer();
      this.footstepElapsed += delta;
      const speedRatio = Phaser.Math.Clamp(movementSpeed / speed, 0, 1);
      if (speedRatio > 0.35 && this.footstepElapsed >= Phaser.Math.Linear(0.2, 0.14, speedRatio)) {
        this.footstepElapsed = 0;
        this.emitVfxParticle(
          this.player.x - (this.playerVelocityX / movementSpeed) * 4,
          this.player.y + 22,
          0xb69a73,
          Phaser.Math.Between(-18, 18),
          Phaser.Math.Between(-16, -5),
          0.3,
          0.75,
          1.25,
          "vfx-dust",
        );
      }
    } else {
      this.footstepElapsed = 0.12;
    }
    const directionX = isMoving ? this.playerVelocityX / movementSpeed : xInput / inputLength;
    const directionY = isMoving ? this.playerVelocityY / movementSpeed : yInput / inputLength;
    this.playerAnimator?.setLocomotion(directionX, directionY, isMoving, speed > 0 ? movementSpeed / speed : 0);

    if (this.options.mode === "arena") {
      if (this.keys?.attack.isDown || this.input.activePointer.isDown) this.tryBasicAttack();
      this.updateFinalWaveRage();
      this.updateEnemies(delta);
      this.updateEnemyProjectiles(delta);
      this.rebuildSpatialBuckets();
      this.applyEnemyContactDamage(delta);
      this.updateProjectiles(delta);
      this.updateVfxParticles(delta);
      this.updateCorpses(delta);
      this.renderEnemyHealth();
      this.advanceWaveIfReady();
      this.updateCompletionChest(delta);
      this.updateReturnPortal(delta);
    }
    this.updateGroundDrops(delta);

    this.hudElapsed += delta;
    if (this.hudElapsed >= 0.2) {
      this.hudElapsed = 0;
      this.options.onHud(this.getHud());
    }
  }

  private createTextures(): void {
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
    const ember = this.make.graphics({ x: 0, y: 0 });
    ember.fillStyle(0xff6b2f, 0.35).fillCircle(6, 6, 6);
    ember.fillStyle(0xffb755, 0.85).fillCircle(6, 6, 3);
    ember.fillStyle(0xfff1b8).fillRect(5, 4, 2, 3);
    ember.generateTexture("vfx-ember", 12, 12).destroy();
    const dust = this.make.graphics({ x: 0, y: 0 });
    dust.fillStyle(0x6f5742, 0.55).fillRect(1, 3, 8, 4);
    dust.fillStyle(0xb7956d, 0.45).fillRect(3, 1, 5, 3);
    dust.generateTexture("vfx-dust", 10, 8).destroy();
    const slash = this.make.graphics({ x: 0, y: 0 });
    slash.lineStyle(5, 0xffe0a0, 0.18).beginPath().arc(32, 32, 23, -1.15, 1.1).strokePath();
    slash.lineStyle(2, 0xffffff, 0.9).beginPath().arc(32, 32, 23, -1.15, 1.1).strokePath();
    slash.generateTexture("vfx-slash", 64, 64).destroy();
    const aura = this.make.graphics({ x: 0, y: 0 });
    aura.lineStyle(2, 0xffffff, 0.42).strokeEllipse(30, 13, 54, 18);
    aura.lineStyle(1, 0xffffff, 0.2).strokeEllipse(30, 13, 38, 12);
    aura.generateTexture("player-aura", 60, 26).destroy();
    this.createDropTexture("drop-scrap", 0xc17a42, 0xf1c071);
    this.createDropTexture("drop-essence", 0x6c4ca4, 0xc6a5ff);
    this.createDropTexture("drop-mapDust", 0x317f89, 0x92e4df);
    this.createDropTexture("drop-currency", 0x74572e, 0xd9b66d);
    this.createDropTexture("drop-map", 0x725526, 0xf0ce72);
    this.createDropTexture("drop-weak-health-flask", 0x7e171d, 0xff6a58);
    this.createDropTexture("drop-weak-mana-flask", 0x183d82, 0x66b7ff);
    this.createDropTexture("drop-equipment-normal", 0x7c756c, 0xded5c9);
    this.createDropTexture("drop-equipment-magic", 0x4c64a4, 0x96b4ff);
    this.createDropTexture("drop-equipment-rare", 0x9b782e, 0xffd867);
    this.createCompletionChestTextures();
  }

  private createCompletionChestTextures(): void {
    const closed = this.make.graphics({ x: 0, y: 0 });
    closed.fillStyle(0x08090b, 0.55).fillEllipse(32, 45, 58, 13);
    closed.fillStyle(0x2b160c).fillRect(5, 17, 54, 28);
    closed.fillStyle(0x713b19).fillRect(7, 19, 50, 22);
    closed.fillStyle(0xb16a2c).fillRect(7, 19, 50, 6);
    closed.fillStyle(0x3b1d0c).fillRect(7, 33, 50, 8);
    closed.fillStyle(0xc89b52).fillRect(8, 15, 48, 4).fillRect(10, 39, 44, 4);
    closed.fillStyle(0x8b5c29).fillRect(14, 14, 5, 29).fillRect(45, 14, 5, 29);
    closed.fillStyle(0xf4ce73).fillRect(28, 26, 8, 10);
    closed.fillStyle(0xffefb0).fillRect(30, 27, 4, 3);
    closed.generateTexture("reward-chest-closed", 64, 52).destroy();

    const opened = this.make.graphics({ x: 0, y: 0 });
    opened.fillStyle(0x08090b, 0.55).fillEllipse(32, 47, 58, 13);
    opened.fillStyle(0xf7c957, 0.18).fillTriangle(12, 37, 52, 37, 32, 1);
    opened.fillStyle(0x2b160c).fillRect(5, 27, 54, 19);
    opened.fillStyle(0x713b19).fillRect(7, 28, 50, 14);
    opened.fillStyle(0xc89b52).fillRect(8, 26, 48, 4).fillRect(10, 40, 44, 4);
    opened.fillStyle(0x3b1d0c).fillRect(8, 9, 48, 11);
    opened.fillStyle(0xb16a2c).fillRect(10, 7, 44, 7);
    opened.fillStyle(0xc89b52).fillRect(8, 17, 48, 4);
    opened.fillStyle(0x8b5c29).fillRect(14, 7, 5, 14).fillRect(45, 7, 5, 14);
    opened.fillStyle(0xffdf72).fillRect(15, 31, 34, 4);
    opened.fillStyle(0xfff3bc).fillRect(22, 30, 6, 3).fillRect(38, 32, 4, 2);
    opened.generateTexture("reward-chest-open", 64, 54).destroy();
  }

  private createDropTexture(key: string, outerColor: number, innerColor: number): void {
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x08090b, 0.7).fillRect(2, 3, 12, 12);
    graphics.fillStyle(outerColor).fillRect(3, 1, 10, 14);
    graphics.fillStyle(innerColor).fillRect(6, 4, 4, 7);
    graphics.fillStyle(0xffffff, 0.8).fillRect(7, 3, 2, 2);
    graphics.generateTexture(key, 16, 17).destroy();
  }

  private buildClassShowcase(): void {
    const roster = this.add.image(480, 548, "class-roster").setOrigin(0.5, 1).setDisplaySize(590, 590).setDepth(12).setAlpha(0.95);
    this.tweens.add({ targets: roster, y: roster.y - 4, duration: 1450, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    (["amazon", "barbarian", "sorceress"] as CharacterClassId[]).forEach((classId, index) => {
      const x = 285 + index * 195;
      this.add.ellipse(x, 535, 158, 38, 0x0b0c0f, 0.78);
      const glow = this.add.image(x, 528, "player-aura").setScale(2.1).setTint(CLASS_COLORS[classId].magic).setAlpha(0.24).setDepth(10);
      this.tweens.add({ targets: glow, alpha: 0.48, scaleX: 2.35, scaleY: 2.25, duration: 900 + index * 120, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    });
  }

  private createPlayer(): void {
    const x = this.options.mode === "arena" ? MAP_SIZE / 2 : 480;
    const y = this.options.mode === "arena" ? MAP_SIZE / 2 : 700;
    this.playerShadow = this.add.image(x, y + 25, "shadow").setScale(2.1, 1.45).setDepth(8);
    this.playerAura = this.add.image(x, y + 25, "player-aura").setScale(1.45).setTint(CLASS_COLORS[this.options.classId].magic).setAlpha(0.18).setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
    this.playerWard = this.add.image(x, y + 3, "player-aura").setScale(2.75, 4.4).setTint(0xffb45f).setAlpha(0).setVisible(false).setDepth(11).setBlendMode(Phaser.BlendModes.ADD);
    this.player = this.add.sprite(x, y, "shadow").setVisible(false).setDepth(10);
    this.previousPlayerX = x;
    this.previousPlayerY = y;
    this.cameraTarget = this.add.zone(x, y, 1, 1);
    const textureKey = characterDefaultSpriteSheetKey(this.options.classId);
    this.playerVisual = this.add.sprite(x, y + characterVisualOffsetY(this.options.classId), textureKey, 0).setDepth(10);
    this.playerAnimator = new CharacterAnimator(this, this.playerVisual, this.options.classId);
    if (this.options.mode === "arena") {
      this.playerResourceBars = this.add.graphics().setDepth(500);
      const resourceLabelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
        fontFamily: "monospace",
        fontSize: "9px",
        fontStyle: "bold",
        color: "#fff4df",
        stroke: "#090607",
        strokeThickness: 2,
      };
      this.playerLifeLabel = this.add.text(x, y, "", resourceLabelStyle).setOrigin(0.5).setDepth(501);
      this.playerManaLabel = this.add.text(x, y, "", resourceLabelStyle).setOrigin(0.5).setDepth(501);
    }
    this.tweens.add({ targets: this.playerAura, alpha: 0.38, scaleX: 1.4, scaleY: 1.28, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.InOut" });
  }

  private renderPlayer(interpolation: number): void {
    if (!this.player) return;
    const x = Phaser.Math.Linear(this.previousPlayerX, this.player.x, Phaser.Math.Clamp(interpolation, 0, 1));
    const y = Phaser.Math.Linear(this.previousPlayerY, this.player.y, Phaser.Math.Clamp(interpolation, 0, 1));
    const playerDepth = Math.round(y / 10) + 11;
    this.playerAnimator?.setWorldTransform(x, y, playerDepth);
    this.playerShadow?.setPosition(x, y + 25).setDepth(playerDepth - 2);
    this.playerAura?.setPosition(x, y + 25).setDepth(playerDepth - 2);
    this.playerWard?.setPosition(x, y + 2)
      .setDepth(playerDepth + 1)
      .setVisible(this.wardRemaining > 0)
      .setAlpha(this.wardRemaining > 0 ? 0.38 + Math.sin(this.elapsedSeconds * 8) * 0.12 : 0)
      .setScale(2.75 + Math.sin(this.elapsedSeconds * 5) * 0.08, 4.4 + Math.sin(this.elapsedSeconds * 5) * 0.12);
    this.cameraTarget?.setPosition(x, y);
    this.renderPlayerResources(x, y, playerDepth + 80);
  }

  private renderPlayerResources(x: number, y: number, depth: number): void {
    const graphics = this.playerResourceBars;
    if (!graphics || !this.playerLifeLabel || !this.playerManaLabel) return;
    const maxLife = this.options.arenaBalance?.maxLife ?? 100;
    const maxMana = this.options.arenaBalance?.maxFocus ?? 100;
    const lifeRatio = Phaser.Math.Clamp(this.life / maxLife, 0, 1);
    const manaRatio = Phaser.Math.Clamp(this.focus / maxMana, 0, 1);
    const width = 82;
    const height = 8;
    const left = x - width / 2;
    const top = y - 119;

    graphics.clear().setDepth(depth);
    graphics.fillStyle(0x080609, 0.92).fillRect(left - 2, top - 2, width + 4, height + 4);
    graphics.lineStyle(1, 0x6f4a3a, 1).strokeRect(left - 1, top - 1, width + 2, height + 2);
    graphics.fillStyle(0x421315, 1).fillRect(left, top, width, height);
    graphics.fillStyle(0xc9473f, 1).fillRect(left, top, width * lifeRatio, height);
    graphics.fillStyle(0x080609, 0.92).fillRect(left - 2, top + 10, width + 4, height + 4);
    graphics.lineStyle(1, 0x3e5477, 1).strokeRect(left - 1, top + 11, width + 2, height + 2);
    graphics.fillStyle(0x152446, 1).fillRect(left, top + 12, width, height);
    graphics.fillStyle(0x397dcc, 1).fillRect(left, top + 12, width * manaRatio, height);

    const lifeText = `${Math.ceil(Math.max(0, this.life))}/${Math.ceil(maxLife)}`;
    const manaText = `${Math.floor(Math.max(0, this.focus))}/${Math.floor(maxMana)}`;
    if (this.playerLifeLabel.text !== lifeText) this.playerLifeLabel.setText(lifeText);
    if (this.playerManaLabel.text !== manaText) this.playerManaLabel.setText(manaText);
    this.playerLifeLabel.setPosition(x, top + height / 2).setDepth(depth + 1);
    this.playerManaLabel.setPosition(x, top + 12 + height / 2).setDepth(depth + 1);
  }

  private queueFlaskRecovery(definition: FlaskDefinition): void {
    const rate = definition.recovery / definition.durationSeconds;
    if (definition.resource === "life") {
      this.lifeRecoveryRemaining += definition.recovery;
      this.lifeRecoveryRate = Math.max(this.lifeRecoveryRate, rate);
    } else {
      this.manaRecoveryRemaining += definition.recovery;
      this.manaRecoveryRate = Math.max(this.manaRecoveryRate, rate);
    }
  }

  private updateFlaskRecovery(delta: number): void {
    const maxLife = this.options.arenaBalance?.maxLife ?? 100;
    const maxMana = this.options.arenaBalance?.maxFocus ?? 100;
    const life = advanceFlaskRecovery(this.life, maxLife, this.lifeRecoveryRemaining, this.lifeRecoveryRate, delta);
    const mana = advanceFlaskRecovery(this.focus, maxMana, this.manaRecoveryRemaining, this.manaRecoveryRate, delta);
    this.life = life.value;
    this.lifeRecoveryRemaining = life.remaining;
    this.focus = mana.value;
    this.manaRecoveryRemaining = mana.remaining;
  }

  private playFlaskVfx(definition: FlaskDefinition): void {
    if (!this.player) return;
    const isLife = definition.resource === "life";
    const color = isLife ? 0xff5a50 : 0x55a9ff;
    this.emitRadialVfx(this.player.x, this.player.y - 10, 8, color, 55, 0.45);
    const label = this.add.text(this.player.x, this.player.y - 96, `+${definition.recovery} ${isLife ? "LIFE" : "MANA"}`, {
      fontFamily: "monospace", fontSize: "13px", fontStyle: "bold", color: isLife ? "#ff9a8c" : "#8dccff", stroke: "#090607", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(520);
    this.tweens.add({ targets: label, y: label.y - 24, alpha: 0, duration: 750, ease: "Cubic.easeOut", onComplete: () => label.destroy() });
  }

  private beginSkillAction(
    skill: SkillDefinition,
    direction: CharacterDirection,
    onRelease: () => void,
    startX?: number,
    startY?: number,
  ): boolean {
    if (!this.playerAnimator) return false;
    const playbackRate = skill.presentation.animation === "attack"
      ? Phaser.Math.Clamp(this.options.arenaBalance?.attackSpeed ?? 1, 0.8, 2.5)
      : skill.presentation.animation === "dash" ? 1.35 : 1;
    return this.playerAnimator.playAction(skill.presentation.animation, direction, playbackRate, () => {
      onRelease();
      this.audio.play(skill.presentation.audio);
      this.playSkillReleaseVfx(skill, direction, startX, startY);
    });
  }

  private playSkillReleaseVfx(skill: SkillDefinition, direction: CharacterDirection, startX?: number, startY?: number): void {
    if (!this.player || !this.playerVisual) return;
    const facing = characterDirectionVector(direction);
    if (skill.presentation.vfx === "ember-lance") {
      const palette = CLASS_COLORS[this.options.classId];
      const slash = this.add.image(this.player.x + facing.x * 28, this.player.y + facing.y * 18 - 4, "vfx-slash")
        .setScale(0.55, 0.78)
        .setRotation(Math.atan2(facing.y, facing.x))
        .setFlipX(direction === "west")
        .setTint(palette.magic)
        .setAlpha(0.92)
        .setDepth(Math.round(this.player.y / 10) + 90)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: slash, alpha: 0, scaleX: 1.05, scaleY: 1.02, duration: 150, ease: "Cubic.easeOut", onComplete: () => slash.destroy() });
      for (let index = 0; index < 5; index += 1) {
        this.emitVfxParticle(
          this.player.x + facing.x * 25,
          this.player.y + facing.y * 18 - 5,
          palette.magic,
          facing.x * Phaser.Math.Between(45, 105) + Phaser.Math.Between(-18, 18),
          facing.y * Phaser.Math.Between(45, 105) + Phaser.Math.Between(-28, 18),
          0.2,
          0.85,
          0.05,
          index % 2 ? "vfx-spark" : "vfx-ember",
        );
      }
    } else if (skill.presentation.vfx === "ember-nova") {
      const sigil = this.add.image(this.player.x, this.player.y + 5, "ember-sigil")
        .setScale(0.06)
        .setAlpha(0.92)
        .setDepth(Math.round(this.player.y / 10) + 8)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: sigil,
        scale: 0.58,
        alpha: 0,
        angle: 35,
        duration: 430,
        ease: "Cubic.easeOut",
        onComplete: () => sigil.destroy(),
      });
      const core = this.add.image(this.player.x, this.player.y - 2, "vfx-ember")
        .setScale(0.25).setTint(0xffe3a0).setAlpha(1).setDepth(Math.round(this.player.y / 10) + 95).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: core, scale: 4.4, alpha: 0, duration: 260, ease: "Expo.easeOut", onComplete: () => core.destroy() });
      this.emitRadialVfx(this.player.x, this.player.y, 20, 0xff6834, 145, 0.4);
      this.emitRadialVfx(this.player.x, this.player.y, 10, 0xffd06c, 82, 0.48);
    } else if (skill.presentation.vfx === "rift-step") {
      const fromX = startX ?? this.player.x;
      const fromY = startY ?? this.player.y;
      for (let index = 0; index < 5; index += 1) {
        const progress = index / 5;
        const afterimage = this.add.image(
          Phaser.Math.Linear(fromX, this.player.x, progress),
          Phaser.Math.Linear(fromY, this.player.y, progress),
          this.playerVisual.texture.key,
          this.playerVisual.frame.name,
        ).setOrigin(0.5, 1)
          .setScale(CHARACTER_ANIMATIONS[this.options.classId].renderScale)
          .setFlipX(this.playerVisual.flipX)
          .setTint(0x9f75d8)
          .setAlpha(0.38 - index * 0.055)
          .setDepth(Math.round(Phaser.Math.Linear(fromY, this.player.y, progress) / 10) + 10);
        afterimage.y += characterVisualOffsetY(this.options.classId);
        this.tweens.add({ targets: afterimage, alpha: 0, duration: 220 + index * 25, onComplete: () => afterimage.destroy() });
      }
      for (let index = 0; index < 14; index += 1) {
        const progress = index / 13;
        this.emitVfxParticle(
          Phaser.Math.Linear(fromX, this.player.x, progress),
          Phaser.Math.Linear(fromY, this.player.y, progress) + Phaser.Math.Between(-8, 8),
          0xad83ee,
          Phaser.Math.Between(-20, 20),
          Phaser.Math.Between(-24, 8),
          0.24,
          index % 3 === 0 ? 1 : 0.65,
          0.04,
          index % 3 === 0 ? "vfx-ember" : "vfx-spark",
        );
      }
    } else if (skill.presentation.vfx === "cinder-ward") {
      const sigil = this.add.image(this.player.x, this.player.y + 12, "ember-sigil")
        .setScale(0.1)
        .setAlpha(0.88)
        .setTint(0xffbd72)
        .setDepth(Math.round(this.player.y / 10) + 7)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: sigil, scale: 0.42, alpha: 0, angle: -28, duration: 520, ease: "Cubic.easeOut", onComplete: () => sigil.destroy() });
      this.emitRadialVfx(this.player.x, this.player.y - 4, 16, 0xffb45f, 92, 0.48);
      this.emitRadialVfx(this.player.x, this.player.y - 4, 8, 0xffe5a5, 52, 0.6);
    } else if (skill.presentation.vfx === "flame-wave") {
      const angle = Math.atan2(facing.y, facing.x);
      const sigil = this.add.image(this.player.x + facing.x * 22, this.player.y + facing.y * 14 + 5, "ember-sigil")
        .setScale(0.1, 0.05)
        .setRotation(angle)
        .setTint(0xff7b35)
        .setAlpha(0.86)
        .setDepth(Math.round(this.player.y / 10) + 8)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: sigil, scaleX: 0.58, scaleY: 0.24, alpha: 0, duration: 320, ease: "Cubic.easeOut", onComplete: () => sigil.destroy() });
      for (let index = 0; index < 18; index += 1) {
        const particleAngle = angle + Phaser.Math.FloatBetween(-0.42, 0.42);
        const velocity = Phaser.Math.Between(85, 185);
        this.emitVfxParticle(
          this.player.x + facing.x * 24,
          this.player.y + facing.y * 16 + Phaser.Math.Between(-5, 5),
          index % 3 === 0 ? 0xffd37a : 0xff6630,
          Math.cos(particleAngle) * velocity,
          Math.sin(particleAngle) * velocity,
          Phaser.Math.FloatBetween(0.22, 0.4),
          index % 3 === 0 ? 0.9 : 0.65,
          0.04,
          index % 2 === 0 ? "vfx-ember" : "vfx-spark",
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

  private emitVfxParticle(x: number, y: number, tint: number, vx: number, vy: number, lifetime: number, startScale: number, endScale: number, textureKey: "vfx-spark" | "vfx-ember" | "vfx-dust" = "vfx-spark"): void {
    const sprite = this.vfxPool?.get(x, y, "vfx-spark") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setTexture(textureKey)
      .setActive(true)
      .setVisible(true)
      .setPosition(x, y)
      .setTint(tint)
      .setAlpha(0.9)
      .setScale(startScale)
      .setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2))
      .setDepth(Math.round(y / 10) + 85)
      .setBlendMode(textureKey === "vfx-dust" ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD);
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
    const merchant = this.add.image(248, 620, "player-sorceress-rendered").setOrigin(0.5, 1).setDisplaySize(59, 96).setTint(0xd9ad76).setDepth(12);
    this.tweens.add({ targets: merchant, y: merchant.y - 2, duration: 1350, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.tweens.add({ targets: merchant, y: merchant.y - 3, duration: 1250, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.addStation("merchant", 248, 592, 125, 105, "MERCHANT");
    if (this.options.portalActive) {
      const aura = this.add.ellipse(480, 202, 105, 34, 0xff6a2e, 0.24).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: aura, alpha: 0.55, scaleX: 1.18, scaleY: 1.18, duration: 760, yoyo: true, repeat: -1 });
    }
  }

  private addStation(station: WorldStation, x: number, y: number, width: number, height: number, label: string): void {
    const zone = this.add.zone(x, y, width, height).setInteractive({ cursor: "pointer" });
    zone.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.options.paused) return;
      this.options.onStation(station);
    });
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
      const clampedX = Phaser.Math.Clamp(this.player.x, 90, MAP_SIZE - 90);
      const clampedY = Phaser.Math.Clamp(this.player.y, 90, MAP_SIZE - 90);
      if (clampedX !== this.player.x) this.playerVelocityX = 0;
      if (clampedY !== this.player.y) this.playerVelocityY = 0;
      this.player.x = clampedX;
      this.player.y = clampedY;
      return;
    }
    const clampedX = Phaser.Math.Clamp(this.player.x, 175, 785);
    const clampedY = Phaser.Math.Clamp(this.player.y, 310, 805);
    if (clampedX !== this.player.x) this.playerVelocityX = 0;
    if (clampedY !== this.player.y) this.playerVelocityY = 0;
    this.player.x = clampedX;
    this.player.y = clampedY;
  }

  private startWave(wave: number): void {
    this.wave = wave;
    this.waveElapsedSeconds = 0;
    this.finalWaveRageActive = false;
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
        const texture = `monster-${archetypeId}`;
        const sprite = this.enemyPool?.get(x, y, texture) as Phaser.GameObjects.Image | null;
        if (!sprite) break;
        const rarityScale = rarity === "rare" ? 1.3 : rarity === "magic" ? 1.08 : 1;
        const baseScale = archetype.visual.scale * rarityScale;
        sprite.setTexture(texture).setOrigin(0.5, archetype.visual.originY).clearTint();
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
      enemy.phase += delta * (enemy.aggro ? 5.2 : 0.8);
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
      enemy.jumpCooldown = Math.max(0, enemy.jumpCooldown - delta);
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (this.finalWaveRageActive) enemy.aggro = true;
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
        const idleX = enemy.homeX + Math.cos(enemy.phase) * 14;
        const idleY = enemy.homeY + Math.sin(enemy.phase * 0.8) * 10;
        enemy.x += (idleX - enemy.x) * delta * 1.8;
        enemy.y += (idleY - enemy.y) * delta * 1.8;
      }
      const grounded = enemy.jumpRemaining <= 0;
      const locomotionBob = enemy.aggro && grounded ? Math.sin(enemy.phase) * 1.25 : 0;
      const locomotionTilt = enemy.aggro && grounded ? Math.sin(enemy.phase * 0.5) * 0.012 : 0;
      enemy.sprite
        .setPosition(enemy.x, enemy.y + locomotionBob)
        .setRotation(locomotionTilt)
        .setFlipX(dx < 0)
        .setDepth(Math.round(enemy.y / 10) + 10);
    }
  }

  private updateFinalWaveRage(): void {
    if (this.arenaComplete || this.enemies.length === 0) return;
    const finalWave = this.options.arenaBalance?.waves ?? ARENA_RULES.totalWaves;
    if (!shouldActivateFinalWaveRage(this.wave, finalWave, this.waveElapsedSeconds, this.finalWaveRageActive)) return;
    this.finalWaveRageActive = true;
    for (const enemy of this.enemies) enemy.aggro = true;
    this.cameras.main.flash(320, 142, 25, 14, false);
    if (this.player) this.emitRadialVfx(this.player.x, this.player.y, 18, 0xe4472f, 130, 0.5);
    this.options.onHud(this.getHud());
  }

  private spawnEnemyProjectile(enemy: EnemyState, directionX: number, directionY: number, speed: number, damageEffectiveness: number): void {
    const sprite = this.enemyProjectilePool?.get(enemy.x, enemy.y, "enemy-projectile") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setTexture("enemy-projectile").setActive(true).setVisible(true).setPosition(enemy.x, enemy.y).setScale(enemy.rarity === "rare" ? 1.55 : 1.25).setDepth(82).setBlendMode(Phaser.BlendModes.ADD);
    const accent = MONSTER_ARCHETYPES[enemy.archetypeId].visual.accent;
    this.emitRadialVfx(enemy.x, enemy.y - 12, enemy.rarity === "rare" ? 6 : 3, accent, 44, 0.2);
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
      const visible = enemy.x >= view.left - 100 && enemy.x <= view.right + 100
        && enemy.y >= view.top - 100 && enemy.y <= view.bottom + 40;
      if (!visible) {
        if (enemy.healthLabel) this.releaseHealthLabel(enemy.healthLabel);
        enemy.healthLabel = null;
        continue;
      }
      if (!enemy.healthLabel) enemy.healthLabel = this.acquireHealthLabel();
      enemy.healthLabel.setVisible(true);
      const left = Math.round(enemy.x - HEALTH_BAR_WIDTH / 2);
      const archetype = MONSTER_ARCHETYPES[enemy.archetypeId];
      const top = Math.round(enemy.y - 128 * enemy.baseScale * archetype.visual.originY - 8);
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
    if (!this.player || this.arenaFailed) return;
    const evadeMultiplier = 1 - (this.options.arenaBalance?.evadeChance ?? 0) / 100;
    const armor = this.options.arenaBalance?.armor ?? 0;
    const armorMultiplier = 100 / (100 + armor);
    const wardMultiplier = this.wardRemaining > 0 ? 1 - (this.resolvedWard.damageReduction ?? 0) / 100 : 1;
    this.life -= rawDamage * evadeMultiplier * armorMultiplier * wardMultiplier;
    if (this.life <= 0) {
      this.life = 0;
      this.arenaFailed = true;
      this.playerVelocityX = 0;
      this.playerVelocityY = 0;
      this.releaseEnemyProjectiles();
      this.options.onHud(this.getHud());
      this.options.onPlayerDeath();
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
    const direction = resolveCharacterDirection(dx, dy, this.playerAnimator?.currentDirection);
    const started = this.beginSkillAction(this.resolvedBasic, direction, () => {
      this.spawnProjectile(dx / length, dy / length, this.resolvedBasic);
    });
    if (!started) return;
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
    this.spawnCorpse(enemy);
    this.emitMonsterDeathVfx(enemy);
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

  private spawnCorpse(enemy: EnemyState): void {
    if (!this.corpsePool) return;
    if (this.corpses.length >= ARENA_RULES.corpses.maximumVisible) this.releaseCorpse(0);
    const archetype = MONSTER_ARCHETYPES[enemy.archetypeId];
    const texture = `corpse-${enemy.archetypeId}`;
    const sprite = this.corpsePool.get(enemy.x, enemy.y, texture) as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite
      .setTexture(texture)
      .setOrigin(0.5, archetype.visual.originY)
      .setActive(true)
      .setVisible(true)
      .setPosition(enemy.x + Phaser.Math.FloatBetween(-2, 2), enemy.y + Phaser.Math.FloatBetween(-2, 2))
      .setScale(enemy.baseScale)
      .setRotation(Phaser.Math.FloatBetween(-0.035, 0.035))
      .setFlipX(enemy.sprite.flipX)
      .setAlpha(0.96)
      .setDepth(Math.round(enemy.y / 10) + 4)
      .clearTint();
    if (enemy.rarity === "magic") sprite.setTint(0xc1cdf1);
    if (enemy.rarity === "rare") sprite.setTint(0xf2d396);
    this.corpses.push({ sprite, age: 0 });
  }

  private emitMonsterDeathVfx(enemy: EnemyState): void {
    const accent = MONSTER_ARCHETYPES[enemy.archetypeId].visual.accent;
    const count = enemy.rarity === "rare" ? 16 : enemy.rarity === "magic" ? 11 : 7;
    this.emitRadialVfx(enemy.x, enemy.y - 10, count, accent, enemy.rarity === "rare" ? 105 : 72, 0.34);
    for (let index = 0; index < Math.ceil(count / 3); index += 1) {
      this.emitVfxParticle(
        enemy.x + Phaser.Math.Between(-12, 12),
        enemy.y + Phaser.Math.Between(-2, 8),
        MONSTER_ARCHETYPES[enemy.archetypeId].visual.body,
        Phaser.Math.Between(-24, 24),
        Phaser.Math.Between(-22, -6),
        0.45,
        0.85,
        1.45,
        "vfx-dust",
      );
    }
  }

  private updateCorpses(delta: number): void {
    for (let index = this.corpses.length - 1; index >= 0; index -= 1) {
      const corpse = this.corpses[index];
      corpse.age += delta;
      const fadeStart = ARENA_RULES.corpses.lifetimeSeconds - ARENA_RULES.corpses.fadeSeconds;
      if (corpse.age > fadeStart) {
        corpse.sprite.setAlpha(0.96 * Phaser.Math.Clamp(
          (ARENA_RULES.corpses.lifetimeSeconds - corpse.age) / ARENA_RULES.corpses.fadeSeconds,
          0,
          1,
        ));
      }
      if (corpse.age >= ARENA_RULES.corpses.lifetimeSeconds) this.releaseCorpse(index);
    }
  }

  private releaseCorpse(index: number): void {
    const corpse = this.corpses[index];
    if (!corpse) return;
    this.corpses.splice(index, 1);
    this.corpsePool?.killAndHide(corpse.sprite);
  }

  private rollGroundDrop(enemy: EnemyState): void {
    const chances = dropChances(enemy.itemQuantity);
    const roll = Math.random();
    let drop: MapDrop | null = null;
    if (roll < chances.equipment) {
      const rarity = rollEquipmentRarity(enemy.itemRarity);
      drop = { kind: "equipment", item: generateEquipment(Math.max(2, this.options.arenaBalance?.tier ?? 1) * 5, rarity) };
    } else if (roll < chances.equipment + chances.material) {
      const materialRoll = Math.random();
      drop = materialRoll < 0.08
        ? { kind: "currency", currency: "mapDust", amount: 1 }
        : materialRoll < 0.28
          ? { kind: "currency", currency: "essence", amount: 1 }
          : { kind: "currency", currency: "scrap", amount: Phaser.Math.Between(1, 2) };
    } else if (roll < chances.equipment + chances.material + chances.flask) {
      drop = { kind: "flask", flask: rollFlaskDrop(), amount: 1 };
    }
    if (!drop) return;
    this.spawnGroundDrop(enemy.x, enemy.y, drop);
  }

  private spawnGroundDrop(x: number, y: number, drop: MapDrop): boolean {
    let texture = "drop-currency";
    let labelText = "ITEM";
    let color = "#ded5c9";
    if (drop.kind === "equipment") {
      const presentation = equipmentDropPresentation(drop.item);
      texture = `drop-equipment-${drop.item.rarity}`;
      labelText = presentation.label;
      color = presentation.color;
    } else if (drop.kind === "currency") {
      texture = `drop-${drop.currency}`;
      labelText = `${drop.amount} ${drop.currency === "mapDust" ? "MAP DUST" : drop.currency.toUpperCase()}`;
      color = drop.currency === "essence" ? "#c6a5ff" : drop.currency === "mapDust" ? "#92e4df" : "#e2ac70";
    } else if (drop.kind === "flask") {
      texture = `drop-${drop.flask}`;
      labelText = FLASK_DEFINITIONS[drop.flask].name.toUpperCase();
      color = FLASK_DEFINITIONS[drop.flask].resource === "life" ? "#ff8b78" : "#84c4ff";
    } else if (isEquipmentItem(drop.item)) {
      const presentation = equipmentDropPresentation(drop.item);
      texture = `drop-equipment-${drop.item.rarity}`;
      labelText = presentation.label;
      color = presentation.color;
    } else if (isMapItem(drop.item)) {
      texture = "drop-map";
      labelText = `${drop.item.baseName.toUpperCase()} · T${drop.item.tier}`;
      color = drop.item.rarity === "rare" ? "#ffd867" : drop.item.rarity === "magic" ? "#96b4ff" : "#ded5c9";
    } else if (isCurrencyItem(drop.item)) {
      const exactTexture = `drop-${drop.item.baseId}`;
      texture = this.textures.exists(exactTexture) ? exactTexture : "drop-currency";
      labelText = `${drop.item.stackSize} ${CURRENCY_DEFINITIONS[drop.item.baseId].name.toUpperCase()}`;
      color = drop.item.baseId === "essence" ? "#c6a5ff" : drop.item.baseId === "mapDust" ? "#92e4df" : "#e2ac70";
    } else if (isFlaskItem(drop.item)) {
      texture = `drop-${drop.item.baseId}`;
      labelText = `${drop.item.stackSize} ${FLASK_DEFINITIONS[drop.item.baseId].name.toUpperCase()}`;
      color = FLASK_DEFINITIONS[drop.item.baseId].resource === "life" ? "#ff8b78" : "#84c4ff";
    }
    const sprite = this.dropPool?.get(x, y, texture) as Phaser.GameObjects.Image | null;
    if (!sprite) return false;
    sprite.setTexture(texture).setActive(true).setVisible(true).setPosition(x, y).setScale(1.8).setDepth(Math.round(y / 10) + 30);
    const label = this.add.text(x, y - 22, labelText, {
      fontFamily: "monospace",
      fontSize: "14px",
      color,
      backgroundColor: "#08090bcc",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(Math.round(y / 10) + 31);
    this.groundDrops.push({ sprite, label, x, y, phase: Phaser.Math.FloatBetween(0, Math.PI * 2), drop });
    return true;
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
      if (groundDrop.drop.kind !== "inventory") this.lootCollected += 1;
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
    for (const corpse of this.corpses) this.corpsePool?.killAndHide(corpse.sprite);
    this.corpses = [];
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
    if (!isArenaCleared(this.wave, finalWave, this.enemies.length)) return;
    this.arenaComplete = true;
    this.spawnCompletionChest();
    this.spawnReturnPortal({ wave: this.wave, enemiesSlain: this.slain, elapsedSeconds: Math.round(this.elapsedSeconds) });
    this.options.onHud(this.getHud());
  }

  private spawnCompletionChest(): void {
    if (!this.player || this.completionChest) return;
    const rules = MAP_COMPLETION_REWARDS.chest;
    const yDirection = this.player.y + rules.spawnDistance <= MAP_SIZE - 100 ? 1 : -1;
    const x = Phaser.Math.Clamp(this.player.x, 100, MAP_SIZE - 100);
    const y = Phaser.Math.Clamp(this.player.y + yDirection * rules.spawnDistance, 100, MAP_SIZE - 100);
    const depth = Math.round(y / 10) + 70;
    const glow = this.add.ellipse(x, y + 1, 112, 54, 0xf2b84b, 0.2)
      .setDepth(depth - 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const sprite = this.add.image(x, y, "reward-chest-closed")
      .setScale(1.55)
      .setDepth(depth);
    const label = this.add.text(x, y - 55, "VICTORY CACHE", {
      fontFamily: "monospace",
      fontSize: "17px",
      fontStyle: "bold",
      color: "#ffe391",
      stroke: "#09060d",
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(depth + 2);
    const prompt = this.add.text(x, y - 34, "CLICK TO OPEN", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#fff0bd",
      backgroundColor: "#120c05dd",
      padding: { x: 7, y: 4 },
    }).setOrigin(0.5).setDepth(depth + 2);
    const interaction = this.add.zone(x, y, rules.interactionWidth, rules.interactionHeight)
      .setDepth(depth + 3)
      .setInteractive({ cursor: "pointer" });
    interaction.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.options.paused) return;
      this.openCompletionChest();
    });
    this.completionChest = { x, y, elapsed: 0, opened: false, glow, sprite, label, prompt, interaction };
    this.emitRadialVfx(x, y - 4, 20, 0xffce62, 92, 0.55);
  }

  private updateCompletionChest(delta: number): void {
    const chest = this.completionChest;
    if (!chest) return;
    chest.elapsed += delta;
    const pulse = Math.sin(chest.elapsed * (chest.opened ? 2.1 : 3.2));
    chest.glow.setScale(1 + pulse * 0.08).setAlpha((chest.opened ? 0.12 : 0.22) + pulse * 0.05);
    if (!chest.opened) {
      chest.sprite.setY(chest.y + pulse * 1.5);
      chest.prompt.setAlpha(0.74 + Math.max(0, pulse) * 0.26);
    }
  }

  private openCompletionChest(): void {
    const chest = this.completionChest;
    if (!chest || chest.opened || this.options.paused) return;
    chest.opened = true;
    chest.sprite.setTexture("reward-chest-open").setY(chest.y - 2);
    chest.interaction.disableInteractive();
    chest.label.setText("CACHE OPENED").setColor("#fff0bd");
    chest.prompt.setText("COLLECT YOUR REWARDS").setAlpha(0.92);
    const tier = this.options.arenaBalance?.tier ?? 1;
    const itemLevel = Math.max(
      MAP_COMPLETION_REWARDS.minimumItemLevel,
      tier * MAP_COMPLETION_REWARDS.itemLevelsPerMapTier,
    );
    const finalWave = this.options.arenaBalance?.waveStats.at(-1);
    const rewards = createMapCompletionRewards(itemLevel, finalWave?.itemRarity ?? 100);
    const radius = MAP_COMPLETION_REWARDS.chest.lootScatterRadius;
    rewards.forEach((reward, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / rewards.length;
      const distance = radius * (index % 2 === 0 ? 1 : 0.72);
      this.spawnGroundDrop(
        Phaser.Math.Clamp(chest.x + Math.cos(angle) * distance, 60, MAP_SIZE - 60),
        Phaser.Math.Clamp(chest.y + Math.sin(angle) * distance, 60, MAP_SIZE - 60),
        reward,
      );
    });
    this.emitRadialVfx(chest.x, chest.y - 8, 42, 0xffd66f, 155, 0.8);
    this.cameras.main.shake(180, 0.0035);
    if (this.returnPortal) this.returnPortal.prompt.setText("ENTER TO RETURN TO HIDEOUT");
  }

  private spawnReturnPortal(summary: ArenaSummary): void {
    if (!this.player || this.returnPortal) return;
    const offset = ARENA_RULES.returnPortal.spawnOffset;
    const x = this.player.x + offset <= MAP_SIZE - 100 ? this.player.x + offset : this.player.x - offset;
    const y = Phaser.Math.Clamp(this.player.y, 100, MAP_SIZE - 100);
    const depth = Math.round(y / 10) + 65;
    const glow = this.add.ellipse(x, y - 38, 106, 146, 0x7138bc, 0.18)
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD);
    const outerRing = this.add.ellipse(x, y - 38, 78, 122, 0x130d1b, 0.72)
      .setStrokeStyle(7, 0x8b54d9, 0.9)
      .setDepth(depth + 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const innerRing = this.add.ellipse(x, y - 38, 58, 102, 0x2a1747, 0.82)
      .setStrokeStyle(2, 0xe0b3ff, 0.95)
      .setDepth(depth + 2)
      .setBlendMode(Phaser.BlendModes.ADD);
    const sigil = this.add.image(x, y - 38, "ember-sigil")
      .setScale(0.19)
      .setTint(0xb77cff)
      .setAlpha(0.48)
      .setDepth(depth + 3)
      .setBlendMode(Phaser.BlendModes.ADD);
    const label = this.add.text(x, y + 38, "RETURN PORTAL", {
      fontFamily: "monospace",
      fontSize: "17px",
      fontStyle: "bold",
      color: "#ead6ff",
      stroke: "#09060d",
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(depth + 5);
    const prompt = this.add.text(x, y + 59, this.completionChest?.opened ? "ENTER TO RETURN TO HIDEOUT" : "OPEN VICTORY CACHE FIRST", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#c6a5ee",
      backgroundColor: "#09060dcc",
      padding: { x: 7, y: 4 },
    }).setOrigin(0.5).setDepth(depth + 5);
    const interaction = this.add.zone(x, y - 30, 112, 150)
      .setDepth(depth + 6)
      .setInteractive({ cursor: "pointer" });
    interaction.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.options.paused) return;
      this.activateReturnPortal();
    });
    this.returnPortal = { x, y, elapsed: 0, particleElapsed: 0, summary, glow, outerRing, innerRing, sigil, label, prompt, interaction };
    this.emitRadialVfx(x, y - 28, 24, 0xb77cff, 118, 0.65);
  }

  private updateReturnPortal(delta: number): void {
    const portal = this.returnPortal;
    if (!portal || !this.player || this.returnPortalUsed) return;
    portal.elapsed += delta;
    portal.particleElapsed += delta;
    const pulse = Math.sin(portal.elapsed * 3.6);
    portal.glow.setScale(1 + pulse * 0.08).setAlpha(0.2 + pulse * 0.06);
    portal.outerRing.setScale(1 + pulse * 0.025, 1 - pulse * 0.018);
    portal.innerRing.setScale(1 - pulse * 0.035, 1 + pulse * 0.025).setAlpha(0.82 + pulse * 0.12);
    portal.sigil.setRotation(portal.sigil.rotation + delta * 0.45).setAlpha(0.42 + pulse * 0.13);
    portal.label.setY(portal.y + 38 + pulse * 1.5);
    portal.prompt.setAlpha(0.72 + Math.max(0, pulse) * 0.28);
    if (portal.particleElapsed >= 0.09) {
      portal.particleElapsed = 0;
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      this.emitVfxParticle(
        portal.x + Math.cos(angle) * Phaser.Math.Between(24, 40),
        portal.y - 38 + Math.sin(angle) * Phaser.Math.Between(38, 58),
        Math.random() > 0.3 ? 0xb77cff : 0xe0b3ff,
        Phaser.Math.Between(-12, 12),
        Phaser.Math.Between(-42, -12),
        0.55,
        0.75,
        0.05,
        Math.random() > 0.5 ? "vfx-spark" : "vfx-ember",
      );
    }
    if (Math.hypot(this.player.x - portal.x, this.player.y - portal.y) <= ARENA_RULES.returnPortal.triggerRadius) {
      this.activateReturnPortal();
    }
  }

  private activateReturnPortal(): void {
    if (this.options.paused || !this.returnPortal || this.returnPortalUsed) return;
    if (this.completionChest && !this.completionChest.opened) {
      this.completionChest.prompt.setAlpha(1);
      this.returnPortal.prompt.setText("OPEN VICTORY CACHE FIRST");
      return;
    }
    this.returnPortalUsed = true;
    this.returnPortal.interaction.disableInteractive();
    this.options.onArenaComplete(this.returnPortal.summary);
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
      roundPixels: false,
      render: { antialias: false, pixelArt: true, roundPixels: false, powerPreference: "high-performance" },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene,
      fps: { target: 60, smoothStep: true },
      banner: false,
    });
  }

  useSkill(skill: "basic" | "nova" | "dash" | "ward" | "flameWave"): void {
    this.scene?.useSkill(skill);
  }

  dropInventoryItem(item: InventoryItem): boolean {
    return this.scene?.dropInventoryItem(item) ?? false;
  }

  useFlask(slotIndex: number): void {
    this.scene?.useFlask(slotIndex);
  }

  updateFlaskBelt(flaskBelt: FlaskBelt): void {
    this.scene?.updateFlaskBelt(flaskBelt);
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
