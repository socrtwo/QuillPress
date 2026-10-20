/**
 * PDF export with QuillPress's own writer (no dependency). Pages are written as vector content:
 * shapes and frames as paths, text as positioned runs, pictures as embedded JPEG (DCTDecode) or
 * decoded RGB (FlateDecode), with trim and bleed boxes, page labels and document information.
 *
 * Fonts: text set in a bundled family (Tinos, Arimo, Cousine, Carlito, Caladea, Gelasio, EB Garamond,
 * Courier Prime, Libre Baskerville, Lato, Merriweather, Open Sans) or in one of their aliases (Times
 * New Roman, Arial, Courier New, Calibri, Cambria, Georgia, Garamond, Baskerville…) is embedded as a
 * TrueType subset (export/fonts/), so the PDF shows the same faces as the screen and its text stays
 * searchable. Only fonts QuillPress does not bundle print in the closest standard-14 face
 * (Helvetica, Times, Courier), keeping their positions and sizes.
 */
import type { Pub } from '../model/pub';
import type { Item, Page, Fill, Line, TextFrame, Master, Paragraph, PathTextItem } from '../model/types';
import { colorHex } from '../model/styles';
import { geometryPath } from '../model/geometry';
import { frameBoxes, frameLines, layoutOptions, syncAnchors } from '../render/flow';
import { pathTextLayout, pathPolyline, localToPage } from '../render/pathText';
import { layoutStory, type LaidLine, type FlowBox } from '../render/text';
import { unb64 } from '../io/xml';
import { decodePng } from '../io/png';
import { PdfFonts, type EmbeddedFace, type FontLoader } from './fonts/embed';

export interface PdfOptions {
  /** Include the bleed area (page box grows by the bleed; TrimBox marks the page). */
  bleed?: boolean;
  /** Crop marks outside the trim box (needs bleed or a margin). */
  marks?: boolean;
  /** Page ids to include (default: all). */
  pages?: string[];
  /** JPEG quality for re-encoded pictures (0..1). */
  quality?: number;
  /** Rasterize pictures at most this wide (pixels). */
  maxImagePx?: number;
  /** Print spreads (facing pages side by side). */
  spreads?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** Embed the bundled fonts as subsets (default true); false sets every run in the standard 14 fonts. */
  embedFonts?: boolean;
  /** Reads a bundled WOFF file by URL (tests pass a file reader; the app fetches). */
  fontLoader?: FontLoader;
  /** Called for each font that could not be embedded. */
  onWarning?: (message: string) => void;
}

let lastWarnings: string[] = [];
/** Warnings of the most recent pubToPdf call (fonts that fell back to a standard face). */
export function lastPdfWarnings(): string[] { return [...lastWarnings]; }

// Helvetica, Times and Courier glyph widths (1/1000 em) for ASCII 32–126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];

const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };

/** A PDF literal string in WinAnsi: characters outside the encoding become "?". */
export function pdfText(s: string): string {
  let out = '(';
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c > 255 || (c >= 0x80 && c < 0xa0)) c = CP1252[c] ?? 63;
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += '\\' + String.fromCharCode(c);
    else if (c < 32) out += ' ';
    else out += String.fromCharCode(c);
  }
  return out + ')';
}

/** Width of text in a standard font at `size` points. */
export function textWidth(s: string, size: number, font = 'Helvetica'): number {
  const table = /Times/.test(font) ? TIMES : /Courier/.test(font) ? null : HELV;
  let w = 0;
  for (const ch of s) { const c = ch.charCodeAt(0); w += table ? (c >= 32 && c <= 126 ? table[c - 32] : 556) : 600; }
  return (w / 1000) * size * (/Bold/.test(font) && table === HELV ? 1.05 : 1);
}

/** Standard-14 font name for a font family and style. */
export function stdFont(family: string | undefined, b?: boolean, i?: boolean): string {
  const f = family || '';
  const mono = /courier|cousine|mono|consolas/i.test(f);
  const serif = /times|tinos|cambria|caladea|georgia|gelasio|garamond|baskerville|merriweather|bookman|palatino|constantia|serif/i.test(f) && !/sans/i.test(f);
  if (mono) return b && i ? 'Courier-BoldOblique' : b ? 'Courier-Bold' : i ? 'Courier-Oblique' : 'Courier';
  if (serif) return b && i ? 'Times-BoldItalic' : b ? 'Times-Bold' : i ? 'Times-Italic' : 'Times-Roman';
  return b && i ? 'Helvetica-BoldOblique' : b ? 'Helvetica-Bold' : i ? 'Helvetica-Oblique' : 'Helvetica';
}

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

