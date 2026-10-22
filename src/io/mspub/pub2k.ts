/**
 * Publisher 2000 and Publisher 97/98 layouts: the "Contents" stream keeps a flat table of chunks
 * (pages, document, shapes, groups, image data, palette) with fixed-offset records instead of the
 * typed blocks of 2002+. Text comes from the Quill stream (2000) or from the Contents stream itself
 * (97, 8-bit characters with per-page formatting tables). Pictures are Windows metafiles.
 *
 * Written from the format description of the Document Liberation Project's Publisher reader.
 */
import { Reader, emuPt } from './cfbStreams';
import type { LDoc, LPage, LShape } from './shapes';
import type { TableInfo } from './contents';
import type { QuillInfo, QPara, CharStyle } from './quill';
import type { Fill } from '../../model/types';
import { colorOf } from './text';

interface Chunk { seq: number; parent: number; offset: number; end: number; marker: number }

const DUMMY = new Set([0x116, 0x108, 0x10b, 0x10d, 0x119]);
const MASTER_SEQ = 0x109;

/** Publisher 2000's fixed color table (index → 0xRRGGBB). */
const COLORS_2K = [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff, 0x808080, 0xc0c0c0, 0x800000, 0x008000, 0x000080, 0x808000, 0x008080, 0x800080, 0xff9933, 0x330033, 0x000099, 0x009900, 0x999900, 0xcc6600, 0x990000, 0xcc99cc, 0x6666ff, 0x66ff66, 0xffff99, 0xffcc99, 0xff6666, 0xff9900, 0x0066ff, 0xffcc00, 0x990033, 0x663300, 0x424242, 0xff9966, 0x993300, 0xff6600, 0x333300, 0x99cc00, 0xffff99, 0x003300, 0x339966, 0xccffcc, 0x003366, 0x33cccc, 0xccffff, 0x3366ff, 0x00ccff, 0x99ccff, 0x333399, 0x666699, 0x993366, 0xcc99ff, 0x333333, 0x969696];

/** A 2000-format color (0xTTBBGGRR) → 0xRRGGBB. */
export function color2k(v: number): number {
  const t = (v >>> 24) & 0xff;
  if (t === 0x80 || t === 0x00) return COLORS_2K[v & 0xff] ?? 0;
  if (t === 0x90 || t === 0x20) return ((v & 0xff) << 16) | (v & 0xff00) | ((v >>> 16) & 0xff);
  return 0;
}

/** A 2000-format color reference → the 2002-style reference colorOf() understands. */
export function colorRef2k(v: number): number {
  const t = (v >>> 24) & 0xff;
  if (t === 0xc0 || t === 0xe0) return ((0x08 << 24) | (v & 0xff)) >>> 0;
  const rgb = color2k(v);
  return (((rgb >> 16) & 0xff) | (rgb & 0xff00) | ((rgb & 0xff) << 16)) >>> 0;
}

/** Line width specifier → points (the reference describes quarter points). */
function lineWidth2k(w: number): number {
  const q = w === 0x81 ? 0 : w > 0x81 ? Math.floor((w - 0x81) / 3) * 4 + ((w - 0x81) % 3) + 1 : w * 4;
  return q / 4;
}

const SHAPES_2K: Record<number, number> = { 0x1: 6, 0x3: 68, 0x4: 12, 0x5: 74, 0x6: 5, 0x7: 7, 0x9: 70, 0xa: 59, 0xb: 64, 0xc: 4, 0xd: 8, 0xe: 55, 0xf: 91, 0x10: 92, 0x12: 56, 0x13: 15, 0x15: 101, 0x16: 71, 0x18: 9, 0x1c: 72, 0x1d: 95, 0x1e: 10, 0x1f: 11, 0x20: 16, 0x22: 73 };

interface Layout97 { textIdOffset: number; textMarker: number; firstLine: number; secondLine: number; fillType: number; fillColor: number; coordOffset: number; /** Byte shift of every field after the marker (-2 for 97 records without the rotation word). */ shift: number }

/** Chunk markers that are shapes (text boxes 0x08 in 2000, 0x00 in 97; tables 0x0a in 2000). */
const SHAPE_MARKERS = new Set([0x0000, 0x0002, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x000a, 0x000f]);

/**
 * A Publisher 2000 table record (marker 0x0a): the text id at 0x4e, the column count at 0x50, the
 * number of size entries at 0x74 and, from 0x7e, (end, size) EMU pairs for the columns then the rows.
 * The cell spans sit in a child chunk (marker 0x4f): a count at 0x0a and 11-byte entries from 0x14,
 * each a border style index, first row, last row, first column, last column, a flag and an inset.
 */
