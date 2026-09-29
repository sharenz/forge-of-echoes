// Procedural WebAudio engine — see src/contracts/audio.ts.
//
// Usage (app / presenter):
//   const audio = createAudio();
//   window.addEventListener('pointerdown', () => audio.unlock());   // any user gesture; safe to repeat
//   audio.setVolumes({ master, music, sfx });                       // 0..1 sliders (perceptual taper)
//   audio.setMusic('hideout');                                      // equal-power crossfade; remembered until unlock
//   audio.setListener(player.x, player.y);                          // once per frame, before that frame's plays
//   audio.play('hitFire', { x, y });                                // world sounds: pass the position
//   audio.play('uiClick');                                          // UI / player sounds: no position
//   audio.setIntensity(0..1);                                       // map/boss music energy
//   setMusicTheme(audio, zone.theme);                               // colour map/boss music per map base
//
// Theme colour (not part of the frozen contract): setMusicTheme(audio, theme) colours the 'map'
// and 'boss' tracks for the current map base — icy bells, bone clacks, a crypt choir and a frozen
// lantern whine for 'rimedOssuary'; war drums, chains, crowd swells, a war horn and a chanting
// crowd for 'ironColiseum'; 'ashenForge' / 'hideout' / null play the plain (forge) tracks. Call it
// on every zone change, ideally before setMusic('map'); changing it under a playing map/boss track
// crossfades into the new colour. Safe before unlock and on engines without WebAudio.
//
// Play every event of a frame in the same frame: same-frame hits of one id merge into a single
// voice (the nearest wins and the mass adds up to +4 dB), and loot of one id arriving together
// cascades instead of collapsing. Options objects may be reused between calls.
//
// Timing: some sounds carry a deliberate anticipation before their hit (unique/rare drops, level
// up, chest latch, corrupt, portal enter, wave tell, execution mark). Delay the matching flash /
// hit-stop / slow-mo by sfxImpactDelay(id) seconds so eyes and ears land together (0 for most).
//
// Player sounds and position: play the local player's hurt / debuff / flask / level-up
// un-positioned. A positioned player sound is taken to be someone else's (an ally's) and gets its
// own voice lane, so it never blocks or steals the local player's cue.
//
// Wave-5 cues (GAME_SPEC §13–§14):
//  - debuff*: play only for the local player (un-positioned), once when the ailment takes hold —
//    not on every refresh; allies' debuffs are visual only. Play it in the same frame as the hit
//    that applied it: the ailments start 30 ms late on their own (SfxDef.lag), so the hit's thump
//    lands first and the two never stack into the limiter. debuffBleed once per new stack with
//    pitch 1 + 0.06·(stacks − 1). debuffCleanse when a flask removes an ailment. Frozen / rooted are
//    priority sounds; the freeze briefly ducks the combat bus.
//  - Telegraph pairs: wispPulse when the 0.7 s pulse ring appears → wispBurst at its resolve;
//    crossbowAim when the 0.6 s aim line appears → crossbowShot on release; icePrison when the
//    ring forms (the capture is debuffFreeze); executionMark on the mark → bossSlam + arenaSpikes
//    at the strike 3 s later (delay the mark's flash by sfxImpactDelay('executionMark')).
//  - Per-instance hazards: glacialSpikes per spike burst (a line plays it spike by spike: keep
//    spikes at least 0.05 s apart; closer ones merge into one heavier voice); arenaSpikes per tile
//    burst (same-frame tiles merge); shieldBlock per projectile the shield stops; tarSplat where a
//    tar glob lands (the pool's first-contact root is debuffRoot only, no extra sound).
//  - blizzardLoop is a 2.7 s gust: replay it every ~2 s for the storm zone nearest the listener
//    only (at the listener's position while inside it); overlapping gusts blend into one gale.
//  - chainWhirl is one 1.44 s spin (6 × 0.24 s turns) and varkusWhirl one 1.68 s spin (6 × 0.28 s),
//    each followed by a short wind-down turn. Play it when the spin starts; while it keeps
//    spinning, replay it every 1.44 s / 1.68 s (CHAIN_REV / VARKUS_REV × 6): a replay continues
//    the previous one seamlessly. Stop replaying when the spin ends (the wind-down plays out).
//  - wardenNova when a Frost Nova ring releases; choirSing on each Choir Wave; varkusCharge when
//    the charge launches; crowdRoar on Crowd's Favour and other arena moments (it ducks the music).
//
// Per-roster moments (there are no per-boss spawn / death ids — combine these so each boss has
// its own voice instead of falling back to the Cinder Matriarch's):
//   Rimed Ossuary
//    - Bone Thrall lunge: boneRattle · death: boneRattle at pitch 0.8 (a lower collapse; not the
//      ashen monsterDeath crumble).
//    - Rimeshade touch / spawn: ghostWail. Frost Weaver shot: webShot. Golem slam: golemSlam.
//    - Bone Chorister: spawn heraldCall + choirSing (volume 0.6); raise: boneRattle per thrall
//      (same frame: they merge); Choir Wave: choirSing.
//    - Hollow Warden: spawn bossSpawn + choirSing (volume 0.6); phase change wardenNova +
//      icePrison; death monsterDeathBig + wardenNova (volume 0.7); summoned Rimeshades ghostWail.
//   Iron Coliseum
//    - Pit Hound bite: houndBite. Chain Thrall / Chainmaster hook: chainThrow (the root on hit is
//      debuffRoot). Crossbowman: crossbowAim → crossbowShot. Tar Slinger: tarSplat on landing.
//    - Shieldbearer: shieldBlock per blocked projectile; bash: shieldBlock + monsterAttack.
//    - Chainmaster: spawn heraldCall + chainThrow; whirl: chainWhirl.
//    - Varkus: spawn bossSpawn + crowdRoar; phase change crowdRoar; charge varkusCharge; whirl
//      varkusWhirl; Execution Mark as above; death monsterDeathBig + crowdRoar.
import type { AudioEngine } from '../contracts/audio';
import type { Theme } from '../contracts/content';
import { WebAudioEngine, type AudioEngineDebug } from './engine';

export function createAudio(): AudioEngine {
  return new WebAudioEngine();
}

/** Colour the 'map' / 'boss' music for a map theme (see the header). No-op for foreign engines. */
export function setMusicTheme(engine: AudioEngine, theme: Theme | null): void {
  if (engine instanceof WebAudioEngine) engine.setMusicTheme(theme);
}

/** Narrow an engine to its debug surface (dev tools only). */
export function audioDebug(engine: AudioEngine): AudioEngineDebug | null {
  return engine instanceof WebAudioEngine ? engine : null;
}

export { CHAIN_REV, sfxImpactDelay, VARKUS_REV } from './sfx';
export { WebAudioEngine } from './engine';
export type { AudioDebugInfo, AudioEngineDebug, EngineOptions, PlayAtOptions } from './engine';
export { SFX, type SfxDef, type SfxGroup } from './sfx';
export { TRACKS } from './music/tracks';
export { AUDIBLE_RADIUS } from './mixing';
