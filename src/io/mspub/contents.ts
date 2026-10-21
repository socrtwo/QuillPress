/**
 * The "Contents" stream of Publisher 2002 and later: a trailer at the end of the stream lists the
 * content chunks (document, pages, shapes, tables, cells, palette, fonts, border art); every chunk
 * is a sequence of typed blocks (an id byte, a type byte, then fixed-size data or a length-prefixed
 * container). The sequence number of a chunk is its index in the trailer directory; the drawing
 * layer (Escher) refers to shapes by that number.
 *
 * Written from the format description of the Document Liberation Project's Publisher reader.
 */
import { Reader, utf16Of } from './cfbStreams';

export interface Block { id: number; type: number; dataOffset: number; dataLength: number; data: number; str?: Uint8Array }

/** Data length of a block type; -1 for containers (a u32 length that includes its own four bytes). */
function blockDataLength(type: number): number {
  switch (type) {
    case 0x78: case 0x05: case 0x08: case 0x0a: return 0;
    case 0x10: case 0x12: case 0x18: case 0x1a: case 0x07: return 2;
    case 0x20: case 0x22: case 0x58: case 0x68: case 0x70: case 0xb8: return 4;
    case 0x28: return 8;
    case 0x38: return 16;
    case 0x48: return 24;
    case 0xc0: case 0x80: case 0x82: case 0x88: case 0x8a: case 0x90: case 0x98: case 0xa0: return -1;
    default: return 0;
  }
}

export const T_DIRECTORY = 0x90, T_CONTAINER = 0x88, T_STRING = 0xc0, T_DUMMY = 0x78, T_SHAPE_SEQ = 0x70;

/** Container block types (a u32 length followed by child blocks). */
export const isContainer = (type: number): boolean => type === 0x80 || type === 0x82 || type === 0x88 || type === 0x8a || type === 0x90 || type === 0x98 || type === 0xa0;

/**
 * Reads one block at the cursor. Containers are skipped entirely when `skipContainers` is set;
 * otherwise the cursor stays after the length word so the caller can read the children.
 */
export function readBlock(r: Reader, skipContainers = true): Block {
  const id = r.u8(), type = r.u8();
  const dataOffset = r.pos;
  const len = blockDataLength(type);
  if (len < 0) {
    const dataLength = r.u32();
    const b: Block = { id, type, dataOffset, dataLength, data: 0 };
    if (type === T_STRING) { b.str = r.bytes(Math.max(0, dataLength - 4)); }
    else if (skipContainers) r.seek(dataOffset + dataLength);
    return b;
  }
  let data = 0;
  if (len === 2) data = r.u16();
  else if (len === 4) data = r.u32();
  else r.skip(len);
  return { id, type, dataOffset, dataLength: len, data };
}

export const skipBlock = (r: Reader, b: Block): void => { r.seek(b.dataOffset + b.dataLength); };

/** Iterates the blocks between the cursor and `end` (containers skipped). */
export function* blocks(r: Reader, end: number): Generator<Block> {
  const stop = Math.min(end, r.length);
  while (r.pos < stop) {
    const p = r.pos;
    const b = readBlock(r, true);
    yield b;
    if (r.pos <= p) break;
  }
}

/** Children of a container block (the cursor is placed after its length word). */
export function* children(r: Reader, c: Block): Generator<Block> {
  r.seek(c.dataOffset + 4);
  yield* blocks(r, c.dataOffset + c.dataLength);
}

// ------------------------------------------------------------------------------------------
// Chunk directory

export const CHUNK = { SHAPE: 0x01, ALTSHAPE: 0x20, DOCUMENT: 0x44, PAGE: 0x43, PALETTE: 0x5c, BORDER_ART: 0x46, GROUP: 0x30, LOGO: 0x31, TABLE: 0x10, CELLS: 0x63, FONT: 0x6c, PICTURE_SOURCE: 0x66 } as const;

