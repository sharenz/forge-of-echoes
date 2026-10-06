// Every word the first-run guide shows, in ONE file (docs/onboarding-ux.md 6.8). Whole sentences with {param} slots (no string
// concatenation, so a translation can reorder), one locale object implementing GuideStrings, stable keys shared with the tests and
// the e2e. Voice: friendly, concrete, second person, present tense; bodies are 90 characters or fewer; no jargon without a
// glossary entry. Canonical names: "Map Device" is the object in the hideout (and its panel), "Atlas" is the chart tab inside it.
// "Cartography Table" and "Ember Chart" are retired from player text.
import type { GuideHintId, GuideProp, GuideStepId } from '../../contracts/guide';
import type { MapEventKind } from '../../contracts/map-events';

export type GuideChapterId = 'enter' | 'win' | 'grow';

interface StepText { title: string; body: string }

export interface GuideStrings {
  tracker: {
    region: string;
    chapter: Record<GuideChapterId, string>;
    hide: string;
    show: string;
    help: string;
    skip: string;
    skipTitle: string;
    progress: string;
    stuck: string;
    walkTo: string;
  };
  steps: Record<Exclude<GuideStepId, 'next'>, StepText>;
  /** Variants of a step line for a player who fell or has no portal left (the tracker stays on the fight). */
  retry: { portal: StepText; noPortal: StepText; partyJoin: StepText };
  /** The line a player sees while the warm-up holds the first wave. */
  warmup: string;
  next: {
    title: string;
    intro: string;
    craft: StepText;
    rook: StepText;
    atlas: StepText;
    map: StepText;
    craftGo: string;
    rookGo: string;
    atlasGo: string;
    done: string;
  };
  cheatsheet: {
    title: string;
    aim: StepText;
    cast: StepText;
    move: StepText;
    skills: StepText;
    flasks: StepText;
    dash: StepText;
    panels: StepText;
  };
  hints: Record<GuideHintId, string>;
  hint: { gotIt: string; mute: string };
  world: { mapDevice: string; stash: string; anvil: string; merchant: string; portal: string; returnPortal: string; chest: string; arrow: string };
  help: {
    title: string;
    open: string;
    tabs: { controls: string; run: string; glossary: string; tutorial: string };
    run: { title: string; steps: string[] };
    glossary: { search: string; empty: string };
    tutorial: {
      state: Record<'active' | 'skipped' | 'done', string>;
      replay: string;
      skip: string;
      hide: string;
      replayed: string;
      skipped: string;
      steps: string;
      tips: string;
    };
    controls: { rift: string; helpKey: string; foot: string };
  };
  panels: { inventory: string; character: string; skills: string; party: string; atlas: string; help: string };
  toasts: { points: string; replay: string; skipped: string };
  summary: {
    lostTitle: string;
    lostLine: string;
    fellTitle: string;
    fellLine: string;
    zeroKills: string;
    next: { points: string; equip: string; atlas: string };
    scroll: string;
  };
  portalCard: { cleared: string; clearedBody: string };
  tier: { map: string; affix: string };
  names: Record<GuideProp, string>;
  title: { pitch: string; diceLabel: string; skip: string };
  codex: { empty: string };
  deck: {
    life: string;
    focus: string;
    flaskReady: string;
    flaskEmpty: string;
    flaskEmptyHome: string;
    flaskKey: string;
  };
}

