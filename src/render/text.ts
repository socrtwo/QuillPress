/**
 * Text layout. QuillPress breaks lines itself (rather than leaving it to the browser) so the editing
 * view, thumbnails, print, PDF, SVG and PNG export all break lines in the same places, and so that a
 * story can flow through a chain of frames and columns. Widths are measured with a canvas; where no
 * canvas exists (tests) an average-width estimate is used.
 *
 * The engine lays paragraphs into a sequence of boxes (the columns of the frames of a story chain,
 * in order). Each box may carry exclusion rectangles (objects with text wrap) that shorten the lines
 * passing through them. Lines that do not fit in the last box are overset.
 */
import type { Bullet, NumScheme, Paragraph, Run, RunProps, ParaProps, Tab, FootnoteOptions } from '../model/types';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';

export interface MeasureFn { (text: string, font: string): number }

let ctx2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

function getCtx() {
  if (ctx2d !== undefined) return ctx2d;
  ctx2d = null;
  try {
    if (typeof OffscreenCanvas !== 'undefined') ctx2d = new OffscreenCanvas(8, 8).getContext('2d');
    else if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
      const c = document.createElement('canvas').getContext('2d');
      if (c && typeof c.measureText === 'function') ctx2d = c;
    }
  } catch { ctx2d = null; }
  return ctx2d;
}

/** Clears measurements (after web fonts finish loading). */
export function clearMeasureCache(): void { cache.clear(); }

