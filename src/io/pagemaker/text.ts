/**
 * Text of a PageMaker text block: the characters (8-bit, platform encoding), the character runs
 * (font, size, color, style flags, kerning, super/subscript) and the paragraph runs (alignment,
 * indents, spacing, hyphenation, keeps, rules). Runs are lengths over the character stream; a
 * paragraph's text ends with a return.
 */
import { REC, recordAt, withSeq, bytesOf, UNITS_PER_POINT, type PmFile } from './records';
import { decode } from '../qxp/text';
import type { Paragraph, Run, RunProps, ParaProps } from '../../model/types';

export interface PmChar {
  length: number; font: number; size: number; color: number; tint: number;
  /** Leading in tenths of a point; 0xffff is automatic leading. */
  leading: number;
  bold: boolean; italic: boolean; underline: boolean; outline: boolean; shadow: boolean; strike: boolean;
  sup: boolean; sub: boolean; allCaps: boolean; smallCaps: boolean;
  /** Thousandths of an em. */
  kerning: number;
  superSubSize: number; subPos: number; superPos: number;
  /** Horizontal scale in tenths of a percent (0xffff = normal width). */
  hscale: number;
  /** Track: 0 very loose … 4 very tight, 0x7f no track. */
  track: number;
  /** "No break": the run is kept on one line. */
  noBreak: boolean;
  /** Baseline shift in twentieths of a point, positive up. */
  shift: number;
}

export interface PmRule { type: number; width: number; color: number; tint: number }

export interface PmPara {
  length: number; hyphenate: boolean; align: number;
  /** Shape units. */
  left: number; first: number; right: number; before: number; after: number;
  keepTogether: boolean; keepWithNext: boolean;
  /** Automatic leading as a percentage of the type size (PageMaker's default is 120). */
  autoLeading: number;
  ruleAbove?: PmRule; ruleBelow?: PmRule;
}

export interface PmText { bytes: Uint8Array; chars: PmChar[]; paras: PmPara[] }

/** The text block with the given id (from its shape record), or an empty block when not found. */
export function readTextBlock(file: PmFile, id: number): PmText {
  let textSeq = -1, charsSeq = -1, paraSeq = -1;
  for (const rec of file.byType.get(REC.TEXT_BLOCK) || []) {
    for (let i = 0; i < rec.count; i++) {
      const r = recordAt(file, rec, i);
      r.skip(0x20);
      if (r.u32() !== id) continue;
      const s = recordAt(file, rec, i);
      s.skip(4);
      textSeq = s.u16(); charsSeq = s.u16(); paraSeq = s.u16();
    }
  }
  const empty: PmText = { bytes: new Uint8Array(0), chars: [], paras: [] };
  if (textSeq < 0) return empty;
  const parts = withSeq(file, textSeq).map((rec) => bytesOf(file, rec));
  const bytes = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  const chars: PmChar[] = [];
  for (const rec of withSeq(file, charsSeq)) {
    if (rec.type !== REC.CHARS) continue;
    for (let i = 0; i < rec.count; i++) {
      try {
        const r = recordAt(file, rec, i);
        const length = r.u16(), font = r.u16(), size = r.u16(), leading = r.u16();
        // 0 length, 2 font, 4 size and 6 leading (tenths of a point), 8 colour, 10 style flags,
        // 12 horizontal scale (tenths of a percent, 0xffff normal), 14 track (byte), 15 line-end flags
        // (0x08 no break), 16 manual kerning (thousandths of an em), 18 small-caps size, 20 super/
        // subscript size, 22 subscript and 24 superscript position (tenths of a percent), 26 baseline
        // shift (twentieths of a point, positive up), 28 tint. Checked on a Mac PageMaker 6.0 file
        // whose text names each attribute it carries.
        const color = r.u16();
        const f = r.u16();
        const hscale = r.u16();
        const track = r.u8(), lineFlags = r.u8();
        const kerning = r.i16();
        r.skip(2);
        const superSubSize = r.u16(), subPos = r.u16(), superPos = r.u16();
        const shift = r.i16();
        const tint = r.u16();
        chars.push({ length, font, size, leading, color, tint, kerning, superSubSize, subPos, superPos, hscale, track, noBreak: !!(lineFlags & 0x08), shift, bold: !!(f & 1), italic: !!(f & 2), underline: !!(f & 4), outline: !!(f & 8), shadow: !!(f & 0x10), strike: !!(f & 0x100), sup: !!(f & 0x200), sub: !!(f & 0x400), allCaps: !!(f & 0x800), smallCaps: !!(f & 0x1000) });
      } catch { break; }
    }
  }
  const paras: PmPara[] = [];
  for (const rec of withSeq(file, paraSeq)) {
    if (rec.type !== REC.PARA) continue;
    for (let i = 0; i < rec.count; i++) {
      try {
        const r = recordAt(file, rec, i);
        const length = r.u16();
        const flags = r.u8();
        const align = r.u8();
        r.skip(6);
        const left = r.i16(), first = r.i16(), right = r.i16(), before = r.u16(), after = r.u16(); // first is negative for hanging indents
        // 20: pair-kerning threshold (tenths of a point), 22: automatic leading (%), 24–29: word spacing
        // minimum, maximum, desired (%), 30–35: letter spacing minimum, maximum, desired (%), 36: default
        // tab interval (twips).
        r.skip(2);
        const autoLeading = r.u16();
        r.skip(14);
        r.skip(1); // hyphens in a row
        r.skip(1);
        const keep = r.u16();
        r.skip(2);
        const ruleAbove = readRule(r), ruleBelow = readRule(r);
        paras.push({ length, hyphenate: !!(flags & 0x8), align, left, first, right, before, after, keepTogether: !!(keep & 1), keepWithNext: ((keep >> 1) & 3) > 0, autoLeading: autoLeading > 0 && autoLeading < 1000 ? autoLeading : 120, ruleAbove, ruleBelow });
      } catch { break; }
    }
  }
  return { bytes, chars, paras };
}

