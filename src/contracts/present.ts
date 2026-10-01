// FROZEN CONTRACT — presentation layer (browser): turns a WorldView (the client's replicated, interpolated world)
// + cosmetic events into renderer draw calls, particles, lights, camera motion and sound.
// src/present/index.ts must export
//   `export function createPresenter(renderer: Renderer, art: ArtBundle, audio: AudioEngine): Presenter`.
//
// The WorldView here is normally a ClientWorld's view (src/net): remote entities interpolated between two
// snapshots (prevX → x with `alpha`), the local player predicted. Drops in it are only the local player's own
// (instanced loot). In dev sandboxes it may be a server-side SimRun.view directly.
import type { ArtBundle } from './art';
import type { AudioEngine } from './audio';
import type { Camera, Renderer } from './render';
import type { SimEvent, WorldView } from './sim';

export interface PresentInput {
  world: WorldView;
  /** The player this client controls (camera target, own-player sounds, name plates of allies). */
  localPlayerId: number;
  /** 0..1 fraction between prev and current positions (render interpolation). */
  alpha: number;
  /** Real seconds since the last rendered frame (clamped). */
  dt: number;
  /** Cosmetic events received since the last frame. */
  events: SimEvent[];
  /** Cursor position in world coordinates. */
  cursorWorld: { x: number; y: number };
  /** Prop id under the cursor (hideout objects, portals, return portal) for the hover highlight, or -1. */
  hoverPropId: number;
  /** Drop id under the cursor (label / sprite highlight), or -1. */
  hoverDropId: number;
  /** Optional framing offset in world units (the hideout leans north so its Map Device is always fully in view). Eased by the camera. */
  cameraBias?: { x: number; y: number };
  settings: { screenShake: number };
  /** Menu open: render normally but damp camera shake; the world keeps running online. */
  paused: boolean;
}

export interface Presenter {
  /** Camera used for the last frame (for screen ↔ world conversion). */
  readonly camera: Camera;
  /** Called when entering a new zone: reset corpses, particles, camera snap, ground cache. */
  reset(world: WorldView, localPlayerId: number): void;
  frame(input: PresentInput): void;
  /**
   * Id of the drop whose label plate or sprite is under the CSS point, using the last frame's label layout
   * (labels are stacked/shifted, so only the presenter knows where they are). -1 = none.
   */
  dropAt(cssX: number, cssY: number): number;
}

export type CreatePresenter = (renderer: Renderer, art: ArtBundle, audio: AudioEngine) => Presenter;
