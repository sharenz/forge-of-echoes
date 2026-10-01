// Dev sound board for the procedural audio engine (dev/audio.html). Not shipped with the game:
// nothing in src/ imports this file.
import '@fontsource/cinzel/600.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import { MUSIC_IDS, SFX_IDS, type MusicId, type SfxId } from '../../contracts/audio';
import type { Theme } from '../../contracts/content';
import {
  analyzeAllColours, analyzeAllCoTriggers, analyzeAllMusic, analyzeAllSfx, analyzeBankParity, analyzeColour, analyzeCoTrigger, analyzeCpu,
  analyzeSegments, analyzeStress, analyzeThemedMusic, MUSIC_INTENSITIES, outputMono, renderMusic, renderSfx, spectrogram, suggestMusicTrims,
  suggestSfxTrims,
  type ColourReport, type CoTriggerReport, type CpuReport, type MusicReport, type ParityRow, type SfxReport, type Spectrogram, type StressReport,
} from '../analysis';
import { WebAudioEngine } from '../engine';
import { MIX_GAIN_DB } from '../levels';
import { AUDIBLE_RADIUS, spatialize } from '../mixing';
import { SFX, type SfxGroup } from '../sfx';

// ---------------------------------------------------------------------------
// Presentation data
// ---------------------------------------------------------------------------

const GROUPS: { key: SfxGroup[]; title: string; accent: string; ids: SfxId[] }[] = [
  { key: ['skill'], title: 'Skills', accent: 'var(--ember)', ids: ['castEmber', 'castNova', 'castWave', 'castFrost', 'castArc', 'dash', 'ward', 'notEnoughFocus'] },
  { key: ['combat'], title: 'Impacts', accent: 'var(--blood-bright)', ids: ['hitFire', 'hitCold', 'hitLightning', 'hitVoid', 'hitPhysical', 'crit', 'evade'] },
  { key: ['monster', 'boss'], title: 'Monsters', accent: 'var(--olive-bright)', ids: ['monsterDeath', 'monsterDeathBig', 'monsterAttack', 'monsterSpit', 'monsterLeap', 'monsterSlam', 'heraldCall', 'bossRoar', 'bossSlam', 'eruption'] },
  { key: ['loot'], title: 'Loot', accent: 'var(--rare)', ids: ['dropNormal', 'dropMagic', 'dropRare', 'dropUnique', 'dropCurrency', 'dropMap', 'pickupItem', 'pickupCurrency', 'mote'] },
  { key: ['player'], title: 'Player', accent: 'var(--burgundy-bright)', ids: ['playerHurt', 'playerDeath', 'levelUp', 'flaskLife', 'flaskFocus', 'allyJoin'] },
  { key: ['flow'], title: 'Run flow', accent: 'var(--bone)', ids: ['waveTell', 'waveStart', 'bossSpawn', 'cleared', 'chestOpen', 'portalOpen', 'portalEnter'] },
  { key: ['craft'], title: 'Crafting', accent: 'var(--void-glow)', ids: ['craftArm', 'craftApply', 'craftRare', 'craftScar', 'craftFinish', 'craftCorrupt'] },
  { key: ['ui'], title: 'Interface', accent: 'var(--stone-light)', ids: ['uiClick', 'uiHover', 'uiOpen', 'uiClose', 'uiError', 'equip', 'buy', 'partyInvite', 'chat'] },
  {
    key: ['player'], title: 'Debuffs', accent: 'var(--frost)',
    ids: ['debuffChill', 'debuffFreeze', 'debuffRoot', 'debuffBurn', 'debuffBleed', 'debuffShock', 'debuffWither', 'debuffCleanse'],
  },
  {
    key: ['monster', 'boss'], title: 'Rimed Ossuary', accent: 'var(--ice)',
    ids: ['boneRattle', 'ghostWail', 'webShot', 'wispPulse', 'wispBurst', 'golemSlam', 'choirSing', 'wardenNova', 'glacialSpikes', 'icePrison', 'blizzardLoop'],
  },
  {
    key: ['monster', 'combat', 'boss'], title: 'Iron Coliseum', accent: 'var(--rust-bright)',
    ids: ['houndBite', 'chainThrow', 'crossbowAim', 'crossbowShot', 'shieldBlock', 'tarSplat', 'chainWhirl', 'varkusCharge', 'varkusWhirl', 'executionMark', 'arenaSpikes', 'crowdRoar'],
  },
  {
    key: ['flow'], title: 'Map events', accent: 'var(--bone)',
    ids: ['eventOmen', 'eventOnset', 'eventStep', 'eventLock', 'eventWhiff', 'eventHit', 'eventReturn', 'eventSeal', 'eventErupt', 'eventBronze', 'eventSilver', 'eventGold', 'eventFail', 'eventBeat',
      'eventHum', 'wheelBreak', 'shieldBreak'],
  },
  {
    key: ['flow'], title: 'Map events: choices and wave 2', accent: 'var(--bone)',
    ids: ['pactStone', 'pactSeal', 'pactWave', 'bloomGrow', 'bloomHarvest', 'bloomBite', 'bloomWither', 'ringRise', 'ringChain', 'ringSlam',
      'hostThaw', 'prismShatter', 'hostWake', 'anvilStrike', 'anvilCharged', 'anvilForge', 'bellToll', 'cantorFall', 'dirge',
      'voidTide', 'voidSurge', 'heartCrack'],
  },
];

