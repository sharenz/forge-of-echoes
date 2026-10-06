// The copy lint (docs/onboarding-ux.md 6.8): bodies are short, every {param} is a known slot, no retired names, the glossary is bounded.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_HINT_IDS, GUIDE_STEP_IDS } from '../../src/contracts/guide';
import { GLOSSARY, GUIDE_EN, allStrings, fill, gt, paramsOf } from '../../src/data/guide/strings';

const KNOWN = new Set(['area', 'portals', 'boss', 'wave', 'waves', 'name', 'count', 'what', 'key', 'done', 'total', 'portalWord']);

describe('guide strings', () => {
  it('has a title and a body for every tracked step', () => {
    for (const id of GUIDE_STEP_IDS) if (id !== 'next') {
      expect(GUIDE_EN.steps[id].title.length).toBeGreaterThan(0);
      expect(GUIDE_EN.steps[id].body.length).toBeGreaterThan(0);
    }
  });
  it('has a hint text for every hint id', () => {
    for (const id of GUIDE_HINT_IDS) expect(GUIDE_EN.hints[id].length).toBeGreaterThan(0);
  });
  it('keeps every step and hint body to 90 characters or fewer', () => {
    for (const [id, t] of Object.entries(GUIDE_EN.steps)) expect(t.body.length, id).toBeLessThanOrEqual(90);
    for (const [id, t] of Object.entries(GUIDE_EN.retry)) expect(t.body.length, id).toBeLessThanOrEqual(90);
    for (const [id, t] of Object.entries(GUIDE_EN.hints)) expect(t.length, id).toBeLessThanOrEqual(95);
  });
  it('uses only known {params}', () => {
    for (const { path, text } of allStrings()) for (const p of paramsOf(text)) expect(KNOWN.has(p), `${path}: {${p}}`).toBe(true);
  });
  it('interpolates and never concatenates', () => {
    expect(gt('steps.area.title', { area: 'Cinder Crossing' })).toBe('Pick Cinder Crossing');
    expect(fill('{a} and {a}', { a: 'x' })).toBe('x and x');
    expect(gt('nope.nothing')).toBe('nope.nothing');
  });
  it('retires "Cartography Table" and "Ember Chart"', () => {
    for (const { path, text } of allStrings()) expect(/cartography table|ember chart/i.test(text), path).toBe(false);
  });
  it('keeps the glossary bounded and complete', () => {
    expect(GLOSSARY.length).toBeLessThanOrEqual(20);
    for (const g of GLOSSARY) {
      expect(g.term.length).toBeLessThanOrEqual(24);
      expect(g.def.length).toBeLessThanOrEqual(160);
    }
    const ids = GLOSSARY.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const need of ['life', 'focus', 'resistance', 'armour', 'evasion', 'stability', 'affix', 'maptier', 'area', 'surge', 'scarab', 'pin', 'quality']) expect(ids).toContain(need);
  });
});

describe('player-facing text across the UI', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(n) ? [p] : [];
  });
  it('no longer says "Cartography Table" or "Ember Chart" in the UI (the object is the Map Device, its chart the Atlas)', () => {
    const offenders: string[] = [];
    for (const f of walk(join(__dirname, '..', '..', 'src', 'ui'))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/Cartography Table|Ember Chart/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('suggested names', () => {
  it('are pronounceable letters within the character name rules (3 to 16 letters), whatever the dice say', async () => {
    const { suggestName } = await import('../../src/data/guide/strings');
    for (const roll of [0, 0.25, 0.5, 0.99, 0.999999]) {
      const name = suggestName(() => roll);
      expect(name).toMatch(/^[A-Za-z]{3,16}$/);
    }
    const seen = new Set(Array.from({ length: 200 }, () => suggestName()));
    expect(seen.size).toBeGreaterThan(30);
  });
});
