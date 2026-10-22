/**
 * The document records at the start of the QuarkXPress document chain: fonts, colors, H&J sets,
 * line styles, character formats, tab stops and paragraph formats. Objects refer to these by index.
 * Every record starts with a 4-byte length; a record that cannot be read is skipped by that length
 * so the ones after it (and the pages) still line up.
 */
import { Reader } from './blocks';
import { QXP_33, QXP_4, type QxpHeader } from './header';

export interface Rgb { r: number; g: number; b: number }
export interface Rect { top: number; left: number; bottom: number; right: number }
export interface Pt { x: number; y: number }

export interface CharFormat {
  font: string;
  size: number;
  bold: boolean; italic: boolean; underline: boolean; wordUnderline: boolean; outline: boolean; shadow: boolean;
  superscript: boolean; subscript: boolean; superior: boolean; strike: boolean; allCaps: boolean; smallCaps: boolean;
  /** '#rrggbb' after the shade is applied. */
  color: string;
  /** Fraction of the type size; positive raises (QuarkXPress shows it in points at the run's size). */
  baselineShift: number;
  /** Horizontal scale, 1 = 100 %. */
  hscale: number;
  /** Tracking plus manual kerning after each character, in 1/200 em. */
  track: number;
  /** The span holds control characters (not shown). */
  control: boolean;
}

export interface TabStop { type: 'l' | 'ctr' | 'r' | 'dec'; alignChar: string; fill: string; pos: number }
export interface Rule { width: number; color: string; dash?: LineStyle; marL: number; marR: number; offset: number }
export interface HJ { minBefore: number; minAfter: number; maxInRow: number; singleWordJustify: boolean; hyphenate: boolean }

export interface ParaFormat {
  align: 'l' | 'ctr' | 'r' | 'just' | 'justAll';
  incrementalLeading: boolean;
  hj?: HJ;
  marL: number; indent: number; marR: number;
  /** Points; 0 = auto leading. */
  leading: number;
  spaceBefore: number; spaceAfter: number;
  ruleAbove?: Rule; ruleBelow?: Rule;
  tabs: TabStop[];
}

export interface LineStyle {
  /** Dash segment lengths as fractions of the pattern (empty = solid). */
  segments: number[];
  stripe: boolean;
  proportional: boolean;
  patternLength: number;
  cap: 'flat' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
}

export const DEFAULT_COLORS: [number, Rgb][] = [
  [0, { r: 255, g: 255, b: 255 }], [1, { r: 0, g: 0, b: 0 }], [2, { r: 255, g: 0, b: 0 }], [3, { r: 0, g: 255, b: 0 }], [4, { r: 0, g: 0, b: 255 }],
  [5, { r: 1, g: 160, b: 198 }], [6, { r: 239, g: 4, b: 127 }], [7, { r: 255, g: 255, b: 0 }], [8, { r: 0, g: 0, b: 0 }],
];

const style = (segments: number[], patternLength: number, cap: LineStyle['cap'] = 'flat'): LineStyle => ({ segments, stripe: false, proportional: true, patternLength, cap, join: 'miter' });
export const DEFAULT_LINE_STYLES: [number, LineStyle][] = [
  [0, style([], 1)], [1, style([0.6, 0.4], 5)], [2, style([0.75, 0.25], 4)], [3, style([0.5455, 0.1818, 0.0909, 0.1818], 11)], [4, style([0, 1], 2, 'round')],
];

export const hex = (c: Rgb) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** A tint of a color: the shade blends it toward white (1 = full color). */
export function shaded(c: Rgb, shade: number): string {
  const k = Math.max(0, Math.min(1, shade));
  return hex({ r: c.r + (255 - c.r) * (1 - k), g: c.g + (255 - c.g) * (1 - k), b: c.b + (255 - c.b) * (1 - k) });
}

/** Document-wide tables shared by the object readers. */
export class QxpTables {
  fonts = new Map<number, string>();
  colors = new Map<number, Rgb>(DEFAULT_COLORS);
  colorNames = new Map<number, string>();
  lineStyles = new Map<number, LineStyle>(DEFAULT_LINE_STYLES);
  hjs: HJ[] = [];
  charFormats: CharFormat[] = [];
  paraFormats: ParaFormat[] = [];
  paraTabStops: TabStop[][] = [];
  warnings: string[] = [];
  readonly v4: boolean;

