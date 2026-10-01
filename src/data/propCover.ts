// Cover height of every prop kind (docs/atlas-rework/D-territory.md 10.8, GAME_SPEC combat/props).
//
// A prop that blocks MOVEMENT (radius > 0) may or may not block SHOTS:
//   tall  stops straight-flying projectiles of players and monsters (pillars, stones, vats, hoists, full walls ...)
//   low   shots fly over it (rubble, crates, rails, chain posts, braziers, crystals ...); it still blocks walking
//   none  nothing: walk-through decor
// Lobbed projectiles (Cinder Spitter, Tar Slinger) and nova rings fly over everything, whatever the cover.
// A prop with radius 0 never blocks anything. A layout can override the default per landmark, cluster or wall
// (`cover` in the layout schema), e.g. a crate RAIL is low while a crate STACK is tall.
import type { PropCover, PropKind } from '../contracts/sim';

export type { PropCover };

/** Default cover of each prop kind (applies when the prop has a solid radius). */
export const PROP_COVER: Readonly<Record<PropKind, PropCover>> = {
  // Hideout stations and map furniture. The map device is a tall plinth; the rest are waist-high.
  mapDevice: 'tall', stash: 'low', merchant: 'low', debugMerchant: 'low', portal: 'none', returnPortal: 'none', chest: 'low',
  // Old generator decor.
  pillar: 'tall', brazier: 'low', standingStone: 'tall', rubble: 'low', bones: 'low', crystal: 'low', banner: 'low', anvil: 'low', ruinWall: 'tall',
  // Art kit (D 10.5).
  vat: 'tall', bellows: 'low', altar: 'low', sarcophagus: 'tall', choirStall: 'low', ribArch: 'tall', iceColumn: 'tall',
  crate: 'low', chainPost: 'low', hoist: 'tall', gate: 'tall', weaponRack: 'low', obelisk: 'tall', statue: 'tall',
};

let enabled = true;

/** Test / balance-probe switch: with cover off every prop is flown over (the pre-cover game). Never used in production. */
export function setCoverEnabled(on: boolean): void {
  enabled = on;
}

/** The cover a prop actually provides: nothing without a solid radius, else its override, else the kind's default. */
export function coverOf(kind: PropKind, radius: number, override?: PropCover): PropCover {
  if (!(radius > 0)) return 'none';
  if (!enabled) return 'low';
  return override ?? PROP_COVER[kind];
}
