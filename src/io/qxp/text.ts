/**
 * Text stories of a QuarkXPress document. A story's chain (named by the text box's content index)
 * lists the blocks holding its characters, then the character-format spans and the paragraph spans,
 * each a (format index, length) pair over the character stream. Paragraphs end with a return (0x0D);
 * 0x0A is a line break inside a paragraph. The characters are in the platform's 8-bit encoding.
 */
import { Reader, getBlock, getChain } from './blocks';
import type { QxpHeader } from './header';
import type { QxpTables, CharFormat, ParaFormat } from './records';
import type { Paragraph, Run, RunProps, ParaProps } from '../../model/types';

export interface Span<T> { format: T | undefined; start: number; length: number }
export interface QxpText { text: string; chars: Span<CharFormat>[]; paras: Span<ParaFormat>[] }

/** Reads the story stored under a content index; throws when the chain is unreadable. */
export function readStory(data: Uint8Array, index: number, header: QxpHeader, t: QxpTables): QxpText {
  const be = header.bigEndian;
  const info = new Reader(getChain(data, index, be), be);
  const v4 = t.v4;
  info.skip(4);
  const bytes: number[] = [];
  const specLen = info.u32();
  const end = Math.min(info.length, info.pos + specLen);
  while (info.pos < end) {
    const blockIndex = info.u32();
    let length = v4 ? info.u32() : info.u16();
    const block = getBlock(data, blockIndex);
    if (!block) continue;
    if (length > block.length) length = block.length;
    for (let i = 0; i < length; i++) bytes.push(block[i]);
  }
  const text = decode(Uint8Array.from(bytes), header.encoding);
  const chars = readSpans(info, t.charFormats, v4);
  const paras = readSpans(info, t.paraFormats, v4);
  return { text, chars, paras };
}

function readSpans<T>(info: Reader, formats: T[], v4: boolean): Span<T>[] {
  const out: Span<T>[] = [];
  if (info.remaining < 4) return out;
  let specLen = info.u32();
  if (specLen > info.remaining) specLen = info.remaining;
  const end = info.pos + specLen;
  while (info.pos + (v4 ? 8 : 6) <= end) {
    const formatIndex = v4 ? info.u32() : info.u16();
    const length = info.u32();
    const start = out.length ? out[out.length - 1].start + out[out.length - 1].length : 0;
    const format = formatIndex < formats.length ? formats[formatIndex] : formats[0];
    out.push({ format, start, length });
  }
  return out;
}

/** 8-bit text in the platform encoding; one character per byte so span offsets stay valid. */
export function decode(b: Uint8Array, encoding: 'windows-1252' | 'macintosh'): string {
  try {
    const s = new TextDecoder(encoding).decode(b);
    if (s.length === b.length) return s;
  } catch { /* no decoder for the label */ }
  return String.fromCharCode(...b);
}

// ------------------------------------------------------------------------------------------
// Conversion to QuillPress paragraphs

export function runProps(f: CharFormat | undefined): RunProps {
  const p: RunProps = {};
  if (!f) return p;
  if (f.font) p.font = f.font;
  if (f.size > 0) p.size = round2(f.size);
  if (f.bold) p.b = true;
  if (f.italic) p.i = true;
  if (f.underline || f.wordUnderline) p.u = true;
  if (f.strike) p.strike = true;
  if (f.allCaps) p.caps = 'all'; else if (f.smallCaps) p.caps = 'small';
  if (f.superscript || f.superior) p.baseline = 33; else if (f.subscript) p.baseline = -33;
  else if (f.baselineShift && f.size > 0) p.baseline = Math.round((f.baselineShift / f.size) * 100);
  if (f.color && f.color !== '#000000') p.color = f.color;
  return p;
}