/** A cell border style of a Publisher 2000 table: line width specifier and color for each side. */
interface CellStyle2k { sides: { w: number; c: number }[] }

/**
 * The table's cell border styles (child chunk 0x4e): a count at 0x0a, the entry size (45) at 0x0e and
 * the entries from 0x14. An entry is a mask word (0x40 top and left, 0x10 adds the right side, 0x20
 * the bottom: Publisher draws each cell's top and left edges and only the last column's right and the
 * last row's bottom edges), 17 bytes of cell settings (four margins of 0x39 twips among them), then
 * four 6-byte side records for top, left, right and bottom (a pad byte, the line width specifier, a
 * color reference as shapes use) and a use count. Width 0 is no line: a new Publisher 2000 table has
 * only non-printing gridlines.
 */
function cellStyles2k(r: Reader, c: Chunk, chunks: Chunk[]): CellStyle2k[] | null {
  const sc = chunks.find((k) => k.parent === c.seq && k.marker === 0x004e);
  if (!sc) return null;
  const size = r.u16At(sc.offset + 0x0e);
  if (size < 45 || size > 200) return null;
  const n = Math.min(r.u16At(sc.offset + 0x0a), Math.floor((sc.end - sc.offset - 0x14) / size));
  const out: CellStyle2k[] = [];
  for (let i = 0; i < n; i++) {
    const e = sc.offset + 0x14 + i * size;
    const mask = r.u16At(e);
    const sides = [0, 1, 2, 3].map((k) => ({ w: r.u8At(e + 19 + k * 6 + 1), c: r.u32At(e + 19 + k * 6 + 2) }));
    if (!(mask & 0x10)) sides[2].w = 0;
    if (!(mask & 0x20)) sides[3].w = 0;
    out.push({ sides });
  }
  return out;
}

/** The bordered cell edges of a Publisher 2000 table as line shapes (EMU, page-center coordinates). */
function tableEdges2k(table: TableInfo, styleOf: number[], styles: CellStyle2k[], box: NonNullable<LShape['box']>, seq: number, palette: number[], names: Map<number, string>): LShape[] {
  const xs = [box.xs], ys = [box.ys];
  for (const w of table.colWidths) xs.push(xs[xs.length - 1] + w);
  for (const h of table.rowHeights) ys.push(ys[ys.length - 1] + h);
  // Segments keyed by line (orientation, position, width, color), merged where they touch.
  const segs = new Map<string, [number, number][]>();
  const add = (horiz: boolean, at: number, a: number, b: number, side: { w: number; c: number }) => {
    if (!side.w) return;
    const key = `${horiz ? 'h' : 'v'}|${at}|${side.w}|${side.c}`;
    if (!segs.has(key)) segs.set(key, []);
    segs.get(key)!.push([Math.min(a, b), Math.max(a, b)]);
  };
  table.cells.forEach((cell, i) => {
    const st = styles[styleOf[i]];
    if (!st) return;
    const [top, left, right, bottom] = st.sides;
    const x0 = xs[cell.c0], x1 = xs[cell.c1 + 1] ?? xs[xs.length - 1], y0 = ys[cell.r0], y1 = ys[cell.r1 + 1] ?? ys[ys.length - 1];
    add(true, y0, x0, x1, top); add(false, x0, y0, y1, left); add(false, x1, y0, y1, right); add(true, y1, x0, x1, bottom);
  });
  const out: LShape[] = [];
  for (const [key, list] of segs) {
    const [o, atS, wS, cS] = key.split('|');
    const at = Number(atS), side = { w: Number(wS), c: Number(cS) };
    list.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const sg of list) { const last = merged[merged.length - 1]; if (last && sg[0] <= last[1] + 1) last[1] = Math.max(last[1], sg[1]); else merged.push([...sg]); }
    for (const [a, b] of merged) {
      out.push({ seq, kind: 'shape', type: 20, box: o === 'h' ? { xs: a, ys: at, xe: b, ye: at } : { xs: at, ys: a, xe: at, ye: b }, line: { color: colorOf(colorRef2k(side.c), palette, names), width: Math.max(0.25, lineWidth2k(side.w)) } } as LShape);
    }
  }
  return out;
}

