// Little-endian binary writer/reader used by the snapshot codec.
//  - ByteWriter keeps one growable buffer for its whole life (no per-message garbage besides the final copy).
//  - ByteReader bounds-checks every read and throws SnapshotDecodeError on truncated/garbage input.
//  - StringInterner turns repeated UTF-8 strings (names, drop labels, icon ids) into the same JS string
//    without re-decoding them 30 times a second.

export class SnapshotDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotDecodeError';
  }
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

/** Maximum encoded byte length of one wire string (u8 length prefix). */
export const MAX_STRING_BYTES = 255;

export class ByteWriter {
  private buf: ArrayBuffer;
  private bytes: Uint8Array;
  private dv: DataView;
  pos = 0;

  constructor(initialCapacity = 16 * 1024) {
    this.buf = new ArrayBuffer(initialCapacity);
    this.bytes = new Uint8Array(this.buf);
    this.dv = new DataView(this.buf);
  }

  reset(): void {
    this.pos = 0;
  }

  /** Make room for `n` more bytes (doubling growth; the old contents are kept). */
  ensure(n: number): void {
    const need = this.pos + n;
    if (need <= this.bytes.length) return;
    let cap = this.bytes.length * 2;
    while (cap < need) cap *= 2;
    const next = new ArrayBuffer(cap);
    const nextBytes = new Uint8Array(next);
    nextBytes.set(this.bytes.subarray(0, this.pos));
    this.buf = next;
    this.bytes = nextBytes;
    this.dv = new DataView(next);
  }

  u8(v: number): void {
    this.ensure(1);
    this.bytes[this.pos++] = v & 0xff;
  }

  u16(v: number): void {
    this.ensure(2);
    this.dv.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }

  i16(v: number): void {
    this.ensure(2);
    this.dv.setInt16(this.pos, v, true);
    this.pos += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.dv.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.dv.setFloat32(this.pos, Number.isFinite(v) ? v : 0, true);
    this.pos += 4;
  }

  /** u8 byte length + UTF-8 bytes, truncated to MAX_STRING_BYTES on a character boundary. */
  str(s: string): void {
    this.ensure(1 + MAX_STRING_BYTES);
    const start = this.pos + 1;
    const len = s.length;
    // ASCII fast path (almost every label/id); falls back to encodeInto on the first non-ASCII code unit.
    if (len <= MAX_STRING_BYTES) {
      let k = 0;
      for (; k < len; k++) {
        const c = s.charCodeAt(k);
        if (c >= 0x80) break;
        this.bytes[start + k] = c;
      }
      if (k === len) {
        this.bytes[this.pos] = len;
        this.pos = start + len;
        return;
      }
    }
    const { written } = utf8Encoder.encodeInto(s, this.bytes.subarray(start, start + MAX_STRING_BYTES));
    this.bytes[this.pos] = written;
    this.pos = start + written;
  }

  /** Overwrite a previously written u8/u16 (section counts are patched after culling). */
  patchU8(at: number, v: number): void {
    this.bytes[at] = v & 0xff;
  }

  patchU16(at: number, v: number): void {
    this.dv.setUint16(at, v & 0xffff, true);
  }

  /** A standalone copy of the written bytes (the internal buffer is reused by the next message). */
  finish(): ArrayBuffer {
    return this.buf.slice(0, this.pos);
  }
}

export class ByteReader {
  private bytes: Uint8Array = new Uint8Array(0);
  private dv: DataView = new DataView(new ArrayBuffer(0));
  pos = 0;
  end = 0;

  reset(data: ArrayBuffer | ArrayBufferView): void {
    if (ArrayBuffer.isView(data)) {
      this.bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.bytes = new Uint8Array(data);
      this.dv = new DataView(data);
    }
    this.pos = 0;
    this.end = this.bytes.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.end) throw new SnapshotDecodeError(`truncated snapshot at byte ${this.pos} (+${n})`);
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.pos++];
  }

  u16(): number {
    this.need(2);
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    if (!Number.isFinite(v)) throw new SnapshotDecodeError(`non-finite float at byte ${this.pos - 4}`);
    return v;
  }

  str(interner: StringInterner): string {
    const len = this.u8();
    this.need(len);
    const s = interner.read(this.bytes, this.pos, len);
    this.pos += len;
    return s;
  }
}

interface InternEntry {
  bytes: Uint8Array;
  value: string;
}

/** Cache of decoded wire strings keyed by their bytes (bounded; cleared when it grows too large). */
export class StringInterner {
  private readonly table = new Map<number, InternEntry>();
  private readonly limit: number;

  constructor(limit = 2048) {
    this.limit = limit;
  }

  read(src: Uint8Array, at: number, len: number): string {
    if (len === 0) return '';
    let h = 0x811c9dc5 ^ len;
    for (let k = 0; k < len; k++) {
      h ^= src[at + k];
      h = Math.imul(h, 0x01000193);
    }
    h >>>= 0;
    const hit = this.table.get(h);
    if (hit && hit.bytes.length === len) {
      let same = true;
      for (let k = 0; k < len; k++) {
        if (hit.bytes[k] !== src[at + k]) {
          same = false;
          break;
        }
      }
      if (same) return hit.value;
    }
    const copy = src.slice(at, at + len);
    const value = utf8Decoder.decode(copy);
    if (this.table.size >= this.limit) this.table.clear();
    this.table.set(h, { bytes: copy, value });
    return value;
  }
}