  constructor(public header: QxpHeader) { this.v4 = header.version >= QXP_4; }

  color(id: number, shade = 1): string { return shaded(this.colors.get(id) || { r: 0, g: 0, b: 0 }, shade); }
  font(id: number): string { return this.fonts.get(id) || ''; }

  /** Reads the document records in the order the version stores them. */
  readAll(r: Reader): void {
    if (this.v4) {
      for (let i = 0; i < 5; i++) skipRecord(r);
      this.record(r, 'fonts', () => this.readFonts(r));
      skipRecord(r);
      this.record(r, 'colors', () => this.readColors4(r));
      this.record(r, 'style sheets', () => this.skipParagraphStylesheets4(r));
      skipRecord(r);
      this.record(r, 'H&Js', () => readCollection(r, () => this.hjs.push(this.readHJ(r))));
      this.record(r, 'line styles', () => readCollection(r, () => this.readLineStyle4(r)));
      skipRecord(r);
      this.record(r, 'templates', () => this.skipTemplates4(r));
      this.record(r, 'character formats', () => readCollection(r, () => this.charFormats.push(this.readCharFormat(r))));
      this.record(r, 'tab stops', () => this.readTabStops4(r));
      this.record(r, 'paragraph formats', () => readCollection(r, () => this.paraFormats.push(this.readParaFormat(r))));
      skipRecord(r);
    } else {
      for (let i = 0; i < 4; i++) skipRecord(r);
      this.record(r, 'fonts', () => this.readFonts(r));
      if (this.header.version === QXP_33) skipRecord(r);
      this.record(r, 'colors', () => this.readColors3(r));
      skipRecord(r);
      skipRecord(r);
      this.record(r, 'H&Js', () => readCollection(r, () => this.hjs.push(this.readHJ(r))));
      skipRecord(r);
      this.record(r, 'character formats', () => readCollection(r, () => this.charFormats.push(this.readCharFormat(r))));
      this.record(r, 'paragraph formats', () => readCollection(r, () => this.paraFormats.push(this.readParaFormat(r))));
      skipRecord(r);
    }
  }

  /** Runs a record reader; on failure the record is skipped by its length and a warning kept. */
  private record(r: Reader, what: string, read: () => void): void {
    const start = r.pos;
    try { read(); } catch (e) {
      this.warnings.push(`The ${what} table could not be read (${(e as Error).message}); defaults are used.`);
      r.seek(start);
      skipRecord(r);
    }
  }

  private readFonts(r: Reader): void {
    const len = r.u32();
    if (len > r.remaining) throw new Error('font table runs past the end');
    const end = r.pos + len;
    try {
      const count = r.u16();
      for (let i = 0; i < count; i++) {
        const index = r.i16();
        if (this.v4) r.skip(2);
        const name = r.platformString();
        r.platformString();
        this.fonts.set(index, cleanFontName(name));
      }
    } catch { /* keep the fonts read so far */ }
    r.seek(end);
  }

  private readColors3(r: Reader): void {
    const len = r.u32();
    const end = r.pos + len;
    try {
      r.skip(1);
      const count = r.u8();
      r.skip(32);
      for (let i = 0; i < count; i++) {
        const id = r.u8();
        r.skip(1);
        const c = { r: r.colorComp(), g: r.colorComp(), b: r.colorComp() };
        this.colors.set(id, c);
        r.skip(42);
        const name = readName(r);
        if (name) this.colorNames.set(id, name);
      }
    } catch { /* partial table */ }
    r.seek(end);
  }

  private readColors4(r: Reader): void {
    const len = r.u32();
    if (len > r.remaining) throw new Error('color table runs past the end');
    const s = new Reader(r.bytes(len), r.be);
    try {
      s.skip(14);
      const blocks = s.u16();
      if (blocks === 0 || blocks * 4 > len) return;
      s.skip(20);
      const offsets: number[] = [0];
      for (let i = 1; i <= blocks; i++) offsets.push(s.u32() & 0x0fffffff);
      for (let i = 2; i <= blocks; i++) {
        s.seek(offsets[i]);
        if (s.u16() + s.u16() !== 6) continue;
        s.skip(30);
        const id = s.u16();
        s.skip(70);
        const rgbBlock = s.u16();
        if (rgbBlock === 0 || rgbBlock >= offsets.length) continue;
        s.seek(offsets[rgbBlock] + 16);
        this.colors.set(id, { r: s.colorComp(), g: s.colorComp(), b: s.colorComp() });
      }
    } catch { /* partial table */ }
  }

