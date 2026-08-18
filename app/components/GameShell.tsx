"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHARACTER_CLASSES, XP_BY_LEVEL } from "../game/content";
import { buildArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import type { CharacterClassId, EquipmentItem, Materials, PlayerProfile, RunResult } from "../game/domain";
import { addFireAffix, generateEquipment, rerollAffixValues } from "../game/items";
import { addMapModifier, createMap, rerollMap } from "../game/maps";
import { addMaterials, applyRunResult, createCharacter, deriveStats, loadProfile, saveProfile } from "../game/profile";
import type { WorldStation } from "../game2d/types";
import { InventoryGrid } from "./InventoryGrid";
import { ItemCard } from "./ItemCard";
import { ItemWorkbench } from "./ItemWorkbench";
import { MapWorkshop } from "./MapWorkshop";
import { PhaserWorld } from "./PhaserWorld";

type HideoutPanel = "inventory" | "stash" | "bench" | "maps" | null;
type GameScreen = "hideout" | "arena";
interface RunLootLedger { items: EquipmentItem[]; materials: Partial<Materials> }
const emptyRunLoot = (): RunLootLedger => ({ items: [], materials: {} });

export function GameShell() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [selectedClass, setSelectedClass] = useState<CharacterClassId>("amazon");
  const [characterName, setCharacterName] = useState("");
  const [panel, setPanel] = useState<HideoutPanel>(null);
  const [screen, setScreen] = useState<GameScreen>("hideout");
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runLootRef = useRef<RunLootLedger>(emptyRunLoot());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = loadProfile();
      setProfile(loaded);
      setSelectedMapId(loaded.maps[0]?.id ?? null);
      const firstItem = loaded.inventory[0] ?? loaded.stash[0] ?? Object.values(loaded.equipped)[0];
      setSelectedItemId(firstItem?.id ?? null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (profile) saveProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const toggleInventory = (event: KeyboardEvent) => {
      if (event.code !== "KeyI" || event.repeat || screen !== "hideout" || !profile?.character.created) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      setPanel((current) => current === "inventory" ? null : "inventory");
    };
    window.addEventListener("keydown", toggleInventory);
    return () => window.removeEventListener("keydown", toggleInventory);
  }, [profile?.character.created, screen]);

  const stats = useMemo(() => profile ? deriveStats(profile) : null, [profile]);

  if (!profile || !stats) {
    return <main className="loading-forge"><span className="forge-loader" /><strong>Lighting the forge</strong></main>;
  }

  if (!profile.character.created || !profile.character.classId) {
    const selected = CHARACTER_CLASSES[selectedClass];
    return (
      <PhaserWorld mode="class-select" classId={selectedClass}>
        <div className="creation-header"><span className="brand-rune">C</span><div><strong>CRAFTY</strong><small>Choose who enters the Crucible</small></div></div>
        <section className="character-creation">
          <div className="creation-title"><span>Begin your first life</span><h1>Choose your class</h1><p>Each class changes your starting attributes and weapon. Your passive tree remains open.</p></div>
          <div className="class-choice-row">
            {(Object.keys(CHARACTER_CLASSES) as CharacterClassId[]).map((classId) => {
              const definition = CHARACTER_CLASSES[classId];
              return (
                <button type="button" className={selectedClass === classId ? "selected" : ""} onClick={() => setSelectedClass(classId)} key={classId}>
                  <span>{definition.title}</span><strong>{definition.name}</strong><small>{definition.fantasy}</small><em>Starts with {definition.weapon}</em>
                </button>
              );
            })}
          </div>
          <form className="creation-confirm" onSubmit={(event) => { event.preventDefault(); startCharacter(); }}>
            <label><span>Character name</span><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder={selected.name} maxLength={24} /></label>
            <button type="submit"><span>Enter the Hideout</span><small>Begin as {selected.name}</small></button>
          </form>
        </section>
      </PhaserWorld>
    );
  }

  if (screen === "arena" && profile.openedMap) {
    const arenaBalance = buildArenaBalance(profile);
    return (
      <PhaserWorld mode="arena" classId={profile.character.classId} portalActive arenaBalance={arenaBalance} onLootPickup={collectMapDrop} onArenaComplete={completeArena}>
        <button type="button" className="return-hideout" onClick={leaveArena}>Return to hideout</button>
      </PhaserWorld>
    );
  }

  const xpRequired = XP_BY_LEVEL(profile.character.level);
  const xpPercent = profile.character.level === 99 ? 100 : (profile.character.xp / xpRequired) * 100;
  const allItems = [...Object.values(profile.equipped).filter(Boolean), ...profile.inventory, ...profile.stash] as EquipmentItem[];
  const equippedIds = new Set(Object.values(profile.equipped).filter(Boolean).map((item) => item?.id)) as Set<string>;
  const selectedItem = allItems.find((item) => item.id === selectedItemId) ?? null;

  function startCharacter() {
    if (!profile) return;
    const next = createCharacter(profile, characterName, selectedClass);
    setProfile(next);
    setSelectedItemId(next.equipped.weapon?.id ?? null);
  }

  function handleStation(station: WorldStation) {
    if (station === "stash") setPanel("stash");
    if (station === "bench") setPanel("bench");
    if (station === "map-device") setPanel("maps");
    if (station === "portal") {
      runLootRef.current = emptyRunLoot();
      setScreen("arena");
    }
  }

  function craftMap(action: "dust" | "threat" | "reward") {
    if (!profile || !selectedMapId) return;
    const costs = { dust: "mapDust", threat: "threatGlyph", reward: "rewardInk" } as const;
    const material = costs[action];
    if (profile.materials[material] <= 0) return;
    const maps = profile.maps.map((map) => map.id !== selectedMapId ? map : action === "dust" ? rerollMap(map) : addMapModifier(map, action));
    setProfile({ ...profile, maps, materials: { ...profile.materials, [material]: profile.materials[material] - 1 } });
  }

  function openPortal() {
    if (!profile) return;
    const map = profile.maps.find((candidate) => candidate.id === selectedMapId);
    if (!map) return;
    setProfile({ ...profile, maps: profile.maps.filter((candidate) => candidate.id !== map.id), openedMap: map });
    setPanel(null);
    setNotice(`${map.baseName} portal opened.`);
  }

  function completeArena(summary: ArenaSummary) {
    if (!profile) return;
    const balance = buildArenaBalance(profile);
    const rewardMultiplier = 1 + balance.rewardBonus / 100;
    const recovered = runLootRef.current;
    const result: RunResult = {
      completed: true,
      ...summary,
      loot: {
        xp: Math.round((220 + balance.tier * 65) * rewardMultiplier),
        materials: recovered.materials,
        items: recovered.items,
      },
    };
    let next = applyRunResult(profile, result);
    if (next.maps.length === 0) next = { ...next, maps: [createMap(1)] };
    setProfile(next);
    setSelectedMapId(next.maps[0]?.id ?? null);
    setSelectedItemId(result.loot.items[0]?.id ?? next.inventory[0]?.id ?? null);
    runLootRef.current = emptyRunLoot();
    setScreen("hideout");
    setNotice(`Map complete. ${result.loot.items.length} collected items recovered.`);
  }

  function collectMapDrop(drop: MapDrop) {
    if (!profile?.openedMap) return;
    if (drop.kind === "equipment") {
      runLootRef.current.items.push(generateEquipment(Math.max(2, profile.openedMap.tier) * 5, drop.rarity));
      return;
    }
    const current = runLootRef.current.materials[drop.material] ?? 0;
    runLootRef.current.materials[drop.material] = current + drop.amount;
  }

  function leaveArena() {
    if (!profile) return;
    const recovered = runLootRef.current;
    const combinedItems = [...recovered.items, ...profile.inventory];
    setProfile({
      ...profile,
      materials: addMaterials(profile.materials, recovered.materials),
      inventory: combinedItems.slice(0, 24),
      stash: [...combinedItems.slice(24), ...profile.stash],
      openedMap: null,
    });
    setSelectedItemId(recovered.items[0]?.id ?? profile.inventory[0]?.id ?? null);
    runLootRef.current = emptyRunLoot();
    setScreen("hideout");
    setNotice(`Map abandoned. ${recovered.items.length} collected items were kept.`);
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
    const stash = profile.stash.map(update);
    const equipped = Object.fromEntries(Object.entries(profile.equipped).map(([slot, item]) => [slot, item ? update(item) : item])) as PlayerProfile["equipped"];
    if (!changed) return;
    setProfile({ ...profile, inventory, stash, equipped, materials: { ...profile.materials, [material]: profile.materials[material] - 1 } });
  }

  function equipSelected() {
    if (!profile || !selectedItem) return;
    const previouslyEquipped = profile.equipped[selectedItem.slot];
    setProfile({
      ...profile,
      inventory: [...(previouslyEquipped ? [previouslyEquipped] : []), ...profile.inventory.filter((item) => item.id !== selectedItem.id)],
      stash: profile.stash.filter((item) => item.id !== selectedItem.id),
      equipped: { ...profile.equipped, [selectedItem.slot]: selectedItem },
    });
  }

  function transferSelected() {
    if (!profile || !selectedItem) return;
    const inStash = profile.stash.some((item) => item.id === selectedItem.id);
    if (inStash) {
      setProfile({ ...profile, stash: profile.stash.filter((item) => item.id !== selectedItem.id), inventory: [...profile.inventory, selectedItem] });
    } else if (profile.inventory.some((item) => item.id === selectedItem.id)) {
      setProfile({ ...profile, inventory: profile.inventory.filter((item) => item.id !== selectedItem.id), stash: [...profile.stash, selectedItem] });
    }
  }

  return (
    <PhaserWorld mode="hideout" classId={profile.character.classId} portalActive={Boolean(profile.openedMap)} onStation={handleStation}>
      <header className="hideout-hud">
        <div className="brand-lockup"><span className="brand-mark">C</span><div><strong>CRAFTY</strong><small>THE FORGE HIDEOUT</small></div></div>
        <div className="hideout-character"><span className={`class-crest ${profile.character.classId}`}>{profile.character.classId.charAt(0).toUpperCase()}</span><div><strong>{profile.character.name}</strong><small>Level {profile.character.level} {CHARACTER_CLASSES[profile.character.classId].name}</small></div></div>
        <nav><button type="button" onClick={() => setPanel("inventory")}>Inventory <kbd>I</kbd></button><button type="button" onClick={() => setPanel("maps")}>Maps <strong>{profile.maps.length}</strong></button></nav>
        <div className="hideout-xp"><span style={{ width: `${xpPercent}%` }} /><small>{profile.character.xp}/{xpRequired} XP</small></div>
      </header>

      <div className="hideout-prompt"><span>WASD</span> screen-aligned movement <i /> fixed camera <i /> select a labeled world station</div>
      {profile.openedMap && <div className="portal-notice"><span>Portal open</span><strong>{profile.openedMap.baseName}</strong><small>Click the portal to enter</small></div>}

      {panel && (
        <div className="world-panel-backdrop">
          <section className={`world-panel panel-${panel}`}>
            <header><div><span>{panel === "stash" ? "Hideout storage" : panel === "bench" ? "Crafting station" : panel === "maps" ? "Map device" : "Character equipment"}</span><h2>{panel === "stash" ? "Stash Chest" : panel === "bench" ? "The Workbench" : panel === "maps" ? "Open a Portal" : "Inventory"}</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close panel">×</button></header>
            {panel === "maps" && <MapWorkshop maps={profile.maps} selectedMapId={selectedMapId} materials={profile.materials} onSelect={setSelectedMapId} onCraft={craftMap} onEnter={openPortal} />}
            {panel === "bench" && <ItemWorkbench items={allItems} equippedIds={equippedIds} materials={profile.materials} selectedId={selectedItemId} onSelect={setSelectedItemId} onCraft={craftItem} onEquip={equipSelected} />}
            {(panel === "inventory" || panel === "stash") && (
              <div className="inventory-window">
                <div className="equipment-paperdoll">
                  <span className="eyebrow">Equipped</span>
                  {(["weapon", "chest", "ring", "boots"] as const).map((slot) => <div className={`equipment-slot slot-${slot}`} key={slot}><small>{slot}</small>{profile.equipped[slot] ? <ItemCard compact item={profile.equipped[slot]} onClick={() => setSelectedItemId(profile.equipped[slot]?.id ?? null)} selected={selectedItemId === profile.equipped[slot]?.id} /> : <span>Empty</span>}</div>)}
                </div>
                <div className="inventory-containers">
                  {panel === "stash" && <InventoryGrid items={profile.stash} columns={12} rows={8} selectedId={selectedItemId} onSelect={setSelectedItemId} label="Stash" />}
                  <InventoryGrid items={profile.inventory} columns={12} rows={5} selectedId={selectedItemId} onSelect={setSelectedItemId} label="Backpack" />
                </div>
                <aside className="inventory-inspector">
                  {selectedItem ? <><ItemCard item={selectedItem} /><button type="button" className="secondary-action" onClick={equipSelected}>Equip item</button>{panel === "stash" && <button type="button" className="secondary-action" onClick={transferSelected}>{profile.stash.some((item) => item.id === selectedItem.id) ? "Move to backpack" : "Move to stash"}</button>}</> : <p>Select an item to inspect it.</p>}
                </aside>
              </div>
            )}
          </section>
        </div>
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </PhaserWorld>
  );
}
