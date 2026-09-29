// Pure UI helpers: formatting, zone names, panel anchoring, keyboard mapping and focus rules, crafting click
// rules, grid geometry, validation, item facts, party wording and the skill tree layout.
import { describe, expect, it } from 'vitest';
import type { SkillInfo } from '../../src/contracts/game';
import type { CurrencyStack, EquipmentItem, MapItem } from '../../src/contracts/items';
import type { PartyMemberInfo } from '../../src/contracts/net';
import {
  clamp01,
  formatClock,
  formatCooldown,
  formatDuration,
  formatInt,
  formatLuck,
  formatSigned,
  fraction,
  pingQuality,
  possessive,
} from '../../src/ui/lib/format';
import { cellAt, grabCell, placementOrigin } from '../../src/ui/lib/grid';
import { itemIconId, itemTone, locationKey, sameLocation, stackCount } from '../../src/ui/lib/items';
import { CRAFT_PENDING_MS, craftPending, keepArmedAfterApply } from '../../src/ui/lib/crafting';
import {
  escapeStep,
  isActivationKey,
  isControlTarget,
  isTypingTarget,
  keyAllowedWhile,
  keyCommand,
  type EscapeContext,
} from '../../src/ui/lib/keys';
import { escapePanel, panelFixups, panelSide, topPanel, visiblePanels } from '../../src/ui/lib/panels';
import { locationText } from '../../src/ui/lib/party';
import { layoutSkillTree } from '../../src/ui/lib/skilltree';
import { characterNameError, passwordError, usernameError } from '../../src/ui/lib/validate';
import { zoneLabel } from '../../src/ui/lib/zone';
import { PAPERDOLL, PAPERDOLL_SIZE } from '../../src/ui/lib/content';
import { EQUIP_SLOTS } from '../../src/contracts/content';
import { rules } from '../../src/game';

describe('format', () => {
  it('clamps and divides safely', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(fraction(5, 10)).toBe(0.5);
    expect(fraction(5, 0)).toBe(0);
    expect(fraction(20, 10)).toBe(1);
  });

  it('formats integers, durations and cooldowns', () => {
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(-4321.4)).toBe('-4,321');
    expect(formatDuration(67)).toBe('1:07');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('0:00');
    expect(formatCooldown(0)).toBe('');
    expect(formatCooldown(3.14)).toBe('3.1');
    expect(formatCooldown(12.2)).toBe('13');
  });

  it('formats signed deltas and personal luck with a true minus sign', () => {
    expect(formatSigned(3)).toBe('+3');
    expect(formatSigned(-2.5, 1)).toBe('−2.5');
    expect(formatSigned(0)).toBe('0');
    expect(formatLuck(164)).toBe('+64%');
    expect(formatLuck(100)).toBe('+0%');
    expect(formatLuck(90)).toBe('−10%');
  });

  it('builds possessives and quality buckets', () => {
    expect(possessive('Mira')).toBe("Mira's");
    expect(possessive('Aris')).toBe("Aris'");
    expect(pingQuality(40)).toBe('good');
    expect(pingQuality(120)).toBe('fair');
    expect(pingQuality(400)).toBe('poor');
  });

  it('formats chat clock times', () => {
    expect(formatClock(Number.NaN)).toBe('');
    expect(formatClock(new Date(2026, 0, 1, 9, 5).getTime())).toBe('09:05');
  });
});

describe('zone labels', () => {
  it('names own and visited hideouts and maps', () => {
    expect(zoneLabel({ zone: 'hideout', zoneOwnerName: 'Ash', zoneIsOwn: true, run: null }).title).toBe('Your Hideout');
    const visit = zoneLabel({ zone: 'hideout', zoneOwnerName: 'Mira', zoneIsOwn: false, run: null });
    expect(visit.title).toBe("Mira's Hideout");
    const own = zoneLabel({ zone: 'map', zoneOwnerName: 'Ash', zoneIsOwn: true, run: { mapName: 'Ashen Forge', tier: 3 } });
    expect(own).toMatchObject({ title: 'Ashen Forge', subtitle: 'Tier 3' });
    const theirs = zoneLabel({ zone: 'map', zoneOwnerName: 'Mira', zoneIsOwn: false, run: { mapName: 'Ashen Forge', tier: 3 } });
    expect(theirs.subtitle).toBe("Tier 3 · Mira's map");
    expect(theirs.key).not.toBe(own.key);
  });
});

