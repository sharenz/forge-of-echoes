import Phaser from "phaser";
import { ACTIVE_SKILLS, BASIC_ATTACK, calculateHitDamage, shouldSpawnNextWave, type MapDrop } from "../game/combat";
import { ARENA_RULES } from "../game/config/arena";
import { MONSTER_ARCHETYPES } from "../game/config/monsters";
import type { CharacterClassId } from "../game/domain";
import type { WorldHudState, WorldRuntimeOptions, WorldStation } from "./types";

const VIEW_SIZE = 960;
const MAP_SIZE = VIEW_SIZE * 4;
const SPATIAL_CELL_SIZE = 64;
const SPATIAL_COLUMNS = Math.ceil(MAP_SIZE / SPATIAL_CELL_SIZE) + 2;
const FIXED_STEP = 1000 / 60;
const MAX_FRAME_DELTA = 50;
const PROJECTILE_POOL_SIZE = 160;
const DAMAGE_NUMBER_POOL_SIZE = 160;
const HEALTH_BAR_WIDTH = 42;
const HEALTH_BAR_HEIGHT = 5;
const ARENA_MONSTER = MONSTER_ARCHETYPES.ashling;

interface EnemyState {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  speed: number;
  contactDamage: number;
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
  remaining: number;
}

interface GroundDropState {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  x: number;
  y: number;
  phase: number;
  drop: MapDrop;
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
  private player: Phaser.GameObjects.Image | null = null;
  private playerShadow: Phaser.GameObjects.Image | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> | null = null;
  private enemies: EnemyState[] = [];
  private projectiles: ProjectileState[] = [];
  private groundDrops: GroundDropState[] = [];
  private enemyPool: Phaser.GameObjects.Group | null = null;
  private projectilePool: Phaser.GameObjects.Group | null = null;
  private dropPool: Phaser.GameObjects.Group | null = null;
  private enemyHealthBars: Phaser.GameObjects.Graphics | null = null;
  private healthLabelPool: Phaser.GameObjects.Text[] = [];
  private damageNumberPool: Phaser.GameObjects.Text[] = [];
  private spatialBuckets = new Map<number, EnemyState[]>();
  private accumulator = 0;
  private attackCooldown = 0;
  private novaCooldown = 0;
  private riftCharges = ACTIVE_SKILLS.dash.maxCharges;
  private riftRecharge = 0;
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

  constructor(options: WorldRuntimeOptions) {
    super("crafty-world");
    this.options = options;
    this.life = options.arenaBalance?.maxLife ?? 100;
    this.focus = options.arenaBalance?.maxFocus ?? 100;
  }

  preload(): void {
    this.load.image("pixel-forge", "/pixel-forge-hideout.webp");
    this.load.image("ashen-wilderness", "/pixel-ashen-wilderness.webp");
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
      this.dropPool = this.add.group({ classType: Phaser.GameObjects.Image, maxSize: 300, runChildUpdate: false });
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
    const moving = this.keys && (this.keys.left.isDown || this.keys.right.isDown || this.keys.up.isDown || this.keys.down.isDown);
    this.player.setScale(2.15, 2.15 + Math.sin(this.time.now * 0.012) * (moving ? 0.045 : 0.018));
  }