export interface ChunkRef { type: number; offset: number; end: number; seq: number; parent: number }

export interface TableInfo { rows: number; cols: number; rowHeights: number[]; colWidths: number[]; cells: { r0: number; r1: number; c0: number; c1: number }[] }

export interface ShapeChunk {
  seq: number;
  kind: 'shape' | 'group' | 'table';
  alt?: boolean;
  textId?: number;
  width?: number;
  height?: number;
  /** 0 top, 1 middle, 2 bottom. */
  valign?: number;
  borderImage?: number;
  stretchBorderArt: boolean;
  crop?: number;
  table?: TableInfo;
}

export interface PageChunk { seq: number; shapes: number[]; bgShape?: number; isMaster: boolean; master?: number; dummy: boolean }

export interface ContentsInfo {
  /** Page size in EMU. */
  width: number;
  height: number;
  pageOrder: number[];
  pages: Map<number, PageChunk>;
  shapes: Map<number, ShapeChunk>;
  /** Palette colors as 0xRRGGBB numbers (black inserted first when the palette is short, as Publisher does). */
  palette: number[];
  fonts: { name: string; eot?: Uint8Array }[];
  /** Parent chunk of every chunk (shapes sit under their page or group). */
  parents: Map<number, number>;
  /** Source file name of a picture, by the picture shape's sequence number. */
  pictureNames: Map<number, string>;
  borderArt: number;
  warnings: string[];
}

const DUMMY_PAGES = new Set([0x10d, 0x110, 0x113, 0x117]);

/** Parses the trailer directory into chunk references. */
export function readChunkDirectory(r: Reader): ChunkRef[] {
  const refs: ChunkRef[] = [];
  const trailerOffset = r.u32At(0x1a);
  if (!trailerOffset || trailerOffset + 4 > r.length) throw new Error('Contents trailer missing');
  r.seek(trailerOffset);
  const trailerLength = r.u32();
  let seq = -1;
  for (let i = 0; i < 3 && r.pos < r.length; i++) {
    const part = readBlock(r, false);
    if (part.type !== T_DIRECTORY) { skipBlock(r, part); continue; }
    const end = Math.min(part.dataOffset + part.dataLength, r.length);
    while (r.pos < end) {
      const p = r.pos;
      const b = readBlock(r, false);
      seq++;
      if (b.type === T_CONTAINER) {
        let type = -1, offset = -1, parent = 0;
        const cend = b.dataOffset + b.dataLength;
        while (r.pos < cend && r.pos < r.length) {
          const sb = readBlock(r, true);
          if (sb.id === 0x02) type = sb.data;
          else if (sb.id === 0x04) offset = sb.data;
          else if (sb.id === 0x05) parent = sb.data;
        }
        r.seek(cend);
        if (type >= 0 && offset >= 0) {
          if (refs.length) refs[refs.length - 1].end = offset;
          refs.push({ type, offset, end: end, seq, parent });
        }
      } else skipBlock(r, b);
      if (r.pos <= p) break;
    }
    if (refs.length) refs[refs.length - 1].end = end;
    break;
  }
  void trailerLength;
  return refs;
}

function parseDocument(r: Reader, c: ChunkRef, out: ContentsInfo): void {
  r.seek(c.offset);
  const begin = r.pos, len = r.u32();
  for (const b of blocks(r, begin + len)) {
    if (b.id === 0x12 && isContainer(b.type)) {
      for (const sb of children(r, b)) { if (sb.id === 1) out.width = sb.data; else if (sb.id === 2) out.height = sb.data; }
    } else if (b.id === 0x02 && isContainer(b.type)) {
      for (const sb of children(r, b)) if (sb.id === 0) out.pageOrder.push(sb.data);
    }
  }
}