export const GUIDE_EN: GuideStrings = {
  tracker: {
    region: 'Objective',
    chapter: { enter: 'First expedition', win: 'Win the map', grow: 'Grow stronger' },
    hide: 'Hide',
    show: 'Objective',
    help: 'Help',
    skip: 'Skip',
    skipTitle: 'Skip the tutorial. You can reset it from Help.',
    progress: '{done} / {total}',
    stuck: 'Stuck? Press H for help.',
    walkTo: 'Take me there',
  },
  steps: {
    device: { title: 'Click the Map Device', body: 'The stone table to the north. It opens the Atlas.' },
    area: { title: 'Pick {area}', body: 'Click the pulsing area on the chart.' },
    map: { title: 'Drag a map into the slot', body: 'Take one of your starter maps from the inventory and drop it in the middle.' },
    open: { title: 'Open the area', body: 'It spends the map and opens {portals} portals.' },
    enter: { title: 'Step into the portal', body: 'Click the swirling portal. Each entry uses one of {portals}.' },
    fight: { title: 'Fight!', body: 'Hold the left mouse button to cast at your cursor. Move with WASD.' },
    boss: { title: 'Defeat {boss}', body: 'Wave {wave} of {waves}. The boss arrives on the last one.' },
    chest: { title: 'Open the chest', body: 'Walk up to the glowing chest to open it. The loot is yours alone.' },
    home: { title: 'Return home', body: 'Step into the return portal. Everything you picked up comes with you.' },
    points: { title: 'Spend your points', body: 'Click the glowing badges, or press C for attributes and K for skills.' },
    equip: { title: 'Equip your loot', body: 'Press I and drag gear onto its slot. Hold Alt to compare.' },
  },
  retry: {
    portal: { title: 'Fight!', body: 'You fell and nothing is lost. Click the portal to try again ({portals} left).' },
    noPortal: { title: 'Open another map', body: 'That map is spent. Drag another map into the Map Device.' },
    partyJoin: { title: 'Follow {name}', body: 'Click the portal to join {name}’s map.' },
  },
  warmup: 'The monsters wait until you move or cast.',
  next: {
    title: 'What next?',
    intro: 'You cleared your first map. Here is where the game goes from here.',
    craft: { title: 'Craft at the anvil', body: 'Right-click Scrap, then click a piece of gear. Every craft costs Stability.' },
    rook: { title: 'Visit Rook', body: 'His wares are random and change every 6 hours. Sell spare gear to him.' },
    atlas: { title: 'Spend an Atlas point', body: 'Clearing new areas and tiers earns points. Spend them in the Atlas, on the Codex tab.' },
    map: { title: 'Open your next map', body: 'Higher tiers drop better gear. You still hold more maps.' },
    craftGo: 'Show the anvil',
    rookGo: 'Show Rook',
    atlasGo: 'Show the Map Device',
    done: 'Got it',
  },
  cheatsheet: {
    title: 'Controls',
    aim: { title: 'Aim', body: 'Point with the mouse' },
    cast: { title: 'Cast', body: 'Hold to cast at your cursor' },
    move: { title: 'Move', body: 'Move' },
    skills: { title: 'More skills', body: 'Learn them in K, then use RMB, Q, E, R, F' },
    flasks: { title: 'Flasks', body: 'Flasks: 1 and 2 heal' },
    dash: { title: 'Rift Step', body: 'Rift Step dash: learn it in K' },
    panels: { title: 'Panels', body: 'Panels and help' },
  },
  hints: {
    lowLife: 'Low on Life. Press 1 or 2 to drink a Life flask.',
    flasksEmpty: 'Flask empty. Kills drop more. Going home refills them for free.',
    focusEmpty: 'Out of Focus. Spells spend the blue globe, and it refills over time.',
    levelUp: 'Level up! Spend your points: C for attributes, K for skills.',
    firstLoot: 'Gear lies on the ground. Click its name to pick it up. Currency is automatic.',
    firstRare: 'A rare! Press I, then hold Alt over it to compare it with your gear.',
    firstDeath: 'You fell. Nothing is lost. Keep moving, hold the mouse button and try again.',
    secondDeath: 'Tough map? Spend your points and equip upgrades first, then try again.',
    firstDebuff: 'A debuff! Hold Alt over its icon to see how to cure it.',
    firstEvent: 'An encounter started. Its card shows the goal; better grades pay more.',
    firstBossPhase: 'The boss changes tactics at each notch on its bar. Watch for red circles.',
    firstBench: 'Drag gear onto the anvil. Each craft costs Stability; at 0 it is Finished, never destroyed.',
    firstMerchant: 'Rook’s board is random and changes every 6 hours. Sell spare gear here.',
    firstAtlasPoint: 'An Atlas point! Open the Map Device, then the Codex tab, to spend it.',
    firstStash: 'The stash is shared by all your characters. Ctrl-click moves items fast.',
    firstCraft: 'Crafted! Stability counts the crafts an item can still take. Hold Alt for details.',
    firstMapClear: 'First clear! Your Atlas now shows lenses, pins and daily surges.',
  },
  hint: { gotIt: 'Got it', mute: 'Hide tips' },
  world: {
    mapDevice: 'Map Device',
    stash: 'Stash',
    anvil: 'Crafting Bench',
    merchant: 'Rook: merchant',
    portal: 'Portal',
    returnPortal: 'Return portal',
    chest: 'Reward chest',
    arrow: '{name}',
  },
  help: {
    title: 'Help',
    open: 'Help (H)',
    tabs: { controls: 'Controls', run: 'How a run works', glossary: 'Glossary', tutorial: 'Tutorial' },
    run: {
      title: 'How a run works',
      steps: [
        'Click the Map Device in your hideout to open the Atlas.',
        'Click an area, drag a map into its slot and press Open area.',
        'Step through the portal and fight six waves of monsters.',
        'Defeat the boss on the last wave, then walk up to the chest.',
        'Return home through the return portal with everything you picked up.',
        'Dying costs a portal, never your gear or your experience.',
      ],
    },
    glossary: { search: 'Search terms', empty: 'No term matches.' },
    tutorial: {
      state: { active: 'The tutorial is on.', skipped: 'The tutorial is off.', done: 'You finished the tutorial.' },
      replay: 'Reset tutorial',
      skip: 'Skip tutorial',
      hide: 'Hide objective',
      replayed: 'Tutorial reset. Click the Map Device to begin.',
      skipped: 'Tutorial off. You can reset it from Help.',
      steps: 'Steps',
      tips: 'Show tips',
    },
    controls: {
      rift: 'Rift Step is your dash. Learn it in K and it takes the next free skill slot.',
      helpKey: 'Help and this reference',
      foot: 'Click the Map Device, stash, anvil or Rook in a hideout to use them, and a portal to enter it. There is no pause online: your party keeps playing.',
    },
  },
  panels: { inventory: 'Inventory', character: 'Character', skills: 'Skills', party: 'Party', atlas: 'Atlas', help: 'Help' },
  toasts: {
    points: '{count} {what} to spend: press {key}.',
    replay: 'Tutorial reset. Click the Map Device to begin.',
    skipped: 'Tutorial off. You can reset it from Help.',
  },
  summary: {
    lostTitle: 'Map lost',
    lostLine: 'The portals are spent. Everything you picked up is still yours.',
    fellTitle: 'You fell',
    fellLine: 'Nothing is lost. {portals} {portalWord} left: click the portal to go back in.',
    zeroKills: 'Hold the left mouse button to cast, keep moving, and drink a flask with 1 or 2.',
    next: { points: 'Spend points', equip: 'Equip gear', atlas: 'Open the Atlas' },
    scroll: 'Scroll for more',
  },
  portalCard: { cleared: 'Return portal open', clearedBody: 'Open the chest, then step into the return portal.' },
  tier: { map: 'Map tier: higher is harder and pays more', affix: 'Affix tier: lower is better' },
  names: { mapDevice: 'Map Device', stash: 'Stash', anvil: 'Crafting Bench', merchant: 'Rook' },
  codex: { empty: 'Earn your first point by clearing a map. Clearing new areas, tiers and bosses earns more.' },
  title: { pitch: 'Craft your gear. Craft your maps. Survive six waves.', diceLabel: 'Suggest another name', skip: 'I have played before: skip the tutorial' },
  deck: {
    life: 'Your health. At 0 you fall. Press 1 or 2 to drink a Life flask.',
    focus: 'Mana for spells. Ember Lance is free; stronger skills spend Focus, which refills over time.',
    flaskReady: 'Press {key} to drink it.',
    flaskEmpty: 'Empty. Kills drop more flasks, and Rook sells them under Supplies.',
    flaskEmptyHome: 'Going home refills your flasks for free.',
    flaskKey: 'Key {key}',
  },
};

