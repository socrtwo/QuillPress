/**
 * The record store of a PageMaker 6–7 publication (.pmd, .p65, .pm6, .pmt; Mac and Windows).
 *
 * The header gives the byte order (a marker at offset 6) and where the table of contents is. The
 * table lists record containers: each has a type, a file offset, a sequence number and a count of
 * fixed-size records. Some entries nest (another table) or group sub-records under one sequence
 * number. Shapes, text, formats, fonts and colors are all such containers; a shape finds its text
 * block, character runs and paragraph runs by sequence number.
 *
 * The format description was worked out from the Document Liberation Project's published reader
 * (used as a reference for the byte layout only); this code is original.
 */
import { Reader } from '../qxp/blocks';
import { openCfb } from '../cfb';

export const REC = {
  FONTS_PARENT: 0x01, PAGE: 0x05, PARA: 0x0b, TIFF: 0x0e, LINE_SET: 0x11, FONTS: 0x13, COLORS: 0x15,
  GLOBAL_INFO: 0x18, SHAPE: 0x19, TEXT_BLOCK: 0x1a, CHARS: 0x1c, XFORM: 0x28,
} as const;

/** Fixed record sizes by container type (text and picture bytes have none: one byte per record). */
export const RECORD_SIZE: Record<number, number> = {
  [REC.SHAPE]: 258, [REC.GLOBAL_INFO]: 2496, [REC.PAGE]: 472, [REC.LINE_SET]: 4, [REC.XFORM]: 26,
  [REC.TEXT_BLOCK]: 36, [REC.CHARS]: 30, [REC.PARA]: 80, [REC.FONTS]: 94, [REC.FONTS_PARENT]: 10, [REC.COLORS]: 210,
};

/** Shape units: 1440 per inch, so 20 per point. */
export const UNITS_PER_POINT = 20;

export interface PmRecord { type: number; offset: number; seq: number; count: number }

export interface PmFile {
  bytes: Uint8Array;
  be: boolean;
  encoding: 'windows-1252' | 'macintosh';
  records: PmRecord[];
  byType: Map<number, PmRecord[]>;
}

/**
 * PageMaker 6.5 and 7 save the publication as an OLE2 compound file whose "PageMaker" stream holds
 * the record store; PageMaker 6.0 writes the record store directly. Returns the record store bytes.
 */