function parsePage(r: Reader, c: ChunkRef, out: ContentsInfo): void {
  r.seek(c.offset);
  const len = r.u32();
  const page: PageChunk = { seq: c.seq, shapes: [], isMaster: false, dummy: DUMMY_PAGES.has(c.seq) };
  for (const b of blocks(r, c.offset + len)) {
    if (b.id === 0x0a && b.type !== T_CONTAINER) page.bgShape = b.data;
    else if (b.id === 0x02 && isContainer(b.type)) { for (const sb of children(r, b)) if (sb.type === T_SHAPE_SEQ) page.shapes.push(sb.data); }
    else if (b.id === 0x0e && b.str) { if (b.str.some((v) => v !== 0)) page.isMaster = true; }
    else if (b.id === 0x0d && !isContainer(b.type) && b.type !== T_STRING) page.master = b.data;
  }
  out.pages.set(c.seq, page);
}

function parseShape(r: Reader, c: ChunkRef, out: ContentsInfo, cells: ChunkRef[]): void {
  r.seek(c.offset);
  const pos = r.pos, len = r.u32();
  if (c.type === CHUNK.TABLE) {
    let cellsSeq = -1, rows = -1, cols = -1, rowcol = -1, textId: number | undefined;
    for (const b of blocks(r, pos + len)) {
      if (b.id === 0x6b) cellsSeq = b.data;
      else if (b.id === 0x66) rows = b.data;
      else if (b.id === 0x67) cols = b.data;
      else if (b.id === 0x6d) rowcol = b.dataOffset;
      else if (b.id === 0x27) textId = b.data;
    }
    const sc: ShapeChunk = { seq: c.seq, kind: 'table', stretchBorderArt: true, textId };
    if (cellsSeq >= 0 && rows > 0 && cols > 0 && rowcol >= 0) {
      const colWidths: number[] = [], rowHeights: number[] = [];
      r.seek(rowcol);
      const alen = r.u32();
      for (const b of blocks(r, rowcol + alen)) {
        if (b.id !== 0 || !isContainer(b.type)) continue;
        for (const sb of children(r, b)) if (sb.id === 0x02) { if (colWidths.length < cols) colWidths.push(sb.data); else if (rowHeights.length < rows) rowHeights.push(sb.data); }
      }
      const cellList: TableInfo['cells'] = [];
      const cc = cells.find((x) => x.seq === cellsSeq);
      if (cc) {
        r.seek(cc.offset);
        const clen = r.u32();
        for (const b of blocks(r, cc.offset + clen)) {
          if (b.id !== 0x02 || !isContainer(b.type)) continue;
          for (const item of children(r, b)) {
            if (item.id !== 0 || !isContainer(item.type)) continue;
            const cell = { r0: 0, r1: 0, c0: 0, c1: 0 };
            for (const sb of children(r, item)) {
              if (sb.id === 1) cell.r0 = sb.data; else if (sb.id === 2) cell.r1 = sb.data; else if (sb.id === 3) cell.c0 = sb.data; else if (sb.id === 4) cell.c1 = sb.data;
            }
            cellList.push(cell);
          }
        }
      }
      if (colWidths.length === cols && rowHeights.length === rows) sc.table = { rows, cols, rowHeights, colWidths, cells: cellList };
      else out.warnings.push(`A table's row and column sizes were incomplete; it was placed as a text box.`);
    }
    out.shapes.set(c.seq, sc);
    return;
  }
  const sc: ShapeChunk = { seq: c.seq, kind: c.type === CHUNK.GROUP || c.type === CHUNK.LOGO ? 'group' : 'shape', stretchBorderArt: true, ...(c.type === CHUNK.ALTSHAPE ? { alt: true } : {}) };
  for (const b of blocks(r, pos + len)) {
    if (b.id === 0xaa) sc.width = b.data;
    else if (b.id === 0xab) sc.height = b.data;
    else if (b.id === 0x09) sc.borderImage = b.data;
    else if (b.id === 0x07) sc.stretchBorderArt = false;
    else if (b.id === 0x27) sc.textId = b.data;
    else if (b.id === 0x35) sc.valign = b.data > 2 ? 0 : b.data;
    else if (b.id === 0xb7 && b.data !== 0) sc.crop = b.data;
  }
  out.shapes.set(c.seq, sc);
}

