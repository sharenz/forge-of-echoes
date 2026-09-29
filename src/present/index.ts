// Presentation layer (contracts/present.ts): WorldView + cosmetic events → renderer draw calls, particles,
// lights, camera and sound.
//
//   const presenter = createPresenter(renderer, art, audio);   // registers art.sprites if the renderer lacks them
//   on zone change:  presenter.reset(world, localPlayerId);   // clears corpses/particles, rebuilds the ground cache,
//                                                              // snaps the camera (also auto-detected: theme/arena
//                                                              // change or the world clock jumping backwards)
//   every frame:     presenter.frame({ world, localPlayerId, alpha, dt, events, cursorWorld, hoverPropId,
//                                      hoverDropId, settings: { screenShake }, paused });
//   mouse → world:   renderer.screenToWorld(cssX, cssY, presenter.camera)
//   hover / click:   presenter.dropAt(cssX, cssY) → PresentInput.hoverDropId (and the 'pickup' click; test it first:
//                    a click on a label beats the basic attack), else
//                    pickInteractiveProp(world.props, cursorWorld.x, cursorWorld.y) → PresentInput.hoverPropId
//                    (hideout objects incl. the Crafting Bench anvil). An open portal or return portal the client picks
//                    itself may be passed as hoverPropId too: it gets the same highlight.
//
// Conventions for callers:
//  • `events` are the cosmetic events since the last frame, in order; the presenter plays their sounds (positional
//    against the listener it sets every frame) and their visuals. It never touches music: the client owns
//    setMusic/setIntensity (e.g. 'boss' when RunView.boss appears).
//  • Drops are drawn for `spec.owner === localPlayerId` (instanced loot) and `spec.owner === 0` (public drops,
//    marked with a bone "ground" pip on their label); other players' own loot never is, so a server-side
//    SimRun.view with everyone's drops can be fed directly (dev sandboxes). dropAt() hit-tests exactly those.
//  • dropAt(cssX, cssY) answers from the last drawn frame's layout — plates first (top-most first), then sprites
//    (lowest on screen first) — so it returns exactly what the player sees under the cursor; −1 = none. Use it for
//    PresentInput.hoverDropId (the client sets the hand cursor) and, on a left click, send 'pickup' for it before
//    anything else.
//  • 'pickup' events carry the picker: only the local player's own pickups sound; someone else lifting a public
//    drop shows a soft poof.
//  • Level-ups are detected from PlayerView.level increasing (fx + 'levelUp' sound); no event is needed.
//  • Cosmetic slow-motion (unique drops, boss phases/deaths) slows particles and effects only; entities always
//    render at their true interpolated positions.
//  • Call reset() on every 'zone' message: two hideouts share a theme and arena radius, so auto-detection alone
//    cannot tell a party member's hideout from your own.
//  • The camera zoom stays 1 in the game (pixel-perfect); screen shake follows settings.screenShake and is damped
//    while `paused`.
//  • Party colours (ally name plates, rings, off-screen markers) come from partyColorSlots(names): stable per
//    character name on every client and in every zone. The UI's party panel should use the same function with the
//    party members' names and PARTY_COLORS so both agree.
//  • Off-screen markers for rare packs, the Herald and the Matriarch need those monsters in the view: the snapshot
//    encoder has to send rare+ monsters regardless of the area of interest (src/net).
//
// Dependencies: contracts and core, plus the pure `sfxImpactDelay` table lookup from src/audio/sfx so flashes,
// hit-stops and beams land on the frame a sound's transient is heard.
//
// Module map: ground.ts (tiles, veins, rim, light pools) · props.ts · players.ts · monsters.ts ·
// projectiles.ts · areas.ts · motes.ts · drops.ts (+ labels.ts stacking) · fx.ts (pooled transient effects) ·
// events.ts (event → visuals; per-frame shake/hurt/crit budgets) · heat.ts (impact-convergence guard and the
// per-frame Proximity budget that keeps stacked danger telegraphs, meteor showers and fire pools from summing into a
// white blob over the player) ·
// sound.ts (event → sfx + throttle) · camera.ts · post.ts · indicators.ts · ambience.ts · themes.ts (per-theme
// mood) · direction.ts (facing hysteresis) · names.ts (rare names) · party.ts (stable party colours).
//
// Dev sandbox: /dev/present.html runs the real sim with bot players; add ?net=1 to render through the real network
// path (snapshot encoder → ClientWorld interpolation/prediction → EventTimeline). See src/present/dev/sandbox.ts.
import type { ArtBundle } from '../contracts/art';
import type { AudioEngine, PlayOptions, SfxId } from '../contracts/audio';
import type { Presenter, PresentInput } from '../contracts/present';
import type { Camera, Renderer } from '../contracts/render';
import type { PlayerView, WorldView } from '../contracts/sim';
import { sfxImpactDelay } from '../audio/sfx';
import { Ambience } from './ambience';
import { AreaPainter } from './areas';
import { CameraRig } from './camera';
import { createFrameCtx, type FrameCtx } from './context';
import { DropPainter } from './drops';
import { EventFx } from './events';
import { Effects } from './fx';
import { Ground } from './ground';
import { Indicators } from './indicators';
import { clamp, clamp01 } from './math';
import { MonsterPainter } from './monsters';
import { MotePainter } from './motes';
import { Pen } from './pen';
import { PlayerPainter } from './players';
import { PostState } from './post';
import { ProjectilePainter } from './projectiles';
import { PropPainter } from './props';
import { SoundDirector } from './sound';
import { SpriteTable, WandTips } from './sprites';
import { THEME_LOOKS } from './themes';

