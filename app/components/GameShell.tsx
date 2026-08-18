"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHARACTER_CLASSES, XP_BY_LEVEL } from "../game/content";
import { buildArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import type { CharacterClassId, CharacterEquipmentSlot, CurrencyId, EquipmentItem, ItemContainerId, PlayerProfile, RunResult } from "../game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts, findEquippedSlot } from "../game/equipment";
import { isEquipmentItem, isMapItem, profileCurrencyAmounts, consumeProfileCurrency, createCurrencyStack } from "../game/inventory";
import { containerItems, findContainerEntry, insertItem, mapContainerItems, moveItem, removeItem, transferItem } from "../game/item-container";
import { addFireAffix, generateEquipment, rerollAffixValues } from "../game/items";
import { addMapModifier, rerollMap } from "../game/maps";
import { purchaseMap } from "../game/merchant";
import { applyRunResult, createCharacter, deriveStats, loadProfile, saveProfile } from "../game/profile";
import type { WorldStation } from "../game2d/types";
import { GameNotification } from "./GameNotification";
import { InventoryPanel } from "./InventoryPanel";
import { ItemWorkbench } from "./ItemWorkbench";
import { MapWorkshop } from "./MapWorkshop";
import { MapMerchant } from "./MapMerchant";
import { PhaserWorld } from "./PhaserWorld";

type HideoutPanel = "inventory" | "stash" | "bench" | "maps" | "merchant" | null;
type GameScreen = "hideout" | "arena";
interface RunLootLedger { collected: number; freshItemIds: string[] }
const emptyRunLoot = (): RunLootLedger => ({ collected: 0, freshItemIds: [] });

export function GameShell() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [selectedClass, setSelectedClass] = useState<CharacterClassId>("amazon");
  const [characterName, setCharacterName] = useState("");
  const [panel, setPanel] = useState<HideoutPanel>(null);
  const [screen, setScreen] = useState<GameScreen>("hideout");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runFreshItemIds, setRunFreshItemIds] = useState<string[]>([]);
  const runLootRef = useRef<RunLootLedger>(emptyRunLoot());
  const profileRef = useRef<PlayerProfile | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = loadProfile();
      profileRef.current = loaded;
      setProfile(loaded);
      const firstItem = loaded.inventory.entries[0]?.item ?? loaded.stash.entries[0]?.item ?? Object.values(loaded.equipped)[0];
      setSelectedItemId(firstItem?.id ?? null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (profile) {
      profileRef.current = profile;
      saveProfile(profile);
    }
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

  const backpackItems = containerItems(profile.inventory);
  const stashItems = containerItems(profile.stash);
  const allItems = [...Object.values(profile.equipped).filter(Boolean), ...backpackItems.filter(isEquipmentItem), ...stashItems.filter(isEquipmentItem)] as EquipmentItem[];
  const inventoryMaps = backpackItems.filter(isMapItem);
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
              <InventoryPanel profile={profile} selectedItemId={selectedItemId} freshItemIds={runFreshItemIds} onSelect={setSelectedItemId} onEquipItem={equipItem} onMoveItem={moveInventoryItem} />
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
    setSelectedItemId(next.equipped.mainHand?.id ?? null);
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
    const removed = removeItem(profile.inventory, mapId);
    if (!removed || !isMapItem(removed.entry.item)) return;
    let inventory = removed.container;
    if (profile.mapDevice) {
      const returned = insertItem(inventory, profile.mapDevice, { x: removed.entry.x, y: removed.entry.y });
      if (returned.unplaced.length > 0) {
        setNotice("The previous map needs a free backpack cell first.");
        return;
      }
      inventory = returned.container;
    }
    setProfile({ ...profile, inventory, mapDevice: removed.entry.item });
    setSelectedItemId(removed.entry.item.id);
  }

  function removeMapFromDevice() {
    if (!profile?.mapDevice) return;
    const inserted = insertItem(profile.inventory, profile.mapDevice);
    if (inserted.unplaced.length > 0) {
      setNotice("Your backpack has no free cell for this map.");
      return;
    }
    setProfile({ ...profile, inventory: inserted.container, mapDevice: null });
  }

  function buyMap(offerId: string) {
    if (!profile) return;
    const purchase = purchaseMap(profile, offerId);
    if (!purchase) {
      setNotice("Not enough Scrap, or no free backpack cell for that map.");
      return;
    }
    setProfile(purchase.profile);
    setSelectedItemId(purchase.map.id);
    setNotice(purchase.paid === 0 ? `${purchase.map.baseName} added to your backpack for free.` : `${purchase.map.baseName} purchased for ${purchase.paid} Scrap.`);
  }

  function completeArena(summary: ArenaSummary) {
    if (!profile) return;
    const current = profileRef.current ?? profile;
    const balance = buildArenaBalance(current);
    const rewardMultiplier = 1 + balance.rewardBonus / 100;
    const recovered = runLootRef.current;
    const result: RunResult = {
      completed: true,
      ...summary,
      loot: {
        xp: Math.round((220 + balance.tier * 65) * rewardMultiplier),
        items: [],
      },
    };
    const next = applyRunResult(current, result);
    profileRef.current = next;
    setProfile(next);
    setSelectedItemId(next.inventory.entries[0]?.item.id ?? null);
    resetRunLoot();
    setPanel(null);
    setScreen("hideout");
    setNotice(`Map complete. ${recovered.collected} ground drops collected.`);
  }

  function collectMapDrop(drop: MapDrop): boolean {
    const current = profileRef.current;
    if (!current?.openedMap) return false;
    const item = drop.kind === "equipment"
      ? generateEquipment(Math.max(2, current.openedMap.tier) * 5, drop.rarity)
      : createCurrencyStack(drop.currency, drop.amount);
    const inserted = insertItem(current.inventory, item);
    if (inserted.unplaced.length > 0) {
      setNotice("Backpack full — make room before collecting this drop.");
      return false;
    }
    const next = { ...current, inventory: inserted.container };
    profileRef.current = next;
    setProfile(next);
    runLootRef.current = {
      collected: runLootRef.current.collected + 1,
      freshItemIds: [...runLootRef.current.freshItemIds, item.id],
    };
    setRunFreshItemIds([...runLootRef.current.freshItemIds]);
    if (drop.kind === "equipment") setSelectedItemId(item.id);
    return true;
  }

  function leaveArena() {
    if (!profile) return;
    const current = profileRef.current ?? profile;
    const recovered = runLootRef.current;
    const next = { ...current, openedMap: null };
    profileRef.current = next;
    setProfile(next);
    setSelectedItemId(recovered.freshItemIds[0] ?? current.inventory.entries[0]?.item.id ?? null);
    resetRunLoot();
    setPanel(null);
    setScreen("hideout");
    setNotice(`Map abandoned. ${recovered.collected} collected drops were kept.`);
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
    const inventory = mapContainerItems(profile.inventory, (item) => isEquipmentItem(item) ? update(item) : item);
    const stash = mapContainerItems(profile.stash, (item) => isEquipmentItem(item) ? update(item) : item);
    const equipped = Object.fromEntries(Object.entries(profile.equipped).map(([slot, item]) => [slot, item ? update(item) : item])) as PlayerProfile["equipped"];
    if (!changed) return;
    const paid = consumeProfileCurrency({ ...profile, inventory, stash, equipped }, currency, 1);
    if (paid) setProfile(paid);
  }

  function resetRunLoot() {
    runLootRef.current = emptyRunLoot();
    setRunFreshItemIds([]);
  }

  function equipSelected() {
    if (selectedItemId) equipItem(selectedItemId);
  }

  function equipItem(itemId: string, requestedSlot?: CharacterEquipmentSlot) {
    if (!profile) return;
    const item = allItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const currentSlot = findEquippedSlot(profile.equipped, item.id);
    if (currentSlot) {
      if (!requestedSlot || requestedSlot === currentSlot || !equipmentSlotAccepts(requestedSlot, item)) return;
      const targetItem = profile.equipped[requestedSlot];
      setProfile({
        ...profile,
        equipped: { ...profile.equipped, [currentSlot]: targetItem, [requestedSlot]: item },
      });
      setSelectedItemId(item.id);
      return;
    }
    const targetSlot = requestedSlot && equipmentSlotAccepts(requestedSlot, item)
      ? requestedSlot
      : chooseEquipmentSlot(item, profile.equipped);
    const previouslyEquipped = profile.equipped[targetSlot];
    const inventoryEntry = findContainerEntry(profile.inventory, item.id);
    const stashEntry = findContainerEntry(profile.stash, item.id);
    const sourceKey = inventoryEntry ? "inventory" : stashEntry ? "stash" : null;
    const sourceEntry = inventoryEntry ?? stashEntry;
    if (!sourceKey || !sourceEntry) return;
    const removed = removeItem(profile[sourceKey], item.id);
    if (!removed) return;
    let source = removed.container;
    if (previouslyEquipped) {
      const swapped = insertItem(source, previouslyEquipped, { x: sourceEntry.x, y: sourceEntry.y });
      if (swapped.unplaced.length > 0) {
        setNotice(`No fitting ${source.id} space for ${previouslyEquipped.baseName}.`);
        return;
      }
      source = swapped.container;
    }
    setProfile({ ...profile, [sourceKey]: source, equipped: { ...profile.equipped, [targetSlot]: item } });
    setSelectedItemId(item.id);
    setNotice(`${item.baseName} equipped.`);
  }

  function moveInventoryItem(itemId: string, targetId: ItemContainerId, x: number, y: number) {
    if (!profile) return;
    const targetKey = targetId === "backpack" ? "inventory" : "stash";
    const equippedItem = Object.values(profile.equipped).find((candidate) => candidate?.id === itemId);
    if (equippedItem) {
      const equippedSlot = findEquippedSlot(profile.equipped, equippedItem.id);
      if (!equippedSlot) return;
      const inserted = insertItem(profile[targetKey], equippedItem, { x, y });
      if (inserted.unplaced.length > 0) {
        setNotice(`${equippedItem.baseName} does not fit there.`);
        return;
      }
      setProfile({ ...profile, [targetKey]: inserted.container, equipped: { ...profile.equipped, [equippedSlot]: undefined } });
      setSelectedItemId(equippedItem.id);
      return;
    }

    const sourceKey = findContainerEntry(profile.inventory, itemId) ? "inventory" : findContainerEntry(profile.stash, itemId) ? "stash" : null;
    if (!sourceKey) return;
    if (sourceKey === targetKey) {
      const moved = moveItem(profile[sourceKey], itemId, x, y);
      if (!moved) {
        setNotice("That item does not fit there.");
        return;
      }
      setProfile({ ...profile, [sourceKey]: moved });
    } else {
      const moved = transferItem(profile[sourceKey], profile[targetKey], itemId, x, y);
      if (!moved) {
        setNotice("That space is occupied or too small.");
        return;
      }
      setProfile({ ...profile, [sourceKey]: moved.source, [targetKey]: moved.target });
    }
    setSelectedItemId(itemId);
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
              <InventoryPanel profile={profile} selectedItemId={selectedItemId} showStash={panel === "stash"} onSelect={setSelectedItemId} onEquipItem={equipItem} onMoveItem={moveInventoryItem} />
            )}
          </section>
        </div>
      )}
      {notice && <GameNotification key={notice} message={notice} />}
    </PhaserWorld>
  );
}