class Writer {
  private objs: (string | Uint8Array)[] = [];
  add(body: string | Uint8Array): number { this.objs.push(body); return this.objs.length; }
  set(num: number, body: string | Uint8Array): void { this.objs[num - 1] = body; }
  reserve(): number { return this.add(''); }
  stream(dict: string, data: Uint8Array | string): number {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const head = new TextEncoder().encode(`<< ${dict} /Length ${bytes.length} >>\nstream\n`);
    const tail = new TextEncoder().encode('\nendstream');
    const out = new Uint8Array(head.length + bytes.length + tail.length);
    out.set(head); out.set(bytes, head.length); out.set(tail, head.length + bytes.length);
    return this.add(out);
  }
  build(root: number, info: number): Uint8Array {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [enc.encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
    let pos = parts[0].length;
    const offsets: number[] = [];
    this.objs.forEach((o, i) => {
      offsets.push(pos);
      const head = enc.encode(`${i + 1} 0 obj\n`);
      const body = typeof o === 'string' ? enc.encode(o) : o;
      const tail = enc.encode('\nendobj\n');
      parts.push(head, body, tail);
      pos += head.length + body.length + tail.length;
    });
    const xref = pos;
    let x = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) x += `${String(o).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${this.objs.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    parts.push(enc.encode(x));
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let k = 0;
    for (const p of parts) { out.set(p, k); k += p.length; }
    return out;
  }
}

interface Ctx { pub: Pub; w: Writer; fontSet: PdfFonts; fonts: Map<string, number>; images: Map<string, { obj: number; w: number; h: number }>; fontRes: string[]; imgRes: string[]; H: number; bleed: number; opts: PdfOptions; pageIndex: number }

/** SVG path → PDF path operators (y flipped by the caller's cm). */
function pathOps(d: string): string {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const out: string[] = [];
  const next = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    const t = tok[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; if (cmd === 'Z' || cmd === 'z') { out.push('h'); cx = sx; cy = sy; } continue; }
    switch (cmd) {
      case 'M': cx = next(); cy = next(); sx = cx; sy = cy; out.push(`${n(cx)} ${n(cy)} m`); cmd = 'L'; break;
      case 'm': cx += next(); cy += next(); sx = cx; sy = cy; out.push(`${n(cx)} ${n(cy)} m`); cmd = 'l'; break;
      case 'L': cx = next(); cy = next(); out.push(`${n(cx)} ${n(cy)} l`); break;
      case 'l': cx += next(); cy += next(); out.push(`${n(cx)} ${n(cy)} l`); break;
      case 'H': cx = next(); out.push(`${n(cx)} ${n(cy)} l`); break;
      case 'h': cx += next(); out.push(`${n(cx)} ${n(cy)} l`); break;
      case 'V': cy = next(); out.push(`${n(cx)} ${n(cy)} l`); break;
      case 'v': cy += next(); out.push(`${n(cx)} ${n(cy)} l`); break;
      case 'C': { const x1 = next(), y1 = next(), x2 = next(), y2 = next(); cx = next(); cy = next(); out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(cx)} ${n(cy)} c`); break; }
      case 'c': { const x1 = cx + next(), y1 = cy + next(), x2 = cx + next(), y2 = cy + next(); cx += next(); cy += next(); out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(cx)} ${n(cy)} c`); break; }
      case 'Q': case 'q': { const rel = cmd === 'q'; const qx = (rel ? cx : 0) + next(), qy = (rel ? cy : 0) + next(); const ex = (rel ? cx : 0) + next(), ey = (rel ? cy : 0) + next(); const x1 = cx + (2 / 3) * (qx - cx), y1 = cy + (2 / 3) * (qy - cy), x2 = ex + (2 / 3) * (qx - ex), y2 = ey + (2 / 3) * (qy - ey); cx = ex; cy = ey; out.push(`${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(cx)} ${n(cy)} c`); break; }
      case 'A': case 'a': {
        const rel = cmd === 'a';
        const rx = next(), ry = next(), rot = next(), large = next(), sweep = next();
        const ex = (rel ? cx : 0) + next(), ey = (rel ? cy : 0) + next();
        out.push(...arcToBeziers(cx, cy, rx, ry, rot, !!large, !!sweep, ex, ey));
        cx = ex; cy = ey; break;
      }
      default: i++;
    }
  }
  return out.join('\n');
}

function arcToBeziers(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): string[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [`${n(x2)} ${n(y2)} l`];
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
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out: string[] = [];
  const delta = dt / segs;
  let t = t1;
  for (let s = 0; s < segs; s++) {
    const t2 = t + delta;
    const k = (4 / 3) * Math.tan((t2 - t) / 4);
    const p = (a: number) => [cx + Rx * Math.cos(a) * cos - Ry * Math.sin(a) * sin, cy + Rx * Math.cos(a) * sin + Ry * Math.sin(a) * cos];
    const dp = (a: number) => [-Rx * Math.sin(a) * cos - Ry * Math.cos(a) * sin, -Rx * Math.sin(a) * sin + Ry * Math.cos(a) * cos];
    const [p1x, p1y] = p(t), [p2x, p2y] = p(t2), [d1x, d1y] = dp(t), [d2x, d2y] = dp(t2);
    out.push(`${n(p1x + k * d1x)} ${n(p1y + k * d1y)} ${n(p2x - k * d2x)} ${n(p2y - k * d2y)} ${n(p2x)} ${n(p2y)} c`);
    t = t2;
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function fillOp(ctx: Ctx, fill: Fill | undefined): string | null {
  if (!fill || fill.type === 'none') return null;
  const d = ctx.pub.data;
  const hex = fill.type === 'solid' ? colorHex(d, fill.color) : fill.type === 'gradient' ? colorHex(d, fill.stops[0]?.color) : fill.type === 'pattern' ? colorHex(d, fill.bg) : null;
  if (!hex || hex === 'none') return null;
  const [r, g, b] = rgb(hex);
  const alpha = fill.type === 'solid' ? fill.alpha : undefined;
  return `${n(r)} ${n(g)} ${n(b)} rg${alpha != null && alpha < 1 ? ` /GSa${Math.round(alpha * 100)} gs` : ''}`;
}

function strokeOp(ctx: Ctx, line: Line | undefined): string | null {
  if (!line || !line.fill || line.fill.type === 'none') return null;
  const hex = line.fill.type === 'solid' ? colorHex(ctx.pub.data, line.fill.color) : '#000000';
  if (hex === 'none') return null;
  const [r, g, b] = rgb(hex);
  const w = line.width ?? 0.75;
  let s = `${n(r)} ${n(g)} ${n(b)} RG ${n(w)} w`;
  if (line.dash && line.dash !== 'solid') { const k = Math.max(w, 1); const pat = ({ dash: [4 * k, 3 * k], dot: [k, 2 * k], dashDot: [4 * k, 2 * k, k, 2 * k], longDash: [8 * k, 3 * k], longDashDot: [8 * k, 3 * k, k, 3 * k], sysDash: [3 * k, k], sysDot: [k, k] } as Record<string, number[]>)[line.dash]; if (pat) s += ` [${pat.map(n).join(' ')}] 0 d`; }
  if (line.cap) s += ` ${line.cap === 'round' ? 1 : line.cap === 'square' ? 2 : 0} J`;
  if (line.join) s += ` ${line.join === 'round' ? 1 : line.join === 'bevel' ? 2 : 0} j`;
  return s;
}

function fontKey(ctx: Ctx, name: string): string {
  if (!ctx.fonts.has(name)) {
    const obj = ctx.w.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
    ctx.fonts.set(name, obj);
    ctx.fontRes.push(`/F${ctx.fonts.size} ${obj} 0 R`);
  }
  return `/F${[...ctx.fonts.keys()].indexOf(name) + 1}`;
}

/** Resource name of an embedded face, reserving its font object on first use. */
function embeddedKey(ctx: Ctx, face: EmbeddedFace): string {
  if (!face.res) {
    face.obj = ctx.w.reserve();
    ctx.fonts.set('embedded:' + face.key, face.obj);
    face.res = `/F${ctx.fonts.size}`;
    ctx.fontRes.push(`${face.res} ${face.obj} 0 R`);
  }
  return face.res;
}

/** Small capitals: lowercase letters become capitals at 80% of the size. */
function smallCapsChunks(text: string, size: number): { text: string; size: number }[] {
  const out: { text: string; size: number }[] = [];
  for (const ch of text) {
    const lower = ch !== ch.toUpperCase() && ch === ch.toLowerCase();
    const sz = lower ? size * 0.8 : size;
    const t = lower ? ch.toUpperCase() : ch;
    const last = out[out.length - 1];
    if (last && last.size === sz) last.text += t; else out.push({ text: t, size: sz });
  }
  return out;
}

/**
 * One run of text at a page position: in the embedded face when the family is bundled (glyph ids,
 * Identity-H), otherwise in the standard font that stdFont() picks. Characters the embedded face lacks
 * are set in the standard font so nothing is dropped.
 */
async function textOps(ctx: Ctx, text: string, family: string | undefined, bold: boolean | undefined, italic: boolean | undefined, size: number, x: number, y: number, color: [number, number, number], spc: number, caps: 'all' | 'small' | 'none' | undefined, angle = 0): Promise<string> {
  const [r, g, b] = color;
  // Text matrix for y-down page coordinates: the baseline runs along `angle` (degrees, clockwise).
  const ca = Math.cos((angle * Math.PI) / 180), sa = Math.sin((angle * Math.PI) / 180);
  const tm = (adv: number, skew = false) => `${n(ca)} ${n(sa)} ${n(sa + (skew ? 0.2 * ca : 0))} ${n(-ca + (skew ? 0.2 * sa : 0))} ${n(x + adv * ca)} ${n(y + adv * sa)} Tm`;
  const fill = `${n(r)} ${n(g)} ${n(b)} rg`;
  const std = stdFont(family, bold, italic);
  const face = ctx.opts.embedFonts === false ? null : await ctx.fontSet.face(family, bold, italic);
  const chunks = caps === 'small' ? smallCapsChunks(text, size) : [{ text: caps === 'all' ? text.toUpperCase() : text, size }];
  const ops: string[] = [];
  let cx = 0;
  const stdOp = (t: string, sz: number) => {
    const f = fontKey(ctx, std);
    ops.push(`BT ${fill} ${f} ${n(sz)} Tf${spc ? ` ${n(spc)} Tc` : ''} ${tm(cx)} ${pdfText(t)} Tj ET`);
    cx += textWidth(t, sz, std) + spc * [...t].length;
  };
  for (const ch of chunks) {
    if (!face) { stdOp(ch.text, ch.size); continue; }
    const res = embeddedKey(ctx, face);
    for (const piece of ctx.fontSet.encode(face, ch.text, ch.size, spc)) {
      if ('hex' in piece) {
        const synth = face.synthBold ? ` 2 Tr ${n(piece.size / 30)} w ${n(r)} ${n(g)} ${n(b)} RG` : '';
        ops.push(`BT ${fill} ${res} ${n(piece.size)} Tf${spc ? ` ${n(spc)} Tc` : ''}${synth} ${tm(cx, !!face.synthItalic)} <${piece.hex}> Tj ET${synth ? ' 0 Tr' : ''}`);
        cx += piece.width;
      } else {
        stdOp(piece.fallback, piece.size);
      }
    }
  }
  return ops.join('\n');
}

/** Text of laid-out lines as PDF operators (page coordinates, y up handled by the caller's cm). */
async function linesOps(ctx: Ctx, lines: LaidLine[]): Promise<string> {
  const d = ctx.pub.data;
  const out: string[] = [];
  for (const l of lines) {
    if (l.bullet) out.push(await textOps(ctx, l.bullet.text, l.bullet.font, false, false, l.bullet.size, l.bullet.x, l.y, rgb(colorHex(d, l.bullet.color)), 0, undefined));
    for (const s of l.segs) {
      if (!s.text) continue;
      const st = s.style;
      const color = rgb(colorHex(d, st.color));
      let y = l.y;
      if (s.drop) y = l.y + (s.drop - 1) * l.height;
      if (st.baseline) y -= (st.baseline / 100) * s.size * 0.6;
      out.push(await textOps(ctx, s.text, s.font, st.b, st.i, s.size, l.x + s.x, y, color, st.spc || 0, st.caps));
      if (st.u || st.strike) {
        const [r, g, b] = color;
        const yy = st.u ? y + s.size * 0.12 : y - s.size * 0.3;
        out.push(`${n(r)} ${n(g)} ${n(b)} RG ${n(Math.max(0.5, s.size / 16))} w ${n(l.x + s.x)} ${n(yy)} m ${n(l.x + s.x + s.w)} ${n(yy)} l S`);
      }
    }
  }
  return out.join('\n');
}

async function imageObj(ctx: Ctx, mediaId: string): Promise<{ obj: number; w: number; h: number } | null> {
  const hit = ctx.images.get(mediaId);
  if (hit) return hit;
  const m = ctx.pub.media[mediaId];
  if (!m) return null;
  const bytes = unb64(m.b64);
  let entry: { obj: number; w: number; h: number } | null = null;
  if (m.mime === 'image/jpeg' && m.w && m.h) {
    const cs = jpegComponents(bytes);
    const obj = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${m.w} /Height ${m.h} /ColorSpace ${cs === 1 ? '/DeviceGray' : cs === 4 ? '/DeviceCMYK' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode${cs === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''}`, bytes);
    entry = { obj, w: m.w, h: m.h };
  } else {
    const raster = await rasterize(m.mime, bytes, ctx.opts.maxImagePx || 2400, ctx.opts.quality ?? 0.9);
    if (raster) {
      if (raster.jpeg) {
        const obj = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${raster.w} /Height ${raster.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, raster.jpeg);
        entry = { obj, w: raster.w, h: raster.h };
      } else if (raster.rgb) {
        let smask = '';
        if (raster.alpha) { const a = await deflate(raster.alpha); const so = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${raster.w} /Height ${raster.h} /ColorSpace /DeviceGray /BitsPerComponent 8${a.filter}`, a.data); smask = ` /SMask ${so} 0 R`; }
        const z = await deflate(raster.rgb);
        const obj = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${raster.w} /Height ${raster.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${z.filter}${smask}`, z.data);
        entry = { obj, w: raster.w, h: raster.h };
      }
    }
  }
  if (entry) { ctx.images.set(mediaId, entry); ctx.imgRes.push(`/Im${ctx.images.size} ${entry.obj} 0 R`); }
  return entry;
}

