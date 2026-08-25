import Phaser from "phaser";
import { resolveAttackTimeSeconds, resolveCastTimeSeconds } from "../game/action-timing";
import { ACTIVE_SKILLS, BASIC_ATTACK, type RolledHitDamage } from "../game/combat";
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
import { MERCHANTS } from "../game/config/merchants";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "../game/config/monsters";
import { MAP_COMPLETION_REWARDS } from "../game/config/rewards";
import type { SkillDefinition } from "../game/config/schema";
import { ACTIVE_SKILL_IDS, type ActiveSkillId, type CharacterClassId, type FlaskBelt, type InventoryItem, type MonsterRarity, type SkillBarSkillId, type SkillLevels, type SkillLoadout } from "../game/domain";
import { isCurrencyItem, isEquipmentItem, isFlaskItem, isMapItem } from "../game/inventory";
import { equipmentDropPresentation } from "../game/loot";
import { resolveSkillDefinition, type ResolvedSkillDefinition } from "../game/skills";
import { CharacterAnimator } from "./CharacterAnimator";
import { isWorldPointerOrigin, resolveAimVector, type AimVector } from "./input-boundary";
import { GameAudio } from "./audio/GameAudio";
import { MonsterAudioMixer } from "./audio/MonsterAudioMixer";
import type { NetworkGroundDropView, WorldHudState, WorldRuntimeOptions, WorldStation } from "./types";
import { MULTIPLAYER_LIMITS, type CombatEvent } from "../../multiplayer/protocol";
import { MULTIPLAYER_COMBAT } from "../../multiplayer/combat";
import { MonsterFlags } from "../../multiplayer/wire/monster-flags";
import { NetworkEntityInterpolator } from "./NetworkEntityInterpolator";
import { isRestingMovementError, LocalMovementPrediction } from "./LocalMovementPrediction";

const VIEW_SIZE = 960;
const MAP_SIZE = VIEW_SIZE * 4;
const FIXED_STEP = 1000 / 60;
const MAX_FRAME_DELTA = 50;
const PROJECTILE_POOL_SIZE = MULTIPLAYER_COMBAT.projectile.maximumRenderedPerClient;
const ENEMY_PROJECTILE_POOL_SIZE = 240;
const DAMAGE_NUMBER_POOL_SIZE = 160;
const VFX_PARTICLE_POOL_SIZE = 240;
const HEALTH_BAR_WIDTH = 42;
const HEALTH_BAR_HEIGHT = 5;
const BASIC_ATTACK_INPUT_BUFFER_SECONDS = 0.22;
const MAX_DAMAGE_PRESENTATIONS_PER_BATCH = 12;
const MAX_PROJECTILE_HIT_PRESENTATIONS_PER_BATCH = 12;
const AUTO_PICKUP_INTERVAL_SECONDS = 0.15;
const EXPECTED_INPUT_PIPELINE_SECONDS = 1 / MULTIPLAYER_LIMITS.simulationHz;
const PREDICTED_DASH_TIMEOUT_SECONDS = 1;
const NETWORK_ARCHETYPE_IDS = ["ashling", "cinder-spitter", "rift-stalker", "ironhide-brute", "ember-skitter"] as const;

interface EnemyState {
  networkId?: number;
  networkSeenFrame?: number;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  renderX?: number;
  renderY?: number;
  life: number;
  maxLife: number;
  archetypeId: MonsterArchetypeId;
  rarity: MonsterRarity;
  baseScale: number;
  phase: number;
  animationTime: number;
  moving: boolean;
  healthLabel: Phaser.GameObjects.Text | null;
}

interface MonsterDeathPresentation {
  archetypeId: MonsterArchetypeId;
  rarity: MonsterRarity;
  x: number;
  y: number;
  baseScale: number;
  flipX: boolean;
}

interface NetworkEnemyProjectile {
  sprite: Phaser.GameObjects.Image;
  monsterId: number;
  archetypeId: MonsterArchetypeId;
  rarity: MonsterRarity;
}

interface PredictedProjectile {
  sprite: Phaser.GameObjects.Image;
  originX: number;
  originY: number;
  direction: AimVector;
  range: number;
  speed: number;
}

interface GroundDropState {
  networkId: string;
  networkPickupRetryAt?: number;
  networkPickupSuppressedAtRevision?: number;
  networkPickupWasInRange?: boolean;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  x: number;
  y: number;
  phase: number;
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
}

interface RemotePlayerVisual {
  classId: CharacterClassId;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  animator: CharacterAnimator;
  motion: NetworkEntityInterpolator;
}

type MonsterActionEvent = Extract<CombatEvent, { kind: "monster-action" }>;

interface NetworkMonsterActionVisual extends MonsterActionEvent {
  elapsedMilliseconds: number;
}

interface BasicAttackIntent {
  worldX: number;
  worldY: number;
  expiresAt: number;
}

const CLASS_COLORS: Record<CharacterClassId, { magic: number }> = {
  amazon: { magic: 0xf6c76f },
  barbarian: { magic: 0xff7345 },
  sorceress: { magic: 0xb77cff },
};

class ForgeOfEchoesScene extends Phaser.Scene {
  private readonly options: WorldRuntimeOptions;
  private readonly audio = new GameAudio();
  private readonly monsterAudio = new MonsterAudioMixer(this.audio);
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
  private groundDrops: GroundDropState[] = [];
  private readonly groundDropsByNetworkId = new Map<string, GroundDropState>();
  private lastNetworkDrops: readonly NetworkGroundDropView[] | null = null;
  private corpses: CorpseState[] = [];
  private enemyPool: Phaser.GameObjects.Group | null = null;
  private projectilePool: Phaser.GameObjects.Group | null = null;
  private readonly networkProjectiles = new Map<number, Phaser.GameObjects.Image>();
  private readonly predictedBasicProjectiles = new Map<number, PredictedProjectile>();
  private enemyProjectilePool: Phaser.GameObjects.Group | null = null;
  private readonly networkEnemyProjectiles = new Map<number, NetworkEnemyProjectile>();
  private readonly processedMonsterDeaths = new Set<number>();
  private dropPool: Phaser.GameObjects.Group | null = null;
  private corpsePool: Phaser.GameObjects.Group | null = null;
  private enemyHealthBars: Phaser.GameObjects.Graphics | null = null;
  private healthLabelPool: Phaser.GameObjects.Text[] = [];
  private damageNumberPool: Phaser.GameObjects.Text[] = [];
  private vfxPool: Phaser.GameObjects.Group | null = null;
  private vfxParticles: VfxParticleState[] = [];
  private accumulator = 0;
  private worldPointerHeld = false;
  private activeSkillInputHeld = false;
  private attackCooldown = 0;
  private basicAttackIntent: BasicAttackIntent | null = null;
  /** Remaining cooldown seconds keyed by active skill. */
  private skillCooldowns: Record<ActiveSkillId, number> = createEmptySkillCooldowns();
  /** Charge pools for dash-family mobility skills. */
  private chargePools = new Map<ActiveSkillId, SkillChargePool>();
  private wardRemaining = 0;
  private resolvedBasic: ResolvedSkillDefinition;
  private resolvedSkills: Record<ActiveSkillId, ResolvedSkillDefinition>;
  private life: number;
  private focus: number;
  private elapsedSeconds = 0;
  private nextAutoPickupAt = 0;
  private hudElapsed = 0;
  private completionObjectsSpawned = false;
  private returnPortal: ReturnPortalState | null = null;
  private returnPortalUsed = false;
  private completionChest: CompletionChestState | null = null;
  private returnToHideoutRequested = false;
  private previousPlayerX = 0;
  private previousPlayerY = 0;
  private playerVelocityX = 0;
  private playerVelocityY = 0;
  private readonly remotePlayers = new Map<string, RemotePlayerVisual>();
  private readonly networkMonsterActions = new Map<number, NetworkMonsterActionVisual>();
  private readonly networkEnemies = new Map<number, EnemyState>();
  private networkMonsterFrame = 0;
  private networkMonsterDelta = 0;
  private readonly consumeNetworkMonsterSample = (
    id: number,
    archetype: number,
    rarity: number,
    maxLife: number,
    x: number,
    y: number,
    lifePercent: number,
    flags: number,
  ): void => {
    this.syncNetworkMonster(id, archetype, rarity, maxLife, x, y, lifePercent, flags, this.networkMonsterDelta);
  };
  private networkInputElapsed = 0;
  private lastNetworkInputX = Number.NaN;
  private lastNetworkInputY = Number.NaN;
  private networkPredictionReady = false;
  private lastAuthorityX = Number.NaN;
  private lastAuthorityY = Number.NaN;
  private lastAuthoritySequence = -1;
  private lastAuthorityAttackSequence = -1;
  private networkCorrectionX = 0;
  private networkCorrectionY = 0;
  private readonly localMovementPrediction = new LocalMovementPrediction();
  private predictedDashSequence: number | null = null;
  private predictedDashExpiresAt = 0;
  private hideoutPortalObjects: Phaser.GameObjects.GameObject[] = [];

  constructor(options: WorldRuntimeOptions) {
    super("forge-of-echoes-world");
    this.options = options;
    const cooldownMultiplier = options.arenaBalance?.skillCooldown ?? 1;
    const castSpeedMultiplier = options.arenaBalance?.castSpeed ?? 1;
    this.resolvedBasic = resolveSkillDefinition(BASIC_ATTACK, 1);
    this.resolvedSkills = resolveAllSkills(options.skillLevels, cooldownMultiplier, castSpeedMultiplier);
    this.chargePools = createChargePools(this.resolvedSkills);
    this.life = options.arenaBalance?.maxLife ?? 100;
    this.focus = options.arenaBalance?.maxFocus ?? 100;
  }

