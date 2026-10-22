/**
 * Object effects in PDF export that the PDF imaging model has no operator for: the blurred drop shadow
 * and the outer glow the screen draws with SVG filters (src/render/page.ts effectsAttr).
 *
 * The object's own outline (the PDF path the writer already built) is traced into a canvas, filled
 * (and, for a glow, widened by a stroke), blurred with the canvas Gaussian filter, and the resulting
 * coverage becomes the soft mask (/SMask) of a one-pixel image in the effect's colour. The image is
 * placed over the outline's bounds plus the blur margin, so the effect sits exactly where the screen
 * draws it, at about 150 dpi. Without a canvas (Node, tests) the shadow falls back to the hard-edged
 * offset copy and the glow is left out.
 *
 * Soft edges fade the object itself: its outline is filled, blurred by radius / 2.25 and the coverage
 * remapped to 2a − 1 (0 at the edge, about 1 a radius inside, as layout programs draw it; the screen's
 * SVG filter does the same), and the result becomes a luminosity soft mask set before the object is
 * drawn; its drop shadow is cast by that feathered coverage. Without a canvas the object is drawn unfaded.
 */
import type { Effects } from '../model/types';
import { colorHex } from '../model/styles';
import { n, rgb, shadowOps, type PaintCtx } from './pdfPaint';
import { deflate } from './pdfImages';

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A 2D canvas that supports filters, or null (no DOM, or a canvas without `filter`). */
function canvas2d(w: number, h: number): Canvas2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(w, h).getContext('2d');
      if (c && 'filter' in c) return c;
    }
    if (typeof document !== 'undefined' && typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
      const el = document.createElement('canvas');
      el.width = w; el.height = h;
      const c = el.getContext('2d');
      if (c && 'filter' in c && typeof c.getImageData === 'function') return c;
    }
  } catch { /* no canvas */ }
  return null;
}

type Seg = { op: 'm' | 'l'; p: number[] } | { op: 'c'; p: number[] } | { op: 'h' } | { op: 're'; p: number[] };