function jpegComponents(d: Uint8Array): number {
  let i = 2;
  while (i < d.length) {
    if (d[i] !== 0xff) { i++; continue; }
    const marker = d[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return d[i + 9];
    const len = (d[i + 2] << 8) | d[i + 3];
    i += 2 + len;
  }
  return 3;
}

async function deflate(data: Uint8Array): Promise<{ data: Uint8Array; filter: string }> {
  try {
    if (typeof CompressionStream === 'undefined') return { data, filter: '' };
    const cs = new CompressionStream('deflate');
    const w = cs.writable.getWriter();
    void w.write(data as BufferSource); void w.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return { data: new Uint8Array(buf), filter: ' /Filter /FlateDecode' };
  } catch { return { data, filter: '' }; }
}

/** Decodes a picture with the browser; JPEG output when it has no transparency. */
/** Decodes a PNG in plain JavaScript (where no canvas exists, or when the browser cannot decode it). */
function pngFallback(mime: string, bytes: Uint8Array, maxPx: number): { w: number; h: number; rgb: Uint8Array; alpha?: Uint8Array } | null {
  if (mime !== 'image/png') return null;
  const png = decodePng(bytes);
  if (!png) return null;
  const k = Math.min(1, maxPx / Math.max(1, png.w, png.h));
  if (k >= 1) return png;
  // Nearest-neighbor downsample (only for very large pictures without a canvas).
  const w = Math.max(1, Math.round(png.w * k)), h = Math.max(1, Math.round(png.h * k));
  const rgb = new Uint8Array(w * h * 3), alpha = png.alpha ? new Uint8Array(w * h) : undefined;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(png.w - 1, Math.floor(x / k)), sy = Math.min(png.h - 1, Math.floor(y / k)); const si = sy * png.w + sx, di = y * w + x; rgb[di * 3] = png.rgb[si * 3]; rgb[di * 3 + 1] = png.rgb[si * 3 + 1]; rgb[di * 3 + 2] = png.rgb[si * 3 + 2]; if (alpha) alpha[di] = png.alpha![si]; }
  return { w, h, rgb, alpha };
}

