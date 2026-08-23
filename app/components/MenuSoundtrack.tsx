"use client";

import { useEffect, useRef } from "react";
import { FINAL_RAGE_SOUNDTRACK, HIDEOUT_SOUNDTRACK, MAP_SOUNDTRACK, MENU_SOUNDTRACK, type SoundtrackDefinition } from "../game/config/audio";

const UNLOCK_EVENTS: readonly (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];

interface LoopingSoundtrackProps {
  soundtrack: SoundtrackDefinition;
  enabled: boolean;
  volume: number;
}

function LoopingSoundtrack({ soundtrack, enabled, volume }: LoopingSoundtrackProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
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
        if (!disposed) removeUnlockListeners();
      }).catch(() => undefined);
    };
    const unlockPlayback = () => tryPlayback();

    for (const eventName of UNLOCK_EVENTS) window.addEventListener(eventName, unlockPlayback, true);
    tryPlayback();

    return () => {
      disposed = true;
      removeUnlockListeners();
      audio.pause();
      audio.currentTime = 0;
    };
  }, [enabled, soundtrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = Math.max(0, Math.min(1, soundtrack.volume * volume));
  }, [soundtrack.volume, volume]);

  return (
    // Instrumental music contains no dialogue requiring captions.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} src={soundtrack.src} loop preload="auto" aria-hidden="true" />
  );
}

export interface SoundtrackControlProps {
  enabled: boolean;
  volume: number;
}

export function MenuSoundtrack(props: SoundtrackControlProps) {
  return <LoopingSoundtrack soundtrack={MENU_SOUNDTRACK} {...props} />;
}

export function HideoutSoundtrack(props: SoundtrackControlProps) {
  return <LoopingSoundtrack soundtrack={HIDEOUT_SOUNDTRACK} {...props} />;
}

export function MapSoundtrack({ finalRageActive = false, ...props }: SoundtrackControlProps & { finalRageActive?: boolean }) {
  return <LoopingSoundtrack soundtrack={finalRageActive ? FINAL_RAGE_SOUNDTRACK : MAP_SOUNDTRACK} {...props} />;
}