/** The subpaths of a PDF path as written by pathOps (m, l, c, v, y, h, re), with their bounds (control points included). */
export function parsePdfPath(ops: string): { segs: Seg[]; box: [number, number, number, number] } | null {
  const segs: Seg[] = [];
  const stack: number[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  let cur: [number, number] = [0, 0];
  for (const tok of ops.split(/\s+/)) {
    if (!tok) continue;
    const v = Number(tok);
    if (!Number.isNaN(v) && /^[-+.\d]/.test(tok)) { stack.push(v); continue; }
    const a = stack.splice(0);
    switch (tok) {
      case 'm': case 'l': if (a.length >= 2) { segs.push({ op: tok, p: a.slice(-2) }); cur = [a[a.length - 2], a[a.length - 1]]; grow(cur[0], cur[1]); } break;
      case 'c': if (a.length >= 6) { const p = a.slice(-6); segs.push({ op: 'c', p }); for (let i = 0; i < 6; i += 2) grow(p[i], p[i + 1]); cur = [p[4], p[5]]; } break;
      case 'v': if (a.length >= 4) { const p = [cur[0], cur[1], ...a.slice(-4)]; segs.push({ op: 'c', p }); for (let i = 0; i < 6; i += 2) grow(p[i], p[i + 1]); cur = [p[4], p[5]]; } break;
      case 'y': if (a.length >= 4) { const q = a.slice(-4); const p = [q[0], q[1], q[2], q[3], q[2], q[3]]; segs.push({ op: 'c', p }); for (let i = 0; i < 6; i += 2) grow(p[i], p[i + 1]); cur = [p[4], p[5]]; } break;
      case 'h': segs.push({ op: 'h' }); break;
      case 're': if (a.length >= 4) { const p = a.slice(-4); segs.push({ op: 're', p }); grow(p[0], p[1]); grow(p[0] + p[2], p[1] + p[3]); } break;
      default: break; // painting operators and anything else: ignored
    }
  }
  if (!segs.length || !(x1 >= x0) || !(y1 >= y0)) return null;
  return { segs, box: [x0, y0, x1, y1] };
}

function trace(c: Canvas2D, segs: Seg[], k: number, ox: number, oy: number): void {
  c.beginPath();
  const X = (v: number) => (v - ox) * k, Y = (v: number) => (v - oy) * k;
  for (const s of segs) {
    if (s.op === 'm') c.moveTo(X(s.p[0]), Y(s.p[1]));
    else if (s.op === 'l') c.lineTo(X(s.p[0]), Y(s.p[1]));
    else if (s.op === 'c') c.bezierCurveTo(X(s.p[0]), Y(s.p[1]), X(s.p[2]), Y(s.p[3]), X(s.p[4]), Y(s.p[5]));
    else if (s.op === 'h') c.closePath();
    else c.rect(X(s.p[0]), Y(s.p[1]), s.p[2] * k, s.p[3] * k);
  }
}

/** The blurred coverage of a path: an 8-bit mask (rows top to bottom) and where it sits, in the path's coordinates. */
function blurMask(ops: string, evenOdd: boolean, blur: number, spread: number, opacity: number, feather = 0): { x: number; y: number; w: number; h: number; pw: number; ph: number; mask: Uint8Array } | null {
  const p = parsePdfPath(ops);
  if (!p) return null;
  const sigma = Math.max(0, blur / 2);
  const margin = sigma * 3 + spread + 1;
  const x = p.box[0] - margin, y = p.box[1] - margin;
  const w = p.box[2] - p.box[0] + margin * 2, h = p.box[3] - p.box[1] + margin * 2;
  if (!(w > 0 && h > 0) || w * h > 4e7) return null;
  // About 150 dpi, fewer pixels for very large objects.
  const k = Math.max(0.25, Math.min(2, Math.sqrt(3e6 / (w * h))));
  const pw = Math.max(1, Math.ceil(w * k)), ph = Math.max(1, Math.ceil(h * k));
  const c = canvas2d(pw, ph);
  if (!c) return null;
  if (feather > 0) {
    // The shadow of a soft-edged object is cast by its feathered coverage, blurred again.
    const f = canvas2d(pw, ph);
    if (!f) return null;
    const a = featherInto(f, p.segs, evenOdd, feather, k, x, y, pw, ph);
    const img = f.createImageData(pw, ph);
    for (let i = 0; i < a.length; i++) img.data[i * 4 + 3] = a[i];
    f.filter = 'none';
    f.clearRect(0, 0, pw, ph);
    f.putImageData(img, 0, 0);
    c.filter = sigma > 0 ? `blur(${sigma * k}px)` : 'none';
    c.drawImage((f as any).canvas, 0, 0);
    const d2 = c.getImageData(0, 0, pw, ph).data;
    const m2 = new Uint8Array(pw * ph);
    for (let i = 0; i < m2.length; i++) m2[i] = Math.round(d2[i * 4 + 3] * opacity);
    return { x, y, w, h, pw, ph, mask: m2 };
  }
  c.filter = sigma > 0 ? `blur(${sigma * k}px)` : 'none';
  c.fillStyle = '#000';
  c.strokeStyle = '#000';
  trace(c, p.segs, k, x, y);
  c.fill(evenOdd ? 'evenodd' : 'nonzero');
  if (spread > 0) { c.lineWidth = spread * 2 * k; c.lineJoin = 'round'; c.stroke(); }
  const data = c.getImageData(0, 0, pw, ph).data;
  const mask = new Uint8Array(pw * ph);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.round(data[i * 4 + 3] * opacity);
  return { x, y, w, h, pw, ph, mask };
}

/** The blur that, followed by the alpha remap 2a − 1, feathers an edge from 0 at the outline to about 0.98 a radius inside. */
export const featherSigma = (radius: number) => radius / 2.25;

/**
 * Draws the feathered coverage of a path into `c` (cleared, pw × ph, path coordinates offset by x, y and
 * scaled by k): the filled path blurred by featherSigma(radius), with its alpha remapped to 2a − 1, as the
 * screen's filter does (src/render/page.ts effectsAttr). Returns the alpha values.
 */
function featherInto(c: Canvas2D, segs: Seg[], evenOdd: boolean, radius: number, k: number, x: number, y: number, pw: number, ph: number): Uint8Array {
  c.filter = `blur(${featherSigma(radius) * k}px)`;
  c.fillStyle = '#000';
  trace(c, segs, k, x, y);
  c.fill(evenOdd ? 'evenodd' : 'nonzero');
  const data = c.getImageData(0, 0, pw, ph).data;
  const a = new Uint8Array(pw * ph);
  for (let i = 0; i < a.length; i++) a[i] = Math.max(0, data[i * 4 + 3] * 2 - 255);
  return a;
}

/** Feathered coverage of a path for a soft edge of `radius`: 0 at the outline, about 1 a radius inside. */
function featherMask(ops: string, evenOdd: boolean, radius: number): { x: number; y: number; w: number; h: number; pw: number; ph: number; mask: Uint8Array } | null {
  const p = parsePdfPath(ops);
  if (!p || !(radius > 0)) return null;
  const x = p.box[0] - 1, y = p.box[1] - 1;
  const w = p.box[2] - p.box[0] + 2, h = p.box[3] - p.box[1] + 2;
  if (!(w > 0 && h > 0) || w * h > 4e7) return null;
  // About 200 dpi, fewer pixels for very large objects (the mask is smooth, so this costs nothing visible).
  const k = Math.max(0.25, Math.min(2.8, Math.sqrt(4e6 / (w * h))));
  const pw = Math.max(1, Math.ceil(w * k)), ph = Math.max(1, Math.ceil(h * k));
  const c = canvas2d(pw, ph);
  if (!c) return null;
  return { x, y, w, h, pw, ph, mask: featherInto(c, p.segs, evenOdd, radius, k, x, y, pw, ph) };
}

/**
 * An ExtGState that fades what is drawn after it by the soft edge of `path` (in the coordinates in
 * effect when it is set): a luminosity soft mask whose group draws the feathered coverage as a grey
 * image over a black backdrop. Returns the resource name to use with `gs`, or null without a canvas.
 */
export async function softEdgeGs(ctx: PaintCtx & { extGs: string[] }, path: string, radius: number, evenOdd = false): Promise<string | null> {
  const m = featherMask(path, evenOdd, radius);
  if (!m) return null;
  const z = await deflate(m.mask);
  const img = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${m.pw} /Height ${m.ph} /ColorSpace /DeviceGray /BitsPerComponent 8${z.filter}`, z.data);
  const body = `q ${n(m.w)} 0 0 ${n(-m.h)} ${n(m.x)} ${n(m.y + m.h)} cm /M Do Q`;
  const form = ctx.w.stream(`/Type /XObject /Subtype /Form /BBox [${n(m.x)} ${n(m.y)} ${n(m.x + m.w)} ${n(m.y + m.h)}] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /XObject << /M ${img} 0 R >> >>`, body);
  const name = `/GSse${ctx.extGs.length + 1}`;
  const gs = ctx.w.add(`<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${form} 0 R /BC [0] >> >>`);
  ctx.extGs.push(`${name} ${gs} 0 R`);
  return name;
}

/** The operators placing a mask in a colour: a 1×1 image of the colour with the mask as its soft mask. */
async function maskOps(ctx: PaintCtx, m: { x: number; y: number; w: number; h: number; pw: number; ph: number; mask: Uint8Array }, color: [number, number, number], dx: number, dy: number): Promise<string> {
  const z = await deflate(m.mask);
  const sm = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${m.pw} /Height ${m.ph} /ColorSpace /DeviceGray /BitsPerComponent 8${z.filter}`, z.data);
  const px = new Uint8Array(color.map((v) => Math.round(v * 255)));
  const obj = ctx.w.stream(`/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${sm} 0 R`, px);
  const res = `/Im${ctx.images.size + 1}`;
  ctx.images.set(`effect:${ctx.images.size}`, { obj, w: 1, h: 1, res });
  ctx.imgRes.push(`${res} ${obj} 0 R`);
  return `q ${n(m.w)} 0 0 ${n(-m.h)} ${n(m.x + dx)} ${n(m.y + dy + m.h)} cm ${res} Do Q`;
}