export { facingFromVector, spriteDir } from './direction';
export { dropLabelLook, isDropVisible, isPublicDrop, type DropLabelLook } from './drops';
export { LabelStacker } from './labels';
export { pickInteractiveProp } from './props';
export { eliteName, MonsterNameCache, MONSTER_NAMES } from './names';
export { PARTY_COLORS, partyColorSlots } from './party';
export { SoundDirector, SFX_LIMITS } from './sound';
export { THEME_LOOKS, type ThemeLook } from './themes';

/** View margin (world units) around the camera rectangle inside which things are drawn. */
const VIEW_MARGIN = 24;

class WorldPresenter implements Presenter {
  private readonly r: Renderer;
  private readonly audio: AudioEngine;
  private readonly pen: Pen;
  private readonly table: SpriteTable;
  private readonly rig = new CameraRig();
  private readonly ground = new Ground();
  private readonly fx: Effects;
  private readonly post = new PostState();
  private readonly props: PropPainter;
  private readonly players: PlayerPainter;
  private readonly monsters: MonsterPainter;
  private readonly projectiles: ProjectilePainter;
  private readonly areas = new AreaPainter();
  private readonly motes = new MotePainter();
  private readonly drops: DropPainter;
  private readonly indicators = new Indicators();
  private readonly ambience = new Ambience();
  private readonly events: EventFx;
  private readonly sound: SoundDirector;
  private ctx: FrameCtx | null = null;
  private world: WorldView | null = null;
  private localId = 0;
  private zoneTheme = '';
  private zoneRadius = -1;
  private lastTick = 0;
  private time = 0;
  /** The local player was not in the world at the last reset: snap the camera onto her when she appears. */
  private snapPending = true;
  private readonly playOpts: PlayOptions = { x: undefined, y: undefined, volume: 1, pitch: 1 };
  private readonly frameSetup = { camera: null as unknown as Camera, ambient: THEME_LOOKS.hideout.ambient, time: 0, clearColor: THEME_LOOKS.hideout.clear };