function table2k(r: Reader, c: Chunk, chunks: Chunk[]): TableInfo | null {
  const o = c.offset;
  const cols = r.u16At(o + 0x50), total = r.u16At(o + 0x74);
  const rows = total - cols;
  if (cols < 1 || rows < 1 || cols > 256 || rows > 4096 || o + 0x7e + total * 8 > c.end) return null;
  const colWidths: number[] = [], rowHeights: number[] = [];
  for (let i = 0; i < total; i++) { const size = r.u32At(o + 0x7e + i * 8 + 4); (i < cols ? colWidths : rowHeights).push(size); }
  const cells: TableInfo['cells'] = [];
  const styleIndex: number[] = [];
  const cc = chunks.find((k) => k.parent === c.seq && k.marker === 0x004f);
  if (cc) {
    const n = Math.min(r.u16At(cc.offset + 0x0a), Math.floor((cc.end - cc.offset - 0x14) / 11));
    for (let i = 0; i < n; i++) {
      const e = cc.offset + 0x14 + i * 11;
      const r0 = r.u8At(e + 2), r1 = r.u8At(e + 3), c0 = r.u8At(e + 4), c1 = r.u8At(e + 5);
      if (r0 < rows && c0 < cols) { cells.push({ r0, r1: Math.min(Math.max(r1, r0), rows - 1), c0, c1: Math.min(Math.max(c1, c0), cols - 1) }); styleIndex.push(r.u16At(e)); }
    }
  }
  const t: TableInfo & { styleIndex?: number[] } = { rows, cols, rowHeights, colWidths, cells };
  Object.defineProperty(t, 'styleIndex', { value: styleIndex, enumerable: false });
  return t;
}

function readChunks(r: Reader): Chunk[] {
  const trailer = r.u32At(0x16);
  if (!trailer || trailer + 2 > r.length) throw new Error('Contents trailer missing');
  r.seek(trailer);
  const n = r.u16();
  const out: Chunk[] = [];
  for (let i = 0; i < n && r.pos + 10 <= r.length; i++) {
    r.skip(2);
    const seq = r.u16(), parent = r.u16(), offset = r.u32();
    if (out.length) out[out.length - 1].end = offset;
    out.push({ seq, parent, offset, end: r.length, marker: r.u16At(offset) });
  }
  return out;
}