  preload(): void {
    this.load.image("pixel-forge", "/pixel-forge-hideout.webp");
    this.load.image("ashen-wilderness", "/pixel-ashen-wilderness.webp");
    this.load.image("ember-sigil", "/ember-sigil.png");
    this.load.image("player-sorceress-rendered", "/player-sorceress-v4.png");
    if (this.options.mode === "arena") {
      for (const definition of Object.values(MONSTER_ARCHETYPES)) {
        const sheet = definition.visual.sheet;
        if (sheet) {
          this.load.spritesheet(`monster-${definition.id}`, sheet.url, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
        } else {
          this.load.image(`monster-${definition.id}`, definition.visual.sprite);
        }
        this.load.image(`corpse-${definition.id}`, definition.visual.corpse);
      }
      this.monsterAudio.preload();
    }
    if (this.options.mode !== "loading" && this.options.mode !== "login" && this.options.mode !== "character-create") {
      const classes = Object.keys(CHARACTER_ANIMATIONS) as CharacterClassId[];
      for (const classId of classes) {
        const definition = CHARACTER_ANIMATIONS[classId];
        for (const [sheetId, sheet] of Object.entries(definition.sheets)) {
          if (!sheet) continue;
          this.load.spritesheet(characterSpriteSheetKey(classId, sheetId as CharacterSpriteSheetId), sheet.url, {
            frameWidth: sheet.frameWidth,
            frameHeight: sheet.frameHeight,
          });
        }
      }
    }
  }

  create(): void {
    this.createTextures();
    const worldSize = this.options.mode === "arena" ? MAP_SIZE : VIEW_SIZE;
    const backgroundKey = this.options.mode === "arena" ? "ashen-wilderness" : "pixel-forge";
    const background = this.add.image(worldSize / 2, worldSize / 2, backgroundKey).setDisplaySize(worldSize, worldSize);
    if (this.options.mode === "login") {
      background.setTint(0x9d765f);
      this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE, VIEW_SIZE, 0x080605, 0.64);
      this.buildLoginBackdrop();
      return;
    }
    if (this.options.mode === "character-create") {
      background.setTint(0x8d7068);
      this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE, VIEW_SIZE, 0x090608, 0.62);
      this.buildCharacterCreationShowcase();
      return;
    }
    if (this.options.mode === "loading") {
      background.setTint(0x8d7068);
      this.add.rectangle(VIEW_SIZE / 2, VIEW_SIZE / 2, VIEW_SIZE, VIEW_SIZE, 0x07090b, 0.62);
      this.buildLoginBackdrop();
      return;
    }

