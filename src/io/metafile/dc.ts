/**
 * The drawing context shared by the WMF and EMF players: GDI state (pen, brush, font, colours, modes,
 * window/viewport mapping, world transform, clipping, current position, path bracket) and the SVG it
 * accumulates.
 *
 * Geometry is built in logical coordinates and mapped point by point (curves as cubic Béziers, which
 * survive any affine mapping), so rotated world transforms and flipped windows come out right.
 * Output coordinates are "device" units: for EMF the reference device's pixels; for WMF, which has no
 * device, the window in effect at the first drawing record (a metafile's window is the picture frame
 * a player maps onto its target), so later window changes rescale the drawing as GDI would.
 */
import type { Brush, Font, Pen, Region } from './objects';
import { DEFAULT_BRUSH, DEFAULT_FONT, DEFAULT_PEN, fontCss, hatchPattern } from './objects';

export type Pt = [number, number];
/** a b c d e f: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

interface Clip { d: string; rule: 'nonzero' | 'evenodd'; parent: Clip | null; id?: string }

export interface DcState {
  pen: Pen; brush: Brush; font: Font;
  textColor: string; bkColor: string; bkMode: number; textAlign: number; polyFill: number; rop2: number;
  mapMode: number; wOrg: Pt; wExt: Pt | null; vOrg: Pt; vExt: Pt | null; world: Mat;
  clip: Clip | null; cur: Pt; arcDir: number; miterLimit: number; charExtra: number;
}

export interface DcOptions {
  mode: 'wmf' | 'emf';
  /** WMF: the logical rectangle of the picture when the file gives one (placeable header, BLIP bounds). */
  bounds?: { left: number; top: number; right: number; bottom: number };
  /** EMF: the picture frame in device pixels, and the device's pixels per millimetre (for metric map modes). */
  frame?: { x: number; y: number; w: number; h: number };
  pxPerMm?: [number, number];
  /** The picture's size in points, when the container says (placeable header, BLIP, EMF frame). */
  sizePt?: { w: number; h: number };
}

const r3 = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000));
const KAPPA = (a: number) => (4 / 3) * Math.tan(a / 4);

export class SvgDc {
  st: DcState;
  private stack: DcState[] = [];
  private body: string[] = [];
  private defs: string[] = [];
  private clipIds = 0;
  private patIds = 0;
  private patCache = new Map<string, string>();
  /** WMF reference window (the picture frame), fixed at the first drawing record. */
  private ref: { org: Pt; ext: Pt } | null = null;
  private bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  /** Open path bracket (EMF BeginPath): figures in device coordinates. */
  private path: string[] | null = null;
  private lastPath = '';
  elements = 0;
  /** Device units per CSS pixel of the output picture (pattern cells, hairlines, default text size). */
  get unitsPerPx(): number {
    const size = this.opts.sizePt;
    if (!size || !size.w) return 1;
    const units = this.opts.mode === 'emf' ? this.opts.frame?.w : this.ref ? Math.abs(this.ref.ext[0]) : this.opts.bounds ? Math.abs(this.opts.bounds.right - this.opts.bounds.left) : 0;
    return units ? units / (size.w / 0.75) : 1;
  }

