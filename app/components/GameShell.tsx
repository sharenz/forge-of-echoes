"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHARACTER_CLASSES, XP_BY_LEVEL } from "../game/content";
import { buildArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import type { CharacterClassId, CurrencyId, EquipmentItem, InventoryItem, MapItem, PlayerProfile, RunResult } from "../game/domain";
import { addCurrencyToInventory, addItemsToInventory, isEquipmentItem, isMapItem, profileCurrencyAmounts, consumeProfileCurrency } from "../game/inventory";
import { addFireAffix, generateEquipment, rerollAffixValues } from "../game/items";
import { addMapModifier, rerollMap } from "../game/maps";
import { purchaseMap } from "../game/merchant";
import { addRecoveredItems, applyRunResult, createCharacter, deriveStats, loadProfile, saveProfile } from "../game/profile";
import type { WorldStation } from "../game2d/types";
import { GameNotification } from "./GameNotification";
import { InventoryPanel } from "./InventoryPanel";
import { ItemWorkbench } from "./ItemWorkbench";
import { MapWorkshop } from "./MapWorkshop";
import { MapMerchant } from "./MapMerchant";
import { PhaserWorld } from "./PhaserWorld";

type HideoutPanel = "inventory" | "stash" | "bench" | "maps" | "merchant" | null;
type GameScreen = "hideout" | "arena";
interface RunLootLedger { items: InventoryItem[] }
const emptyRunLoot = (): RunLootLedger => ({ items: [] });

export function GameShell() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [selectedClass, setSelectedClass] = useState<CharacterClassId>("amazon");
  const [characterName, setCharacterName] = useState("");
  const [panel, setPanel] = useState<HideoutPanel>(null);
  const [screen, setScreen] = useState<GameScreen>("hideout");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runItems, setRunItems] = useState<InventoryItem[]>([]);
  const runLootRef = useRef<RunLootLedger>(emptyRunLoot());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = loadProfile();
      setProfile(loaded);
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
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Escape") {
        setPanel(null);
        return;
      }
      if (event.code !== "KeyI" || event.repeat || !profile?.character.created) return;
      setPanel((current) => current === "inventory" ? null : "inventory");
    };
    window.addEventListener("keydown", toggleInventory);
    return () => window.removeEventListener("keydown", toggleInventory);
  }, [profile?.character.created, screen]);

  const stats = useMemo(() => profile ? deriveStats(profile) : null, [profile]);
  const arenaBalance = useMemo(() => profile?.openedMap ? buildArenaBalance(profile) : undefined, [profile]);
  const currencies = useMemo(() => profile ? profileCurrencyAmounts(profile) : null, [profile]);

  if (!profile || !stats || !currencies) {
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

  const backpackItems: InventoryItem[] = screen === "arena" ? [...runItems, ...profile.inventory] : profile.inventory;
  const allItems = [...Object.values(profile.equipped).filter(Boolean), ...backpackItems.filter(isEquipmentItem), ...profile.stash.filter(isEquipmentItem)] as EquipmentItem[];
  const inventoryMaps = profile.inventory.filter(isMapItem);
  const equippedIds = new Set(Object.values(profile.equipped).filter(Boolean).map((item) => item?.id)) as Set<string>;

  if (screen === "arena" && profile.openedMap && arenaBalance) {
    const inventoryOpen = panel === "inventory";
    return (
      <PhaserWorld mode="arena" classId={profile.character.classId} portalActive paused={inventoryOpen} arenaBalance={arenaBalance} characterStats={stats} onLootPickup={collectMapDrop} onArenaComplete={completeArena}>
        <button type="button" className="arena-inventory-toggle" onClick={() => setPanel(inventoryOpen ? null : "inventory")}>Inventory <kbd>I</kbd></button>
        <button type="button" className="return-hideout" onClick={leaveArena}>Return to hideout</button>
        {inventoryOpen && (
          <div className="world-panel-backdrop arena-panel-backdrop">
            <section className="world-panel panel-inventory" aria-label="Character inventory">
              <header><div><span>Combat paused · equipment changes apply immediately</span><h2>Inventory</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close inventory">×</button></header>
              <InventoryPanel profile={profile} backpackItems={backpackItems} selectedItemId={selectedItemId} freshItemIds={runItems.map((item) => item.id)} onSelect={setSelectedItemId} onEquipItem={equipItem} onUnequipItem={unequipItem} />
            </section>
          </div>
        )}
        {notice && <GameNotification key={notice} message={notice} />}
      </PhaserWorld>
    );
  }

  const xpRequired = XP_BY_LEVEL(profile.character.level);
  const xpPercent = profile.character.level === 99 ? 100 : (profile.character.xp / xpRequired) * 100;

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
    if (station === "merchant") setPanel("merchant");
    if (station === "portal") {
      resetRunLoot();
      setPanel(null);
      setScreen("arena");
    }
  }

  function craftMap(action: "dust" | "threat" | "reward") {
    if (!profile?.mapDevice) return;
    const costs = { dust: "mapDust", threat: "threatGlyph", reward: "rewardInk" } as const;
    const currency = costs[action];
    const transformed = action === "dust" ? rerollMap(profile.mapDevice) : addMapModifier(profile.mapDevice, action);
    if (transformed === profile.mapDevice) return;
    const paid = consumeProfileCurrency(profile, currency, 1);
    if (!paid) return;
    setProfile({ ...paid, mapDevice: transformed });
  }

  function openPortal() {
    if (!profile?.mapDevice || profile.openedMap) return;
    const map = profile.mapDevice;
    setProfile({ ...profile, mapDevice: null, openedMap: map });
    setPanel(null);
    setNotice(`${map.baseName} portal opened.`);
  }

  function slotMap(mapId: string) {
    if (!profile) return;
    const map = profile.inventory.find((item): item is MapItem => isMapItem(item) && item.id === mapId);
    if (!map) return;
    const inventory = profile.inventory.filter((item) => item.id !== map.id);
    if (profile.mapDevice) inventory.unshift(profile.mapDevice);
    setProfile({ ...profile, inventory, mapDevice: map });
    setSelectedItemId(map.id);
  }

  function removeMapFromDevice() {
    if (!profile?.mapDevice) return;
    setProfile({ ...profile, inventory: [profile.mapDevice, ...profile.inventory], mapDevice: null });
  }

  function buyMap(offerId: string) {
    if (!profile) return;
    const purchase = purchaseMap(profile, offerId);
    if (!purchase) {
      setNotice("You do not have enough Scrap for that map.");
      return;
    }
    setProfile(purchase.profile);
    setSelectedItemId(purchase.map.id);
    setNotice(purchase.paid === 0 ? `${purchase.map.baseName} added to your backpack for free.` : `${purchase.map.baseName} purchased for ${purchase.paid} Scrap.`);
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
        items: recovered.items,
      },
    };
    const next = applyRunResult(profile, result);
    setProfile(next);
    setSelectedItemId(result.loot.items[0]?.id ?? next.inventory[0]?.id ?? null);
    resetRunLoot();
    setPanel(null);
    setScreen("hideout");
    setNotice(`Map complete. ${result.loot.items.length} collected items recovered.`);
  }

  function collectMapDrop(drop: MapDrop) {
    if (!profile?.openedMap) return;
    if (drop.kind === "equipment") {
      const item = generateEquipment(Math.max(2, profile.openedMap.tier) * 5, drop.rarity);
      runLootRef.current.items = [item, ...runLootRef.current.items];
      setRunItems([...runLootRef.current.items]);
      setSelectedItemId(item.id);
      return;
    }
    runLootRef.current.items = addCurrencyToInventory(runLootRef.current.items, drop.currency, drop.amount);
    setRunItems([...runLootRef.current.items]);
  }

  function leaveArena() {
    if (!profile) return;
    const recovered = runLootRef.current;
    setProfile({ ...addRecoveredItems(profile, recovered.items), openedMap: null });
    setSelectedItemId(recovered.items[0]?.id ?? profile.inventory[0]?.id ?? null);
    resetRunLoot();
    setPanel(null);
    setScreen("hideout");
    setNotice(`Map abandoned. ${recovered.items.length} collected items were kept.`);
  }

  function craftItem(action: "scrap" | "essence") {
    if (!profile || !selectedItemId) return;
    const currency: CurrencyId = action === "scrap" ? "scrap" : "essence";
    if (!currencies || currencies[currency] <= 0) return;
    const transform = action === "scrap" ? rerollAffixValues : addFireAffix;
    let changed = false;
    const update = (item: EquipmentItem) => {
      if (item.id !== selectedItemId) return item;
      const next = transform(item);
      changed = next !== item;
      return next;
    };
    const inventory = profile.inventory.map((item) => isEquipmentItem(item) ? update(item) : item);
    const stash = profile.stash.map((item) => isEquipmentItem(item) ? update(item) : item);
    const equipped = Object.fromEntries(Object.entries(profile.equipped).map(([slot, item]) => [slot, item ? update(item) : item])) as PlayerProfile["equipped"];
    if (!changed) return;
    const paid = consumeProfileCurrency({ ...profile, inventory, stash, equipped }, currency, 1);
    if (paid) setProfile(paid);
  }

  function resetRunLoot() {
    runLootRef.current = emptyRunLoot();
    setRunItems([]);
  }

  function equipSelected() {
    if (selectedItemId) equipItem(selectedItemId);
  }

  function equipItem(itemId: string) {
    if (!profile) return;
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item || profile.equipped[item.slot]?.id === item.id) return;
    const previouslyEquipped = profile.equipped[item.slot];
    const isRunItem = runItems.some((candidate) => isEquipmentItem(candidate) && candidate.id === item.id);
    if (isRunItem) {
      runLootRef.current.items = runLootRef.current.items.filter((candidate) => candidate.id !== item.id);
      setRunItems((current) => current.filter((candidate) => candidate.id !== item.id));
    }
    setProfile({
      ...profile,
      inventory: [...(previouslyEquipped ? [previouslyEquipped] : []), ...profile.inventory.filter((candidate) => candidate.id !== item.id)],
      stash: profile.stash.filter((candidate) => candidate.id !== item.id),
      equipped: { ...profile.equipped, [item.slot]: item },
    });
    setSelectedItemId(item.id);
    setNotice(`${item.baseName} equipped.`);
  }

  function unequipItem(itemId: string) {
    if (!profile) return;
    const item = Object.values(profile.equipped).find((candidate) => candidate?.id === itemId);
    if (!item || profile.equipped[item.slot]?.id !== item.id) return;
    setProfile({
      ...profile,
      inventory: [item, ...profile.inventory],
      equipped: { ...profile.equipped, [item.slot]: undefined },
    });
    setSelectedItemId(item.id);
    setNotice(`${item.baseName} moved to your backpack.`);
  }

  function transferItem(itemId: string) {
    if (!profile) return;
    const item = [...profile.inventory, ...profile.stash].find((candidate) => candidate.id === itemId);
    if (!item) return;
    const inStash = profile.stash.some((candidate) => candidate.id === item.id);
    if (inStash) {
      setProfile({ ...profile, stash: profile.stash.filter((candidate) => candidate.id !== item.id), inventory: addItemsToInventory(profile.inventory, [item]) });
    } else if (profile.inventory.some((candidate) => candidate.id === item.id)) {
      setProfile({ ...profile, inventory: profile.inventory.filter((candidate) => candidate.id !== item.id), stash: addItemsToInventory(profile.stash, [item]) });
    }
    setSelectedItemId(item.id);
  }

  return (
    <PhaserWorld mode="hideout" classId={profile.character.classId} portalActive={Boolean(profile.openedMap)} characterStats={stats} onStation={handleStation}>
      <header className="hideout-hud">
        <div className="brand-lockup"><span className="brand-mark">C</span><div><strong>CRAFTY</strong><small>THE FORGE HIDEOUT</small></div></div>
        <div className="hideout-character"><span className={`class-crest ${profile.character.classId}`}>{profile.character.classId.charAt(0).toUpperCase()}</span><div><strong>{profile.character.name}</strong><small>Level {profile.character.level} {CHARACTER_CLASSES[profile.character.classId].name}</small></div></div>
        <nav><button type="button" onClick={() => setPanel("inventory")}>Inventory <kbd>I</kbd></button><button type="button" onClick={() => setPanel("maps")}>Maps <strong>{inventoryMaps.length + (profile.mapDevice ? 1 : 0)}</strong></button></nav>
        <div className="hideout-xp"><span style={{ width: `${xpPercent}%` }} /><small>{profile.character.xp}/{xpRequired} XP</small></div>
      </header>

      <div className="hideout-prompt"><span>WASD</span> screen-aligned movement <i /> fixed camera <i /> select a labeled world station</div>
      {profile.openedMap && <div className="portal-notice"><span>Portal open</span><strong>{profile.openedMap.baseName}</strong><small>Click the portal to enter</small></div>}

      {panel && (
        <div className="world-panel-backdrop">
          <section className={`world-panel panel-${panel}`}>
            <header><div><span>{panel === "stash" ? "Hideout storage" : panel === "bench" ? "Crafting station" : panel === "maps" ? "Map device" : panel === "merchant" ? "Wayfinder's stock" : "Character equipment"}</span><h2>{panel === "stash" ? "Stash Chest" : panel === "bench" ? "The Workbench" : panel === "maps" ? "Open a Portal" : panel === "merchant" ? "Map Merchant" : "Inventory"}</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close panel">×</button></header>
            {panel === "maps" && <MapWorkshop maps={inventoryMaps} slottedMap={profile.mapDevice} currencies={currencies} portalActive={Boolean(profile.openedMap)} onSlot={slotMap} onRemove={removeMapFromDevice} onCraft={craftMap} onOpen={openPortal} />}
            {panel === "merchant" && <MapMerchant scrap={currencies.scrap} onBuy={buyMap} />}
            {panel === "bench" && <ItemWorkbench items={allItems} equippedIds={equippedIds} currencies={currencies} selectedId={selectedItemId} onSelect={setSelectedItemId} onCraft={craftItem} onEquip={equipSelected} />}
            {(panel === "inventory" || panel === "stash") && (
              <InventoryPanel profile={profile} backpackItems={profile.inventory} selectedItemId={selectedItemId} showStash={panel === "stash"} onSelect={setSelectedItemId} onEquipItem={equipItem} onUnequipItem={unequipItem} onTransferItem={transferItem} />
            )}
          </section>
        </div>
      )}
      {notice && <GameNotification key={notice} message={notice} />}
    </PhaserWorld>
  );
}