    if (!this.options.multiplayer) {
      throw new Error(`${this.options.mode} requires a server-backed multiplayer adapter`);
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
      skillSlot0: Phaser.Input.Keyboard.KeyCodes.SPACE,
      skillSlot1: Phaser.Input.Keyboard.KeyCodes.Q,
      skillSlot2: Phaser.Input.Keyboard.KeyCodes.E,
      skillSlot3: Phaser.Input.Keyboard.KeyCodes.R,
      skillSlot4: Phaser.Input.Keyboard.KeyCodes.F,
      flask1: Phaser.Input.Keyboard.KeyCodes.ONE,
      flask2: Phaser.Input.Keyboard.KeyCodes.TWO,
      flask3: Phaser.Input.Keyboard.KeyCodes.THREE,
      flask4: Phaser.Input.Keyboard.KeyCodes.FOUR,
      flask5: Phaser.Input.Keyboard.KeyCodes.FIVE,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    for (let index = 0; index < this.options.skillLoadout.length; index += 1) {
      this.keys[`skillSlot${index}`]?.on(Phaser.Input.Keyboard.Events.DOWN, () => {
        // Start an explicitly pressed skill in the keyboard event itself. The
        // per-frame held-state path below remains responsible for retrying it
        // as soon as cooldown, focus, charges, or another skill lock permits.
        this.activateSkillSlot(index);
      });
    }
    for (let index = 0; index < this.options.flaskBelt.length; index += 1) {
      this.keys[`flask${index + 1}`]?.on(Phaser.Input.Keyboard.Events.DOWN, () => {
        // Flask hotkeys must be handled at the keyboard event boundary. Polling
        // JustDown during update can miss a complete press between render
        // frames (for example during a busy combat frame or tab refocus).
        this.useFlask(index);
      });
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer, interactiveTargets: Phaser.GameObjects.GameObject[]) => {
      this.worldPointerHeld = isWorldPointerOrigin(pointer.event?.target ?? null, this.game.canvas, interactiveTargets.length);
      if (this.worldPointerHeld && this.options.mode === "arena" && !this.options.paused && !this.options.controlsBlocked) {
        // Pointer and keyboard input are resolved together at the start of the
        // next scene update. Starting the basic attack here gave mouse input a
        // head start over a skill key pressed during the same browser frame.
        this.queueBasicAttack(false);
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => { this.worldPointerHeld = false; });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.playerAnimator?.destroy();
      for (const remote of this.remotePlayers.values()) remote.animator.destroy();
      this.remotePlayers.clear();
      this.networkMonsterActions.clear();
      this.audio.dispose();
    });
  }

  update(_time: number, delta: number): void {
    if (!this.player || this.options.paused) {
      this.accumulator = 0;
      return;
    }
    this.activeSkillInputHeld = this.consumeHeldSkillKeys();
    this.accumulator += Math.min(delta, MAX_FRAME_DELTA);
    while (this.accumulator >= FIXED_STEP) {
      this.previousPlayerX = this.player.x;
      this.previousPlayerY = this.player.y;
      this.fixedUpdate(FIXED_STEP / 1000);
      this.accumulator -= FIXED_STEP;
    }
    this.renderPlayer(this.accumulator / FIXED_STEP);
  }

  /**
   * Active skills intentionally use held state instead of edge-triggered
   * JustDown input. An unavailable skill is retried every frame and therefore
   * fires on the first frame where its cooldown, resources, charges, and
   * animation lock all permit it. The authoritative server still validates
   * every resulting command.
   */
  private consumeHeldSkillKeys(): boolean {
    if (this.options.controlsBlocked || !this.keys) return false;
    const heldSkills = this.options.skillLoadout.flatMap((skill, index) => {
      const key = this.keys?.[`skillSlot${index}`];
      return skill && key?.isDown ? [{ skill, key }] : [];
    });
    if (heldSkills.length === 0) return false;

    // A newly pressed key wins over another key that is merely being held.
    // This makes an explicit F/Q/E/R press deterministic even under extreme
    // attack speed, without sending more than one skill command per frame.
    const selected = heldSkills.find(({ key }) => Phaser.Input.Keyboard.JustDown(key)) ?? heldSkills[0];
    if (selected.skill !== "basic") {
      this.basicAttackIntent = null;
      if (this.playerAnimator?.activeActionState === "attack") this.playerAnimator.cancelAction();
    }
    this.useSkill(selected.skill);
    return true;
  }

  private activateSkillSlot(index: number): void {
    if (this.options.controlsBlocked) return;
    const skill = this.options.skillLoadout[index];
    if (!skill) return;
    if (skill !== "basic") {
      this.basicAttackIntent = null;
      if (this.playerAnimator?.activeActionState === "attack") this.playerAnimator.cancelAction();
    }
    this.useSkill(skill);
  }

  useSkill(skill: SkillBarSkillId): void {
    if (this.options.mode !== "arena" || !this.player || this.options.paused || this.options.controlsBlocked) return;
    if (skill === "basic") {
      this.queueBasicAttack(true);
      return;
    }
    const definition = this.resolvedSkills[skill];
    if (!definition || definition.level < 1) return;
    if (this.skillCooldowns[skill] > 0 || this.focus < definition.focusCost) return;

    const pointer = this.input.activePointer;
    const dx = pointer.worldX - this.player.x;
    const dy = pointer.worldY - this.player.y;
    const length = Math.hypot(dx, dy) || 1;
    const direction = resolveCharacterDirection(dx, dy, this.playerAnimator?.currentDirection);

    const chargePool = this.chargePools.get(skill);
    if (chargePool) {
      if (chargePool.charges <= 0) return;
      const startX = this.player.x;
      const startY = this.player.y;
      const started = this.beginActiveSkillAction(definition, direction, () => {
        const dashDirection = { x: dx / length, y: dy / length };
        const sequence = this.options.multiplayer?.sendAttack?.(skill, dashDirection);
        // Only the equipped dash keeps its established local prediction path.
        if (sequence !== undefined && skill === "dash") this.applyPredictedDash(sequence, dashDirection);
      }, startX, startY);
      if (!started) return;
      this.focus -= definition.focusCost;
      chargePool.charges -= 1;
      if (chargePool.rechargeTimer <= 0) chargePool.rechargeTimer = definition.recharge;
      return;
    }

    if (definition.recoveryAmount > 0 || definition.damageReduction > 0) {
      // Ward and recovery-kind skills are server-applied states; locally they
      // only drive presentation and the shared cooldown clock.
      const maxLife = this.options.arenaBalance?.maxLife ?? 100;
      if (definition.recoveryAmount > 0 && this.life >= maxLife) return;
      const started = this.beginActiveSkillAction(definition, direction, () => {
        if (definition.damageReduction > 0) this.wardRemaining = definition.duration;
        this.options.multiplayer?.sendAttack?.(skill);
      });
      if (!started) return;
      this.focus -= definition.focusCost;
      this.skillCooldowns[skill] = definition.cooldown;
      return;
    }

    const started = this.beginActiveSkillAction(definition, direction, () => {
      const angle = Math.atan2(pointer.worldY - this.player!.y, pointer.worldX - this.player!.x);
      this.options.multiplayer?.sendAttack?.(skill, { x: Math.cos(angle), y: Math.sin(angle) });
    });
    if (!started) return;
    this.focus -= definition.focusCost;
    this.skillCooldowns[skill] = definition.cooldown;
  }

  useFlask(slotIndex: number): void {
    if (this.options.mode !== "arena" || !this.player || this.options.paused || this.options.controlsBlocked) return;
    const flask = this.options.flaskBelt[slotIndex];
    if (!flask || flask.stackSize <= 0) return;
    const configured = FLASK_DEFINITIONS[flask.baseId];
    const maxLife = this.options.arenaBalance?.maxLife ?? 100;
    const maxMana = this.options.arenaBalance?.maxFocus ?? 100;
    if (configured.resource === "life" && this.life >= maxLife) return;
    if (configured.resource === "mana" && this.focus >= maxMana) return;
    this.options.multiplayer?.sendUseFlask?.(slotIndex);
    this.playFlaskVfx(configured);
  }

  getHud(): WorldHudState {
    const networkMap = this.options.multiplayer?.getMap?.();
    const networkPlayer = this.options.multiplayer
      ?.getPlayers().find((player) => player.characterId === this.options.multiplayer?.localCharacterId);
    const finalWave = networkMap?.totalWaves ?? this.options.arenaBalance?.waves ?? ARENA_RULES.totalWaves;
    return {
      fps: Math.round(this.game?.loop?.actualFps || 0),
      ping: this.options.multiplayer?.getPing() ?? null,
      mode: this.options.mode,
      wave: networkMap?.wave ?? 1,
      enemies: networkMap?.monstersAlive ?? 0,
      nextWaveIn: (networkMap?.wave ?? finalWave) < finalWave
        ? Math.max(0, ARENA_RULES.waveSpawnIntervalSeconds - (networkMap?.waveElapsedMilliseconds ?? 0) / 1000)
        : null,
      finalRageIn: networkMap?.wave === finalWave && networkMap.finalRageActive === false && networkMap.completed === false
        ? Math.max(0, ARENA_RULES.finalWaveRageDelaySeconds - (networkMap.waveElapsedMilliseconds ?? 0) / 1000)
        : null,
      finalRageActive: networkMap?.finalRageActive ?? false,
      life: Math.max(0, networkPlayer?.life ?? this.life),
      maxLife: networkPlayer?.maxLife ?? this.options.arenaBalance?.maxLife ?? 100,
      focus: networkPlayer?.focus ?? this.focus,
      maxFocus: networkPlayer?.maxFocus ?? this.options.arenaBalance?.maxFocus ?? 100,
      pendingExperience: Math.max(0, (networkPlayer?.experience ?? 0) - (networkPlayer?.persistedExperience ?? 0)),
      groundDrops: this.groundDrops.length,
      skillCooldowns: { ...this.skillCooldowns },
      wardRemaining: this.wardRemaining,
      charges: Object.fromEntries([...this.chargePools].map(([id, pool]) => [id, pool.charges])) as WorldHudState["charges"],
      maxCharges: Object.fromEntries([...this.chargePools].map(([id]) => [id, this.resolvedSkills[id].maxCharges])) as WorldHudState["maxCharges"],
      rechargeTimers: Object.fromEntries([...this.chargePools].map(([id, pool]) => [id, pool.rechargeTimer])) as WorldHudState["rechargeTimers"],
      arenaComplete: networkMap?.completed ?? false,
    };
  }

  updateArenaBalance(balance: NonNullable<WorldRuntimeOptions["arenaBalance"]>): void {
    const previousMaxLife = this.options.arenaBalance?.maxLife ?? balance.maxLife;
    const previousMaxFocus = this.options.arenaBalance?.maxFocus ?? balance.maxFocus;
    this.life = Phaser.Math.Clamp(this.life * (balance.maxLife / previousMaxLife), 1, balance.maxLife);
    this.focus = Phaser.Math.Clamp(this.focus * (balance.maxFocus / previousMaxFocus), 0, balance.maxFocus);
    this.options.arenaBalance = balance;
    this.updateSkillLevels(this.options.skillLevels);
  }

  updateAudioVolume(volume: number): void {
    this.audio.setMasterVolume(volume);
  }

  updateSkillLevels(skillLevels: SkillLevels): void {
    const cooldownMultiplier = this.options.arenaBalance?.skillCooldown ?? 1;
    const castSpeedMultiplier = this.options.arenaBalance?.castSpeed ?? 1;
    const previousResolved = this.resolvedSkills;
    this.resolvedSkills = resolveAllSkills(skillLevels, cooldownMultiplier, castSpeedMultiplier);
    for (const [skillId, pool] of this.chargePools) {
      const newMax = this.resolvedSkills[skillId].maxCharges;
      pool.charges = Phaser.Math.Clamp(pool.charges + Math.max(0, newMax - previousResolved[skillId].maxCharges), 0, newMax);
      if (pool.charges === newMax) pool.rechargeTimer = 0;
    }
    for (const skillId of ACTIVE_SKILL_IDS) {
      if (this.resolvedSkills[skillId].maxCharges > 0 && !this.chargePools.has(skillId)) {
        this.chargePools.set(skillId, { charges: this.resolvedSkills[skillId].maxCharges, rechargeTimer: 0 });
      }
    }
    this.options.skillLevels = skillLevels;
    this.options.onHud(this.getHud());
  }

  updateSkillLoadout(skillLoadout: SkillLoadout): void {
    this.options.skillLoadout = [...skillLoadout];
  }

  updateFlaskBelt(flaskBelt: FlaskBelt): void {
    this.options.flaskBelt = flaskBelt;
  }

  private fixedUpdate(delta: number): void {
    if (!this.player) return;
    this.elapsedSeconds += delta;
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    for (const skillId of ACTIVE_SKILL_IDS) {
      this.skillCooldowns[skillId] = Math.max(0, this.skillCooldowns[skillId] - delta);
    }
    this.wardRemaining = Math.max(0, this.wardRemaining - delta);
    for (const [skillId, pool] of this.chargePools) {
      const maxCharges = this.resolvedSkills[skillId].maxCharges;
      if (pool.charges >= maxCharges) continue;
      pool.rechargeTimer = Math.max(0, pool.rechargeTimer - delta);
      if (pool.rechargeTimer <= 0) {
        pool.charges += 1;
        pool.rechargeTimer = pool.charges < maxCharges ? this.resolvedSkills[skillId].recharge : 0;
      }
    }
    let xInput = 0;
    let yInput = 0;
    if (this.keys && !this.options.controlsBlocked) {
      xInput = Number(this.keys.right.isDown || this.keys.rightAlt.isDown) - Number(this.keys.left.isDown || this.keys.leftAlt.isDown);
      yInput = Number(this.keys.down.isDown || this.keys.downAlt.isDown) - Number(this.keys.up.isDown || this.keys.upAlt.isDown);
    }
    const inputLength = Math.hypot(xInput, yInput) || 1;
    const speed = (this.options.arenaBalance?.moveSpeed ?? 5.6) * 34;
    const hasInput = Boolean(xInput || yInput);
    this.updateNetworkPlayers(delta, hasInput ? xInput / inputLength : 0, hasInput ? yInput / inputLength : 0);

    // The local character's locomotion represents player intent. Network
    // reconciliation can move the render sprite in either direction, but that
    // corrective displacement must not make a released key play a run cycle or
    // flip the character to face the opposite way.
    const measuredMovementSpeed = Math.hypot(this.playerVelocityX, this.playerVelocityY);
    const movementSpeed = this.options.multiplayer ? (hasInput ? speed : 0) : measuredMovementSpeed;
    const isMoving = this.options.multiplayer ? hasInput : movementSpeed > 2;
    const directionX = this.options.multiplayer ? xInput / inputLength : (isMoving ? this.playerVelocityX / movementSpeed : xInput / inputLength);
    const directionY = this.options.multiplayer ? yInput / inputLength : (isMoving ? this.playerVelocityY / movementSpeed : yInput / inputLength);
    this.playerAnimator?.setLocomotion(directionX, directionY, isMoving, speed > 0 ? movementSpeed / speed : 0);

    if (this.options.mode === "arena") {
      this.monsterAudio.setListener(this.player.x, this.player.y);
      if (this.options.controlsBlocked) {
        this.basicAttackIntent = null;
      } else {
        if (this.activeSkillInputHeld) {
          // A held explicit hotkey owns this frame. Do not continuously rebuild
          // a mouse intent behind it and steal the animator as soon as it opens.
          this.basicAttackIntent = null;
        } else {
          if (this.worldPointerHeld) this.queueBasicAttack(false);
          this.consumeBasicAttackIntent();
        }
      }
      this.syncNetworkMonsters(delta);
      this.syncNetworkCombatEvents();
      this.syncNetworkDrops();
      this.updateCompletionChest(delta);
      this.updateReturnPortal(delta);
      this.updateEnemyAnimations(delta);
      this.updateVfxParticles(delta);
      this.updateCorpses(delta);
      this.renderEnemyHealth();
    }
    this.syncPickupResults();
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

  private buildLoginBackdrop(): void {
    const rings = this.add.graphics().setDepth(8);
    rings.lineStyle(2, 0xb85d2d, 0.18).strokeCircle(480, 452, 176);
    rings.lineStyle(1, 0xe6984f, 0.14).strokeCircle(480, 452, 214);
    rings.lineStyle(1, 0x8f4628, 0.13).strokeCircle(480, 452, 260);
    const outerSigil = this.add.image(480, 452, "ember-sigil")
      .setDisplaySize(330, 330)
      .setAlpha(0.18)
      .setTint(0xdb7137)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(9);
    const innerSigil = this.add.image(480, 452, "ember-sigil")
      .setDisplaySize(208, 208)
      .setAlpha(0.24)
      .setTint(0xffb25e)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(10);
    this.tweens.add({ targets: outerSigil, angle: 360, duration: 48_000, repeat: -1, ease: "Linear" });
    this.tweens.add({ targets: innerSigil, angle: -360, alpha: 0.38, duration: 31_000, yoyo: true, repeat: -1, ease: "Sine.InOut" });

    const emberPositions = [
      [178, 182], [254, 706], [344, 264], [408, 755], [552, 190], [621, 688], [732, 276], [801, 624],
    ] as const;
    emberPositions.forEach(([x, y], index) => {
      const ember = this.add.rectangle(x, y, index % 3 === 0 ? 4 : 3, index % 2 === 0 ? 4 : 6, index % 2 === 0 ? 0xffa24f : 0xbd4c25, 0.42).setDepth(11);
      this.tweens.add({
        targets: ember,
        y: y - 34 - (index % 3) * 12,
        x: x + (index % 2 === 0 ? 8 : -8),
        alpha: 0.08,
        duration: 1_900 + index * 170,
        delay: index * 120,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    });
  }

  private buildCharacterCreationShowcase(): void {
    const x = 666;
    const y = 530;
    const glow = this.add.image(x, y - 42, "player-aura")
      .setDisplaySize(430, 560)
      .setTint(CLASS_COLORS.sorceress.magic)
      .setAlpha(0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(8);
    const sigil = this.add.image(x, y - 15, "ember-sigil")
      .setDisplaySize(410, 410)
      .setTint(0xa968e8)
      .setAlpha(0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(9);
    const shadow = this.add.ellipse(x, y + 190, 260, 54, 0x050305, 0.86).setDepth(10);
    const sorceress = this.add.image(x, y, "player-sorceress-rendered")
      .setDisplaySize(294, 408)
      .setDepth(12);
    this.tweens.add({ targets: sigil, angle: 360, duration: 42_000, repeat: -1, ease: "Linear" });
    this.tweens.add({ targets: glow, alpha: 0.34, scaleX: 1.04, scaleY: 1.025, duration: 1_800, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.tweens.add({ targets: [sorceress, shadow], y: "-=5", duration: 1_700, yoyo: true, repeat: -1, ease: "Sine.InOut" });

    const embers = [[550, 360], [590, 670], [704, 294], [754, 626], [818, 422]] as const;
    embers.forEach(([emberX, emberY], index) => {
      const ember = this.add.rectangle(emberX, emberY, 3, index % 2 ? 6 : 4, index % 2 ? 0xa866e8 : 0xff8a45, 0.5).setDepth(13);
      this.tweens.add({ targets: ember, y: emberY - 55, x: emberX + (index % 2 ? -9 : 9), alpha: 0.06, duration: 1_500 + index * 210, yoyo: true, repeat: -1, ease: "Sine.InOut" });
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

  private updateNetworkPlayers(delta: number, inputX: number, inputY: number): void {
    const multiplayer = this.options.multiplayer;
    if (!multiplayer || !this.player) return;
    this.networkInputElapsed += delta;
    const inputChanged = inputX !== this.lastNetworkInputX || inputY !== this.lastNetworkInputY;
    if (inputChanged || this.networkInputElapsed >= 0.08) {
      const sequence = multiplayer.sendMovement(inputX, inputY);
      if (sequence !== undefined) {
        this.localMovementPrediction.record({
          sequence,
          x: inputX,
          y: inputY,
          // fixedUpdate advances the clock before applying this frame, while
          // the input state applies from the beginning of the frame.
          sentAtSeconds: Math.max(0, this.elapsedSeconds - delta),
        });
      }
      this.lastNetworkInputX = inputX;
      this.lastNetworkInputY = inputY;
      this.networkInputElapsed = 0;
    }
    const players = multiplayer.getPlayers();
    const local = players.find((player) => player.characterId === multiplayer.localCharacterId);
    if (local) {
      const previousX = this.player.x;
      const previousY = this.player.y;
      const worldSize = this.options.mode === "arena" ? MAP_SIZE : VIEW_SIZE;
      const margin = this.options.mode === "arena" ? 18 : MULTIPLAYER_LIMITS.world.margin;
      const movementSpeed = (this.options.arenaBalance?.moveSpeed ?? 5.6) * 34;
      if (!this.networkPredictionReady) {
        this.player.setPosition(local.x, local.y);
        this.networkPredictionReady = true;
      } else {
        // Predict the locally controlled character at the render clock. Waiting
        // for 20 Hz schema patches is what produced the visible fast/slow pulse.
        this.player.x = Phaser.Math.Clamp(this.player.x + inputX * movementSpeed * delta, margin, worldSize - margin);
        this.player.y = Phaser.Math.Clamp(this.player.y + inputY * movementSpeed * delta, margin, worldSize - margin);
      }
      const dashAwaitingAuthority = this.predictedDashSequence !== null
        && (local.lastProcessedAttack ?? -1) < this.predictedDashSequence
        && this.elapsedSeconds < this.predictedDashExpiresAt;
      const dashPredictionResolved = this.predictedDashSequence !== null && !dashAwaitingAuthority;
      if (dashPredictionResolved) this.predictedDashSequence = null;
      const authorityChanged = local.x !== this.lastAuthorityX
        || local.y !== this.lastAuthorityY
        || (local.lastProcessedMovement ?? -1) !== this.lastAuthoritySequence
        || (local.lastProcessedAttack ?? -1) !== this.lastAuthorityAttackSequence
        || dashPredictionResolved
        || inputChanged;
      if (authorityChanged) {
        // RTT/2 is only wire time. An input also waits for the next fixed tick
        // and its state patch, so the expected pipeline delay must be included
        // in the render target rather than leaving a permanent drag behind it.
        const oneWaySeconds = Phaser.Math.Clamp(
          (multiplayer.getPing() ?? 50) / 2_000 + EXPECTED_INPUT_PIPELINE_SECONDS,
          EXPECTED_INPUT_PIPELINE_SECONDS,
          0.2,
        );
        const target = this.localMovementPrediction.reconcile(
          { x: local.x, y: local.y, acknowledgedSequence: local.lastProcessedMovement ?? 0 },
          this.elapsedSeconds,
          oneWaySeconds,
          movementSpeed,
          { minimumX: margin, maximumX: worldSize - margin, minimumY: margin, maximumY: worldSize - margin },
        );
        const targetX = target.x;
        const targetY = target.y;
        const errorX = targetX - this.player.x;
        const errorY = targetY - this.player.y;
        if (dashAwaitingAuthority) {
          // The next patch may still describe the pre-dash position. Applying
          // it would visually pull the predicted dash backwards before the
          // server acknowledges the same combat sequence.
          this.networkCorrectionX = 0;
          this.networkCorrectionY = 0;
        } else if (Math.hypot(errorX, errorY) > 180) {
          // Teleports/dashes and major desyncs are authoritative discontinuities.
          this.player.setPosition(targetX, targetY);
          this.networkCorrectionX = 0;
          this.networkCorrectionY = 0;
        } else if (inputX === 0 && inputY === 0 && isRestingMovementError(
          errorX,
          errorY,
          movementSpeed,
          EXPECTED_INPUT_PIPELINE_SECONDS,
        )) {
          // A held-state command can begin/end on opposite sides of a 20 Hz
          // server tick. Preserve that sub-tick visual offset while idle; it is
          // reconciled unobtrusively when movement resumes. Paying it back now
          // makes the character appear to float backward after every key-up.
          this.networkCorrectionX = 0;
          this.networkCorrectionY = 0;
        } else {
          this.networkCorrectionX = errorX;
          this.networkCorrectionY = errorY;
        }
        this.lastAuthorityX = local.x;
        this.lastAuthorityY = local.y;
        this.lastAuthoritySequence = local.lastProcessedMovement ?? -1;
        this.lastAuthorityAttackSequence = local.lastProcessedAttack ?? -1;
      }
      const correctionBlend = 1 - Math.exp(-10 * delta);
      const correctionX = this.networkCorrectionX * correctionBlend;
      const correctionY = this.networkCorrectionY * correctionBlend;
      this.player.x = Phaser.Math.Clamp(this.player.x + correctionX, margin, worldSize - margin);
      this.player.y = Phaser.Math.Clamp(this.player.y + correctionY, margin, worldSize - margin);
      this.networkCorrectionX -= correctionX;
      this.networkCorrectionY -= correctionY;
      this.playerVelocityX = (this.player.x - previousX) / Math.max(delta, 0.001);
      this.playerVelocityY = (this.player.y - previousY) / Math.max(delta, 0.001);
      if (local.life !== undefined) this.life = local.life;
      if (local.focus !== undefined) this.focus = local.focus;
      if ((local.life ?? 1) <= 0 && !this.returnToHideoutRequested) {
        this.returnToHideoutRequested = true;
        this.options.onReturnToHideout();
      }
    } else {
      this.playerVelocityX = 0;
      this.playerVelocityY = 0;
    }

    const present = new Set<string>();
    for (const networkPlayer of players) {
      if (networkPlayer.characterId === multiplayer.localCharacterId || !networkPlayer.connected) continue;
      present.add(networkPlayer.characterId);
      let remote = this.remotePlayers.get(networkPlayer.characterId);
      if (!remote || remote.classId !== networkPlayer.classId) {
        if (remote) this.destroyRemotePlayer(remote);
        const sprite = this.add.sprite(networkPlayer.x, networkPlayer.y, characterDefaultSpriteSheetKey(networkPlayer.classId), 0).setDepth(10);
        remote = {
          classId: networkPlayer.classId,
          x: networkPlayer.x,
          y: networkPlayer.y,
          sprite,
          shadow: this.add.image(networkPlayer.x, networkPlayer.y + 25, "shadow").setScale(2.1, 1.45).setDepth(8),
          label: this.add.text(networkPlayer.x, networkPlayer.y - 112, networkPlayer.name, {
            fontFamily: "monospace", fontSize: "11px", color: "#f6d29a", backgroundColor: "#090806cc",
            padding: { x: 5, y: 2 },
          }).setOrigin(0.5).setDepth(600),
          animator: new CharacterAnimator(this, sprite, networkPlayer.classId),
          motion: new NetworkEntityInterpolator(),
        };
        this.remotePlayers.set(networkPlayer.characterId, remote);
      }
      remote.motion.push({
        tick: networkPlayer.serverTick ?? 0,
        x: networkPlayer.x,
        y: networkPlayer.y,
        facingX: networkPlayer.facingX,
        facingY: networkPlayer.facingY,
      }, performance.now());
      const previousX = remote.x;
      const previousY = remote.y;
      const sampled = remote.motion.sample(performance.now());
      remote.x = sampled?.x ?? networkPlayer.x;
      remote.y = sampled?.y ?? networkPlayer.y;
      const velocityX = (remote.x - previousX) / Math.max(delta, 0.001);
      const velocityY = (remote.y - previousY) / Math.max(delta, 0.001);
      const speed = Math.hypot(velocityX, velocityY);
      const moving = speed > 2;
      const directionX = moving ? velocityX / speed : sampled?.facingX ?? networkPlayer.facingX;
      const directionY = moving ? velocityY / speed : sampled?.facingY ?? networkPlayer.facingY;
      const depth = Math.round(remote.y / 10) + 11;
      remote.animator.setLocomotion(directionX, directionY, moving, Phaser.Math.Clamp(speed / 190, 0, 1));
      remote.animator.setWorldTransform(remote.x, remote.y, depth);
      remote.shadow.setPosition(remote.x, remote.y + 25).setDepth(depth - 2);
      remote.label.setPosition(remote.x, remote.y - 112).setDepth(depth + 90);
    }
    for (const [characterId, remote] of this.remotePlayers) {
      if (present.has(characterId)) continue;
      this.destroyRemotePlayer(remote);
      this.remotePlayers.delete(characterId);
    }
  }

  private applyPredictedDash(sequence: number, direction: AimVector): void {
    if (!this.player) return;
    const worldSize = this.options.mode === "arena" ? MAP_SIZE : VIEW_SIZE;
    const margin = this.options.mode === "arena" ? 18 : MULTIPLAYER_LIMITS.world.margin;
    this.player.setPosition(
      Phaser.Math.Clamp(this.player.x + direction.x * MULTIPLAYER_COMBAT.player.dashDistance, margin, worldSize - margin),
      Phaser.Math.Clamp(this.player.y + direction.y * MULTIPLAYER_COMBAT.player.dashDistance, margin, worldSize - margin),
    );
    this.networkCorrectionX = 0;
    this.networkCorrectionY = 0;
    this.predictedDashSequence = sequence;
    this.predictedDashExpiresAt = this.elapsedSeconds + PREDICTED_DASH_TIMEOUT_SECONDS;
  }

  private syncNetworkMonsters(delta: number): void {
    const state = this.options.multiplayer?.getMap?.();
    if (!state) return;
    if (state.completed && !this.completionObjectsSpawned) {
      this.completionObjectsSpawned = true;
      this.spawnNetworkCompletionObjects(state.completionX, state.completionY);
    }
    this.networkMonsterFrame += 1;
    this.networkMonsterDelta = delta;
    const sampler = this.options.multiplayer?.getMonsterSampler?.();
    sampler?.forEachSample(performance.now(), this.consumeNetworkMonsterSample);
    for (const [id, enemy] of this.networkEnemies) {
      if (enemy.networkSeenFrame === this.networkMonsterFrame) continue;
      this.releaseNetworkEnemy(enemy);
      this.networkEnemies.delete(id);
    }
  }

  private syncNetworkMonster(id: number, archetype: number, rarityCode: number, maxLife: number, x: number, y: number, lifePercent: number, flags: number, delta: number): void {
      const existing = this.networkEnemies.get(id);
      if (lifePercent <= 0) {
        if (existing) this.releaseNetworkEnemy(existing);
        return;
      }
      const archetypeId = NETWORK_ARCHETYPE_IDS[archetype];
      if (!archetypeId || !(archetypeId in MONSTER_ARCHETYPES)) return;
      const rarity: MonsterRarity = rarityCode === 2 ? "rare" : rarityCode === 1 ? "magic" : "normal";
      let enemy = existing;
      if (!enemy) {
        const sprite = this.enemyPool?.get(x, y, `monster-${archetypeId}`) as Phaser.GameObjects.Image | null;
        if (!sprite) return;
        const baseScale = this.enemyBaseScale(archetypeId, rarity);
        sprite.setTexture(`monster-${archetypeId}`).setOrigin(0.5, this.enemyOriginY(archetypeId)).clearTint();
        if (rarity === "magic") sprite.setTint(MONSTER_PACK_RULES.magicTint);
        if (rarity === "rare") sprite.setTint(MONSTER_PACK_RULES.rareTint);
        sprite.setActive(true).setVisible(true).setPosition(x, y).setScale(baseScale);
        enemy = {
          networkId: id,
          networkSeenFrame: this.networkMonsterFrame,
          sprite,
          x,
          y,
          renderX: x,
          renderY: y,
          life: maxLife * lifePercent,
          maxLife,
          archetypeId,
          rarity,
          baseScale,
          phase: Math.random() * Math.PI * 2,
          animationTime: Math.random() * 10,
          moving: false,
          healthLabel: null,
        };
        this.enemies.push(enemy);
        this.networkEnemies.set(id, enemy);
      }
      enemy.networkSeenFrame = this.networkMonsterFrame;
      enemy.phase += delta * 5;
      const blend = 1 - Math.exp(-14 * delta);
      enemy.moving = Boolean(flags & MonsterFlags.Moved);
      enemy.x = x;
      enemy.y = y;
      enemy.life = maxLife * lifePercent;
      enemy.maxLife = maxLife;
      const action = this.networkMonsterActions.get(id);
      let lift = 0;
      let rotation = 0;
      if (action?.action === "jump") {
        action.elapsedMilliseconds = Math.min(action.durationMilliseconds, action.elapsedMilliseconds + delta * 1000);
        const progress = action.durationMilliseconds > 0 ? action.elapsedMilliseconds / action.durationMilliseconds : 1;
        const easedProgress = 1 - (1 - progress) ** 3;
        enemy.renderX = Phaser.Math.Linear(action.fromX, action.toX, easedProgress);
        enemy.renderY = Phaser.Math.Linear(action.fromY, action.toY, easedProgress);
        lift = Math.sin(progress * Math.PI) * 72;
        rotation = Math.sin(progress * Math.PI) * Math.sign(action.toX - action.fromX) * 0.09;
        enemy.sprite.setScale(enemy.baseScale * (1 + Math.sin(progress * Math.PI) * 0.32));
        if (progress >= 1) {
          this.networkMonsterActions.delete(id);
          enemy.sprite.setScale(enemy.baseScale);
          this.emitRadialVfx(action.toX, action.toY, 8, MONSTER_ARCHETYPES[enemy.archetypeId].visual.accent, 58, 0.26);
        }
      } else {
        enemy.renderX = Phaser.Math.Linear(enemy.renderX ?? enemy.x, x, blend);
        enemy.renderY = Phaser.Math.Linear(enemy.renderY ?? enemy.y, y, blend);
      }
      const local = this.player;
      const flip = local ? local.x < enemy.x : false;
      enemy.sprite
        .setPosition(enemy.renderX, enemy.renderY - lift + Math.sin(enemy.phase) * 1.1)
        .setRotation(rotation)
        .setFlipX(flip)
        .setDepth(Math.round((enemy.renderY ?? enemy.y) / 10) + 10);
  }

  private releaseNetworkEnemy(enemy: EnemyState): void {
    const index = this.enemies.indexOf(enemy);
    if (index < 0) return;
    this.enemies.splice(index, 1);
    if (enemy.networkId !== undefined) {
      this.networkMonsterActions.delete(enemy.networkId);
      this.networkEnemies.delete(enemy.networkId);
      this.monsterAudio.forgetMonster(enemy.networkId);
    }
    this.enemyPool?.killAndHide(enemy.sprite);
    if (enemy.healthLabel) this.releaseHealthLabel(enemy.healthLabel);
  }

  private onNetworkMonsterDeath(event: Extract<CombatEvent, { kind: "monster-death" }>): void {
    if (this.processedMonsterDeaths.has(event.monsterId)) return;
    this.processedMonsterDeaths.add(event.monsterId);
    const enemy = this.networkEnemies.get(event.monsterId);
    const presentation: MonsterDeathPresentation = {
      archetypeId: event.archetypeId,
      rarity: event.rarity,
      x: enemy?.renderX ?? event.x,
      y: enemy?.renderY ?? event.y,
      baseScale: enemy?.baseScale ?? this.enemyBaseScale(event.archetypeId, event.rarity),
      flipX: enemy?.sprite.flipX ?? Boolean(this.player && this.player.x < event.x),
    };
    if (enemy) this.releaseNetworkEnemy(enemy);
    this.spawnCorpse(presentation);
    this.emitMonsterDeathVfx(presentation);
    this.monsterAudio.death(
      event.monsterId,
      event.archetypeId,
      event.rarity,
      presentation.x,
      presentation.y,
      this.time.now,
    );
  }

  private syncNetworkCombatEvents(): void {
    const multiplayer = this.options.multiplayer;
    if (!multiplayer?.drainCombatEvents) return;
    const events = multiplayer.drainCombatEvents();
    const hitAudioTargets = new Set<number>();
    const damagePresentations = new Map<string, {
      amount: number;
      damageType: Extract<CombatEvent, { kind: "damage" }>["damageType"];
      evaded: boolean;
      x: number;
      y: number;
    }>();
    let projectileHitPresentations = 0;

    for (const event of events) {
      if (event.kind === "monster-aggro") {
        this.monsterAudio.aggro(event.monsterId, event.archetypeId, event.x, event.y, this.time.now);
        continue;
      }
      if (event.kind === "monster-death") {
        this.onNetworkMonsterDeath(event);
        continue;
      }
      if (event.kind === "monster-action") {
        this.playNetworkMonsterAction(event);
        continue;
      }
      if (event.kind === "projectile-spawn") {
        this.launchReplicatedProjectile(event);
        continue;
      }
      if (event.kind === "projectile-hit") {
        if (projectileHitPresentations < MAX_PROJECTILE_HIT_PRESENTATIONS_PER_BATCH) {
          this.emitRadialVfx(event.x, event.y, 3, 0xff9a4b, 42, 0.16);
          projectileHitPresentations += 1;
        }
        continue;
      }
      if (event.kind === "projectile-expire") {
        this.expireReplicatedProjectile(event.projectileId, event.x, event.y);
        continue;
      }
      if (event.kind === "monster-projectile-terminal") {
        this.expireNetworkEnemyProjectile(event.projectileId, event.x, event.y, event.hit);
        continue;
      }
      if (event.kind === "damage") {
        const target = this.networkEnemies.get(event.targetId);
        if (target && !event.evaded && !hitAudioTargets.has(event.targetId)) {
          hitAudioTargets.add(event.targetId);
          this.monsterAudio.hit(
            event.targetId,
            target.archetypeId,
            target.rarity,
            event.targetX,
            event.targetY,
            this.time.now,
          );
        }
        if (event.actorCharacterId !== multiplayer.localCharacterId) continue;
        const presentationKey = `${event.targetId}:${event.evaded ? "evade" : event.damageType}`;
        const existing = damagePresentations.get(presentationKey);
        if (existing) {
          existing.amount += event.amount;
          existing.x = target?.sprite.x ?? event.targetX;
          existing.y = target?.sprite.y ?? event.targetY;
        } else {
          damagePresentations.set(presentationKey, {
            amount: event.amount,
            damageType: event.damageType,
            evaded: event.evaded,
            x: target?.sprite.x ?? event.targetX,
            y: target?.sprite.y ?? event.targetY,
          });
        }
        continue;
      }
      if (event.actorCharacterId === multiplayer.localCharacterId) continue;
      this.playRemoteSkillAnimation(event);
    }

    let presentedDamage = 0;
    for (const presentation of damagePresentations.values()) {
      if (presentedDamage >= MAX_DAMAGE_PRESENTATIONS_PER_BATCH) break;
      this.showDamageNumber(
        presentation.x,
        presentation.y,
        presentation.evaded ? "EVADE" : { amount: presentation.amount, type: presentation.damageType },
      );
      this.emitRadialVfx(
        presentation.x,
        presentation.y,
        presentation.evaded ? 2 : 4,
        presentation.evaded ? 0xaeb4bd : 0xff9a4b,
        54,
        0.2,
      );
      presentedDamage += 1;
    }
  }

  private playNetworkMonsterAction(event: MonsterActionEvent): void {
    const enemy = this.networkEnemies.get(event.monsterId);
    if (enemy) {
      this.monsterAudio.action(
        event.monsterId,
        enemy.archetypeId,
        enemy.rarity,
        event.action,
        event.fromX,
        event.fromY,
        this.time.now,
      );
    }
    if (event.action === "jump") {
      this.networkMonsterActions.set(event.monsterId, { ...event, elapsedMilliseconds: 0 });
      return;
    }
    if (!enemy) return;
    const accent = MONSTER_ARCHETYPES[enemy.archetypeId].visual.accent;
    this.tweens.killTweensOf(enemy.sprite);
    if (event.action === "ranged") {
      enemy.sprite.setScale(enemy.baseScale * 0.82, enemy.baseScale * 1.14);
      this.emitRadialVfx(enemy.sprite.x, enemy.sprite.y - 14, enemy.rarity === "rare" ? 9 : 5, accent, 52, 0.24);
      this.launchNetworkEnemyProjectile(enemy, event);
    } else {
      enemy.sprite.setScale(enemy.baseScale * 1.16, enemy.baseScale * 0.88);
      this.emitRadialVfx(event.toX, event.toY, 4, accent, 34, 0.16);
    }
    this.tweens.add({
      targets: enemy.sprite,
      scaleX: enemy.baseScale,
      scaleY: enemy.baseScale,
      duration: event.durationMilliseconds,
      ease: "Back.easeOut",
    });
  }

  private launchNetworkEnemyProjectile(enemy: EnemyState, event: MonsterActionEvent): void {
    if (event.projectileId === undefined) return;
    this.expireNetworkEnemyProjectile(event.projectileId, event.fromX, event.fromY, false, false);
    const sprite = this.enemyProjectilePool?.get(event.fromX, event.fromY - 10, "enemy-projectile") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    const duration = Math.max(320, event.durationMilliseconds);
    const dx = event.toX - event.fromX;
    const dy = event.toY - event.fromY;
    const length = Math.hypot(dx, dy) || 1;
    const range = event.projectileRange ?? length;
    const targetX = event.fromX + dx / length * range;
    const targetY = event.fromY + dy / length * range;
    sprite.setTexture("enemy-projectile")
      .setActive(true)
      .setVisible(true)
      .setPosition(event.fromX, event.fromY - 10)
      .setScale(enemy.rarity === "rare" ? 1.65 : enemy.rarity === "magic" ? 1.45 : 1.25)
      .setDepth(82)
      .setAlpha(1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const projectile: NetworkEnemyProjectile = {
      sprite,
      monsterId: event.monsterId,
      archetypeId: enemy.archetypeId,
      rarity: enemy.rarity,
    };
    this.networkEnemyProjectiles.set(event.projectileId, projectile);
    this.tweens.add({
      targets: sprite,
      x: targetX,
      y: targetY - 8,
      rotation: sprite.rotation + Math.PI * 3,
      duration,
      ease: "Linear",
      onComplete: () => {
        if (this.networkEnemyProjectiles.get(event.projectileId!) !== projectile) return;
        this.networkEnemyProjectiles.delete(event.projectileId!);
        this.enemyProjectilePool?.killAndHide(sprite);
      },
    });
  }

  private expireNetworkEnemyProjectile(projectileId: number, x: number, y: number, hit: boolean, emitAudio = true): void {
    const projectile = this.networkEnemyProjectiles.get(projectileId);
    if (!projectile) return;
    this.networkEnemyProjectiles.delete(projectileId);
    const { sprite } = projectile;
    this.tweens.killTweensOf(sprite);
    sprite.setPosition(x, y).setAlpha(1);
    if (hit) {
      this.emitRadialVfx(x, y, 7, 0xd985e8, 46, 0.2);
      if (emitAudio) {
        this.monsterAudio.projectileImpact(
          projectile.monsterId,
          projectile.archetypeId,
          projectile.rarity,
          x,
          y,
          this.time.now,
        );
      }
    }
    this.enemyProjectilePool?.killAndHide(sprite);
  }

  private playRemoteSkillAnimation(event: Extract<CombatEvent, { kind: "skill" }>): void {
    const remote = this.remotePlayers.get(event.actorCharacterId);
    if (!remote) return;
    const networkPlayer = this.options.multiplayer?.getPlayers().find((player) => player.characterId === event.actorCharacterId);
    const skill = event.skill === "basic" ? this.resolvedBasic : this.resolvedSkills[event.skill];
    const direction = resolveCharacterDirection(event.direction.x, event.direction.y, remote.animator.currentDirection);
    const baseCastTime = skill.castTime;
    const timing = skill.presentation.animation === "attack"
      ? { durationSeconds: resolveAttackTimeSeconds(networkPlayer?.attackSpeed ?? 1.2) } as const
      : skill.presentation.animation === "cast"
        ? { durationSeconds: resolveCastTimeSeconds(baseCastTime, networkPlayer?.castSpeed ?? 1) } as const
        : { playbackRate: 1.35 } as const;
    remote.animator.playAction(skill.presentation.animation, direction, timing, () => undefined);
  }

  private launchReplicatedProjectile(event: Extract<CombatEvent, { kind: "projectile-spawn" }>): void {
    this.expireReplicatedProjectile(event.projectileId, event.originX, event.originY, false);
    const skill = event.skill === "basic" ? this.resolvedBasic : this.resolvedSkills[event.skill];
    const distance = skill.projectileRange ?? MULTIPLAYER_COMBAT.projectile.basicRange;
    const predicted = event.actorCharacterId === this.options.multiplayer?.localCharacterId && event.skill === "basic"
      ? this.predictedBasicProjectiles.get(event.sequence)
      : undefined;
    if (predicted) {
      this.predictedBasicProjectiles.delete(event.sequence);
      this.tweens.killTweensOf(predicted.sprite);
    }
    let sprite = predicted?.sprite
      ?? this.projectilePool?.get(event.originX, event.originY, "projectile") as Phaser.GameObjects.Image | null;
    if (!sprite) {
      // Preserve a strict rendering budget without making a fresh authoritative
      // cast invisible. Oldest visuals are least useful and their later expire
      // events safely become no-ops once removed from this map.
      const oldestProjectileId = this.networkProjectiles.keys().next().value as number | undefined;
      if (oldestProjectileId !== undefined) {
        this.expireReplicatedProjectile(oldestProjectileId, event.originX, event.originY, false);
        sprite = this.projectilePool?.get(event.originX, event.originY, "projectile") as Phaser.GameObjects.Image | null;
      }
    }
    if (!sprite) return;
    const startX = predicted?.sprite.x ?? event.originX;
    const startY = predicted?.sprite.y ?? event.originY;
    const travelled = predicted ? Math.hypot(startX - predicted.originX, startY - predicted.originY) : 0;
    const remainingDistance = Math.max(0, distance - travelled);
    sprite.setTexture("projectile").setActive(true).setVisible(true)
      .setPosition(startX, startY)
      .setAlpha(1)
      .setRotation(Math.atan2(event.direction.y, event.direction.x))
      .setScale((skill.projectileScale ?? 1) * 1.35)
      .setDepth(80)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.networkProjectiles.set(event.projectileId, sprite);
    this.tweens.add({
      targets: sprite,
      x: startX + event.direction.x * remainingDistance,
      y: startY + event.direction.y * remainingDistance,
      duration: Math.max(80, remainingDistance / Math.max(1, event.speed) * 1_000),
      ease: "Linear",
    });
  }

  private launchPredictedBasicProjectile(sequence: number, direction: AimVector): void {
    if (!this.player || !this.projectilePool) return;
    const originX = this.player.x;
    const originY = this.player.y;
    const range = MULTIPLAYER_COMBAT.projectile.basicRange;
    const speed = MULTIPLAYER_COMBAT.projectile.speed;
    const sprite = this.projectilePool.get(originX, originY, "projectile") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setTexture("projectile").setActive(true).setVisible(true)
      .setPosition(originX, originY)
      .setAlpha(0.82)
      .setRotation(Math.atan2(direction.y, direction.x))
      .setScale((this.resolvedBasic.projectileScale ?? 1) * 1.35)
      .setDepth(80)
      .setBlendMode(Phaser.BlendModes.ADD);
    const predicted: PredictedProjectile = { sprite, originX, originY, direction, range, speed };
    this.predictedBasicProjectiles.set(sequence, predicted);
    this.tweens.add({
      targets: sprite,
      x: originX + direction.x * range,
      y: originY + direction.y * range,
      duration: Math.max(180, range / Math.max(1, speed) * 1_000),
      ease: "Linear",
      onComplete: () => {
        if (this.predictedBasicProjectiles.get(sequence) !== predicted) return;
        this.predictedBasicProjectiles.delete(sequence);
        this.projectilePool?.killAndHide(sprite);
      },
    });
  }

  private expireReplicatedProjectile(projectileId: number, x: number, y: number, emitEffect = true): void {
    const sprite = this.networkProjectiles.get(projectileId);
    if (!sprite) return;
    this.networkProjectiles.delete(projectileId);
    this.tweens.killTweensOf(sprite);
    sprite.setPosition(x, y).setAlpha(1);
    if (emitEffect) this.emitRadialVfx(x, y, 3, 0xffb25e, 30, 0.14);
    this.projectilePool?.killAndHide(sprite);
  }

  private destroyRemotePlayer(remote: RemotePlayerVisual): void {
    remote.animator.destroy();
    remote.sprite.destroy();
    remote.shadow.destroy();
    remote.label.destroy();
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
    onRelease: () => CharacterDirection | void,
    startX?: number,
    startY?: number,
  ): boolean {
    if (!this.playerAnimator) return false;
    const timing = skill.presentation.animation === "attack"
      ? { durationSeconds: resolveAttackTimeSeconds(this.options.arenaBalance?.attackSpeed ?? 1) } as const
      : skill.presentation.animation === "cast"
        ? { durationSeconds: skill.castTime ?? 0.65 } as const
        : { playbackRate: 1.35 } as const;
    return this.playerAnimator.playAction(skill.presentation.animation, direction, timing, () => {
      const releaseDirection = onRelease() ?? direction;
      this.audio.playSkill(skill.presentation.audio);
      this.playSkillReleaseVfx(skill, releaseDirection, startX, startY);
    });
  }

  private beginActiveSkillAction(
    skill: SkillDefinition,
    direction: CharacterDirection,
    onRelease: () => CharacterDirection | void,
    startX?: number,
    startY?: number,
  ): boolean {
    // Keyboard skills have priority over the repeatable left-click attack. If
    // its wind-up has not released yet, cancelling it also prevents a phantom
    // projectile; if it already released, only the remaining animation tail is
    // skipped. Cast/dash actions never interrupt one another.
    if (this.playerAnimator?.activeActionState === "attack") {
      this.basicAttackIntent = null;
      this.playerAnimator.cancelAction();
    }
    return this.beginSkillAction(skill, direction, onRelease, startX, startY);
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
    this.addStation("map-device", 480, 177, 155, 145, "MAP DEVICE");
    for (const merchantId of this.options.merchantIds) {
      const definition = MERCHANTS[merchantId];
      const merchant = this.add.image(definition.station.x, definition.station.y + 28, "player-sorceress-rendered")
        .setOrigin(0.5, 1).setDisplaySize(59, 96).setTint(definition.station.tint).setDepth(12);
      this.tweens.add({ targets: merchant, y: merchant.y - 3, duration: 1250, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      this.addStation(
        `merchant:${merchantId}`,
        definition.station.x,
        definition.station.y,
        definition.station.width,
        definition.station.height,
        definition.station.label,
      );
    }
    this.buildHideoutPortals();
  }

  updatePortalIndexes(portalIndexes: readonly number[]): void {
    this.options.portalIndexes = [...portalIndexes];
    if (this.options.mode === "hideout" && this.sys.isActive()) this.buildHideoutPortals();
  }

  private buildHideoutPortals(): void {
    for (const object of this.hideoutPortalObjects) {
      this.tweens.killTweensOf(object);
      object.destroy();
    }
    this.hideoutPortalObjects = [];
    const positions = [
      { x: 382, y: 150 }, { x: 431, y: 112 }, { x: 529, y: 112 },
      { x: 578, y: 150 }, { x: 548, y: 228 }, { x: 412, y: 228 },
    ];
    for (const portalIndex of this.options.portalIndexes) {
      const position = positions[portalIndex];
      if (!position) continue;
      const aura = this.add.ellipse(position.x, position.y, 47, 70, 0x7b3fe4, 0.16)
        .setDepth(17).setBlendMode(Phaser.BlendModes.ADD);
      const outer = this.add.ellipse(position.x, position.y, 34, 62, 0x35155f, 0.7)
        .setStrokeStyle(3, 0xd4a2ff, 0.88).setDepth(18).setBlendMode(Phaser.BlendModes.ADD);
      const inner = this.add.ellipse(position.x, position.y, 20, 48, 0x9d52ff, 0.42)
        .setStrokeStyle(1, 0xffd5ff, 0.9).setDepth(19).setBlendMode(Phaser.BlendModes.ADD);
      const rune = this.add.text(position.x, position.y, `${portalIndex + 1}`, {
        fontFamily: "Georgia, serif", fontSize: "12px", color: "#f4d8ff",
      }).setOrigin(0.5).setDepth(20).setShadow(0, 0, "#d65cff", 8);
      const label = this.add.text(position.x, position.y + 42, `PORTAL ${portalIndex + 1}`, {
        fontFamily: "monospace", fontSize: "9px", color: "#d9a8ff", backgroundColor: "#100a18dd", padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setDepth(21);
      const zone = this.add.zone(position.x, position.y, 48, 76).setDepth(22).setInteractive({ cursor: "pointer" });
      zone.on(Phaser.Input.Events.POINTER_DOWN, () => {
        if (!this.options.paused) this.options.onStation("portal", portalIndex);
      });
      this.tweens.add({ targets: aura, alpha: 0.42, scaleX: 1.2, scaleY: 1.12, duration: 760 + portalIndex * 55, yoyo: true, repeat: -1 });
      this.tweens.add({ targets: [outer, inner], angle: portalIndex % 2 === 0 ? 5 : -5, duration: 1_100 + portalIndex * 70, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      this.tweens.add({ targets: rune, alpha: 0.55, duration: 620 + portalIndex * 45, yoyo: true, repeat: -1 });
      this.hideoutPortalObjects.push(aura, outer, inner, rune, label, zone);
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

  private enemyBaseScale(archetypeId: MonsterArchetypeId, rarity: MonsterRarity): number {
    const archetype = MONSTER_ARCHETYPES[archetypeId];
    const rarityScale = rarity === "rare" ? 1.3 : rarity === "magic" ? 1.08 : 1;
    return (archetype.visual.sheet?.scale ?? archetype.visual.scale) * rarityScale;
  }

  private enemyOriginY(archetypeId: MonsterArchetypeId): number {
    const archetype = MONSTER_ARCHETYPES[archetypeId];
    return archetype.visual.sheet?.originY ?? archetype.visual.originY;
  }

  /** Steps replicated sheet-based enemies through their configured frames. */
  private updateEnemyAnimations(delta: number): void {
    for (const enemy of this.enemies) {
      const sheet = MONSTER_ARCHETYPES[enemy.archetypeId].visual.sheet;
      if (!sheet) continue;
      if (!enemy.moving && (enemy.networkId === undefined || !this.networkMonsterActions.has(enemy.networkId))) {
        enemy.sprite.setFrame(0);
        continue;
      }
      const previousAbsoluteFrame = Math.floor(enemy.animationTime * (sheet.aggroFrameRate ?? sheet.frameRate));
      enemy.animationTime += delta;
      const frameRate = sheet.aggroFrameRate ?? sheet.frameRate;
      const currentAbsoluteFrame = Math.floor(enemy.animationTime * frameRate);
      enemy.sprite.setFrame(currentAbsoluteFrame % sheet.frameCount);
      if (!enemy.moving || enemy.networkId === undefined || currentAbsoluteFrame <= previousAbsoluteFrame) continue;
      const crossedFrames = Math.min(sheet.frameCount, currentAbsoluteFrame - previousAbsoluteFrame);
      for (let offset = 1; offset <= crossedFrames; offset += 1) {
        this.monsterAudio.movementFrame(
          enemy.networkId,
          enemy.archetypeId,
          enemy.rarity,
          enemy.renderX ?? enemy.x,
          enemy.renderY ?? enemy.y,
          (previousAbsoluteFrame + offset) % sheet.frameCount,
          this.time.now,
        );
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
      const displayX = enemy.networkId ? enemy.sprite.x : enemy.x;
      const displayY = enemy.networkId ? enemy.sprite.y : enemy.y;
      const visible = displayX >= view.left - 100 && displayX <= view.right + 100
        && displayY >= view.top - 100 && displayY <= view.bottom + 40;
      if (!visible) {
        if (enemy.healthLabel) this.releaseHealthLabel(enemy.healthLabel);
        enemy.healthLabel = null;
        continue;
      }
      if (!enemy.healthLabel) enemy.healthLabel = this.acquireHealthLabel();
      enemy.healthLabel.setVisible(true);
      const left = Math.round(displayX - HEALTH_BAR_WIDTH / 2);
      const archetype = MONSTER_ARCHETYPES[enemy.archetypeId];
      const top = Math.round(displayY - 128 * enemy.baseScale * archetype.visual.originY - 8);
      const ratio = Phaser.Math.Clamp(enemy.life / enemy.maxLife, 0, 1);
      graphics.fillStyle(0x08090b, 0.9).fillRect(left - 1, top - 1, HEALTH_BAR_WIDTH + 2, HEALTH_BAR_HEIGHT + 2);
      graphics.fillStyle(0x39211f, 1).fillRect(left, top, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
      const lifeColor = enemy.rarity === "rare" ? 0xe0a637 : enemy.rarity === "magic" ? 0x668ee2 : ratio > 0.5 ? 0xc95745 : ratio > 0.25 ? 0xdc8a3d : 0xe4b34b;
      graphics.fillStyle(lifeColor, 1).fillRect(left, top, Math.max(0, HEALTH_BAR_WIDTH * ratio), HEALTH_BAR_HEIGHT);
      const rarityLabel = enemy.rarity === "normal" ? "" : `${enemy.rarity.toUpperCase()} `;
      const healthText = `${rarityLabel}${Math.ceil(Math.max(0, enemy.life))}/${Math.ceil(enemy.maxLife)}`;
      if (enemy.healthLabel.text !== healthText) enemy.healthLabel.setText(healthText);
      enemy.healthLabel.setPosition(Math.round(displayX), top - 8);
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

  private queueBasicAttack(consumeImmediately: boolean): void {
    const pointer = this.input.activePointer;
    this.basicAttackIntent = {
      worldX: pointer.worldX,
      worldY: pointer.worldY,
      expiresAt: this.elapsedSeconds + BASIC_ATTACK_INPUT_BUFFER_SECONDS,
    };
    if (consumeImmediately) this.consumeBasicAttackIntent();
  }

  cancelCombatInput(): void {
    this.worldPointerHeld = false;
    this.basicAttackIntent = null;
    this.playerAnimator?.cancelAction();
  }

  private consumeBasicAttackIntent(): void {
    const intent = this.basicAttackIntent;
    if (!intent) return;
    if (intent.expiresAt < this.elapsedSeconds || this.options.controlsBlocked) {
      this.basicAttackIntent = null;
      return;
    }
    if (this.tryBasicAttack(intent.worldX, intent.worldY)) this.basicAttackIntent = null;
  }

  private tryBasicAttack(worldX: number, worldY: number): boolean {
    if (this.attackCooldown > 0 || !this.player) return false;
    const dx = worldX - this.player.x;
    const dy = worldY - this.player.y;
    const direction = resolveCharacterDirection(dx, dy, this.playerAnimator?.currentDirection);
    const aim = resolveAimVector(this.player.x, this.player.y, worldX, worldY, characterDirectionVector(direction));
    const started = this.beginSkillAction(this.resolvedBasic, direction, () => {
      // A held mouse attack follows the live pointer through its wind-up. A
      // discrete click and keyboard-triggered attack retain their click-start
      // direction, which avoids surprising post-release retargeting.
      const releaseAim = this.worldPointerHeld ? this.currentPointerAim(aim) : aim;
      const sequence = this.options.multiplayer?.sendAttack?.("basic", releaseAim);
      if (sequence !== undefined) this.launchPredictedBasicProjectile(sequence, releaseAim);
      return resolveCharacterDirection(releaseAim.x, releaseAim.y, direction);
    });
    if (!started) return false;
    this.attackCooldown = resolveAttackTimeSeconds(this.options.arenaBalance?.attackSpeed ?? 1);
    return true;
  }

  private currentPointerAim(fallback: AimVector): AimVector {
    if (!this.player) return fallback;
    const pointer = this.input.activePointer;
    return resolveAimVector(this.player.x, this.player.y, pointer.worldX, pointer.worldY, fallback);
  }

  private spawnCorpse(death: MonsterDeathPresentation): void {
    if (!this.corpsePool) return;
    if (this.corpses.length >= ARENA_RULES.corpses.maximumVisible) this.releaseCorpse(0);
    const archetype = MONSTER_ARCHETYPES[death.archetypeId];
    const texture = `corpse-${death.archetypeId}`;
    const sprite = this.corpsePool.get(death.x, death.y, texture) as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite
      .setTexture(texture)
      .setOrigin(0.5, archetype.visual.originY)
      .setActive(true)
      .setVisible(true)
      .setPosition(death.x + Phaser.Math.FloatBetween(-2, 2), death.y + Phaser.Math.FloatBetween(-2, 2))
      .setScale(death.baseScale)
      .setRotation(Phaser.Math.FloatBetween(-0.035, 0.035))
      .setFlipX(death.flipX)
      .setAlpha(0.96)
      .setDepth(Math.round(death.y / 10) + 4)
      .clearTint();
    if (death.rarity === "magic") sprite.setTint(0xc1cdf1);
    if (death.rarity === "rare") sprite.setTint(0xf2d396);
    this.corpses.push({ sprite, age: 0 });
  }

  private emitMonsterDeathVfx(death: MonsterDeathPresentation): void {
    const archetype = MONSTER_ARCHETYPES[death.archetypeId];
    const count = death.rarity === "rare" ? 16 : death.rarity === "magic" ? 11 : 7;
    this.emitRadialVfx(death.x, death.y - 10, count, archetype.visual.accent, death.rarity === "rare" ? 105 : 72, 0.34);
    for (let index = 0; index < Math.ceil(count / 3); index += 1) {
      this.emitVfxParticle(
        death.x + Phaser.Math.Between(-12, 12),
        death.y + Phaser.Math.Between(-2, 8),
        archetype.visual.body,
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

  private spawnGroundDrop(x: number, y: number, item: InventoryItem, networkId: string): boolean {
    let texture = "drop-currency";
    let labelText = "ITEM";
    let color = "#ded5c9";
    if (isEquipmentItem(item)) {
      const presentation = equipmentDropPresentation(item);
      texture = `drop-equipment-${item.rarity}`;
      labelText = presentation.label;
      color = presentation.color;
    } else if (isMapItem(item)) {
      texture = "drop-map";
      labelText = `${item.baseName.toUpperCase()} · T${item.tier}`;
      color = item.rarity === "rare" ? "#ffd867" : item.rarity === "magic" ? "#96b4ff" : "#ded5c9";
    } else if (isCurrencyItem(item)) {
      const exactTexture = `drop-${item.baseId}`;
      texture = this.textures.exists(exactTexture) ? exactTexture : "drop-currency";
      labelText = `${item.stackSize} ${CURRENCY_DEFINITIONS[item.baseId].name.toUpperCase()}`;
      color = item.baseId === "essence" ? "#c6a5ff" : item.baseId === "mapDust" ? "#92e4df" : "#e2ac70";
    } else if (isFlaskItem(item)) {
      texture = `drop-${item.baseId}`;
      labelText = `${item.stackSize} ${FLASK_DEFINITIONS[item.baseId].name.toUpperCase()}`;
      color = FLASK_DEFINITIONS[item.baseId].resource === "life" ? "#ff8b78" : "#84c4ff";
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
    const groundDrop = { sprite, label, x, y, phase: Phaser.Math.FloatBetween(0, Math.PI * 2), networkId };
    this.groundDrops.push(groundDrop);
    this.groundDropsByNetworkId.set(networkId, groundDrop);
    return true;
  }

  private syncNetworkDrops(): void {
    const state = this.options.multiplayer?.getMap?.();
    if (!state) return;
    if (state.drops === this.lastNetworkDrops) return;
    this.lastNetworkDrops = state.drops;
    const present = new Set(state.drops.map((drop) => drop.id));
    for (const networkDrop of state.drops) {
      const existing = this.groundDropsByNetworkId.get(networkDrop.id);
      if (existing) {
        existing.x = networkDrop.x;
        existing.y = networkDrop.y;
        continue;
      }
      this.spawnGroundDrop(networkDrop.x, networkDrop.y, networkDrop.item, networkDrop.id);
    }
    for (let index = this.groundDrops.length - 1; index >= 0; index -= 1) {
      const drop = this.groundDrops[index];
      if (!drop.networkId || present.has(drop.networkId)) continue;
      this.groundDrops.splice(index, 1);
      this.groundDropsByNetworkId.delete(drop.networkId);
      this.dropPool?.killAndHide(drop.sprite);
      drop.label.destroy();
    }
  }

  private syncPickupResults(): void {
    const results = this.options.multiplayer?.drainPickupResults?.() ?? [];
    if (results.length === 0) return;
    const revision = this.options.multiplayer?.getProfileRevision?.() ?? 0;
    for (const result of results) {
      if (result.status !== "rejected") continue;
      const drop = this.groundDropsByNetworkId.get(result.dropId);
      if (!drop) continue;
      drop.networkPickupSuppressedAtRevision = revision;
      drop.networkPickupRetryAt = Number.POSITIVE_INFINITY;
    }
  }

  private updateGroundDrops(delta: number): void {
    if (!this.player) return;
    const revision = this.options.multiplayer?.getProfileRevision?.() ?? 0;
    let nearest: GroundDropState | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const groundDrop of this.groundDrops) {
      groundDrop.phase += delta * 3;
      const bob = Math.sin(groundDrop.phase) * 3;
      groundDrop.sprite.setPosition(groundDrop.x, groundDrop.y + bob);
      groundDrop.label.setPosition(groundDrop.x, groundDrop.y - 22 + bob);
      const distance = Math.hypot(this.player.x - groundDrop.x, this.player.y - groundDrop.y);
      if (distance >= 38) {
        if (groundDrop.networkPickupWasInRange) {
          // Leaving and re-entering is an explicit retry gesture.
          groundDrop.networkPickupSuppressedAtRevision = undefined;
          groundDrop.networkPickupRetryAt = 0;
        }
        groundDrop.networkPickupWasInRange = false;
        continue;
      }
      groundDrop.networkPickupWasInRange = true;
      if (groundDrop.networkPickupSuppressedAtRevision !== undefined) {
        if (groundDrop.networkPickupSuppressedAtRevision === revision) continue;
        groundDrop.networkPickupSuppressedAtRevision = undefined;
        groundDrop.networkPickupRetryAt = 0;
      }
      if (this.elapsedSeconds < (groundDrop.networkPickupRetryAt ?? 0)) continue;
      if (distance < nearestDistance) {
        nearest = groundDrop;
        nearestDistance = distance;
      }
    }
    if (!nearest || this.elapsedSeconds < this.nextAutoPickupAt) return;
    nearest.networkPickupRetryAt = this.elapsedSeconds + 0.8;
    this.nextAutoPickupAt = this.elapsedSeconds + AUTO_PICKUP_INTERVAL_SECONDS;
    this.options.multiplayer?.sendPickup?.(nearest.networkId);
  }

  private spawnCompletionChest(sharedPosition?: { x: number; y: number }): void {
    if (!this.player || this.completionChest) return;
    const rules = MAP_COMPLETION_REWARDS.chest;
    const yDirection = this.player.y + rules.spawnDistance <= MAP_SIZE - 100 ? 1 : -1;
    const x = Phaser.Math.Clamp(sharedPosition?.x ?? this.player.x, 100, MAP_SIZE - 100);
    const y = Phaser.Math.Clamp(sharedPosition?.y ?? this.player.y + yDirection * rules.spawnDistance, 100, MAP_SIZE - 100);
    const depth = Math.round(y / 10) + 70;
    const glow = this.add.ellipse(x, y + 1, 112, 54, 0xf2b84b, 0.2)
      .setDepth(depth - 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    const sprite = this.add.image(x, y - 2, "reward-chest-open")
      .setScale(1.55)
      .setDepth(depth);
    const label = this.add.text(x, y - 55, "VICTORY CACHE OPENED", {
      fontFamily: "monospace",
      fontSize: "17px",
      fontStyle: "bold",
      color: "#ffe391",
      stroke: "#09060d",
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(depth + 2);
    const prompt = this.add.text(x, y - 34, "PERSONAL REWARDS RELEASED", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#fff0bd",
      backgroundColor: "#120c05dd",
      padding: { x: 7, y: 4 },
    }).setOrigin(0.5).setDepth(depth + 2);
    this.completionChest = { x, y, elapsed: 0, opened: true, glow, sprite, label, prompt };
    this.emitRadialVfx(x, y - 4, 20, 0xffce62, 92, 0.55);
  }

  private spawnNetworkCompletionObjects(x: number, y: number): void {
    this.spawnCompletionChest({ x, y });
    this.spawnReturnPortal();
    this.options.onHud(this.getHud());
  }

  private updateCompletionChest(delta: number): void {
    const chest = this.completionChest;
    if (!chest) return;
    chest.elapsed += delta;
    const pulse = Math.sin(chest.elapsed * (chest.opened ? 2.1 : 3.2));
    chest.glow.setScale(1 + pulse * 0.08).setAlpha((chest.opened ? 0.12 : 0.22) + pulse * 0.05);
    chest.prompt.setAlpha(0.8 + Math.max(0, pulse) * 0.12);
  }

  private spawnReturnPortal(): void {
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
    const prompt = this.add.text(x, y + 59, "ENTER TO RETURN TO HIDEOUT", {
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
    this.returnPortal = { x, y, elapsed: 0, particleElapsed: 0, glow, outerRing, innerRing, sigil, label, prompt, interaction };
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
    this.returnPortalUsed = true;
    this.cancelCombatInput();
    this.returnPortal.interaction.disableInteractive();
    this.options.onReturnToHideout();
  }
}

export class PhaserRuntime {
  private readonly options: WorldRuntimeOptions;
  private game: Phaser.Game | null = null;
  private scene: ForgeOfEchoesScene | null = null;

  constructor(options: WorldRuntimeOptions) {
    this.options = options;
  }

  initialize(): void {
    const scene = new ForgeOfEchoesScene(this.options);
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

  useSkill(skill: SkillBarSkillId): void {
    this.scene?.useSkill(skill);
  }


  useFlask(slotIndex: number): void {
    this.scene?.useFlask(slotIndex);
  }

  updateFlaskBelt(flaskBelt: FlaskBelt): void {
    this.scene?.updateFlaskBelt(flaskBelt);
  }

  updatePortalIndexes(portalIndexes: readonly number[]): void {
    this.scene?.updatePortalIndexes(portalIndexes);
  }

  updateSkillLevels(skillLevels: SkillLevels): void {
    this.scene?.updateSkillLevels(skillLevels);
  }

  updateSkillLoadout(skillLoadout: SkillLoadout): void {
    this.options.skillLoadout = [...skillLoadout];
    this.scene?.updateSkillLoadout(skillLoadout);
  }

  setPaused(paused: boolean): void {
    this.options.paused = paused;
    if (paused) this.scene?.cancelCombatInput();
  }

  setControlsBlocked(blocked: boolean): void {
    this.options.controlsBlocked = blocked;
    if (blocked) this.scene?.cancelCombatInput();
  }

  cancelCombatInput(): void {
    this.scene?.cancelCombatInput();
  }

  updateArenaBalance(balance: NonNullable<WorldRuntimeOptions["arenaBalance"]>): void {
    this.scene?.updateArenaBalance(balance);
  }

  updateAudioVolume(volume: number): void {
    this.scene?.updateAudioVolume(volume);
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

interface SkillChargePool {
  charges: number;
  rechargeTimer: number;
}

function createEmptySkillCooldowns(): Record<ActiveSkillId, number> {
  return Object.fromEntries(ACTIVE_SKILL_IDS.map((id) => [id, 0])) as Record<ActiveSkillId, number>;
}

function resolveAllSkills(
  skillLevels: SkillLevels,
  cooldownMultiplier: number,
  castSpeedMultiplier: number,
): Record<ActiveSkillId, ResolvedSkillDefinition> {
  const resolved = {} as Record<ActiveSkillId, ResolvedSkillDefinition>;
  for (const id of ACTIVE_SKILL_IDS) {
    resolved[id] = resolveSkillDefinition(ACTIVE_SKILLS[id], skillLevels[id], cooldownMultiplier, castSpeedMultiplier);
  }
  return resolved;
}

function createChargePools(resolved: Record<ActiveSkillId, ResolvedSkillDefinition>): Map<ActiveSkillId, SkillChargePool> {
  const pools = new Map<ActiveSkillId, SkillChargePool>();
  for (const id of ACTIVE_SKILL_IDS) {
    if (resolved[id].maxCharges > 0) pools.set(id, { charges: resolved[id].maxCharges, rechargeTimer: 0 });
  }
  return pools;
}