function parsePalette(r: Reader, c: ChunkRef, out: ContentsInfo): void {
  r.seek(c.offset);
  const len = r.u32();
  const end = c.offset + len;
  while (r.pos < Math.min(end, r.length)) {
    const b = readBlock(r, false);
    if (b.type === 0xa0) {
      const bend = b.dataOffset + b.dataLength;
      while (r.pos < Math.min(bend, r.length)) {
        const sb = readBlock(r, false);
        if (isContainer(sb.type)) {
          for (const e of children(r, sb)) if (e.id === 0x01) { const d = e.data; out.palette.push(((d & 0xff) << 16) | (((d >> 8) & 0xff) << 8) | ((d >> 16) & 0xff)); }
        } else if (sb.type === T_DUMMY) out.palette.push(0);
        skipBlock(r, sb);
      }
    }
    skipBlock(r, b);
  }
}

function parseFont(r: Reader, c: ChunkRef, out: ContentsInfo): void {
  r.seek(c.offset);
  const len = r.u32();
  for (const b of blocks(r, c.offset + len)) {
    if (b.id !== 0x02 || !isContainer(b.type)) continue;
    for (const entry of children(r, b)) {
      if (entry.id !== 0 || !isContainer(entry.type)) continue;
      let name = '';
      let eot: Uint8Array | undefined;
      for (const sb of children(r, entry)) {
        if (sb.id === 0x04 && sb.str) name = utf16Of(sb.str);
        else if (sb.id === 0x0c && sb.type !== T_STRING && sb.dataLength > 4) eot = r.b.slice(sb.dataOffset + 4, Math.min(r.length, sb.dataOffset + sb.dataLength));
      }
      if (name) out.fonts.push(eot ? { name, eot } : { name });
    }
  }
}

/** Parses the Contents stream of a 2002+ publication. Throws when the trailer or document chunk is missing. */
export function parseContents(contents: Uint8Array): ContentsInfo {
  const r = new Reader(contents);
  const out: ContentsInfo = { width: 0, height: 0, pageOrder: [], pages: new Map(), shapes: new Map(), palette: [], fonts: [], parents: new Map(), pictureNames: new Map(), borderArt: 0, warnings: [] };
  const refs = readChunkDirectory(r);
  for (const c of refs) out.parents.set(c.seq, c.parent);
  const doc = refs.find((c) => c.type === CHUNK.DOCUMENT);
  if (!doc) throw new Error('Contents has no document chunk');
  const cells = refs.filter((c) => c.type === CHUNK.CELLS);
  for (const c of refs) if (c.type === CHUNK.PALETTE) parsePalette(r, c, out);
  if (out.palette.length && out.palette.length < 8) out.palette.unshift(0);
  out.borderArt = refs.filter((c) => c.type === CHUNK.BORDER_ART).length;
  for (const c of refs) if (c.type === CHUNK.SHAPE || c.type === CHUNK.ALTSHAPE || c.type === CHUNK.GROUP || c.type === CHUNK.LOGO || c.type === CHUNK.TABLE) parseShape(r, c, out, cells);
  for (const c of refs) if (c.type === CHUNK.FONT) parseFont(r, c, out);
  for (const c of refs) {
    if (c.type !== CHUNK.PICTURE_SOURCE) continue;
    r.seek(c.offset);
    const len = r.u32();
    for (const b of blocks(r, c.offset + len)) if (b.id === 0x03 && b.str) { const name = utf16Of(b.str); if (name) out.pictureNames.set(c.parent, name); }
  }
  parseDocument(r, doc, out);
  for (const c of refs) if (c.type === CHUNK.PAGE) parsePage(r, c, out);
  if (!out.width || !out.height) throw new Error('Contents has no page size');
  return out;
}