describe('panels', () => {
  it('anchors inventory right, modals centred and the rest left', () => {
    expect(panelSide('inventory')).toBe('right');
    expect(panelSide('menu')).toBe('modal');
    expect(panelSide('stash')).toBe('left');
    expect(visiblePanels(['character', 'inventory', 'skills'])).toEqual({ left: 'skills', right: 'inventory', modal: null });
  });

  it('closes the newest visible panel first, modal before docked panels', () => {
    expect(topPanel(['inventory', 'character'])).toBe('character');
    expect(topPanel(['character', 'inventory'])).toBe('inventory');
    expect(topPanel(['inventory', 'menu', 'character'])).toBe('menu');
    expect(topPanel([])).toBeNull();
  });

  it('lets Esc reach a visible trade window first, whichever of trade / inventory opened last', () => {
    // A trade opens its window and pulls the inventory in after it; the inventory may also have been open already.
    expect(escapePanel(['trade', 'inventory'])).toBe('trade');
    expect(escapePanel(['inventory', 'trade'])).toBe('trade');
    // Modals still come first; without a visible trade window Esc closes the top panel as before.
    expect(escapePanel(['trade', 'inventory', 'help'])).toBe('help');
    expect(escapePanel(['stash', 'inventory'])).toBe('inventory');
    expect(escapePanel(['inventory', 'character'])).toBe('character');
    expect(escapePanel([])).toBeNull();
    const ctx: EscapeContext = {
      dragging: false,
      dialog: false,
      affixChoice: false,
      armed: false,
      chatOpen: false,
      runSummary: false,
      topPanel: escapePanel(['trade', 'inventory']),
    };
    expect(escapeStep(ctx)).toEqual({ kind: 'closePanel', panel: 'trade' });
  });

  it('keeps one left panel and pairs stash / merchant / map device with the inventory', () => {
    expect(panelFixups([], ['character', 'skills'])).toEqual({ open: [], close: ['character'] });
    expect(panelFixups([], ['stash'])).toEqual({ open: ['inventory'], close: [] });
    // the player closed the inventory under the stash: the stash goes too
    expect(panelFixups(['stash', 'inventory'], ['stash'])).toEqual({ open: [], close: ['stash'] });
    expect(panelFixups(['inventory'], ['inventory', 'merchant'])).toEqual({ open: [], close: [] });
    expect(panelFixups([], ['party'])).toEqual({ open: [], close: [] });
    // The crafting bench and the trade window work with the inventory next to them.
    expect(panelSide('craftingBench')).toBe('left');
    expect(panelSide('trade')).toBe('left');
    expect(panelFixups([], ['craftingBench'])).toEqual({ open: ['inventory'], close: [] });
    expect(panelFixups(['inventory'], ['inventory', 'trade'])).toEqual({ open: [], close: [] });
    expect(panelFixups(['trade', 'inventory'], ['trade'])).toEqual({ open: [], close: ['trade'] });
    expect(panelFixups(['inventory', 'trade'], ['inventory', 'trade', 'character'])).toEqual({ open: [], close: ['trade'] });
  });
});

