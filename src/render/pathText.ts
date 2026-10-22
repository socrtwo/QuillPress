/**
 * Text on a path: places each character of a PathTextItem's text along its path by arc length.
 *
 * Contract of `pathTextGlyphs(item, options)` (stable; the PDF writer and the SVG renderer both use it):
 * - `options` is anything with the engine's `resolve`, `resolveRun` and optional `font`/`measure`
 *   members (a `LayoutOptions` from `layoutOptions(pub, [])` does).
 * - Returns one entry per visible character, in text order, in PAGE coordinates (points):
 *   `x`, `y` is the point on the path where the character's horizontal center sits, on its baseline
 *   (after `item.baseline` has shifted the path along its normal); `angle` is the tangent direction in
 *   degrees, clockwise (the SVG `rotate` sense), so the glyph is drawn with
 *   `translate(x y) rotate(angle)` and `text-anchor: middle`, or in PDF with the text matrix
 *   `[cos sin -sin cos x y]` and the glyph origin at `-w / 2`; `w` is the character's advance;
 *   `size`, `font` (family name as in the model) and `style` (resolved RunProps) describe the type.
 * - `item.align` places the run of text at the start, center or end of the path; `justify` spreads
 *   the extra length evenly between characters; `offset` moves the start along the path; `spacing`
 *   adds tracking; `flip` sets the text on the other side of the path, running the other way.
 * - Characters past the end of the path are dropped (`overflow` reports how many).
 */
import type { PathTextItem, Paragraph, RunProps, FootnoteOptions } from '../model/types';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';
import { flattenPath, polyline, pointAt, reversed, type Pt } from '../model/pathGeom';
import { measure as defaultMeasure, cssFont, hscaleOf, footnoteLabel, labeledFootnote, layoutStory, type MeasureFn, type ResolvedParaStyle, type LayoutOptions, type LaidLine, type FlowBox } from './text';

export interface PathGlyph { ch: string; x: number; y: number; angle: number; w: number; size: number; font: string; style: RunProps; /** The footnote this glyph is the reference label of. */ footnote?: string }

export interface PathTextOptions {
  resolve: (p: Paragraph) => ResolvedParaStyle;
  resolveRun: (base: RunProps, r: RunProps) => RunProps;
  font?: (f: string | undefined) => string;
  measure?: MeasureFn;
  footnoteOptions?: FootnoteOptions;
}

/** Footnote ids referenced from the item's text, in order. */
export function pathTextFootnoteRefs(item: PathTextItem): string[] {
  const ids: string[] = [];
  for (const p of item.text) for (const r of p.runs) if (r.footnote) ids.push(r.footnote);
  return ids;
}

/** The label of every footnote referenced from the item (numbered per item with the publication's scheme). */
export function pathTextFootnoteLabels(item: PathTextItem, fnOpts: FootnoteOptions = DEFAULT_FOOTNOTE_OPTIONS): Record<string, string> {
  const out: Record<string, string> = {};
  pathTextFootnoteRefs(item).forEach((id, i) => { out[id] = footnoteLabel(i + 1, fnOpts.scheme); });
  return out;
}

export const PATH_TEXT_PRESETS: Record<string, { label: string; d: string; w: number; h: number; box: [number, number] }> = {
  line: { label: 'Straight Line', d: 'M0 50 L200 50', w: 200, h: 100, box: [240, 40] },
  arcUp: { label: 'Arc Up', d: 'M0 100 A100 100 0 0 1 200 100', w: 200, h: 100, box: [240, 120] },
  arcDown: { label: 'Arc Down', d: 'M0 0 A100 100 0 0 0 200 0', w: 200, h: 100, box: [240, 120] },
  circle: { label: 'Circle', d: 'M100 0 A100 100 0 1 1 100 200 A100 100 0 1 1 100 0', w: 200, h: 200, box: [200, 200] },
  wave: { label: 'Wave', d: 'M0 50 C50 0 100 100 150 50 C200 0 250 100 300 50', w: 300, h: 100, box: [300, 100] },
  zigzag: { label: 'Zigzag', d: 'M0 80 L50 20 L100 80 L150 20 L200 80 L250 20 L300 80', w: 300, h: 100, box: [300, 100] },
};

