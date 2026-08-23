"use client";

import type { ReactNode } from "react";

interface GameMenuDockProps {
  children?: ReactNode;
  className?: string;
  settingsOpen: boolean;
  onSettingsClick: () => void;
}

export function GameMenuDock({ children, className = "", settingsOpen, onSettingsClick }: GameMenuDockProps) {
  return (
    <nav className={`game-hotkey-dock collapsible-game-menu ${className}`.trim()} aria-label="Game menu">
      <button type="button" className="game-menu-trigger" aria-label="Open game menu">
        <i aria-hidden="true">☰</i><span>Game menu</span>
      </button>
      <div className="game-menu-actions">
        {children}
        <button type="button" className={`settings-dock-action ${settingsOpen ? "active" : ""}`} onClick={onSettingsClick} aria-label="Settings">
          <i aria-hidden="true">⚙</i><span>Settings</span>
        </button>
      </div>
    </nav>
  );
}
