/**
 * The intermediate layout document shared by the Publisher readers: pages of shapes with resolved
 * fills, strokes, text links and pictures, in points-ready EMU coordinates. For 2002+ files it is
 * built here from the Contents chunks, the Office Art property tables and the delay-stream
 * pictures; the 2000/97 reader (pub2k.ts) builds the same structure from its own records.
 */
import type { Fill, Dash, ArrowEnd, Color } from '../../model/types';
import type { ContentsInfo, TableInfo } from './contents';
import type { EscherInfo, EscherShape, DelayPicture } from './escher';
import { customPath, parseVertices, parseSegments } from './escher';
import type { QuillInfo } from './quill';
import { emuPt, fixed16 } from './cfbStreams';
import { colorOf } from './text';

export interface LLine { color: Color; width: number; dash?: Dash; head?: ArrowEnd; tail?: ArrowEnd; cap?: 'flat' | 'round' | 'square' }

export interface LShape {
  seq: number;
  kind: 'shape' | 'group' | 'table';
  /** Office Art shape type number. */
  type: number;
  /** EMU relative to the page center. */
  box?: { xs: number; ys: number; xe: number; ye: number };
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
  textId?: number;
  /** 0 top, 1 middle, 2 bottom. */
  valign?: number;
  /** 1-based index into the pictures list. */
  picture?: number;
  fill?: Fill;
  /** The fill applies only when the shape is a page background. */
  fillBgOnly?: boolean;
  line?: LLine;
  /** Points: left, top, right, bottom. */
  insets?: [number, number, number, number];
  columns?: number;
  gutter?: number;
  shadow?: { color: Color; dist: number; dir: number; alpha?: number };
  custom?: { d: string; w: number; h: number };
  table?: TableInfo;
  children?: LShape[];
  brightness?: number;
  contrast?: number;
  wrap?: boolean;
  borderArt?: boolean;
  alt?: boolean;
}

export interface LPage { seq: number; shapes: LShape[]; bg?: Fill; isMaster: boolean; master?: number }

export interface LDoc {
  version: string;
  /** EMU. */
  width: number;
  height: number;
  /** Ordinary pages first in reading order, then master pages. */
  pages: LPage[];
  quill: QuillInfo | null;
  pictures: DelayPicture[];
  palette: number[];
  embeddedFonts: number;
  counts: { unknownShapes: number; borderArt: number; calcGeometry: number; unplaced: number };
  warnings: string[];
}

const DASHES: Record<number, Dash> = { 1: 'sysDash', 2: 'sysDot', 3: 'dashDot', 4: 'dashDot', 5: 'dot', 6: 'dash', 7: 'longDash', 8: 'dashDot', 9: 'longDashDot', 10: 'longDashDot' };
const ARROWS: Record<number, ArrowEnd> = { 1: 'triangle', 2: 'stealth', 3: 'diamond', 4: 'oval', 5: 'arrow' };
const DEFAULT_INSET = 36576;

/** A stroke exists unless the "use line" flag is set with the line flag clear. */
const lineOn = (flags: number | undefined, geom?: number): boolean =>
  (flags == null || !(flags & (1 << 19)) || !!(flags & (1 << 3))) && (geom == null || !(geom & (1 << 12)) || !!(geom & (1 << 28)));

