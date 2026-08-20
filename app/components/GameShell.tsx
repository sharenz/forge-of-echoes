"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHARACTER_CLASSES } from "../game/config/classes";
import { XP_BY_LEVEL } from "../game/config/progression";
import { MERCHANTS, availableMerchantIds, isMerchantId, type MerchantId } from "../game/config/merchants";
import { buildArenaBalance } from "../game/combat";
import type { ActiveSkillId, AttributeKey, CharacterClassId, CharacterEquipmentSlot, ItemContainerId } from "../game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts } from "../game/equipment";
import { isEquipmentItem, isMapItem, profileCurrencyAmounts } from "../game/inventory";
import { containerItems, findContainerEntry, findFirstFit } from "../game/item-container";
import { activeStashTab, findStashEntry } from "../game/stash";
import { calculateCharacterStats } from "../game/stats";
import type { WorldStation } from "../game2d/types";
import { AttributesPanel } from "./AttributesPanel";
import { GameNotification } from "./GameNotification";
import { InventoryPanel } from "./InventoryPanel";
import { MapWorkshop } from "./MapWorkshop";
import { MerchantPanel } from "./MerchantPanel";
import { HideoutSoundtrack, MapSoundtrack, MenuSoundtrack } from "./MenuSoundtrack";
import { PhaserWorld } from "./PhaserWorld";
import { SkillTreePanel } from "./SkillTreePanel";
import { MultiplayerPanel } from "./MultiplayerPanel";
import { useMultiplayerHideout } from "../multiplayer/useMultiplayerHideout";
import { ENABLED_CHARACTER_CLASS_IDS } from "../../multiplayer/protocol";

type CharacterPanelView = "inventory" | "attributes" | "skills";
type HideoutPanel = CharacterPanelView | "stash" | "maps" | "merchant" | "multiplayer" | null;
type AccountView = "roster" | "create-character";

function isCharacterPanel(panel: HideoutPanel): panel is CharacterPanelView {
  return panel === "inventory" || panel === "attributes" || panel === "skills";
}

function characterPanelTitle(panel: CharacterPanelView): string {
  if (panel === "attributes") return "Attributes";
  if (panel === "skills") return "Skill Tree";
  return "Inventory";
}

const ENABLED_CHARACTER_CLASSES: ReadonlySet<CharacterClassId> = new Set(ENABLED_CHARACTER_CLASS_IDS);
const PLAYER_NAME_STORAGE_KEY = "crafty.playerName";