async function rasterize(mime: string, bytes: Uint8Array, maxPx: number, quality: number): Promise<{ w: number; h: number; jpeg?: Uint8Array; rgb?: Uint8Array; alpha?: Uint8Array } | null> {
  const canvasOk = typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof URL !== 'undefined' && !!URL.createObjectURL && !!document.createElement('canvas').getContext?.('2d');
  if (!canvasOk) return pngFallback(mime, bytes, maxPx);
  try {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); const t = setTimeout(() => rej(new Error('timeout')), 15000); im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); rej(new Error('decode')); }; im.src = url; });
    URL.revokeObjectURL(url);
    const k = Math.min(1, maxPx / Math.max(1, img.naturalWidth || img.width));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width || 300) * k)), h = Math.max(1, Math.round((img.naturalHeight || img.height || 150) * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { hasAlpha = true; break; }
    if (!hasAlpha) {
      const dataUrl = c.toDataURL('image/jpeg', quality);
      return { w, h, jpeg: unb64(dataUrl.split(',')[1]) };
    }
    const rgbA = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
    for (let i = 0, j = 0, k2 = 0; i < data.length; i += 4, j += 3, k2++) { rgbA[j] = data[i]; rgbA[j + 1] = data[i + 1]; rgbA[j + 2] = data[i + 2]; alpha[k2] = data[i + 3]; }
    return { w, h, rgb: rgbA, alpha };
  } catch { return pngFallback(mime, bytes, maxPx); }
}