function readRule(r: { u16: () => number; u8: () => number; u32: () => number; skip: (n: number) => void }): PmRule | undefined {
  const flags = r.u16();
  if (!(flags & 1)) { r.skip(16); return undefined; }
  const type = r.u8();
  r.skip(1);
  const width = r.u32() / 256; // fifths of a point, 24.8 fixed point (as shape stroke widths)
  const color = r.u16(), tint = r.u16();
  r.skip(6);
  return { type, width, color, tint };
}

// ------------------------------------------------------------------------------------------
// Conversion

export interface TextEnv { fonts: string[]; colors: string[]; encoding: 'windows-1252' | 'macintosh' }

const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (units: number) => r2(units / UNITS_PER_POINT);

export function tinted(color: string, tint: number): string {
  const k = Math.max(0, Math.min(100, tint)) / 100;
  if (k >= 1 || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return '#' + c.map((v) => Math.round(v + (255 - v) * (1 - k)).toString(16).padStart(2, '0')).join('');
}

/** Scale the text engine applies to runs with a baseline shift (src/render/text.ts). */
const SHIFTED_RUN_SCALE = 0.67;

export function runProps(c: PmChar, env: TextEnv): RunProps {
  const p: RunProps = {};
  const font = env.fonts[c.font];
  if (font) p.font = font;
  let size = c.size / 10;
  // The text engine sets any run with a baseline shift at 67% of its size; PageMaker stores the
  // superscript/subscript size as a fraction of the type size, so the run size is chosen to land there.
  if ((c.sup || c.sub) && c.superSubSize > 0) size = size * (c.superSubSize / 1000) / SHIFTED_RUN_SCALE;
  if (size > 0) p.size = r2(size);
  if (c.bold) p.b = true;
  if (c.italic) p.i = true;
  if (c.underline) p.u = true;
  if (c.strike) p.strike = true;
  if (c.allCaps) p.caps = 'all'; else if (c.smallCaps) p.caps = 'small';
  if (c.sup) p.baseline = c.superPos ? Math.round(c.superPos / 10) : 33;
  else if (c.sub) p.baseline = c.subPos ? -Math.round(c.subPos / 10) : -33;
  const color = env.colors[c.color];
  if (color && (color !== '#000000' || c.tint < 100)) p.color = tinted(color, c.tint);
  if (c.outline) p.outline = true;
  if (c.shadow) p.tshadow = true;
  if (c.hscale !== 0xffff && c.hscale > 0 && c.hscale !== 1000) p.hscale = r2(c.hscale / 10);
  if (c.shift) p.shift = r2(c.shift / 20);
  // Manual kerning plus the track. PageMaker's tracks are tables that depend on the type size; a
  // fixed fraction of an em per track is a close stand-in at text sizes.
  const trackEm = TRACK_EM[c.track] ?? 0;
  const spc = (c.kerning / 1000 + trackEm) * (c.size / 10);
  if (spc && size > 0) p.spc = r2(spc);
  return p;
}

/** Track index (0 very loose … 4 very tight) to added space per character, in ems. */
const TRACK_EM: Record<number, number> = { 0: 0.075, 1: 0.04, 2: 0, 3: -0.025, 4: -0.05 };

/** Automatic leading when a paragraph record does not say: PageMaker's default is 120% of the point size. */
const AUTO_LEADING = 1.2;

/**
 * Paragraph properties, all set explicitly so the importing style's defaults (space after, first-line
 * indent, hyphenation) never leak into PageMaker text.
 */
export function paraProps(p: PmPara, env: TextEnv): ParaProps {
  const o: ParaProps = {
    align: (['l', 'r', 'ctr', 'just', 'justAll'] as const)[p.align] || 'l',
    marL: pt(p.left), marR: pt(p.right), indent: pt(p.first),
    spaceBefore: pt(p.before), spaceAfter: pt(p.after), hyphenate: p.hyphenate,
  };
  if (p.keepTogether) o.keepLines = true;
  if (p.keepWithNext) o.keepWithNext = true;
  const rule = (r: PmRule | undefined) => (r ? { width: r2(Math.max(0.25, r.width / 5)), color: tinted(env.colors[r.color] || '#000000', r.tint) } : undefined);
  const ra = rule(p.ruleAbove), rb = rule(p.ruleBelow);
  if (ra) o.ruleAbove = ra;
  if (rb) o.ruleBelow = rb;
  return o;
}

/** The block's paragraphs with their runs. */
export function textParagraphs(t: PmText, env: TextEnv, style = 'Body'): Paragraph[] {
  const text = decode(t.bytes, env.encoding);
  // Character runs as absolute spans.
  const spans: { start: number; end: number; props: RunProps; noBreak?: boolean }[] = [];
  let pos = 0;
  for (const c of t.chars) { spans.push({ start: pos, end: pos + c.length, props: runProps(c, env), noBreak: c.noBreak }); pos += c.length; }
  if (!spans.length) spans.push({ start: 0, end: text.length, props: {} });
  const out: Paragraph[] = [];
  const paraRanges: [number, number][] = [];
  if (t.paras.length) {
    let p = 0;
    for (const pr of t.paras) { paraRanges.push([p, Math.min(text.length, p + pr.length)]); p += pr.length; }
    if (p < text.length) paraRanges.push([p, text.length]);
  } else {
    let s = 0;
    for (let i = 0; i < text.length; i++) if (text[i] === '\r') { paraRanges.push([s, i + 1]); s = i + 1; }
    if (s < text.length || !paraRanges.length) paraRanges.push([s, text.length]);
  }
  paraRanges.forEach(([a, b], i) => {
    const runs: Run[] = [];
    for (const sp of spans) {
      const s = Math.max(a, sp.start), e = Math.min(b, sp.end);
      if (s >= e) continue;
      // A return inside a paragraph is a line break; only the paragraph's own last return ends it.
      // (Character runs often end with a return, so stripping per run would lose the line breaks.)
      const piece = e === b ? text.slice(s, e).replace(/\r$/, '') : text.slice(s, e);
      const parts = piece.split(/[\r\n]/);
      parts.forEach((part, k) => {
        if (k > 0) runs.push({ text: '', br: true });
        let clean = part.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        // "No break" keeps the run on one line: its spaces become no-break spaces.
        if (sp.noBreak) clean = clean.replace(/ /g, '\u00a0');
        if (clean) runs.push({ text: clean, ...sp.props });
      });
    }
    const pp: ParaProps = t.paras[i] ? paraProps(t.paras[i], env) : { spaceBefore: 0, spaceAfter: 0, indent: 0, hyphenate: false };
    Object.assign(pp, leadingOf(t.chars, a, b, t.paras[i]?.autoLeading ?? AUTO_LEADING * 100));
    out.push({ style, runs: merge(runs), ...pp });
  });
  if (!out.length) out.push({ style, runs: [] });
  return out;
}

/**
 * Leading is a character attribute in PageMaker (a line takes the largest leading on it); the model has
 * one leading per paragraph. The paragraph takes the leading carried by most of its characters:
 * automatic leading becomes the paragraph's auto-leading percentage (which the text engine applies per
 * line to the largest type on it, as PageMaker does), a fixed leading becomes points.
 */
function leadingOf(chars: PmChar[], a: number, b: number, autoPct: number): Pick<ParaProps, 'lineSpacing' | 'lineSpacingPt'> {
  const weight = new Map<number, number>(); // leading in tenths of a point (0 = automatic) → characters
  let pos = 0;
  for (const c of chars) {
    const s = pos, e = pos + c.length;
    pos = e;
    const n = Math.min(e, b) - Math.max(s, a);
    if (n <= 0) continue;
    const key = c.leading !== 0xffff && c.leading > 0 ? c.leading : 0;
    weight.set(key, (weight.get(key) || 0) + n);
  }
  let best = 0, most = -1;
  for (const [k, n] of weight) if (n > most) { best = k; most = n; }
  return best ? { lineSpacing: r2(best / 10), lineSpacingPt: true } : { lineSpacing: autoPct, lineSpacingPt: false };
}

function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !last.br && !r.br && same(last, r)) last.text += r.text;
    else out.push(r);
  }
  return out;
}

function same(a: Run, b: Run): boolean {
  const ka = Object.keys(a).filter((k) => k !== 'text').sort(), kb = Object.keys(b).filter((k) => k !== 'text').sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && (a as any)[k] === (b as any)[k]);
}
