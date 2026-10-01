import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { resolveStat, resolveStatBreakdown } from '../src/core/modifiers';

describe('rng', () => {
  it('is deterministic and resumable', () => {
    const a = createRng(42);
    const seq = [a.next(), a.next(), a.next()];
    const b = createRng(42);
    expect([b.next(), b.next(), b.next()]).toEqual(seq);
    const c = createRng(a.state());
    const d = createRng(a.state());
    expect(c.int(0, 1000)).toBe(d.int(0, 1000));
  });
  it('weighted respects zero weights', () => {
    const r = createRng(1);
    for (let i = 0; i < 200; i++) expect(r.weighted(['a', 'b'], (x) => (x === 'a' ? 0 : 1))).toBe('b');
  });
});

describe('modifiers', () => {
  it('resolves flat, increased, more', () => {
    const v = resolveStat(100, [
      { stat: 'maxLife', mode: 'flat', value: 20, source: 'x' },
      { stat: 'maxLife', mode: 'increased', value: 50, source: 'x' },
      { stat: 'maxLife', mode: 'more', value: 10, source: 'x' },
    ]);
    expect(v).toBeCloseTo(120 * 1.5 * 1.1);
    const b = resolveStatBreakdown('maxLife', 100, [{ stat: 'maxLife', mode: 'flat', value: 5, source: 's' }, { stat: 'armor', mode: 'flat', value: 5, source: 's' }]);
    expect(b.value).toBe(105);
    expect(b.sources).toHaveLength(1);
  });
});
