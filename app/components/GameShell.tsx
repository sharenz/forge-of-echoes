"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHARACTER_CLASSES, XP_BY_LEVEL } from "../game/content";
import type { FlaskDefinition } from "../game/config/flasks";
import { buildArenaBalance, type ArenaSummary, type MapDrop } from "../game/combat";
import type { ActiveSkillId, AttributeKey, CharacterClassId, CharacterEquipmentSlot, CurrencyId, EquipmentItem, ItemContainerId, PlayerProfile, RunResult } from "../game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts, findEquippedSlot } from "../game/equipment";
import { isCurrencyItem, isEquipmentItem, isMapItem, profileCurrencyAmounts, consumeProfileCurrency, createCurrencyStack } from "../game/inventory";
import { consumeFlaskFromBelt, createFlaskStack, loadFlaskIntoBelt, unloadFlaskFromBelt } from "../game/flasks";
import { containerItems, findContainerEntry, insertItem, mapContainerItems, moveItem, removeItem, transferItem } from "../game/item-container";
import { addFireAffix, generateEquipment, rerollAffixValues } from "../game/items";
import { addMapModifier, rerollMap } from "../game/maps";
import { purchaseFlask, purchaseMap } from "../game/merchant";
import { applyRunResult, createCharacter, loadProfile, saveProfile } from "../game/profile";
import { allocateAttributePoint, allocateSkillPoint, grantCharacterExperience } from "../game/progression";
import { activeStashTab, addStashTab, findStashEntry, mapStashItems, removeStashItem, renameStashTab, selectStashTab, stashItems as allStashItems, updateStashContainer } from "../game/stash";
import { calculateCharacterStats } from "../game/stats";
import type { WorldStation } from "../game2d/types";
import { AttributesPanel } from "./AttributesPanel";
import { CharacterPanelTabs, type CharacterPanelView } from "./CharacterPanelTabs";
import { GameNotification } from "./GameNotification";
import { InventoryPanel } from "./InventoryPanel";
import { ItemWorkbench } from "./ItemWorkbench";
import { MapWorkshop } from "./MapWorkshop";
import { MapMerchant } from "./MapMerchant";
import { PhaserWorld } from "./PhaserWorld";
import { SkillTreePanel } from "./SkillTreePanel";

type HideoutPanel = CharacterPanelView | "stash" | "bench" | "maps" | "merchant" | null;
type GameScreen = "hideout" | "arena";
interface RunLootLedger { collected: number; freshItemIds: string[] }
const emptyRunLoot = (): RunLootLedger => ({ collected: 0, freshItemIds: [] });

function isCharacterPanel(panel: HideoutPanel): panel is CharacterPanelView {
  return panel === "inventory" || panel === "attributes" || panel === "skills";
}

