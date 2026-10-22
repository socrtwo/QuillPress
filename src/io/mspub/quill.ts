/**
 * The Quill text stream ("Quill/QuillSub/CONTENTS") of Publisher 2000 and later: a chain of chunk
 * reference lists (from offset 0x18) names four-character chunks. TEXT holds every story as UTF-16;
 * STRS the story lengths; SYID the story ids that shapes refer to; FDPC and FDPP the character and
 * paragraph formatting runs (stream positions where a run ends and the offset of its property
 * block); STSH the default styles; FONT the font names; "PL  " the text colors; "TCD " the cell
 * ends of table stories.
 *
 * Written from the format description of the Document Liberation Project's Publisher reader.
 */
import { Reader } from './cfbStreams';
import { readBlock, blocks, children, isContainer } from './contents';

export interface CharStyle {
  bold?: boolean; italic?: boolean;
  /** 0 none, 1 single, 3 double, 0xb wave… (the file's code). */
  underline?: number;
  /** Points. */
  size?: number;
  colorIndex?: number;
  fontIndex?: number;
  /** 1 superscript, 2 subscript. */
  superSub?: number;
  outline?: boolean; shadow?: boolean; smallCaps?: boolean; allCaps?: boolean;
  /** Percent. */
  scale?: number;
  lcid?: number;
}

export interface ParaStyle {
  /** 0 left, 1 right, 2 center, 6 justify. */
  align?: number;
  defaultCharStyle?: number;
  /** Points when `lineSpacingPt`, else a multiple of single spacing. */
  lineSpacing?: number;
  lineSpacingPt?: boolean;
  spaceBefore?: number; spaceAfter?: number; firstIndent?: number; leftIndent?: number; rightIndent?: number;
  /** EMU. */
  tabs?: number[];
  /** `none`: the paragraph explicitly is not a list item (numbering type 0xFF), overriding its style. */
  list?: { bulletChar?: number; numbering?: number; restart?: number; none?: boolean };
  dropCapLines?: number; dropCapLetters?: number;
}

export interface QSpan { text: string; style: CharStyle }
export interface QPara { spans: QSpan[]; style: ParaStyle }

export interface QuillInfo {
  texts: Map<number, QPara[]>;
  fonts: string[];
  /** Color references of the text palette (see colorOf in collect.ts). */
  colors: number[];
  defaultChar: CharStyle[];
  defaultPara: ParaStyle[];
  /** Byte offsets of cell ends inside a table story, by text id. */
  cellEnds: Map<number, number[]>;
}

interface ChunkRef { name: string; id: number; offset: number; length: number }

function readChunkRefs(r: Reader): ChunkRef[] {
  const refs: ChunkRef[] = [];
  const seen = new Set<number>();
  let listOffset = 0x18;
  while (listOffset !== 0xffffffff && listOffset + 8 <= r.length && !seen.has(listOffset)) {
    seen.add(listOffset);
    r.seek(listOffset + 2);
    const n = r.u16();
    listOffset = r.u32();
    for (let i = 0; i < n && r.pos + 24 <= r.length; i++) {
      r.u16();
      const name = String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8());
      const id = r.u16();
      r.skip(4);
      r.skip(4); // second name
      const offset = r.u32(), length = r.u32();
      refs.push({ name, id, offset, length });
    }
  }
  return refs;
}

export function readCharStyle(r: Reader): CharStyle {
  const st: CharStyle = {};
  const offset = r.pos, len = r.u32();
  for (const b of blocks(r, offset + len)) {
    switch (b.id) {
      case 0x02: st.bold = true; break;
      case 0x03: st.italic = true; break;
      case 0x1e: st.underline = b.data & 0xff; break;
      case 0x0c: st.size = (b.data * 72) / 914400; break;
      case 0x2e: st.colorIndex = b.data; break;
      case 0x44: if (isContainer(b.type)) { const p = r.pos; for (const sb of children(r, b)) if (sb.id === 0) { st.colorIndex = sb.data; break; } r.seek(Math.max(p, b.dataOffset + b.dataLength)); } break;
      case 0x24: if (isContainer(b.type)) { const p = r.pos; for (const sb of children(r, b)) { if (isContainer(sb.type)) { r.seek(sb.dataOffset + 4); if (r.pos < sb.dataOffset + sb.dataLength) st.fontIndex = readBlock(r, true).data; break; } } r.seek(Math.max(p, b.dataOffset + b.dataLength)); } break;
      case 0x0f: st.superSub = b.data > 2 ? 0 : b.data; break;
      case 0x04: st.outline = true; break;
      case 0x05: st.shadow = true; break;
      case 0x13: st.smallCaps = true; break;
      case 0x14: st.allCaps = true; break;
      case 0x20: st.scale = b.data / 10; break;
      case 0x12: st.lcid = b.data; break;
    }
  }
  r.seek(offset + len);
  return st;
}