  useSkill(skill: "nova" | "dash"): void {
    if (this.options.mode !== "arena" || !this.player || this.options.paused) return;
    if (skill === "nova" && this.novaCooldown <= 0 && this.focus >= ACTIVE_SKILLS.nova.focusCost) {
      this.focus -= ACTIVE_SKILLS.nova.focusCost;
      this.novaCooldown = ACTIVE_SKILLS.nova.cooldown;
      for (let index = 0; index < 18; index += 1) {
        const angle = (Math.PI * 2 * index) / 18;
        this.spawnProjectile(Math.cos(angle), Math.sin(angle), ACTIVE_SKILLS.nova.projectileScale, ACTIVE_SKILLS.nova.damageEffectiveness);
      }
    }
    if (skill === "dash" && this.riftCharges > 0 && this.focus >= ACTIVE_SKILLS.dash.focusCost) {
      this.focus -= ACTIVE_SKILLS.dash.focusCost;
      this.riftCharges -= 1;
      if (this.riftRecharge <= 0) this.riftRecharge = ACTIVE_SKILLS.dash.recharge;
      const pointer = this.input.activePointer;
      const dx = pointer.worldX - this.player.x;
      const dy = pointer.worldY - this.player.y;
      const length = Math.hypot(dx, dy) || 1;
      this.player.x += (dx / length) * 105;
      this.player.y += (dy / length) * 105;
      this.clampPlayer();
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
      riftMaxCharges: ACTIVE_SKILLS.dash.maxCharges,
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

  private fixedUpdate(delta: number): void {
    if (!this.player) return;
    this.elapsedSeconds += delta;
    this.waveElapsedSeconds += delta;
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.novaCooldown = Math.max(0, this.novaCooldown - delta);
    if (this.riftCharges < ACTIVE_SKILLS.dash.maxCharges) {
      this.riftRecharge = Math.max(0, this.riftRecharge - delta);
      if (this.riftRecharge <= 0) {
        this.riftCharges += 1;
        this.riftRecharge = this.riftCharges < ACTIVE_SKILLS.dash.maxCharges ? ACTIVE_SKILLS.dash.recharge : 0;
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
    this.playerShadow?.setPosition(this.player.x, this.player.y + 15);
    this.player.setDepth(Math.round(this.player.y / 10) + 11);
    this.playerShadow?.setDepth(Math.round(this.player.y / 10) + 9);

    if (this.options.mode === "arena") {
      if (this.keys?.attack.isDown || this.input.activePointer.isDown) this.tryBasicAttack();
      this.updateEnemies(delta);
      this.rebuildSpatialBuckets();
      this.applyEnemyContactDamage(delta);
      this.updateProjectiles(delta);
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
    this.createPlayerTexture("amazon");
    this.createPlayerTexture("barbarian");
    this.createPlayerTexture("sorceress");
    const enemy = this.make.graphics({ x: 0, y: 0 });
    enemy.fillStyle(0x30191f).fillRect(3, 7, 18, 15);
    enemy.fillStyle(0x8e3d42).fillRect(5, 5, 14, 14);
    enemy.fillStyle(0xd36b4e).fillRect(7, 3, 4, 4).fillRect(14, 3, 4, 4);
    enemy.fillStyle(0xffc45f).fillRect(8, 10, 2, 2).fillRect(15, 10, 2, 2);
    enemy.fillStyle(0x1b1116).fillRect(4, 20, 5, 3).fillRect(16, 20, 5, 3);
    enemy.generateTexture("enemy", 24, 24).destroy();
    const projectile = this.make.graphics({ x: 0, y: 0 });
    projectile.fillStyle(0xffe09a).fillRect(3, 3, 4, 4);
    projectile.fillStyle(0xff6a32).fillRect(1, 1, 8, 8);
    projectile.generateTexture("projectile", 10, 10).destroy();
    const shadow = this.make.graphics({ x: 0, y: 0 });
    shadow.fillStyle(0x071011, 0.5).fillEllipse(0, 0, 27, 9);
    shadow.generateTexture("shadow", 28, 10).destroy();
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

  private createPlayerTexture(classId: CharacterClassId): void {
    const colors = CLASS_COLORS[classId];
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0x16141b).fillRect(5, 24, 7, 4).fillRect(16, 24, 7, 4);
    graphics.fillStyle(colors.cloth).fillRect(5, 11, 18, 14);
    graphics.fillStyle(0xc58562).fillRect(8, 3, 12, 11);
    graphics.fillStyle(0x2a1b1a).fillRect(7, 2, 14, 5);
    graphics.fillStyle(colors.accent).fillRect(5, 13, 4, 10).fillRect(20, 10, 3, 12);
    graphics.fillStyle(0xf4d8b4).fillRect(10, 8, 2, 2).fillRect(17, 8, 2, 2);
    if (classId === "amazon") graphics.fillStyle(0xd7ad59).fillRect(22, 1, 2, 24);
    if (classId === "barbarian") graphics.fillStyle(0x9f9a8c).fillRect(22, 7, 5, 3).fillRect(24, 3, 2, 11);
    if (classId === "sorceress") graphics.fillStyle(0xff6b32).fillRect(22, 2, 5, 5).fillStyle(0x8150a2).fillRect(24, 7, 2, 17);
    graphics.generateTexture(`player-${classId}`, 29, 29).destroy();
  }

  private buildClassShowcase(): void {
    (["amazon", "barbarian", "sorceress"] as CharacterClassId[]).forEach((classId, index) => {
      const x = 285 + index * 195;
      this.add.ellipse(x, 520, 112, 34, 0x0b0c0f, 0.7);
      const sprite = this.add.image(x, 468, `player-${classId}`).setScale(4).setOrigin(0.5, 1);
      this.tweens.add({ targets: sprite, y: sprite.y - 4, duration: 1100 + index * 130, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    });
  }

  private createPlayer(): void {
    const x = this.options.mode === "arena" ? MAP_SIZE / 2 : 480;
    const y = this.options.mode === "arena" ? MAP_SIZE / 2 : 700;
    this.playerShadow = this.add.image(x, y + 15, "shadow").setScale(1.6).setDepth(8);
    this.player = this.add.image(x, y, `player-${this.options.classId}`).setScale(2.15).setDepth(10);
  }

  private buildHideoutStations(): void {
    this.addStation("stash", 116, 352, 135, 115, "STASH");
    this.addStation("bench", 817, 372, 150, 135, "CRAFT");
    this.addStation(this.options.portalActive ? "portal" : "map-device", 480, 177, 155, 145, this.options.portalActive ? "ENTER MAP" : "MAP DEVICE");
    const merchant = this.add.image(248, 600, "player-sorceress").setScale(2.35).setTint(0xd9ad76).setDepth(12);
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
    const waveStats = balance?.waveStats[wave - 1];
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
      const centerX = normalizedX * MAP_SIZE;
      const centerY = normalizedY * MAP_SIZE;
      for (let member = 0; member < members; member += 1) {
        const angle = (member / members) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
        const radius = Phaser.Math.Between(24, 105);
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        const sprite = this.enemyPool?.get(x, y, "enemy") as Phaser.GameObjects.Image | null;
        if (!sprite) break;
        const maxLife = waveStats.monsterLife;
        sprite.setActive(true).setVisible(true).setPosition(x, y).setScale(1.6).setDepth(Math.round(y / 10) + 10);
        this.enemies.push({
          sprite,
          x,
          y,
          homeX: x,
          homeY: y,
          phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
          aggro: false,
          life: maxLife,
          maxLife,
          speed: Phaser.Math.FloatBetween(waveStats.monsterMoveSpeed.min, waveStats.monsterMoveSpeed.max),
          contactDamage: waveStats.monsterDamage,
          healthLabel: null,
        });
      }
    });
    this.rebuildSpatialBuckets();
  }

  private updateEnemies(delta: number): void {
    if (!this.player) return;
    for (const enemy of this.enemies) {
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < ARENA_MONSTER.aggroRange) enemy.aggro = true;
      if (enemy.aggro) {
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
      graphics.fillStyle(ratio > 0.5 ? 0xc95745 : ratio > 0.25 ? 0xdc8a3d : 0xe4b34b, 1).fillRect(left, top, Math.max(0, HEALTH_BAR_WIDTH * ratio), HEALTH_BAR_HEIGHT);
      const healthText = `${Math.ceil(Math.max(0, enemy.life))}/${Math.ceil(enemy.maxLife)}`;
      if (enemy.healthLabel.text !== healthText) enemy.healthLabel.setText(healthText);
      enemy.healthLabel.setPosition(Math.round(enemy.x), top - 8);
    }
  }

  private showDamageNumber(x: number, y: number, damage: number): void {
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
    label.setText(`${Math.max(1, Math.round(damage))}`)
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
        const evadeMultiplier = 1 - (this.options.arenaBalance?.evadeChance ?? 0) / 100;
        const armor = this.options.arenaBalance?.armor ?? 0;
        const armorMultiplier = 100 / (100 + armor);
        this.life -= delta * enemy.contactDamage * evadeMultiplier * armorMultiplier;
      }
    }
    if (this.life <= 0) {
      this.lives -= 1;
      this.life = this.options.arenaBalance?.maxLife ?? 100;
      this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
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
    this.spawnProjectile(dx / length, dy / length, BASIC_ATTACK.projectileScale, BASIC_ATTACK.damageEffectiveness);
    this.attackCooldown = 1 / Math.max(0.01, this.options.arenaBalance?.attackSpeed ?? 1);
  }

  private spawnProjectile(directionX: number, directionY: number, visualScale: number, damageEffectiveness: number): void {
    if (!this.player) return;
    const sprite = this.projectilePool?.get(this.player.x, this.player.y, "projectile") as Phaser.GameObjects.Image | null;
    if (!sprite) return;
    sprite.setActive(true).setVisible(true).setScale(visualScale * 1.35).setDepth(80).setBlendMode(Phaser.BlendModes.ADD);
    this.projectiles.push({
      sprite,
      vx: directionX * 520,
      vy: directionY * 520,
      damage: calculateHitDamage(this.options.arenaBalance?.attackDamage ?? 15, damageEffectiveness),
      remaining: 1.35,
    });
  }

  private updateProjectiles(delta: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.sprite.x += projectile.vx * delta;
      projectile.sprite.y += projectile.vy * delta;
      projectile.remaining -= delta;
      const hit = this.nearbyEnemies(projectile.sprite.x, projectile.sprite.y).find((enemy) => Math.hypot(projectile.sprite.x - enemy.x, projectile.sprite.y - enemy.y) < 25);
      if (hit) {
        hit.life -= projectile.damage;
        this.showDamageNumber(hit.x, hit.y, projectile.damage);
        projectile.remaining = 0;
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
    this.rollGroundDrop(enemy.x, enemy.y);
  }

  private rollGroundDrop(x: number, y: number): void {
    const rewardMultiplier = 1 + (this.options.arenaBalance?.rewardBonus ?? 0) / 100;
    const equipmentChance = Math.min(0.14, 0.055 * rewardMultiplier);
    const materialChance = Math.min(0.35, 0.16 * rewardMultiplier);
    const roll = Math.random();
    let drop: MapDrop | null = null;
    if (roll < equipmentChance) {
      const rarityRoll = Math.random();
      const rareChance = Math.min(0.04, 0.0125 * rewardMultiplier);
      drop = { kind: "equipment", rarity: rarityRoll < rareChance ? "rare" : rarityRoll < 0.5 ? "magic" : "normal" };
    } else if (roll < equipmentChance + materialChance) {
      const materialRoll = Math.random();
      drop = materialRoll < 0.08
        ? { kind: "currency", currency: "mapDust", amount: 1 }
        : materialRoll < 0.28
          ? { kind: "currency", currency: "essence", amount: 1 }
          : { kind: "currency", currency: "scrap", amount: Phaser.Math.Between(1, 2) };
    }
    if (!drop) return;
    this.spawnGroundDrop(x, y, drop);
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
