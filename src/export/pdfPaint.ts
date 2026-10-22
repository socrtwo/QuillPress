/**
 * Painting helpers for the PDF writer, matched to what the SVG renderer (src/render/page.ts) shows:
 * SVG path data to PDF path operators, fills (solid, gradient as an axial or radial shading in the
 * object's bounding box, hatch patterns as tiling patterns, picture fills), line ends (the renderer's
 * marker shapes at the same size and angle) and drop shadows (offset, without the blur).
 */
import type { Fill, Line, ArrowEnd } from '../model/types';
import { colorHex } from '../model/styles';
import { imageObj, type ImageCtx } from './pdfImages';

export const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

// CSS named colors (colorHex passes names through when no swatch has that name).
const NAMED = new Map('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'.split(' ').map((e) => e.split(':') as [string, string]));

/** Any CSS color the renderer accepts (#rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), hsl(), names) as 0–1 RGB; black when unknown. */
export function rgb(color: string): [number, number, number] {
  const c = (color || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(c);
  if (m) { const v = m[1]; return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number]; }
  m = /^#([0-9a-f]{3})[0-9a-f]?$/.exec(c);
  if (m) { const v = m[1]; return [0, 1, 2].map((i) => parseInt(v[i] + v[i], 16) / 255) as [number, number, number]; }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/.exec(c);
  if (m) { const g = m; return [[g[1], g[2]], [g[3], g[4]], [g[5], g[6]]].map(([v, pc]) => Math.max(0, Math.min(1, pc ? +v / 100 : +v / 255))) as [number, number, number]; }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(c);
  if (m) {
    const h = (((+m[1] % 360) + 360) % 360) / 360, s = +m[2] / 100, l = +m[3] / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  const named = NAMED.get(c);
  return named ? rgb('#' + named) : [0, 0, 0];
}

export interface PaintWriter { add(body: string): number; stream(dict: string, data: Uint8Array | string): number }

export interface PaintCtx extends ImageCtx {
  w: PaintWriter;
  /** `/ShN obj 0 R` entries of the shared resource dictionary. */
  shadings: string[];
  /** Tiling patterns by key → resource name, and their resource entries. */
  patterns: Map<string, string>;
  patRes: string[];
  /** The page's base matrix (y-down page coordinates); tiling patterns are defined in it. */
  pageMatrix: string;
}

// ------------------------------------------------------------------------------------------
// Paths

export interface PathEnds { start?: { x: number; y: number; dx: number; dy: number }; end?: { x: number; y: number; dx: number; dy: number } }

/**
 * SVG path data → PDF path operators (coordinates unchanged; the caller's matrix maps them). Also
 * reports the first and last vertex with their tangents (where SVG places marker-start and -end).
 */
export function pathOps(d: string, ends?: PathEnds): string {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const out: string[] = [];
  const pts: [number, number][] = [];
  let firstLen = -1;
  const next = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    const t = tok[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t; i++;
      if (cmd === 'Z' || cmd === 'z') { out.push('h'); pts.push([sx, sy]); cx = sx; cy = sy; }
      continue;
    }
    switch (cmd) {
      case 'M': case 'm': {
        const rel = cmd === 'm';
        if (firstLen < 0 && pts.length) firstLen = pts.length;
        cx = (rel ? cx : 0) + next(); cy = (rel ? cy : 0) + next(); sx = cx; sy = cy;
        out.push(`${n(cx)} ${n(cy)} m`); pts.push([cx, cy]); cmd = rel ? 'l' : 'L'; break;
      }
      case 'L': cx = next(); cy = next(); out.push(`${n(cx)} ${n(cy)} l`); pts.push([cx, cy]); break;
      case 'l': cx += next(); cy += next(); out.push(`${n(cx)} ${n(cy)} l`); pts.push([cx, cy]); break;
      case 'H': cx = next(); out.push(`${n(cx)} ${n(cy)} l`); pts.push([cx, cy]); break;
      case 'h': cx += next(); out.push(`${n(cx)} ${n(cy)} l`); pts.push([cx, cy]); break;
      case 'V': cy = next(); out.push(`${n(cx)} ${n(cy)} l`); pts.push([cx, cy]); break;
      case 'v': cy += next(); out.push(`${n(cx)} ${n(cy)} l`); pts.push([cx, cy]); break;
      case 'C': case 'c': {
        const rel = cmd === 'c';
        const x1 = (rel ? cx : 0) + next(), y1 = (rel ? cy : 0) + next(), x2 = (rel ? cx : 0) + next(), y2 = (rel ? cy : 0) + next();
        cx = (rel ? cx : 0) + next(); cy = (rel ? cy : 0) + next();
        out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(cx)} ${n(cy)} c`); pts.push([x1, y1], [x2, y2], [cx, cy]); break;
      }
      case 'Q': case 'q': {
        const rel = cmd === 'q';
        const qx = (rel ? cx : 0) + next(), qy = (rel ? cy : 0) + next(); const ex = (rel ? cx : 0) + next(), ey = (rel ? cy : 0) + next();
        const x1 = cx + (2 / 3) * (qx - cx), y1 = cy + (2 / 3) * (qy - cy), x2 = ex + (2 / 3) * (qx - ex), y2 = ey + (2 / 3) * (qy - ey);
        cx = ex; cy = ey; out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(cx)} ${n(cy)} c`); pts.push([x1, y1], [x2, y2], [cx, cy]); break;
      }
      case 'A': case 'a': {
        const rel = cmd === 'a';
        const rx = next(), ry = next(), rot = next(), large = next(), sweep = next();
        const ex = (rel ? cx : 0) + next(), ey = (rel ? cy : 0) + next();
        const segs = arcToBeziers(cx, cy, rx, ry, rot, !!large, !!sweep, ex, ey);
        out.push(...segs.map((s) => s.op));
        for (const s of segs) pts.push(...s.pts);
        cx = ex; cy = ey; break;
      }
      default: i++;
    }
  }
  if (ends && pts.length > 1) {
    const sub = firstLen < 0 ? pts.length : firstLen;
    const p0 = pts[0];
    for (let k = 1; k < sub; k++) { const p = pts[k]; if (Math.hypot(p[0] - p0[0], p[1] - p0[1]) > 1e-6) { ends.start = { x: p0[0], y: p0[1], dx: p0[0] - p[0], dy: p0[1] - p[1] }; break; } }
    const pe = pts[pts.length - 1];
    for (let k = pts.length - 2; k >= 0; k--) { const p = pts[k]; if (Math.hypot(pe[0] - p[0], pe[1] - p[1]) > 1e-6) { ends.end = { x: pe[0], y: pe[1], dx: pe[0] - p[0], dy: pe[1] - p[1] }; break; } }
  }
  return out.join('\n');
}