/** Glossary entries (Help, tab "Glossary"): at most 20, term <= 24 characters, definition <= 160. */
export interface GlossaryEntry { id: string; term: string; def: string }

export const GLOSSARY: readonly GlossaryEntry[] = [
  { id: 'life', term: 'Life', def: 'Your health (red globe). At 0 you fall. Life flasks (1 and 2) restore it over 3 seconds.' },
  { id: 'focus', term: 'Focus', def: 'Mana for spells (blue globe). Ember Lance is free; stronger skills spend Focus, which refills over time.' },
  { id: 'resistance', term: 'Resistances', def: 'Cut fire, cold, lightning or void damage by that percent (cap 75%). Negative resistance means you take extra.' },
  { id: 'armour', term: 'Armour', def: 'Cuts physical hits. It helps most against small hits.' },
  { id: 'evasion', term: 'Evasion', def: 'Chance to avoid a hit entirely (cap 75%).' },
  { id: 'stability', term: 'Stability', def: 'How many crafts an item can still take. At 0 it is Finished and never destroyed.' },
  { id: 'affix', term: 'Affix and affix tier', def: 'An affix is a bonus on an item. Its tier is a rank: the lower the number, the better the roll (Tier 1 is best).' },
  { id: 'maptier', term: 'Map tier', def: 'How hard a map is, from 1 to 15. Higher is harder and pays more. Not the same as affix tier.' },
  { id: 'area', term: 'Area', def: 'A place on the Atlas with its own monsters and boss. A map item opens exactly one area.' },
  { id: 'atlas', term: 'Atlas', def: 'Your chart of areas, opened at the Map Device. Its Codex tab is the passive tree for maps.' },
  { id: 'surge', term: 'Surge', def: 'Daily charges per area. A charged run drops more items and better ones. They refresh at 04:00 UTC.' },
  { id: 'scarab', term: 'Scarab', def: 'A consumable you socket beside a map to change the run: more loot, more danger. One of each kind.' },
  { id: 'pin', term: 'Pin', def: 'Pin an area and its maps drop three times as often.' },
  { id: 'portal', term: 'Portals', def: 'A map opens 8 portals. Each entry, including coming back after a fall, uses one.' },
  { id: 'quantity', term: 'Quantity and rarity', def: 'How many items drop, and how likely they are to be better. They never change each other.' },
  { id: 'quality', term: 'Quality', def: 'A map bonus that raises item quantity, rarity or both. Crafting can improve it.' },
  { id: 'scrap', term: 'Forge Scrap', def: 'Basic crafting and shop currency. Rook pays and charges in it.' },
];