export function readParaStyle(r: Reader): ParaStyle {
  const st: ParaStyle = {};
  const offset = r.pos, len = r.u32();
  let isList = false, bulletChar = 0, numbering = 0, restart: number | undefined;
  for (const b of blocks(r, offset + len)) {
    switch (b.id) {
      case 0x04: { const a = b.data & 0xff; st.align = a === 2 || a === 1 || a === 6 ? a : 0; break; }
      case 0x19: st.defaultCharStyle = b.data; break;
      case 0x34:
        if (b.data & 1) { st.lineSpacing = ((b.data - 1) / 8) * 72 / 914400; st.lineSpacingPt = true; }
        else if (b.data & 2) { st.lineSpacing = ((b.data - 2) / 914400) * 72 / 96; st.lineSpacingPt = false; }
        break;
      case 0x12: st.spaceBefore = b.data; break;
      case 0x13: st.spaceAfter = b.data; break;
      case 0x0c: st.firstIndent = b.data | 0; break;
      case 0x0d: st.leftIndent = b.data; break;
      case 0x0e: st.rightIndent = b.data; break;
      case 0x32: if (isContainer(b.type)) {
        const tabs: number[] = [];
        for (const arr of children(r, b)) {
          if (arr.id !== 0x28 || !isContainer(arr.type)) continue;
          for (const e of children(r, arr)) {
            if (!isContainer(e.type)) continue;
            r.seek(e.dataOffset + 4);
            if (r.pos < e.dataOffset + e.dataLength) { const t = readBlock(r, true); if (t.id === 0) tabs.push(t.data); }
            r.seek(e.dataOffset + e.dataLength);
          }
        }
        r.seek(b.dataOffset + b.dataLength);
        if (tabs.length) st.tabs = tabs;
        break;
      }
      case 0x57: if (isContainer(b.type)) {
        isList = true;
        for (const sb of children(r, b)) { if (sb.id === 0) numbering = sb.data; else if (sb.id === 1) bulletChar = sb.data; }
        r.seek(b.dataOffset + b.dataLength);
        break;
      }
      case 0x15: restart = b.data; break;
      case 0x08: st.dropCapLines = b.data; break;
      case 0x2d: st.dropCapLetters = b.data; break;
    }
  }
  // Numbering type 0xFF switches the list off (Publisher writes it when a list style's bullets are
  // removed from a paragraph); 0x17 marks a bulleted list whose character is the second sub-block.
  if (isList) st.list = bulletChar ? { bulletChar } : numbering === 0xff ? { none: true } : { numbering, restart };
  r.seek(offset + len);
  return st;
}

/** FDPC/FDPP: n run ends (stream positions) and the chunk-relative offsets of their style blocks. */
function readRuns<T>(r: Reader, c: ChunkRef, read: (r: Reader) => T): { end: number; style: T }[] {
  r.seek(c.offset);
  const n = r.u16();
  r.skip(6);
  const ends: number[] = [], offs: number[] = [];
  for (let i = 0; i < n; i++) ends.push(r.u32());
  for (let i = 0; i < n; i++) offs.push(r.u16());
  const out: { end: number; style: T }[] = [];
  for (let i = 0; i < n; i++) {
    r.seek(c.offset + offs[i]);
    out.push({ end: ends[i], style: r.pos + 4 <= r.length ? read(r) : ({} as T) });
  }
  return out;
}

