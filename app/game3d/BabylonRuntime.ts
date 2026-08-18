import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import "@babylonjs/core/Culling/ray";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Scene } from "@babylonjs/core/scene";
import type { CharacterClassId } from "../game/domain";
import type { WorldHudState, WorldMode, WorldRuntimeOptions, WorldStation } from "./types";

interface Projectile {
  mesh: Mesh;
  velocity: Vector3;
  life: number;
  damage: number;
}

interface EnemyState {
  x: number;
  z: number;
  life: number;
  speed: number;
}

const CLASS_COLORS: Record<CharacterClassId, Color3> = {
  amazon: Color3.FromHexString("#c9a35d"),
  barbarian: Color3.FromHexString("#a94f35"),
  sorceress: Color3.FromHexString("#dd7133"),
};

export class BabylonRuntime {
  private readonly options: WorldRuntimeOptions;
  private engine: AbstractEngine | null = null;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private player: TransformNode | null = null;
  private playerTarget = Vector3.Zero();
  private input = new Set<string>();
  private pointerHeld = false;
  private aimPoint = new Vector3(0, 0, -4);
  private attackCooldown = 0;
  private novaCooldown = 0;
  private dashCooldown = 0;
  private projectiles: Projectile[] = [];
  private enemies: EnemyState[] = [];
  private enemyMesh: Mesh | null = null;
  private enemyMatrices = new Float32Array(0);
  private wave = 1;
  private life = 100;
  private focus = 100;
  private lives = 3;
  private fixedAccumulator = 0;
  private hudTimer = 0;
  private elapsed = 0;
  private disposed = false;
  private arenaCompleted = false;
  private enemiesSlain = 0;

  constructor(options: WorldRuntimeOptions) {
    this.options = options;
    this.life = options.arenaBalance?.maxLife ?? 100;
    this.focus = options.arenaBalance?.maxFocus ?? 100;
  }

  async initialize(): Promise<void> {
    this.engine = await this.createEngine(this.options.canvas);
    if (this.disposed) {
      this.engine.dispose();
      return;
    }
    this.scene = this.createScene(this.engine, this.options.mode);
    this.engine.runRenderLoop(() => {
      if (!this.scene) return;
      const delta = Math.min(this.engine?.getDeltaTime() ?? 16.67, 50) / 1000;
      this.update(delta);
      this.scene.render();
    });
  }

  resize(): void {
    this.engine?.resize();
  }

  setKey(code: string, pressed: boolean): void {
    if (pressed) this.input.add(code);
    else this.input.delete(code);
  }

  setPointerHeld(held: boolean): void {
    this.pointerHeld = held;
  }

