"use client";

import { useEffect, useMemo, useState } from "react";
import { XP_BY_LEVEL } from "../game/content";
import type { EquipmentItem, PlayerProfile, RunResult } from "../game/domain";
import { addFireAffix, rerollAffixValues } from "../game/items";
import { addMapModifier, createMap, rerollMap } from "../game/maps";
import { applyRunResult, deriveStats, loadProfile, saveProfile } from "../game/profile";
import { Arena } from "./Arena";
import { ItemWorkbench } from "./ItemWorkbench";
import { MapWorkshop } from "./MapWorkshop";

type TownView = "maps" | "items";

export function GameShell() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [view, setView] = useState<TownView>("maps");
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [activeMap, setActiveMap] = useState<ReturnType<typeof createMap> | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = loadProfile();
      setProfile(loaded);
      setSelectedMapId(loaded.maps[0]?.id ?? null);
      const firstItem = loaded.inventory[0] ?? Object.values(loaded.equipped)[0];
      setSelectedItemId(firstItem?.id ?? null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (profile) saveProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const stats = useMemo(() => profile ? deriveStats(profile) : null, [profile]);

  if (!profile || !stats) {
    return <main className="loading-forge"><span className="forge-loader" /><strong>Lighting the forge</strong></main>;
  }

  if (activeMap && activeMapId) {
    return <Arena map={activeMap} stats={stats} onReturn={(result) => finishRun(result)} />;
  }

  const equipment = [...Object.values(profile.equipped).filter(Boolean), ...profile.inventory] as EquipmentItem[];
  const equippedIds = new Set(Object.values(profile.equipped).filter(Boolean).map((item) => item?.id));
  const xpRequired = XP_BY_LEVEL(profile.character.level);
  const xpPercent = profile.character.level === 99 ? 100 : (profile.character.xp / xpRequired) * 100;

  function craftMap(action: "dust" | "threat" | "reward") {
    if (!profile || !selectedMapId) return;
    const costs = { dust: "mapDust", threat: "threatGlyph", reward: "rewardInk" } as const;
    const material = costs[action];
    if (profile.materials[material] <= 0) return;
    const maps = profile.maps.map((map) => {
      if (map.id !== selectedMapId) return map;
      if (action === "dust") return rerollMap(map);
      return addMapModifier(map, action);
    });
    setProfile({
      ...profile,
      maps,
      materials: { ...profile.materials, [material]: profile.materials[material] - 1 },
    });
    setNotice(action === "dust" ? "The map's paths have shifted." : "A new affix was etched into the map.");
  }

  function enterMap() {
    if (!profile) return;
    const map = profile.maps.find((candidate) => candidate.id === selectedMapId);
    if (!map) return;
    setProfile({ ...profile, maps: profile.maps.filter((candidate) => candidate.id !== map.id) });
    setActiveMap(map);
    setActiveMapId(map.id);
    setLastRun(null);
  }

  function finishRun(result: RunResult) {
    if (!profile) return;
    let nextProfile = applyRunResult(profile, result);
    if (nextProfile.maps.length === 0) nextProfile = { ...nextProfile, maps: [createMap(1)] };
    setProfile(nextProfile);
    setSelectedMapId(nextProfile.maps[0]?.id ?? null);
    setSelectedItemId(result.loot.items[0]?.id ?? selectedItemId);
    setLastRun(result);
    setActiveMap(null);
    setActiveMapId(null);
    setView(result.loot.items.length > 0 ? "items" : "maps");
  }

  function craftItem(action: "scrap" | "essence") {
    if (!profile || !selectedItemId) return;
    const material = action === "scrap" ? "scrap" : "essence";
    if (profile.materials[material] <= 0) return;
    const transform = action === "scrap" ? rerollAffixValues : addFireAffix;
    let changed = false;
    const update = (item: EquipmentItem) => {
      if (item.id !== selectedItemId) return item;
      const next = transform(item);
      changed = next !== item;
      return next;
    };
    const inventory = profile.inventory.map(update);
    const equipped = Object.fromEntries(
      Object.entries(profile.equipped).map(([slot, item]) => [slot, item ? update(item) : item]),
    ) as PlayerProfile["equipped"];
    if (!changed) return;
    setProfile({
      ...profile,
      inventory,
      equipped,
      materials: { ...profile.materials, [material]: profile.materials[material] - 1 },
    });
    setNotice(action === "scrap" ? "Affix values refined." : "A fire affix took shape.");
  }

  function equipSelected() {
    if (!profile || !selectedItemId) return;
    const selected = profile.inventory.find((item) => item.id === selectedItemId);
    if (!selected) return;
    const previouslyEquipped = profile.equipped[selected.slot];
    setProfile({
      ...profile,
      inventory: [
        ...(previouslyEquipped ? [previouslyEquipped] : []),
        ...profile.inventory.filter((item) => item.id !== selected.id),
      ],
      equipped: { ...profile.equipped, [selected.slot]: selected },
    });
    setNotice(`${selected.baseName} equipped.`);
  }

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="brand-lockup"><span className="brand-mark">C</span><div><strong>CRAFTY</strong><small>THE CRUCIBLE PROTOTYPE</small></div></div>
        <nav className="town-nav" aria-label="Forge navigation">
          <button type="button" className={view === "maps" ? "active" : ""} onClick={() => setView("maps")}><span>01</span> Map Forge</button>
          <button type="button" className={view === "items" ? "active" : ""} onClick={() => setView("items")}><span>02</span> Workbench</button>
        </nav>
        <div className="character-summary">
          <div className="level-medallion"><small>LVL</small><strong>{profile.character.level}</strong></div>
          <div><strong>{profile.character.name}</strong><span>{profile.character.archetype} · {profile.character.unspentPassives} passive points</span></div>
        </div>
      </header>

      <section className="resource-ribbon">
        <div className="xp-track"><span style={{ width: `${xpPercent}%` }} /></div>
        <div className="resource-list">
          <span><i>S</i> Scrap <strong>{profile.materials.scrap}</strong></span>
          <span><i className="essence">E</i> Essence <strong>{profile.materials.essence}</strong></span>
          <span><i>D</i> Map Dust <strong>{profile.materials.mapDust}</strong></span>
          <span><i>G</i> Threat Glyph <strong>{profile.materials.threatGlyph}</strong></span>
          <span><i>I</i> Reward Ink <strong>{profile.materials.rewardInk}</strong></span>
        </div>
        <div className="xp-label">{profile.character.level === 99 ? "Level cap" : `${profile.character.xp} / ${xpRequired} XP`}</div>
      </section>

      <div className="town-intro">
        <div><span className="eyebrow">{view === "maps" ? "Prepare the expedition" : "Shape what survived"}</span><h1>{view === "maps" ? "Every map is a wager." : "Great items are made, not found."}</h1></div>
        <p>{view === "maps" ? "Etch danger into the map, enter its six waves, and decide how far your build can be pushed." : "Develop promising bases through controlled crafts. Stability makes every decision permanent."}</p>
      </div>

      {lastRun && <div className={`last-run ${lastRun.completed ? "success" : "failure"}`}><strong>{lastRun.completed ? "Map completed" : "Map failed"}</strong><span>{lastRun.enemiesSlain} slain · {lastRun.loot.xp} XP · {lastRun.loot.items.length} items recovered</span><button type="button" onClick={() => setLastRun(null)}>×</button></div>}

      {view === "maps" ? (
        <MapWorkshop
          maps={profile.maps}
          selectedMapId={selectedMapId}
          materials={profile.materials}
          onSelect={setSelectedMapId}
          onCraft={craftMap}
          onEnter={enterMap}
        />
      ) : (
        <ItemWorkbench
          items={equipment}
          equippedIds={equippedIds as Set<string>}
          materials={profile.materials}
          selectedId={selectedItemId}
          onSelect={setSelectedItemId}
          onCraft={craftItem}
          onEquip={equipSelected}
        />
      )}

      <footer className="game-footer"><span>Prototype save is stored on this device</span><span>WASD to move · Mouse to aim and fire · Q / E skills</span></footer>
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
