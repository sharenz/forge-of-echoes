import assert from "node:assert/strict";
import test from "node:test";
import { MONSTER_ARCHETYPES } from "../../app/game/config/monsters";
import type { SampleAudioPlayer, SamplePlayback } from "../../app/game2d/audio/GameAudio";
import { MonsterAudioMixer } from "../../app/game2d/audio/MonsterAudioMixer";

class RecordingAudio implements SampleAudioPlayer {
  readonly preloaded: string[] = [];
  readonly played: Array<{ url: string; playback: SamplePlayback }> = [];

  preloadSample(url: string): void {
    this.preloaded.push(url);
  }

  playSample(url: string, playback: SamplePlayback = {}): void {
    this.played.push({ url, playback });
  }
}

test("monster audio is positional, animation-driven and silent for missing cues", () => {
  const output = new RecordingAudio();
  const mixer = new MonsterAudioMixer(output, () => 0.25);
  mixer.preload();
  assert.deepEqual(new Set(output.preloaded), new Set(["/sfx/ashling-idle.m4a", "/sfx/ashling-aggro.m4a"]));

  mixer.setListener(100, 100);
  mixer.movementFrame(1, "ashling", "normal", 160, 100, 2, 1_000);
  assert.equal(output.played.length, 0, "frames without an authored contact event remain silent");

  mixer.movementFrame(1, "ashling", "normal", 160, 100, 1, 1_000);
  assert.equal(output.played.length, 1);
  assert.equal(output.played[0].url, "/sfx/ashling-idle.m4a");
  assert.equal(output.played[0].playback.voiceGroup, "monster:movement");
  assert.ok((output.played[0].playback.pan ?? 0) > 0, "a monster to the right is panned right");

  mixer.movementFrame(2, "ashling", "normal", 160, 100, 1, 1_040);
  assert.equal(output.played.length, 1, "pack-wide cue cooldowns prevent a chorus of identical steps");
  mixer.movementFrame(2, "ashling", "normal", 160, 100, 1, 1_080);
  assert.equal(output.played.length, 2);

  mixer.action(3, "cinder-spitter", "normal", "ranged", 150, 100, 1_500);
  mixer.death(3, "cinder-spitter", "normal", 150, 100, 1_500);
  assert.equal(output.played.length, 2, "missing authored action and death clips do not use a fallback sound");

  mixer.aggro(4, "ashling", 2_000, 2_000, 2_000);
  assert.equal(output.played.length, 2, "sounds outside their authored radius are culled");
});

test("an authored death cue uses the dedicated death voice budget", () => {
  const output = new RecordingAudio();
  const mixer = new MonsterAudioMixer(output, () => 0.5);
  const previousDeath = MONSTER_ARCHETYPES.ashling.sfx.death;
  MONSTER_ARCHETYPES.ashling.sfx.death = {
    samples: [{ url: "/sfx/ashling-death.m4a" }],
    volume: 0.8,
    radius: 700,
    maxVoices: 4,
  };
  try {
    mixer.setListener(100, 100);
    mixer.death(42, "ashling", "rare", 120, 100, 3_000);
    assert.equal(output.played.length, 1);
    assert.equal(output.played[0].playback.voiceGroup, "monster:death");
    assert.equal(output.played[0].playback.maxVoices, 4);
    assert.ok((output.played[0].playback.volume ?? 0) > 0.8, "rare deaths receive a subtle emphasis");
  } finally {
    if (previousDeath) MONSTER_ARCHETYPES.ashling.sfx.death = previousDeath;
    else delete MONSTER_ARCHETYPES.ashling.sfx.death;
  }
});
