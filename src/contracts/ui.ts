// FROZEN CONTRACT — DOM UI (Preact). src/ui/index.ts must `export function mountUi(root: HTMLElement, store: UiStore): () => void`.
// The UI is a pure view over UiState that calls UiActions. It never touches the network, sim or renderer directly.
// The client app (src/client) implements UiStore on top of the server connection. Per-frame data reaches the UI
// only through `hud`, updated ~15 Hz. Item/crafting/skill descriptions come from the SHARED rules (store.rules),
// evaluated locally for display; every state change is a command sent to the authoritative server.
import type { CurrencyId, MonsterKind, SkillId } from './content';
import type { DerivedStats, GameRulesApi, MerchantOffer, RunSetup } from './game';
import type { CharacterSave, ItemLocation, ItemTone, Settings, SpecialStashTab } from './items';
import type { AccountInfo, CharacterSummary, PartyInfo, PartyInvite, PortalInfo, RunSummaryInfo, TradeInfo, TradeRequestInfo } from './net';
import type { RunPhase } from './sim';
import type { PlayerDebuff } from './bestiary';

export type Screen =
  | 'loading'       // booting / generating art
  | 'auth'          // login / register
  | 'characters'    // character select / create
  | 'game'          // connected and in a zone
  | 'disconnected'; // connection lost (reconnecting or fatal)

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export type Panel =
  | 'inventory' | 'stash' | 'character' | 'skills' | 'mapDevice' | 'merchant' | 'craftingBench' | 'trade' | 'party' | 'menu' | 'help';

export interface HudSlot {
  key: string;                 // "LMB", "Space", "Q", …
  skillId: SkillId | null;
  cooldown: number;            // remaining seconds
  cooldownTotal: number;
  charges: number;
  maxCharges: number;
  focusCost: number;
  usable: boolean;
}

export interface HudFlask {
  key: string;                 // "1".."4"
  flaskId: string;
  count: number;
  resource: 'life' | 'focus';
  active: number;              // 0..1 remaining fraction of the active recovery
}

export interface HudRun {
  mapName: string;
  tier: number;
  phase: RunPhase;
  wave: number;
  waveCount: number;
  waveProgress: number;        // 0..1 time until the next wave
  monstersAlive: number;
  kills: number;
  elapsed: number;
  boss: { name: string; life: number; maxLife: number; phase: number } | null;
  lieutenant: { name: string; life: number; maxLife: number } | null;
  /** Upcoming wave preview during the "Tell" phase. */
  tell: { wave: number; families: MonsterKind[]; lieutenant: boolean; boss: boolean } | null;
  /** The LOCAL player's personal luck in this map (map + own gear), % (100 = base). */
  itemQuantity: number;
  itemRarity: number;
  modLines: string[];
  /** Portals left on this map (owner's device). */
  portalsRemaining: number;
  portalsTotal: number;
}

/** Another player in the same instance (party frames + names). */
export interface HudAlly {
  name: string;
  level: number;
  life: number;
  maxLife: number;
  dead: boolean;
}

export interface HudState {
  zone: 'hideout' | 'map';
  /** Owner of the current instance ("Your Hideout" / "Mira's Hideout" / "Mira's Map"). */
  zoneOwnerName: string;
  zoneIsOwn: boolean;
  life: number;
  maxLife: number;
  focus: number;
  maxFocus: number;
  wardFraction: number;        // 0..1 remaining cinder ward
  level: number;
  xp: number;
  xpToNext: number;
  slots: HudSlot[];            // LOADOUT_SLOTS
  flasks: (HudFlask | null)[]; // BELT_SLOTS
  run: HudRun | null;
  /** Hideout: the map portal of this hideout's owner (null = none open). */
  portal: PortalInfo | null;
  allies: HudAlly[];
  /** The local player's active debuffs (HUD icons: icon/debuff/<id>). */
  debuffs: { id: PlayerDebuff; remaining: number; duration: number; stacks: number }[];
  fps: number;
  pingMs: number;
  dead: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | ItemTone;
}

export interface ChatLine {
  id: number;
  fromName: string;            // '' for system lines
  text: string;
  time: number;
}

