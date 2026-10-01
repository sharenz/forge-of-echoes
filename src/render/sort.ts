// Y-sort support (pure): u32 sort keys and a stable LSD radix sort over instance indices. Stable ordering matters —
// equal sortY values keep submission order, so overlapping sprites never flicker between frames.

const KEY_SUBPIXEL = 4; // sortY resolution: 1/4 world unit
const KEY_BIAS = 2 ** 31;

/** Map a world-space sortY to an order-preserving u32. */
export function sortKey(sortY: number): number {
  const k = Math.floor(sortY * KEY_SUBPIXEL) + KEY_BIAS;
  if (!(k > 0)) return 0; // also catches NaN
  return k >= 4294967295 ? 4294967295 : k;
}

const counts = new Uint32Array(256);

/**
 * Stable radix sort of indices 0..n-1 by `keys` (ascending). `a` and `b` are scratch arrays of length >= n; the
 * returned array (one of them) holds the sorted indices. Byte passes where every key shares the same value are
 * skipped, so typical frames (keys within a few thousand units) cost two passes.
 */
export function radixSortIndices(keys: Uint32Array, n: number, a: Uint32Array, b: Uint32Array): Uint32Array {
  let src = a;
  let dst = b;
  for (let i = 0; i < n; i++) src[i] = i;
  if (n < 2) return src;
  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[(keys[i] >>> shift) & 255]++;
    // Skip passes that would not reorder anything (all keys share this byte).
    if (counts[(keys[0] >>> shift) & 255] === n) continue;
    let sum = 0;
    for (let d = 0; d < 256; d++) {
      const c = counts[d];
      counts[d] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const idx = src[i];
      dst[counts[(keys[idx] >>> shift) & 255]++] = idx;
    }
    const t = src;
    src = dst;
    dst = t;
  }
  return src;
}