  useSkill(skill: "nova" | "dash"): void {
    if (this.options.mode !== "arena" || !this.player) return;
    if (skill === "nova" && this.novaCooldown <= 0 && this.focus >= 30) {
      this.focus -= 30;
      this.novaCooldown = 4;
      for (let index = 0; index < 14; index += 1) {
        const angle = (Math.PI * 2 * index) / 14;
        this.spawnProjectile(new Vector3(Math.cos(angle), 0, Math.sin(angle)), 1.35);
      }
    }
    if (skill === "dash" && this.dashCooldown <= 0 && this.focus >= 15) {
      this.focus -= 15;
      this.dashCooldown = 3;
      const direction = this.aimPoint.subtract(this.player.position);
      direction.y = 0;
      if (direction.lengthSquared() > 0.01) {
        direction.normalize();
        this.player.position.addInPlace(direction.scale(3.8));
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.projectiles.forEach((projectile) => projectile.mesh.dispose());
    this.projectiles = [];
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
  }

  private async createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
    if ("gpu" in navigator) {
      try {
        const engine = new WebGPUEngine(canvas, { antialias: true });
        await engine.initAsync();
        return engine;
      } catch {
        // WebGPU availability can still fail at adapter creation. WebGL2 is the supported fallback.
      }
    }
    return new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
  }

  private createScene(engine: AbstractEngine, mode: WorldMode): Scene {
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.018, 0.015, 0.012, 1);
    scene.ambientColor = new Color3(0.06, 0.045, 0.035);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.exposure = 1.15;
    scene.imageProcessingConfiguration.contrast = 1.2;

    this.camera = new ArcRotateCamera("isometric-camera", -Math.PI / 4, 1.02, mode === "class-select" ? 17 : 22, Vector3.Zero(), scene);
    this.camera.fov = 0.62;
    this.camera.minZ = 0.1;
    this.camera.lowerBetaLimit = this.camera.beta;
    this.camera.upperBetaLimit = this.camera.beta;
    this.camera.lowerRadiusLimit = this.camera.radius;
    this.camera.upperRadiusLimit = this.camera.radius;
    this.camera.inputs.clear();

    const ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, 0.1), scene);
    ambient.intensity = 0.42;
    ambient.diffuse = new Color3(0.63, 0.54, 0.45);
    ambient.groundColor = new Color3(0.06, 0.035, 0.02);
    const sun = new DirectionalLight("forge-light", new Vector3(-0.5, -1, 0.45), scene);
    sun.position = new Vector3(12, 18, -10);
    sun.intensity = 2.2;
    sun.diffuse = new Color3(1, 0.58, 0.28);
    const shadows = new ShadowGenerator(1024, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.bias = 0.0008;
    new GlowLayer("embers", scene, { blurKernelSize: 32 }).intensity = 0.55;

    if (mode === "class-select") this.buildClassShowcase(scene, shadows);
    if (mode === "hideout") this.buildHideout(scene, shadows);
    if (mode === "arena") this.buildArena(scene, shadows);

    scene.onPointerObservable.add((pointerInfo) => {
      const pick = pointerInfo.pickInfo;
      if (!pick?.hit || !pick.pickedPoint) return;
      this.aimPoint.copyFrom(pick.pickedPoint);
      let node = pick.pickedMesh;
      while (node) {
        const station = node.metadata?.station as WorldStation | undefined;
        if (station) {
          if (pointerInfo.type === PointerEventTypes.POINTERDOWN) this.options.onStation(station);
          return;
        }
        node = node.parent as Mesh | null;
      }
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN && this.options.mode === "hideout") {
        this.playerTarget.copyFrom(pick.pickedPoint);
        this.playerTarget.y = 0;
      }
    });

    return scene;
  }

  private buildClassShowcase(scene: Scene, shadows: ShadowGenerator): void {
    const ground = this.createGround(scene, 24, 13);
    ground.receiveShadows = true;
    const classes: CharacterClassId[] = ["amazon", "barbarian", "sorceress"];
    classes.forEach((classId, index) => {
      const x = (index - 1) * 5;
      const pedestal = MeshBuilder.CreateCylinder(`pedestal-${classId}`, { diameter: 3.2, height: 0.45, tessellation: 32 }, scene);
      pedestal.position.set(x, 0.2, 0);
      pedestal.material = this.createPbr(scene, `pedestal-${classId}-material`, "#17130f", 0.05, 0.82);
      this.createCharacter(scene, classId, new Vector3(x, 0.45, 0), shadows, index === 1 ? 1.15 : 1);
      const light = new PointLight(`class-light-${classId}`, new Vector3(x, 4, 2), scene);
      light.diffuse = CLASS_COLORS[classId];
      light.intensity = 7;
      light.range = 8;
    });
    this.createForgeArchitecture(scene, shadows, 12, 6.5);
  }

  private buildHideout(scene: Scene, shadows: ShadowGenerator): void {
    const ground = this.createGround(scene, 30, 22);
    ground.metadata = { ground: true };
    ground.receiveShadows = true;
    this.player = this.createCharacter(scene, this.options.classId, Vector3.Zero(), shadows, 0.78);
    this.playerTarget.copyFrom(this.player.position);
    this.createForgeArchitecture(scene, shadows, 15, 11);
    this.createChest(scene, new Vector3(-7.5, 0, 2.8), shadows);
    this.createBench(scene, new Vector3(7.2, 0, 2.5), shadows);
    this.createPortal(scene, new Vector3(0, 0, -7.2), shadows, this.options.portalActive);
  }

  private buildArena(scene: Scene, shadows: ShadowGenerator): void {
    const ground = MeshBuilder.CreateCylinder("arena-ground", { diameter: 31, height: 0.5, tessellation: 64 }, scene);
    ground.position.y = -0.3;
    ground.material = this.createPbr(scene, "arena-floor-material", "#17130f", 0.12, 0.88);
    ground.receiveShadows = true;
    this.player = this.createCharacter(scene, this.options.classId, Vector3.Zero(), shadows, 0.72);
    this.playerTarget.copyFrom(this.player.position);
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const pillar = MeshBuilder.CreateBox(`arena-pillar-${index}`, { width: 1.1, height: 3.2, depth: 1.1 }, scene);
      pillar.position.set(Math.cos(angle) * 14, 1.35, Math.sin(angle) * 14);
      pillar.material = this.createPbr(scene, "arena-stone", "#211a14", 0.08, 0.94);
      shadows.addShadowCaster(pillar);
    }
    this.enemyMesh = MeshBuilder.CreateCapsule("enemy-source", { height: 1.75, radius: 0.44, tessellation: 8 }, scene);
    this.enemyMesh.material = this.createPbr(scene, "enemy-material", "#682f25", 0.12, 0.67, "#2b0602");
    this.enemyMesh.doNotSyncBoundingInfo = true;
    shadows.addShadowCaster(this.enemyMesh);
    this.startWave(1);
  }

  private createGround(scene: Scene, width: number, depth: number): Mesh {
    const ground = MeshBuilder.CreateGround("forge-floor", { width, height: depth, subdivisions: 1 }, scene);
    ground.material = this.createPbr(scene, "floor-material", "#181410", 0.08, 0.9);
    const tileMaterial = this.createPbr(scene, "tile-material", "#201a14", 0.1, 0.86);
    for (let x = -width / 2 + 1; x < width / 2; x += 2) {
      for (let z = -depth / 2 + 1; z < depth / 2; z += 2) {
        const tile = MeshBuilder.CreateBox(`tile-${x}-${z}`, { width: 1.92, height: 0.08, depth: 1.92 }, scene);
        tile.position.set(x, 0.01 + Math.random() * 0.018, z);
        tile.rotation.y = (Math.random() - 0.5) * 0.018;
        tile.material = tileMaterial;
        tile.receiveShadows = true;
      }
    }
    return ground;
  }

  private createForgeArchitecture(scene: Scene, shadows: ShadowGenerator, width: number, depth: number): void {
    const material = this.createPbr(scene, "architecture-material", "#17130f", 0.18, 0.84);
    const backWall = MeshBuilder.CreateBox("back-wall", { width: width * 1.85, height: 5.5, depth: 0.65 }, scene);
    backWall.position.set(0, 2.4, -depth);
    backWall.material = material;
    backWall.receiveShadows = true;
    for (const x of [-width * 0.8, -width * 0.4, 0, width * 0.4, width * 0.8]) {
      const pillar = MeshBuilder.CreateCylinder(`wall-pillar-${x}`, { diameter: 1.1, height: 6.2, tessellation: 8 }, scene);
      pillar.position.set(x, 2.7, -depth + 0.35);
      pillar.material = material;
      shadows.addShadowCaster(pillar);
    }
    for (const x of [-width * 0.88, width * 0.88]) {
      const side = MeshBuilder.CreateBox(`side-wall-${x}`, { width: 0.65, height: 4.5, depth: depth * 1.8 }, scene);
      side.position.set(x, 2, 0);
      side.material = material;
      side.receiveShadows = true;
    }
  }

  private createCharacter(scene: Scene, classId: CharacterClassId, position: Vector3, shadows: ShadowGenerator, scale: number): TransformNode {
    const root = new TransformNode(`character-${classId}`, scene);
    root.position.copyFrom(position);
    root.scaling.setAll(scale);
    const bodyMaterial = this.createPbr(scene, `${classId}-armor`, classId === "amazon" ? "#57442d" : classId === "barbarian" ? "#4b2720" : "#351f1b", 0.42, 0.56);
    const skinMaterial = this.createPbr(scene, `${classId}-skin`, "#a66f50", 0.02, 0.72);
    const body = MeshBuilder.CreateCapsule(`${classId}-body`, { height: classId === "barbarian" ? 2.25 : 2, radius: classId === "barbarian" ? 0.48 : 0.38, tessellation: 12 }, scene);
    body.parent = root;
    body.position.y = 1.25;
    body.material = bodyMaterial;
    const head = MeshBuilder.CreateSphere(`${classId}-head`, { diameter: classId === "barbarian" ? 0.68 : 0.58, segments: 12 }, scene);
    head.parent = root;
    head.position.y = classId === "barbarian" ? 2.45 : 2.25;
    head.material = skinMaterial;
    [body, head].forEach((mesh) => shadows.addShadowCaster(mesh));
    if (classId === "amazon") this.createSpear(scene, root, bodyMaterial, shadows);
    if (classId === "barbarian") this.createAxe(scene, root, bodyMaterial, shadows);
    if (classId === "sorceress") this.createStaff(scene, root, bodyMaterial, shadows);
    return root;
  }

  private createSpear(scene: Scene, root: TransformNode, material: PBRMaterial, shadows: ShadowGenerator): void {
    const shaft = MeshBuilder.CreateCylinder("amazon-spear", { height: 3.5, diameter: 0.08, tessellation: 8 }, scene);
    shaft.parent = root;
    shaft.position.set(0.55, 1.5, 0);
    shaft.material = material;
    const tip = MeshBuilder.CreateCylinder("amazon-spear-tip", { height: 0.5, diameterTop: 0, diameterBottom: 0.22, tessellation: 6 }, scene);
    tip.parent = root;
    tip.position.set(0.55, 3.5, 0);
    tip.material = this.createPbr(scene, "weapon-metal", "#8a7257", 0.8, 0.28);
    shadows.addShadowCaster(shaft);
    shadows.addShadowCaster(tip);
  }

  private createAxe(scene: Scene, root: TransformNode, material: PBRMaterial, shadows: ShadowGenerator): void {
    const shaft = MeshBuilder.CreateCylinder("barbarian-axe", { height: 2.8, diameter: 0.11, tessellation: 8 }, scene);
    shaft.parent = root;
    shaft.position.set(0.7, 1.3, 0);
    shaft.rotation.z = -0.16;
    shaft.material = material;
    const blade = MeshBuilder.CreateBox("barbarian-axe-blade", { width: 0.85, height: 0.55, depth: 0.12 }, scene);
    blade.parent = root;
    blade.position.set(0.94, 2.65, 0);
    blade.rotation.z = -0.16;
    blade.material = this.createPbr(scene, "barbarian-metal", "#65584b", 0.82, 0.35);
    shadows.addShadowCaster(shaft);
    shadows.addShadowCaster(blade);
  }

  private createStaff(scene: Scene, root: TransformNode, material: PBRMaterial, shadows: ShadowGenerator): void {
    const staff = MeshBuilder.CreateCylinder("sorceress-staff", { height: 3.1, diameter: 0.09, tessellation: 8 }, scene);
    staff.parent = root;
    staff.position.set(0.55, 1.45, 0);
    staff.material = material;
    const orb = MeshBuilder.CreateSphere("sorceress-orb", { diameter: 0.42, segments: 12 }, scene);
    orb.parent = root;
    orb.position.set(0.55, 3.1, 0);
    orb.material = this.createPbr(scene, "sorceress-ember", "#a83c18", 0.15, 0.25, "#ff5d19");
    shadows.addShadowCaster(staff);
  }

  private createChest(scene: Scene, position: Vector3, shadows: ShadowGenerator): void {
    const root = new TransformNode("stash-station", scene);
    root.position.copyFrom(position);
    root.metadata = { station: "stash" };
    const material = this.createPbr(scene, "chest-material", "#2b2017", 0.64, 0.48);
    const base = MeshBuilder.CreateBox("stash-chest", { width: 2.7, height: 1.25, depth: 1.45 }, scene);
    base.parent = root;
    base.position.y = 0.7;
    base.material = material;
    base.metadata = { station: "stash" };
    const lid = MeshBuilder.CreateCylinder("stash-lid", { diameter: 1.45, height: 2.7, tessellation: 16, arc: 0.5 }, scene);
    lid.parent = root;
    lid.position.set(0, 1.35, 0);
    lid.rotation.z = Math.PI / 2;
    lid.material = material;
    lid.metadata = { station: "stash" };
    shadows.addShadowCaster(base);
    shadows.addShadowCaster(lid);
  }

  private createBench(scene: Scene, position: Vector3, shadows: ShadowGenerator): void {
    const root = new TransformNode("bench-station", scene);
    root.position.copyFrom(position);
    root.metadata = { station: "bench" };
    const stone = this.createPbr(scene, "bench-stone", "#29221b", 0.2, 0.82);
    const top = MeshBuilder.CreateBox("crafting-bench", { width: 3.3, height: 0.4, depth: 1.5 }, scene);
    top.parent = root;
    top.position.y = 1.05;
    top.material = stone;
    top.metadata = { station: "bench" };
    for (const x of [-1.2, 1.2]) {
      const leg = MeshBuilder.CreateBox(`bench-leg-${x}`, { width: 0.45, height: 1.1, depth: 1.1 }, scene);
      leg.parent = root;
      leg.position.set(x, 0.5, 0);
      leg.material = stone;
      leg.metadata = { station: "bench" };
      shadows.addShadowCaster(leg);
    }
    const anvil = MeshBuilder.CreateBox("bench-anvil", { width: 1.25, height: 0.38, depth: 0.5 }, scene);
    anvil.parent = root;
    anvil.position.set(0.65, 1.45, 0);
    anvil.material = this.createPbr(scene, "anvil-metal", "#4d4840", 0.9, 0.28);
    anvil.metadata = { station: "bench" };
    shadows.addShadowCaster(top);
    shadows.addShadowCaster(anvil);
  }

  private createPortal(scene: Scene, position: Vector3, shadows: ShadowGenerator, active: boolean): void {
    const root = new TransformNode("map-device-station", scene);
    root.position.copyFrom(position);
    root.metadata = { station: active ? "portal" : "map-device" };
    const stone = this.createPbr(scene, "portal-stone", "#292018", 0.16, 0.88);
    const dais = MeshBuilder.CreateCylinder("map-device", { diameter: 5.3, height: 0.55, tessellation: 48 }, scene);
    dais.parent = root;
    dais.position.y = 0.25;
    dais.material = stone;
    dais.metadata = root.metadata;
    const ringMaterial = this.createPbr(scene, "portal-ring-material", active ? "#8c3518" : "#49301f", 0.35, 0.32, active ? "#ff5a1f" : "#4c2010");
    const ring = MeshBuilder.CreateTorus("portal-ring", { diameter: 4.15, thickness: 0.22, tessellation: 64 }, scene);
    ring.parent = root;
    ring.position.y = 0.64;
    ring.material = ringMaterial;
    ring.metadata = root.metadata;
    if (active) {
      const veil = MeshBuilder.CreateDisc("portal-veil", { radius: 1.75, tessellation: 64 }, scene);
      veil.parent = root;
      veil.position.set(0, 2.55, 0);
      veil.rotation.x = 0;
      const veilMaterial = new StandardMaterial("portal-veil-material", scene);
      veilMaterial.diffuseColor = new Color3(0.32, 0.04, 0.01);
      veilMaterial.emissiveColor = new Color3(0.95, 0.18, 0.02);
      veilMaterial.alpha = 0.62;
      veilMaterial.backFaceCulling = false;
      veil.material = veilMaterial;
      veil.metadata = root.metadata;
      scene.onBeforeRenderObservable.add(() => {
        veil.scaling.x = 1 + Math.sin(this.elapsed * 2.4) * 0.045;
        veil.scaling.y = 1 + Math.cos(this.elapsed * 2.1) * 0.06;
        ring.rotation.y += 0.003;
      });
      const light = new PointLight("portal-light", new Vector3(position.x, 2.5, position.z + 0.5), scene);
      light.diffuse = new Color3(1, 0.24, 0.04);
      light.intensity = 11;
      light.range = 10;
    }
    shadows.addShadowCaster(dais);
  }

  private createPbr(scene: Scene, name: string, albedo: string, metallic: number, roughness: number, emissive?: string): PBRMaterial {
    const existing = scene.getMaterialByName(name);
    if (existing instanceof PBRMaterial) return existing;
    const material = new PBRMaterial(name, scene);
    material.albedoColor = Color3.FromHexString(albedo);
    material.metallic = metallic;
    material.roughness = roughness;
    if (emissive) material.emissiveColor = Color3.FromHexString(emissive);
    return material;
  }

  private update(delta: number): void {
    this.elapsed += delta;
    this.fixedAccumulator += delta;
    while (this.fixedAccumulator >= 1 / 30) {
      this.fixedUpdate(1 / 30);
      this.fixedAccumulator -= 1 / 30;
    }
    this.updateProjectiles(delta);
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.novaCooldown = Math.max(0, this.novaCooldown - delta);
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);
    const maxFocus = this.options.arenaBalance?.maxFocus ?? 100;
    this.focus = Math.min(maxFocus, this.focus + delta * (this.options.arenaBalance?.focusRegen ?? 8));
    this.hudTimer -= delta;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      this.options.onHud(this.getHud());
    }
  }

  private fixedUpdate(delta: number): void {
    if (!this.player) return;
    const move = new Vector3(
      (this.input.has("KeyD") ? 1 : 0) - (this.input.has("KeyA") ? 1 : 0),
      0,
      (this.input.has("KeyS") ? 1 : 0) - (this.input.has("KeyW") ? 1 : 0),
    );
    if (move.lengthSquared() > 0) {
      move.normalize();
      this.player.position.addInPlace(move.scale(delta * (this.options.arenaBalance?.moveSpeed ?? 5.6)));
      this.playerTarget.copyFrom(this.player.position);
    } else if (this.options.mode === "hideout") {
      const toTarget = this.playerTarget.subtract(this.player.position);
      toTarget.y = 0;
      if (toTarget.lengthSquared() > 0.05) {
        toTarget.normalize();
        this.player.position.addInPlace(toTarget.scale(delta * 4.8));
      }
    }
    const look = this.aimPoint.subtract(this.player.position);
    look.y = 0;
    if (look.lengthSquared() > 0.1) this.player.rotation.y = Math.atan2(look.x, look.z);
    this.player.position.x = Math.max(-13.5, Math.min(13.5, this.player.position.x));
    this.player.position.z = Math.max(-10, Math.min(10, this.player.position.z));
    if (this.camera) this.camera.target = Vector3.Lerp(this.camera.target, this.player.position.add(new Vector3(0, 0.8, 0)), 0.09);

    if (this.options.mode === "arena") {
      if ((this.pointerHeld || this.input.has("Space")) && this.attackCooldown <= 0) {
        const direction = this.aimPoint.subtract(this.player.position);
        direction.y = 0;
        if (direction.lengthSquared() > 0.02) this.spawnProjectile(direction.normalize(), 1);
        this.attackCooldown = Math.max(0.12, 0.34 / (this.options.arenaBalance?.attackSpeed ?? 1));
      }
      this.updateEnemies(delta);
    }
  }

  private startWave(wave: number): void {
    this.wave = wave;
    const balance = this.options.arenaBalance;
    const count = Math.round((22 + wave * 12) * (balance?.enemyCountMultiplier ?? 1));
    this.enemies = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.15;
      const radius = 10 + Math.random() * 3.5;
      return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        life: (1 + wave * 0.28) * (balance?.enemyHealthMultiplier ?? 1),
        speed: (1.05 + Math.random() * 0.55 + wave * 0.04) * (balance?.enemySpeedMultiplier ?? 1),
      };
    });
    this.enemyMatrices = new Float32Array(count * 16);
    this.syncEnemyInstances();
  }

  private updateEnemies(delta: number): void {
    if (!this.player || !this.enemyMesh) return;
    for (const enemy of this.enemies) {
      const dx = this.player.position.x - enemy.x;
      const dz = this.player.position.z - enemy.z;
      const distance = Math.hypot(dx, dz) || 1;
      enemy.x += (dx / distance) * enemy.speed * delta;
      enemy.z += (dz / distance) * enemy.speed * delta;
      if (distance < 0.72) this.life -= delta * (5 + this.wave * 0.8) * (this.options.arenaBalance?.enemyDamageMultiplier ?? 1);
    }
    if (this.life <= 0) {
      this.lives -= 1;
      this.life = this.options.arenaBalance?.maxLife ?? 100;
      this.player.position.set(0, 0, 0);
      if (this.lives <= 0) {
        this.lives = 3;
        this.startWave(1);
      }
    }
    this.syncEnemyInstances();
  }

  private syncEnemyInstances(): void {
    if (!this.enemyMesh) return;
    if (this.enemyMatrices.length !== this.enemies.length * 16) this.enemyMatrices = new Float32Array(this.enemies.length * 16);
    const matrix = Matrix.Identity();
    this.enemies.forEach((enemy, index) => {
      Matrix.TranslationToRef(enemy.x, 0.9, enemy.z, matrix);
      matrix.copyToArray(this.enemyMatrices, index * 16);
    });
    this.enemyMesh.thinInstanceSetBuffer("matrix", this.enemyMatrices, 16, true);
    this.enemyMesh.thinInstanceCount = this.enemies.length;
  }

  private spawnProjectile(direction: Vector3, scale: number): void {
    if (!this.scene || !this.player) return;
    const mesh = MeshBuilder.CreateSphere("ember-projectile", { diameter: 0.22 * scale, segments: 8 }, this.scene);
    mesh.position.copyFrom(this.player.position.add(new Vector3(0, 1.05, 0)));
    mesh.material = this.createPbr(this.scene, "projectile-material", "#ff7a2e", 0.1, 0.2, "#ff4c11");
    const baseDamage = 0.85 + (this.options.arenaBalance?.attackDamage ?? 15) / 52;
    this.projectiles.push({ mesh, velocity: direction.scale(12), life: 1.5, damage: baseDamage * scale });
  }

  private updateProjectiles(delta: number): void {
    if (this.options.mode !== "arena") return;
    for (const projectile of this.projectiles) {
      projectile.mesh.position.addInPlace(projectile.velocity.scale(delta));
      projectile.life -= delta;
      const hitIndex = this.enemies.findIndex((enemy) => Math.hypot(projectile.mesh.position.x - enemy.x, projectile.mesh.position.z - enemy.z) < 0.65);
      if (hitIndex >= 0) {
        this.enemies[hitIndex].life -= projectile.damage;
        projectile.life = 0;
        if (this.enemies[hitIndex].life <= 0) {
          this.enemies.splice(hitIndex, 1);
          this.enemiesSlain += 1;
        }
      }
    }
    const expired = this.projectiles.filter((projectile) => projectile.life <= 0);
    expired.forEach((projectile) => projectile.mesh.dispose());
    this.projectiles = this.projectiles.filter((projectile) => projectile.life > 0);
    const finalWave = this.options.arenaBalance?.waves ?? 6;
    if (this.enemies.length === 0 && this.wave < finalWave) this.startWave(this.wave + 1);
    if (this.enemies.length === 0 && this.wave === finalWave && !this.arenaCompleted) {
      this.arenaCompleted = true;
      this.options.onArenaComplete({ wave: this.wave, enemiesSlain: this.enemiesSlain, elapsedSeconds: Math.round(this.elapsed) });
    }
  }

  private getHud(): WorldHudState {
    return {
      fps: Math.round(this.engine?.getFps() ?? 0),
      mode: this.options.mode,
      wave: this.wave,
      enemies: this.enemies.length,
      life: Math.max(0, this.life),
      maxLife: this.options.arenaBalance?.maxLife ?? 100,
      focus: this.focus,
      maxFocus: this.options.arenaBalance?.maxFocus ?? 100,
    };
  }
}
