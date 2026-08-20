"use client";

import { useEffect, useRef, useState } from "react";
import { FINAL_RAGE_SOUNDTRACK, HIDEOUT_SOUNDTRACK, MAP_SOUNDTRACK, MENU_SOUNDTRACK, type SoundtrackDefinition } from "../game/config/audio";

const UNLOCK_EVENTS: readonly (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];

interface LoopingSoundtrackProps {
  soundtrack: SoundtrackDefinition;
  enabled: boolean;
  compact?: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

function LoopingSoundtrack({ soundtrack, enabled, compact = false, onEnabledChange }: LoopingSoundtrackProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackState, setPlaybackState] = useState<"loading" | "playing" | "paused" | "blocked" | "error">("loading");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = soundtrack.volume;

    if (!enabled) {
      audio.pause();
      return;
    }

    let disposed = false;
    const removeUnlockListeners = () => {
      for (const eventName of UNLOCK_EVENTS) window.removeEventListener(eventName, unlockPlayback, true);
    };
    const tryPlayback = () => {
      void audio.play().then(() => {
        if (!disposed) {
          setPlaybackState("playing");
          removeUnlockListeners();
        }
      }).catch(() => {
        // Browsers commonly block unprompted audio. The capture listeners below
        // retry on the first real interaction without interrupting navigation.
        if (!disposed) setPlaybackState("blocked");
      });
    };
    const unlockPlayback = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".menu-soundtrack-control")) return;
      tryPlayback();
    };
    const markPlaying = () => setPlaybackState("playing");
    const markPaused = () => { if (!disposed) setPlaybackState("paused"); };
    const markError = () => setPlaybackState("error");

    for (const eventName of UNLOCK_EVENTS) window.addEventListener(eventName, unlockPlayback, true);
    audio.addEventListener("playing", markPlaying);
    audio.addEventListener("pause", markPaused);
    audio.addEventListener("error", markError);
    tryPlayback();

    return () => {
      disposed = true;
      removeUnlockListeners();
      audio.removeEventListener("playing", markPlaying);
      audio.removeEventListener("pause", markPaused);
      audio.removeEventListener("error", markError);
      audio.pause();
      audio.currentTime = 0;
    };
  }, [enabled, soundtrack]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playbackState === "playing") {
      onEnabledChange(false);
      return;
    }
    onEnabledChange(true);
    void audio.play().then(() => setPlaybackState("playing")).catch(() => setPlaybackState("blocked"));
  };

  const isPlaying = enabled && playbackState === "playing";
  const displayedPlaybackState = enabled ? playbackState : "paused";

  return (
    <>
      {/* Instrumental music contains no dialogue requiring captions. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={soundtrack.src} loop preload="auto" aria-hidden="true" />
      <button
        type="button"
        className={`menu-soundtrack-control ${compact ? "is-compact" : ""} state-${displayedPlaybackState}`}
        aria-label={`${isPlaying ? "Turn off" : "Turn on"} music · ${soundtrack.title}`}
        aria-pressed={isPlaying}
        data-tooltip={`${isPlaying ? "Turn off" : "Turn on"} music · ${soundtrack.title}`}
        onClick={togglePlayback}
      >
        <i aria-hidden="true">{isPlaying ? "♫" : "♪"}</i>
        <span><small>Music {isPlaying ? "on" : "off"}</small><strong>{soundtrack.title}</strong></span>
      </button>
    </>
  );
}

export interface SoundtrackControlProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export function MenuSoundtrack(props: SoundtrackControlProps) {
  return <LoopingSoundtrack soundtrack={MENU_SOUNDTRACK} {...props} />;
}

export function HideoutSoundtrack(props: SoundtrackControlProps) {
  return <LoopingSoundtrack soundtrack={HIDEOUT_SOUNDTRACK} compact {...props} />;
}

export function MapSoundtrack({ finalRageActive = false, ...props }: SoundtrackControlProps & { finalRageActive?: boolean }) {
  return <LoopingSoundtrack soundtrack={finalRageActive ? FINAL_RAGE_SOUNDTRACK : MAP_SOUNDTRACK} compact {...props} />;
}
