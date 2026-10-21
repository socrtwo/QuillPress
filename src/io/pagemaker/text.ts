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
  bold: boolean; italic: boolean; underline: boolean; outline: boolean; shadow: boolean; strike: boolean;
  sup: boolean; sub: boolean; allCaps: boolean; smallCaps: boolean;
  /** Thousandths of an em. */
  kerning: number;
  superSubSize: number; subPos: number; superPos: number;
}

export interface PmRule { type: number; width: number; color: number; tint: number }

export interface PmPara {
  length: number; hyphenate: boolean; align: number;
  /** Shape units. */
  left: number; first: number; right: number; before: number; after: number;
  keepTogether: boolean; keepWithNext: boolean;
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
        const length = r.u16(), font = r.u16(), size = r.u16();
        r.skip(2);
        const color = r.u16();
        const f = r.u16();
        r.skip(4);
        const kerning = r.i16();
        r.skip(2);
        const superSubSize = r.u16(), subPos = r.u16(), superPos = r.u16();
        r.skip(2);
        const tint = r.u16();
        chars.push({ length, font, size, color, tint, kerning, superSubSize, subPos, superPos, bold: !!(f & 1), italic: !!(f & 2), underline: !!(f & 4), outline: !!(f & 8), shadow: !!(f & 0x10), strike: !!(f & 0x100), sup: !!(f & 0x200), sub: !!(f & 0x400), allCaps: !!(f & 0x800), smallCaps: !!(f & 0x1000) });
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
        r.skip(18);
        r.skip(1); // hyphens in a row
        r.skip(1);
        const keep = r.u16();
        r.skip(2);
        const ruleAbove = readRule(r), ruleBelow = readRule(r);
        paras.push({ length, hyphenate: !!(flags & 0x8), align, left, first, right, before, after, keepTogether: !!(keep & 1), keepWithNext: ((keep >> 1) & 3) > 0, ruleAbove, ruleBelow });
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
  const width = (r.u32() >> 8) & 0xffff;
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

export function runProps(c: PmChar, env: TextEnv): RunProps {
  const p: RunProps = {};
  const font = env.fonts[c.font];
  if (font) p.font = font;
  let size = c.size / 10;
  if ((c.sup || c.sub) && c.superSubSize > 0) size = size * (c.superSubSize / 1000);
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
  if (c.kerning && size > 0) p.spc = r2((c.kerning / 1000) * size);
  return p;
}

export function paraProps(p: PmPara, env: TextEnv): ParaProps {
  const o: ParaProps = {};
  const align = (['l', 'r', 'ctr', 'just', 'justAll'] as const)[p.align];
  if (align && align !== 'l') o.align = align;
  if (p.left) o.marL = pt(p.left);
  if (p.right) o.marR = pt(p.right);
  if (p.first) o.indent = pt(p.first);
  if (p.before) o.spaceBefore = pt(p.before);
  if (p.after) o.spaceAfter = pt(p.after);
  if (p.hyphenate) o.hyphenate = true;
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
  const spans: { start: number; end: number; props: RunProps }[] = [];
  let pos = 0;
  for (const c of t.chars) { spans.push({ start: pos, end: pos + c.length, props: runProps(c, env) }); pos += c.length; }
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
      const piece = text.slice(s, e).replace(/\r$/, '');
      const parts = piece.split(/[\r\n]/);
      parts.forEach((part, k) => {
        if (k > 0) runs.push({ text: '', br: true });
        const clean = part.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        if (clean) runs.push({ text: clean, ...sp.props });
      });
    }
    const pp = t.paras[i] ? paraProps(t.paras[i], env) : {};
    out.push({ style, runs: merge(runs), ...pp });
  });
  if (!out.length) out.push({ style, runs: [] });
  return out;
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