function arcToBeziers(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): { op: string; pts: [number, number][] }[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ op: `${n(x2)} ${n(y2)} l`, pts: [[x2, y2]] }];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  let Rx = Math.abs(rx), Ry = Math.abs(ry);
  const lam = (x1p * x1p) / (Rx * Rx) + (y1p * y1p) / (Ry * Ry);
  if (lam > 1) { Rx *= Math.sqrt(lam); Ry *= Math.sqrt(lam); }
  const sign = large === sweep ? -1 : 1;
  const num = Math.max(0, Rx * Rx * Ry * Ry - Rx * Rx * y1p * y1p - Ry * Ry * x1p * x1p);
  const den = Rx * Rx * y1p * y1p + Ry * Ry * x1p * x1p;
  const co = sign * Math.sqrt(den ? num / den : 0);
  const cxp = (co * Rx * y1p) / Ry, cyp = (-co * Ry * x1p) / Rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const d = ux * vx + uy * vy, l = Math.hypot(ux, uy) * Math.hypot(vx, vy); let a = Math.acos(Math.max(-1, Math.min(1, d / l))); if (ux * vy - uy * vx < 0) a = -a; return a; };
  const t1 = ang(1, 0, (x1p - cxp) / Rx, (y1p - cyp) / Ry);
  let dt = ang((x1p - cxp) / Rx, (y1p - cyp) / Ry, (-x1p - cxp) / Rx, (-y1p - cyp) / Ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const out: { op: string; pts: [number, number][] }[] = [];
  const delta = dt / segs;
  let t = t1;
  for (let s = 0; s < segs; s++) {
    const t2 = t + delta;
    const k = (4 / 3) * Math.tan((t2 - t) / 4);
    const p = (a: number) => [cx + Rx * Math.cos(a) * cos - Ry * Math.sin(a) * sin, cy + Rx * Math.cos(a) * sin + Ry * Math.sin(a) * cos];
    const dp = (a: number) => [-Rx * Math.sin(a) * cos - Ry * Math.cos(a) * sin, -Rx * Math.sin(a) * sin + Ry * Math.cos(a) * cos];
    const [p1x, p1y] = p(t), [p2x, p2y] = p(t2), [d1x, d1y] = dp(t), [d2x, d2y] = dp(t2);
    const c1: [number, number] = [p1x + k * d1x, p1y + k * d1y], c2: [number, number] = [p2x - k * d2x, p2y - k * d2y];
    out.push({ op: `${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2x)} ${n(p2y)} c`, pts: [c1, c2, [p2x, p2y]] });
    t = t2;
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Fills

/** `r g b rg` (plus an opacity state) for a color; null when it resolves to none. */
export function solidOp(ctx: PaintCtx, color: string | undefined, alpha?: number): string | null {
  const hex = colorHex(ctx.pub.data, color);
  if (!hex || hex === 'none') return null;
  const [r, g, b] = rgb(hex);
  return `${n(r)} ${n(g)} ${n(b)} rg${alpha != null && alpha < 1 ? ` /GSa${Math.round(alpha * 100)} gs` : ''}`;
}

/** The single color a fill reduces to where only one color can be used (strokes, text). */
export function fillColor(ctx: PaintCtx, fill: Fill | undefined): string | null {
  if (!fill || fill.type === 'none') return null;
  const d = ctx.pub.data;
  const hex = fill.type === 'solid' ? colorHex(d, fill.color) : fill.type === 'gradient' ? colorHex(d, fill.stops[0]?.color) : fill.type === 'pattern' ? colorHex(d, fill.fg) : null;
  return hex && hex !== 'none' ? hex : null;
}

/**
 * Operators that fill a path (given as PDF path operators in the current coordinates, whose box is
 * 0,0–w,h) with any kind of fill; a self-contained q…Q block, or null when nothing is painted.
 */
export async function fillPath(ctx: PaintCtx, fill: Fill | undefined, path: string, w: number, h: number, evenOdd = false): Promise<string | null> {
  if (!fill || fill.type === 'none') return null;
  const W = evenOdd ? 'W*' : 'W', F = evenOdd ? 'f*' : 'f';
  switch (fill.type) {
    case 'solid': { const op = solidOp(ctx, fill.color, fill.alpha); return op ? `q ${op}\n${path}\n${F} Q` : null; }
    case 'gradient': {
      const sh = w > 0 && h > 0 ? shading(ctx, fill) : null;
      if (!sh) { const hex = fillColor(ctx, fill); if (!hex) return null; const [r, g, b] = rgb(hex); return `q ${n(r)} ${n(g)} ${n(b)} rg\n${path}\n${F} Q`; }
      return `q\n${path}\n${W} n ${n(w)} 0 0 ${n(h)} 0 0 cm ${sh} sh Q`;
    }
    case 'pattern': return `q /Pattern cs ${tilingPattern(ctx, fill)} scn\n${path}\n${F} Q`;
    case 'image': {
      const im = await imageObj(ctx, fill.media);
      if (!im || w <= 0 || h <= 0) return null;
      const ga = fill.alpha != null && fill.alpha < 1 ? `/GSa${Math.round(fill.alpha * 100)} gs ` : '';
      const draw = (x: number, y: number, dw: number, dh: number) => `q ${n(dw)} 0 0 ${n(-dh)} ${n(x)} ${n(y + dh)} cm ${im.res} Do Q`;
      let body = '';
      if (fill.mode === 'tile') {
        const parts: string[] = [];
        for (let y = 0; y < h && parts.length < 2500; y += 96) for (let x = 0; x < w && parts.length < 2500; x += 96) parts.push(draw(x, y, 96, 96));
        body = parts.join('\n');
      } else if (fill.mode === 'fit') {
        const k = Math.min(w / im.w, h / im.h);
        body = draw((w - im.w * k) / 2, (h - im.h * k) / 2, im.w * k, im.h * k);
      } else body = draw(0, 0, w, h);
      return `q ${ga}\n${path}\n${W} n\n${body}\nQ`;
    }
  }
  return null;
}

/** An axial or radial shading for a gradient fill in the unit box (the caller scales it to the object). */
function shading(ctx: PaintCtx, fill: Extract<Fill, { type: 'gradient' }>): string | null {
  const d = ctx.pub.data;
  const hexOf = (c: string) => { const h = colorHex(d, c, '#FFFFFF'); return h === 'none' ? '#FFFFFF' : h; };
  const stops = fill.stops
    .map((s) => ({ pos: Math.max(0, Math.min(1, s.pos)), c: rgb(hexOf(s.color)) }))
    .sort((a, b) => a.pos - b.pos);
  if (stops.length < 2) return null;
  if (stops[0].pos > 0) stops.unshift({ pos: 0, c: stops[0].c });
  if (stops[stops.length - 1].pos < 1) stops.push({ pos: 1, c: stops[stops.length - 1].c });
  // Bounds must increase strictly: a stop at the same position as the previous one replaces it.
  const pts: { pos: number; c: [number, number, number] }[] = [];
  // (A hard step keeps its edge: the second stop moves a hair to the right.)
  for (const s of stops) {
    const last = pts[pts.length - 1];
    if (!last || s.pos > last.pos + 1e-6) pts.push({ ...s });
    else if (last.pos + 1e-4 < 1) pts.push({ pos: last.pos + 1e-4, c: s.c });
    else last.c = s.c;
  }
  if (pts.length < 2) return null;
  const c = (v: [number, number, number]) => `[${v.map(n).join(' ')}]`;
  const segs: string[] = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push(`<< /FunctionType 2 /Domain [0 1] /C0 ${c(pts[i].c)} /C1 ${c(pts[i + 1].c)} /N 1 >>`);
  if (!segs.length) return null;
  const fn = segs.length === 1 ? segs[0] : `<< /FunctionType 3 /Domain [0 1] /Functions [${segs.join(' ')}] /Bounds [${pts.slice(1, -1).map((p) => n(p.pos)).join(' ')}] /Encode [${segs.map(() => '0 1').join(' ')}] >>`;
  let coords: string, type: number;
  if (fill.path === 'radial') { type = 3; coords = '0.5 0.5 0 0.5 0.5 0.5'; }
  else {
    // As the renderer's linearGradient: the vector through the box center at `angle` (degrees, clockwise from +x), in bounding-box units.
    const a = ((fill.angle ?? 90) * Math.PI) / 180;
    const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
    type = 2; coords = `${n(0.5 - dx)} ${n(0.5 - dy)} ${n(0.5 + dx)} ${n(0.5 + dy)}`;
  }
  const obj = ctx.w.add(`<< /ShadingType ${type} /ColorSpace /DeviceRGB /Coords [${coords}] /Function ${fn} /Extend [true true] >>`);
  const res = `/Sh${ctx.shadings.length + 1}`;
  ctx.shadings.push(`${res} ${obj} 0 R`);
  return res;
}

/** An 8-point hatch cell as the renderer draws it, as a colored tiling pattern in page coordinates. */
function tilingPattern(ctx: PaintCtx, fill: Extract<Fill, { type: 'pattern' }>): string {
  const d = ctx.pub.data;
  const fg = rgb(colorHex(d, fill.fg)), bg = colorHex(d, fill.bg, '#FFFFFF');
  const key = `${fill.fg}|${fill.bg}|${fill.preset || ''}|${ctx.pageMatrix}`;
  const hit = ctx.patterns.get(key);
  if (hit) return hit;
  const p = fill.preset || '';
  const s = `${n(fg[0])} ${n(fg[1])} ${n(fg[2])}`;
  const mark = /horz/i.test(p) ? `${s} RG 1 w 0 4 m 8 4 l S` : /vert/i.test(p) ? `${s} RG 1 w 4 0 m 4 8 l S` : /dn|down|wd/i.test(p) ? `${s} RG 1 w 0 0 m 8 8 l S` : /cross/i.test(p) ? `${s} RG 1 w 0 4 m 8 4 l 4 0 m 4 8 l S` : /up/i.test(p) ? `${s} RG 1 w 0 8 m 8 0 l S` : `${s} rg 3 3 2 2 re f`;
  const bgOp = bg === 'none' ? '' : (() => { const [r, g, b] = rgb(bg); return `${n(r)} ${n(g)} ${n(b)} rg 0 0 8 8 re f `; })();
  const obj = ctx.w.stream(`/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >> /Matrix [${ctx.pageMatrix}]`, `${bgOp}${mark}`);
  const res = `/Pa${ctx.patterns.size + 1}`;
  ctx.patterns.set(key, res);
  ctx.patRes.push(`${res} ${obj} 0 R`);
  return res;
}

// ------------------------------------------------------------------------------------------
// Line ends and shadows

/** The renderer's marker for a line end at a vertex, pointing along (dx, dy); `end` is 'head' (path start) or 'tail'. */
export function arrowOps(kind: ArrowEnd | undefined, end: 'head' | 'tail', width: number, color: [number, number, number], at: { x: number; y: number; dx: number; dy: number }): string {
  if (!kind || kind === 'none') return '';
  const len = Math.hypot(at.dx, at.dy);
  if (!len) return '';
  const ca = at.dx / len, sa = at.dy / len;
  // markerWidth is in stroke-width units; the marker's viewBox is 10 units wide.
  const k = (Math.max(3, 3 + width) * width) / 10;
  const refX = end === 'tail' ? 8 : 2;
  const col = `${n(color[0])} ${n(color[1])} ${n(color[2])}`;
  const shape = kind === 'oval' ? `${col} rg 9 5 m 9 7.209 7.209 9 5 9 c 2.791 9 1 7.209 1 5 c 1 2.791 2.791 1 5 1 c 7.209 1 9 2.791 9 5 c h f`
    : kind === 'diamond' ? `${col} rg 5 0 m 10 5 l 5 10 l 0 5 l h f`
    : kind === 'arrow' ? `${col} RG 1.5 w [] 0 d 0 J 0 j 0 0 m 10 5 l 0 10 l S`
    : kind === 'stealth' ? `${col} rg 0 0 m 10 5 l 0 10 l 3 5 l h f`
    : `${col} rg 0 0 m 10 5 l 0 10 l h f`;
  return `q 1 0 0 1 ${n(at.x)} ${n(at.y)} cm ${n(ca)} ${n(sa)} ${n(-sa)} ${n(ca)} 0 0 cm ${n(k)} 0 0 ${n(k)} 0 0 cm 1 0 0 1 ${-refX} -5 cm ${shape} Q`;
}

/** Both line ends of a stroked path (`ends` from pathOps) for a Line. */
export function lineEndsOps(ctx: PaintCtx, line: Line | undefined, ends: PathEnds): string {
  if (!line || (!line.head && !line.tail) || !line.fill || line.fill.type === 'none') return '';
  const hex = fillColor(ctx, line.fill);
  if (!hex) return '';
  const c = rgb(hex), w = line.width ?? 0.75;
  // marker-start uses orient="auto-start-reverse": it points backwards, away from the path.
  return [ends.start ? arrowOps(line.head, 'head', w, c, ends.start) : '', ends.end ? arrowOps(line.tail, 'tail', w, c, ends.end) : ''].filter(Boolean).join('\n');
}

/** A drop shadow: the shape's outline filled in the shadow color, offset (the PDF has no blur). */
export function shadowOps(ctx: PaintCtx, effects: { shadow?: { color: string; dist: number; dir: number; alpha?: number } } | undefined, path: string, evenOdd = false): string {
  const sh = effects?.shadow;
  if (!sh || !sh.dist) return '';
  const hex = colorHex(ctx.pub.data, sh.color);
  if (!hex || hex === 'none') return '';
  const [r, g, b] = rgb(hex);
  const a = (sh.dir * Math.PI) / 180;
  const alpha = Math.max(0.05, Math.min(1, (sh.alpha ?? 0.5) * 0.8));
  return `q 1 0 0 1 ${n(Math.cos(a) * sh.dist)} ${n(Math.sin(a) * sh.dist)} cm /GSa${Math.round(alpha * 100)} gs ${n(r)} ${n(g)} ${n(b)} rg\n${path}\n${evenOdd ? 'f*' : 'f'} Q`;
}