function fillOf(p: Map<number, number>, pal: number[], names: Map<number, string>, delay: number[], pictures: DelayPicture[]): { fill?: Fill; bgOnly?: boolean } {
  const type = p.get(0x0180) ?? 0;
  const col = (id: number, def: number) => colorOf(p.get(id) ?? def, pal, names);
  const alpha = p.has(0x0182) ? Math.min(1, (p.get(0x0182) ?? 0xffff) / 0xffff) : undefined;
  const pic = (id: number) => { const px = p.get(id) || 0; const di = px > 0 && px <= delay.length ? delay[px - 1] : -1; return di > 0 && di <= pictures.length ? di : 0; };
  switch (type) {
    case 0: {
      const fs = p.get(0x01bf);
      const bgOnly = fs != null && (fs & 0xf0) === 0;
      if (!p.has(0x0181)) return bgOnly ? { bgOnly } : {};
      return { fill: { type: 'solid', color: col(0x0181, 0xffffff), ...(alpha != null && alpha < 1 ? { alpha } : {}) }, ...(bgOnly ? { bgOnly } : {}) };
    }
    case 4: case 5: case 6: case 7: {
      const a = col(0x0181, 0xffffff), b = col(0x0183, 0xffffff);
      let angle = (p.get(0x018b) ?? 0) >> 16;
      if (angle === -135) angle = -45; else if (angle === -45) angle = 225;
      const focus = ((p.get(0x018c) ?? 0) << 16) >> 16;
      let stops: { pos: number; color: Color }[];
      if (focus === 0) stops = [{ pos: 0, color: a }, { pos: 1, color: b }];
      else if (focus === 100) stops = [{ pos: 0, color: b }, { pos: 1, color: a }];
      else if (focus > 0) stops = [{ pos: 0, color: b }, { pos: focus / 100, color: a }, { pos: 1, color: b }];
      else stops = [{ pos: 0, color: a }, { pos: (100 + focus) / 100, color: b }, { pos: 1, color: a }];
      return { fill: { type: 'gradient', stops, angle: ((angle % 360) + 360) % 360, ...(type === 5 || type === 7 ? { path: 'radial' as const } : {}) } };
    }
    case 2: case 3: {
      const idx = pic(0x4186);
      if (!idx) return {};
      return { fill: { type: 'image', media: `pic:${idx}`, mode: type === 2 ? 'tile' : 'stretch', ...(alpha != null && alpha < 1 ? { alpha } : {}) } };
    }
    case 1: return { fill: { type: 'pattern', fg: col(0x0181, 0xffffff), bg: col(0x0183, 0xffffff) } };
    default: return {};
  }
}

function lineOf(p: Map<number, number>, t: Map<number, number>, pal: number[], names: Map<number, string>): LLine | undefined {
  if (!lineOn(p.get(0x01ff), p.get(0x017f))) return undefined;
  let color: Color | undefined, width = 9525;
  if (p.has(0x01c0)) { color = colorOf(p.get(0x01c0)!, pal, names); width = p.get(0x01cb) ?? 9525; }
  else if (t.size && lineOn(t.get(0x01ff))) {
    const sides: [number, number, number][] = [[0x0580, 0x058b, 0x05bf], [0x05c0, 0x05cb, 0x05ff], [0x0600, 0x060b, 0x063f], [0x0540, 0x054b, 0x057f]];
    for (const [c, w, f] of sides) if (t.has(c) && lineOn(t.get(f))) { color = colorOf(t.get(c)!, pal, names); width = t.get(w) ?? 9525; break; }
  }
  if (color == null) return undefined;
  const l: LLine = { color, width: Math.max(0.25, emuPt(width)) };
  const dash = DASHES[p.get(0x01ce) ?? 0];
  if (dash) l.dash = dash;
  const head = ARROWS[p.get(0x01d0) ?? 0], tail = ARROWS[p.get(0x01d1) ?? 0];
  if (head) l.head = head;
  if (tail) l.tail = tail;
  const cap = p.get(0x01d7);
  if (cap === 0) l.cap = 'round'; else if (cap === 1) l.cap = 'square';
  return l;
}

