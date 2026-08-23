"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHARACTER_CLASSES } from "../game/config/classes";
import { MERCHANTS, availableMerchantIds, isMerchantId, type MerchantId } from "../game/config/merchants";
import { buildArenaBalance } from "../game/combat";
import type { ActiveSkillId, AttributeKey, CharacterClassId, CharacterEquipmentSlot, ItemContainerId, SkillBarSkillId } from "../game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts } from "../game/equipment";
import { isEquipmentItem, isMapItem, profileCurrencyAmounts } from "../game/inventory";
import { containerItems, findContainerEntry, findFirstFit } from "../game/item-container";
import { activeStashTab, findStashEntry } from "../game/stash";
import { calculateCharacterStats } from "../game/stats";
import { effectiveMusicVolume, effectiveWorldVolume, type AudioSettingsChannel } from "../game/audio-settings";
import type { WorldStation } from "../game2d/types";
import { AttributesPanel } from "./AttributesPanel";
import { AudioSettingsMenu } from "./AudioSettingsMenu";
import { GameNotification } from "./GameNotification";
import { GameMenuDock } from "./GameMenuDock";
import { InventoryPanel } from "./InventoryPanel";
import { MapWorkshop } from "./MapWorkshop";
import { MerchantPanel } from "./MerchantPanel";
import { HideoutSoundtrack, MapSoundtrack, MenuSoundtrack } from "./MenuSoundtrack";
import { PhaserWorld } from "./PhaserWorld";
import { SkillTreePanel } from "./SkillTreePanel";
import { MultiplayerPanel } from "./MultiplayerPanel";
import { useMultiplayerHideout } from "../multiplayer/useMultiplayerHideout";
import { useAudioSettings } from "./useAudioSettings";
import { ENABLED_CHARACTER_CLASS_IDS } from "../../multiplayer/protocol";

type CharacterPanelView = "inventory" | "attributes" | "skills";
type HideoutPanel = CharacterPanelView | "stash" | "maps" | "merchant" | "multiplayer" | "settings" | null;
type AccountView = "roster" | "create-character";

function isCharacterPanel(panel: HideoutPanel): panel is CharacterPanelView {
  return panel === "inventory" || panel === "attributes" || panel === "skills";
}

function characterPanelTitle(panel: CharacterPanelView): string {
  if (panel === "attributes") return "Character";
  if (panel === "skills") return "Skills";
  return "Inventory";
}

function characterPanelKicker(panel: CharacterPanelView): string {
  if (panel === "attributes") return "Attributes & combat values";
  if (panel === "skills") return "Spellbook & bindings";
  return "Equipment & backpack";
}