  constructor(renderer: Renderer, art: ArtBundle, audio: AudioEngine) {
    this.r = renderer;
    this.audio = audio;
    if (!renderer.hasSprite('sorceress/idle/south')) renderer.registerSprites(art.sprites);
    this.pen = new Pen(renderer);
    this.fx = new Effects((text, scale) => renderer.measureText(text, scale));
    this.table = new SpriteTable(renderer);
    const tips = new WandTips(art.sprites);
    this.props = new PropPainter(this.table);
    this.monsters = new MonsterPainter(this.table);
    this.projectiles = new ProjectilePainter(this.table);
    this.drops = new DropPainter(sfxImpactDelay, this.table);
    this.sound = new SoundDirector((id, x, y, volume, pitch) => this.playSfx(id, x, y, volume, pitch));
    this.players = new PlayerPainter(tips, {
      levelUp: (p, x, y) => this.levelUp(p, x, y),
    });
    this.events = new EventFx({
      pen: this.pen, fx: this.fx, rig: this.rig, post: this.post, players: this.players, props: this.props, table: this.table,
      impactDelay: sfxImpactDelay,
    });
  }

  get camera(): Camera {
    return this.rig.camera;
  }

  reset(world: WorldView, localPlayerId: number): void {
    this.world = world;
    this.localId = localPlayerId;
    this.zoneTheme = world.theme;
    this.zoneRadius = world.arenaRadius;
    this.lastTick = world.tick;
    this.ground.build(world.theme, world.arenaRadius);
    this.fx.clear();
    // Keep running screen flashes: the portal-colour flash of the step through bridges the cut into the new zone.
    this.post.reset();
    this.events.reset();
    this.props.reset();
    this.players.reset();
    this.monsters.reset();
    this.drops.reset();
    this.motes.reset();
    this.r.clearParticles();
    // The client resets on the 'zone' message, before the first snapshot: with nobody in the world yet, keep the
    // camera where it is and snap onto the local player the moment she appears (no visible pan from the origin).
    const me = findPlayer(world, localPlayerId);
    if (me) this.rig.reset(me.x, me.y - 6);
    this.snapPending = !me;
    this.ctx = createFrameCtx(world);
  }

  frame(input: PresentInput): void {
    const world = input.world;
    // Auto-reset on a new world, zone look or a clock that jumped backwards (new instance). The client should
    // still call reset() on every zone change (two hideouts share a theme and radius).
    if (
      !this.ctx || world !== this.world || world.theme !== this.zoneTheme || world.arenaRadius !== this.zoneRadius ||
      world.tick + 30 < this.lastTick || input.localPlayerId !== this.localId
    ) {
      this.reset(world, input.localPlayerId);
    }
    this.lastTick = world.tick;
    const f = this.ctx!;
    const dt = clamp(Number.isFinite(input.dt) ? input.dt : 0, 0, 0.1);
    this.time += dt;
    this.post.update(dt);
    const fxDt = dt * this.post.timeScale;

    // --- frame context ---------------------------------------------------------------------------------------
    const local = findPlayer(world, input.localPlayerId);
    f.time = this.time;
    f.dt = dt;
    f.fxDt = fxDt;
    f.alpha = clamp01(input.alpha);
    f.localId = input.localPlayerId;
    f.local = local;
    f.world = world;
    f.theme = world.theme;
    f.look = THEME_LOOKS[world.theme] ?? THEME_LOOKS.hideout;
    f.hoverPropId = Number.isInteger(input.hoverPropId) ? input.hoverPropId : -1;
    f.hoverDropId = Number.isInteger(input.hoverDropId) ? input.hoverDropId : -1;
    f.lights.reset();

    // --- camera + listener (before this frame's sounds) ----------------------------------------------------------
    let px = this.rig.camera.x;
    let py = this.rig.camera.y;
    let ax = px;
    let ay = py;
    if (local) {
      px = local.prevX + (local.x - local.prevX) * f.alpha;
      py = local.prevY + (local.y - local.prevY) * f.alpha;
      ax = local.dead ? px : input.cursorWorld.x;
      ay = local.dead ? py : input.cursorWorld.y;
      if (this.snapPending) {
        this.rig.reset(px, py - 6);
        this.snapPending = false;
      }
    }
    const cam = this.rig.update(dt, px, py, ax, ay, input.settings.screenShake, input.paused);
    this.audio.setListener(local ? px : cam.x, local ? py : cam.y);
    const v = f.view;
    const zoom = cam.zoom > 0 ? cam.zoom : 1;
    f.zoom = zoom;
    v.halfW = this.r.viewWidth / 2 / zoom;
    v.halfH = this.r.viewHeight / 2 / zoom;
    v.cx = cam.x + (cam.shakeX ?? 0);
    v.cy = cam.y + (cam.shakeY ?? 0);
    v.x0 = v.cx - v.halfW - VIEW_MARGIN;
    v.x1 = v.cx + v.halfW + VIEW_MARGIN;
    v.y0 = v.cy - v.halfH - VIEW_MARGIN;
    v.y1 = v.cy + v.halfH + VIEW_MARGIN;

    // --- events: visuals + sound -----------------------------------------------------------------------------
    this.sound.beginFrame(this.time);
    this.events.beginFrame(dt);
    const events = input.events;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      this.events.handle(e, f);
      this.sound.handle(e, input.localPlayerId);
    }
    this.events.endFrame(f);