const LABELS: Record<SfxId, string> = {
  castEmber: 'Ember Lance', castNova: 'Ember Nova', castWave: 'Flame Wave', castFrost: 'Rime Shards', castArc: 'Arc Chain',
  dash: 'Rift Step', ward: 'Cinder Ward', notEnoughFocus: 'No Focus',
  hitFire: 'Fire hit', hitCold: 'Cold hit', hitLightning: 'Lightning hit', hitVoid: 'Void hit', hitPhysical: 'Physical hit', crit: 'Critical', evade: 'Evade',
  monsterDeath: 'Death', monsterDeathBig: 'Big death', monsterAttack: 'Bite', monsterSpit: 'Spit', monsterLeap: 'Leap', monsterSlam: 'Slam',
  heraldCall: 'Herald call', bossRoar: 'Boss roar', bossSlam: 'Boss slam', eruption: 'Eruption',
  playerHurt: 'Hurt', playerDeath: 'Death', levelUp: 'Level up', flaskLife: 'Life flask', flaskFocus: 'Focus flask', allyJoin: 'Ally joins', partyInvite: 'Party invite', chat: 'Chat',
  dropNormal: 'Normal drop', dropMagic: 'Magic drop', dropRare: 'Rare drop', dropUnique: 'Unique drop', dropCurrency: 'Currency drop',
  dropMap: 'Map drop', pickupItem: 'Pick up item', pickupCurrency: 'Pick up coin', mote: 'Echo mote',
  waveTell: 'Wave tell', waveStart: 'Wave start', bossSpawn: 'Boss spawn', cleared: 'Map cleared', chestOpen: 'Chest open',
  portalOpen: 'Portal open', portalEnter: 'Portal enter',
  uiClick: 'Click', uiHover: 'Hover', uiOpen: 'Open panel', uiClose: 'Close panel', uiError: 'Error', equip: 'Equip', buy: 'Buy',
  craftArm: 'Arm currency', craftApply: 'Apply', craftRare: 'Rare result', craftScar: 'Scar', craftFinish: 'Finished', craftCorrupt: 'Corrupt',
  debuffChill: 'Chilled', debuffFreeze: 'Frozen', debuffRoot: 'Rooted', debuffBurn: 'Burning', debuffBleed: 'Bleeding', debuffShock: 'Shocked',
  debuffWither: 'Withered', debuffCleanse: 'Cleansed',
  boneRattle: 'Bone Thrall', ghostWail: 'Rimeshade wail', webShot: 'Web shot', wispPulse: 'Wisp fuse', wispBurst: 'Wisp burst', golemSlam: 'Golem slam',
  choirSing: 'Choir Wave', wardenNova: 'Frost Nova', glacialSpikes: 'Glacial spike', icePrison: 'Ice Prison', blizzardLoop: 'Blizzard gust',
  houndBite: 'Hound bite', chainThrow: 'Chain hook', crossbowAim: 'Crossbow aim', crossbowShot: 'Crossbow shot', shieldBlock: 'Shield block',
  tarSplat: 'Tar splat', chainWhirl: 'Chain whirl', varkusCharge: 'Varkus charge', varkusWhirl: 'Whirlwind', executionMark: 'Execution Mark',
  arenaSpikes: 'Arena spikes', crowdRoar: 'Crowd roar',
  eventOmen: 'Event omen', eventOnset: 'Event onset', eventStep: 'Event step', eventLock: 'Pounce lock', eventWhiff: 'Whiff', eventHit: 'Event hit',
  eventReturn: 'Echo returns', eventSeal: 'Rift sealed', eventErupt: 'Rift erupts', eventBronze: 'Bronze', eventSilver: 'Silver', eventGold: 'Gold',
  eventFail: 'Event failed', eventBeat: 'Heartbeat',
  eventHum: 'Choir hum', wheelBreak: 'Wheel breaks', shieldBreak: 'Shield line breaks', pactStone: 'Pact stone', pactSeal: 'Pact sealed',
  pactWave: 'Pact wave', bloomGrow: 'Bloom grows', bloomHarvest: 'Bloom harvested', bloomBite: 'Bloom gnawed', bloomWither: 'Bloom withers',
  ringRise: 'Ring rises', ringChain: 'Chain wall', ringSlam: 'Champion slam', hostThaw: 'Statue thaws', prismShatter: 'Prism shatters',
  hostWake: 'Host wakes', anvilStrike: 'Anvil strike', anvilCharged: 'Anvil charged', anvilForge: 'Boon forged', bellToll: 'Bell toll',
  cantorFall: 'Cantor falls', dirge: 'Dirge', voidTide: 'Void tide', voidSurge: 'Void surge', heartCrack: 'Heart cracks',
};

const TRACK_LABELS: Record<MusicId, { name: string; note: string }> = {
  title: { name: 'Title', note: 'drones · distant bells' },
  hideout: { name: 'Hideout', note: 'fire · harp · warm pads' },
  map: { name: 'Map', note: 'pulse · intensity drums' },
  boss: { name: 'Boss', note: 'war drums · brass stabs' },
};

/** Map themes that colour the 'map' / 'boss' tracks (setMusicTheme). */
const THEME_LABELS: { theme: Theme | null; name: string; note: string }[] = [
  { theme: null, name: 'Forge', note: 'plain · anvils' },
  { theme: 'rimedOssuary', name: 'Ossuary', note: 'ice · bones' },
  { theme: 'ironColiseum', name: 'Coliseum', note: 'drums · crowd · claps' },
];

const STRESS_IDS: SfxId[] = ['hitFire', 'hitCold', 'hitPhysical', 'hitLightning', 'monsterDeath', 'mote', 'crit', 'castEmber'];

/** Scripted game moments that exercise the burst policies and duck merging. */
interface Moment {
  name: string;
  note: string;
  /** [delay s, id, x, y] — plays with the same delay land in the same frame. */
  plays: readonly (readonly [number, SfxId, number, number])[];
}

const ring = (n: number, r0: number, r1: number, id: SfxId, delay = 0): [number, SfxId, number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = i * 2.39996;
    const r = r0 + ((r1 - r0) * i) / Math.max(1, n - 1);
    return [delay, id, Math.cos(a) * r, Math.sin(a) * r];
  });