function characterPanelTitle(panel: CharacterPanelView): string {
  if (panel === "attributes") return "Attributes";
  if (panel === "skills") return "Skill Tree";
  return "Inventory";
}

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
      const firstItem = loaded.inventory.entries[0]?.item ?? activeStashTab(loaded.stash).container.entries[0]?.item ?? Object.values(loaded.equipped)[0];
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

  const statCalculation = useMemo(() => profile ? calculateCharacterStats(profile) : null, [profile]);
  const stats = statCalculation?.stats ?? null;
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
  const stashItems = allStashItems(profile.stash);
  const allItems = [...Object.values(profile.equipped).filter(Boolean), ...backpackItems.filter(isEquipmentItem), ...stashItems.filter(isEquipmentItem)] as EquipmentItem[];
  const inventoryMaps = backpackItems.filter(isMapItem);
  const equippedIds = new Set(Object.values(profile.equipped).filter(Boolean).map((item) => item?.id)) as Set<string>;

  if (screen === "arena" && profile.openedMap && arenaBalance) {
    const characterPanelOpen = isCharacterPanel(panel);
    return (
      <PhaserWorld mode="arena" classId={profile.character.classId} portalActive paused={characterPanelOpen} arenaBalance={arenaBalance} characterStats={stats} characterProgress={profile.character} characterStatBreakdown={statCalculation?.breakdown} flaskBelt={profile.flaskBelt} onFlaskUse={useBeltFlask} onLootPickup={collectMapDrop} onExperienceGain={gainExperience} onArenaComplete={completeArena} onPlayerDeath={failArena}>
        <button type="button" className="arena-inventory-toggle" onClick={() => setPanel(characterPanelOpen ? null : "inventory")}>Character <kbd>I</kbd></button>
        <button type="button" className="return-hideout" onClick={leaveArena}>Return to hideout</button>
        {characterPanelOpen && (
          <div className="world-panel-backdrop arena-panel-backdrop">
            <section className={`world-panel character-panel panel-${panel}`} aria-label={`Character ${panel}`}>
              <header><div><span>Combat paused · character changes apply immediately</span><h2>{characterPanelTitle(panel)}</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close character interface">×</button></header>
              <CharacterPanelTabs active={panel} onChange={setPanel} />
              {panel === "inventory" && <InventoryPanel profile={profile} selectedItemId={selectedItemId} freshItemIds={runFreshItemIds} onSelect={setSelectedItemId} onEquipItem={equipItem} onMoveItem={moveInventoryItem} onQuickStash={quickStashItem} onSelectStashTab={selectStash} onRenameStashTab={renameStash} onCreateStashTab={createStashTab} onLoadFlask={loadFlask} onUnloadFlask={unloadFlask} />}
              {panel === "attributes" && <AttributesPanel progress={profile.character} stats={stats} breakdown={statCalculation!.breakdown} onAllocate={allocateAttribute} />}
              {panel === "skills" && <SkillTreePanel progress={profile.character} onAllocate={allocateSkill} />}
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

  function buyFlask(offerId: string) {
    if (!profile) return;
    const purchase = purchaseFlask(profile, offerId);
    if (!purchase) {
      setNotice("Not enough Scrap, or no free backpack cell for that flask.");
      return;
    }
    profileRef.current = purchase.profile;
    setProfile(purchase.profile);
    setNotice(`${purchase.flask.baseId === "weak-health-flask" ? "Weak Health Flask" : "Weak Mana Flask"} purchased for ${purchase.paid} Scrap.`);
  }

  function useBeltFlask(slotIndex: number): FlaskDefinition | null {
    const current = profileRef.current;
    if (!current) return null;
    const consumed = consumeFlaskFromBelt(current, slotIndex);
    if (!consumed) return null;
    profileRef.current = consumed.profile;
    setProfile(consumed.profile);
    return consumed.definition;
  }

  function loadFlask(itemId: string, slotIndex: number) {
    const current = profileRef.current;
    if (!current) return;
    const next = loadFlaskIntoBelt(current, itemId, slotIndex);
    if (!next) {
      setNotice("That flask slot is full or contains another flask type.");
      return;
    }
    profileRef.current = next;
    setProfile(next);
  }

  function unloadFlask(slotIndex: number) {
    const current = profileRef.current;
    if (!current) return;
    const next = unloadFlaskFromBelt(current, slotIndex);
    if (!next) {
      setNotice("Your backpack has no free space for that flask stack.");
      return;
    }
    profileRef.current = next;
    setProfile(next);
  }

  function completeArena(summary: ArenaSummary) {
    if (!profile) return;
    const current = profileRef.current ?? profile;
    const recovered = runLootRef.current;
    const result: RunResult = {
      completed: true,
      ...summary,
      loot: {
        xp: 0,
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

  function gainExperience(amount: number) {
    const current = profileRef.current;
    if (!current || amount <= 0) return;
    const result = grantCharacterExperience(current, amount);
    profileRef.current = result.profile;
    setProfile(result.profile);
    if (result.levelsGained > 0) {
      setNotice(`Level ${result.profile.character.level}! +${result.levelsGained * 5} attribute points · +${result.levelsGained} skill point${result.levelsGained === 1 ? "" : "s"}.`);
    }
  }

  function allocateAttribute(attribute: AttributeKey) {
    const current = profileRef.current ?? profile;
    if (!current) return;
    const next = allocateAttributePoint(current, attribute);
    if (next === current) return;
    profileRef.current = next;
    setProfile(next);
  }

  function allocateSkill(skill: ActiveSkillId) {
    const current = profileRef.current ?? profile;
    if (!current) return;
    const next = allocateSkillPoint(current, skill);
    if (next === current) return;
    profileRef.current = next;
    setProfile(next);
  }

  function collectMapDrop(drop: MapDrop): boolean {
    const current = profileRef.current;
    if (!current?.openedMap) return false;
    const item = drop.kind === "equipment"
      ? generateEquipment(Math.max(2, current.openedMap.tier) * 5, drop.rarity)
      : drop.kind === "currency"
        ? createCurrencyStack(drop.currency, drop.amount)
        : createFlaskStack(drop.flask, drop.amount);
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

  function failArena() {
    const current = profileRef.current ?? profile;
    if (!current) return;
    const recovered = runLootRef.current;
    const next = { ...current, openedMap: null };
    profileRef.current = next;
    setProfile(next);
    setSelectedItemId(recovered.freshItemIds[0] ?? current.inventory.entries[0]?.item.id ?? null);
    resetRunLoot();
    setPanel(null);
    setScreen("hideout");
    setNotice(`You died. The map was lost; ${recovered.collected} collected drops were kept.`);
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
    const stash = mapStashItems(profile.stash, (item) => isEquipmentItem(item) ? update(item) : item);
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
    const stashEntry = findStashEntry(profile.stash, item.id);
    if (!inventoryEntry && !stashEntry) return;
    if (inventoryEntry) {
      const removed = removeItem(profile.inventory, item.id);
      if (!removed) return;
      let inventory = removed.container;
      if (previouslyEquipped) {
        const swapped = insertItem(inventory, previouslyEquipped, { x: inventoryEntry.x, y: inventoryEntry.y });
        if (swapped.unplaced.length > 0) {
          setNotice(`No fitting backpack space for ${previouslyEquipped.baseName}.`);
          return;
        }
        inventory = swapped.container;
      }
      setProfile({ ...profile, inventory, equipped: { ...profile.equipped, [targetSlot]: item } });
    } else if (stashEntry) {
      const removed = removeStashItem(profile.stash, item.id);
      if (!removed) return;
      let container = removed.stash.tabs.find((tab) => tab.id === removed.tabId)?.container;
      if (!container) return;
      if (previouslyEquipped) {
        const swapped = insertItem(container, previouslyEquipped, { x: stashEntry.entry.x, y: stashEntry.entry.y });
        if (swapped.unplaced.length > 0) {
          setNotice(`No fitting stash space for ${previouslyEquipped.baseName}.`);
          return;
        }
        container = swapped.container;
      }
      setProfile({ ...profile, stash: updateStashContainer(removed.stash, removed.tabId, container), equipped: { ...profile.equipped, [targetSlot]: item } });
    }
    setSelectedItemId(item.id);
    setNotice(`${item.baseName} equipped.`);
  }

  function moveInventoryItem(itemId: string, targetId: ItemContainerId, x: number, y: number) {
    if (!profile) return;
    const activeTab = activeStashTab(profile.stash);
    const equippedItem = Object.values(profile.equipped).find((candidate) => candidate?.id === itemId);
    if (equippedItem) {
      const equippedSlot = findEquippedSlot(profile.equipped, equippedItem.id);
      if (!equippedSlot) return;
      const target = targetId === "backpack" ? profile.inventory : activeTab.container;
      const inserted = insertItem(target, equippedItem, { x, y });
      if (inserted.unplaced.length > 0) {
        setNotice(`${equippedItem.baseName} does not fit there.`);
        return;
      }
      setProfile(targetId === "backpack"
        ? { ...profile, inventory: inserted.container, equipped: { ...profile.equipped, [equippedSlot]: undefined } }
        : { ...profile, stash: updateStashContainer(profile.stash, activeTab.id, inserted.container), equipped: { ...profile.equipped, [equippedSlot]: undefined } });
      setSelectedItemId(equippedItem.id);
      return;
    }

    const inventoryEntry = findContainerEntry(profile.inventory, itemId);
    const stashEntry = findStashEntry(profile.stash, itemId);
    if (!inventoryEntry && !stashEntry) return;
    if (inventoryEntry && targetId === "backpack") {
      const moved = moveItem(profile.inventory, itemId, x, y);
      if (!moved) {
        setNotice("That item does not fit there.");
        return;
      }
      setProfile({ ...profile, inventory: moved });
    } else if (stashEntry && targetId === "stash" && stashEntry.tab.id === activeTab.id) {
      const moved = moveItem(activeTab.container, itemId, x, y);
      if (!moved) {
        setNotice("That item does not fit there.");
        return;
      }
      setProfile({ ...profile, stash: updateStashContainer(profile.stash, activeTab.id, moved) });
    } else if (inventoryEntry && targetId === "stash") {
      const moved = transferItem(profile.inventory, activeTab.container, itemId, x, y);
      if (!moved) {
        setNotice("That space is occupied or too small.");
        return;
      }
      setProfile({ ...profile, inventory: moved.source, stash: updateStashContainer(profile.stash, activeTab.id, moved.target) });
    } else if (stashEntry && targetId === "backpack") {
      const moved = transferItem(stashEntry.tab.container, profile.inventory, itemId, x, y);
      if (!moved) {
        setNotice("That space is occupied or too small.");
        return;
      }
      setProfile({ ...profile, inventory: moved.target, stash: updateStashContainer(profile.stash, stashEntry.tab.id, moved.source) });
    }
    setSelectedItemId(itemId);
  }

  function quickStashItem(itemId: string) {
    if (!profile) return;
    const removed = removeItem(profile.inventory, itemId);
    if (!removed) return;
    const tab = activeStashTab(profile.stash);
    const inserted = insertItem(tab.container, removed.entry.item);
    if (inserted.unplaced.length > 0) {
      setNotice(`${tab.name} has no fitting space.`);
      return;
    }
    setProfile({ ...profile, inventory: removed.container, stash: updateStashContainer(profile.stash, tab.id, inserted.container) });
    const selectedId = inserted.container.entries.find((entry) => entry.item.id === itemId)?.item.id
      ?? (isCurrencyItem(removed.entry.item)
        ? inserted.container.entries.find((entry) => isCurrencyItem(entry.item) && entry.item.baseId === removed.entry.item.baseId)?.item.id
        : null)
      ?? null;
    setSelectedItemId(selectedId);
    setNotice(`${removed.entry.item.kind === "equipment" ? removed.entry.item.baseName : "Item"} moved to ${tab.name}.`);
  }

  function selectStash(tabId: string) {
    setProfile((current) => current ? { ...current, stash: selectStashTab(current.stash, tabId) } : current);
  }

  function renameStash(tabId: string, name: string) {
    setProfile((current) => current ? { ...current, stash: renameStashTab(current.stash, tabId, name) } : current);
  }

  function createStashTab() {
    setProfile((current) => current ? { ...current, stash: addStashTab(current.stash) } : current);
  }

  return (
    <PhaserWorld mode="hideout" classId={profile.character.classId} portalActive={Boolean(profile.openedMap)} paused={Boolean(panel)} characterStats={stats} characterProgress={profile.character} characterStatBreakdown={statCalculation?.breakdown} flaskBelt={profile.flaskBelt} onFlaskUse={useBeltFlask} onStation={handleStation}>
      <header className="hideout-hud">
        <div className="brand-lockup"><span className="brand-mark">C</span><div><strong>CRAFTY</strong><small>THE FORGE HIDEOUT</small></div></div>
        <div className="hideout-character"><span className={`class-crest ${profile.character.classId}`}>{profile.character.classId.charAt(0).toUpperCase()}</span><div><strong>{profile.character.name}</strong><small>Level {profile.character.level} {CHARACTER_CLASSES[profile.character.classId].name}</small></div></div>
        <nav>
          <button type="button" onClick={() => setPanel("inventory")}>Inventory <kbd>I</kbd></button>
          <button type="button" onClick={() => setPanel("attributes")}>Attributes <strong>{profile.character.unspentAttributePoints}</strong></button>
          <button type="button" onClick={() => setPanel("skills")}>Skills <strong>{profile.character.unspentSkillPoints}</strong></button>
          <button type="button" onClick={() => setPanel("maps")}>Maps <strong>{inventoryMaps.length + (profile.mapDevice ? 1 : 0)}</strong></button>
        </nav>
        <div className="hideout-xp"><span style={{ width: `${xpPercent}%` }} /><small>{profile.character.xp}/{xpRequired} XP</small></div>
      </header>

      {profile.openedMap && <div className="portal-notice"><span>Portal open</span><strong>{profile.openedMap.baseName}</strong><small>Click the portal to enter</small></div>}

      {panel && (
        <div className="world-panel-backdrop">
          <section className={`world-panel panel-${panel} ${isCharacterPanel(panel) ? "character-panel" : ""}`}>
            <header><div><span>{panel === "stash" ? "Hideout storage" : panel === "bench" ? "Crafting station" : panel === "maps" ? "Map device" : panel === "merchant" ? "Maps and supplies" : "Character interface"}</span><h2>{panel === "stash" ? "Stash Chest" : panel === "bench" ? "The Workbench" : panel === "maps" ? "Open a Portal" : panel === "merchant" ? "Rook's Shop" : characterPanelTitle(panel)}</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close panel">×</button></header>
            {isCharacterPanel(panel) && <CharacterPanelTabs active={panel} onChange={setPanel} />}
            {panel === "maps" && <MapWorkshop maps={inventoryMaps} slottedMap={profile.mapDevice} currencies={currencies} portalActive={Boolean(profile.openedMap)} onSlot={slotMap} onRemove={removeMapFromDevice} onCraft={craftMap} onOpen={openPortal} />}
            {panel === "merchant" && <MapMerchant scrap={currencies.scrap} onBuy={buyMap} onBuyFlask={buyFlask} />}
            {panel === "bench" && <ItemWorkbench items={allItems} equippedIds={equippedIds} currencies={currencies} selectedId={selectedItemId} onSelect={setSelectedItemId} onCraft={craftItem} onEquip={equipSelected} />}
            {(panel === "inventory" || panel === "stash") && (
              <InventoryPanel profile={profile} selectedItemId={selectedItemId} showStash={panel === "stash"} onSelect={setSelectedItemId} onEquipItem={equipItem} onMoveItem={moveInventoryItem} onQuickStash={quickStashItem} onSelectStashTab={selectStash} onRenameStashTab={renameStash} onCreateStashTab={createStashTab} onLoadFlask={loadFlask} onUnloadFlask={unloadFlask} />
            )}
            {panel === "attributes" && <AttributesPanel progress={profile.character} stats={stats} breakdown={statCalculation!.breakdown} onAllocate={allocateAttribute} />}
            {panel === "skills" && <SkillTreePanel progress={profile.character} onAllocate={allocateSkill} />}
          </section>
        </div>
      )}
      {notice && <GameNotification key={notice} message={notice} />}
    </PhaserWorld>
  );
}