/** Text on a path: one positioned, rotated glyph per character (page coordinates from pathTextLayout). */
async function pathTextOps(ctx: Ctx, e: PathTextItem, out: string[]): Promise<void> {
  const pub = ctx.pub;
  const r = pathTextLayout(e, layoutOptions(pub, []));
  out.push('q');
  if (e.alpha != null && e.alpha < 1) out.push(`/GSa${Math.round(e.alpha * 100)} gs`);
  if (e.showPath) {
    const so = strokeOp(ctx, e.line ?? { fill: { type: 'solid', color: 'Black' }, width: 0.5 });
    const pts = pathPolyline(e).map((p) => localToPage(e, p));
    if (so && pts.length > 1) out.push(`q ${so} ${pts.map((p, i) => `${n(p.x)} ${n(p.y)} ${i ? 'l' : 'm'}`).join(' ')} S Q`);
  }
  for (const g of r.glyphs) {
    if (!g.ch.trim()) continue;
    const st = g.style;
    const a = (g.angle * Math.PI) / 180;
    // The glyph's origin sits half an advance before its center, along the baseline.
    const ox = g.x - (g.w / 2) * Math.cos(a), oy = g.y - (g.w / 2) * Math.sin(a);
    out.push(await textOps(ctx, g.ch, g.font, st.b, st.i, g.size, ox, oy, rgb(colorHex(pub.data, st.color)), 0, st.caps, g.angle));
  }
  out.push('Q');
}

