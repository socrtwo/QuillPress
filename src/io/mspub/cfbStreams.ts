/**
 * Access to the streams of a Microsoft Publisher compound file and a bounds-checked little-endian
 * reader shared by the Publisher parsers.
 *
 * A publication keeps its layout in the "Contents" stream, its text in "Quill/QuillSub/CONTENTS"
 * (Publisher 2000 and later) and its drawing layer in "Escher/EscherStm" with the pictures in
 * "Escher/EscherDelayStm" (2002 and later). The first bytes of "Contents" identify the version.
 * Written from the format description of the Document Liberation Project's Publisher reader.
 */
import { openCfb, type Cfb, type CfbEntry } from '../cfb';

export type PubVersion = '2002' | '2000' | '97' | 'unknown';

export interface PubStreams {
  cfb: Cfb;
  version: PubVersion;
  contents: Uint8Array | null;
  quill: Uint8Array | null;
  escher: Uint8Array | null;
  escherDelay: Uint8Array | null;
}

/** Finds a stream by path, or by its last name component when the storages are laid out differently. */
function findStream(cfb: Cfb, path: string): Uint8Array | null {
  const direct = cfb.read(path);
  if (direct) return direct;
  const parts = path.split('/');
  const leaf = parts[parts.length - 1].toLowerCase();
  const parent = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : '';
  const candidates = cfb.entries.filter((e: CfbEntry) => e.type === 'stream' && e.name.toLowerCase() === leaf);
  const inParent = candidates.find((e) => e.path.toLowerCase().includes(parent + '/'));
  const pick = inParent || (parts.length === 1 ? candidates[0] : undefined);
  return pick ? cfb.read(pick) : null;
}

/** The Publisher version the "Contents" stream declares (0xE8 0xAC version 0x00). */
export function pubVersion(contents: Uint8Array | null, hasQuill: boolean): PubVersion {
  if (!contents || contents.length < 4 || contents[0] !== 0xe8 || contents[1] !== 0xac || contents[3] !== 0) return 'unknown';
  if (contents[2] === 0x2c) return '2002';
  if (contents[2] === 0x22) return hasQuill ? '2000' : '97';
  return 'unknown';
}

export function openPubStreams(data: Uint8Array): PubStreams | null {
  const cfb = openCfb(data);
  if (!cfb) return null;
  const contents = findStream(cfb, 'Contents');
  const quill = findStream(cfb, 'Quill/QuillSub/CONTENTS');
  const escher = findStream(cfb, 'Escher/EscherStm');
  const escherDelay = findStream(cfb, 'Escher/EscherDelayStm');
  return { cfb, version: pubVersion(contents, !!quill), contents, quill, escher, escherDelay };
}

/** Little-endian reader with a cursor; reads past the end return 0 and leave `overrun` set. */
export class Reader {
  pos = 0;
  overrun = false;
  constructor(public b: Uint8Array, pos = 0) { this.pos = pos; }
  get length(): number { return this.b.length; }
  seek(p: number): void { this.pos = Math.max(0, p); }
  skip(n: number): void { this.pos += n; }
  /** True while the cursor is before `end` and inside the data. */
  before(end: number): boolean { return this.pos < Math.min(end, this.b.length); }
  u8(): number { if (this.pos + 1 > this.b.length) { this.overrun = true; this.pos++; return 0; } return this.b[this.pos++]; }
  u16(): number { if (this.pos + 2 > this.b.length) { this.overrun = true; this.pos += 2; return 0; } const v = this.b[this.pos] | (this.b[this.pos + 1] << 8); this.pos += 2; return v; }
  i16(): number { return (this.u16() << 16) >> 16; }
  u32(): number { if (this.pos + 4 > this.b.length) { this.overrun = true; this.pos += 4; return 0; } const v = (this.b[this.pos] | (this.b[this.pos + 1] << 8) | (this.b[this.pos + 2] << 16) | (this.b[this.pos + 3] << 24)) >>> 0; this.pos += 4; return v; }
  i32(): number { return this.u32() | 0; }
  bytes(n: number): Uint8Array { const end = Math.min(this.b.length, this.pos + Math.max(0, n)); const out = this.b.slice(this.pos, end); if (end - this.pos < n) this.overrun = true; this.pos += n; return out; }
  /** UTF-16LE text of `nBytes` bytes (a trailing NUL is dropped). */
  utf16(nBytes: number): string { return utf16Of(this.bytes(nBytes)); }
  u8At(p: number): number { return p >= 0 && p < this.b.length ? this.b[p] : 0; }
  u16At(p: number): number { return p >= 0 && p + 2 <= this.b.length ? this.b[p] | (this.b[p + 1] << 8) : 0; }
  u32At(p: number): number { return p >= 0 && p + 4 <= this.b.length ? (this.b[p] | (this.b[p + 1] << 8) | (this.b[p + 2] << 16) | (this.b[p + 3] << 24)) >>> 0 : 0; }
  i32At(p: number): number { return this.u32At(p) | 0; }
}

export function utf16Of(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    const c = b[i] | (b[i + 1] << 8);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** EMU (English metric units, 914400 per inch) to points. */
export const emuPt = (v: number): number => Math.round((v / 12700) * 1000) / 1000;

/** Signed 32-bit view of an unsigned value. */
export const signed = (v: number): number => v | 0;

/** 16.16 fixed point to a number. */
export const fixed16 = (v: number): number => (v | 0) / 65536;