function shapeOf(r: Reader, c: Chunk, chunks: Chunk[], palette: number[], names: Map<number, string>, L: Layout97, pictures: number[], counts: LDoc['counts'], depth: number, textShapes: LShape[]): LShape | null {
  if (depth > 32) return null;
  const o = c.offset, sh = L.shift;
  const s: LShape = { seq: c.seq, kind: c.marker === 0x000f ? 'group' : 'shape', type: 1 };
  let flagsOffset = 0, isRect = false, isLine = false, isImage = false;
  let tableStyles: CellStyle2k[] | null = null;
  switch (c.marker) {
    case 0x000f: break;
    case 0x000a: {
      if (L.textMarker !== 0x0008) break;
      const t = table2k(r, c, chunks);
      if (!t) break;
      s.kind = 'table'; s.table = t; s.textId = r.u16At(o + 0x4e); isRect = true;
      tableStyles = cellStyles2k(r, c, chunks);
      if (!tableStyles) s.defaultTableBorder = true;
      break;
    }
    case 0x0004: isLine = true; flagsOffset = 0x41; s.type = 20; break;
    case 0x0002: isImage = true; isRect = true; break;
    case 0x0005: isRect = true; break;
    case 0x0006: { const t = SHAPES_2K[r.u8At(o + 0x31)]; flagsOffset = 0x33; if (t) s.type = t; else counts.unknownShapes++; break; }
    case 0x0007: s.type = 3; break;
    default:
      if (c.marker === L.textMarker) {
        isRect = true;
        // Some 97 files keep shorter records than the text id offset; those get their text by order.
        if (o + L.textIdOffset + sh + 2 <= c.end) s.textId = r.u16At(o + L.textIdOffset + sh);
        textShapes.push(s);
      }
      break;
  }
  if (s.kind !== 'group' && !isLine && sh === 0) { const rot = (360 - r.u16At(o + 4) / 10) % 360; if (Math.abs(rot) > 0.01 && Math.abs(rot - 360) > 0.01) s.rot = Math.round(rot * 100) / 100; }
  const xs = r.i32At(o + 6 + sh) - L.coordOffset, ys = r.i32At(o + 10 + sh) - L.coordOffset, xe = r.i32At(o + 14 + sh) - L.coordOffset, ye = r.i32At(o + 18 + sh) - L.coordOffset;
  s.box = { xs: Math.min(xs, xe), ys: Math.min(ys, ye), xe: Math.max(xs, xe), ye: Math.max(ys, ye) };
  // Template placeholders have an empty box; they draw nothing.
  if (s.kind !== 'group' && s.box.xs === s.box.xe && s.box.ys === s.box.ye) return null;
  if (flagsOffset) { const f = r.u8At(o + flagsOffset + sh); if (f & 0x1) s.flipV = true; if (f & (0x2 | 0x10)) s.flipH = true; }
  if (s.kind === 'group') {
    s.children = chunks.filter((k) => k.parent === c.seq && k !== c && SHAPE_MARKERS.has(k.marker))
      .map((k) => shapeOf(r, k, chunks, palette, names, L, pictures, counts, depth + 1, textShapes)).filter((k): k is LShape => !!k);
    return s;
  }
  if (isImage) {
    const idx = pictures.indexOf(c.seq);
    if (idx >= 0) s.picture = idx + 1;
  } else if (r.u8At(o + L.fillType + sh) === 2) {
    s.fill = { type: 'solid', color: colorOf(colorRef2k(r.u32At(o + L.fillColor + sh)), palette, names) } as Fill;
  }
  // Strokes: the left line, and for rectangles the top/right/bottom lines; the first that exists is used.
  const sides: { w: number; c: number }[] = [{ w: r.u8At(o + L.firstLine + sh), c: r.u32At(o + L.firstLine + sh + 1) }];
  if (isRect) for (let i = 0; i < 3; i++) { const p = o + L.secondLine + sh + i * 6; sides.unshift({ w: r.u8At(p), c: r.u32At(p + 1) }); }
  const side = sides.find((x) => x.w !== 0);
  if (side) s.line = { color: colorOf(colorRef2k(side.c), palette, names), width: Math.max(0.25, lineWidth2k(side.w)) };
  s.insets = [emuPt(36576), emuPt(36576), emuPt(36576), emuPt(36576)];
  if (s.kind === 'table' && s.table && tableStyles && s.box) {
    // The table's own record carries no outline of its own here; its cell borders are drawn as lines
    // grouped with it (the table item has one outer and one inner border style, not per-edge ones).
    delete s.line;
    const styleOf = (s.table as TableInfo & { styleIndex?: number[] }).styleIndex || [];
    const edges = s.rot ? [] : tableEdges2k(s.table, styleOf, tableStyles, s.box, s.seq, palette, names);
    if (edges.length) return { seq: s.seq, kind: 'group', type: 1, box: { ...s.box }, children: [s, ...edges] } as LShape;
  }
  return s;
}

export interface Pub2kResult { doc: LDoc }

