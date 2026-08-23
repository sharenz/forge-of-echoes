"use client";

import type { CSSProperties } from "react";
import { DEFAULT_AUDIO_SETTINGS, clampAudioVolume, type AudioSettings, type AudioSettingsChannel } from "../game/audio-settings";

interface AudioSettingsMenuProps {
  open: boolean;
  settings: AudioSettings;
  musicEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (channel: AudioSettingsChannel, value: number) => void;
  onMusicEnabledChange: (enabled: boolean) => void;
}

const CHANNELS: readonly { id: AudioSettingsChannel; label: string; description: string; glyph: string }[] = [
  { id: "overall", label: "Overall volume", description: "Master level for the complete game mix", glyph: "◆" },
  { id: "music", label: "Music", description: "Menus, hideout, maps, and final-wave score", glyph: "♫" },
  { id: "world", label: "Monster / map sounds", description: "Combat, monsters, skills, and world effects", glyph: "✦" },
];

export function AudioSettingsMenu({ open, settings, musicEnabled, onOpenChange, onChange, onMusicEnabledChange }: AudioSettingsMenuProps) {
  if (!open) return null;

  return (
    <div className="audio-settings-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}>
      <section className="audio-settings-menu" role="dialog" aria-modal="true" aria-labelledby="audio-settings-title">
        <header><div><span>Sound mixer</span><h2 id="audio-settings-title">Settings</h2></div><button type="button" onClick={() => onOpenChange(false)} aria-label="Close settings">×</button></header>
        <div className="audio-settings-channels">
          {CHANNELS.map((channel) => {
            const percentage = Math.round(settings[channel.id] * 100);
            return (
              <div className={`audio-channel channel-${channel.id}`} key={channel.id}>
                <i aria-hidden="true">{channel.glyph}</i>
                <span><strong>{channel.label}</strong><small>{channel.description}</small></span>
                <div className="audio-channel-value">
                  {channel.id === "music" && (
                    <button
                      type="button"
                      className={musicEnabled ? "enabled" : ""}
                      aria-label={`${musicEnabled ? "Turn off" : "Turn on"} music`}
                      aria-pressed={musicEnabled}
                      onClick={() => onMusicEnabledChange(!musicEnabled)}
                    >{musicEnabled ? "On" : "Off"}</button>
                  )}
                  <output aria-label={`${channel.label} level`}>{percentage}%</output>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={percentage}
                  style={{ "--audio-level": `${percentage}%` } as CSSProperties}
                  onInput={(event) => onChange(channel.id, clampAudioVolume(event.currentTarget.valueAsNumber / 100))}
                  aria-label={channel.label}
                />
              </div>
            );
          })}
        </div>
        <footer><button type="button" onClick={() => { for (const channel of CHANNELS) onChange(channel.id, DEFAULT_AUDIO_SETTINGS[channel.id]); }}>Restore defaults</button><span>Saved on this device</span><kbd>Esc</kbd></footer>
      </section>
    </div>
  );
}
