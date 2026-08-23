import assert from "node:assert/strict";
import test from "node:test";
import { GameAudio } from "../../app/game2d/audio/GameAudio";

test("a sample requested before browser audio unlock is played after the next gesture", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const listeners = new Map<string, EventListener>();
  let allowResume = false;
  let sourceStarts = 0;
  const gainValues: Array<{ value: number }> = [];

  class FakeAudioContext {
    state: AudioContextState = "suspended";
    currentTime = 1;
    destination = {} as AudioDestinationNode;

    createGain(): GainNode {
      const node = {
        gain: {
          value: 0,
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined,
        },
        connect() { return this; },
      } as unknown as GainNode;
      gainValues.push(node.gain);
      return node;
    }

    createBufferSource(): AudioBufferSourceNode {
      return {
        buffer: null,
        playbackRate: { value: 1 },
        onended: null,
        connect() { return this; },
        start: () => { sourceStarts += 1; },
      } as unknown as AudioBufferSourceNode;
    }

    async decodeAudioData(): Promise<AudioBuffer> {
      return { duration: 2.5 } as AudioBuffer;
    }

    async resume(): Promise<void> {
      if (!allowResume) throw new Error("NotAllowedError");
      this.state = "running";
    }

    async close(): Promise<void> {
      this.state = "closed";
    }
  }

  const fakeWindow = {
    AudioContext: FakeAudioContext,
    addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
    removeEventListener: (name: string, listener: EventListener) => {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as Response;
  const audio = new GameAudio();
  try {
    audio.setMasterVolume(0.5);
    audio.preloadSample("/sfx/ashling-aggro.m4a");
    assert.equal(gainValues[0].value, 0.36, "the persisted world volume scales the shared SFX bus");
    audio.playSample("/sfx/ashling-aggro.m4a", { volume: 0.8 });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sourceStarts, 0, "the browser correctly blocks playback before a gesture");

    allowResume = true;
    listeners.get("keydown")?.({} as Event);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sourceStarts, 1, "the pending monster cue is flushed after unlock");
  } finally {
    audio.dispose();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