  private skipParagraphStylesheets4(r: Reader): void {
    const len = r.u32();
    if (len > r.remaining) throw new Error('style sheet table runs past the end');
    const end = r.pos + len;
    let tabRecords = 0;
    while (r.pos < end) {
      r.skip(90);
      if (r.u16() > 0) tabRecords++;
      r.skip(152);
    }
    r.seek(end);
    for (let i = 0; i < tabRecords; i++) skipRecord(r);
  }

  private skipTemplates4(r: Reader): void {
    const len = r.u32();
    if (len > r.remaining) throw new Error('template table runs past the end');
    const count = r.u32();
    r.skip(len - 4);
    if (count > r.remaining / 4) throw new Error('template count is not plausible');
    for (let i = 0; i < count; i++) skipRecord(r);
  }

  private readHJ(r: Reader): HJ {
    r.skip(4);
    r.skip(1);
    const hj: HJ = { minBefore: r.u8(), minAfter: r.u8(), maxInRow: r.u8(), singleWordJustify: false, hyphenate: false };
    r.skip(4);
    hj.singleWordJustify = r.u8() === 0;
    r.skip(1);
    hj.hyphenate = r.u8() !== 0;
    r.skip(33);
    if (this.v4) r.skip(64); else readName(r);
    return hj;
  }

  private readLineStyle4(r: Reader): void {
    const start = r.pos;
    const end = start + 252;
    try {
      r.skip(168);
      const id = r.u16();
      const st: LineStyle = { segments: [], stripe: r.u8() === 1, proportional: false, patternLength: 1, cap: 'flat', join: 'miter' };
      r.skip(1);
      const n = r.u16();
      if (n > 42) throw new Error('too many dash segments');
      st.proportional = r.u8() === 1;
      r.skip(69);
      st.patternLength = r.fraction();
      st.join = (['miter', 'round', 'bevel'] as const)[r.u16()] || 'miter';
      st.cap = (['flat', 'round', 'square', 'square'] as const)[r.u16()] || 'flat';
      r.seek(start);
      for (let i = 0; i < n; i++) st.segments.push(r.fraction());
      this.lineStyles.set(id, st);
    } catch { /* keep going with the next style */ }
    r.seek(end);
  }

  private readTabStops4(r: Reader): void {
    const specLen = r.u32();
    if (specLen > r.remaining) throw new Error('tab stop table runs past the end');
    const counts: number[] = new Array(Math.floor(specLen / 8)).fill(0);
    for (let i = counts.length - 1; i >= 0; i--) {
      r.skip(2);
      const n = r.u16();
      if (n > r.remaining / 8) throw new Error('tab stop count is not plausible');
      counts[i] = n;
      r.skip(4);
    }
    this.paraTabStops = new Array(counts.length);
    for (let i = counts.length - 1, k = 0; i >= 0; i--, k++) {
      r.skip(4);
      const tabs: TabStop[] = [];
      for (let j = 0; j < counts[k]; j++) tabs.push(readTabStop(r));
      this.paraTabStops[i] = tabs;
    }
  }