describe('keyboard', () => {
  it('maps panel keys, chat and escape', () => {
    expect(keyCommand({ key: 'i' }, false)).toEqual({ kind: 'toggle', panel: 'inventory' });
    expect(keyCommand({ key: 'C' }, false)).toEqual({ kind: 'toggle', panel: 'character' });
    expect(keyCommand({ key: 'k' }, false)).toEqual({ kind: 'toggle', panel: 'skills' });
    expect(keyCommand({ key: 'p' }, false)).toEqual({ kind: 'toggle', panel: 'party' });
    expect(keyCommand({ key: 'Enter' }, false)).toEqual({ kind: 'chat' });
    expect(keyCommand({ key: 'Escape' }, false)).toEqual({ kind: 'escape' });
  });

  it('ignores keys while typing (except Escape), with modifiers and on repeat', () => {
    expect(keyCommand({ key: 'i' }, true)).toBeNull();
    expect(keyCommand({ key: 'Enter' }, true)).toBeNull();
    expect(keyCommand({ key: 'Escape' }, true)).toEqual({ kind: 'escape' });
    expect(keyCommand({ key: 'i', ctrlKey: true }, false)).toBeNull();
    expect(keyCommand({ key: 'c', metaKey: true }, false)).toBeNull();
    // Ctrl/⌘+F searches the stash, even from inside a text field.
    expect(keyCommand({ key: 'f', ctrlKey: true }, false)).toEqual({ kind: 'search' });
    expect(keyCommand({ key: 'F', metaKey: true }, true)).toEqual({ kind: 'search' });
    expect(keyCommand({ key: 'f', ctrlKey: true, altKey: true }, false)).toBeNull();
    expect(keyCommand({ key: 'f' }, false)).toBeNull();
    expect(keyCommand({ key: 'i', repeat: true }, false)).toBeNull();
    expect(keyCommand({ key: 'w' }, false)).toBeNull();
  });

  it('recognises text-entry targets', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false);
  });

  it('runs the Esc chain from the most transient state to the menu', () => {
    const none: EscapeContext = {
      dragging: false,
      dialog: false,
      affixChoice: false,
      armed: false,
      chatOpen: false,
      runSummary: false,
      topPanel: null,
    };
    expect(escapeStep(none)).toEqual({ kind: 'openMenu' });
    expect(escapeStep({ ...none, topPanel: 'inventory' })).toEqual({ kind: 'closePanel', panel: 'inventory' });
    expect(escapeStep({ ...none, topPanel: 'inventory', armed: true })).toEqual({ kind: 'disarm' });
    expect(escapeStep({ ...none, armed: true, affixChoice: true })).toEqual({ kind: 'cancelAffix' });
    expect(escapeStep({ ...none, chatOpen: true, runSummary: true })).toEqual({ kind: 'closeChat' });
    expect(escapeStep({ ...none, runSummary: true, topPanel: 'skills' })).toEqual({ kind: 'dismissSummary' });
    expect(escapeStep({ ...none, dragging: true, dialog: true })).toEqual({ kind: 'cancelDrag' });
  });

  it('recognises clickable controls that must not keep focus in game', () => {
    const el = (tagName: string, type?: string) => ({ tagName, type }) as unknown as EventTarget;
    expect(isControlTarget(el('BUTTON'))).toBe(true);
    expect(isControlTarget(el('INPUT', 'range'))).toBe(true);
    expect(isControlTarget(el('INPUT', 'checkbox'))).toBe(true);
    expect(isControlTarget(el('INPUT', 'submit'))).toBe(true);
    expect(isControlTarget(el('INPUT', 'text'))).toBe(false);
    expect(isControlTarget(el('DIV'))).toBe(false);
    expect(isControlTarget(null)).toBe(false);
    expect(isActivationKey(' ')).toBe(true);
    expect(isActivationKey('Enter')).toBe(true);
    expect(isActivationKey('q')).toBe(false);
  });

  it('lets only Esc through while a modal owns the keyboard', () => {
    const toggle = keyCommand({ key: 'i' }, false);
    const chat = keyCommand({ key: 'Enter' }, false);
    const esc = keyCommand({ key: 'Escape' }, false);
    expect(keyAllowedWhile(toggle, false)).toBe(true);
    expect(keyAllowedWhile(chat, false)).toBe(true);
    expect(keyAllowedWhile(toggle, true)).toBe(false);
    expect(keyAllowedWhile(chat, true)).toBe(false);
    expect(keyAllowedWhile(esc, true)).toBe(true);
    expect(keyAllowedWhile(null, false)).toBe(false);
  });
});

describe('crafting clicks', () => {
  it('applies once per click unless Shift is held or an affix must be chosen', () => {
    expect(keepArmedAfterApply(false, false)).toBe(false);
    expect(keepArmedAfterApply(true, false)).toBe(true);
    expect(keepArmedAfterApply(false, true)).toBe(true);
  });

  it('holds further clicks on an item until the server answered the craft on it', () => {
    const ch = { id: 'a' };
    const pending = { target: 'it-1', character: ch, at: 1000 };
    expect(craftPending(null, 'it-1', ch, 1000)).toBe(false);
    // Double-click: same item, same (stale) character, a few ms later.
    expect(craftPending(pending, 'it-1', ch, 1080)).toBe(true);
    // A different item is fine; so is the same item once a new character arrived.
    expect(craftPending(pending, 'it-2', ch, 1080)).toBe(false);
    expect(craftPending(pending, 'it-1', { id: 'a' }, 1080)).toBe(false);
    // A rejected command never changes the character: the hold times out.
    expect(craftPending(pending, 'it-1', ch, 1000 + CRAFT_PENDING_MS)).toBe(false);
  });
});

