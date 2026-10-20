/**
 * A small TrueType / OpenType reader for PDF embedding and user fonts: metrics (head, hhea, hmtx,
 * OS/2, post), the character map (cmap formats 4 and 12), the name table (family, subfamily,
 * PostScript name), embedding permissions (OS/2 fsType), and glyph subsetting (loca/glyf, with
 * composite components kept) for TrueType outlines. CFF-based OpenType fonts ("OTTO") are read for
 * their metrics and names; their outlines are embedded whole. Written from the OpenType
 * specification; only what QuillPress needs.
 */
import { buildSfnt, tableChecksum, type SfntTable } from './woff';

export interface GlyphBox { xMin: number; yMin: number; xMax: number; yMax: number }

export class TrueTypeFont {
  readonly tables = new Map<string, Uint8Array>();
  readonly unitsPerEm: number;
  readonly bbox: GlyphBox;
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly xHeight: number;
  readonly italicAngle: number;
  readonly weightClass: number;
  readonly fixedPitch: boolean;
  readonly psName: string;
  readonly numGlyphs: number;
  readonly indexToLocFormat: number;
  /** Outlines are CFF (an "OTTO" OpenType font): no glyf/loca, so no subsetting. */
  readonly cff: boolean;
  /** OS/2 fsType embedding permissions (0 = installable). */
  readonly fsType: number;
  /** OS/2 fsSelection bit 0 or head macStyle bit 1: an italic face. */
  readonly italic: boolean;
  /** Name records by name id (typographic family 16, subfamily 17, family 1, subfamily 2, full 4, PostScript 6). */
  readonly names = new Map<number, string>();
  private readonly cmap = new Map<number, number>();
  private readonly advances: number[];
  private readonly loca: number[];