function loadRememberedPlayerName(): string {
  try {
    return window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberPlayerName(playerName: string): void {
  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
  } catch {
    // Private browsing or strict storage policies may deny persistence. Login
    // still works; only the convenience prefill is lost.
  }
}

export function GameShell() {
  const multiplayer = useMultiplayerHideout();
  const [characterName, setCharacterName] = useState("");
  const [accountView, setAccountView] = useState<AccountView>("roster");
  const playerNameInputRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<HideoutPanel>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapFinalRageActive, setMapFinalRageActive] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [activeMerchantId, setActiveMerchantId] = useState<MerchantId>("cartographer-rook");
  const merchantIds = useMemo(
    () => availableMerchantIds(multiplayer.account?.account.merchantEntitlements ?? []),
    [multiplayer.account?.account.merchantEntitlements],
  );
  const authoritative = multiplayer.authoritativeProfile;
  const profile = authoritative?.profile ?? null;
  const statCalculation = useMemo(() => profile ? calculateCharacterStats(profile) : null, [profile]);
  const stats = statCalculation?.stats ?? null;
  const currencies = useMemo(() => profile ? profileCurrencyAmounts(profile) : null, [profile]);
  const activeMap = multiplayer.activeMap?.map ?? null;
  const availablePortalIndexes = useMemo(
    () => multiplayer.activeMap?.portals.filter((portal) => !portal.used).map((portal) => portal.index) ?? [],
    [multiplayer.activeMap],
  );
  const arenaBalance = useMemo(
    () => profile && activeMap ? buildArenaBalance(profile, activeMap) : undefined,
    [activeMap, profile],
  );

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const input = playerNameInputRef.current;
    if (input && !input.value) input.value = loadRememberedPlayerName();
  }, [multiplayer.account]);

  useEffect(() => {
    const toggleInventory = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Escape") {
        setPanel(null);
        return;
      }
      if (event.code !== "KeyI" || event.repeat || !profile) return;
      setPanel((current) => current === "inventory" ? null : "inventory");
    };
    window.addEventListener("keydown", toggleInventory);
    return () => window.removeEventListener("keydown", toggleInventory);
  }, [profile]);

  if (!multiplayer.account) {
    return (
      <>
        <MenuSoundtrack enabled={musicEnabled} onEnabledChange={setMusicEnabled} />
        <PhaserWorld mode="login" classId="sorceress">
          <div className="creation-header"><span className="brand-rune">C</span><div><strong>CRAFTY</strong><small>Authoritative online realm</small></div></div>
          <section className="login-screen">
            <div className="login-card">
              <div className="login-card-rune" aria-hidden="true">◇</div>
              <div className="login-heading"><span>Realm account</span><h1>Enter the Crucible</h1><p>Your characters and progression live authoritatively in PostgreSQL. For now, your player name is all you need.</p></div>
              <form className="login-form" onSubmit={(event) => {
                event.preventDefault();
                const playerName = playerNameInputRef.current?.value.trim() ?? "";
                rememberPlayerName(playerName);
                void multiplayer.connectAccount(playerName);
              }}>
                <label><span>Player name</span><input ref={playerNameInputRef} required placeholder="player-one" minLength={2} maxLength={24} pattern="[A-Za-z0-9_-]+" autoComplete="username" /></label>
                <button type="submit" disabled={multiplayer.busy}><span>{multiplayer.busy ? "Entering…" : "Continue"}</span><small>Open character roster</small></button>
              </form>
              <footer><span>◆</span><p><strong>Remembered on this browser</strong><small>Only your player name is stored locally. Characters, items, and stats remain server-authoritative.</small></p></footer>
            </div>
            {multiplayer.error && <div className="multiplayer-error roster-error" role="alert">{multiplayer.error}</div>}
          </section>
        </PhaserWorld>
      </>
    );
  }

  if (!multiplayer.session) {
    if (accountView === "create-character") {
      const sorceress = CHARACTER_CLASSES.sorceress;
      return (
        <>
          <MenuSoundtrack enabled={musicEnabled} onEnabledChange={setMusicEnabled} />
          <PhaserWorld mode="character-create" classId="sorceress">
            <div className="creation-header"><span className="brand-rune">C</span><div><strong>CRAFTY</strong><small>Authoritative online realm</small></div></div>
            <section className="dedicated-character-create">
              <button type="button" className="back-to-roster" onClick={() => { multiplayer.clearError(); setCharacterName(""); setAccountView("roster"); }}>‹ Back to characters</button>
              <div className="character-create-card">
                <span className="create-kicker">Create character</span>
                <h1>Forge a Sorceress</h1>
                <p>{sorceress.fantasy} Your journey begins at level 1 with an {sorceress.weapon}.</p>
                <div className="create-class-seal"><i>S</i><span><strong>Sorceress</strong><small>{sorceress.title}</small></span><em>Enabled</em></div>
                <form onSubmit={(event) => {
                  event.preventDefault();
                  void multiplayer.createCharacter(characterName.trim(), "sorceress");
                }}>
                  <label><span>Unique character name</span><input required value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="Name your Sorceress" minLength={2} maxLength={24} pattern="[A-Za-z][A-Za-z0-9_-]*" autoComplete="off" /></label>
                  <button type="submit" disabled={multiplayer.busy || characterName.trim().length < 2}><span>{multiplayer.busy ? "Forging…" : "Create Sorceress"}</span><small>Enter the hideout</small></button>
                </form>
                <small className="name-rules">2–24 characters · begin with a letter · letters, numbers, hyphens, and underscores</small>
              </div>
              {multiplayer.error && <div className="multiplayer-error roster-error" role="alert">{multiplayer.error}</div>}
            </section>
          </PhaserWorld>
        </>
      );
    }

    return (
      <>
        <MenuSoundtrack enabled={musicEnabled} onEnabledChange={setMusicEnabled} />
        <PhaserWorld mode="login" classId="sorceress">
          <div className="creation-header"><span className="brand-rune">C</span><div><strong>CRAFTY</strong><small>Authoritative online realm</small></div></div>
          <section className="character-roster-screen">
            <header className="roster-heading"><div><span>{multiplayer.account.account.handle}</span><h1>Your Characters</h1><p>Select a character to enter the hideout.</p></div><div className="roster-heading-actions"><button type="button" className="create-character-action" onClick={() => { multiplayer.clearError(); setCharacterName(""); setAccountView("create-character"); }}>＋ Create Character</button><button type="button" onClick={() => { multiplayer.clearError(); setAccountView("roster"); void multiplayer.leaveAccount(); }}>Logout</button></div></header>
            <section className="character-roster-list roster-focus" aria-label="Your characters">
              <div className="roster-section-title"><span>Character roster</span><strong>{multiplayer.characters.length}</strong></div>
              <div className="roster-cards">
                {multiplayer.characters.map((character) => {
                  const definition = CHARACTER_CLASSES[character.classId];
                  const enabled = ENABLED_CHARACTER_CLASSES.has(character.classId);
                  return <button type="button" key={character.characterId} disabled={multiplayer.busy || !enabled} onClick={() => { setCharacterName(""); void multiplayer.selectCharacter(character.characterId); }}><i className={`class-crest ${character.classId}`}>{definition.name.charAt(0)}</i><span><strong>{character.characterName}</strong><small>{definition.name} · Level {character.level}{enabled ? "" : " · Coming later"}</small></span><em>{enabled ? "Enter ›" : "Unavailable"}</em></button>;
                })}
                {multiplayer.characters.length === 0 && <div className="empty-roster"><span>◇</span><strong>No characters yet</strong><small>Create your first Sorceress to enter the Crucible.</small><button type="button" onClick={() => setAccountView("create-character")}>Create Character</button></div>}
              </div>
            </section>
            {multiplayer.error && <div className="multiplayer-error roster-error" role="alert">{multiplayer.error}</div>}
          </section>
        </PhaserWorld>
      </>
    );
  }

  if (!profile || !stats || !statCalculation || !currencies) {
    return <PhaserWorld mode="loading" classId={multiplayer.session.player.classId}><div className="world-loader"><span /><strong>Loading {multiplayer.session.player.characterName}</strong><small>Fetching authoritative profile</small></div></PhaserWorld>;
  }

  const backpackItems = containerItems(profile.inventory);
  const effectiveSelectedItemId = selectedItemId
    ?? profile.inventory.entries[0]?.item.id
    ?? activeStashTab(profile.stash).container.entries[0]?.item.id
    ?? Object.values(profile.equipped)[0]?.id
    ?? null;
  const inventoryMaps = backpackItems.filter(isMapItem);
  if (multiplayer.mapAdapter && arenaBalance && activeMap) {
    const characterPanelOpen = isCharacterPanel(panel);
    return (
      <>
        <MapSoundtrack finalRageActive={mapFinalRageActive} enabled={musicEnabled} onEnabledChange={setMusicEnabled} />
        <PhaserWorld
          mode="arena"
          classId={profile.character.classId!}
          controlsBlocked={characterPanelOpen}
          arenaBalance={arenaBalance}
          activeMap={activeMap}
          characterStats={stats}
          characterProgress={profile.character}
          characterStatBreakdown={statCalculation.breakdown}
          flaskBelt={profile.flaskBelt}
          onFlaskLoad={onlineLoadFlask}
          onReturnToHideout={() => { void multiplayer.leaveMap(); }}
          multiplayer={multiplayer.mapAdapter}
          onItemDropToGround={characterPanelOpen ? onlineDropItemToGround : undefined}
          onFinalRageChange={setMapFinalRageActive}
        >
          <button type="button" className="arena-inventory-toggle" onClick={() => setPanel(characterPanelOpen ? null : "inventory")}>Character <kbd>I</kbd></button>
          <button type="button" className="return-hideout" onClick={() => void multiplayer.leaveMap()}>Return to hideout</button>
          {characterPanelOpen && (
            <div className="world-panel-backdrop arena-panel-backdrop character-interface-backdrop">
              <section className={`world-panel character-panel panel-${panel}`} aria-label={`Character ${panel}`}>
                <header><div><span>Combat continues online · controls blocked · changes apply immediately</span><h2>{characterPanelTitle(panel)}</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close character interface">×</button></header>
                {panel === "inventory" && <InventoryPanel profile={profile} selectedItemId={effectiveSelectedItemId} onSelect={setSelectedItemId} onEquipItem={onlineEquipItem} onMoveItem={onlineMoveItem} onQuickStash={onlineQuickStash} onQuickUnstash={onlineQuickUnstash} onApplyCurrency={onlineApplyCurrency} onSelectStashTab={onlineSelectStash} onRenameStashTab={onlineRenameStash} onCreateStashTab={onlineCreateStash} onLoadFlask={onlineLoadFlask} />}
                {panel === "attributes" && <AttributesPanel progress={profile.character} stats={stats} breakdown={statCalculation.breakdown} onAllocate={onlineAllocateAttribute} />}
                {panel === "skills" && <SkillTreePanel progress={profile.character} onAllocate={onlineAllocateSkill} />}
              </section>
            </div>
          )}
          {notice && <GameNotification key={notice} message={notice} />}
        </PhaserWorld>
      </>
    );
  }

  const xpRequired = XP_BY_LEVEL(profile.character.level);
  const xpPercent = profile.character.level === 99 ? 100 : (profile.character.xp / xpRequired) * 100;

  function handleStation(station: WorldStation, portalIndex?: number) {
    if (station === "stash") setPanel("stash");
    if (station === "bench") setPanel("inventory");
    if (station === "map-device") setPanel("maps");
    if (station.startsWith("merchant:")) {
      const merchantId = station.slice("merchant:".length);
      if (isMerchantId(merchantId) && merchantIds.includes(merchantId)) {
        setActiveMerchantId(merchantId);
        setPanel("merchant");
      }
    }
    if (station === "portal") {
      setPanel(null);
      if (portalIndex !== undefined) void multiplayer.enterMap(portalIndex);
    }
  }

  function onlineEquipItem(itemId: string, requestedSlot?: CharacterEquipmentSlot) {
    const item = findContainerEntry(profile!.inventory, itemId)?.item ?? findStashEntry(profile!.stash, itemId)?.entry.item;
    if (!item || !isEquipmentItem(item)) return;
    const slot = requestedSlot && equipmentSlotAccepts(requestedSlot, item)
      ? requestedSlot
      : chooseEquipmentSlot(item, profile!.equipped);
    setSelectedItemId(itemId);
    void multiplayer.executeProfileCommand({ type: "equip_item", itemId, slot });
  }

  function onlineMoveItem(itemId: string, targetId: ItemContainerId, x: number, y: number) {
    setSelectedItemId(itemId);
    void multiplayer.executeProfileCommand({
      type: "move_item",
      itemId,
      destination: targetId,
      stashTabId: targetId === "stash" ? activeStashTab(profile!.stash).id : undefined,
      x,
      y,
    });
  }

  function onlineQuickStash(itemId: string) {
    const item = findContainerEntry(profile!.inventory, itemId)?.item;
    const tab = activeStashTab(profile!.stash);
    const position = item ? findFirstFit(tab.container, item) : null;
    if (!item || !position) {
      setNotice(`${tab.name} has no fitting space.`);
      return;
    }
    void multiplayer.executeProfileCommand({ type: "move_item", itemId, destination: "stash", stashTabId: tab.id, ...position });
  }

  function onlineQuickUnstash(itemId: string) {
    const item = findStashEntry(profile!.stash, itemId)?.entry.item;
    const position = item ? findFirstFit(profile!.inventory, item) : null;
    if (!item || !position) {
      setNotice("Your backpack has no fitting space.");
      return;
    }
    setSelectedItemId(itemId);
    void multiplayer.executeProfileCommand({ type: "move_item", itemId, destination: "backpack", ...position });
  }

  function onlineApplyCurrency(currencyItemId: string, targetItemId: string) {
    setSelectedItemId(targetItemId);
    void multiplayer.executeProfileCommand({ type: "apply_currency", currencyItemId, targetItemId });
  }

  function onlineSelectStash(tabId: string) {
    void multiplayer.executeProfileCommand({ type: "select_stash_tab", tabId });
  }

  function onlineRenameStash(tabId: string, name: string) {
    void multiplayer.executeProfileCommand({ type: "rename_stash_tab", tabId, name });
  }

  function onlineCreateStash() {
    void multiplayer.executeProfileCommand({ type: "create_stash_tab" });
  }

  function onlineLoadFlask(itemId: string, slotIndex: number) {
    void multiplayer.executeProfileCommand({ type: "load_flask", itemId, slot: slotIndex });
  }

  function onlineAllocateAttribute(attribute: AttributeKey) {
    void multiplayer.executeProfileCommand({ type: "allocate_attribute", attribute });
  }

  function onlineAllocateSkill(skill: ActiveSkillId) {
    void multiplayer.executeProfileCommand({ type: "allocate_skill", skill });
  }

  function onlineDropItemToGround(itemId: string) {
    multiplayer.dropItem(itemId);
    setSelectedItemId(null);
    setNotice("Item dropped beside you on the authoritative map.");
  }

  function onlineOpenMap() {
    setPanel(null);
    void multiplayer.openMap();
  }

  return (
    <>
      <HideoutSoundtrack enabled={musicEnabled} onEnabledChange={setMusicEnabled} />
      <PhaserWorld mode="hideout" classId={profile.character.classId!} portalIndexes={availablePortalIndexes} merchantIds={merchantIds} paused={Boolean(panel)} characterStats={stats} characterProgress={profile.character} characterStatBreakdown={statCalculation.breakdown} flaskBelt={profile.flaskBelt} onFlaskLoad={onlineLoadFlask} onStation={handleStation} multiplayer={multiplayer.adapter}>
      <header className="hideout-hud">
        <div className="brand-lockup"><span className="brand-mark">C</span><div><strong>CRAFTY</strong><small>THE FORGE HIDEOUT</small></div></div>
        <div className="hideout-character"><span className={`class-crest ${profile.character.classId}`}>{profile.character.classId!.charAt(0).toUpperCase()}</span><div><strong>{profile.character.name}</strong><small>Server · Level {profile.character.level} {CHARACTER_CLASSES[profile.character.classId!].name}</small></div></div>
        <nav>
          <button type="button" onClick={() => setPanel("inventory")}>Inventory <kbd>I</kbd></button>
          <button type="button" onClick={() => setPanel("attributes")}>Attributes <strong>{profile.character.unspentAttributePoints}</strong></button>
          <button type="button" onClick={() => setPanel("skills")}>Skills <strong>{profile.character.unspentSkillPoints}</strong></button>
          <button type="button" onClick={() => setPanel("maps")}>Maps <strong>{inventoryMaps.length + (profile.mapDevice ? 1 : 0)}</strong></button>
          <button type="button" className={multiplayer.adapter ? "online" : ""} onClick={() => setPanel("multiplayer")}>Party <strong>{multiplayer.party?.visibility === "public" ? multiplayer.party.memberCharacterIds.length : 0}/4</strong></button>
          <button type="button" onClick={() => { setCharacterName(""); setAccountView("roster"); void multiplayer.leaveCharacter(); }}>Characters</button>
        </nav>
        <div className="hideout-xp"><span style={{ width: `${xpPercent}%` }} /><small>{profile.character.xp}/{xpRequired} XP</small></div>
      </header>

      {activeMap && <div className="portal-notice"><span>{multiplayer.party?.visibility === "solo" ? "Solo map" : "Party map"}</span><strong>{activeMap.baseName}</strong><small>{availablePortalIndexes.length}/6 portals remain · each is one-use</small></div>}

      {panel && (
        <div className={`world-panel-backdrop ${isCharacterPanel(panel) ? "character-interface-backdrop" : ""}`}>
          <section className={`world-panel panel-${panel} ${isCharacterPanel(panel) ? "character-panel" : ""}`}>
            <header><div><span>{panel === "stash" ? "Hideout storage" : panel === "maps" ? "Map device" : panel === "merchant" ? MERCHANTS[activeMerchantId].title : panel === "multiplayer" ? "Authoritative online realm" : "Character interface"}</span><h2>{panel === "stash" ? "Stash Chest" : panel === "maps" ? "Open a Portal" : panel === "merchant" ? `${MERCHANTS[activeMerchantId].name}'s Shop` : panel === "multiplayer" ? "Multiplayer" : characterPanelTitle(panel)}</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close panel">×</button></header>
            {panel === "maps" && <MapWorkshop profile={profile} slottedMap={profile.mapDevice} activeMap={activeMap} portalsRemaining={availablePortalIndexes.length} selectedItemId={effectiveSelectedItemId} onSelect={setSelectedItemId} onMoveItem={onlineMoveItem} onSlot={(itemId) => void multiplayer.executeProfileCommand({ type: "slot_map", itemId })} onRemove={() => void multiplayer.executeProfileCommand({ type: "remove_map" })} onOpen={onlineOpenMap} />}
            {panel === "merchant" && <MerchantPanel merchantId={activeMerchantId} profile={profile} currencies={currencies} selectedItemId={effectiveSelectedItemId} onSelectItem={setSelectedItemId} onMoveItem={onlineMoveItem} onBuy={(merchantId, offerId, position) => void multiplayer.executeProfileCommand({ type: "buy_merchant_offer", merchantId, offerId, position })} />}
            {panel === "multiplayer" && <MultiplayerPanel controller={multiplayer} onOpenMapDevice={() => setPanel("maps")} onPartyEntered={() => setPanel(null)} />}
            {(panel === "inventory" || panel === "stash") && <InventoryPanel profile={profile} selectedItemId={effectiveSelectedItemId} showStash={panel === "stash"} onSelect={setSelectedItemId} onEquipItem={onlineEquipItem} onMoveItem={onlineMoveItem} onQuickStash={onlineQuickStash} onQuickUnstash={onlineQuickUnstash} onApplyCurrency={onlineApplyCurrency} onSelectStashTab={onlineSelectStash} onRenameStashTab={onlineRenameStash} onCreateStashTab={onlineCreateStash} onLoadFlask={onlineLoadFlask} />}
            {panel === "attributes" && <AttributesPanel progress={profile.character} stats={stats} breakdown={statCalculation.breakdown} onAllocate={onlineAllocateAttribute} />}
            {panel === "skills" && <SkillTreePanel progress={profile.character} onAllocate={onlineAllocateSkill} />}
          </section>
        </div>
      )}
      {notice && <GameNotification key={notice} message={notice} />}
      </PhaserWorld>
    </>
  );
}
