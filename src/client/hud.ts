// HudState (contracts/ui.ts) from the replicated world: the local PlayerView (life, focus, slots, flasks — the
// server sends these only for the viewer), the RunView, the zone, portal info, the character (level/xp) and the
// personal luck. Pure; rebuilt ~15 Hz by the app.
import { LOADOUT_KEYS, LOADOUT_SLOTS, BELT_SLOTS } from '../contracts/items';
import type { CharacterSave } from '../contracts/items';
import type { MonsterKind } from '../contracts/content';
import { PORTALS_PER_MAP } from '../contracts/net';
import type { PortalInfo, ZoneInfo } from '../contracts/net';
import type { PlayerView, WorldView } from '../contracts/sim';
import type { HudAlly, HudFlask, HudRun, HudSlot, HudState } from '../contracts/ui';

/** The last wave preview announced by a 'waveTell' event. */
export interface TellInfo {
  wave: number;
  families: MonsterKind[];
  lieutenant: boolean;
  boss: boolean;
  /** Client ms when it arrived. */
  at: number;
}

/** A tell stays up at most this long without its wave starting (ms). */
export const TELL_MAX_MS = 8000;

export interface HudInput {
  view: WorldView;
  localPlayerId: number;
  zone: ZoneInfo;
  characterId: string | null;
  character: CharacterSave | null;
  xpToNext: (level: number) => number;
  /** Hideout: the owner's open map portal. Map: this map's own portal info. */
  portal: PortalInfo | null;
  tell: TellInfo | null;
  /** The local player's personal luck in this map (map + own gear), or null outside maps. */
  luck: { itemQuantity: number; itemRarity: number } | null;
  modLines: string[];
  now: number;
  fps: number;
  pingMs: number;
  /** Keycap labels per loadout slot from the keyboard layout (AZERTY shows "A" for the Q slot); null = defaults. */
  keyLabels?: readonly string[] | null;
}

const EMPTY_SLOT = (key: string): HudSlot => ({
  key, skillId: null, cooldown: 0, cooldownTotal: 0, charges: 0, maxCharges: 0, focusCost: 0, usable: false,
});

export function hudSlots(p: PlayerView | null, keyLabels?: readonly string[] | null): HudSlot[] {
  const out: HudSlot[] = [];
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const key = keyLabels?.[i] || LOADOUT_KEYS[i];
    const s = p?.slots[i];
    if (!s || !s.skillId) {
      out.push(EMPTY_SLOT(key));
      continue;
    }
    out.push({
      key,
      skillId: s.skillId,
      cooldown: Math.max(0, s.cooldown),
      cooldownTotal: Math.max(0, s.cooldownTotal),
      charges: s.charges,
      maxCharges: s.maxCharges,
      focusCost: s.focusCost,
      usable: s.usable && !p!.dead,
    });
  }
  return out;
}

export function hudFlasks(p: PlayerView | null): (HudFlask | null)[] {
  const out: (HudFlask | null)[] = [];
  for (let i = 0; i < BELT_SLOTS; i++) {
    const f = p?.flasks[i] ?? null;
    out.push(
      f
        ? {
            key: String(i + 1),
            flaskId: f.flaskId,
            count: f.count,
            resource: f.resource,
            active: f.duration > 0 ? Math.min(1, Math.max(0, f.active / f.duration)) : 0,
          }
        : null,
    );
  }
  return out;
}

export function hudAllies(view: WorldView, localPlayerId: number): HudAlly[] {
  const out: HudAlly[] = [];
  for (const p of view.players) {
    if (p.id === localPlayerId) continue;
    out.push({ name: p.name, level: p.level, life: Math.max(0, p.life), maxLife: p.maxLife, dead: p.dead });
  }
  return out;
}

/** The tell to show: announced, its wave not started yet, and not stale. */
export function activeTell(tell: TellInfo | null, wave: number, now: number): TellInfo | null {
  if (!tell) return null;
  if (tell.wave <= wave && wave > 0) return null;
  if (now - tell.at > TELL_MAX_MS) return null;
  return tell;
}