/** The Controls tab of Help: groups of key rows. */
export const CONTROLS: readonly { title: string; rows: readonly (readonly [readonly string[], string])[] }[] = [
  {
    title: 'Combat',
    rows: [
      [['W', 'A', 'S', 'D'], 'Move'],
      [['Mouse'], 'Aim: skills fly towards the cursor'],
      [['LMB'], 'Hold to cast your main skill at the cursor'],
      [['RMB', 'Q', 'E', 'R', 'F'], 'More skills: learn them in K, then hold to cast'],
      [['Q'], 'Rift Step is your dash. Learn it in K and it takes the next free slot'],
      [['1', '2', '3', '4'], 'Drink a flask: Life flasks heal, the blue one restores Focus'],
      [['T'], 'Toggle auto-attack for Ember Lance in its assigned slot'],
    ],
  },
  {
    title: 'Interface',
    rows: [
      [['I'], 'Inventory'],
      [['C'], 'Character: spend attribute points'],
      [['K'], 'Skills: spend skill points, fill the skill bar'],
      [['P'], 'Party: invite, visit hideouts, trade'],
      [['H', 'F1'], 'Help and this reference'],
      [['Esc'], 'Close the top panel, or open the menu'],
      [['Alt'], 'Hold: affix tiers, ranges and comparison; point at a debuff for its counter'],
    ],
  },
  {
    title: 'Party and chat',
    rows: [
      [['Enter'], 'Open chat, send a message'],
      [['/trade'], 'In chat: /trade name asks a player to trade'],
      [['Esc'], 'Close chat'],
    ],
  },
  {
    title: 'Items and crafting',
    rows: [
      [['Ctrl', 'Click'], 'Move between inventory, stash, gear, Map Device, bench and trade'],
      [['Ctrl', 'Shift', 'Click'], 'In the stash: put gear or a map on the crafting bench'],
      [['Ctrl', 'Shift', 'Click'], 'On a Crafting Stash slot: take exactly one'],
      [['Ctrl', 'F'], 'Search the stash while it is open'],
      [['RMB'], 'Arm a currency, also a Crafting Stash slot (hideout only)'],
      [['LMB'], 'Apply the armed currency to an item'],
      [['Drag'], 'Move an item; drop it on the world to put it on the floor'],
    ],
  },
];


