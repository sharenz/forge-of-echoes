export interface AudioSettings {
  overall: number;
  music: number;
  world: number;
}

export type AudioSettingsChannel = keyof AudioSettings;

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = {
  overall: 1,
  music: 1,
  world: 1,
};

export const AUDIO_SETTINGS_STORAGE_KEY = "forgeOfEchoes.audioSettings";

export function clampAudioVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function normalizeAudioSettings(value: unknown): AudioSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_AUDIO_SETTINGS };
  const candidate = value as Partial<Record<AudioSettingsChannel, unknown>>;
  return {
    overall: typeof candidate.overall === "number" ? clampAudioVolume(candidate.overall) : DEFAULT_AUDIO_SETTINGS.overall,
    music: typeof candidate.music === "number" ? clampAudioVolume(candidate.music) : DEFAULT_AUDIO_SETTINGS.music,
    world: typeof candidate.world === "number" ? clampAudioVolume(candidate.world) : DEFAULT_AUDIO_SETTINGS.world,
  };
}

export function effectiveMusicVolume(settings: AudioSettings): number {
  return clampAudioVolume(settings.overall * settings.music);
}

export function effectiveWorldVolume(settings: AudioSettings): number {
  return clampAudioVolume(settings.overall * settings.world);
}
