import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "../../game/config/monsters";
import type { MonsterAudioCueDefinition, MonsterAudioSampleDefinition } from "../../game/config/schema";
import type { MonsterRarity } from "../../game/domain";
import type { SampleAudioPlayer } from "./GameAudio";

export type MonsterAudioCue = "movement" | "aggro" | "melee" | "ranged" | "jump" | "hit" | "death" | "projectileImpact";
export type MonsterActionAudioCue = Extract<MonsterAudioCue, "melee" | "ranged" | "jump">;
const MONSTER_AUDIO_CUES: readonly MonsterAudioCue[] = ["movement", "aggro", "melee", "ranged", "jump", "hit", "death", "projectileImpact"];

interface ListenerPosition {
  x: number;
  y: number;
}

/**
 * Turns monster events into a readable positional mix. Monster entities emit
 * cues independently; distance, cooldowns and voice groups prevent a large
 * pack from turning those cues into an undifferentiated wall of sound.
 */
export class MonsterAudioMixer {
  private listener: ListenerPosition = { x: 0, y: 0 };
  private readonly emitterCooldowns = new Map<string, number>();
  private readonly groupCooldowns = new Map<string, number>();

  constructor(
    private readonly output: SampleAudioPlayer,
    private readonly random: () => number = Math.random,
  ) {}

  preload(): void {
    const urls = new Set<string>();
    for (const monster of Object.values(MONSTER_ARCHETYPES)) {
      for (const cue of Object.values(monster.sfx)) {
        for (const sample of cue?.samples ?? []) urls.add(sample.url);
      }
    }
    for (const url of urls) this.output.preloadSample(url);
  }

  setListener(x: number, y: number): void {
    this.listener = { x, y };
  }

  forgetMonster(monsterId: number): void {
    for (const cue of MONSTER_AUDIO_CUES) this.emitterCooldowns.delete(`${monsterId}:${cue}`);
  }

  movementFrame(
    monsterId: number,
    archetypeId: MonsterArchetypeId,
    rarity: MonsterRarity,
    x: number,
    y: number,
    frame: number,
    nowMilliseconds: number,
  ): void {
    const movement = MONSTER_ARCHETYPES[archetypeId].sfx.movement;
    if (!movement || !movement.frameEvents.includes(frame)) return;
    this.playCue(monsterId, archetypeId, rarity, "movement", movement, x, y, nowMilliseconds);
  }

  aggro(monsterId: number, archetypeId: MonsterArchetypeId, x: number, y: number, nowMilliseconds: number): void {
    this.playConfiguredCue(monsterId, archetypeId, "normal", "aggro", x, y, nowMilliseconds);
  }

  action(monsterId: number, archetypeId: MonsterArchetypeId, rarity: MonsterRarity, action: MonsterActionAudioCue, x: number, y: number, nowMilliseconds: number): void {
    this.playConfiguredCue(monsterId, archetypeId, rarity, action, x, y, nowMilliseconds);
  }

  hit(monsterId: number, archetypeId: MonsterArchetypeId, rarity: MonsterRarity, x: number, y: number, nowMilliseconds: number): void {
    this.playConfiguredCue(monsterId, archetypeId, rarity, "hit", x, y, nowMilliseconds);
  }

  death(monsterId: number, archetypeId: MonsterArchetypeId, rarity: MonsterRarity, x: number, y: number, nowMilliseconds: number): void {
    this.playConfiguredCue(monsterId, archetypeId, rarity, "death", x, y, nowMilliseconds);
  }

  projectileImpact(monsterId: number, archetypeId: MonsterArchetypeId, rarity: MonsterRarity, x: number, y: number, nowMilliseconds: number): void {
    this.playConfiguredCue(monsterId, archetypeId, rarity, "projectileImpact", x, y, nowMilliseconds);
  }

  private playConfiguredCue(
    monsterId: number,
    archetypeId: MonsterArchetypeId,
    rarity: MonsterRarity,
    cueName: Exclude<MonsterAudioCue, "movement">,
    x: number,
    y: number,
    nowMilliseconds: number,
  ): void {
    const cue = MONSTER_ARCHETYPES[archetypeId].sfx[cueName];
    if (!cue) return;
    this.playCue(monsterId, archetypeId, rarity, cueName, cue, x, y, nowMilliseconds);
  }

  private playCue(
    monsterId: number,
    archetypeId: MonsterArchetypeId,
    rarity: MonsterRarity,
    cueName: MonsterAudioCue,
    cue: MonsterAudioCueDefinition,
    x: number,
    y: number,
    nowMilliseconds: number,
  ): void {
    if (cue.samples.length === 0 || cue.radius <= 0 || cue.volume <= 0) return;
    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= cue.radius) return;

    const emitterKey = `${monsterId}:${cueName}`;
    const groupKey = `${archetypeId}:${cueName}`;
    if (nowMilliseconds < (this.emitterCooldowns.get(emitterKey) ?? 0)) return;
    if (nowMilliseconds < (this.groupCooldowns.get(groupKey) ?? 0)) return;

    const sample = this.pickSample(cue.samples);
    const normalizedDistance = Math.max(0, (distance - 48) / Math.max(1, cue.radius - 48));
    const attenuation = (1 - Math.min(1, normalizedDistance)) ** 1.65;
    const rarityGain = rarity === "rare" ? 1.16 : rarity === "magic" ? 1.07 : 1;
    const variation = cue.pitchVariation ?? 0;
    const playbackRate = 1 + (this.random() * 2 - 1) * variation;

    this.emitterCooldowns.set(emitterKey, nowMilliseconds + (cue.emitterCooldownMilliseconds ?? 0));
    this.groupCooldowns.set(groupKey, nowMilliseconds + (cue.groupCooldownMilliseconds ?? 0));
    this.output.playSample(sample.url, {
      offset: sample.offset,
      duration: sample.duration,
      volume: cue.volume * attenuation * rarityGain,
      pan: Math.max(-1, Math.min(1, dx / Math.max(1, cue.radius * 0.6))),
      playbackRate,
      voiceGroup: `monster:${cueName}`,
      maxVoices: cue.maxVoices,
    });
  }

  private pickSample(samples: readonly MonsterAudioSampleDefinition[]): MonsterAudioSampleDefinition {
    return samples[Math.min(samples.length - 1, Math.floor(this.random() * samples.length))];
  }
}