/** Reads a Publisher 2000 (with Quill text) or 97/98 (text in Contents) layout. */
export function parse2k(contents: Uint8Array, quill: QuillInfo | null, version: '2000' | '97'): LDoc {
  const r = new Reader(contents);
  const chunks = readChunks(r);
  const doc97 = version === '97';
  const docChunk = chunks.find((c) => c.marker === 0x0015);
  if (!docChunk) throw new Error('Contents has no document chunk');
  let banner = false;
  let width: number, height: number;
  if (doc97) { banner = r.u16At(docChunk.offset + 0x12) === 0x0007; width = r.u32At(docChunk.offset + 0x14); height = r.u32At(docChunk.offset + 0x18); }
  else { width = r.u32At(docChunk.offset + 0x14); height = r.u32At(docChunk.offset + 0x18); }
  if (!width || !height) throw new Error('Contents has no page size');
  const L: Layout97 = doc97
    ? { textIdOffset: 0x46, textMarker: 0x0000, firstLine: 0x22, secondLine: 0x2d, fillType: 0x20, fillColor: 0x18, coordOffset: (banner ? 120 : 25) * 914400, shift: 0 }
    : { textIdOffset: 0x58, textMarker: 0x0008, firstLine: 0x2c, secondLine: 0x35, fillType: 0x2a, fillColor: 0x22, coordOffset: 0, shift: 0 };
  // Some 97 files write shape records without the rotation word, so the coordinates start at +4.
  // A rotation above 360° in any shape record gives that variant away.
  if (doc97 && chunks.some((c) => SHAPE_MARKERS.has(c.marker) && c.marker !== 0x000f && c.marker !== 0x0004 && r.u16At(c.offset + 4) > 3600)) L.shift = -2;
  const palette: number[] = [];
  for (const c of chunks) if (c.marker === 0x0047) for (let j = 0; j < 8; j++) palette.push(color2k(r.u32At(c.offset + 0xa0 + j * 4)));
  const names = new Map<number, string>();
  palette.forEach((_c, i) => names.set(i, `Scheme Color ${i + 1}`));
  const counts = { unknownShapes: 0, borderArt: 0, calcGeometry: 0, unplaced: 0, scratch: 0, wordArt: 0 };
  const textShapes: LShape[] = [];
  // Image data chunks hold Windows metafiles; they are counted so the frames can say what is missing.
  const imageData = chunks.filter((c) => c.marker === 0x0021);
  const pictures = imageData.map((c) => c.parent);
  const pageChunks = chunks.filter((c) => c.marker === 0x0014 && !DUMMY.has(c.seq));
  const pages: LPage[] = [];
  for (const pc of pageChunks) {
    const pg: LPage = { seq: pc.seq, shapes: [], isMaster: pc.seq === MASTER_SEQ };
    for (const c of chunks) {
      if (c.parent !== pc.seq || c === pc) continue;
      if (!SHAPE_MARKERS.has(c.marker)) continue;
      const s = shapeOf(r, c, chunks, palette, names, L, pictures, counts, 0, textShapes);
      if (s) pg.shapes.push(s);
    }
    pages.push(pg);
  }
  // Page chunks also describe scratch and template areas; as in the reference reader, only the pages
  // that carry objects become pages (a publication keeps at least its first page).
  const withShapes = pages.filter((p) => p.isMaster || p.shapes.length);
  const kept = withShapes.some((p) => !p.isMaster) ? withShapes : pages.slice(0, 1);
  pages.length = 0; pages.push(...kept);
  const master = pages.find((p) => p.isMaster);
  if (master) for (const p of pages) if (!p.isMaster) p.master = master.seq;
  const q = doc97 ? parseText97(r, palette) : quill ? remapQuillColors(quill) : null;
  // Publisher 97 stories are numbered by their order in the text; when the records carry no usable
  // ids (short records, ids beyond the story count), the text boxes take the stories in page order.
  if (doc97 && q) {
    const n = q.texts.size;
    const onPages = textShapes.filter((t) => pages.some((p) => !p.isMaster && p.shapes.includes(t)));
    const valid = onPages.length > 0 && onPages.every((t) => t.textId != null && t.textId < n);
    if (!valid) onPages.forEach((t, i) => { t.textId = i < n ? i : undefined; });
  }
  const doc: LDoc = {
    version, width, height, pages: [...pages.filter((p) => !p.isMaster), ...pages.filter((p) => p.isMaster)], quill: q, palette,
    pictures: imageData.map((c) => ({ kind: 'wmf' as const, mime: 'image/wmf', data: r.b.slice(c.offset + 8, Math.min(c.end, c.offset + 8 + r.u32At(c.offset + 4))) })),
    embeddedFonts: 0, counts, warnings: [],
  };
  return doc;
}

/** Publisher 2000 character styles carry a color reference instead of a palette index; make them indexes. */
function remapQuillColors(q: QuillInfo): QuillInfo {
  const refs: number[] = [];
  const idx = (c: number) => { const t = colorRef2k(c); let i = refs.indexOf(t); if (i < 0) { refs.push(t); i = refs.length - 1; } return i; };
  const fix = (st: CharStyle) => { if (st.colorIndex != null && st.colorIndex >= 0) st.colorIndex = idx(st.colorIndex); };
  for (const paras of q.texts.values()) for (const p of paras) for (const s of p.spans) fix(s.style);
  for (const st of q.defaultChar) fix(st);
  return { ...q, colors: refs };
}

/**
 * Publisher 97 text is 8-bit in the writer's Windows code page, which the file does not record.
 * Western text keeps high bytes rare; when most letters are high bytes the text is in another
 * script, and a run of bytes confined to 0xC0–0xFF is the Cyrillic block of code page 1251.
 */
function guessCodePage(chars: Uint8Array): string {
  let letters = 0, high = 0, cyr = 0;
  for (const c of chars) {
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) letters++;
    else if (c >= 0x80) { high++; if (c >= 0xc0 || c === 0xa8 || c === 0xb8) cyr++; }
  }
  if (high && high / (letters + high) > 0.3) return cyr / high > 0.9 ? 'windows-1251' : 'windows-1250';
  return 'windows-1252';
}