export const measure: MeasureFn = (text, font) => {
  const key = font + '\u0000' + text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const c = getCtx();
  let w: number;
  if (c) { c.font = font; w = c.measureText(text).width; }
  else {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || '16');
    const bold = /\bbold\b|\b700\b/.test(font);
    w = 0;
    for (const ch of text) w += size * (ch === ' ' ? 0.27 : /[il.,:;'!|]/.test(ch) ? 0.25 : /[mwMW@]/.test(ch) ? 0.82 : /[A-Z]/.test(ch) ? 0.62 : 0.5) * (bold ? 1.05 : 1);
  }
  if (cache.size > 30000) cache.clear();
  cache.set(key, w);
  return w;
};

export interface Rect { x: number; y: number; w: number; h: number }

/** A column of a frame, in page coordinates. */
export interface FlowBox {
  frame: string;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Objects with text wrap that overlap this box (page coordinates). */
  excl?: Rect[];
  /** Page index the box is on (for page-number fields); -1 on masters. */
  page?: number;
}

export interface Seg {
  text: string;
  /** Left of the segment relative to the line's left. */
  x: number;
  w: number;
  style: RunProps;
  size: number;
  font: string;
  css: string;
  /** Index of the run in the paragraph. */
  run: number;
  /** Character offset of the segment's first character in the paragraph text. */
  off: number;
  /** Drop cap glyph: the number of lines it spans. */
  drop?: number;
  /** An anchored object's place on the line (the segment has no text; w is the object's width). */
  anchor?: string;
  /** A footnote reference (the text is its label). */
  footnote?: string;
}

/** What the engine needs to know about an anchored object. */
export interface AnchoredInfo { w: number; h: number; mode: 'inline' | 'above' | 'custom'; dx?: number; dy?: number; align?: 'l' | 'ctr' | 'r'; valign?: 'baseline' | 'ctr' | 'top' }

export interface LaidLine {
  box: number;
  segs: Seg[];
  /** Baseline y, page coordinates. */
  y: number;
  /** Left of the line's text, page coordinates (after margins, indents, exclusions and alignment). */
  x: number;
  width: number;
  height: number;
  ascent: number;
  para: number;
  first: boolean;
  last: boolean;
  bullet?: { text: string; x: number; size: number; font: string; color?: string; css: string };
  align: string;
  /** Character offsets [start, end) of the paragraph text on this line. */
  start: number;
  end: number;
  /** Objects anchored on this line: computed top-left (x, y) and the anchor point (ax, ay) on the line, page coordinates. */
  anchors?: { id: string; x: number; y: number; ax: number; ay: number }[];
  /** A line of footnote text at the bottom of the box (para indexes the footnote's paragraphs). */
  footnote?: boolean;
  /** The footnote the line belongs to (note lines only). */
  footnoteId?: string;
  /** Optical margin: how far the first/last glyph hangs outside the margin (left, right). */
  hang?: [number, number];
}

export interface LayoutResult {
  lines: LaidLine[];
  /** Paragraph index and character offset where text stopped fitting (undefined when all fit). */
  overset?: { para: number; off: number };
  /** Lines per box. */
  perBox: number[];
  /** Height used in the last box that received text. */
  used: number;
  /** Footnote separator rules (page coordinates). */
  separators: { box: number; x: number; y: number; w: number }[];
  /** The label given to each footnote referenced. */
  footnoteLabels?: Record<string, string>;
  /** Footnotes numbered so far (footnoteStart plus the references laid). */
  footnoteCount: number;
}

export interface ResolvedParaStyle { props: ParaProps; run: RunProps }

export interface LayoutOptions {
  boxes: FlowBox[];
  /** Resolves a paragraph's style chain. */
  resolve: (p: Paragraph) => ResolvedParaStyle;
  /** Resolves a run's character style and overrides on top of the paragraph's base run. */
  resolveRun: (base: RunProps, r: RunProps) => RunProps;
  /** CSS font family for a font name. */
  font?: (f: string | undefined) => string;
  /** Field values. */
  fields?: (field: string, box: FlowBox, varName?: string) => string;
  /** Baseline grid (page coordinates): baselines of gridAlign paragraphs snap down to it. */
  grid?: { start: number; step: number };
  measure?: MeasureFn;
  /** Default tab stop interval, points. */
  tabInterval?: number;
  /** Lay out everything into an unbounded last box (for autosize and measuring). */
  unbounded?: boolean;
  /** Vertical anchoring inside the last used box. */
  anchor?: 't' | 'ctr' | 'b' | 'just';
  /** Size and mode of an anchored item (undefined: the anchor is ignored). */
  anchoredItem?: (id: string) => AnchoredInfo | undefined;
  /** Paragraphs of a footnote by id. */
  footnote?: (id: string) => Paragraph[] | undefined;
  footnoteOptions?: FootnoteOptions;
  /** Footnote numbering continues from this count (references in earlier cells of a table). */
  footnoteStart?: number;
  /** Optical margin alignment for every paragraph (a paragraph's own setting wins). */
  opticalMargin?: boolean;
  /** Reference size (points) scaling the optical overhang; default 12. */
  opticalMarginSize?: number;
}

export const cssFont = (st: RunProps, size: number, family: string) => `${st.i ? 'italic ' : ''}${st.b ? 'bold ' : ''}${Math.max(0.5, size)}px "${family}"`;

export function bulletText(b: Bullet | undefined, index: number): string {
  if (!b || b.kind === 'none') return '';
  if (b.kind === 'char') return b.char || '•';
  return formatNumber((b.startAt ?? 1) + index, b.scheme || 'arabicPeriod');
}

export function formatNumber(n: number, scheme: NumScheme): string {
  const alpha = (k: number) => { let s = ''; while (k > 0) { k--; s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26); } return s; };
  const roman = (k: number) => { const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (k >= v) { s += r; k -= v; } return s; };
  switch (scheme) {
    case 'arabicParenR': return `${n})`;
    case 'arabicPlain': return `${n}`;
    case 'alphaLcPeriod': return `${alpha(n)}.`;
    case 'alphaUcPeriod': return `${alpha(n).toUpperCase()}.`;
    case 'alphaLcParenR': return `${alpha(n)})`;
    case 'romanLcPeriod': return `${roman(n)}.`;
    case 'romanUcPeriod': return `${roman(n).toUpperCase()}.`;
    default: return `${n}.`;
  }
}

/** Plain text of a paragraph (a line break counts as one character). */
export function paraText(p: Paragraph): string { return p.runs.map((r) => (r.br ? '\n' : r.text)).join(''); }

// ------------------------------------------------------------------------------------------
// Hyphenation: a small rule-based breaker (vowel/consonant boundaries, existing hyphens, soft hyphens).

const VOWEL = /[aeiouyáéíóúàèìòùâêîôûäëïöüœæ]/i;

export function hyphenPoints(word: string): number[] {
  const pts: number[] = [];
  if (word.length < 6) return pts;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch === '­') pts.push(i);
    else if (ch === '-' && i > 0 && i < word.length - 1) pts.push(i + 1);
  }
  if (pts.length) return pts;
  // Break after a vowel followed by a consonant pair, or between double consonants, min 3 letters each side.
  for (let i = 3; i <= word.length - 3; i++) {
    const a = word[i - 1], b = word[i], c = word[i + 1];
    if (!/[a-z]/i.test(a) || !/[a-z]/i.test(b)) continue;
    if (b === c && !VOWEL.test(b)) { pts.push(i + 1); i++; continue; }
    if (VOWEL.test(a) && !VOWEL.test(b) && c && !VOWEL.test(c)) { pts.push(i + 1); continue; }
    if (!VOWEL.test(a) && VOWEL.test(b) && i > 3 && !VOWEL.test(word[i - 2])) pts.push(i - 1);
  }
  return [...new Set(pts)].filter((p) => p >= 3 && p <= word.length - 3).sort((x, y) => x - y);
}