/**
 * The effects drawn under an object whose outline is `path` (PDF path operators in the current
 * coordinates): the drop shadow (blurred as on screen, or the hard-edged copy without a canvas) and the
 * outer glow (canvas only). Soft edges are set separately (softEdgeGs) around the object itself.
 */
export async function effectsOps(ctx: PaintCtx, effects: Effects | undefined, path: string, evenOdd = false): Promise<string> {
  if (!effects) return '';
  const out: string[] = [];
  const sh = effects.shadow;
  if (sh && (sh.dist || sh.blur)) {
    const hex = colorHex(ctx.pub.data, sh.color);
    let done = false;
    if (sh.blur > 0 && hex && hex !== 'none') {
      const m = blurMask(path, evenOdd, sh.blur, 0, Math.max(0, Math.min(1, sh.alpha ?? 0.5)), effects.softEdge || 0);
      if (m) {
        const a = (sh.dir * Math.PI) / 180;
        out.push(await maskOps(ctx, m, rgb(hex), Math.cos(a) * sh.dist, Math.sin(a) * sh.dist));
        done = true;
      }
    }
    if (!done) { const hard = shadowOps(ctx, effects, path, evenOdd); if (hard) out.push(hard); }
  }
  const gl = effects.glow;
  if (gl && gl.rad > 0) {
    const hex = colorHex(ctx.pub.data, gl.color);
    if (hex && hex !== 'none') {
      // The screen dilates the outline by half the radius, blurs by half the radius and floods at 70%.
      const m = blurMask(path, evenOdd, gl.rad, gl.rad / 2, 0.7);
      if (m) out.push(await maskOps(ctx, m, rgb(hex), 0, 0));
    }
  }
  return out.join('\n');
}