/** One sentence of goal for every map encounter card (the card's first line): what to do and what better play pays. */
export const EVENT_GOALS: Readonly<Record<MapEventKind, string>> = {
  hunted: 'Dodge the Stalker\u2019s pounces and strike while it is exposed. Every dodge raises the reward.',
  echoRift: 'Cut the echoes off before they reach the anchor, then slay the Rift Warden.',
  blackout: 'Take the Ember from the Wickbearer and light three braziers before it burns out.',
  vaultbreakers: 'Break the wagon\u2019s locks by clearing their escorts. Each lock guards a prize.',
  secondCrown: 'Two bosses fight for the crown. Choose who falls first and finish the survivor.',
  wound: 'Lure guardians into the marked wedge and step out before the crack erupts.',
  pactAltar: 'Stand on a stone to choose a pact. Bolder pacts pay more.',
  orchard: 'Guard the blooms and harvest them ripe. Riper is richer.',
  ring: 'Name your terms on a vow, then duel the Champion inside the chains.',
  host: 'Shatter the prism to thaw the frozen legion all at once, or let it wake in streams.',
  anvil: 'Fight near the anvil to charge it before the timer ends. A charged anvil forges a boon.',
  bellwatch: 'Cut down the cantors, outer ones first, before the bell tolls again.',
  voidBreach: 'Stay in the bright ring, slay the voidcallers, then break the Void Heart.',
};

/** Syllables for the suggested character name (3 to 16 letters): a first and a second part. */
const NAME_START = ['Ash', 'Kael', 'Ysol', 'Mira', 'Thal', 'Eldr', 'Sera', 'Vor', 'Nym', 'Cind', 'Orel', 'Brin', 'Lysa', 'Torv', 'Ember', 'Rael', 'Isen', 'Dorn'];
const NAME_END = ['wyn', 'ael', 'ith', 'ora', 'veil', 'rin', 'dra', 'mere', 'gard', 'lis', 'thar', 'iel', 'wen', 'ax', 'ora', 'ene'];

/** A pronounceable name suggestion; `pick` is injectable (Math.random by default) so tests are deterministic. */
export function suggestName(pick: () => number = Math.random): string {
  const a = NAME_START[Math.floor(pick() * NAME_START.length) % NAME_START.length];
  const b = NAME_END[Math.floor(pick() * NAME_END.length) % NAME_END.length];
  return `${a}${b}`.slice(0, 16);
}

/** The glossary entry a line of game text is about ("+10% to all Resistances" -> Resistances), for tooltips on jargon. Null when none applies. */
export function glossaryFor(text: string): GlossaryEntry | null {
  const t = text.toLowerCase();
  const key = t.includes('resistance') ? 'resistance' : t.includes('armour') ? 'armour' : t.includes('evasion') ? 'evasion'
    : t.includes('quantity') ? 'quantity' : t.includes('rarity') ? 'quantity' : t.includes('surge') ? 'surge' : t.includes('scarab') ? 'scarab' : t.includes('focus') ? 'focus' : null;
  return key ? GLOSSARY.find((g) => g.id === key) ?? null : null;
}

type Params = Record<string, string | number>;

function lookup(path: string): unknown {
  let cur: unknown = GUIDE_EN;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** The `{name}` slots of a string, in order. */
export function paramsOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/** Interpolate `{name}` slots; an unknown slot is left as is (the copy lint test catches it). */
export function fill(text: string, params?: Params): string {
  return params ? text.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all)) : text;
}

/** A string of the guide by dotted path ('steps.map.title'), with `{param}` interpolation. */
export function gt(path: string, params?: Params): string {
  const v = lookup(path);
  return typeof v === 'string' ? fill(v, params) : path;
}

/** Every string of the guide with its path (the copy lint test walks this). */
export function allStrings(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') out.push({ path, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(GUIDE_EN, '');
  return out;
}