  constructor(readonly opts: DcOptions) {
    this.st = {
      pen: { ...DEFAULT_PEN }, brush: { ...DEFAULT_BRUSH }, font: { ...DEFAULT_FONT },
      textColor: '#000000', bkColor: '#ffffff', bkMode: 2, textAlign: 0, polyFill: 1, rop2: 13,
      mapMode: 1, wOrg: [0, 0], wExt: null, vOrg: [0, 0], vExt: null, world: [...IDENTITY] as Mat,
      clip: null, cur: [0, 0], arcDir: 1, miterLimit: 10, charExtra: 0,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // State

  save(): void { this.stack.push({ ...this.st, wOrg: [...this.st.wOrg] as Pt, vOrg: [...this.st.vOrg] as Pt, cur: [...this.st.cur] as Pt, world: [...this.st.world] as Mat }); }
  /** RestoreDC: negative = relative to the top, positive = absolute level (1 = first saved). */
  restore(n: number): void {
    let target = n < 0 ? this.stack.length + n : n - 1;
    if (target < 0 || target >= this.stack.length) target = this.stack.length - 1;
    if (target < 0) return;
    this.st = this.stack[target];
    this.stack.length = target;
  }

  // ---------------------------------------------------------------------------------------------
  // Mapping

  /** Logical to device (output) coordinates. */
  map(x: number, y: number): Pt {
    const w = this.st.world;
    const wx = w[0] * x + w[2] * y + w[4], wy = w[1] * x + w[3] * y + w[5];
    return this.page(wx, wy);
  }

  private page(x: number, y: number): Pt {
    const s = this.st;
    if (this.opts.mode === 'wmf') {
      const ref = this.reference();
      const ext = s.wExt && s.wExt[0] && s.wExt[1] ? s.wExt : ref.ext;
      const org = s.wExt ? s.wOrg : s.wOrg;
      return [((x - org[0]) * Math.abs(ref.ext[0])) / ext[0], ((y - org[1]) * Math.abs(ref.ext[1])) / ext[1]];
    }
    // EMF: GDI's page transform onto the reference device.
    const mm = this.opts.pxPerMm || [96 / 25.4, 96 / 25.4];
    const metric: Record<number, number> = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 };
    if (metric[s.mapMode]) {
      const k = metric[s.mapMode];
      return [(x - s.wOrg[0]) * k * mm[0] + s.vOrg[0], -(y - s.wOrg[1]) * k * mm[1] + s.vOrg[1]];
    }
    if ((s.mapMode === 7 || s.mapMode === 8) && s.wExt && s.vExt && s.wExt[0] && s.wExt[1]) {
      let kx = s.vExt[0] / s.wExt[0], ky = s.vExt[1] / s.wExt[1];
      if (s.mapMode === 7) { const m = Math.min(Math.abs(kx), Math.abs(ky)); kx = Math.sign(kx) * m; ky = Math.sign(ky) * m; }
      return [(x - s.wOrg[0]) * kx + s.vOrg[0], (y - s.wOrg[1]) * ky + s.vOrg[1]];
    }
    return [x - s.wOrg[0] + s.vOrg[0], y - s.wOrg[1] + s.vOrg[1]];
  }

  /** The WMF frame: the window at the first drawing record, else the bounds the file gives. */
  private reference(): { org: Pt; ext: Pt } {
    if (this.ref) return this.ref;
    const s = this.st, b = this.opts.bounds;
    if (s.wExt && s.wExt[0] && s.wExt[1]) this.ref = { org: [...s.wOrg] as Pt, ext: [...s.wExt] as Pt };
    else if (b && b.right !== b.left && b.bottom !== b.top) {
      this.ref = { org: [b.left, b.top], ext: [b.right - b.left, b.bottom - b.top] };
      if (!s.wExt) s.wOrg = [b.left, b.top];
    } else this.ref = { org: [s.wOrg[0], s.wOrg[1]], ext: [0, 0] };
    return this.ref;
  }

  /** Called before drawing: fixes the WMF frame on first use. */
  private touch(): void { if (this.opts.mode === 'wmf') this.reference(); }

  /** Device length of a logical vector. */
  private len(dx: number, dy: number): number { const a = this.map(0, 0), b = this.map(dx, dy); return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  /** Determinant sign of the logical→device mapping (negative when one axis flips). */
  private det(): number { const o = this.map(0, 0), x = this.map(1, 0), y = this.map(0, 1); return (x[0] - o[0]) * (y[1] - o[1]) - (x[1] - o[1]) * (y[0] - o[0]); }

  private grow(p: Pt): void { const b = this.bbox; if (p[0] < b.x0) b.x0 = p[0]; if (p[1] < b.y0) b.y0 = p[1]; if (p[0] > b.x1) b.x1 = p[0]; if (p[1] > b.y1) b.y1 = p[1]; }
  private P(x: number, y: number): string { const p = this.map(x, y); if (!this.path) this.grow(p); return `${r3(p[0])} ${r3(p[1])}`; }

  // ---------------------------------------------------------------------------------------------
  // Paint

  private strokeAttrs(): string {
    const p = this.st.pen;
    if (p.style === 5 || this.st.rop2 === 11) return ' stroke="none"';
    const px = this.unitsPerPx;
    const hair = p.cosmetic || p.width <= 0;
    const w = hair ? px : Math.max(px * 0.5, p.width * this.len(1, 0));
    let a = ` stroke="${this.ropColor(p.color)}" stroke-width="${r3(w)}" stroke-linecap="${p.cap}" stroke-linejoin="${p.join}"`;
    if (p.join === 'miter') a += ` stroke-miterlimit="${r3(Math.max(1, this.st.miterLimit))}"`;
    // Cosmetic pens dash in device pixels; geometric pens in multiples of their width.
    const preset = hair
      ? ({ 1: [18, 6], 2: [3, 3], 3: [9, 6, 3, 6], 4: [9, 3, 3, 3, 3, 3] } as Record<number, number[]>)[p.style]
      : ({ 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] } as Record<number, number[]>)[p.style];
    const dash = p.style === 7 && p.dash?.length ? p.dash.map((v) => v * (hair ? px : this.len(1, 0))) : preset ? preset.map((v) => v * (hair ? px : w)) : null;
    if (dash && dash.some((v) => v > 0)) a += ` stroke-dasharray="${dash.map(r3).join(' ')}"`;
    return a;
  }

  private ropColor(c: string): string { return this.st.rop2 === 1 ? '#000000' : this.st.rop2 === 16 ? '#ffffff' : c; }
  private ropStyle(): string { const r = this.st.rop2; return r === 9 ? ' style="mix-blend-mode:multiply"' : r === 7 || r === 10 ? ' style="mix-blend-mode:difference"' : r === 15 ? ' style="mix-blend-mode:lighten"' : ''; }

  /** Fill attribute for a brush (patterns are registered as defs). */
  fillOf(b: Brush): string {
    if (b.style === 'null') return 'none';
    if (b.style === 'solid') return this.ropColor(b.color);
    const key = JSON.stringify([b.style, b.color, b.hatch, b.image?.href.length, b.image?.href.slice(-64), this.st.bkMode === 2 ? this.st.bkColor : null]);
    let id = this.patCache.get(key);
    if (!id) {
      id = `mp${++this.patIds}`;
      const px = this.unitsPerPx;
      if (b.style === 'hatch') this.defs.push(hatchPattern(id, b.hatch ?? 0, b.color, this.st.bkMode === 2 ? this.st.bkColor : null, 8 * px));
      else if (b.image) {
        const w = b.image.w * px, h = b.image.h * px;
        this.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r3(w)}" height="${r3(h)}"><image width="${r3(w)}" height="${r3(h)}" preserveAspectRatio="none" href="${b.image.href}"/></pattern>`);
      } else return b.color;
      this.patCache.set(key, id);
    }
    return `url(#${id})`;
  }