describe('grid geometry', () => {
  const rect = { left: 100, top: 50, width: 480, height: 200 };
  const grid = { w: 12, h: 5 };

  it('finds the cell under a point', () => {
    expect(cellAt(100, 50, rect, grid)).toEqual({ x: 0, y: 0 });
    expect(cellAt(579, 249, rect, grid)).toEqual({ x: 11, y: 4 });
    expect(cellAt(99, 60, rect, grid)).toBeNull();
    expect(cellAt(300, 250, rect, grid)).toBeNull();
  });

  it('keeps the grabbed cell under the pointer and clamps the footprint into the grid', () => {
    expect(grabCell(45, 90, 40, { w: 2, h: 3 })).toEqual({ x: 1, y: 2 });
    expect(grabCell(500, -3, 40, { w: 2, h: 3 })).toEqual({ x: 1, y: 0 });
    expect(placementOrigin({ x: 5, y: 3 }, { x: 1, y: 2 }, { w: 2, h: 3 }, grid)).toEqual({ x: 4, y: 1 });
    expect(placementOrigin({ x: 11, y: 4 }, { x: 0, y: 0 }, { w: 2, h: 3 }, grid)).toEqual({ x: 10, y: 2 });
    expect(placementOrigin({ x: 0, y: 0 }, { x: 1, y: 2 }, { w: 2, h: 3 }, grid)).toEqual({ x: 0, y: 0 });
  });

  it('lays the paperdoll out without overlaps inside its box', () => {
    const boxes = EQUIP_SLOTS.map((s) => ({ slot: s, ...PAPERDOLL[s] }));
    for (const a of boxes) {
      expect(a.x + a.w).toBeLessThanOrEqual(PAPERDOLL_SIZE.w);
      expect(a.y + a.h).toBeLessThanOrEqual(PAPERDOLL_SIZE.h);
      for (const b of boxes) {
        if (a === b) continue;
        const hit = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(hit, `${a.slot} overlaps ${b.slot}`).toBe(false);
      }
    }
  });
});

describe('item facts', () => {
  const wand: EquipmentItem = {
    kind: 'equipment',
    uid: 'e1',
    baseId: 'ashwoodWand',
    itemLevel: 3,
    rarity: 'magic',
    name: null,
    implicitValues: [14],
    affixes: [],
    scars: [],
    stability: 8,
    maxStability: 8,
    history: ['Dropped'],
  };
  const scrap: CurrencyStack = { kind: 'currency', uid: 'c1', currencyId: 'scrap', count: 7 };
  const map: MapItem = { kind: 'map', uid: 'm1', baseId: 'ashenForge', tier: 1, rarity: 'normal', mods: [], quality: 0, corrupted: false };

  it('derives tone, icon and stack count', () => {
    expect(itemTone(wand)).toBe('magic');
    expect(itemTone(scrap)).toBe('currency');
    expect(itemTone(map)).toBe('map');
    expect(itemTone({ ...map, rarity: 'rare' })).toBe('rare');
    expect(itemIconId(wand)).toBe('icon/base/ashwoodWand');
    expect(itemIconId({ ...wand, uniqueId: 'thePatientSpark' })).toBe('icon/unique/thePatientSpark');
    expect(itemIconId(scrap)).toBe('icon/currency/scrap');
    expect(itemIconId(map)).toBe('icon/map/ashenForge');
    expect(stackCount(scrap)).toBe(7);
    expect(stackCount(wand)).toBeNull();
  });

  it('compares and keys locations', () => {
    expect(sameLocation({ kind: 'backpack', x: 1, y: 2 }, { kind: 'backpack', x: 1, y: 2 })).toBe(true);
    expect(sameLocation({ kind: 'backpack', x: 1, y: 2 }, { kind: 'stash', tab: 0, x: 1, y: 2 })).toBe(false);
    expect(sameLocation({ kind: 'equipment', slot: 'ring1' }, { kind: 'equipment', slot: 'ring2' })).toBe(false);
    expect(sameLocation({ kind: 'mapDevice' }, { kind: 'mapDevice' })).toBe(true);
    expect(locationKey({ kind: 'stash', tab: 2, x: 3, y: 4 })).toBe('stash:2:3:4');
    expect(locationKey({ kind: 'belt', index: 1 })).toBe('belt:1');
  });
});

