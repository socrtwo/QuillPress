/**
 * Byte-level helpers for the QuarkXPress 3.1–4.1 reader: a bounds-checked binary reader in either
 * byte order, the 256-byte block store the files are made of, and the light obfuscation that hides
 * the object headers.
 *
 * The file is a sequence of 256-byte blocks numbered from 1. A chain starts at a block and ends with
 * a 4-byte signed pointer to the next block: a positive pointer names a single block, a negative one
 * names a "big" block whose first two bytes count how many consecutive blocks it spans. Block 3 holds
 * the document chain (records, then pages and objects); each text story has a chain of its own that
 * lists the blocks holding its characters.
 *
 * Written from a description of the format (see src/io/qxp/index.ts); no reader code was copied.
 */

export class EndOfData extends Error {
  constructor() { super('Unexpected end of data'); }
}

/** Reads integers, 16.16 fractions and strings from a byte array, throwing at the end. */
export class Reader {
  pos = 0;
  constructor(public b: Uint8Array, public be: boolean) {}

  get length(): number { return this.b.length; }
  get remaining(): number { return Math.max(0, this.b.length - this.pos); }
  seek(p: number): void { if (p < 0 || p > this.b.length) throw new EndOfData(); this.pos = p; }
  skip(n: number): void { this.seek(this.pos + n); }
  private need(n: number): number { if (this.pos + n > this.b.length) throw new EndOfData(); const p = this.pos; this.pos += n; return p; }

  u8(): number { return this.b[this.need(1)]; }
  u16(): number { const p = this.need(2); return this.be ? (this.b[p] << 8) | this.b[p + 1] : this.b[p] | (this.b[p + 1] << 8); }
  i16(): number { return (this.u16() << 16) >> 16; }
  u32(): number { const p = this.need(4); return (this.be ? (this.b[p] << 24) | (this.b[p + 1] << 16) | (this.b[p + 2] << 8) | this.b[p + 3] : this.b[p] | (this.b[p + 1] << 8) | (this.b[p + 2] << 16) | (this.b[p + 3] << 24)) >>> 0; }
  i32(): number { return this.u32() | 0; }
  /** Signed 16.16 fixed-point number (points, angles, scales). */
  fraction(): number { return this.i32() / 65536; }
  /** Unsigned 0.16 fixed-point number (0..1). */
  float16(): number { return this.u16() / 65536; }
  /** A color component stored as a 0.16 fraction, as 0..255. */
  colorComp(): number { return Math.round(255 * this.float16()); }
  bytes(n: number): Uint8Array { const p = this.need(n); return this.b.subarray(p, p + n); }
  /** Zero-terminated string (Windows files). */
  cString(): string { let s = ''; for (;;) { const c = this.u8(); if (!c) break; s += String.fromCharCode(c); } return s; }
  /** Length-prefixed string (Mac files). */
  pascalString(): string { const n = this.u8(); return String.fromCharCode(...this.bytes(n)); }
  /** The string form of the file's platform: Pascal on Mac, C on Windows. */
  platformString(): string { return this.be ? this.pascalString() : this.cString(); }
}

export const BLOCK_SIZE = 256;

/** The last block number a file of this length can hold (blocks are numbered from 1). */
export function lastBlockOf(data: Uint8Array): number { return data.length > 0 ? Math.floor(data.length / BLOCK_SIZE) + 1 : 0; }

/** One raw 256-byte block (shorter at the end of the file), or null when the index is out of range. */
export function getBlock(data: Uint8Array, index: number): Uint8Array | null {
  if (index <= 0 || index > lastBlockOf(data)) return null;
  const start = (index - 1) * BLOCK_SIZE;
  if (start >= data.length) return null;
  return data.subarray(start, Math.min(data.length, start + BLOCK_SIZE));
}

/**
 * The payload of a block chain starting at the given block, with the pointers removed. A cycle or a
 * truncated file ends the chain early; what was read so far is returned.
 */
export function getChain(data: Uint8Array, index: number, be: boolean): Uint8Array {
  const last = lastBlockOf(data);
  const parts: Uint8Array[] = [];
  const visited = new Set<number>();
  let next = index;
  let big = false;
  let total = 0;
  while (next > 0 && next <= last) {
    let pos = (next - 1) * BLOCK_SIZE;
    let count = 1;
    if (big) {
      if (pos + 2 > data.length) break;
      count = be ? (data[pos] << 8) | data[pos + 1] : data[pos] | (data[pos + 1] << 8);
      pos += 2;
    }
    if (count > last - next) count = last - next;
    let stop = false;
    for (let i = next - 1; i < next - 1 + count; i++) {
      if (visited.has(i)) { stop = true; count = i - (next - 1); break; }
      visited.add(i);
    }
    if (count <= 0) break;
    const end = (next - 1 + count) * BLOCK_SIZE - 4;
    const len = end - pos;
    if (len <= 0) break;
    const avail = Math.max(0, Math.min(len, data.length - pos));
    if (avail > 0) { parts.push(data.subarray(pos, pos + avail)); total += avail; }
    if (stop || avail < len || end + 4 > data.length) break;
    const r = new Reader(data, be);
    r.seek(end);
    const ptr = r.i32();
    big = ptr < 0;
    next = Math.abs(ptr);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------------------------------
// Obfuscation of the object headers

const u16 = (v: number) => v & 0xffff;

/** Fills the low bits of `value` up to the first set bit, limited to `shift` bits, under `mask`. */
function fillBits(value: number, shift: number, mask: number): number {
  let r = shift;
  let v = value;
  while ((v & 1) === 0 && r > 0) { v >>= 1; r--; }
  const s = shift - r;
  const m = u16((0xffff >> s) << s);
  return (value | m) & mask;
}

/** Rotates a 16-bit value right by `count` bits, filling the vacated high bits. */
export function shiftBits(value: number, count: number): number {
  if (count === 0) return u16(value);
  const mask = 0xffff >> (16 - count);
  const high = fillBits((value & mask) | (value >> 15), count, mask);
  return u16((high << (16 - count)) | (value >> count));
}

/**
 * The running key that hides object headers. QuarkXPress 3.x advances the key by a fixed increment
 * after every object; 4.x also rotates the increment by the object's content index and rotates the
 * key by the content type, and steps it backwards once per page.
 */
export class Deobfuscator {
  constructor(public seed: number, public increment: number) { this.seed = u16(seed); this.increment = u16(increment); }
  /** Decodes a 16-bit value. */
  value(v: number): number { v = u16(v); return u16(v + this.seed - ((v & this.seed) << 1)); }
  /** Decodes a byte. */
  byte(v: number): number { return this.value(v & 0xff) & 0xff; }
  /** 3.x: next object. */
  next33(): void { this.seed = u16(this.seed + this.increment); }
  /** 4.x: next object, keyed by its content index. */
  next4(block: number): void { this.seed = u16(this.seed + this.increment); this.increment = shiftBits(this.increment, block & 0xf); }
  /** 4.x: start of a page. */
  nextRev(): void { this.seed = u16(this.seed + 0xffff - this.increment); }
  /** 4.x: after the content type byte. */
  nextShift(count: number): void { this.seed = shiftBits(this.seed, count & 0xf); }
}