  private clipAttr(): string {
    const c = this.st.clip;
    if (!c) return '';
    return ` clip-path="url(#${this.clipId(c)})"`;
  }
  private clipId(c: Clip): string {
    if (c.id) return c.id;
    const parent = c.parent ? ` clip-path="url(#${this.clipId(c.parent)})"` : '';
    c.id = `mc${++this.clipIds}`;
    this.defs.push(`<clipPath id="${c.id}"${parent}><path d="${c.d}" clip-rule="${c.rule}"/></clipPath>`);
    return c.id;
  }

  private emit(el: string): void { this.body.push(el); this.elements++; }

  /** Draws (or, inside a path bracket, records) a path built in logical coordinates. */
  private shape(d: string, fill: boolean, stroke: boolean, rule?: 'nonzero' | 'evenodd'): void {
    if (!d) return;
    this.touch();
    if (this.path) { this.path.push(d); return; }
    if (this.st.rop2 === 11) return;
    const f = fill ? this.fillOf(this.st.brush) : 'none';
    const s = stroke ? this.strokeAttrs() : ' stroke="none"';
    if (f === 'none' && s === ' stroke="none"') return;
    const fr = (rule ?? (this.st.polyFill === 1 ? 'evenodd' : 'nonzero'));
    this.emit(`<path d="${d}" fill="${f}"${f !== 'none' && fr === 'evenodd' ? ' fill-rule="evenodd"' : ''}${s}${this.clipAttr()}${this.ropStyle()}/>`);
  }