export function unwrapPageMakerStream(bytes: Uint8Array): Uint8Array {
  if (!(bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) return bytes;
  const cfb = openCfb(bytes);
  if (!cfb) throw new Error('The compound file around the PageMaker publication could not be read.');
  const stream = cfb.read('PageMaker') ?? cfb.entries.filter((e) => e.type === 'stream' && /pagemaker/i.test(e.name)).map((e) => cfb.read(e))[0];
  if (!stream) throw new Error('The compound file holds no "PageMaker" stream.');
  return stream;
}

/** Opens the record store; throws when the header is not PageMaker 6–7. */
export function openPageMaker(input: Uint8Array): PmFile {
  const bytes = unwrapPageMakerStream(input);
  if (bytes.length < 0x40) throw new Error('The file is too short to be a PageMaker publication.');
  const mark = bytes[6] | (bytes[7] << 8);
  let be: boolean;
  if (mark === 0x99ff) be = false;
  else if (mark === 0xff99) be = true;
  else throw new Error('The byte-order mark of PageMaker 6–7 is missing; PageMaker 5 and earlier files are not supported.');
  const r = new Reader(bytes, be);
  r.seek(0x2e);
  const tocLength = r.u16();
  r.seek(0x30);
  const tocOffset = r.u32();
  if (tocOffset === 0 || tocOffset >= bytes.length) throw new Error('The table of contents offset points outside the file.');
  const file: PmFile = { bytes, be, encoding: be ? 'macintosh' : 'windows-1252', records: [], byType: new Map() };
  const state = { seq: 0, seen: new Set<number>() };
  try { readTable(file, r, tocOffset, tocLength, false, 0, state); } catch { /* keep what was read */ }
  if (!file.records.length) throw new Error('The table of contents is empty or damaged.');
  return file;
}

function readTable(file: PmFile, r: Reader, offset: number, count: number, sub: boolean, subType: number, state: { seq: number; seen: Set<number> }): void {
  if (state.seen.has(offset)) return;
  state.seen.add(offset);
  if (count === 0 || offset === 0 || offset >= file.bytes.length) return;
  const back = r.pos;
  r.seek(offset);
  const minSize = sub ? 10 : 16;
  const max = Math.floor((file.bytes.length - offset) / minSize);
  for (let i = 0; i < Math.min(count, max); i++) readEntry(file, r, sub, subType, state);
  r.seek(back);
}

function readEntry(file: PmFile, r: Reader, sub: boolean, subType: number, state: { seq: number; seen: Set<number> }): void {
  r.skip(1);
  let type = r.u8();
  const count = r.u16();
  const offset = r.u32();
  r.skip(2);
  let st = 0;
  if (!sub && (type !== 0 || count === 0)) { r.skip(1); st = r.u8(); r.skip(4); }
  if (type === 0 && count === 0) { state.seq++; return; }
  if (!sub && type === 1) { readTable(file, r, offset, count, true, st, state); state.seq++; return; }
  if (!sub && type === 0) { readTable(file, r, offset, count, false, 0, state); return; }
  if (count !== 0 && offset !== 0 && offset < file.bytes.length) {
    if (sub && type !== subType && subType !== 0) type = subType;
    const rec: PmRecord = { type, offset, seq: state.seq, count };
    file.records.push(rec);
    const list = file.byType.get(type) || [];
    list.push(rec);
    file.byType.set(type, list);
  }
  if (!sub) state.seq++;
}

/** The containers sharing a sequence number, in file order. */
export function withSeq(file: PmFile, seq: number): PmRecord[] { return file.records.filter((r) => r.seq === seq); }

/** A reader positioned at record `index` of a container. */
export function recordAt(file: PmFile, rec: PmRecord, index: number): Reader {
  let off = rec.offset;
  if (index > 0) {
    const size = RECORD_SIZE[rec.type];
    if (!size) throw new Error(`records of type ${rec.type} have no known size`);
    off += size * index;
  }
  const r = new Reader(file.bytes, file.be);
  r.seek(off);
  return r;
}

/** The raw bytes of a container whose records are single bytes (text, pictures). */
export function bytesOf(file: PmFile, rec: PmRecord): Uint8Array {
  const end = Math.min(file.bytes.length, rec.offset + rec.count);
  return file.bytes.subarray(rec.offset, end);
}

export interface Pt { x: number; y: number }

/** A point in shape units; Mac files store y before x. */
export function readPoint(r: Reader): Pt {
  const a = r.i16(), b = r.i16();
  return r.be ? { x: b, y: a } : { x: a, y: b };
}

export interface PmXform { rotation: number; skew: number; topLeft: Pt; botRight: Pt; pivot: Pt; id: number }
export const IDENTITY: PmXform = { rotation: 0, skew: 0, topLeft: { x: 0, y: 0 }, botRight: { x: 0, y: 0 }, pivot: { x: 0, y: 0 }, id: 0 };

/** Rotation/skew records, keyed by id. Angles are in degrees, counter-clockwise. */
export function readXforms(file: PmFile): Map<number, PmXform> {
  const out = new Map<number, PmXform>();
  for (const rec of file.byType.get(REC.XFORM) || []) {
    for (let i = 0; i < rec.count; i++) {
      try {
        const r = recordAt(file, rec, i);
        const rotation = r.i32() / 1000, skew = r.i32() / 1000;
        r.skip(2);
        const topLeft = readPoint(r), botRight = readPoint(r), pivot = readPoint(r);
        const id = r.u32();
        out.set(id, { rotation, skew, topLeft, botRight, pivot, id });
      } catch { break; }
    }
  }
  return out;
}

/** Font names in order (the index used by character runs). */
export function readFonts(file: PmFile): string[] {
  const out: string[] = [];
  for (const rec of file.byType.get(REC.FONTS) || []) {
    for (let i = 0; i < rec.count; i++) {
      try {
        const r = recordAt(file, rec, i);
        let name = '';
        for (let k = 0; k < 93; k++) { const c = r.u8(); if (!c) break; name += String.fromCharCode(c); }
        out.push(name.trim());
      } catch { out.push(''); }
    }
  }
  return out;
}

/** Colors in order as '#rrggbb' (RGB entries as stored, CMYK and HLS entries converted from CMYK). */
export function readColors(file: PmFile): string[] {
  const out: string[] = [];
  for (const rec of file.byType.get(REC.COLORS) || []) {
    for (let i = 0; i < rec.count; i++) {
      let rgb = [0, 0, 0];
      try {
        const r = recordAt(file, rec, i);
        r.skip(0x22);
        const model = r.u8();
        r.skip(3);
        if (model === 0x18) rgb = [r.u8(), r.u8(), r.u8()];
        else if (model === 0x08 || model === 0x10) {
          const c = r.u16() / 65535, m = r.u16() / 65535, y = r.u16() / 65535, k = r.u16() / 65535;
          rgb = [255 * (1 - Math.min(1, c + k)), 255 * (1 - Math.min(1, m + k)), 255 * (1 - Math.min(1, y + k))];
        }
      } catch { /* default black */ }
      out.push('#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''));
    }
  }
  return out;
}

export interface PmGlobal { doubleSided: boolean; pageW: number; pageH: number }

/** Page size (shape units) and the double-sided flag from the global information record. */
export function readGlobalInfo(file: PmFile): PmGlobal {
  const rec = (file.byType.get(REC.GLOBAL_INFO) || [])[0];
  if (!rec) throw new Error('the global information record is missing');
  const r = recordAt(file, rec, 0);
  const opts = r.u8();
  r.skip(0x35);
  const tl = readPoint(r), br = readPoint(r);
  const doubleSided = !!(opts & (file.be ? 0x40 : 0x2));
  return { doubleSided, pageW: br.x - tl.x, pageH: br.y - tl.y };
}
