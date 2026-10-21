/**
 * Conversion of Quill stories (paragraphs of spans with Publisher's character and paragraph
 * properties) into QuillPress paragraphs and runs, and the resolution of Publisher color references.
 */
import type { Paragraph, Run, NumScheme, Color } from '../../model/types';
import type { QPara, CharStyle, ParaStyle, QuillInfo } from './quill';
import { emuPt } from './cfbStreams';

/** A color reference: palette entry (0x08 type), tint/shade of a palette entry (0x10 type) or RGB. */
export function colorOf(c: number, palette: number[], names?: Map<number, string>): Color {
  const type = (c >>> 24) & 0xff;
  if (type === 0x08) {
    const idx = c & 0xffffff;
    if (idx >= palette.length) return '#000000';
    return names?.get(idx) || hex(palette[idx]);
  }
  if (type === 0x10) {
    // Intensity change on a base color (the base is a palette entry or RGB in the low bytes).
    const baseType = (c >>> 8) & 0xff, intensity = ((c >>> 16) & 0xff) / 255;
    const base = palette[0] ?? 0;
    const r = (base >> 16) & 0xff, g = (base >> 8) & 0xff, b = base & 0xff;
    if (baseType === 1) return hex((Math.round(r * intensity) << 16) | (Math.round(g * intensity) << 8) | Math.round(b * intensity));
    if (baseType === 2) return hex((Math.round(r + (255 - r) * (1 - intensity)) << 16) | (Math.round(g + (255 - g) * (1 - intensity)) << 8) | Math.round(b + (255 - b) * (1 - intensity)));
    return '#000000';
  }
  return hex(((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff));
}

export const hex = (rgb: number): string => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0');

const SCHEMES: Record<number, NumScheme> = { 0: 'arabicPeriod', 1: 'romanUcPeriod', 2: 'romanLcPeriod', 3: 'alphaUcPeriod', 4: 'alphaLcPeriod', 0x16: 'arabicPeriod' };

export interface TextEnv {
  quill: QuillInfo;
  palette: number[];
  paletteNames?: Map<number, string>;
  /** Font name used when a span names none. */
  defaultFont?: string;
  /** Counts of things that were dropped, for the warnings. */
  dropped: { fields: number };
}

function charProps(st: CharStyle, def: CharStyle, env: TextEnv): Partial<Run> {
  const r: Partial<Run> = {};
  if (!!st.bold !== !!def.bold) r.b = true;
  if (!!st.italic !== !!def.italic) r.i = true;
  const u = st.underline ?? def.underline;
  if (u) r.u = u === 3 || u === 0x17 ? 'dbl' : u === 0xb || u === 0x10 ? 'wavy' : true;
  const size = st.size ?? def.size;
  if (size) r.size = Math.round(size * 100) / 100;
  const ci = st.colorIndex ?? def.colorIndex;
  if (ci != null && ci >= 0 && ci < env.quill.colors.length) r.color = colorOf(env.quill.colors[ci], env.palette, env.paletteNames);
  const fi = st.fontIndex ?? def.fontIndex;
  const font = fi != null && fi < env.quill.fonts.length ? env.quill.fonts[fi] : env.quill.fonts[0] || env.defaultFont;
  if (font) r.font = font;
  const ss = st.superSub ?? def.superSub;
  if (ss === 1) r.baseline = 33; else if (ss === 2) r.baseline = -33;
  if (!!st.smallCaps !== !!def.smallCaps) r.caps = 'small';
  else if (!!st.allCaps !== !!def.allCaps) r.caps = 'all';
  const lcid = st.lcid ?? def.lcid;
  if (lcid) { const tag = LCID[lcid]; if (tag) r.lang = tag; }
  return r;
}

const LCID: Record<number, string> = { 0x409: 'en-US', 0x809: 'en-GB', 0xc09: 'en-AU', 0x1009: 'en-CA', 0x40c: 'fr-FR', 0xc0c: 'fr-CA', 0x407: 'de-DE', 0xc07: 'de-AT', 0x807: 'de-CH', 0x410: 'it-IT', 0x40a: 'es-ES', 0xc0a: 'es-ES', 0x80a: 'es-MX', 0x416: 'pt-BR', 0x816: 'pt-PT', 0x413: 'nl-NL', 0x41d: 'sv-SE', 0x406: 'da-DK', 0x414: 'nb-NO', 0x40b: 'fi-FI', 0x415: 'pl-PL', 0x419: 'ru-RU', 0x405: 'cs-CZ', 0x40e: 'hu-HU', 0x408: 'el-GR', 0x41f: 'tr-TR', 0x411: 'ja-JP', 0x412: 'ko-KR', 0x804: 'zh-CN', 0x404: 'zh-TW' };

function paraProps(st: ParaStyle, def: ParaStyle): Partial<Paragraph> {
  const p: Partial<Paragraph> = {};
  const align = st.align ?? def.align ?? 0;
  p.align = align === 2 ? 'ctr' : align === 1 ? 'r' : align === 6 ? 'just' : 'l';
  const ls = st.lineSpacing != null ? st : def.lineSpacing != null ? def : null;
  if (ls && ls.lineSpacing != null) {
    if (ls.lineSpacingPt) { p.lineSpacing = Math.round(ls.lineSpacing * 100) / 100; p.lineSpacingPt = true; }
    else if (Math.abs(ls.lineSpacing - 1) > 0.001) p.lineSpacing = Math.round(ls.lineSpacing * 1000) / 10;
  }
  // Publisher paragraphs have no space before or after unless the file says so (the Body style's own
  // spacing must not creep in).
  const sb = st.spaceBefore ?? def.spaceBefore, sa = st.spaceAfter ?? def.spaceAfter;
  p.spaceBefore = sb ? emuPt(sb) : 0;
  p.spaceAfter = sa ? emuPt(sa) : 0;
  const fi = st.firstIndent ?? def.firstIndent, li = st.leftIndent ?? def.leftIndent, ri = st.rightIndent ?? def.rightIndent;
  if (fi) p.indent = emuPt(fi);
  if (li) p.marL = emuPt(li);
  if (ri) p.marR = emuPt(ri);
  const tabs = st.tabs ?? def.tabs;
  if (tabs?.length) p.tabs = tabs.map((t) => ({ pos: emuPt(t), align: 'l' as const }));
  const list = st.list ?? def.list;
  if (list) {
    if (list.bulletChar) p.bullet = { kind: 'char', char: String.fromCharCode(list.bulletChar) };
    else p.bullet = { kind: 'num', scheme: SCHEMES[list.numbering ?? 0] || 'arabicPeriod', ...(list.restart != null && list.restart > 0 ? { startAt: list.restart } : {}) };
  }
  const dl = st.dropCapLines ?? def.dropCapLines;
  if (dl && dl > 1) p.dropCap = { lines: dl, chars: Math.max(1, st.dropCapLetters ?? def.dropCapLetters ?? 1) };
  return p;
}

/** Turns one span's text into runs: line breaks become `br` runs, control characters are dropped. */
function runsOf(text: string, props: Partial<Run>, env: TextEnv): Run[] {
  const out: Run[] = [];
  let cur = '';
  const flush = () => { if (cur) { out.push({ ...props, text: cur }); cur = ''; } };
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c === 0x0b || c === 0x0a) { flush(); out.push({ ...props, text: '', br: true }); }
    else if (c === 0x0d) { /* paragraph mark */ }
    else if (c === 0x09 || c >= 0x20) {
      if (c >= 0xf000 && c <= 0xf0ff) { env.dropped.fields++; continue; }
      cur += ch;
    }
  }
  flush();
  return out;
}