  // ---------------------------------------------------------------------------------------------
  // Figures

  private polyD(pts: Pt[], close: boolean): string {
    if (pts.length < (close ? 2 : 2)) return '';
    let d = `M${this.P(pts[0][0], pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) d += `L${this.P(pts[i][0], pts[i][1])}`;
    return close ? d + 'Z' : d;
  }

  moveTo(x: number, y: number): void { this.st.cur = [x, y]; if (this.path) this.path.push(`M${this.P(x, y)}`); }
  lineTo(x: number, y: number): void {
    const [cx, cy] = this.st.cur;
    if (this.path) { this.path.push(`L${this.P(x, y)}`); this.st.cur = [x, y]; return; }
    this.shape(`M${this.P(cx, cy)}L${this.P(x, y)}`, false, true);
    this.st.cur = [x, y];
  }
  polyline(pts: Pt[], fromCurrent = false): void {
    if (!pts.length) return;
    const all = fromCurrent ? [this.st.cur, ...pts] : pts;
    if (this.path) { this.path.push((fromCurrent ? '' : `M${this.P(all[0][0], all[0][1])}`) + all.slice(1).map((p) => `L${this.P(p[0], p[1])}`).join('')); }
    else this.shape(this.polyD(all, false), false, true);
    if (fromCurrent) this.st.cur = pts[pts.length - 1];
  }
  polygon(pts: Pt[]): void { this.shape(this.polyD(pts, true), true, true); }
  polyPolygon(polys: Pt[][]): void { this.shape(polys.map((p) => this.polyD(p, true)).join(''), true, true); }
  polyPolyline(polys: Pt[][]): void { this.shape(polys.map((p) => this.polyD(p, false)).join(''), false, true); }
  /** PolyBezier (points include the start) or PolyBezierTo (from the current position). */
  bezier(pts: Pt[], fromCurrent: boolean): void {
    const all = fromCurrent ? [this.st.cur, ...pts] : pts;
    if (all.length < 4) return;
    let d = fromCurrent && this.path ? '' : `M${this.P(all[0][0], all[0][1])}`;
    for (let i = 1; i + 2 < all.length; i += 3) d += `C${this.P(all[i][0], all[i][1])} ${this.P(all[i + 1][0], all[i + 1][1])} ${this.P(all[i + 2][0], all[i + 2][1])}`;
    if (this.path) this.path.push(d); else this.shape(d, false, true);
    if (fromCurrent) this.st.cur = all[all.length - 1];
  }
  /** PolyDraw: point types 6 move, 2 line, 4 Bézier, with bit 1 closing the figure. */
  polyDraw(pts: Pt[], types: number[]): void {
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const t = types[i] & ~1;
      if (t === 6) d += `M${this.P(pts[i][0], pts[i][1])}`;
      else if (t === 2) d += `L${this.P(pts[i][0], pts[i][1])}`;
      else if (t === 4 && i + 2 < pts.length) { d += `C${this.P(pts[i][0], pts[i][1])} ${this.P(pts[i + 1][0], pts[i + 1][1])} ${this.P(pts[i + 2][0], pts[i + 2][1])}`; i += 2; }
      if (types[i] & 1) d += 'Z';
      this.st.cur = pts[i];
    }
    if (!d.startsWith('M')) d = `M${this.P(this.st.cur[0], this.st.cur[1])}` + d;
    if (this.path) this.path.push(d); else this.shape(d, false, true);
  }

  rect(l: number, t: number, r: number, b: number): void { this.shape(this.polyD([[l, t], [r, t], [r, b], [l, b]], true), true, true, 'nonzero'); }

  roundRect(l: number, t: number, r: number, b: number, ew: number, eh: number): void {
    const x0 = Math.min(l, r), x1 = Math.max(l, r), y0 = Math.min(t, b), y1 = Math.max(t, b);
    const rx = Math.min(Math.abs(ew) / 2, (x1 - x0) / 2), ry = Math.min(Math.abs(eh) / 2, (y1 - y0) / 2);
    if (rx <= 0 || ry <= 0) { this.rect(l, t, r, b); return; }
    let d = `M${this.P(x0 + rx, y0)}L${this.P(x1 - rx, y0)}`;
    d += this.arcD(x1 - rx, y0 + ry, rx, ry, -Math.PI / 2, 0);
    d += `L${this.P(x1, y1 - ry)}` + this.arcD(x1 - rx, y1 - ry, rx, ry, 0, Math.PI / 2);
    d += `L${this.P(x0 + rx, y1)}` + this.arcD(x0 + rx, y1 - ry, rx, ry, Math.PI / 2, Math.PI);
    d += `L${this.P(x0, y0 + ry)}` + this.arcD(x0 + rx, y0 + ry, rx, ry, Math.PI, Math.PI * 1.5) + 'Z';
    this.shape(d, true, true, 'nonzero');
  }

  ellipse(l: number, t: number, r: number, b: number): void {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
    if (!rx || !ry) return;
    this.shape(`M${this.P(cx + rx, cy)}` + this.arcD(cx, cy, rx, ry, 0, Math.PI * 2) + 'Z', true, true, 'nonzero');
  }

  /** Cubic segments of an elliptic arc from parameter a0 to a1 (logical space, either direction). */
  private arcD(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): string {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const step = (a1 - a0) / n, k = KAPPA(step);
    let d = '';
    for (let i = 0; i < n; i++) {
      const s = a0 + i * step, e = s + step;
      const p1: Pt = [cx + rx * (Math.cos(s) - k * Math.sin(s)), cy + ry * (Math.sin(s) + k * Math.cos(s))];
      const p2: Pt = [cx + rx * (Math.cos(e) + k * Math.sin(e)), cy + ry * (Math.sin(e) - k * Math.cos(e))];
      d += `C${this.P(p1[0], p1[1])} ${this.P(p2[0], p2[1])} ${this.P(cx + rx * Math.cos(e), cy + ry * Math.sin(e))}`;
    }
    return d;
  }

  /** Arc, Pie, Chord and ArcTo: the ellipse in the box, from the radial through the start point to the one through the end point. */
  arc(kind: 'arc' | 'pie' | 'chord' | 'arcto', l: number, t: number, r: number, b: number, xs: number, ys: number, xe: number, ye: number): void {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
    if (!rx || !ry) return;
    const a0 = Math.atan2((ys - cy) / ry, (xs - cx) / rx);
    let a1 = Math.atan2((ye - cy) / ry, (xe - cx) / rx);
    // GDI draws counterclockwise as seen on the device; in logical terms that depends on the mapping.
    const visualCcw = this.st.arcDir !== 2;
    const increasing = (this.det() < 0) === visualCcw;
    if (increasing) { while (a1 <= a0 + 1e-9) a1 += Math.PI * 2; } else { while (a1 >= a0 - 1e-9) a1 -= Math.PI * 2; }
    const start: Pt = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)];
    const end: Pt = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
    if (kind === 'arcto') {
      const d = (this.path ? `L${this.P(start[0], start[1])}` : `M${this.P(this.st.cur[0], this.st.cur[1])}L${this.P(start[0], start[1])}`) + this.arcD(cx, cy, rx, ry, a0, a1);
      if (this.path) this.path.push(d); else this.shape(d, false, true);
      this.st.cur = end;
      return;
    }
    let d = `M${this.P(start[0], start[1])}` + this.arcD(cx, cy, rx, ry, a0, a1);
    if (kind === 'pie') d += `L${this.P(cx, cy)}Z`;
    else if (kind === 'chord') d += 'Z';
    this.shape(d, kind !== 'arc', true, 'nonzero');
  }

  // ---------------------------------------------------------------------------------------------
  // Path bracket (EMF)

  beginPath(): void { this.touch(); this.path = []; }
  endPath(): void { if (this.path) { this.lastPath = this.path.join(''); this.path = null; } }
  abortPath(): void { this.path = null; this.lastPath = ''; }
  closeFigure(): void { if (this.path) this.path.push('Z'); }
  private takePath(): string { if (this.path) this.endPath(); const d = this.lastPath; this.lastPath = ''; return d.startsWith('M') ? d : d ? `M${this.P(this.st.cur[0], this.st.cur[1])}${d}` : ''; }
  /** Fills and/or strokes the closed path. The path is in device coordinates already. */
  drawPath(fill: boolean, stroke: boolean): void {
    const d = this.takePath();
    if (!d || this.st.rop2 === 11) return;
    const f = fill ? this.fillOf(this.st.brush) : 'none';
    const s = stroke ? this.strokeAttrs() : ' stroke="none"';
    this.emit(`<path d="${d}" fill="${f}"${f !== 'none' && this.st.polyFill === 1 ? ' fill-rule="evenodd"' : ''}${s}${this.clipAttr()}/>`);
  }
  /** SelectClipPath with a region mode (1 AND, 2 OR, 3 XOR, 4 DIFF, 5 COPY). */
  clipPath(mode: number): void {
    const d = this.takePath();
    if (!d) return;
    this.combineClip(d, this.st.polyFill === 1 ? 'evenodd' : 'nonzero', mode);
  }

  // ---------------------------------------------------------------------------------------------
  // Clipping (all in device coordinates)

  private rectD(l: number, t: number, r: number, b: number): string { return `M${this.P(l, t)}L${this.P(r, t)}L${this.P(r, b)}L${this.P(l, b)}Z`; }
  intersectClip(l: number, t: number, r: number, b: number): void { this.touch(); this.st.clip = { d: this.rectD(l, t, r, b), rule: 'nonzero', parent: this.st.clip }; }
  excludeClip(l: number, t: number, r: number, b: number): void {
    this.touch();
    const big = 'M-1e6 -1e6L1e6 -1e6L1e6 1e6L-1e6 1e6Z';
    this.st.clip = { d: big + this.rectD(l, t, r, b), rule: 'evenodd', parent: this.st.clip };
  }
  /** A region (rectangles in logical units, or device units when `device`) combined with the clip. */
  clipRegion(region: Region | null, mode: number, device = false): void {
    this.touch();
    if (!region) { if (mode === 5) this.st.clip = null; return; }
    this.combineClip(this.regionD(region, device), 'nonzero', mode);
  }
  private combineClip(d: string, rule: 'nonzero' | 'evenodd', mode: number): void {
    if (mode === 5 || !this.st.clip) { this.st.clip = mode === 4 ? { d: 'M-1e6 -1e6L1e6 -1e6L1e6 1e6L-1e6 1e6Z' + d, rule: 'evenodd', parent: this.st.clip } : { d, rule, parent: mode === 5 ? null : this.st.clip }; return; }
    if (mode === 1) this.st.clip = { d, rule, parent: this.st.clip };
    else if (mode === 4) this.st.clip = { d: 'M-1e6 -1e6L1e6 -1e6L1e6 1e6L-1e6 1e6Z' + d, rule: 'evenodd', parent: this.st.clip };
    else this.st.clip = { d: this.st.clip.d + d, rule: 'nonzero', parent: this.st.clip.parent }; // OR / XOR approximated as union
  }
  regionD(region: Region, device = false): string {
    return region.rects.map(([l, t, r, b]) => (device ? `M${r3(l)} ${r3(t)}L${r3(r)} ${r3(t)}L${r3(r)} ${r3(b)}L${r3(l)} ${r3(b)}Z` : this.rectD(l, t, r, b))).join('');
  }
  fillRegion(region: Region, brush: Brush, device = false): void {
    this.touch();
    const d = this.regionD(region, device);
    if (d) this.emit(`<path d="${d}" fill="${this.fillOf(brush)}"${this.clipAttr()}/>`);
  }
  frameRegion(region: Region, brush: Brush, w: number, h: number, device = false): void {
    this.touch();
    const d = this.regionD(region, device);
    if (d) this.emit(`<path d="${d}" fill="none" stroke="${this.fillOf(brush)}" stroke-width="${r3(Math.max(w * this.len(1, 0), h * this.len(0, 1), this.unitsPerPx))}"${this.clipAttr()}/>`);
  }

  // ---------------------------------------------------------------------------------------------
  // Blits and text

  /** PatBlt-like fill of a logical rectangle with the brush (or black/white). */
  fillRect(l: number, t: number, w: number, h: number, colour?: string): void {
    this.touch();
    const f = colour ?? this.fillOf(this.st.brush);
    if (f === 'none') return;
    this.emit(`<path d="${this.rectD(l, t, l + w, t + h)}" fill="${f}"${this.clipAttr()}/>`);
  }

  /** A rectangle shaded from one colour to another, horizontally or vertically (EMF GradientFill). */
  gradientRect(x0: number, y0: number, x1: number, y1: number, c0: string, c1: string, vertical: boolean): void {
    this.touch();
    const id = `mg${++this.patIds}`;
    const a = this.map(x0, y0), b = vertical ? this.map(x0, y1) : this.map(x1, y0);
    this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r3(a[0])}" y1="${r3(a[1])}" x2="${r3(b[0])}" y2="${r3(b[1])}"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`);
    this.emit(`<path d="${this.rectD(x0, y0, x1, y1)}" fill="url(#${id})"${this.clipAttr()}/>`);
  }

  /** A bitmap drawn into the logical rectangle, showing the source rectangle of the bitmap. */
  image(href: string, bw: number, bh: number, src: { x: number; y: number; w: number; h: number }, l: number, t: number, w: number, h: number, extra: { opacity?: number; blend?: string } = {}): void {
    this.touch();
    if (!bw || !bh || !src.w || !src.h || !w || !h) return;
    // The destination parallelogram in device space.
    const o = this.map(l, t), ex = this.map(l + w, t), ey = this.map(l, t + h);
    this.grow(o); this.grow(ex); this.grow(ey); this.grow(this.map(l + w, t + h));
    const ax = (ex[0] - o[0]) / src.w, bx = (ex[1] - o[1]) / src.w, cy = (ey[0] - o[0]) / src.h, dy = (ey[1] - o[1]) / src.h;
    const m = `matrix(${r3(ax)} ${r3(bx)} ${r3(cy)} ${r3(dy)} ${r3(o[0] - ax * src.x - cy * src.y)} ${r3(o[1] - bx * src.x - dy * src.y)})`;
    const clipId = `mi${++this.clipIds}`;
    this.defs.push(`<clipPath id="${clipId}"><rect x="${r3(src.x)}" y="${r3(src.y)}" width="${r3(src.w)}" height="${r3(src.h)}"/></clipPath>`);
    const style = extra.blend ? ` style="mix-blend-mode:${extra.blend}"` : '';
    const op = extra.opacity != null && extra.opacity < 1 ? ` opacity="${r3(extra.opacity)}"` : '';
    this.emit(`<g${this.clipAttr()}${style}${op}><image transform="${m}" width="${bw}" height="${bh}" preserveAspectRatio="none" clip-path="url(#${clipId})" href="${href}"/></g>`);
  }

  /**
   * TextOut/ExtTextOut. `dx` are the logical advances of each character when the record gives them.
   * Options: 2 opaque rectangle, 4 clip to the rectangle.
   */
  text(x: number, y: number, s: string, dx: number[] | null, opt = 0, rect?: [number, number, number, number]): void {
    this.touch();
    if (!s) return;
    const st = this.st, f = st.font;
    if (rect && opt & 2) this.emit(`<path d="${this.rectD(rect[0], rect[1], rect[2], rect[3])}" fill="${st.bkColor}"${this.clipAttr()}/>`);
    const ref: Pt = st.textAlign & 1 ? st.cur : [x, y];
    const o = this.map(ref[0], ref[1]);
    const unitY = this.len(0, 1) || 1, unitX = this.len(1, 0) || 1;
    let em = f.height < 0 ? -f.height * unitY : f.height > 0 ? f.height * unitY * 0.86 : 12 * this.unitsPerPx;
    if (em <= 0) em = 12 * this.unitsPerPx;
    // Baseline direction: the mapped x axis, turned by the escapement (tenths of a degree, counterclockwise).
    const xa = this.map(ref[0] + 1, ref[1]);
    let angle = (Math.atan2(xa[1] - o[1], xa[0] - o[0]) * 180) / Math.PI;
    if (Math.abs(angle) > 90 && this.det() < 0) angle = 0; // a mirrored axis does not mirror glyphs
    angle -= (f.escapement || 0) / 10;
    const advances = dx && dx.length >= s.length ? dx.slice(0, s.length).map((v) => v * unitX + st.charExtra * unitX) : null;
    const total = advances ? advances.reduce((a, b) => a + b, 0) : s.length * em * 0.5;
    const h = st.textAlign & 6;
    let x0 = 0;
    if (advances) x0 = h === 2 ? -total : h === 6 ? -total / 2 : 0;
    const v = st.textAlign & 24;
    const baseShift = v === 24 ? 0 : v === 8 ? -em * 0.21 : em * 0.9;
    if (st.bkMode === 2 && advances && !(opt & 2) && st.bkColor !== 'none') {
      this.emit(`<rect transform="translate(${r3(o[0])} ${r3(o[1])}) rotate(${r3(angle)})" x="${r3(x0)}" y="${r3(baseShift - em * 0.9)}" width="${r3(total)}" height="${r3(em * 1.11)}" fill="${st.bkColor}"${this.clipAttr()}/>`);
    }
    const xs = advances ? (() => { let acc = x0; return advances.map((a) => { const p = acc; acc += a; return r3(p); }).join(' '); })() : '0';
    const anchor = advances ? '' : h === 2 ? ' text-anchor="end"' : h === 6 ? ' text-anchor="middle"' : '';
    const deco = [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    let clip = this.clipAttr();
    if (rect && opt & 4) { this.intersectClip(rect[0], rect[1], rect[2], rect[3]); clip = this.clipAttr(); this.st.clip = this.st.clip!.parent; }
    const scaleX = f.width > 0 ? Math.max(0.2, Math.min(5, (f.width * unitX) / (em * 0.5))) : 1;
    const tf = `translate(${r3(o[0])} ${r3(o[1])})${angle ? ` rotate(${r3(angle)})` : ''}${scaleX !== 1 && !advances ? ` scale(${r3(scaleX)} 1)` : ''}`;
    this.emit(`<text transform="${tf}" x="${xs}" y="${r3(baseShift)}" font-family="${fontCss(f)}" font-size="${r3(em)}"${f.weight >= 600 ? ` font-weight="${f.weight >= 800 ? 900 : 700}"` : ''}${f.italic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''} fill="${this.ropColor(st.textColor)}"${anchor} xml:space="preserve"${clip}>${escText(s)}</text>`);
    if (st.textAlign & 1) {
      const adv = total / (unitX || 1);
      st.cur = [ref[0] + adv, ref[1]];
    }
    this.grow(o);
  }

  // ---------------------------------------------------------------------------------------------
  // Output

  finish(): { svg: string; w: number; h: number } | null {
    const sizePt = this.opts.sizePt;
    if (!this.elements) return null;
    let vb: { x: number; y: number; w: number; h: number };
    if (this.opts.mode === 'emf' && this.opts.frame && this.opts.frame.w > 0 && this.opts.frame.h > 0) vb = this.opts.frame;
    else if (this.opts.mode === 'wmf' && this.ref && this.ref.ext[0] && this.ref.ext[1]) vb = { x: 0, y: 0, w: Math.abs(this.ref.ext[0]), h: Math.abs(this.ref.ext[1]) };
    else {
      const b = this.bbox;
      if (!isFinite(b.x0) || b.x1 <= b.x0 || b.y1 <= b.y0) return null;
      vb = { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
    }
    const w = sizePt?.w || vb.w * 0.75, h = sizePt?.h || vb.h * 0.75;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r3(w)}" height="${r3(h)}" viewBox="${r3(vb.x)} ${r3(vb.y)} ${r3(vb.w)} ${r3(vb.h)}" preserveAspectRatio="none" overflow="hidden">`
      + (this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '')
      + `<g fill-rule="nonzero">${this.body.join('')}</g></svg>`;
    return { svg, w, h };
  }
}

function escText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