const MOMENTS: Moment[] = [
  {
    name: 'Nova · 20 kills', note: 'one frame → one massed death',
    plays: [[0, 'castNova', 0, 0], ...ring(20, 60, 170, 'hitFire', 0.12), ...ring(20, 60, 170, 'monsterDeath', 0.12)],
  },
  {
    name: 'Boss loot fountain', note: '1 rare · 2 magic · 6 currency',
    plays: [[0, 'dropRare', 30, -10], [0, 'dropMagic', -20, 5], [0, 'dropMagic', 10, 20], ...ring(6, 20, 50, 'dropCurrency')],
  },
  {
    name: 'Boss death stack', note: 'cleared · unique · rare · level up',
    plays: [[0, 'monsterDeathBig', 0, -40], [0, 'cleared', 0, 0], [0.05, 'dropUnique', 10, -20], [0.05, 'dropRare', -15, 10], [0.4, 'levelUp', 0, 0]],
  },
  {
    name: 'Mote vacuum', note: '120 motes over 1.5 s',
    plays: Array.from({ length: 120 }, (_, i) => [Math.floor(i / 1.3) / 60, 'mote', 0, 0] as const),
  },
  {
    name: 'Ossuary pack', note: 'thralls · wisp fuse → burst → freeze',
    plays: [
      ...ring(5, 60, 150, 'boneRattle'), [0.25, 'ghostWail', -120, -40], [0.4, 'webShot', 160, -60], [0.45, 'wispPulse', 40, 20],
      [0.5, 'debuffChill', 0, 0], [1.15, 'wispBurst', 40, 20], [1.15, 'debuffFreeze', 0, 0], [1.2, 'playerHurt', 0, 0],
    ],
  },
  {
    name: 'Hollow Warden', note: 'nova · spike line · ice prison',
    plays: [
      [0, 'wardenNova', 0, -60], ...Array.from({ length: 7 }, (_, i) => [0.9 + i * 0.08, 'glacialSpikes', -150 + i * 45, -40 + i * 10] as const),
      [1.9, 'icePrison', 0, 0], [2.0, 'choirSing', 120, -90], [3.4, 'debuffFreeze', 0, 0], [3.6, 'blizzardLoop', -80, 60],
    ],
  },
  {
    name: 'Coliseum volley', note: 'aim → bolts · shield clanks · bleed',
    plays: [
      [0, 'crossbowAim', 180, -40], [0.1, 'crossbowAim', -200, -20], [0.62, 'crossbowShot', 180, -40], [0.72, 'crossbowShot', -200, -20],
      [0.8, 'debuffBleed', 0, 0], ...Array.from({ length: 8 }, (_, i) => [1.1 + i * 0.11, 'shieldBlock', 90, 10] as const),
      [1.3, 'houndBite', 40, 30], [1.35, 'houndBite', -30, 40], [1.6, 'chainThrow', -140, 0], [1.9, 'debuffRoot', 0, 0], [2.2, 'tarSplat', 60, 60],
    ],
  },
  {
    name: 'Varkus', note: 'crowd · charge · 2-loop whirl · mark → strike',
    plays: [
      [0, 'crowdRoar', 0, 0], [0.9, 'varkusCharge', -120, 0], [1.9, 'varkusWhirl', 60, -30], [1.9 + 1.68, 'varkusWhirl', 50, -20],
      [5.6, 'executionMark', 0, 0], [5.78 + 3, 'bossSlam', 0, 0], [5.78 + 3, 'arenaSpikes', 0, 0], ...ring(6, 80, 200, 'arenaSpikes', 6.6),
    ],
  },
];

// ---------------------------------------------------------------------------
// Tiny DOM helper
// ---------------------------------------------------------------------------

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v as Record<string, string>)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else (el.style as unknown as Record<string, string>)[prop] = val;
      }
    }
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const fmt = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '−∞');

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface SoundForgeApi {
  engine: WebAudioEngine;
  play(id: SfxId): void;
  analyze(): Promise<SfxReport[]>;
  /** Raw (untrimmed) measurement → suggested trims. `ids` limits the SFX; `music: false` skips the tracks. */
  calibrate(opts?: { ids?: SfxId[]; music?: boolean }): Promise<{ sfx: Record<string, number>; music: Record<string, number>; rawSfx: SfxReport[]; rawMusic: MusicReport[] }>;
  /** Trimmed analysis of some SFX (levels, peaks, limiter, impact timing). */
  analyzeIds(ids: SfxId[]): Promise<SfxReport[]>;
  analyzeMusic(seconds?: number): Promise<MusicReport[]>;
  /** Map / boss tracks plain and in each theme colour, with each theme's loudness delta. */
  analyzeThemes(seconds?: number): Promise<(MusicReport & { delta: number })[]>;
  /** A theme colour alone vs its full track, per octave and per 100 ms window (all of them without `id`). */
  colours(seconds?: number): Promise<ColourReport[]>;
  colour(id: 'map' | 'boss', theme: Theme, intensity: number, seconds?: number): Promise<ColourReport>;
  /** Same-frame stacks (hit + debuff, …) through the real graph: worst peaks before/after the master stage. */
  coTriggers(renders?: number): Promise<CoTriggerReport[]>;
  coTrigger(ids: SfxId[], renders?: number): Promise<CoTriggerReport>;
  /** Loudness of one trimmed SFX in [from, to) segments (s from the voice start). */
  segments(id: SfxId, segments: [number, number][], renders?: number): Promise<number[]>;
  /** Colour the map / boss tracks (setMusicTheme). */
  setTheme(theme: Theme | null): void;
  stress(opts?: { bank?: boolean }): Promise<StressReport>;
  cpu(): Promise<CpuReport[]>;
  parity(): Promise<ParityRow[]>;
  moment(name: string): void;
  setEmitter(x: number, y: number): void;
  /** Render and show the spectrogram of one sound in the inspector. */
  inspect(id: SfxId): Promise<void>;
  /** Full-screen grid of every SFX spectrogram (verification view); `detail` = one wide, labelled row each. */
  atlas(ids?: SfxId[], opts?: { detail?: boolean; seconds?: number }): Promise<void>;
  /** Full-screen spectrograms of every music track (map/boss at each analysed intensity), optionally theme-coloured. */
  musicAtlas(seconds?: number, theme?: Theme | null, ids?: MusicId[]): Promise<void>;
}

declare global {
  interface Window {
    __soundForge?: SoundForgeApi;
  }
}