/** Converts a Quill story into QuillPress paragraphs. */
export function storyParagraphs(paras: QPara[], env: TextEnv, style = 'Body'): Paragraph[] {
  const out: Paragraph[] = [];
  for (const qp of paras) {
    const defIdx = qp.style.defaultCharStyle ?? 0;
    const defChar = env.quill.defaultChar[defIdx] || env.quill.defaultChar[0] || {};
    const defPara = env.quill.defaultPara[defIdx] || env.quill.defaultPara[0] || {};
    const para: Paragraph = { style, runs: [], ...paraProps(qp.style, defPara) };
    for (const sp of qp.spans) para.runs.push(...runsOf(sp.text, charProps(sp.style, defChar, env), env));
    // The formatting typed at the end of an empty paragraph.
    if (!para.runs.length && qp.spans.length) { const { text: _t, br: _b, ...rest } = { text: '', ...charProps(qp.spans[0].style, defChar, env) } as Run; para.end = rest; }
    out.push(para);
  }
  if (!out.length) out.push({ style, runs: [] });
  return out;
}

/** Byte length of a Quill paragraph in the TEXT chunk (two bytes per character, mark included). */
export function paraByteLength(p: QPara): number {
  return p.spans.reduce((a, s) => a + s.text.length, 0) * 2;
}