export function parseQuill(quill: Uint8Array): QuillInfo {
  const r = new Reader(quill);
  const refs = readChunkRefs(r);
  const info: QuillInfo = { texts: new Map(), fonts: [], colors: [], defaultChar: [], defaultPara: [], cellEnds: new Map() };
  let textChunk: ChunkRef | undefined;
  const lengths: number[] = [], ids: number[] = [];
  const spans: { end: number; style: CharStyle }[] = [], paras: { end: number; style: ParaStyle }[] = [];
  const cellEndsByIndex = new Map<number, number[]>();
  let stshSeen = 0;
  for (const c of refs) {
    if (c.offset >= r.length) continue;
    switch (c.name) {
      case 'TEXT': textChunk = c; break;
      case 'STRS': {
        r.seek(c.offset);
        const n = r.u32();
        r.seek(c.offset + 4 + r.u32());
        for (let j = 0; j < n && r.pos + 4 <= r.length; j++) lengths.push(r.u32());
        break;
      }
      case 'SYID': {
        r.seek(c.offset); r.u32();
        const n = r.u32();
        for (let j = 0; j < n && r.pos + 4 <= r.length; j++) ids.push(r.u32());
        break;
      }
      case 'PL  ': {
        r.seek(c.offset);
        const n = r.u32();
        r.skip(8);
        for (let i = 0; i < n && r.pos < r.length; i++) {
          const start = r.pos, len = r.u32();
          for (const b of blocks(r, start + len)) if (b.id === 0x01) info.colors.push(b.data);
          r.seek(start + Math.max(4, len));
        }
        break;
      }
      case 'FDPC': spans.push(...readRuns(r, c, readCharStyle)); break;
      case 'FDPP': paras.push(...readRuns(r, c, readParaStyle)); break;
      case 'STSH':
        if (stshSeen++ === 1) {
          r.seek(c.offset); r.u32();
          const n = Math.min(r.u32(), 4096);
          r.skip(12);
          const offs: number[] = [];
          for (let i = 0; i < n; i++) offs.push(r.u32());
          offs.forEach((o, i) => {
            r.seek(c.offset + 20 + o); r.u16();
            if (r.pos + 4 > r.length) return;
            if (i % 2 === 0) info.defaultChar.push(readCharStyle(r)); else info.defaultPara.push(readParaStyle(r));
          });
        }
        break;
      case 'FONT': {
        r.seek(c.offset); r.u32();
        const n = Math.min(r.u32(), 4096);
        r.skip(12 + 4 * n);
        for (let i = 0; i < n && r.pos < r.length; i++) {
          const nameLen = r.u16();
          if (nameLen > 0) info.fonts.push(r.utf16(nameLen * 2));
          r.u32();
        }
        break;
      }
      case 'TCD ': {
        r.seek(c.offset);
        const n = r.u32() + 1;
        r.seek(c.offset + 0xc);
        const ends: number[] = [];
        for (let i = 0; i < n && r.pos + 4 <= r.length; i++) ends.push(r.u32() + (i !== n - 1 ? 2 : 0));
        cellEndsByIndex.set(c.id, ends);
        break;
      }
    }
  }
  if (!textChunk || !lengths.length || !ids.length) return info;
  // Walk the text once, closing character runs and paragraphs at their recorded ends.
  const base = textChunk.offset;
  let pos = base, si = 0, pi = 0;
  for (let j = 0; j < ids.length && j < lengths.length; j++) {
    const out: QPara[] = [];
    let cur: QSpan[] = [];
    let text = '';
    for (let k = 0; k < lengths[j] && pi < paras.length && pos + 1 < r.length; k++) {
      text += String.fromCharCode(r.u16At(pos));
      pos += 2;
      if (si < spans.length && pos - base >= spans[si].end - base) { if (text) cur.push({ text, style: spans[si].style }); si++; text = ''; }
      if (pos - base >= paras[pi].end - base) {
        if (text) cur.push({ text, style: spans[Math.min(si, spans.length - 1)]?.style || {} });
        text = '';
        if (cur.length) out.push({ spans: cur, style: paras[pi].style });
        pi++; cur = [];
      }
    }
    if (text) cur.push({ text, style: spans[Math.min(si, spans.length - 1)]?.style || {} });
    if (cur.length && pi < paras.length) out.push({ spans: cur, style: paras[pi].style });
    else if (cur.length) out.push({ spans: cur, style: paras[paras.length - 1]?.style || {} });
    info.texts.set(ids[j], out);
    const ce = cellEndsByIndex.get(j);
    if (ce) info.cellEnds.set(ids[j], ce);
  }
  return info;
}

/** Plain text of a Quill story (paragraphs joined with newlines; paragraph marks removed). */
export function quillPlainText(paras: QPara[]): string {
  return paras.map((p) => p.spans.map((s) => s.text).join('').replace(/\r$/, '')).join('\n');
}
