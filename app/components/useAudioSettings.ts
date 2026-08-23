"use client";

import { useEffect, useState } from "react";
import { AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, normalizeAudioSettings, type AudioSettings } from "../game/audio-settings";

function loadAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const stored = window.localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    return stored ? normalizeAudioSettings(JSON.parse(stored)) : { ...DEFAULT_AUDIO_SETTINGS };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function useAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings>(loadAudioSettings);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Audio preferences are a convenience only; the game remains playable
      // when private browsing or storage policies reject persistence.
    }
  }, [settings]);

  return [settings, setSettings] as const;
}