async function itemOps(ctx: Ctx, e: Item, owner: Page | Master, fromMaster: boolean, out: string[]): Promise<void> {
  if (e.hidden) return;
  const layer = ctx.pub.layer(e.layer);
  if (layer?.hidden) return;
  const pub = ctx.pub;
  if (e.kind === 'pathText') { await pathTextOps(ctx, e, out); return; }
  out.push('q');
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  if (e.rot) { const a = (e.rot * Math.PI) / 180; out.push(`1 0 0 1 ${n(cx)} ${n(cy)} cm ${n(Math.cos(a))} ${n(Math.sin(a))} ${n(-Math.sin(a))} ${n(Math.cos(a))} 0 0 cm 1 0 0 1 ${n(-cx)} ${n(-cy)} cm`); }
  if (e.flipH || e.flipV) out.push(`1 0 0 1 ${n(cx)} ${n(cy)} cm ${e.flipH ? -1 : 1} 0 0 ${e.flipV ? -1 : 1} 0 0 cm 1 0 0 1 ${n(-cx)} ${n(-cy)} cm`);
  if (e.alpha != null && e.alpha < 1) out.push(`/GSa${Math.round(e.alpha * 100)} gs`);
  const os = pub.objectStyle(e.ostyle);
  const fill = e.fill ?? os?.fill;
  const line = e.line ?? os?.line;
  const local = (d: string) => `1 0 0 1 ${n(e.x)} ${n(e.y)} cm\n${pathOps(d)}`;
  switch (e.kind) {
    case 'group': out.push('Q'); for (const c of e.children) await itemOps(ctx, c, owner, fromMaster, out); return;
    case 'line': { const so = strokeOp(ctx, line ?? { fill: { type: 'solid', color: 'Black' }, width: 1 }); if (so) out.push(`${so} ${n(e.x)} ${n(e.y)} m ${n(e.x + e.w)} ${n(e.y + e.h)} l S`); break; }
    case 'shape': {
      const { d, open } = geometryPath(e.geom, e.w, e.h, e.adj, e.path);
      const def = /^(line|straightConnector1|arc|bracketPair|bracePair)/.test(e.geom) ? { fill: { type: 'none' } as Fill, line: { fill: { type: 'solid', color: 'Black' } as Fill, width: 1 } } : { fill: { type: 'solid', color: 'Primary' } as Fill, line: { fill: { type: 'none' } as Fill } };
      const fo = open ? null : fillOp(ctx, fill ?? def.fill), so = strokeOp(ctx, line ?? def.line);
      if (fo || so) out.push(`q ${fo || ''} ${so || ''} ${local(d)} ${fo && so ? 'B*' : fo ? 'f*' : 'S'} Q`);
      break;
    }
    case 'text': {
      const { d } = geometryPath(e.geom || 'rect', e.w, e.h);
      const fo = fillOp(ctx, fill), so = strokeOp(ctx, line);
      if (fo || so) out.push(`q ${fo || ''} ${so || ''} ${local(d)} ${fo && so ? 'B' : fo ? 'f' : 'S'} Q`);
      let lines: LaidLine[];
      let separators: { x: number; y: number; w: number }[] = [];
      if (fromMaster) { const story = pub.story(e.story); const boxes: FlowBox[] = frameBoxes(e, owner, ctx.pageIndex, pub); lines = story ? layoutStory(story.paras, layoutOptions(pub, boxes, { anchor: (e.columns || 1) === 1 ? e.anchor : undefined })).lines : []; }
      else { const fl = frameLines(pub, e); lines = fl.lines; separators = fl.separators; }
      out.push(`q ${local(d)} W n 1 0 0 1 ${n(-e.x)} ${n(-e.y)} cm`);
      out.push(await linesOps(ctx, lines));
      // Footnote separators: a rule above the notes at the bottom of a column.
      const sepW = pub.data.footnoteOptions?.separator.width ?? 0.5;
      for (const sp of separators) if (sepW > 0) out.push(`q 0 G ${n(sepW)} w ${n(sp.x)} ${n(sp.y)} m ${n(sp.x + sp.w)} ${n(sp.y)} l S Q`);
      out.push('Q');
      break;
    }
    case 'picture': {
      const { d } = geometryPath(e.geom || 'rect', e.w, e.h);
      const fo = fillOp(ctx, fill);
      if (fo) out.push(`q ${fo} ${local(d)} f Q`);
      if (e.media) {
        const im = await imageObj(ctx, e.media);
        if (im) {
          const [cl, ct, cr, cb] = e.crop || [0, 0, 0, 0];
          const vw = (1 - cl - cr) * im.w, vh = (1 - ct - cb) * im.h;
          const fit = e.fit || 'fill';
          let dw = e.w, dh = e.h, dx = 0, dy = 0;
          if (fit === 'fit' || fit === 'fill') {
            const k = fit === 'fit' ? Math.min(e.w / vw, e.h / vh) : Math.max(e.w / vw, e.h / vh);
            dw = vw * k; dh = vh * k; dx = (e.w - dw) / 2; dy = (e.h - dh) / 2;
          } else if (fit === 'none') { const k = (e.pos?.scale || 1) * 0.75; dw = vw * k; dh = vh * k; dx = e.pos?.x || 0; dy = e.pos?.y || 0; }
          // Full image placement so that the crop window maps onto the destination rectangle.
          const fw = dw / (1 - cl - cr), fh = dh / (1 - ct - cb);
          const fx = dx - cl * fw, fy = dy - ct * fh;
          const idx = [...ctx.images.keys()].indexOf(e.media) + 1;
          out.push(`q ${local(d)} W n 1 0 0 1 ${n(fx)} ${n(fy + fh)} cm ${n(fw)} 0 0 ${n(-fh)} 0 0 cm /Im${idx} Do Q`);
        } else out.push(`q 0.95 g ${local(d)} f Q`);
      }
      const so = strokeOp(ctx, line);
      if (so) out.push(`q ${so} ${local(d)} S Q`);
      break;
    }
    case 'table': {
      let y = 0;
      const cols = e.cols;
      const totalW = cols.reduce((a, b) => a + b, 0), totalH = e.rows.reduce((a, r) => a + r.h, 0);
      out.push(`q 1 0 0 1 ${n(e.x)} ${n(e.y)} cm`);
      for (let ri = 0; ri < e.rows.length; ri++) {
        const row = e.rows[ri];
        let x = 0;
        for (let ci = 0; ci < row.cells.length; ci++) {
          const cell = row.cells[ci];
          const cw = cols[ci] || 0;
          if (cell.merged) { x += cw; continue; }
          const span = cell.colSpan || 1, rspan = cell.rowSpan || 1;
          const w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0), h = e.rows.slice(ri, ri + rspan).reduce((a, r) => a + r.h, 0);
          const band = e.style?.bandedRows && ri % 2 === 1 ? ({ type: 'solid', color: e.style.bandColor || 'Light Gray' } as Fill) : undefined;
          const header = (e.style?.firstRow && ri === 0) || row.header ? (e.style?.headerFill || ({ type: 'solid', color: 'Primary' } as Fill)) : undefined;
          const cf = fillOp(ctx, cell.fill ?? header ?? band);
          if (cf) out.push(`q ${cf} ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f Q`);
          const ins = cell.insets || [4, 3, 4, 3];
          const box: FlowBox = { frame: e.id, col: 0, x: x + ins[0], y: y + ins[1], w: Math.max(1, w - ins[0] - ins[2]), h: Math.max(1, h - ins[1] - ins[3]), page: ctx.pageIndex };
          const paras: Paragraph[] = cell.text.length ? cell.text : [{ style: 'Table Text', runs: [] }];
          const r = layoutStory(paras, layoutOptions(pub, [box], { anchor: cell.anchor || 't', unbounded: true }));
          out.push(`q ${n(x)} ${n(y)} ${n(w)} ${n(h)} re W n`, await linesOps(ctx, r.lines), 'Q');
          x += cw;
        }
        y += row.h;
      }
      const inner = strokeOp(ctx, e.innerBorder ?? { fill: { type: 'solid', color: 'Gray' }, width: 0.5 });
      if (inner) {
        let xx = 0; for (let c = 1; c < cols.length; c++) { xx += cols[c - 1]; out.push(`q ${inner} ${n(xx)} 0 m ${n(xx)} ${n(totalH)} l S Q`); }
        let yy = 0; for (let r = 1; r < e.rows.length; r++) { yy += e.rows[r - 1].h; out.push(`q ${inner} 0 ${n(yy)} m ${n(totalW)} ${n(yy)} l S Q`); }
      }
      const outer = strokeOp(ctx, e.border ?? { fill: { type: 'solid', color: 'Black' }, width: 0.75 });
      if (outer) out.push(`q ${outer} 0 0 ${n(totalW)} ${n(totalH)} re S Q`);
      out.push('Q');
      break;
    }
  }
  out.push('Q');
}

