// Music selection and energy. Pure: the app calls these every frame and forwards changes to the AudioEngine.
import type { MusicId } from '../contracts/audio';
import type { Theme } from '../contracts/content';
import type { RunView } from '../contracts/sim';
import type { Screen } from '../contracts/ui';

/**
 * The colour of the 'map' / 'boss' music (src/audio setMusicTheme): the map base's theme inside a map (icy bells for
 * the Rimed Ossuary, war drums for the Iron Coliseum), the plain forge tracks everywhere else. A reconnect keeps
 * the zone, so it keeps its colour too.
 */
export function musicThemeFor(zone: { kind: 'hideout' | 'map'; theme: Theme } | null): Theme | null {
  return zone && zone.kind === 'map' ? zone.theme : null;
}

/** Title theme outside the game, the zone's track inside, the boss track while the map's boss lives. */
export function musicFor(screen: Screen, zone: 'hideout' | 'map' | null, run: RunView | null): MusicId | null {
  if (screen !== 'game' || !zone) return screen === 'loading' ? null : 'title';
  if (zone === 'hideout') return 'hideout';
  if (run && run.boss && run.phase !== 'cleared' && run.phase !== 'failed') return 'boss';
  return 'map';
}

/**
 * 0..1 music energy from wave pressure: the living horde (saturating around 140), how far into the run the
 * waves are, a lieutenant on the field, and the boss. Calm in hideouts and after the clear.
 */
export function intensityFor(zone: 'hideout' | 'map' | null, run: RunView | null): number {
  if (zone !== 'map' || !run) return 0;
  if (run.phase === 'cleared' || run.phase === 'failed') return 0.1;
  if (run.boss) return 1;
  const horde = Math.min(1, run.monstersAlive / 140);
  const progress = run.waveCount > 0 ? Math.min(1, Math.max(0, run.wave / run.waveCount)) : 0;
  const tell = run.phase === 'tell' ? 0.1 : 0;
  const lieutenant = run.lieutenant ? 0.2 : 0;
  return Math.min(1, 0.2 + 0.45 * horde + 0.2 * progress + tell + lieutenant);
}

/** Moves `current` toward `target` at `rate` per second (smooth, frame-rate independent enough for music). */
export function approach(current: number, target: number, rate: number, dt: number): number {
  const step = rate * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}