const ENABLED_CHARACTER_CLASSES: ReadonlySet<CharacterClassId> = new Set(ENABLED_CHARACTER_CLASS_IDS);
const PLAYER_NAME_STORAGE_KEY = "forgeOfEchoes.playerName";

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
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [panel, setPanel] = useState<HideoutPanel>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapFinalRageActive, setMapFinalRageActive] = useState(false);
  const [mapExitPending, setMapExitPending] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [audioSettings, setAudioSettings] = useAudioSettings();
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
  const musicVolume = effectiveMusicVolume(audioSettings);
  const worldVolume = effectiveWorldVolume(audioSettings);
  const effectiveMusicEnabled = musicEnabled && audioSettings.music > 0;

  const updateAudioSetting = (channel: AudioSettingsChannel, value: number) => {
    setAudioSettings((current) => ({ ...current, [channel]: value }));
    if (channel === "music") setMusicEnabled(value > 0);
  };

  const updateMusicEnabled = (enabled: boolean) => {
    if (enabled && audioSettings.music <= 0) {
      setAudioSettings((current) => ({ ...current, music: 1 }));
    }
    setMusicEnabled(enabled);
  };

  const requestMapExit = () => {
    if (mapExitPending) return;
    setMapExitPending(true);
    void multiplayer.leaveMap().finally(() => setMapExitPending(false));
  };

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
    const toggleInterface = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.code === "Escape") {
        event.preventDefault();
        setPanel((current) => current === null ? "settings" : null);
        return;
      }
      if (target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (!profile || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const requested: HideoutPanel = event.code === "KeyI" ? "inventory"
        : event.code === "KeyC" ? "attributes"
          : event.code === "KeyK" ? "skills"
            : !multiplayer.mapAdapter && event.code === "KeyM" ? "maps"
              : !multiplayer.mapAdapter && event.code === "KeyP" ? "multiplayer"
                : null;
      if (!requested) return;
      event.preventDefault();
      setPanel((current) => current === requested ? null : requested);
    };
    window.addEventListener("keydown", toggleInterface);
    return () => window.removeEventListener("keydown", toggleInterface);
  }, [multiplayer.mapAdapter, profile]);

  if (!multiplayer.account) {
    return (
      <>
        <MenuSoundtrack enabled={effectiveMusicEnabled} volume={musicVolume} />
        <AudioSettingsMenu open={panel === "settings"} settings={audioSettings} musicEnabled={effectiveMusicEnabled} onOpenChange={(open) => setPanel(open ? "settings" : null)} onChange={updateAudioSetting} onMusicEnabledChange={updateMusicEnabled} />
        <PhaserWorld mode="login" classId="sorceress" worldVolume={worldVolume}>
          <GameMenuDock className="menu-screen-dock" settingsOpen={panel === "settings"} onSettingsClick={() => setPanel(panel === "settings" ? null : "settings")} />
          <div className="creation-header"><span className="brand-rune">F</span><div><strong>FORGE OF ECHOES</strong><small>The Ashen Realm</small></div></div>
          <section className="login-screen">
            <div className="login-card">
              <div className="login-card-rune" aria-hidden="true">◇</div>
              <div className="login-heading"><span>The forge remembers</span><h1>Forge of Echoes</h1><p>Name yourself, then choose the hero who will brave the rifts.</p></div>
              <form className="login-form" onSubmit={(event) => {
                event.preventDefault();
                const playerName = playerNameInputRef.current?.value.trim() ?? "";
                const password = passwordInputRef.current?.value ?? "";
                rememberPlayerName(playerName);
                void multiplayer.connectAccount(playerName, password, authMode);
              }}>
                <label><span>Player name</span><input ref={playerNameInputRef} required placeholder="player-one" minLength={2} maxLength={24} pattern="[A-Za-z0-9_\\-]+" autoComplete="username" /></label>
                <label><span>Password</span><input ref={passwordInputRef} required type="password" minLength={10} maxLength={128} autoComplete={authMode === "login" ? "current-password" : "new-password"} /></label>
                <button type="submit" disabled={multiplayer.busy}><span>{multiplayer.busy ? "Entering…" : authMode === "login" ? "Enter" : "Create account"}</span><small>Choose your character</small></button>
              </form>
              <button type="button" className="login-mode-toggle" onClick={() => { multiplayer.clearError(); setAuthMode((current) => current === "login" ? "register" : "login"); }}>
                {authMode === "login" ? "New to the realm? Create an account" : "Already forged an account? Sign in"}
              </button>
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
          <MenuSoundtrack enabled={effectiveMusicEnabled} volume={musicVolume} />
          <AudioSettingsMenu open={panel === "settings"} settings={audioSettings} musicEnabled={effectiveMusicEnabled} onOpenChange={(open) => setPanel(open ? "settings" : null)} onChange={updateAudioSetting} onMusicEnabledChange={updateMusicEnabled} />
          <PhaserWorld mode="character-create" classId="sorceress" worldVolume={worldVolume}>
            <GameMenuDock className="menu-screen-dock" settingsOpen={panel === "settings"} onSettingsClick={() => setPanel(panel === "settings" ? null : "settings")} />
            <div className="creation-header"><span className="brand-rune">F</span><div><strong>FORGE OF ECHOES</strong><small>The Ashen Realm</small></div></div>
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
                  <label><span>Unique character name</span><input required value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="Name your Sorceress" minLength={2} maxLength={24} pattern="[A-Za-z][A-Za-z0-9_\\-]*" autoComplete="off" /></label>
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
        <MenuSoundtrack enabled={effectiveMusicEnabled} volume={musicVolume} />
        <AudioSettingsMenu open={panel === "settings"} settings={audioSettings} musicEnabled={effectiveMusicEnabled} onOpenChange={(open) => setPanel(open ? "settings" : null)} onChange={updateAudioSetting} onMusicEnabledChange={updateMusicEnabled} />
        <PhaserWorld mode="login" classId="sorceress" worldVolume={worldVolume}>
          <GameMenuDock className="menu-screen-dock" settingsOpen={panel === "settings"} onSettingsClick={() => setPanel(panel === "settings" ? null : "settings")} />
          <div className="creation-header"><span className="brand-rune">F</span><div><strong>FORGE OF ECHOES</strong><small>The Ashen Realm</small></div></div>
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
                {multiplayer.characters.length === 0 && <div className="empty-roster"><span>◇</span><strong>No characters yet</strong><small>Create your first Sorceress and enter the Forge.</small><button type="button" onClick={() => setAccountView("create-character")}>Create Character</button></div>}
              </div>
            </section>
            {multiplayer.error && <div className="multiplayer-error roster-error" role="alert">{multiplayer.error}</div>}
          </section>
        </PhaserWorld>
      </>
    );
  }

  const authoritativeWorldReady = multiplayer.mapAdapter !== undefined || multiplayer.adapter !== undefined;
  if (!profile || !stats || !statCalculation || !currencies || !authoritativeWorldReady) {
    return <PhaserWorld mode="loading" classId={multiplayer.session.player.classId} worldVolume={worldVolume}><div className="world-loader"><span /><strong>Loading {multiplayer.session.player.characterName}</strong><small>Fetching authoritative profile</small></div></PhaserWorld>;
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
        <MapSoundtrack finalRageActive={mapFinalRageActive} enabled={effectiveMusicEnabled} volume={musicVolume} />
        <AudioSettingsMenu open={panel === "settings"} settings={audioSettings} musicEnabled={effectiveMusicEnabled} onOpenChange={(open) => setPanel(open ? "settings" : null)} onChange={updateAudioSetting} onMusicEnabledChange={updateMusicEnabled} />
        <PhaserWorld
          mode="arena"
          classId={profile.character.classId!}
          controlsBlocked={characterPanelOpen || panel === "settings" || mapExitPending}
          worldVolume={worldVolume}
          arenaBalance={arenaBalance}
          activeMap={activeMap}
          characterStats={stats}
          characterProgress={profile.character}
          characterStatBreakdown={statCalculation.breakdown}
          flaskBelt={profile.flaskBelt}
          onFlaskLoad={onlineLoadFlask}
          onReturnToHideout={requestMapExit}
          multiplayer={multiplayer.mapAdapter}
          onItemDropToGround={characterPanelOpen ? onlineDropItemToGround : undefined}
          onFinalRageChange={setMapFinalRageActive}
        >
          <GameMenuDock className="arena-hotkey-dock" settingsOpen={panel === "settings"} onSettingsClick={() => setPanel(panel === "settings" ? null : "settings")}>
            <button type="button" className={panel === "inventory" ? "active" : ""} onClick={() => setPanel(panel === "inventory" ? null : "inventory")} aria-label="Inventory (I)"><i aria-hidden="true">▦</i><kbd>I</kbd><span>Inventory</span></button>
            <button type="button" className={panel === "attributes" ? "active" : ""} onClick={() => setPanel(panel === "attributes" ? null : "attributes")} aria-label="Character (C)"><i aria-hidden="true">◆</i><kbd>C</kbd><span>Character</span></button>
            <button type="button" className={panel === "skills" ? "active" : ""} onClick={() => setPanel(panel === "skills" ? null : "skills")} aria-label="Skills (K)"><i aria-hidden="true">✦</i><kbd>K</kbd><span>Skills</span></button>
          </GameMenuDock>
          <button type="button" className="return-hideout" disabled={mapExitPending} onClick={requestMapExit}>{mapExitPending ? "Returning…" : "Return to hideout"}</button>
          {characterPanelOpen && (
            <div className="world-panel-backdrop arena-panel-backdrop character-interface-backdrop">
              <section className={`world-panel character-panel panel-${panel}`} aria-label={`Character ${panel}`}>
                <header><div><span>{characterPanelKicker(panel)}</span><h2>{characterPanelTitle(panel)}</h2></div><div className="panel-header-actions"><button type="button" onClick={() => setPanel(null)} aria-label="Close character interface">×</button></div></header>
                {panel === "inventory" && <InventoryPanel profile={profile} selectedItemId={effectiveSelectedItemId} onSelect={setSelectedItemId} onEquipItem={onlineEquipItem} onMoveItem={onlineMoveItem} onQuickStash={onlineQuickStash} onQuickUnstash={onlineQuickUnstash} onApplyCurrency={onlineApplyCurrency} onSelectStashTab={onlineSelectStash} onRenameStashTab={onlineRenameStash} onCreateStashTab={onlineCreateStash} onLoadFlask={onlineLoadFlask} />}
                {panel === "attributes" && <AttributesPanel progress={profile.character} stats={stats} breakdown={statCalculation.breakdown} onAllocate={onlineAllocateAttribute} />}
                {panel === "skills" && <SkillTreePanel progress={profile.character} castSpeed={stats.castSpeed} cooldownMultiplier={stats.skillCooldown} onAllocate={onlineAllocateSkill} onSetSlot={onlineSetSkillSlot} />}
              </section>
            </div>
          )}
          {notice && <GameNotification key={notice} message={notice} />}
        </PhaserWorld>
      </>
    );
  }

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

  function onlineSetSkillSlot(slot: number, skill: SkillBarSkillId | null) {
    void multiplayer.executeProfileCommand({ type: "set_skill_slot", slot, skill });
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
      <HideoutSoundtrack enabled={effectiveMusicEnabled} volume={musicVolume} />
      <AudioSettingsMenu open={panel === "settings"} settings={audioSettings} musicEnabled={effectiveMusicEnabled} onOpenChange={(open) => setPanel(open ? "settings" : null)} onChange={updateAudioSetting} onMusicEnabledChange={updateMusicEnabled} />
      <PhaserWorld mode="hideout" classId={profile.character.classId!} portalIndexes={availablePortalIndexes} merchantIds={merchantIds} paused={Boolean(panel)} worldVolume={worldVolume} characterStats={stats} characterProgress={profile.character} characterStatBreakdown={statCalculation.breakdown} flaskBelt={profile.flaskBelt} onFlaskLoad={onlineLoadFlask} onStation={handleStation} multiplayer={multiplayer.adapter}>
      <GameMenuDock className="hideout-hotkey-dock" settingsOpen={panel === "settings"} onSettingsClick={() => setPanel(panel === "settings" ? null : "settings")}>
        <button type="button" className={panel === "inventory" ? "active" : ""} onClick={() => setPanel(panel === "inventory" ? null : "inventory")} aria-label="Inventory (I)"><i aria-hidden="true">▦</i><kbd>I</kbd><span>Inventory</span></button>
        <button type="button" className={panel === "attributes" ? "active" : ""} onClick={() => setPanel(panel === "attributes" ? null : "attributes")} aria-label="Character (C)"><i aria-hidden="true">◆</i><kbd>C</kbd><span>Character</span>{profile.character.unspentAttributePoints > 0 && <strong>{profile.character.unspentAttributePoints}</strong>}</button>
        <button type="button" className={panel === "skills" ? "active" : ""} onClick={() => setPanel(panel === "skills" ? null : "skills")} aria-label="Skills (K)"><i aria-hidden="true">✦</i><kbd>K</kbd><span>Skills</span>{profile.character.unspentSkillPoints > 0 && <strong>{profile.character.unspentSkillPoints}</strong>}</button>
        <button type="button" className={panel === "maps" ? "active" : ""} onClick={() => setPanel(panel === "maps" ? null : "maps")} aria-label="Maps (M)"><i aria-hidden="true">◇</i><kbd>M</kbd><span>Maps</span>{inventoryMaps.length + (profile.mapDevice ? 1 : 0) > 0 && <strong>{inventoryMaps.length + (profile.mapDevice ? 1 : 0)}</strong>}</button>
        <button type="button" className={panel === "multiplayer" ? "active" : ""} onClick={() => setPanel(panel === "multiplayer" ? null : "multiplayer")} aria-label="Party (P)"><i aria-hidden="true">♟</i><kbd>P</kbd><span>Party</span></button>
        <button type="button" className="roster-dock-action" onClick={() => { setCharacterName(""); setAccountView("roster"); void multiplayer.leaveCharacter(); }} aria-label="Return to character selection"><i aria-hidden="true">↩</i><span>Characters</span></button>
      </GameMenuDock>

      {activeMap && <div className="portal-notice"><span>{multiplayer.party?.visibility === "solo" ? "Solo map" : "Party map"}</span><strong>{activeMap.baseName}</strong><small>{availablePortalIndexes.length}/6 portals remain · each is one-use</small></div>}

      {panel && panel !== "settings" && (
        <div className={`world-panel-backdrop ${isCharacterPanel(panel) ? "character-interface-backdrop" : ""}`}>
          <section className={`world-panel panel-${panel} ${isCharacterPanel(panel) ? "character-panel" : ""}`}>
            <header><div><span>{panel === "stash" ? "Hideout storage" : panel === "maps" ? "Waystones & portals" : panel === "merchant" ? MERCHANTS[activeMerchantId].title : panel === "multiplayer" ? "Party finder" : characterPanelKicker(panel)}</span><h2>{panel === "stash" ? "Stash Chest" : panel === "maps" ? "Map Device" : panel === "merchant" ? `${MERCHANTS[activeMerchantId].name}'s Shop` : panel === "multiplayer" ? "Party" : characterPanelTitle(panel)}</h2></div><div className="panel-header-actions"><button type="button" onClick={() => setPanel(null)} aria-label="Close panel">×</button></div></header>
            {panel === "maps" && <MapWorkshop profile={profile} slottedMap={profile.mapDevice} activeMap={activeMap} portalsRemaining={availablePortalIndexes.length} selectedItemId={effectiveSelectedItemId} onSelect={setSelectedItemId} onMoveItem={onlineMoveItem} onSlot={(itemId) => void multiplayer.executeProfileCommand({ type: "slot_map", itemId })} onRemove={() => void multiplayer.executeProfileCommand({ type: "remove_map" })} onOpen={onlineOpenMap} />}
            {panel === "merchant" && <MerchantPanel merchantId={activeMerchantId} profile={profile} currencies={currencies} selectedItemId={effectiveSelectedItemId} onSelectItem={setSelectedItemId} onMoveItem={onlineMoveItem} onBuy={(merchantId, offerId, position) => void multiplayer.executeProfileCommand({ type: "buy_merchant_offer", merchantId, offerId, position })} />}
            {panel === "multiplayer" && <MultiplayerPanel controller={multiplayer} onOpenMapDevice={() => setPanel("maps")} onPartyEntered={() => setPanel(null)} />}
            {(panel === "inventory" || panel === "stash") && <InventoryPanel profile={profile} selectedItemId={effectiveSelectedItemId} showStash={panel === "stash"} onSelect={setSelectedItemId} onEquipItem={onlineEquipItem} onMoveItem={onlineMoveItem} onQuickStash={onlineQuickStash} onQuickUnstash={onlineQuickUnstash} onApplyCurrency={onlineApplyCurrency} onSelectStashTab={onlineSelectStash} onRenameStashTab={onlineRenameStash} onCreateStashTab={onlineCreateStash} onLoadFlask={onlineLoadFlask} />}
            {panel === "attributes" && <AttributesPanel progress={profile.character} stats={stats} breakdown={statCalculation.breakdown} onAllocate={onlineAllocateAttribute} />}
            {panel === "skills" && <SkillTreePanel progress={profile.character} castSpeed={stats.castSpeed} cooldownMultiplier={stats.skillCooldown} onAllocate={onlineAllocateSkill} onSetSlot={onlineSetSkillSlot} />}
          </section>
        </div>
      )}
      {notice && <GameNotification key={notice} message={notice} />}
      </PhaserWorld>
    </>
  );
}