export interface UiState {
  screen: Screen;
  connection: ConnectionStatus;
  /** Player-facing error on auth/character screens or the disconnected screen. */
  error: string | null;
  /** True while an auth/character request is in flight. */
  busy: boolean;
  account: AccountInfo | null;
  characters: CharacterSummary[];
  character: CharacterSave | null;
  derived: DerivedStats | null;
  zone: 'hideout' | 'map' | null;
  openPanels: Panel[];
  /** Active stash tab: a normal tab index or a special tab. */
  stashTab: number | SpecialStashTab;
  /** Currency stack armed for crafting (right-click). */
  armed: { uid: string; currencyId: CurrencyId } | null;
  /** Waiting for the player to pick an affix line (seal, catalyst, fracture core). */
  affixChoice: { currencyUid: string; targetUid: string; currencyId: CurrencyId } | null;
  /** Crafting only works in a hideout. */
  craftingAllowed: boolean;
  /** The map device only works in your own hideout (merchant, stash, crafting and the bench work in any hideout). */
  isOwnHideout: boolean;
  /** Item placed on the crafting bench (a UI selection; the item stays where it is). */
  benchItemUid: string | null;
  /** Open trade (null = none) and pending incoming trade requests. */
  trade: TradeInfo | null;
  tradeRequests: TradeRequestInfo[];
  /** Server clock offset estimate: serverTime ≈ Date.now() + serverClockOffset (for trade accept locks). */
  serverClockOffset: number;
  /** The run setup of the map the player is in (or the last one while the summary is shown). */
  run: RunSetup | null;
  hud: HudState | null;
  toasts: Toast[];
  runSummary: RunSummaryInfo | null;
  party: PartyInfo | null;
  invites: PartyInvite[];
  chat: ChatLine[];
  /** Chat input focused (movement keys go to the input). */
  chatOpen: boolean;
  paused: boolean;             // menu open (online: the world keeps running; only local input is blocked)
  settings: Settings;
  /** Alt held: show affix tiers/ranges and equipped comparisons. */
  altHeld: boolean;
  /** Increments on each level-up (UI can animate). */
  levelUpCount: number;
}

export interface UiActions {
  // auth & characters
  register(username: string, password: string): void;
  login(username: string, password: string): void;
  logout(): void;
  createCharacter(name: string): void;
  playCharacter(id: string): void;
  deleteCharacter(id: string): void;
  /** Leave the game back to character select. */
  toCharacterSelect(): void;
  retryConnection(): void;

  // panels
  togglePanel(panel: Panel): void;
  openPanel(panel: Panel): void;
  closePanel(panel: Panel): void;
  closeAllPanels(): void;
  setStashTab(tab: number | SpecialStashTab): void;
  depositAllCurrency(): void;

  // items (sent to the server; optimistic UI is optional)
  moveItem(uid: string, to: ItemLocation, count?: number): boolean;
  /** Ctrl-click; `count` (e.g. 1 with Shift) withdraws a partial stack from the Crafting Stash. */
  quickMove(uid: string, count?: number): void;
  discardItem(uid: string): void;
  armCurrency(uid: string): void;
  disarm(): void;
  /** Apply the armed currency to the target (may open an affix choice). */
  applyArmed(targetUid: string): void;
  chooseAffix(affixIndex: number): void;
  cancelAffixChoice(): void;
  addStashTab(): void;
  renameStashTab(tab: number, name: string): void;
  clearNewFlags(): void;
  /** Drop an item on the floor at your feet (public: anyone nearby can pick it up). */
  dropItem(uid: string): void;

  // crafting bench
  setBenchItem(uid: string | null): void;
  benchCraft(recipeId: string): void;
  benchClear(): void;

  // trading
  tradeRequest(name: string): void;
  tradeRespond(requestId: string, accept: boolean): void;
  /** Replace your offer (backpack uids). */
  tradeOffer(uids: string[]): void;
  tradeAccept(accept: boolean): void;
  tradeCancel(): void;

  // character
  allocateAttribute(attr: 'str' | 'dex' | 'int'): void;
  rankUpSkill(skillId: SkillId): void;
  setLoadoutSlot(slot: number, skillId: SkillId | null): void;

  // hideout
  activateMapDevice(): void;
  /** Offers computed locally from the shared rules (display); buying goes to the server. */
  merchantOffers(): MerchantOffer[];
  buyOffer(offerId: string): void;

  // party & social
  partyInvite(name: string): void;
  partyRespond(inviteId: string, accept: boolean): void;
  partyLeave(): void;
  partyKick(characterId: string): void;
  partyPromote(characterId: string): void;
  visitHideout(characterId: string): void;
  goHome(): void;
  setChatOpen(open: boolean): void;
  sendChat(text: string): void;

  // map
  leaveMap(): void;
  respawn(): void;
  dismissRunSummary(): void;

  // misc
  setPaused(paused: boolean): void;
  updateSettings(patch: Partial<Settings>): void;
  dismissToast(id: number): void;
  uiSound(id: 'click' | 'hover' | 'open' | 'close' | 'error' | 'equip'): void;
}

export interface UiStore {
  get(): UiState;
  subscribe(listener: () => void): () => void;
  actions: UiActions;
  rules: GameRulesApi;
  art: { icon(iconId: string, size?: number): string; portrait(size?: number): string };
}

export type MountUi = (root: HTMLElement, store: UiStore) => () => void;