  readCharFormat(r: Reader): CharFormat {
    r.skip(this.v4 ? 8 : 2);
    const fontIndex = r.i16();
    const flags = r.u16();
    const size = r.fraction();
    const hscale = r.fraction();
    const colorId = this.v4 ? r.u16() : r.u8();
    r.skip(this.v4 ? 2 : 1);
    const shade = r.fraction();
    // After the shade: 2 bytes unused in the samples, manual kerning (signed, 1/200 em, stored on the
    // first character of a kerned pair), tracking (fixed point, 1/200 em), then the baseline shift.
    r.skip(2);
    const kern = r.i16();
    const tracking = r.fraction();
    const baselineShift = r.fraction();
    const control = r.u8() !== 0;
    r.skip(this.v4 ? 23 : 13);
    return {
      font: this.font(fontIndex), size, color: this.color(colorId, shade), baselineShift, control,
      hscale: hscale > 0.05 && hscale < 10 ? hscale : 1, track: Math.abs(kern + tracking) < 1000 ? kern + tracking : 0,
      bold: !!(flags & 0x1), italic: !!(flags & 0x2), underline: !!(flags & 0x4), outline: !!(flags & 0x8), shadow: !!(flags & 0x10),
      superscript: !!(flags & 0x20), subscript: !!(flags & 0x40), superior: !!(flags & 0x100), strike: !!(flags & 0x200),
      allCaps: !!(flags & 0x400), smallCaps: !!(flags & 0x800), wordUnderline: !!(flags & 0x1000),
    };
  }

  readParaFormat(r: Reader): ParaFormat {
    r.skip(this.v4 ? 8 : 2);
    const flags = r.u8();
    const be = r.be;
    const incrementalLeading = !!(flags & (be ? 0x20 : 0x4));
    const hasRuleAbove = !!(flags & (be ? 0x4 : 0x20));
    const hasRuleBelow = !!(flags & (be ? 0x2 : 0x40));
    r.skip(2);
    const align = (['l', 'ctr', 'r', 'just', 'justAll'] as const)[r.u8()] || 'l';
    r.skip(4);
    const hj = r.u16();
    r.skip(2);
    const p: ParaFormat = { align, incrementalLeading, hj: this.hjs[hj], marL: r.fraction(), indent: r.fraction(), marR: r.fraction(), leading: r.fraction(), spaceBefore: r.fraction(), spaceAfter: r.fraction(), tabs: [] };
    if (this.v4) r.skip(4);
    const above = this.readRule(r);
    const below = this.readRule(r);
    if (hasRuleAbove) p.ruleAbove = above;
    if (hasRuleBelow) p.ruleBelow = below;
    if (this.v4) {
      const tabIndex = r.u16();
      if (tabIndex !== 0xffff && tabIndex < this.paraTabStops.length) p.tabs = this.paraTabStops[tabIndex];
      r.skip(2);
    } else {
      r.skip(8);
      for (let i = 0; i < 20; i++) { const t = readTabStop(r); if (t.pos >= 0 && t.pos < 1e6) p.tabs.push(t); }
      r.skip(6);
    }
    return p;
  }

  private readRule(r: Reader): Rule {
    const width = r.fraction();
    const styleIndex = this.v4 ? r.u16() : r.u8();
    const colorId = this.v4 ? r.u16() : r.u8();
    const shade = r.fraction();
    return { width, dash: this.lineStyles.get(styleIndex), color: this.color(colorId, shade), marL: r.fraction(), marR: r.fraction(), offset: r.fraction() };
  }
}

/** Skips a length-prefixed record. */
export function skipRecord(r: Reader): void {
  const len = r.u32();
  if (len > 0) r.skip(len);
}

/** Reads the items of a length-prefixed record until its end; a failing item ends the record. */
export function readCollection(r: Reader, item: () => void): void {
  const len = r.u32();
  if (len > r.remaining) throw new Error('record runs past the end');
  const end = r.pos + len;
  try { while (r.pos < end) item(); } catch { /* partial */ }
  r.seek(end);
}

/** A platform string padded to an even length (3.x name fields). */
export function readName(r: Reader): string {
  const start = r.pos;
  const name = r.platformString();
  if ((r.pos - start) % 2 === 1) r.skip(1);
  return name;
}

function readTabStop(r: Reader): TabStop {
  const type = (['l', 'ctr', 'r', 'dec'] as const)[r.u8()] || 'l';
  const ac = r.u8();
  const alignChar = ac === 1 ? '.' : ac === 2 ? ',' : ac ? String.fromCharCode(ac) : '';
  const fc = r.u16();
  const fill = fc > 32 && fc < 127 ? String.fromCharCode(fc) : '';
  return { type, alignChar, fill, pos: r.fraction() };
}

/** Font names as stored, without the Windows charset suffixes some files carry. */
function cleanFontName(name: string): string {
  return name.replace(/[\x00-\x1f]/g, '').trim();
}