/** The path's polyline in the item's local box (scaled from the path's own box). */
export function pathPolyline(item: PathTextItem): Pt[] {
  const sx = item.path.w ? item.w / item.path.w : 1, sy = item.path.h ? item.h / item.path.h : 1;
  const polys = flattenPath(item.path.d, 24);
  const pts: Pt[] = [];
  for (const p of polys) for (const q of p) pts.push({ x: q.x * sx, y: q.y * sy });
  return pts;
}

/** Maps a point in the item's local box to page coordinates (rotation about the center, flips, position). */
export function localToPage(item: PathTextItem, p: Pt): Pt {
  let x = p.x, y = p.y;
  if (item.flipH) x = item.w - x;
  if (item.flipV) y = item.h - y;
  // Skew about the centre (positive leans the top to the right), inside the rotation as the renderer does.
  if (item.skew) x += Math.tan((item.skew * Math.PI) / 180) * (item.h / 2 - y);
  if (item.rot) {
    const a = (item.rot * Math.PI) / 180, cx = item.w / 2, cy = item.h / 2;
    const dx = x - cx, dy = y - cy;
    x = cx + dx * Math.cos(a) - dy * Math.sin(a);
    y = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  return { x: x + item.x, y: y + item.y };
}

/** Text of the item as one string with the resolved style of each character. */
function chars(item: PathTextItem, o: PathTextOptions): { ch: string; style: RunProps; size: number; font: string; css: string; footnote?: string; raise?: number }[] {
  const fontOf = o.font || ((f) => f || 'Tinos');
  const out: { ch: string; style: RunProps; size: number; font: string; css: string; footnote?: string; raise?: number }[] = [];
  const labels = pathTextFootnoteLabels(item, o.footnoteOptions);
  item.text.forEach((p, pi) => {
    const base = o.resolve(p).run;
    if (pi > 0) { const s = o.resolveRun(base, p.end || {}); const size = s.size ?? 10.5; const fam = fontOf(s.font); out.push({ ch: ' ', style: s, size, font: fam, css: cssFont(s, size, fam) }); }
    for (const r of p.runs) {
      if (r.br) continue;
      const s = o.resolveRun(base, r);
      if (r.footnote) {
        // The reference label: a superscript glyph (smaller, raised along the path normal).
        const label = labels[r.footnote] || r.text || '1';
        if (r.text !== label) r.text = label;
        const size = (s.size ?? 10.5) * 0.67;
        const fam = fontOf(s.font);
        for (const ch of label) out.push({ ch, style: s, size, font: fam, css: cssFont(s, size, fam), footnote: r.footnote, raise: size * 0.5 });
        continue;
      }
      const size = (s.size ?? 10.5) * (s.baseline ? 0.67 : 1);
      const fam = fontOf(s.font);
      const css = cssFont(s, size, fam);
      let text = r.text;
      if (s.caps === 'all') text = text.toUpperCase();
      for (const ch of text) out.push({ ch, style: s, size, font: fam, css });
    }
  });
  return out;
}

export interface PathTextResult { glyphs: PathGlyph[]; overflow: number; length: number }

/** Lays the item's text along its path (see the contract at the top of the file). */
export function pathTextLayout(item: PathTextItem, o: PathTextOptions): PathTextResult {
  const m = o.measure || defaultMeasure;
  let pts = pathPolyline(item);
  if (item.flip) pts = reversed(pts);
  const pl = polyline(pts);
  const cs = chars(item, o);
  const spacing = item.spacing || 0;
  const widths = cs.map((c) => m(c.ch, c.css) * hscaleOf(c.style) + (c.style.spc || 0) + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - (cs.length ? spacing : 0);
  const free = Math.max(0, pl.length - total - item.offset);
  let s = item.offset;
  let gap = 0;
  if (item.align === 'center') s += free / 2;
  else if (item.align === 'end') s += free;
  else if (item.align === 'justify' && cs.length > 1) gap = free / (cs.length - 1);
  const glyphs: PathGlyph[] = [];
  let overflow = 0;
  cs.forEach((c, i) => {
    const w = widths[i];
    const mid = s + w / 2;
    if (mid > pl.length + 0.01 || mid < -0.01) { overflow++; s += w + gap; return; }
    const p = pointAt(pl, mid);
    // Shift along the normal: the left of the direction of travel is "above" the path.
    const nx = Math.sin(p.angle), ny = -Math.cos(p.angle);
    const lift = item.baseline + (c.raise || 0) + (c.style.shift ?? 0);
    const local = { x: p.x + nx * lift, y: p.y + ny * lift };
    const pageP = localToPage(item, local);
    // The angle comes from the page-space tangent, so rotation and flips of the item are honored.
    const ahead = localToPage(item, { x: local.x + Math.cos(p.angle), y: local.y + Math.sin(p.angle) });
    let angle = (Math.atan2(ahead.y - pageP.y, ahead.x - pageP.x) * 180) / Math.PI;
    angle = ((angle % 360) + 360) % 360;
    if (c.ch.trim()) glyphs.push({ ch: c.ch, x: pageP.x, y: pageP.y, angle, w, size: c.size, font: c.font, style: c.style, ...(c.footnote ? { footnote: c.footnote } : {}) });
    s += w + gap;
  });
  return { glyphs, overflow, length: pl.length };
}

export function pathTextGlyphs(item: PathTextItem, o: PathTextOptions): PathGlyph[] { return pathTextLayout(item, o).glyphs; }

export interface PathTextNotes {
  /** Note lines in the item's LOCAL box (the renderer's group transform places them with the item). */
  lines: LaidLine[];
  /** Separator rule above the notes, local coordinates. */
  separator?: { x: number; y: number; w: number };
  /** Height of the note area under the item's box (0 without notes). */
  h: number;
}

/**
 * The footnotes of a path text item, set in a note area below the item's box: full item width, a
 * separator above, numbered as the references are. Local coordinates (y grows from item.h).
 */
export function pathTextNotes(item: PathTextItem, o: Omit<LayoutOptions, 'boxes'>): PathTextNotes {
  const fnOpts = o.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS;
  const labels = pathTextFootnoteLabels(item, fnOpts);
  const present = pathTextFootnoteRefs(item).filter((id) => (item.footnotes || []).some((f) => f.id === id));
  if (!present.length) return { lines: [], h: 0 };
  const sepTotal = fnOpts.separator.space + 2;
  const w = Math.max(1, item.w);
  const separator = { x: 0, y: item.h + fnOpts.separator.space * 0.5, w: w * Math.max(0, Math.min(1, fnOpts.separator.length)) };
  const lines: LaidLine[] = [];
  let y = item.h + sepTotal;
  for (const id of present) {
    const fn = item.footnotes!.find((f) => f.id === id)!;
    const box: FlowBox = { frame: item.id, col: 0, x: 0, y, w, h: 1e6 };
    const r = layoutStory(labeledFootnote(fn.paras, labels[id], fnOpts.style), { ...o, boxes: [box], unbounded: true, anchor: undefined, grid: undefined, footnote: undefined, anchoredItem: undefined });
    for (const l of r.lines) { l.footnote = true; l.footnoteId = id; lines.push(l); }
    y += r.used;
  }
  return { lines, separator, h: y - item.h + 2 };
}

/** Plain text of a path text item. */
export function pathTextString(item: PathTextItem): string {
  return item.text.map((p) => p.runs.map((r) => (r.br ? ' ' : r.text)).join('')).join(' ');
}