/** Publisher 97: 8-bit text and the character formatting pages of the Contents stream. */
function parseText97(r: Reader, _palette: number[]): QuillInfo {
  const info: QuillInfo = { texts: new Map(), fonts: [], colors: [], defaultChar: [], defaultPara: [], cellEnds: new Map() };
  const hdr = r.u32At(0x12);
  if (!hdr || hdr + 30 > r.length) return info;
  r.seek(hdr + 14);
  const textStart = r.u32(), textEnd = r.u32();
  const prop1 = r.u16(), prop2 = r.u16();
  r.u16(); r.u16();
  // Character spans: pages of 0x200 bytes with span ends, style indexes and the style records.
  const spans: { end: number; style: CharStyle }[] = [];
  let base = 0;
  for (let i = prop1; i < prop2 && i < 4096; i++) {
    const off = i * 0x200;
    if (off + 0x200 > r.length) break;
    const n = r.u8At(off + 0x1ff);
    r.seek(off);
    const start = r.u32();
    if (i === prop1) base = start;
    const ends: number[] = [];
    for (let j = 0; j < n; j++) ends.push(r.u32() - base);
    const styleIdx: number[] = [];
    for (let j = 0; j < n; j++) styleIdx.push(r.u8());
    while (r.pos < off + 0x200 && r.u8() === 0) { /* padding */ }
    r.pos--;
    const styles = new Map<number, CharStyle>();
    while (r.pos < off + 0x1ff) {
      const len = r.u8();
      const next = r.pos + len;
      const index = Math.floor((r.pos - 1 - off) / 2);
      const st: CharStyle = {};
      const b = r.pos;
      let sizeVar = 0;
      if (len >= 1) { const f = r.u8At(b); st.bold = !!(f & 1); st.italic = !!(f & 2); }
      if (len >= 3) st.fontIndex = r.u8At(b + 2);
      if (len >= 9 && r.u8At(b + 8) & 1) st.underline = 1;
      if (len >= 5) sizeVar = len >= 6 ? (r.u16At(b + 4) << 16) >> 16 : (r.u8At(b + 4) << 24) >> 24;
      if (len >= 16) { const ref = colorRef2k(r.u32At(b + 0xc)); let ci = info.colors.indexOf(ref); if (ci < 0) { info.colors.push(ref); ci = info.colors.length - 1; } st.colorIndex = ci; }
      st.size = 10 + sizeVar / 2;
      styles.set(index, st);
      r.seek(next);
      if (len === 0) break;
    }
    ends.forEach((e, j) => spans.push({ end: e, style: styles.get(styleIdx[j]) || {} }));
  }
  // Text: paragraphs end at CR LF, shapes at form feed.
  const end = Math.min(textEnd, r.length);
  const chars = r.b.subarray(textStart, end);
  let dec: TextDecoder | null = null;
  try { dec = new TextDecoder(guessCodePage(chars)); } catch { dec = null; }
  const decode = (a: number, b: number) => (dec ? dec.decode(chars.subarray(a, b)) : String.fromCharCode(...chars.subarray(a, b)));
  let shape = 0, paraStart = 0, si = 0, spanStart = 0;
  let paras: QPara[] = [];
  let cur: { text: string; style: CharStyle }[] = [];
  const closePara = (upto: number) => {
    // Split the paragraph's bytes into spans at the span ends.
    let a = Math.max(paraStart, spanStart);
    while (a < upto) {
      while (si < spans.length && spans[si].end <= a) si++;
      const b = Math.min(upto, si < spans.length ? spans[si].end : upto);
      const text = decode(a, b).replace(/\r?\n/g, '').replace(/\x0b/g, '\n').replace(/\x0c/g, '');
      if (text) cur.push({ text, style: si < spans.length ? spans[si].style : {} });
      a = b;
    }
    spanStart = upto;
    paras.push({ spans: cur.length ? cur : [{ text: '', style: {} }], style: {} });
    cur = [];
    paraStart = upto;
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === 0x0d && chars[i + 1] === 0x0a) { closePara(i + 2); i++; }
    else if (c === 0x0c) { if (i > paraStart) closePara(i); else paraStart = i + 1; info.texts.set(shape++, paras); paras = []; spanStart = i + 1; paraStart = i + 1; }
  }
  if (chars.length > paraStart) closePara(chars.length);
  if (paras.length) info.texts.set(shape, paras);
  return info;
}