export function mountSoundboard(root: HTMLElement): SoundForgeApi {
  const engine = new WebAudioEngine();
  const emitter = { x: 0, y: 0, on: false };
  const buttons = new Map<SfxId, HTMLButtonElement>();
  let analyser: AnalyserNode | null = null;

  // --- header -------------------------------------------------------------
  const statusDot = h('span', { class: 'dot' });
  const statusText = h('span', { class: 'ui-type-caption' }, 'Locked');
  const wake = h('button', { class: 'wake ui-type-body', onclick: () => void unlock() }, 'Wake the forge');
  const spectrum = h('canvas', { class: 'spectrum', width: 360, height: 56 });
  const header = h('header', { class: 'top' },
    h('div', { class: 'brand' },
      sigil(),
      h('div', {},
        h('h1', { class: 'ui-type-title' }, 'Sound Forge'),
        h('div', { class: 'ui-type-caption muted' }, 'Forge of Echoes · procedural WebAudio · no samples'),
      ),
    ),
    spectrum,
    h('div', { class: 'status' }, h('div', { class: 'pill' }, statusDot, statusText), wake),
  );

  // --- music panel ----------------------------------------------------------
  const trackButtons = new Map<MusicId | 'none', HTMLButtonElement>();
  const trackRow = h('div', { class: 'tracks' });
  for (const id of MUSIC_IDS) {
    const b = h('button', { class: 'track', onclick: () => selectTrack(id) },
      h('span', { class: 'ui-type-body' }, TRACK_LABELS[id].name),
      h('span', { class: 'ui-type-caption muted' }, TRACK_LABELS[id].note));
    trackButtons.set(id, b);
    trackRow.append(b);
  }
  const silence = h('button', { class: 'track silence', onclick: () => selectTrack(null) }, h('span', { class: 'ui-type-body' }, 'Silence'), h('span', { class: 'ui-type-caption muted' }, 'fade out'));
  trackButtons.set('none', silence);
  trackRow.append(silence);
  const themeButtons = new Map<Theme | null, HTMLButtonElement>();
  const themeRow = h('div', { class: 'tracks themes' });
  for (const t of THEME_LABELS) {
    const b = h('button', { class: 'track', onclick: () => selectTheme(t.theme) },
      h('span', { class: 'ui-type-secondary' }, t.name),
      h('span', { class: 'ui-type-caption muted' }, t.note));
    themeButtons.set(t.theme, b);
    themeRow.append(b);
  }
  themeButtons.get(null)?.classList.add('on');
  const intensityOut = h('output', { class: 'ui-type-body value' }, '0.00');
  const intensity = slider(0, (v) => {
    engine.setIntensity(v);
    intensityOut.textContent = v.toFixed(2);
  });
  const musicPanel = panel('Music', 'var(--ember)',
    trackRow,
    h('div', { class: 'ui-type-caption muted theme-head' }, 'Map theme · colours Map and Boss'),
    themeRow,
    h('label', { class: 'row' }, h('span', { class: 'ui-type-secondary' }, 'Intensity'), intensity, intensityOut),
  );

  // --- mix panel --------------------------------------------------------------
  const vols = { master: 0.8, music: 0.7, sfx: 1 };
  const volRow = (key: keyof typeof vols, label: string) => {
    const out = h('output', { class: 'ui-type-body value' }, `${Math.round(vols[key] * 100)}`);
    const s = slider(vols[key], (v) => {
      vols[key] = v;
      out.textContent = `${Math.round(v * 100)}`;
      engine.setVolumes(vols);
    });
    return h('label', { class: 'row' }, h('span', { class: 'ui-type-secondary' }, label), s, out);
  };
  engine.setVolumes(vols);
  const mixPanel = panel('Mix', 'var(--gold)', volRow('master', 'Master'), volRow('music', 'Music'), volRow('sfx', 'Effects'));

  // --- emitter pad --------------------------------------------------------------
  const pad = h('canvas', { class: 'pad', width: 300, height: 170 });
  const padToggle = h('input', { type: 'checkbox', onchange: (e: Event) => { emitter.on = (e.target as HTMLInputElement).checked; drawPad(); } });
  const padInfo = h('span', { class: 'ui-type-caption muted' }, 'listener centred · ring = audible radius');
  pad.addEventListener('pointerdown', (e) => {
    const r = pad.getBoundingClientRect();
    const scale = (AUDIBLE_RADIUS * 2.3) / r.width;
    emitter.x = (e.clientX - r.left - r.width / 2) * scale;
    emitter.y = (e.clientY - r.top - r.height / 2) * scale;
    emitter.on = true;
    padToggle.checked = true;
    drawPad();
  });
  const emitterPanel = panel('Emitter', 'var(--frost)',
    pad,
    h('label', { class: 'row tight' }, padToggle, h('span', { class: 'ui-type-secondary' }, 'Positional (click the pad to place)')),
    padInfo,
  );

  // --- stress + meter ---------------------------------------------------------
  const meter = h('canvas', { class: 'meter', width: 300, height: 44 });
  const stressStats = h('div', { class: 'stats ui-type-caption' }, 'idle');
  const dynStats = h('div', { class: 'stats ui-type-caption' }, 'limiter — · combat bus —');
  let stressOn = false;
  const stressBtn = h('button', { class: 'action ui-type-body', onclick: () => toggleStress() }, 'Stress: 200 hits / s');
  const stressPanel = panel('Output', 'var(--flame)', meter, dynStats, stressBtn, stressStats);

  // --- moments ------------------------------------------------------------------
  const momentGrid = h('div', { class: 'tracks' });
  for (const m of MOMENTS) {
    momentGrid.append(h('button', { class: 'track', onclick: () => playMoment(m) },
      h('span', { class: 'ui-type-secondary' }, m.name),
      h('span', { class: 'ui-type-caption muted' }, m.note)));
  }
  const momentPanel = panel('Moments', 'var(--rare)', momentGrid);

  // --- cpu ---------------------------------------------------------------------
  const cpuBody = h('div', { class: 'cpu ui-type-caption muted' }, 'Offline estimate of audio-thread load, driven frame by frame like the game.');
  const cpuBtn = h('button', { class: 'action ghost ui-type-body', onclick: () => void runCpu() }, 'Estimate CPU');
  const bankStat = h('div', { class: 'stats ui-type-caption' }, 'sample bank: waiting for unlock');
  const cpuPanel = panel('Load', 'var(--olive-bright)', bankStat, cpuBody, cpuBtn);

  // --- inspector ------------------------------------------------------------------
  const inspectCanvas = h('canvas', { class: 'inspect', width: 1200, height: 220 });
  const inspectTitle = h('span', { class: 'ui-type-secondary muted' }, 'Play a sound to see its spectrogram');
  const inspectMeta = h('div', { class: 'ui-type-caption muted inspect-meta' }, 'log frequency 30 Hz – 18 kHz · 80 dB range · master output');
  const inspectToggle = h('input', { type: 'checkbox', checked: 'checked' });
  const inspector = h('section', { class: 'card inspector', style: { '--accent': 'var(--frost)' } },
    h('div', { class: 'levels-head' },
      h('h2', { class: 'ui-type-body' }, 'Inspect'),
      inspectTitle,
      h('label', { class: 'row tight' }, inspectToggle, h('span', { class: 'ui-type-caption' }, 'on play')),
    ),
    inspectCanvas,
    inspectMeta,
  );

  // --- sfx groups ---------------------------------------------------------------
  const groups = h('section', { class: 'groups' });
  for (const g of GROUPS) {
    const grid = h('div', { class: 'grid' });
    for (const id of g.ids) {
      const def = SFX[id];
      const b = h('button', { class: 'sfx', title: `${id} · voices ${def.maxVoices} · min ${Math.round(def.minInterval * 1000)} ms · target ${def.target} dB`, onclick: () => play(id) },
        h('span', { class: 'label ui-type-secondary' }, LABELS[id]),
        h('span', { class: 'id ui-type-caption' }, id),
        h('span', { class: 'lvl' }),
      );
      buttons.set(id, b);
      grid.append(b);
    }
    const card = h('div', { class: 'card', style: { '--accent': g.accent } },
      h('h2', { class: 'ui-type-body' }, g.title, h('span', { class: 'count ui-type-caption' }, `${g.ids.length}`)), grid);
    groups.append(card);
  }

  // --- levels table ---------------------------------------------------------------
  const levelBody = h('tbody');
  const levelNote = h('p', { class: 'ui-type-secondary muted' },
    `Each sound is rendered offline through the real mix graph (48 kHz). Loudness = max 200 ms K-weighted (BS.1770) on the raw mix, before the master stage (${MIX_GAIN_DB >= 0 ? '+' : ''}${MIX_GAIN_DB} dB mix gain → limiter); peaks are at the output. Impact = declared → measured loudest 10 ms. `,
    'Run "Analyze" to fill the table.');
  const analyzeBtn = h('button', { class: 'action ui-type-body', onclick: () => void runAnalyze() }, 'Analyze levels');
  const calibrateBtn = h('button', { class: 'action ghost ui-type-body', onclick: () => void runCalibrate() }, 'Calibrate');
  const musicLevels = h('div', { class: 'music-levels ui-type-secondary' });
  const calibOut = h('pre', { class: 'calib ui-type-caption hidden' });
  const levels = h('section', { class: 'levels card', style: { '--accent': 'var(--gold)' } },
    h('div', { class: 'levels-head' }, h('h2', { class: 'ui-type-body' }, 'Levels'), h('div', { class: 'btns' }, calibrateBtn, analyzeBtn)),
    levelNote,
    musicLevels,
    calibOut,
    h('table', { class: 'ui-type-secondary' },
      h('thead', {}, h('tr', {}, ...['Sound', 'Group', 'Target', 'Loudness', 'vs target', 'Trim', 'Peak', 'Raw peak', 'Limiter', 'Impact', 'Length', 'DC'].map((c) => h('th', { class: 'ui-type-caption' }, c)))),
      levelBody,
    ),
  );

  root.append(header, h('main', { class: 'layout' }, h('aside', { class: 'side' }, musicPanel, mixPanel, emitterPanel, stressPanel, momentPanel, cpuPanel), h('div', { class: 'content' }, inspector, groups, levels)));

  // ---------------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------------

  async function unlock(): Promise<void> {
    await engine.unlock();
    if (!analyser && engine.graph && engine.context) {
      analyser = engine.context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      engine.graph.output.connect(analyser);
    }
    updateStatus();
  }

  function updateStatus(): void {
    const d = engine.debug();
    const live = d.state === 'running';
    statusDot.classList.toggle('live', live);
    statusText.textContent = live ? `Running · ${Math.round(d.sampleRate / 100) / 10} kHz` : d.state === 'unavailable' ? 'WebAudio unavailable' : 'Locked — click to wake';
    wake.classList.toggle('hidden', live);
  }

  function play(id: SfxId): void {
    void unlock();
    engine.play(id, emitter.on ? { x: emitter.x, y: emitter.y } : undefined);
    const b = buttons.get(id);
    if (b) {
      b.classList.remove('flash');
      void b.offsetWidth;
      b.classList.add('flash');
    }
    if (inspectToggle.checked) void inspect(id);
  }

  /** Seconds until the sound falls 50 dB below its peak (+ a little air), clamped. */
  function audibleSpan(mono: Float32Array, sr: number, max: number): number {
    let peak = 0;
    for (const v of mono) peak = Math.max(peak, Math.abs(v));
    const floor = peak * 0.00316;
    let last = 0;
    for (let i = 0; i < mono.length; i++) if (Math.abs(mono[i]) > floor) last = i;
    return Math.min(max, Math.max(0.25, (last / sr) * 1.08 + 0.03));
  }

  let inspectSeq = 0;
  async function inspect(id: SfxId): Promise<void> {
    const seq = ++inspectSeq;
    const buf = await renderSfx(id, { seconds: 4 });
    if (seq !== inspectSeq) return;
    const span = audibleSpan(outputMono(buf, 3.8), buf.sampleRate, 3.8);
    const mono = outputMono(buf, span);
    drawSpectrogram(inspectCanvas, spectrogram(mono, buf.sampleRate, 1024, 128), mono, span, true);
    let peak = 0;
    for (const v of mono) peak = Math.max(peak, Math.abs(v));
    inspectTitle.textContent = `${LABELS[id]} · ${id}`;
    inspectMeta.textContent = `peak ${fmt(20 * Math.log10(peak || 1e-9))} dBFS · voices ≤ ${SFX[id].maxVoices} · min interval ${Math.round(SFX[id].minInterval * 1000)} ms · pitch ±${Math.round(SFX[id].pitchVar * 100)}% · reverb ${SFX[id].reverb}`;
  }

  async function atlas(ids: readonly SfxId[] = SFX_IDS, opts: { detail?: boolean; seconds?: number } = {}): Promise<void> {
    document.querySelector('.atlas')?.remove();
    const wrap = h('div', { class: opts.detail ? 'atlas wide' : 'atlas' });
    document.body.append(wrap);
    for (const id of ids) {
      const c = opts.detail ? h('canvas', { width: 1400, height: 200 }) : h('canvas', { width: 380, height: 150 });
      const cap = h('figcaption', { class: 'ui-type-caption' }, `${LABELS[id]} · ${id}`);
      wrap.append(h('figure', {}, c, cap));
      const buf = await renderSfx(id, { seconds: 4 });
      const span = opts.seconds ?? audibleSpan(outputMono(buf, 3.8), buf.sampleRate, 3.8);
      const mono = outputMono(buf, span);
      drawSpectrogram(c, spectrogram(mono, buf.sampleRate, opts.detail ? 1024 : 512, opts.detail ? 48 : 64), mono, span, !!opts.detail);
      cap.textContent = `${LABELS[id]} · ${id} · ${span.toFixed(2)} s`;
    }
  }

  function selectTrack(id: MusicId | null): void {
    void unlock();
    engine.setMusic(id);
    for (const [k, b] of trackButtons) b.classList.toggle('on', k === (id ?? 'none'));
  }

  function selectTheme(theme: Theme | null): void {
    engine.setMusicTheme(theme);
    for (const [k, b] of themeButtons) b.classList.toggle('on', k === theme);
  }

  function playMoment(m: Moment): void {
    void unlock().then(() => {
      const ctx = engine.context;
      if (!ctx) return;
      const t0 = ctx.currentTime + 0.03;
      const ox = emitter.on ? emitter.x : 0;
      const oy = emitter.on ? emitter.y : 0;
      // Player sounds (hurt, debuffs) are the local player's: un-positioned, as the presenter plays them.
      for (const [dt, id, x, y] of m.plays) engine.playAt(id, t0 + dt, SFX[id].group === 'player' ? undefined : { x: ox + x, y: oy + y });
    });
  }

  async function runCpu(): Promise<CpuReport[]> {
    cpuBtn.disabled = true;
    cpuBtn.textContent = 'Rendering…';
    try {
      const rows = await analyzeCpu();
      cpuBody.replaceChildren(h('table', { class: 'ui-type-caption' },
        h('thead', {}, h('tr', {}, ...['Scenario', 'Audio', 'Main', 'Voices/s'].map((c) => h('th', { class: 'ui-type-caption' }, c)))),
        h('tbody', {}, ...rows.map((r) => h('tr', {},
          h('td', {}, r.scenario),
          h('td', { class: 'num' }, `${fmt(r.audioPct)}%`),
          h('td', { class: 'num muted' }, `${fmt(r.mainMsPerSec)} ms/s`),
          h('td', { class: 'num muted' }, `${r.voicesPerSec}`),
        ))),
      ));
      return rows;
    } finally {
      cpuBtn.disabled = false;
      cpuBtn.textContent = 'Estimate CPU';
    }
  }

  function toggleStress(): void {
    void unlock();
    stressOn = !stressOn;
    stressBtn.classList.toggle('on', stressOn);
    stressBtn.textContent = stressOn ? 'Stop stress test' : 'Stress: 200 hits / s';
  }

  // Stress firing + meters run on animation frames.
  let lastFrame = performance.now();
  let owed = 0;
  let statsMark = { t: performance.now(), requested: 0, played: 0, merged: 0, dropped: 0, stolen: 0 };
  let redHold = { limiter: 0, combat: 0 };
  let requested = 0;
  let peakHold = -60;
  const timeData = new Float32Array(2048);
  const freqData = new Uint8Array(1024);
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (stressOn && engine.unlocked) {
      owed += dt * 200;
      while (owed >= 1) {
        owed -= 1;
        requested++;
        const a = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 320;
        engine.play(STRESS_IDS[Math.floor(Math.random() * STRESS_IDS.length)], { x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
    }
    if (now - statsMark.t > 500) {
      const s = engine.debug();
      const secs = (now - statsMark.t) / 1000;
      const dropped = s.stats.droppedInterval + s.stats.droppedBudget;
      stressStats.textContent = `voices ${s.activeVoices} · req ${Math.round((requested - statsMark.requested) / secs)}/s · played ${Math.round((s.stats.played - statsMark.played) / secs)}/s · merged ${Math.round((s.stats.merged - statsMark.merged) / secs)}/s · dropped ${Math.round((dropped - statsMark.dropped) / secs)}/s · stolen ${Math.round((s.stats.stolen - statsMark.stolen) / secs)}/s`;
      statsMark = { t: now, requested, played: s.stats.played, merged: s.stats.merged, dropped, stolen: s.stats.stolen };
      const b = s.bank;
      bankStat.textContent = b
        ? `sample bank: ${b.ready}/${b.total} sounds · ${b.variants} variants · ${(b.bytes / 1048576).toFixed(1)} MB · banked plays ${s.stats.banked}, live ${s.stats.live}`
        : 'sample bank: unavailable (live synthesis)';
      updateStatus();
    }
    const red = engine.debug().reduction;
    redHold = { limiter: Math.max(red.limiter, redHold.limiter - dt * 6), combat: Math.max(red.combat, redHold.combat - dt * 6) };
    dynStats.textContent = `gain reduction · limiter ${redHold.limiter < 0.05 ? '0.0' : `−${fmt(redHold.limiter)}`} dB · combat bus ${redHold.combat < 0.05 ? '0.0' : `−${fmt(redHold.combat)}`} dB`;
    drawMeters(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  function drawMeters(dt: number): void {
    const mc = meter.getContext('2d')!;
    const w = meter.width, hh = meter.height;
    mc.clearRect(0, 0, w, hh);
    let peak = 0, sq = 0;
    if (analyser) {
      analyser.getFloatTimeDomainData(timeData);
      for (const v of timeData) {
        peak = Math.max(peak, Math.abs(v));
        sq += v * v;
      }
    }
    const peakDb = Math.max(-60, 20 * Math.log10(peak || 1e-6));
    const rmsDb = Math.max(-60, 20 * Math.log10(Math.sqrt(sq / timeData.length) || 1e-6));
    peakHold = Math.max(peakDb, peakHold - dt * 12);
    const x = (db: number) => ((db + 60) / 60) * w;
    // scale ticks
    mc.fillStyle = '#2a2326';
    mc.fillRect(0, 8, w, 14);
    mc.fillRect(0, 26, w, 8);
    const grad = mc.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#4b5a3a');
    grad.addColorStop(0.7, '#b8862f');
    grad.addColorStop(0.9, '#e8662a');
    grad.addColorStop(1, '#ffe7a8');
    mc.fillStyle = grad;
    mc.fillRect(0, 8, x(peakDb), 14);
    mc.fillStyle = '#7d7278';
    mc.fillRect(0, 26, x(rmsDb), 8);
    mc.fillStyle = '#ffe7a8';
    mc.fillRect(x(peakHold) - 1, 6, 2, 18);
    mc.fillStyle = '#7d7278';
    mc.font = '12px "Alegreya Sans", sans-serif';
    for (const db of [-48, -36, -24, -12, -6, 0]) {
      mc.fillRect(x(db) - 0.5, 36, 1, 3);
      mc.fillText(`${db}`, Math.min(w - 12, x(db) - 6), 44);
    }

    const sc = spectrum.getContext('2d')!;
    const sw = spectrum.width, sh = spectrum.height;
    sc.clearRect(0, 0, sw, sh);
    if (analyser) analyser.getByteFrequencyData(freqData);
    const bars = 48;
    const bw = sw / bars;
    for (let i = 0; i < bars; i++) {
      // log-spaced bins 40 Hz … 16 kHz
      const f0 = 40 * Math.pow(400, i / bars), f1 = 40 * Math.pow(400, (i + 1) / bars);
      const nyq = (engine.context?.sampleRate ?? 48000) / 2;
      const b0 = Math.floor((f0 / nyq) * freqData.length), b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * freqData.length));
      let m = 0;
      for (let k = b0; k < b1 && k < freqData.length; k++) m = Math.max(m, freqData[k]);
      const v = m / 255;
      const bh = Math.max(2, v * (sh - 4));
      const g = sc.createLinearGradient(0, sh, 0, sh - bh);
      g.addColorStop(0, '#5a1a2a');
      g.addColorStop(0.5, '#e8662a');
      g.addColorStop(1, '#ffe7a8');
      sc.fillStyle = analyser ? g : '#2a2326';
      sc.fillRect(i * bw + 1, sh - bh, bw - 2, bh);
    }
  }

  function drawPad(): void {
    const c = pad.getContext('2d')!;
    const w = pad.width, hh = pad.height;
    c.clearRect(0, 0, w, hh);
    const scale = w / (AUDIBLE_RADIUS * 2.3);
    const cx = w / 2, cy = hh / 2;
    c.strokeStyle = '#3b3438';
    c.lineWidth = 1;
    for (const r of [0.25, 0.5, 0.75]) {
      c.beginPath();
      c.arc(cx, cy, AUDIBLE_RADIUS * r * scale, 0, Math.PI * 2);
      c.stroke();
    }
    c.strokeStyle = '#7a3b24';
    c.setLineDash([4, 4]);
    c.beginPath();
    c.arc(cx, cy, AUDIBLE_RADIUS * scale, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    // listener
    c.fillStyle = '#e8dcc0';
    c.beginPath();
    c.arc(cx, cy, 4, 0, Math.PI * 2);
    c.fill();
    // emitter
    const ex = cx + emitter.x * scale, ey = cy + emitter.y * scale;
    c.fillStyle = emitter.on ? '#ff9a3c' : '#5a5057';
    c.shadowColor = '#e8662a';
    c.shadowBlur = emitter.on ? 12 : 0;
    c.beginPath();
    c.arc(ex, ey, 5, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    const d = Math.hypot(emitter.x, emitter.y);
    const sp = spatialize(emitter.x, emitter.y);
    padInfo.textContent = emitter.on
      ? `emitter ${Math.round(d)} units · ${fmt(20 * Math.log10(sp.gain || 1e-9))} dB · pan ${sp.pan.toFixed(2)}${sp.lowpass ? ` · air ${Math.round(sp.lowpass / 100) / 10} kHz` : ''}`
      : 'listener centred · ring = audible radius (500)';
  }
  drawPad();

  function renderLevels(rows: SfxReport[]): void {
    levelBody.replaceChildren();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const g of GROUPS) {
      for (const id of g.ids) {
        const r = byId.get(id);
        if (!r) continue;
        const delta = r.loudness - r.target;
        const ok = Math.abs(delta) <= 1.5;
        const clipRisk = r.peakDb > -0.5;
        levelBody.append(h('tr', {},
          h('td', {}, LABELS[id], h('span', { class: 'ui-type-caption muted' }, ` ${id}`)),
          h('td', { class: 'muted' }, g.title),
          h('td', { class: 'num' }, fmt(r.target)),
          h('td', { class: 'num' }, loudBar(r.loudness, r.target), fmt(r.loudness)),
          h('td', { class: `num ${ok ? 'good' : 'warn'}` }, `${delta >= 0 ? '+' : ''}${fmt(delta)}`),
          h('td', { class: 'num muted' }, fmt(r.trim)),
          h('td', { class: `num ${clipRisk ? 'warn' : ''}` }, fmt(r.peakDb)),
          h('td', { class: 'num muted' }, fmt(r.prePeakDb)),
          h('td', { class: 'num muted' }, r.limiting > 0.3 ? `−${fmt(r.limiting)}` : '—'),
          h('td', { class: `num ${r.impact > 0 && Math.abs(r.peakAt - r.impact) > 0.06 ? 'warn' : r.impact > 0 ? 'good' : 'muted'}` },
            r.impact > 0 ? `${fmt(r.impact, 2)} → ${fmt(r.peakAt, 2)}` : fmt(r.peakAt, 2)),
          h('td', { class: 'num' }, `${fmt(r.duration, 2)} s`),
          h('td', { class: 'num muted' }, r.dc.toExponential(1)),
        ));
        const lvl = buttons.get(id)?.querySelector('.lvl') as HTMLElement | null;
        if (lvl) lvl.style.setProperty('--w', `${Math.max(4, Math.min(100, ((r.loudness + 40) / 30) * 100))}%`);
      }
    }
  }

  function loudBar(v: number, target: number): HTMLElement {
    const x = (db: number) => `${Math.max(0, Math.min(100, ((db + 40) / 30) * 100))}%`;
    return h('span', { class: 'bar' }, h('span', { class: 'fill', style: { width: x(v) } }), h('span', { class: 'target', style: { left: x(target) } }));
  }

  async function runAnalyze(): Promise<SfxReport[]> {
    analyzeBtn.disabled = calibrateBtn.disabled = true;
    try {
      const rows = await analyzeAllSfx({ onProgress: (d, n) => (analyzeBtn.textContent = `Rendering ${d} / ${n}…`) });
      renderLevels(rows);
      analyzeBtn.textContent = 'Rendering music…';
      renderMusicLevels(await analyzeAllMusic(16));
      return rows;
    } finally {
      analyzeBtn.disabled = calibrateBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze levels';
    }
  }

  function renderMusicLevels(rows: MusicReport[]): void {
    musicLevels.replaceChildren(
      h('span', { class: 'ui-type-caption muted' }, 'Music (integrated)'),
      ...rows.map((r) => h('span', { class: 'chip' },
        `${TRACK_LABELS[r.id].name}${MUSIC_INTENSITIES[r.id].length > 1 ? ` · I=${r.intensity}` : ''} `,
        h('b', {}, `${fmt(r.integrated)} LUFS`),
        h('span', { class: 'muted' }, ` · peak ${fmt(r.peakDb)}`),
      )),
    );
  }

  async function runCalibrate(): Promise<void> {
    analyzeBtn.disabled = calibrateBtn.disabled = true;
    try {
      const rawSfx = await analyzeAllSfx({ raw: true, onProgress: (d, n) => (calibrateBtn.textContent = `Measuring ${d} / ${n}…`) });
      calibrateBtn.textContent = 'Measuring music…';
      const rawMusic = await analyzeAllMusic(20, { raw: true });
      const sfx = suggestSfxTrims(rawSfx);
      const music = suggestMusicTrims(rawMusic);
      calibOut.textContent = `// src/audio/levels.ts\nexport const SFX_TRIM_DB: Partial<Record<SfxId, number>> = {\n${Object.entries(sfx).map(([k, v]) => `  ${k}: ${v},`).join('\n')}\n};\n\nexport const MUSIC_TRIM_DB: Partial<Record<MusicId, number>> = ${JSON.stringify(music).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': ')};`;
      calibOut.classList.remove('hidden');
    } finally {
      analyzeBtn.disabled = calibrateBtn.disabled = false;
      calibrateBtn.textContent = 'Calibrate';
    }
  }

  async function musicAtlas(seconds = 12, theme: Theme | null = null, ids: readonly MusicId[] = MUSIC_IDS): Promise<void> {
    document.querySelector('.atlas')?.remove();
    const wrap = h('div', { class: 'atlas wide' });
    document.body.append(wrap);
    const themeName = THEME_LABELS.find((t) => t.theme === theme)?.name ?? 'plain';
    for (const id of ids) {
      for (const I of MUSIC_INTENSITIES[id]) {
        const c = h('canvas', { width: 1400, height: 160 });
        wrap.append(h('figure', {}, c, h('figcaption', { class: 'ui-type-caption' }, `${TRACK_LABELS[id].name} · ${themeName} · intensity ${I} · ${seconds} s`)));
        const buf = await renderMusic(id, seconds + 2, I, { theme });
        const mono = outputMono(buf, seconds, 2);
        drawSpectrogram(c, spectrogram(mono, buf.sampleRate, 1024, 512), mono, seconds, false);
      }
    }
  }

  const api: SoundForgeApi = {
    engine,
    play,
    analyze: runAnalyze,
    async calibrate(opts = {}) {
      const rawSfx = await analyzeAllSfx({ raw: true, ids: opts.ids });
      const rawMusic = opts.music === false ? [] : await analyzeAllMusic(20, { raw: true });
      return { sfx: suggestSfxTrims(rawSfx), music: suggestMusicTrims(rawMusic), rawSfx, rawMusic };
    },
    analyzeIds: (ids) => analyzeAllSfx({ ids }),
    analyzeMusic: (seconds = 20) => analyzeAllMusic(seconds),
    analyzeThemes: (seconds = 20) => analyzeThemedMusic(seconds),
    colours: (seconds = 20) => analyzeAllColours(seconds),
    colour: (id, theme, intensity, seconds = 20) => analyzeColour(id, theme, intensity, seconds),
    coTriggers: (renders = 6) => analyzeAllCoTriggers(renders),
    coTrigger: (ids, renders = 6) => analyzeCoTrigger(ids, renders),
    segments: (id, segs, renders = 4) => analyzeSegments(id, segs, renders),
    setTheme: selectTheme,
    stress: (opts) => analyzeStress(200, 3, opts),
    cpu: runCpu,
    parity: () => analyzeBankParity(),
    moment(name) {
      const m = MOMENTS.find((x) => x.name === name);
      if (m) playMoment(m);
    },
    setEmitter(x, y) {
      emitter.x = x;
      emitter.y = y;
      emitter.on = true;
      padToggle.checked = true;
      drawPad();
    },
    inspect,
    atlas,
    musicAtlas,
  };
  window.__soundForge = api;
  document.addEventListener('pointerdown', () => void unlock(), { once: true });
  updateStatus();
  return api;

  // ---------------------------------------------------------------------------

  function panel(title: string, accent: string, ...children: Child[]): HTMLElement {
    return h('section', { class: 'card', style: { '--accent': accent } }, h('h2', { class: 'ui-type-body' }, title), ...children);
  }

  function slider(value: number, onInput: (v: number) => void): HTMLInputElement {
    const s = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value });
    const fill = () => s.style.setProperty('--p', `${Number(s.value) * 100}%`);
    fill();
    s.addEventListener('input', () => {
      fill();
      onInput(Number(s.value));
    });
    return s;
  }
}

// ---------------------------------------------------------------------------
// Spectrogram drawing
// ---------------------------------------------------------------------------

const RAMP: [number, number, number][] = [
  [13, 11, 14], [42, 15, 26], [90, 26, 42], [168, 50, 28], [232, 102, 42], [255, 154, 60], [255, 231, 168], [255, 255, 255],
];

function rampColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Log-frequency spectrogram (30 Hz – 18 kHz, 80 dB below its peak) with a peak-envelope strip. */
function drawSpectrogram(canvas: HTMLCanvasElement, spec: Spectrogram, mono: Float32Array, seconds: number, axes: boolean): void {
  const c = canvas.getContext('2d')!;
  const w = canvas.width, hh = canvas.height;
  const envH = Math.round(hh * 0.18);
  const sh = hh - envH;
  const img = c.createImageData(w, sh);
  const fLo = 30, fHi = 18000;
  const binHz = spec.sampleRate / 2 / spec.bins;
  const framesShown = (seconds * spec.sampleRate) / spec.hop;
  // Normalise to the loudest bin so structure is visible regardless of level (80 dB range).
  let top = -200;
  for (let i = 0; i < spec.db.length; i++) if (spec.db[i] > top) top = spec.db[i];
  for (let x = 0; x < w; x++) {
    const f0 = Math.floor((x / w) * framesShown);
    const f1 = Math.max(f0 + 1, Math.floor(((x + 1) / w) * framesShown));
    for (let y = 0; y < sh; y++) {
      const fa = fLo * Math.pow(fHi / fLo, 1 - (y + 1) / sh);
      const fb = fLo * Math.pow(fHi / fLo, 1 - y / sh);
      const b0 = Math.floor(fa / binHz), b1 = Math.max(b0 + 1, Math.ceil(fb / binHz));
      let m = -200;
      for (let f = f0; f < f1 && f < spec.frames; f++) {
        for (let b = b0; b < b1 && b < spec.bins; b++) m = Math.max(m, spec.db[f * spec.bins + b]);
      }
      const [r, g, bl] = rampColor((m - top + 80) / 80);
      const o = (y * w + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = bl;
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // envelope strip (peak per column, dB scaled)
  c.fillStyle = '#141114';
  c.fillRect(0, sh, w, envH);
  c.fillStyle = '#cbbfa8';
  const per = mono.length / w;
  for (let x = 0; x < w; x++) {
    let p = 0;
    for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per) && i < mono.length; i++) p = Math.max(p, Math.abs(mono[i]));
    const db = 20 * Math.log10(p + 1e-9);
    const v = Math.max(0, (db + 60) / 60);
    const bh = v * (envH - 2);
    c.fillRect(x, sh + (envH - bh) / 2, 1, Math.max(0.5, bh));
  }
  if (!axes) return;
  c.font = '12px "Alegreya Sans", sans-serif';
  c.fillStyle = 'rgba(232, 220, 192, 0.75)';
  for (const f of [100, 1000, 10000]) {
    const y = (1 - Math.log(f / fLo) / Math.log(fHi / fLo)) * sh;
    c.fillRect(0, y, 6, 1);
    c.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 9, y + 4);
  }
  const stepT = seconds > 2 ? 0.5 : seconds > 0.8 ? 0.2 : 0.1;
  for (let t = stepT; t < seconds - stepT * 0.3; t += stepT) {
    const x = (t / seconds) * w;
    c.fillRect(x, sh - 5, 1, 5);
    c.fillText(`${Math.round(t * 10) / 10}s`, x + 3, sh - 6);
  }
}

/** The ember-spiral sigil (inline SVG). */
function sigil(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'sigil');
  const pts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const a = i * 0.16;
    const r = 2 + i * 0.17;
    pts.push(`${(24 + Math.cos(a) * r).toFixed(2)},${(24 + Math.sin(a) * r).toFixed(2)}`);
  }
  const path = document.createElementNS(ns, 'polyline');
  path.setAttribute('points', pts.join(' '));
  svg.append(path);
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', '24');
  ring.setAttribute('cy', '24');
  ring.setAttribute('r', '22.5');
  svg.append(ring);
  return svg;
}