/** Builds the PDF for the publication. */
export async function pubToPdf(pub: Pub, opts: PdfOptions = {}): Promise<Uint8Array> {
  // Anchored objects sit where the text flow last put them.
  syncAnchors(pub);
  const w = new Writer();
  const fonts = new Map<string, number>(), images = new Map<string, { obj: number; w: number; h: number }>();
  const fontRes: string[] = [], imgRes: string[] = [];
  const fontSet = new PdfFonts(opts.fontLoader, opts.onWarning);
  const bleed = opts.bleed ? pub.data.bleed : 0;
  const marksPad = opts.marks ? Math.max(bleed, 18) + 18 : 0;
  const pad = Math.max(bleed, marksPad);
  const W = pub.size.w + pad * 2, H = pub.size.h + pad * 2;
  const pagesObj = w.reserve();
  const pageObjs: number[] = [];
  const pages = opts.pages ? pub.pages.filter((p) => opts.pages!.includes(p.id)) : pub.pages;
  const gsObjs = new Set<number>();
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const pageIndex = pub.pageIndex(page.id);
    const ctx: Ctx = { pub, w, fontSet, fonts, images, fontRes, imgRes, H, bleed, opts, pageIndex };
    const ops: string[] = [];
    // Flip to y-down page coordinates: origin at the top-left of the trim box.
    ops.push(`1 0 0 -1 ${n(pad)} ${n(H - pad)} cm`);
    if (page.bg && page.bg.type !== 'none') { const fo = fillOp(ctx, page.bg); if (fo) ops.push(`q ${fo} ${n(-pad)} ${n(-pad)} ${n(W)} ${n(H)} re f Q`); }
    const m = pub.masterOf(page);
    if (!page.hideMasterItems) { const overridden = new Set(page.items.map((e) => e.masterOf).filter(Boolean)); for (const e of m.items) if (!overridden.has(e.id)) await itemOps(ctx, e, m, true, ops); }
    for (const e of page.items) await itemOps(ctx, e, page, false, ops);
    if (opts.marks) {
      const L = 18, off = Math.max(bleed, 9), pw = pub.size.w, ph = pub.size.h;
      const mk: string[] = [];
      for (const [x, y, dx, dy] of [[0, 0, -1, -1], [pw, 0, 1, -1], [0, ph, -1, 1], [pw, ph, 1, 1]] as [number, number, number, number][]) {
        mk.push(`${n(x)} ${n(y + dy * off)} m ${n(x)} ${n(y + dy * (off + L))} l S`);
        mk.push(`${n(x + dx * off)} ${n(y)} m ${n(x + dx * (off + L))} ${n(y)} l S`);
      }
      ops.push(`q 0 G 0.25 w ${mk.join(' ')} Q`);
      const f = fontKey(ctx, 'Helvetica');
      ops.push(`BT 0 g ${f} 7 Tf 1 0 0 -1 ${n(0)} ${n(-off - L - 4)} Tm ${pdfText(`${pub.data.props.title || 'Untitled'}  page ${pub.pageLabel(pageIndex) || pageIndex + 1}  ${new Date().toLocaleDateString()}`)} Tj ET`);
    }
    for (const line of ops) for (const mm of line.matchAll(/\/GSa(\d+) gs/g)) gsObjs.add(+mm[1]);
    const content = w.stream('', ops.join('\n'));
    const pageObj = w.reserve();
    pageObjs.push(pageObj);
    (page as any).__pdfContent = content;
    opts.onProgress?.(pi + 1, pages.length);
  }
  await fontSet.finish(w, deflate);
  lastWarnings = [...fontSet.warnings];
  const gsRes = [...gsObjs].map((a) => `/GSa${a} ${w.add(`<< /Type /ExtGState /ca ${n(a / 100)} /CA ${n(a / 100)} >>`)} 0 R`);
  const resources = `<< /Font << ${fontRes.join(' ')} >> /XObject << ${imgRes.join(' ')} >> /ExtGState << ${gsRes.join(' ')} >> /ProcSet [/PDF /Text /ImageB /ImageC] >>`;
  const resObj = w.add(resources);
  pages.forEach((page, i) => {
    const boxes = `/MediaBox [0 0 ${n(W)} ${n(H)}]${pad ? ` /TrimBox [${n(pad)} ${n(pad)} ${n(pad + pub.size.w)} ${n(pad + pub.size.h)}] /BleedBox [${n(pad - bleed)} ${n(pad - bleed)} ${n(pad + pub.size.w + bleed)} ${n(pad + pub.size.h + bleed)}]` : ''}`;
    w.set(pageObjs[i], `<< /Type /Page /Parent ${pagesObj} 0 R ${boxes} /Contents ${(page as any).__pdfContent} 0 R /Resources ${resObj} 0 R >>`);
    delete (page as any).__pdfContent;
  });
  w.set(pagesObj, `<< /Type /Pages /Kids [${pageObjs.map((o) => `${o} 0 R`).join(' ')}] /Count ${pageObjs.length} >>`);
  // Page labels from sections
  let labels = '';
  if (pub.data.sections.length) {
    const nums: string[] = [];
    const secs = [...pub.data.sections].sort((a, b) => a.start - b.start);
    if (!secs.some((s) => s.start === 0)) nums.push(`0 << /S /D >>`);
    for (const s of secs) { const style = s.numbering === 'none' ? '' : /romanLc/.test(s.numbering) ? '/S /r' : /romanUc/.test(s.numbering) ? '/S /R' : /alphaLc/.test(s.numbering) ? '/S /a' : /alphaUc/.test(s.numbering) ? '/S /A' : '/S /D'; nums.push(`${s.start} << ${style} /St ${s.startAt}${s.prefix ? ` /P ${pdfText(s.prefix)}` : ''} >>`); }
    labels = ` /PageLabels << /Nums [${nums.join(' ')}] >>`;
  }
  const catalog = w.add(`<< /Type /Catalog /Pages ${pagesObj} 0 R${labels} >>`);
  const p = pub.data.props;
  const date = (t?: number) => { const d = new Date(t || Date.now()); const z = (v: number) => String(v).padStart(2, '0'); return `(D:${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z)`; };
  const info = w.add(`<< /Producer (QuillPress) /Creator (QuillPress)${p.title ? ` /Title ${pdfText(p.title)}` : ''}${p.author ? ` /Author ${pdfText(p.author)}` : ''}${p.subject ? ` /Subject ${pdfText(p.subject)}` : ''}${p.keywords ? ` /Keywords ${pdfText(p.keywords)}` : ''} /CreationDate ${date(p.created)} /ModDate ${date(p.modified)} >>`);
  return w.build(catalog, info);
}

export { pathOps as svgPathToPdf };
export type { TextFrame };