// ------------------------------------------------------------------------------------------

type Tok = { text: string; style: RunProps; size: number; font: string; css: string; run: number; off: number; br?: boolean; tab?: boolean; space: boolean; w: number; anchor?: AnchoredInfo & { id: string }; footnote?: string };

function stripUndef<T extends object>(o: T): Partial<T> {
  const r: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && k !== 'runs' && k !== 'end' && k !== 'style') r[k] = v;
  return r;
}

/** Free horizontal ranges of a box at a vertical band, after exclusions. */
function freeRanges(box: FlowBox, y0: number, y1: number): [number, number][] {
  let ranges: [number, number][] = [[box.x, box.x + box.w]];
  for (const r of box.excl || []) {
    if (r.y >= y1 || r.y + r.h <= y0) continue;
    const next: [number, number][] = [];
    for (const [a, b] of ranges) {
      if (r.x >= b || r.x + r.w <= a) { next.push([a, b]); continue; }
      if (r.x > a) next.push([a, r.x]);
      if (r.x + r.w < b) next.push([r.x + r.w, b]);
    }
    ranges = next;
  }
  return ranges.filter(([a, b]) => b - a > 8);
}

const FOOTNOTE_SYMBOLS = ['*', '†', '‡', '§', '‖', '¶'];

/** The reference label of the n-th footnote (1-based) under a scheme. */
export function footnoteLabel(n: number, scheme: FootnoteOptions['scheme']): string {
  if (scheme === 'symbols') { const k = Math.max(1, n) - 1; return FOOTNOTE_SYMBOLS[k % 6].repeat(Math.floor(k / 6) + 1); }
  return formatNumber(n, scheme);
}

/** The footnote's paragraphs with the reference label set in front of the first one. */
export function labeledFootnote(paras: Paragraph[], label: string, style: string): Paragraph[] {
  const out = paras.map((p, i) => ({ ...p, style: p.style || style, runs: i === 0 ? [{ text: label, cstyle: 'Footnote Reference', baseline: 33 } as Run, { text: ' ' } as Run, ...p.runs] : [...p.runs] }));
  return out.length ? out : [{ style, runs: [{ text: label, cstyle: 'Footnote Reference', baseline: 33 }] }];
}

// ------------------------------------------------------------------------------------------
// Optical margin alignment: punctuation and open-sided glyphs hang outside the margin by a fraction
// of their width so the edge of the text looks straight.

const HANG_FULL = new Set(['.', ',', '\'', '’', '‘', '"', '“', '”', '‚', '„', '·', '•', '‹', '›', '`', '´']);
const HANG_HALF = new Set(['-', '–', '—', ';', ':', '!', '?', '«', '»', '*', '°']);
const HANG_LETTER_LEFT = new Set(['A', 'V', 'W', 'Y', 'T', 'v', 'w', 'y', 'J']);
const HANG_LETTER_RIGHT = new Set(['A', 'V', 'W', 'Y', 'T', 'v', 'w', 'y', 'r', 'f', 'L']);

/** Fraction of a glyph's width that hangs outside the margin on the given side. */
export function hangFraction(ch: string, side: 'left' | 'right'): number {
  if (!ch) return 0;
  if (HANG_FULL.has(ch)) return 1;
  if (HANG_HALF.has(ch)) return 0.5;
  if ((side === 'left' ? HANG_LETTER_LEFT : HANG_LETTER_RIGHT).has(ch)) return 0.2;
  return 0;
}

/** The overhang in points of a glyph of `size` points measuring `w` wide, for a reference size. */
export function hangAmount(ch: string, side: 'left' | 'right', w: number, size: number, refSize: number): number {
  const f = hangFraction(ch, side);
  if (!f || w <= 0) return 0;
  return Math.min(w, f * w * (refSize / Math.max(1, size)));
}