function convertShape(es: EscherShape, contents: ContentsInfo, delay: number[], pictures: DelayPicture[], names: Map<number, string>, counts: LDoc['counts']): LShape {
  const chunk = contents.shapes.get(es.seq);
  const p = es.props, t = es.tertiary, pal = contents.palette;
  const s: LShape = { seq: es.seq, kind: chunk?.kind === 'table' ? 'table' : es.children ? 'group' : 'shape', type: es.type, box: es.box };
  if (es.flipH) s.flipH = true;
  if (es.flipV) s.flipV = true;
  const rotRaw = p.get(0x0004);
  if (rotRaw != null) { const rot = ((fixed16(rotRaw) % 360) + 360) % 360; if (Math.abs(rot) > 0.01) s.rot = Math.round(rot * 100) / 100; }
  if (chunk?.textId != null) s.textId = chunk.textId;
  if (chunk?.valign != null) s.valign = chunk.valign;
  if (chunk?.table) s.table = chunk.table;
  if (chunk?.borderImage != null) { s.borderArt = true; counts.borderArt++; }
  if (chunk?.alt) s.alt = true;
  const px = p.get(0x4104) || 0;
  if (px > 0 && px <= delay.length && delay[px - 1] > 0 && delay[px - 1] <= pictures.length) s.picture = delay[px - 1];
  const f = fillOf(p, pal, names, delay, pictures);
  if (f.fill) s.fill = f.fill;
  if (f.bgOnly) s.fillBgOnly = true;
  const line = lineOf(p, t, pal, names);
  if (line) s.line = line;
  s.insets = [emuPt(p.get(0x0081) ?? DEFAULT_INSET), emuPt(p.get(0x0082) ?? DEFAULT_INSET), emuPt(p.get(0x0083) ?? DEFAULT_INSET), emuPt(p.get(0x0084) ?? DEFAULT_INSET)];
  if (t.has(0x008c) && (t.get(0x008c) || 0) > 1) { s.columns = t.get(0x008c); if (t.has(0x008d)) s.gutter = emuPt(t.get(0x008d) || 0); }
  const sh = p.get(0x023f);
  if (sh != null && sh & (1 << 17) && sh & (1 << 1)) {
    const dx = emuPt((p.get(0x0205) ?? 0x6338) | 0), dy = emuPt((p.get(0x0206) ?? 0x6338) | 0);
    s.shadow = { color: colorOf(p.get(0x0201) ?? 0x808080, pal, names), dist: Math.round(Math.hypot(dx, dy) * 100) / 100, dir: Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360), alpha: p.has(0x0204) ? Math.min(1, fixed16(p.get(0x0204)!)) : undefined };
  }
  if (p.has(0x0108) || p.has(0x0109)) {
    if (p.has(0x0109)) s.brightness = Math.round((fixed16(p.get(0x0109)!) - 0.5) * 200);
    if (p.has(0x0108)) s.contrast = Math.round((fixed16(p.get(0x0108)!) - 1) * 100);
  }
  const verts = es.complex.get(0xc145);
  if (verts) {
    const vs = parseVertices(verts);
    if (vs.some((v) => v.calc)) counts.calcGeometry++;
    const path = customPath(vs, parseSegments(es.complex.get(0xc146) || new Uint8Array(0)));
    if (path.d) s.custom = { d: path.d, w: p.get(0x0142) ?? 21600, h: p.get(0x0143) ?? 21600 };
  }
  if (es.complex.has(0xc383)) s.wrap = true;
  if (es.children) s.children = es.children.map((c) => convertShape(c, contents, delay, pictures, names, counts));
  return s;
}

/** Builds the layout document of a 2002+ publication. */
export function buildLayout(contents: ContentsInfo, quill: QuillInfo | null, escher: EscherInfo, pictures: DelayPicture[], version: string): LDoc {
  const counts = { unknownShapes: 0, borderArt: 0, calcGeometry: 0, unplaced: 0 };
  const names = new Map<number, string>();
  contents.palette.forEach((_c, i) => names.set(i, `Scheme Color ${i + 1}`));
  const doc: LDoc = { version, width: contents.width, height: contents.height, pages: [], quill, pictures, palette: contents.palette, embeddedFonts: contents.fonts.filter((f) => f.eot).length, counts, warnings: [...contents.warnings] };
  const pageOfShape = new Map<number, number>();
  for (const pg of contents.pages.values()) for (const sq of pg.shapes) pageOfShape.set(sq, pg.seq);
  const shapesByPage = new Map<number, LShape[]>();
  const converted = new Map<number, LShape>();
  for (const es of escher.shapes) {
    const ls = convertShape(es, contents, escher.delayIndex, pictures, names, counts);
    converted.set(ls.seq, ls);
    const pg = pageOfShape.get(ls.seq);
    if (pg == null) { counts.unplaced++; continue; }
    if (!shapesByPage.has(pg)) shapesByPage.set(pg, []);
    shapesByPage.get(pg)!.push(ls);
  }
  // Some files list shapes on a page that the drawing layer places inside groups; the group carries them.
  const ordered: number[] = [];
  for (const seq of contents.pageOrder) if (contents.pages.has(seq) && !ordered.includes(seq)) ordered.push(seq);
  for (const seq of contents.pages.keys()) if (!ordered.includes(seq)) ordered.push(seq);
  const pageOf = (seq: number): LPage | null => {
    const pc = contents.pages.get(seq);
    if (!pc || pc.dummy) return null;
    const pg: LPage = { seq, shapes: shapesByPage.get(seq) || [], isMaster: pc.isMaster, master: pc.master };
    if (pc.bgShape != null) {
      const bg = converted.get(pc.bgShape);
      if (bg?.fill) { pg.bg = bg.fill; pg.shapes = pg.shapes.filter((s) => s !== bg); }
    }
    return pg;
  };
  const masters: LPage[] = [], normal: LPage[] = [];
  for (const seq of ordered) { const pg = pageOf(seq); if (pg) (pg.isMaster ? masters : normal).push(pg); }
  doc.pages = [...normal, ...masters];
  return doc;
}