export function hudRun(input: HudInput): HudRun | null {
  const { view, zone } = input;
  if (zone.kind !== 'map') return null;
  const r = view.run;
  const tell = activeTell(input.tell, r.wave, input.now);
  return {
    mapName: zone.mapName,
    tier: zone.tier,
    phase: r.phase,
    wave: r.wave,
    waveCount: r.waveCount,
    waveProgress: r.waveDuration > 0 ? Math.min(1, Math.max(0, r.waveTime / r.waveDuration)) : 0,
    monstersAlive: r.monstersAlive,
    kills: r.kills,
    elapsed: r.elapsed,
    boss: r.boss ? { ...r.boss } : null,
    lieutenant: r.lieutenant ? { ...r.lieutenant } : null,
    tell: tell ? { wave: tell.wave, families: tell.families, lieutenant: tell.lieutenant, boss: tell.boss } : null,
    itemQuantity: input.luck?.itemQuantity ?? 100,
    itemRarity: input.luck?.itemRarity ?? 100,
    modLines: input.modLines,
    portalsRemaining: input.portal?.remaining ?? 0,
    portalsTotal: input.portal?.total ?? PORTALS_PER_MAP,
  };
}

/**
 * The HUD to show between entering a zone and its first snapshot: the previous HUD re-labelled for the new zone
 * (so the command deck does not blink out), alive, without allies or run data from the old instance.
 */
export function provisionalHud(prev: HudState, zone: ZoneInfo, characterId: string | null): HudState {
  return {
    ...prev,
    zone: zone.kind,
    zoneOwnerName: zone.ownerName,
    zoneIsOwn: zone.ownerCharacterId === characterId,
    run: null,
    portal: zone.kind === 'hideout' ? zone.portal : null,
    allies: [],
    dead: false,
    wardFraction: 0,
  };
}

export function localPlayer(view: WorldView, id: number): PlayerView | null {
  for (const p of view.players) if (p.id === id) return p;
  return null;
}

/** The whole HUD, or null while the local player is not in the replicated world yet. */
export function buildHud(input: HudInput): HudState | null {
  const me = localPlayer(input.view, input.localPlayerId);
  if (!me) return null;
  const ch = input.character;
  const level = ch?.level ?? me.level;
  return {
    zone: input.zone.kind,
    zoneOwnerName: input.zone.ownerName,
    zoneIsOwn: input.zone.ownerCharacterId === input.characterId,
    life: Math.max(0, Math.round(me.life)),
    maxLife: Math.max(1, Math.round(me.maxLife)),
    focus: Math.max(0, Math.round(me.focus)),
    maxFocus: Math.max(1, Math.round(me.maxFocus)),
    wardFraction: me.wardDuration > 0 ? Math.min(1, Math.max(0, me.wardTime / me.wardDuration)) : 0,
    level,
    xp: ch?.xp ?? 0,
    xpToNext: input.xpToNext(level),
    slots: hudSlots(me, input.keyLabels),
    flasks: hudFlasks(me),
    run: hudRun(input),
    portal: input.zone.kind === 'hideout' ? input.portal : null,
    allies: hudAllies(input.view, input.localPlayerId),
    fps: Math.round(input.fps),
    pingMs: Math.round(input.pingMs),
    dead: me.dead,
  };
}

/** The key codes behind the loadout slots (slot 0 is the left mouse button), for keyboard-layout keycap labels. */
export const LOADOUT_KEY_CODES: readonly (string | null)[] = [null, 'Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyF'];

/**
 * Keycap labels for the loadout slots from a keyboard layout map (navigator.keyboard.getLayoutMap(): code → the
 * character that key types). Input uses physical positions, so on AZERTY the "Q" slot is the key labelled A.
 * Null when the layout says nothing different from the defaults.
 */
export function loadoutKeyLabels(layout: { get(code: string): string | undefined }): string[] | null {
  let differs = false;
  const labels = LOADOUT_KEY_CODES.map((code, i) => {
    const fallback = LOADOUT_KEYS[i];
    if (!code || code === 'Space') return fallback;
    const ch = layout.get(code);
    if (typeof ch !== 'string' || ch.trim().length !== 1) return fallback;
    const label = ch.toUpperCase();
    if (label !== fallback) differs = true;
    return label;
  });
  return differs ? labels : null;
}