describe('validation', () => {
  it('mirrors the server rules for accounts and characters', () => {
    expect(usernameError('ab')).toMatch(/at least 3/);
    expect(usernameError('bad name')).toMatch(/letters, digits/);
    expect(usernameError('good_name1')).toBeNull();
    expect(usernameError('x'.repeat(21))).toMatch(/at most 20/);
    expect(passwordError('short')).toMatch(/at least 8/);
    expect(passwordError('long enough')).toBeNull();
    expect(characterNameError('Mi')).toMatch(/at least 3/);
    expect(characterNameError('Ashveil')).toBeNull();
    expect(characterNameError("Ash-veil O'Neil")).toBeNull();
    expect(characterNameError('9lives')).toMatch(/Start with a letter/);
    expect(characterNameError('x'.repeat(17))).toMatch(/at most 16/);
  });
});

describe('party wording', () => {
  const member = (over: Partial<PartyMemberInfo>): PartyMemberInfo => ({
    characterId: 'c',
    name: 'Mira',
    level: 10,
    online: true,
    isLeader: false,
    zone: null,
    activeMap: null,
    ...over,
  });

  it('describes where members are from the reader’s point of view', () => {
    expect(locationText(member({ online: false }), 'Ash')).toBe('Offline');
    expect(locationText(member({}), 'Ash')).toBe('Travelling');
    expect(locationText(member({ zone: { kind: 'hideout', ownerName: 'Mira' } }), 'Ash')).toBe('In their hideout');
    expect(locationText(member({ name: 'Ash', zone: { kind: 'hideout', ownerName: 'Ash' } }), 'Ash')).toBe('In your hideout');
    expect(locationText(member({ zone: { kind: 'hideout', ownerName: 'Ash' } }), 'Ash')).toBe('Visiting your hideout');
    expect(locationText(member({ zone: { kind: 'hideout', ownerName: 'Corvin' } }), 'Ash')).toBe("In Corvin's hideout");
    expect(locationText(member({ zone: { kind: 'map', ownerName: 'Mira', mapName: 'Ashen Forge', tier: 3 } }), 'Ash')).toBe(
      'Ashen Forge T3',
    );
    expect(locationText(member({ zone: { kind: 'map', ownerName: 'Corvin', mapName: 'Ashen Forge', tier: 3 } }), 'Ash')).toBe(
      "Ashen Forge T3, Corvin's map",
    );
  });
});

describe('skill tree layout', () => {
  const skills = Object.values(rules.content.skills) as SkillInfo[];
  const tree = layoutSkillTree(skills);

  it('places every skill once, branches left to right', () => {
    expect(tree.nodes.map((n) => n.id).sort()).toEqual(skills.map((s) => s.id).sort());
    expect(tree.branches.map((b) => b.branch)).toEqual(['basic', 'destruction', 'mobility', 'survival']);
    expect(tree.rows).toBe(Math.max(...skills.map((s) => s.tier)));
    for (const b of tree.branches) {
      for (const n of tree.nodes.filter((x) => skills.find((s) => s.id === x.id)!.branch === b.branch)) {
        expect(n.x).toBeGreaterThan(b.start);
        expect(n.x).toBeLessThan(b.start + b.width);
      }
    }
  });

  it('puts prerequisites above their dependants and draws an edge for each', () => {
    for (const s of skills) {
      if (!s.prerequisite) continue;
      const a = tree.nodes.find((n) => n.id === s.prerequisite!.skillId)!;
      const b = tree.nodes.find((n) => n.id === s.id)!;
      expect(a.y).toBeLessThan(b.y);
      expect(tree.edges).toContainEqual({ from: s.prerequisite.skillId, to: s.id, rank: s.prerequisite.rank });
    }
  });

  it('stacks a lone dependant straight under its prerequisite', () => {
    const synthetic: SkillInfo[] = [
      { ...skills[0], id: 'emberNova', branch: 'destruction', tier: 1, prerequisite: null },
      { ...skills[0], id: 'rimeShards', branch: 'destruction', tier: 2, prerequisite: null },
      { ...skills[0], id: 'flameWave', branch: 'destruction', tier: 2, prerequisite: null },
      { ...skills[0], id: 'arcChain', branch: 'destruction', tier: 3, prerequisite: { skillId: 'flameWave', rank: 5 } },
    ];
    const t = layoutSkillTree(synthetic);
    const arc = t.nodes.find((n) => n.id === 'arcChain')!;
    const wave = t.nodes.find((n) => n.id === 'flameWave')!;
    expect(arc.x).toBe(wave.x);
  });
});
