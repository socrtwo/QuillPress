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

interface Layout97 { textIdOffset: number; textMarker: number; firstLine: number; secondLine: number; fillType: number; fillColor: number; coordOffset: number }

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

function shapeOf(r: Reader, c: Chunk, chunks: Chunk[], palette: number[], names: Map<number, string>, L: Layout97, pictures: number[], counts: LDoc['counts'], depth: number): LShape | null {
  if (depth > 32) return null;
  const o = c.offset;
  const s: LShape = { seq: c.seq, kind: c.marker === 0x000f ? 'group' : 'shape', type: 1 };
  let flagsOffset = 0, isRect = false, isLine = false, isImage = false;
  switch (c.marker) {
    case 0x000f: break;
    case 0x0004: isLine = true; flagsOffset = 0x41; s.type = 20; break;
    case 0x0002: isImage = true; isRect = true; break;
    case 0x0005: isRect = true; break;
    case 0x0006: { const t = SHAPES_2K[r.u8At(o + 0x31)]; flagsOffset = 0x33; if (t) s.type = t; else counts.unknownShapes++; break; }
    case 0x0007: s.type = 3; break;
    default:
      if (c.marker === L.textMarker) { isRect = true; s.textId = r.u16At(o + L.textIdOffset); }
      break;
  }
  if (s.kind !== 'group' && !isLine) { const rot = (360 - r.u16At(o + 4) / 10) % 360; if (Math.abs(rot) > 0.01 && Math.abs(rot - 360) > 0.01) s.rot = Math.round(rot * 100) / 100; }
  const xs = r.i32At(o + 6) - L.coordOffset, ys = r.i32At(o + 10) - L.coordOffset, xe = r.i32At(o + 14) - L.coordOffset, ye = r.i32At(o + 18) - L.coordOffset;
  s.box = { xs: Math.min(xs, xe), ys: Math.min(ys, ye), xe: Math.max(xs, xe), ye: Math.max(ys, ye) };
  if (flagsOffset) { const f = r.u8At(o + flagsOffset); if (f & 0x1) s.flipV = true; if (f & (0x2 | 0x10)) s.flipH = true; }
  if (s.kind === 'group') {
    s.children = chunks.filter((k) => k.parent === c.seq && k !== c && (k.marker === 0x000f || k.marker === 0x0002 || (k.marker >= 0x0004 && k.marker <= 0x0008) || k.marker === 0x0000))
      .map((k) => shapeOf(r, k, chunks, palette, names, L, pictures, counts, depth + 1)).filter((k): k is LShape => !!k);
    return s;
  }
  if (isImage) {
    const idx = pictures.indexOf(c.seq);
    if (idx >= 0) s.picture = idx + 1;
  } else if (r.u8At(o + L.fillType) === 2) {
    s.fill = { type: 'solid', color: colorOf(colorRef2k(r.u32At(o + L.fillColor)), palette, names) } as Fill;
  }
  // Strokes: the left line, and for rectangles the top/right/bottom lines; the first that exists is used.
  const sides: { w: number; c: number }[] = [{ w: r.u8At(o + L.firstLine), c: r.u32At(o + L.firstLine + 1) }];
  if (isRect) for (let i = 0; i < 3; i++) { const p = o + L.secondLine + i * 6; sides.unshift({ w: r.u8At(p), c: r.u32At(p + 1) }); }
  const side = sides.find((x) => x.w !== 0);
  if (side) s.line = { color: colorOf(colorRef2k(side.c), palette, names), width: Math.max(0.25, lineWidth2k(side.w)) };
  s.insets = [emuPt(36576), emuPt(36576), emuPt(36576), emuPt(36576)];
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
    ? { textIdOffset: 0x46, textMarker: 0x0000, firstLine: 0x22, secondLine: 0x2d, fillType: 0x20, fillColor: 0x18, coordOffset: (banner ? 120 : 25) * 914400 }
    : { textIdOffset: 0x58, textMarker: 0x0008, firstLine: 0x2c, secondLine: 0x35, fillType: 0x2a, fillColor: 0x22, coordOffset: 0 };
  const palette: number[] = [];
  for (const c of chunks) if (c.marker === 0x0047) for (let j = 0; j < 8; j++) palette.push(color2k(r.u32At(c.offset + 0xa0 + j * 4)));
  const names = new Map<number, string>();
  palette.forEach((_c, i) => names.set(i, `Scheme Color ${i + 1}`));
  const counts = { unknownShapes: 0, borderArt: 0, calcGeometry: 0, unplaced: 0 };
  // Image data chunks hold Windows metafiles; they are counted so the frames can say what is missing.
  const imageData = chunks.filter((c) => c.marker === 0x0021);
  const pictures = imageData.map((c) => c.parent);
  const pageChunks = chunks.filter((c) => c.marker === 0x0014 && !DUMMY.has(c.seq));
  const pages: LPage[] = [];
  for (const pc of pageChunks) {
    const pg: LPage = { seq: pc.seq, shapes: [], isMaster: pc.seq === MASTER_SEQ };
    for (const c of chunks) {
      if (c.parent !== pc.seq || c === pc) continue;
      if (!(c.marker === 0x000f || c.marker === 0x0002 || (c.marker >= 0x0004 && c.marker <= 0x0008) || c.marker === 0x0000)) continue;
      const s = shapeOf(r, c, chunks, palette, names, L, pictures, counts, 0);
      if (s) pg.shapes.push(s);
    }
    pages.push(pg);
  }
  const master = pages.find((p) => p.isMaster);
  if (master) for (const p of pages) if (!p.isMaster) p.master = master.seq;
  const q = doc97 ? parseText97(r, palette) : quill ? remapQuillColors(quill) : null;
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
  let dec: TextDecoder | null = null;
  try { dec = new TextDecoder('windows-1252'); } catch { dec = null; }
  const chars = r.b.subarray(textStart, end);
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