export function paraProps(f: ParaFormat | undefined): ParaProps {
  const p: ParaProps = {};
  if (!f) return p;
  if (f.align !== 'l') p.align = f.align;
  if (f.marL) p.marL = round2(f.marL);
  if (f.marR) p.marR = round2(f.marR);
  if (f.indent) p.indent = round2(f.indent);
  if (f.spaceBefore) p.spaceBefore = round2(f.spaceBefore);
  if (f.spaceAfter) p.spaceAfter = round2(f.spaceAfter);
  if (f.leading > 0 && !f.incrementalLeading) { p.lineSpacing = round2(f.leading); p.lineSpacingPt = true; }
  if (f.hj?.hyphenate) p.hyphenate = true;
  if (f.tabs.length) p.tabs = f.tabs.filter((t) => t.pos >= 0).map((t) => ({ pos: round2(t.pos), align: t.type, ...(t.fill ? { leader: t.fill } : {}) }));
  if (f.ruleAbove && f.ruleAbove.width > 0) p.ruleAbove = { width: round2(f.ruleAbove.width), color: f.ruleAbove.color, offset: round2(f.ruleAbove.offset) };
  if (f.ruleBelow && f.ruleBelow.width > 0) p.ruleBelow = { width: round2(f.ruleBelow.width), color: f.ruleBelow.color, offset: round2(f.ruleBelow.offset) };
  return p;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The part of a story between two character offsets, with its spans clipped and shifted. */
export function textRange(s: QxpText, from: number, to: number): QxpText {
  const a = Math.max(0, Math.min(from, s.text.length)), b = Math.max(a, Math.min(to, s.text.length));
  const clip = <T>(spans: Span<T>[]): Span<T>[] => {
    const out: Span<T>[] = [];
    for (const sp of spans) {
      const x = Math.max(a, sp.start), y = Math.min(b, sp.start + sp.length);
      if (x < y) out.push({ format: sp.format, start: x - a, length: y - x });
    }
    return out;
  };
  return { text: s.text.slice(a, b), chars: clip(s.chars), paras: clip(s.paras) };
}

/** The story without the given character ranges (the parts that other objects of its chain show). */
export function textWithout(s: QxpText, ranges: [number, number][]): QxpText {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const parts: QxpText[] = [];
  let pos = 0;
  for (const [a, b] of sorted) { if (a > pos) parts.push(textRange(s, pos, a)); pos = Math.max(pos, b); }
  if (pos < s.text.length) parts.push(textRange(s, pos, s.text.length));
  const out: QxpText = { text: '', chars: [], paras: [] };
  for (const p of parts) {
    const shift = out.text.length;
    out.text += p.text;
    for (const c of p.chars) out.chars.push({ ...c, start: c.start + shift });
    for (const c of p.paras) out.paras.push({ ...c, start: c.start + shift });
  }
  return out;
}

/** The story's paragraphs with their runs; empty stories give one empty paragraph. */
export function storyParagraphs(s: QxpText, style = 'Body'): Paragraph[] {
  const text = s.text;
  const paraSpans: Span<ParaFormat>[] = s.paras.length ? s.paras : [{ format: undefined, start: 0, length: text.length }];
  const out: Paragraph[] = [];
  for (const ps of paraSpans) {
    const pStart = Math.min(ps.start, text.length);
    const pEnd = Math.min(ps.start + ps.length, text.length);
    // A span normally holds one paragraph ending in a return; split on returns to be safe.
    let segStart = pStart;
    const segments: [number, number][] = [];
    for (let i = pStart; i < pEnd; i++) if (text[i] === '\r') { segments.push([segStart, i]); segStart = i + 1; }
    if (segStart < pEnd || segments.length === 0) segments.push([segStart, pEnd]);
    for (const [a, b] of segments) {
      const para: Paragraph = { style, runs: runsOf(s, a, b), ...paraProps(ps.format) };
      out.push(para);
    }
  }
  if (!out.length) out.push({ style, runs: [] });
  return out;
}

function runsOf(s: QxpText, from: number, to: number): Run[] {
  const runs: Run[] = [];
  const spans = s.chars.length ? s.chars : [{ format: undefined, start: 0, length: s.text.length }];
  for (const cs of spans) {
    const a = Math.max(from, cs.start), b = Math.min(to, cs.start + cs.length);
    if (a >= b) continue;
    if (cs.format?.control) continue;
    const props = runProps(cs.format);
    const piece = s.text.slice(a, b);
    const parts = piece.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) runs.push({ text: '', br: true });
      const clean = part.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      if (clean) runs.push({ text: clean, ...props });
    });
  }
  return mergeRuns(runs);
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !last.br && !r.br && sameProps(last, r)) last.text += r.text;
    else out.push(r);
  }
  return out;
}

function sameProps(a: Run, b: Run): boolean {
  const ka = Object.keys(a).filter((k) => k !== 'text').sort();
  const kb = Object.keys(b).filter((k) => k !== 'text').sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && (a as any)[k] === (b as any)[k]);
}