    // --- draw ------------------------------------------------------------------------------------------------
    const r = this.r;
    const pen = this.pen;
    const setup = this.frameSetup;
    setup.camera = cam;
    setup.ambient = f.look.ambient;
    setup.time = this.time;
    setup.clearColor = f.look.clear;
    r.beginFrame(setup);
    this.ground.draw(pen, f);
    this.ground.lightsAndHaze(pen, f);
    this.fx.update(fxDt, pen);
    this.fx.decals.draw(pen, f);
    this.fx.corpses.draw(pen, f);
    this.areas.draw(pen, f);
    this.props.draw(pen, f);
    this.drops.draw(pen, f);
    this.motes.draw(pen, f);
    this.monsters.draw(pen, f);
    this.players.draw(pen, f);
    this.projectiles.draw(pen, f);
    this.fx.rings.draw(pen);
    this.fx.chains.draw(pen);
    this.fx.pulses.draw(pen);
    this.fx.sprites.draw(pen);
    this.ambience.update(pen, f, world.arenaRadius);
    // Overlays ('top', submission order): numbers and texts, then loot labels, the hovered prop's name, then edge
    // markers.
    this.fx.numbers.draw(pen);
    this.fx.texts.draw(pen);
    this.drops.drawLabels(pen);
    this.props.drawHoverLabel(pen);
    this.indicators.draw(pen, f, this.monsters, this.players);
    r.updateParticles(fxDt);
    const lowLife = local && !local.dead && local.maxLife > 0 ? clamp01(1 - local.life / local.maxLife / 0.3) : 0;
    r.endFrame(this.post.build(f.look, dt, !!local && local.dead, lowLife, this.time));
  }

  dropAt(cssX: number, cssY: number): number {
    if (!this.ctx || !Number.isFinite(cssX) || !Number.isFinite(cssY)) return -1;
    const w = this.r.screenToWorld(cssX, cssY, this.rig.camera);
    return this.drops.dropAt(w.x, w.y);
  }

  private playSfx(id: SfxId, x: number | undefined, y: number | undefined, volume: number, pitch: number): void {
    const o = this.playOpts;
    o.x = x;
    o.y = y;
    o.volume = volume;
    o.pitch = pitch;
    this.audio.play(id, o);
  }

  private levelUp(p: PlayerView, x: number, y: number): void {
    const local = p.id === this.localId;
    this.events.levelUp(x, y, local, p.level);
    if (local) this.sound.play('levelUp', undefined, undefined, 1, 1);
    else this.sound.play('levelUp', x, y, 0.6, 1);
  }
}

function findPlayer(world: WorldView, id: number): PlayerView | null {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
  return null;
}

export function createPresenter(renderer: Renderer, art: ArtBundle, audio: AudioEngine): Presenter {
  return new WorldPresenter(renderer, art, audio);
}