  constructor(public readonly bytes: Uint8Array) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag0 = dv.getUint32(0);
    this.cff = tag0 === 0x4f54544f; // 'OTTO'
    const numTables = dv.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
      const off = dv.getUint32(o + 8), len = dv.getUint32(o + 12);
      this.tables.set(tag, bytes.subarray(off, Math.min(bytes.length, off + len)));
    }
    const head = this.table('head'), hhea = this.table('hhea'), maxp = this.table('maxp');
    if (!head || !hhea || !maxp) throw new Error('Font lacks head, hhea or maxp');
    const hd = view(head), hh = view(hhea);
    this.unitsPerEm = hd.getUint16(18) || 1000;
    this.bbox = { xMin: hd.getInt16(36), yMin: hd.getInt16(38), xMax: hd.getInt16(40), yMax: hd.getInt16(42) };
    this.indexToLocFormat = hd.getInt16(50);
    this.numGlyphs = view(maxp).getUint16(4);
    let ascent = hh.getInt16(4), descent = hh.getInt16(6);
    let cap = 0, xh = 0, weight = 400, fsType = 0, italic = (hd.getUint16(44) & 2) !== 0;
    const os2 = this.table('OS/2');
    if (os2 && os2.length >= 78) {
      const o = view(os2);
      weight = o.getUint16(4) || 400;
      fsType = o.getUint16(8);
      italic = (o.getUint16(62) & 1) !== 0 || italic;
      const ta = o.getInt16(68), td = o.getInt16(70);
      if (ta) { ascent = ta; descent = td; }
      if (o.getUint16(0) >= 2 && os2.length >= 90) { xh = o.getInt16(86); cap = o.getInt16(88); }
    }
    this.ascent = ascent; this.descent = descent; this.weightClass = weight; this.fsType = fsType; this.italic = italic;
    this.capHeight = cap || Math.round(this.unitsPerEm * 0.7);
    this.xHeight = xh || Math.round(this.unitsPerEm * 0.5);
    const post = this.table('post');
    this.italicAngle = post && post.length >= 16 ? view(post).getInt32(4) / 65536 : 0;
    this.fixedPitch = !!post && post.length >= 16 && view(post).getUint32(12) !== 0;
    // hmtx
    const nHM = hh.getUint16(34);
    const hmtx = this.table('hmtx');
    this.advances = [];
    if (hmtx) {
      const hv = view(hmtx);
      for (let g = 0; g < this.numGlyphs; g++) this.advances.push(g < nHM ? hv.getUint16(g * 4) : hv.getUint16((nHM - 1) * 4));
    }
    // loca
    const loca = this.table('loca');
    this.loca = [];
    if (loca) {
      const lv = view(loca);
      const n = this.numGlyphs + 1;
      for (let g = 0; g < n; g++) this.loca.push(this.indexToLocFormat === 0 ? (g * 2 + 2 <= loca.length ? lv.getUint16(g * 2) * 2 : 0) : (g * 4 + 4 <= loca.length ? lv.getUint32(g * 4) : 0));
    }
    this.readNames();
    this.psName = (this.names.get(6) || '').replace(/[^\x21-\x7e]/g, '').replace(/[()<>[\]{}/%]/g, '') || 'Font';
    this.readCmap();
  }

  /** The font's family name (typographic family when present). */
  get family(): string { return (this.names.get(16) || this.names.get(1) || this.psName.split('-')[0] || 'Font').trim(); }
  /** The style name ("Regular", "Bold Italic"…). */
  get subfamily(): string { return (this.names.get(17) || this.names.get(2) || 'Regular').trim(); }
  /**
   * Whether the license bits allow embedding in documents: everything except "Restricted License"
   * (bit 1 set without the preview/print or editable bits).
   */
  get embeddable(): boolean { return !((this.fsType & 0x0002) !== 0 && (this.fsType & 0x000c) === 0); }

  table(tag: string): Uint8Array | undefined { return this.tables.get(tag); }

  /** Glyph id for a code point (0 when the font has no glyph). */
  glyphFor(cp: number): number { return this.cmap.get(cp) || 0; }
  hasGlyph(cp: number): boolean { return this.cmap.has(cp); }
  /** Advance width of a glyph in font units. */
  advance(gid: number): number { return this.advances[gid] ?? this.advances[0] ?? Math.round(this.unitsPerEm / 2); }
  /** Advance width in 1/1000 em (PDF /W units). */
  width1000(gid: number): number { return Math.round((this.advance(gid) * 1000) / this.unitsPerEm); }
  get glyphCount(): number { return this.numGlyphs; }

  /** Reads the name table: Windows/Unicode records (UTF-16BE) win over Macintosh ones; English first. */
  private readNames(): void {
    const name = this.table('name');
    if (!name || name.length < 6) return;
    const dv = view(name);
    const count = dv.getUint16(2), strOff = dv.getUint16(4);
    const rank = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 12;
      if (o + 12 > name.length) break;
      const platform = dv.getUint16(o), lang = dv.getUint16(o + 4), nameId = dv.getUint16(o + 6), len = dv.getUint16(o + 8), off = dv.getUint16(o + 10);
      const s = name.subarray(strOff + off, strOff + off + len);
      if (s.length !== len || !len) continue;
      let text: string;
      let r: number;
      if (platform === 3 || platform === 0) {
        let t = ''; for (let k = 0; k + 1 < s.length; k += 2) t += String.fromCharCode((s[k] << 8) | s[k + 1]);
        text = t; r = platform === 3 && (lang === 0x409 || lang === 0) ? 3 : 2;
      } else if (platform === 1) { text = macRoman(s); r = 1; } else continue;
      text = text.replace(/\0/g, '').trim();
      if (!text) continue;
      if ((rank.get(nameId) ?? 0) < r) { rank.set(nameId, r); this.names.set(nameId, text); }
    }
  }

  private readCmap(): void {
    const cmap = this.table('cmap');
    if (!cmap) return;
    const dv = view(cmap);
    const n = dv.getUint16(2);
    const subtables: { platform: number; encoding: number; offset: number }[] = [];
    for (let i = 0; i < n; i++) subtables.push({ platform: dv.getUint16(4 + i * 8), encoding: dv.getUint16(6 + i * 8), offset: dv.getUint32(8 + i * 8) });
    const prefer = (p: number, e: number) => subtables.find((s) => s.platform === p && s.encoding === e);
    const order = [prefer(3, 10), prefer(0, 4), prefer(0, 6), prefer(3, 1), prefer(0, 3), prefer(0, 2), prefer(0, 1), prefer(0, 0)].filter(Boolean) as typeof subtables;
    for (const st of order) {
      if (st.offset + 4 > cmap.length) continue;
      const format = dv.getUint16(st.offset);
      if (format === 4) this.readFormat4(dv, st.offset);
      else if (format === 12) this.readFormat12(dv, st.offset);
      else continue;
      if (this.cmap.size) break;
    }
  }

  private readFormat4(dv: DataView, o: number): void {
    const segX2 = dv.getUint16(o + 6), segs = segX2 / 2;
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, rangeOffs = deltas + segX2;
    for (let s = 0; s < segs; s++) {
      const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2), delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(rangeOffs + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const addr = rangeOffs + s * 2 + ro + (c - start) * 2;
          if (addr + 2 > dv.byteLength) continue;
          g = dv.getUint16(addr);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) this.cmap.set(c, g);
      }
    }
  }

  private readFormat12(dv: DataView, o: number): void {
    const nGroups = dv.getUint32(o + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = o + 16 + i * 12;
      if (g + 12 > dv.byteLength) break;
      const start = dv.getUint32(g), end = dv.getUint32(g + 4), gid = dv.getUint32(g + 8);
      for (let c = start; c <= end && c - start < 65536; c++) this.cmap.set(c, gid + (c - start));
    }
  }

  /** The glyph's data (empty for blank glyphs). */
  glyphData(gid: number): Uint8Array {
    const glyf = this.table('glyf');
    if (!glyf || gid + 1 >= this.loca.length) return new Uint8Array(0);
    const a = this.loca[gid], b = this.loca[gid + 1];
    if (b <= a || b > glyf.length) return new Uint8Array(0);
    return glyf.subarray(a, b);
  }

  /** Component glyphs of a composite glyph (none for simple glyphs). */
  components(gid: number): number[] {
    const d = this.glyphData(gid);
    if (d.length < 10) return [];
    const dv = view(d);
    if (dv.getInt16(0) >= 0) return [];
    const out: number[] = [];
    let o = 10;
    for (;;) {
      if (o + 4 > d.length) break;
      const flags = dv.getUint16(o), idx = dv.getUint16(o + 2);
      out.push(idx);
      o += 4;
      o += flags & 1 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
      if (flags & 8) o += 2; // WE_HAVE_A_SCALE
      else if (flags & 0x40) o += 4; // WE_HAVE_AN_X_AND_Y_SCALE
      else if (flags & 0x80) o += 8; // WE_HAVE_A_TWO_BY_TWO
      if (!(flags & 0x20)) break; // MORE_COMPONENTS
    }
    return out;
  }

  /**
   * A TrueType subset keeping the given glyph ids (with .notdef and composite components) at their
   * original ids, so a CID font can use /CIDToGIDMap /Identity. Unused glyphs become empty.
   */
  subset(gids: Iterable<number>): Uint8Array {
    const keep = new Set<number>([0]);
    const stack = [...gids];
    while (stack.length) {
      const g = stack.pop()!;
      if (g < 0 || g >= this.numGlyphs || keep.has(g)) continue;
      keep.add(g);
      stack.push(...this.components(g));
    }
    const glyphs: Uint8Array[] = [];
    let total = 0;
    for (let g = 0; g < this.numGlyphs; g++) {
      const d = keep.has(g) ? this.glyphData(g) : new Uint8Array(0);
      const padded = Math.ceil(d.length / 4) * 4;
      glyphs.push(d);
      total += padded;
    }
    const glyf = new Uint8Array(total);
    const loca = new Uint8Array((this.numGlyphs + 1) * 4);
    const lv = new DataView(loca.buffer);
    let pos = 0;
    glyphs.forEach((d, g) => { lv.setUint32(g * 4, pos); glyf.set(d, pos); pos += Math.ceil(d.length / 4) * 4; });
    lv.setUint32(this.numGlyphs * 4, pos);
    const head = this.table('head')!.slice();
    new DataView(head.buffer).setInt16(50, 1); // long loca offsets
    const tables: SfntTable[] = [{ tag: 'head', data: head }, { tag: 'loca', data: loca }, { tag: 'glyf', data: glyf }];
    for (const tag of ['hhea', 'maxp', 'hmtx', 'cvt ', 'fpgm', 'prep', 'OS/2']) { const t = this.table(tag); if (t) tables.push({ tag, data: t.slice() }); }
    // post format 3: no glyph names.
    const post = new Uint8Array(32);
    const pv = new DataView(post.buffer);
    pv.setUint32(0, 0x00030000);
    const src = this.table('post');
    if (src && src.length >= 32) post.set(src.subarray(4, 32), 4);
    tables.push({ tag: 'post', data: post });
    return buildSfnt(tables);
  }
}

function view(u8: Uint8Array): DataView { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }

const MAC_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
/** Mac Roman bytes (the name table's Macintosh platform) as text. */
export function macRoman(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += c < 128 ? String.fromCharCode(c) : MAC_HIGH[c - 128] || '?';
  return s;
}

export { tableChecksum };