/**
 * Lays paragraphs into the boxes. Returns the lines (page coordinates) and where the text overset.
 *
 * Anchored objects: a run with `anchor` is an inline token as wide as the object (its line grows to
 * hold it) or a zero-width marker for objects above the line or at a custom offset; each line lists
 * the computed top-left of its objects in `anchors`. Footnotes: a run with `footnote` is numbered in
 * reading order (per story or per page) and the footnote's text is laid out at the bottom of the
 * column holding the reference; the column's bottom is reserved for it, so the reference and its
 * note always share a column. Footnote lines carry `footnote: true`.
 */
export function layoutStory(paras: Paragraph[], o: LayoutOptions): LayoutResult {
  const m = o.measure || measure;
  const fontOf = o.font || ((f) => f || 'Tinos');
  const tabInt = o.tabInterval || 36;
  const lines: LaidLine[] = [];
  const perBox = o.boxes.map(() => 0);
  let bi = 0;
  let box = o.boxes[0];
  let y = box ? box.y : 0;
  const counters = new Map<string, number>();
  let overset: LayoutResult['overset'];
  let prevStyleKey = '';
  const boxBottom = () => (o.unbounded && bi === o.boxes.length - 1 ? Infinity : box.y + box.h);
  // Footnotes: space reserved at the bottom of each box, the laid footnote lines waiting for it, numbering.
  const fnOpts = o.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS;
  const sepTotal = fnOpts.separator.space + 2;
  const reserved: number[] = o.boxes.map(() => 0);
  const fnPending: LaidLine[][] = o.boxes.map(() => []);
  const separators: LayoutResult['separators'] = [];
  const footnoteLabels: Record<string, string> = {};
  let fnCount = o.footnoteStart ?? 0;
  let fnPage = -2;
  const opticalSize = o.opticalMarginSize || 12;
  /** The box whose bottom receives the footnotes referenced from box k. */
  const fnTarget = (k: number): number => {
    if (fnOpts.placement !== 'frame') return k;
    let t = k;
    while (t + 1 < o.boxes.length && o.boxes[t + 1].frame === o.boxes[k].frame) t++;
    return t;
  };
  /** Writes the footnote lines of box k at its bottom (or after the text in an unbounded box). */
  const flushFootnotes = (k: number, yEnd?: number) => {
    const pend = fnPending[k];
    if (!pend.length) return;
    const b = o.boxes[k];
    const top = yEnd != null ? yEnd : b.y + b.h - reserved[k];
    separators.push({ box: k, x: b.x, y: top + fnOpts.separator.space * 0.5, w: b.w * Math.max(0, Math.min(1, fnOpts.separator.length)) });
    for (const l of pend) { l.y += top + sepTotal; lines.push(l); }
    if (yEnd != null) y = top + reserved[k];
    fnPending[k] = [];
  };

  const nextBox = (): boolean => {
    if (bi + 1 >= o.boxes.length) return false;
    flushFootnotes(bi);
    bi++;
    box = o.boxes[bi];
    y = box.y;
    return true;
  };

  outer: for (let pi = 0; pi < paras.length; pi++) {
    if (!box) { overset = { para: pi, off: 0 }; break; }
    const p = paras[pi];
    const rs = o.resolve(p);
    const st = rs.props;
    const baseRun = rs.run;
    const bullet = st.bullet;
    // Numbering: consecutive numbered paragraphs of the same style count up; anything else restarts.
    const key = `${p.style || ''}:${bullet?.scheme || ''}`;
    const isNum = bullet?.kind === 'num';
    if (isNum) counters.set(key, prevStyleKey === key ? (counters.get(key) || 0) + 1 : 1);
    prevStyleKey = isNum ? key : '';
    const marL = st.marL ?? 0, marR = st.marR ?? 0, indent = st.indent ?? 0;
    const spBefore = st.spaceBefore ?? 0, spAfter = st.spaceAfter ?? 0;
    const align = st.align || 'l';
    const endSize = (p.end?.size ?? baseRun.size ?? 10.5);
    // Tokens: words, spaces, tabs and breaks with their run style.
    const toks: Tok[] = [];
    let off = 0;
    p.runs.forEach((r, ri) => {
      const s = o.resolveRun(baseRun, r);
      const size = (s.size ?? 10.5) * (s.baseline ? 0.67 : 1);
      const fam = fontOf(s.font);
      const css = cssFont(s, size, fam);
      if (r.br) { toks.push({ text: '', style: s, size, font: fam, css, run: ri, off, br: true, space: false, w: 0 }); off += 1; return; }
      if (r.anchor) {
        const info = o.anchoredItem?.(r.anchor);
        if (info) toks.push({ text: '￼', style: s, size, font: fam, css, run: ri, off, space: false, w: info.mode === 'inline' ? info.w : 0, anchor: { ...info, id: r.anchor } });
        off += r.text.length;
        return;
      }
      if (r.footnote) {
        const text = r.text || '1';
        toks.push({ text, style: s, size, font: fam, css, run: ri, off, space: false, w: m(text, css), footnote: r.footnote });
        off += r.text.length;
        return;
      }
      let text = r.field && o.fields && box ? o.fields(r.field, box, r.varName) : r.text;
      if (r.field && !text) text = r.text;
      if (s.caps === 'all') text = text.toUpperCase();
      const parts = text.split(/(\t|\s+)/);
      let pos = off;
      for (const part of parts) {
        if (!part) continue;
        const tab = part === '\t';
        const space = !tab && /^\s+$/.test(part);
        const w = tab ? 0 : m(part, css) + (s.spc ? s.spc * part.length : 0) + (s.caps === 'small' ? 0 : 0);
        toks.push({ text: part, style: s, size, font: fam, css, run: ri, off: pos, tab, space, w });
        pos += part.length;
      }
      off += r.text.length;
    });
    const hasText = toks.some((t) => !t.space && !t.br && !t.tab);
    const bText = hasText && bullet ? bulletText(bullet, Math.max(0, (counters.get(key) || 1) - 1)) : '';
    const firstTok = toks.find((t) => !t.br && !t.space && !t.anchor && !t.footnote);
    const firstSize = firstTok?.size ?? endSize;
    const bSize = (bullet?.size ? bullet.size / 100 : 1) * firstSize;
    const bFont = fontOf(bullet?.font || baseRun.font);
    const bCss = cssFont({}, bSize, bFont);
    const bW = bText ? m(bText + ' ', bCss) : 0;
    const bX = Math.max(0, marL + indent);
    const firstIndent = bText ? (indent < 0 ? Math.max(marL, bX + bW) : bX + bW) : marL + indent;
    const leadingPt = st.lineSpacingPt ? (st.lineSpacing ?? 12) : 0;
    const leadingPct = st.lineSpacingPt ? 1 : (st.lineSpacing ?? 120) / 100;
    // Drop cap
    const drop = st.dropCap && st.dropCap.lines > 1 && hasText && firstTok ? st.dropCap : null;
    let dropW = 0, dropSeg: Seg | null = null, dropLines = 0;
    if (drop && firstTok) {
      const chars = Math.max(1, drop.chars);
      const text = firstTok.text.slice(0, chars);
      const lh = firstSize * leadingPct;
      const dsize = lh * drop.lines * 0.95;
      const dcss = cssFont(firstTok.style, dsize, firstTok.font);
      dropW = m(text, dcss) + 2;
      dropSeg = { text, x: 0, w: dropW, style: firstTok.style, size: dsize, font: firstTok.font, css: dcss, run: firstTok.run, off: firstTok.off, drop: drop.lines };
      dropLines = drop.lines;
      // Remove the characters from the first token.
      firstTok.text = firstTok.text.slice(chars);
      firstTok.off += chars;
      firstTok.w = m(firstTok.text, firstTok.css);
      if (!firstTok.text) toks.splice(toks.indexOf(firstTok), 1);
    }

    let lineToks: Tok[] = [];
    let first = true;
    let lineNo = 0;
    let ti = 0;
    let paraStartedInBox = -1;
    let paraLineIdx = lines.length;
    let lastY = y;
    // Space before (not at the top of a box).
    if (y > box.y + 0.01) y += spBefore;

    /** Line metrics: natural height from the leading, and the space above/below the baseline once anchored objects are counted. */
    const lineGeom = (fst: boolean, ln: number) => {
      const sizes = lineToks.filter((t) => !t.br && !t.anchor).map((t) => t.size);
      const maxSize = sizes.length ? Math.max(...sizes) : endSize;
      const natural = maxSize * leadingPct;
      const height = Math.max(1, leadingPt || natural);
      const ascent = maxSize * 0.92;
      let above = height * 0.8, below = height * 0.2;
      for (const t of lineToks) {
        const a = t.anchor;
        if (!a) continue;
        if (a.mode === 'inline') {
          const va = a.valign || 'baseline';
          if (va === 'baseline') above = Math.max(above, a.h + 1);
          else if (va === 'ctr') { const c = maxSize * 0.33; above = Math.max(above, a.h / 2 + c + 1); below = Math.max(below, a.h / 2 - c + 1); }
          else { above = Math.max(above, ascent); below = Math.max(below, a.h - ascent + 1); }
        } else if (a.mode === 'above') above = Math.max(above, height * 0.8 + a.h + (a.dy ?? 4));
      }
      return { maxSize, height, ascent, above, below, fst, ln };
    };
    const place = (last: boolean): 'ok' | 'moved' | 'overset' => {
      while (lineToks.length && lineToks[lineToks.length - 1].space) lineToks.pop();
      const g = lineGeom(first, lineNo);
      let baseline = y + g.above;
      if (st.gridAlign && o.grid && o.grid.step > 0) {
        const k = Math.ceil((baseline - o.grid.start) / o.grid.step);
        baseline = o.grid.start + Math.max(0, k) * o.grid.step;
      }
      const bottom = baseline + Math.max(g.below, g.height * 0.25);
      // Footnotes referenced on this line: number them and lay out their text at the column width.
      const fnToks = lineToks.filter((t) => t.footnote);
      const target = fnTarget(bi);
      let fnCountNew = fnCount, fnPageNew = fnPage, fnH = 0;
      const fnLines: LaidLine[] = [];
      const labels: [Tok, string][] = [];
      if (fnToks.length) {
        if (fnOpts.restart === 'page' && (box.page ?? -1) !== fnPageNew) { fnCountNew = 0; fnPageNew = box.page ?? -1; }
        for (const t of fnToks) {
          fnCountNew++;
          const label = footnoteLabel(fnCountNew, fnOpts.scheme);
          labels.push([t, label]);
          const fp = o.footnote?.(t.footnote!);
          if (!fp) continue;
          const tb = o.boxes[target];
          const sub = layoutStory(labeledFootnote(fp, label, fnOpts.style), { ...o, boxes: [{ frame: tb.frame, col: tb.col, x: tb.x, y: 0, w: tb.w, h: 1e6, page: tb.page }], unbounded: true, anchor: undefined, grid: undefined, footnote: undefined, anchoredItem: undefined });
          for (const l of sub.lines) { l.y += fnH; l.box = target; l.footnote = true; l.footnoteId = t.footnote; fnLines.push(l); }
          fnH += sub.used;
        }
      }
      const newReserved = fnH ? (reserved[target] || sepTotal) + fnH : reserved[target];
      const myReserved = target === bi ? newReserved : reserved[bi];
      if (bottom > boxBottom() - myReserved + 0.01 && !(o.unbounded && bi === o.boxes.length - 1)) {
        // The line does not fit: move the whole paragraph if it has only started, else just this line.
        return 'moved';
      }
      for (const [t, label] of labels) { t.text = label; t.w = m(label, t.css); }
      let x0 = box.x + (first ? firstIndent : marL) + (lineNo < dropLines ? dropW : 0);
      let avail = box.w - (first ? firstIndent : marL) - marR - (lineNo < dropLines ? dropW : 0);
      // Exclusions: use the widest free range crossing the line band.
      const free = freeRanges(box, baseline - g.ascent, bottom);
      if (free.length && (box.excl?.length)) {
        const best = free.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
        const left = Math.max(x0, best[0]);
        avail = Math.min(x0 + avail, best[1]) - left;
        x0 = left;
      }
      let x = 0;
      const segs: Seg[] = [];
      let spaces = 0;
      for (const t of lineToks) {
        if (t.br) continue;
        if (t.tab) {
          const stops = (st.tabs || []).map((tb: Tab) => tb.pos).filter((pz) => pz > x + 0.5);
          const nextStop = stops.length ? stops[0] : (Math.floor(x / tabInt) + 1) * tabInt;
          x = Math.min(nextStop, avail);
          continue;
        }
        const w = t.w;
        if (t.space) spaces++;
        if (t.anchor) segs.push({ text: '', x, w, style: t.style, size: t.size, font: t.font, css: t.css, run: t.run, off: t.off, anchor: t.anchor.id });
        else segs.push({ text: t.text, x, w, style: t.style, size: t.size, font: t.font, css: t.css, run: t.run, off: t.off, ...(t.footnote ? { footnote: t.footnote } : {}) });
        x += w;
      }
      let width = x;
      let left = x0;
      // Optical margin alignment: hang the first and last glyph outside the margin.
      let hangL = 0, hangR = 0;
      if (st.opticalMargin ?? o.opticalMargin) {
        const textSegs = segs.filter((sg) => sg.text && !sg.anchor && !sg.footnote && !/^\s+$/.test(sg.text));
        const fs = textSegs[0], ls = textSegs[textSegs.length - 1];
        if (fs && !(first && (bText || dropSeg)) && fs.x < 0.01) {
          const ch = [...fs.text][0];
          hangL = hangAmount(ch, 'left', m(ch, fs.css), fs.size, opticalSize);
        }
        if (ls) {
          const chars = [...ls.text];
          const ch = chars[chars.length - 1];
          hangR = hangAmount(ch, 'right', m(ch, ls.css), ls.size, opticalSize);
        }
        x0 -= hangL; left = x0; avail += hangL + hangR;
      }
      const justify = (align === 'just' && !last) || align === 'justAll';
      if (justify && spaces > 0 && width < avail) {
        const extra = (avail - width) / spaces;
        let shift = 0;
        for (const s of segs) { s.x += shift; if (/^\s+$/.test(s.text)) { s.w += extra; shift += extra; } }
        width = avail;
      } else if (align === 'ctr') left = x0 + (avail - width) / 2;
      else if (align === 'r') left = x0 + avail - width;
      const start = lineToks.length ? lineToks[0].off : (segs[0]?.off ?? 0);
      const endTok = lineToks[lineToks.length - 1];
      const end = endTok ? endTok.off + endTok.text.length + (endTok.br ? 1 : 0) : start;
      const ll: LaidLine = { box: bi, segs, y: baseline, x: left, width, height: g.above + g.below, ascent: g.ascent, para: pi, first, last, align, start, end };
      if (hangL || hangR) ll.hang = [hangL, hangR];
      if (first && bText) ll.bullet = { text: bText, x: box.x + bX, size: bSize, font: bFont, css: bCss, color: bullet?.color || firstTok?.style.color || baseRun.color };
      if (first && dropSeg) { dropSeg.x = box.x + (first ? marL : marL) - left; ll.segs.unshift({ ...dropSeg, x: (box.x + marL) - left }); }
      // Anchored objects: where each one goes, from the token's place on the line.
      for (const t of lineToks) {
        const a = t.anchor;
        if (!a) continue;
        const seg = segs.find((s) => s.anchor === a.id);
        const ax = left + (seg?.x ?? 0), ay = baseline;
        let px = ax, py = baseline - a.h;
        if (a.mode === 'inline') {
          const va = a.valign || 'baseline';
          py = va === 'baseline' ? baseline - a.h : va === 'ctr' ? baseline - g.maxSize * 0.33 - a.h / 2 : baseline - g.ascent;
        } else if (a.mode === 'above') {
          const al = a.align || 'l';
          px = x0 + (al === 'ctr' ? (avail - a.w) / 2 : al === 'r' ? avail - a.w : 0) + (a.dx ?? 0);
          py = baseline - g.above;
        } else { px = ax + (a.dx ?? 0); py = baseline + (a.dy ?? 0); }
        (ll.anchors ||= []).push({ id: a.id, x: px, y: py, ax, ay });
      }
      lines.push(ll);
      perBox[bi]++;
      y = baseline + g.below;
      lastY = y;
      if (paraStartedInBox < 0) paraStartedInBox = bi;
      if (fnH) { reserved[target] = newReserved; fnPending[target].push(...fnLines); }
      for (const [t, label] of labels) footnoteLabels[t.footnote!] = label;
      fnCount = fnCountNew; fnPage = fnPageNew;
      lineToks = [];
      first = false;
      lineNo++;
      return 'ok';
    };

    // Measure helpers for the available width of the next line (before placing it).
    const availFor = (fst: boolean, ln: number): number => {
      const g = lineGeom(fst, ln);
      const baseline = y + g.above;
      let x0 = box.x + (fst ? firstIndent : marL) + (ln < dropLines ? dropW : 0);
      let avail = box.w - (fst ? firstIndent : marL) - marR - (ln < dropLines ? dropW : 0);
      const free = freeRanges(box, baseline - g.ascent, baseline + Math.max(g.below, g.height * 0.25));
      if (free.length && box.excl?.length) {
        const best = free.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
        const left = Math.max(x0, best[0]);
        avail = Math.min(x0 + avail, best[1]) - left;
        x0 = left;
      }
      return Math.max(1, avail);
    };

    const flushLine = (last: boolean): boolean => {
      const r = place(last);
      if (r === 'ok') return true;
      // Does not fit in this box: move to the next box; retry there.
      const movingWholePara = lineNo === 0 && !(st.keepWithNext && false);
      if (!nextBox()) {
        overset = { para: pi, off: lineToks.length ? lineToks[0].off : paraText(p).length };
        lineToks = [];
        return false;
      }
      if (movingWholePara) { /* the paragraph restarts in the new box: nothing placed yet */ }
      const r2 = place(last);
      if (r2 === 'ok') return true;
      overset = { para: pi, off: lineToks.length ? lineToks[0].off : 0 };
      lineToks = [];
      return false;
    };

    let lineW = 0;
    for (ti = 0; ti < toks.length; ti++) {
      const t = toks[ti];
      if (t.br) { lineToks.push(t); if (!flushLine(false)) break outer; lineW = 0; continue; }
      if (t.tab) { lineToks.push(t); const stops = (st.tabs || []).map((tb) => tb.pos).filter((pz) => pz > lineW + 0.5); lineW = stops.length ? stops[0] : (Math.floor(lineW / tabInt) + 1) * tabInt; continue; }
      const avail = availFor(first, lineNo);
      const w = t.w;
      if (!t.space && lineW + w > avail + 0.01 && lineToks.some((x) => !x.space && !x.tab)) {
        // Try to hyphenate the word so part of it stays on this line.
        if (st.hyphenate !== false && t.text.length >= 6 && !t.footnote) {
          const pts = hyphenPoints(t.text);
          let best = -1;
          for (const pt of pts) { const hw = m(t.text.slice(0, pt) + '-', t.css); if (lineW + hw <= avail) best = pt; else break; }
          if (best > 0) {
            lineToks.push({ ...t, text: t.text.slice(0, best) + '-', w: m(t.text.slice(0, best) + '-', t.css) });
            if (!flushLine(false)) break outer;
            const rest = t.text.slice(best);
            toks.splice(ti + 1, 0, { ...t, text: rest, off: t.off + best, w: m(rest, t.css) });
            lineW = 0;
            continue;
          }
        }
        if (!flushLine(false)) break outer;
        lineW = 0;
      }
      if (!t.space || lineToks.some((x) => !x.space)) {
        const avail2 = availFor(first, lineNo);
        if (!t.space && !t.anchor && !t.footnote && w > avail2 + 0.01) {
          // A word longer than the line is broken by characters.
          let chunk = '';
          let coff = t.off;
          for (const ch of t.text) {
            const cw = m(chunk + ch, t.css);
            if (cw > avail2 - lineW && chunk) {
              lineToks.push({ ...t, text: chunk, off: coff, w: m(chunk, t.css) });
              if (!flushLine(false)) break outer;
              coff += chunk.length;
              chunk = ch; lineW = 0;
            } else chunk += ch;
          }
          if (chunk) { lineToks.push({ ...t, text: chunk, off: coff, w: m(chunk, t.css) }); lineW += m(chunk, t.css); }
          continue;
        }
        lineToks.push(t);
        lineW += w;
      }
    }
    if (overset) break;
    if (!flushLine(true)) break;
    y = lastY + spAfter;
    void paraLineIdx;
  }

  // Footnotes of the boxes still holding them (the last box used, and any box the paragraphs skipped).
  if (box) for (let k = 0; k < o.boxes.length; k++) flushFootnotes(k, o.unbounded && k === o.boxes.length - 1 && k === bi ? y : undefined);
  const used = box ? Math.max(0, y - box.y) : 0;
  // Vertical anchoring inside a single box (frames with one column): shift lines down.
  if (o.anchor && o.anchor !== 't' && o.boxes.length === 1 && !overset && lines.length) {
    const b = o.boxes[0];
    const extra = Math.max(0, b.h - used - reserved[0]);
    const body = lines.filter((l) => !l.footnote);
    if (o.anchor === 'ctr') for (const l of body) l.y += extra / 2;
    else if (o.anchor === 'b') for (const l of body) l.y += extra;
    else if (o.anchor === 'just' && body.length > 1) { const gap = extra / (body.length - 1); body.forEach((l, i) => { l.y += gap * i; }); }
    for (const l of lines) if (l.anchors) for (const a of l.anchors) { const d = l.y - a.ay; a.y += d; a.ay = l.y; }
  }
  return { lines, overset, perBox, used, separators, footnoteLabels, footnoteCount: fnCount };
}

/** Plain-text words count. */
export function countWords(paras: Paragraph[]): number { return paras.map(paraText).join('\n').split(/\s+/).filter(Boolean).length; }
