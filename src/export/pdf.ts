/**
 * PDF export with QuillPress's own writer (no dependency). Pages are written as vector content that
 * matches the screen renderer (src/render/page.ts): shapes and frames as paths with solid, gradient
 * (shadings), pattern and picture fills, line ends and drop shadows (pdfPaint.ts); text as positioned
 * runs; pictures as embedded JPEG (DCTDecode) or decoded RGB (FlateDecode) with their adjustments
 * (pdfImages.ts); links as URI annotations; trim and bleed boxes, page labels and document
 * information.
 *
 * Fonts: text set in a bundled family (Tinos, Arimo, Cousine, Carlito, Caladea, Gelasio, EB Garamond,
 * Courier Prime, Libre Baskerville, Lato, Merriweather, Open Sans), one of their aliases (Times New
 * Roman, Arial, Courier New, Calibri…) or a font file the user added is embedded as a subset
 * (export/fonts/), so the PDF shows the same faces as the screen and its text stays searchable.
 * Families that are none of these print in the face the screen falls back to; characters the latin
 * files lack come from the core families' Latin Extended, Cyrillic and Greek subsets. Only when
 * embedding is turned off (or a font cannot be loaded) does text use the standard 14 fonts.
 */
import type { Pub } from '../model/pub';
import type { Item, Page, Line, TextFrame, Master, PathTextItem } from '../model/types';
import { colorHex } from '../model/styles';
import { geometryPath } from '../model/geometry';
import { frameBoxes, frameLines, frameClipHeight, layoutOptions, syncAnchors } from '../render/flow';
import { pathTextLayout, pathPolyline, localToPage, pathTextNotes } from '../render/pathText';
import { tableLayout } from '../render/table';
import { defaultShapeFillLine } from '../render/page';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';
import { layoutStory, segRaise, hscaleOf, type LaidLine, type FlowBox } from '../render/text';
import { PdfFonts, type EmbeddedFace, type FontLoader } from './fonts/embed';
import { imageObj, deflate, pictureFilter, type ImageEntry } from './pdfImages';
import { pathOps, rgb, n, fillPath, fillColor, lineEndsOps, type PaintCtx, type PathEnds } from './pdfPaint';
import { effectsOps } from './pdfEffects';

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
/** Warnings of the most recent pubToPdf call (fonts printed in another face, characters without glyphs). */
export function lastPdfWarnings(): string[] { return [...lastWarnings]; }

// Helvetica, Times and Courier glyph widths (1/1000 em) for ASCII 32–126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];

const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };

/** A PDF literal string in WinAnsi (one byte per character): characters outside the encoding become "?". */
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

/** A PDF text string (document information, labels): plain ASCII as a literal, anything else as UTF-16BE with a byte-order mark. */
export function pdfTextString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return pdfText(s);
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/** Characters pdfText cannot encode in WinAnsi. */
function winAnsiMisses(s: string): number {
  let k = 0;
  for (const ch of s) { const c = ch.codePointAt(0)!; if (c >= 32 && (c > 255 || (c >= 0x80 && c < 0xa0)) && CP1252[c] == null) k++; }
  return k;
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

/** Bytes of a string whose characters are all below 256 (content streams, dictionaries): one byte each. */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i] = c < 256 ? c : 63; }
  return out;
}

class Writer {
  private objs: (string | Uint8Array)[] = [];
  add(body: string | Uint8Array): number { this.objs.push(body); return this.objs.length; }
  set(num: number, body: string | Uint8Array): void { this.objs[num - 1] = body; }
  reserve(): number { return this.add(''); }
  stream(dict: string, data: Uint8Array | string): number {
    const bytes = typeof data === 'string' ? latin1(data) : data;
    const head = latin1(`<< ${dict} /Length ${bytes.length} >>\nstream\n`);
    const tail = latin1('\nendstream');
    const out = new Uint8Array(head.length + bytes.length + tail.length);
    out.set(head); out.set(bytes, head.length); out.set(tail, head.length + bytes.length);
    return this.add(out);
  }
  build(root: number, info: number): Uint8Array {
    const parts: Uint8Array[] = [latin1('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
    let pos = parts[0].length;
    const offsets: number[] = [];
    this.objs.forEach((o, i) => {
      offsets.push(pos);
      const head = latin1(`${i + 1} 0 obj\n`);
      const body = typeof o === 'string' ? latin1(o) : o;
      const tail = latin1('\nendobj\n');
      parts.push(head, body, tail);
      pos += head.length + body.length + tail.length;
    });
    const xref = pos;
    let x = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) x += `${String(o).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${this.objs.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    parts.push(latin1(x));
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let k = 0;
    for (const p of parts) { out.set(p, k); k += p.length; }
    return out;
  }
}

type Matrix = [number, number, number, number, number, number];

interface Ctx extends PaintCtx {
  w: Writer;
  fontSet: PdfFonts;
  fonts: Map<string, number>;
  fontRes: string[];
  H: number;
  pad: number;
  bleed: number;
  opts: PdfOptions;
  pageIndex: number;
  /** Current transformation from the coordinates being drawn to y-down page coordinates (for link rectangles). */
  m: Matrix;
  links: { rect: [number, number, number, number]; uri: string }[];
  /** Characters no embedded face had and WinAnsi could not encode (printed as "?"). */
  missing: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Pushes a `cm` and keeps the tracked matrix in step (new = M × current, as in PDF). */
function cm(ctx: Ctx, out: string[], a: number, b: number, c: number, d: number, e: number, f: number): void {
  out.push(`${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)} cm`);
  const C = ctx.m;
  ctx.m = [a * C[0] + b * C[2], a * C[1] + b * C[3], c * C[0] + d * C[2], c * C[1] + d * C[3], e * C[0] + f * C[2] + C[4], e * C[1] + f * C[3] + C[5]];
}

/** Rotation by `deg` (clockwise on the page) and flips about a center point, as the renderer's transforms. */
function rotateFlip(ctx: Ctx, out: string[], cx: number, cy: number, deg: number | undefined, flipH: boolean | undefined, flipV: boolean | undefined, skew?: number): void {
  if (deg) { const a = (deg * Math.PI) / 180; cm(ctx, out, 1, 0, 0, 1, cx, cy); cm(ctx, out, Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); cm(ctx, out, 1, 0, 0, 1, -cx, -cy); }
  // Skew about the centre inside the rotation, as the renderer's skewX(-skew): positive leans the top right.
  if (skew) { cm(ctx, out, 1, 0, 0, 1, cx, cy); cm(ctx, out, 1, 0, Math.tan((-skew * Math.PI) / 180), 1, 0, 0); cm(ctx, out, 1, 0, 0, 1, -cx, -cy); }
  if (flipH || flipV) { cm(ctx, out, 1, 0, 0, 1, cx, cy); cm(ctx, out, flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, 0, 0); cm(ctx, out, 1, 0, 0, 1, -cx, -cy); }
}

/** Records a link over a rectangle of the current coordinates (as its bounding box on the page). */
function addLink(ctx: Ctx, x: number, y: number, w: number, h: number, uri: string | undefined): void {
  if (!uri || !/^(https?:|mailto:|ftp:|tel:|file:)/i.test(uri.trim())) return;
  const m = ctx.m;
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  // Page coordinates (y down from the trim box) → PDF default space.
  const x0 = Math.min(...xs) + ctx.pad, x1 = Math.max(...xs) + ctx.pad;
  const y0 = ctx.H - ctx.pad - Math.max(...ys), y1 = ctx.H - ctx.pad - Math.min(...ys);
  // The words of one link on one line become one annotation.
  const last = ctx.links[ctx.links.length - 1];
  if (last && last.uri === uri.trim() && Math.abs(last.rect[1] - y0) < 0.5 && Math.abs(last.rect[3] - y1) < 0.5 && x0 <= last.rect[2] + 1 && x1 >= last.rect[0] - 1) {
    last.rect = [Math.min(last.rect[0], x0), y0, Math.max(last.rect[2], x1), y1];
    return;
  }
  ctx.links.push({ rect: [x0, y0, x1, y1], uri: uri.trim() });
}

function strokeOp(ctx: Ctx, line: Line | undefined): string | null {
  if (!line || !line.fill || line.fill.type === 'none') return null;
  const hex = fillColor(ctx, line.fill);
  if (!hex) return null;
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

/** Small capitals: lowercase letters become capitals at 70% of the size. */
function smallCapsChunks(text: string, size: number): { text: string; size: number }[] {
  const out: { text: string; size: number }[] = [];
  for (const ch of text) {
    const lower = ch !== ch.toUpperCase() && ch === ch.toLowerCase();
    // Browsers synthesize small capitals at 70% of the size; the layout measured them that way.
    const sz = lower ? size * 0.7 : size;
    const t = lower ? ch.toUpperCase() : ch;
    const last = out[out.length - 1];
    if (last && last.size === sz) last.text += t; else out.push({ text: t, size: sz });
  }
  return out;
}

/**
 * One run of text at a page position: in the embedded face (glyph ids, Identity-H), with characters
 * it lacks taken from the supplementary subsets, and only what no face has in a standard font.
 */
/** Type effects a text writer applies: horizontal glyph scale (factor) and outline type. */
interface TextFx { hscale?: number; outline?: boolean }

/**
 * Fill colour, render mode and stroke for a piece of text: outline type strokes the glyphs in the text
 * colour over a paper-white fill; synthetic bold strokes them in the text colour (both widen the stroke).
 */
function paintOps(color: [number, number, number], size: number, outline: boolean | undefined, synthBold: boolean): { fill: string; stroke: string } {
  const [r, g, b] = color;
  const w = (outline ? size / 30 : 0) + (synthBold ? size / 30 : 0);
  return { fill: outline ? '1 1 1 rg' : `${n(r)} ${n(g)} ${n(b)} rg`, stroke: w > 0 ? ` 2 Tr ${n(w)} w ${n(r)} ${n(g)} ${n(b)} RG` : '' };
}

/**
 * Horizontal scaling for a factor (inside BT … ET). Tz is text state that survives ET like Tc, so every
 * text object sets it, or a scaled run would stretch all the text drawn after it.
 */
const tzOp = (k: number) => ` ${n(k * 100)} Tz`;

async function textOps(ctx: Ctx, text: string, family: string | undefined, bold: boolean | undefined, italic: boolean | undefined, size: number, x: number, y: number, color: [number, number, number], spc: number, caps: 'all' | 'small' | 'none' | undefined, angle = 0, fx: TextFx = {}): Promise<string> {
  // Text matrix for y-down page coordinates: the baseline runs along `angle` (degrees, clockwise).
  const ca = Math.cos((angle * Math.PI) / 180), sa = Math.sin((angle * Math.PI) / 180);
  const tm = (adv: number, skew = false) => `${n(ca)} ${n(sa)} ${n(sa + (skew ? 0.2 * ca : 0))} ${n(-ca + (skew ? 0.2 * sa : 0))} ${n(x + adv * ca)} ${n(y + adv * sa)} Tm`;
  // Horizontal scale: Tz stretches the glyphs and the character spacing, so the spacing is divided by
  // the factor to keep the tracking the layout used (glyphs × factor + tracking per character).
  const k = fx.hscale && fx.hscale > 0 ? fx.hscale : 1;
  const tc = spc / k;
  const std = stdFont(family, bold, italic);
  const face = ctx.opts.embedFonts === false ? null : await ctx.fontSet.face(family, bold, italic);
  const chunks = caps === 'small' ? smallCapsChunks(text, size) : [{ text: caps === 'all' ? text.toUpperCase() : text, size }];
  const ops: string[] = [];
  let cx = 0;
  const stdOp = (t: string, sz: number) => {
    const f = fontKey(ctx, std);
    ctx.missing += winAnsiMisses(t);
    const p = paintOps(color, sz, fx.outline, false);
    ops.push(`BT ${p.fill} ${f} ${n(sz)} Tf ${n(tc)} Tc${tzOp(k)}${p.stroke} ${tm(cx)} ${pdfText(t)} Tj ET${p.stroke ? ' 0 Tr' : ''}`);
    cx += textWidth(t, sz, std) * k + spc * [...t].length;
  };
  for (const ch of chunks) {
    if (!face) { stdOp(ch.text, ch.size); continue; }
    for (const piece of await ctx.fontSet.encodeAll(face, ch.text, ch.size, tc)) {
      if ('hex' in piece) {
        const res = embeddedKey(ctx, piece.face);
        const p = paintOps(color, piece.size, fx.outline, !!piece.face.synthBold);
        ops.push(`BT ${p.fill} ${res} ${n(piece.size)} Tf ${n(tc)} Tc${tzOp(k)}${p.stroke} ${tm(cx, !!piece.face.synthItalic)} <${piece.hex}> Tj ET${p.stroke ? ' 0 Tr' : ''}`);
        cx += piece.width * k;
      } else {
        stdOp(piece.fallback, piece.size);
      }
    }
  }
  return ops.join('\n');
}

/**
 * Shadow type: the same text again, offset down and right by a twelfth of the size (along the glyph's
 * own axes for rotated text) in the text colour at 45% opacity, drawn before the text. The copy is
 * marked with an empty ActualText so text extraction and copying see the words once.
 */
function shadowWrap(ops: string): string {
  return ops ? `q /GSa45 gs /Span << /ActualText () >> BDC\n${ops}\nEMC Q` : '';
}

/**
 * Consecutive segments of one style as a single TJ string in one embedded face: each segment's glyphs,
 * then the adjustment that moves the pen to the next segment's laid-out start. Null when the run needs
 * more than that (characters from another face or a standard font, small capitals, standard fonts).
 */
async function groupOps(ctx: Ctx, l: LaidLine, segs: LaidLine['segs'], shadow = false): Promise<string | null> {
  const s0 = segs[0], st = s0.style;
  if (ctx.opts.embedFonts === false || st.caps === 'small') return null;
  const face = await ctx.fontSet.face(s0.font, st.b, st.i);
  if (!face) return null;
  // Horizontal scale (Tz) also scales the character spacing and the TJ adjustments, so both are given
  // in unscaled text space: positions are divided by the factor.
  const k = hscaleOf(st);
  const tc = (st.spc || 0) / k;
  const parts: string[] = [];
  let pen = 0;
  for (const s of segs) {
    if (!s.text) continue;
    const pieces = await ctx.fontSet.encodeAll(face, st.caps === 'all' ? s.text.toUpperCase() : s.text, s0.size, tc);
    if (pieces.some((p) => !('hex' in p) || p.face !== face)) return null;
    const target = (s.x - s0.x) / k;
    if (Math.abs(target - pen) > 0.001) parts.push(n(((pen - target) * 1000) / s0.size));
    for (const p of pieces) if ('hex' in p) { parts.push(`<${p.hex}>`); pen += p.width; }
    pen = target + pieces.reduce((a, p) => a + p.width, 0);
  }
  if (!parts.length) return null;
  const color = rgb(colorHex(ctx.pub.data, st.color));
  const off = shadow ? s0.size / 12 : 0;
  const y = l.y - segRaise(st, s0.size) + off;
  const res = embeddedKey(ctx, face);
  const p = shadow ? { fill: `${n(color[0])} ${n(color[1])} ${n(color[2])} rg`, stroke: '' } : paintOps(color, s0.size, st.outline, !!face.synthBold);
  const sk = face.synthItalic ? 0.2 : 0;
  return `BT ${p.fill} ${res} ${n(s0.size)} Tf ${n(tc)} Tc${tzOp(k)}${p.stroke} 1 0 ${n(sk)} -1 ${n(l.x + s0.x + off)} ${n(y)} Tm [${parts.join(' ')}] TJ ET${p.stroke ? ' 0 Tr' : ''}`;
}

/** Text of laid-out lines as PDF operators (coordinates of the current space, y down). */
async function linesOps(ctx: Ctx, lines: LaidLine[]): Promise<string> {
  const d = ctx.pub.data;
  const out: string[] = [];
  for (const l of lines) {
    if (l.bullet) out.push(await textOps(ctx, l.bullet.text, l.bullet.font, false, false, l.bullet.size, l.bullet.x, l.y, rgb(colorHex(d, l.bullet.color)), 0, undefined));
    // Runs of segments in one style (words and the spaces between them) go out as one TJ string with
    // position adjustments, so every word sits where the layout put it and the space glyphs sit
    // inside the string: poppler reads an Identity-H space glyph at a string boundary as a letter and
    // runs the words together. Groups the TJ path cannot take are drawn segment by segment below.
    const drawn = new Set<number>();
    for (let i = 0; i < l.segs.length;) {
      let j = i + 1;
      const a = l.segs[i];
      const key = (x: typeof a) => `${x.font}|${x.size}|${JSON.stringify(x.style)}`;
      while (j < l.segs.length && !l.segs[j].drop && !l.segs[j].anchor && !l.segs[j].footnote && key(l.segs[j]) === key(a)) j++;
      if (j - i > 1 && !a.drop && !a.anchor && !a.footnote) {
        const ops = await groupOps(ctx, l, l.segs.slice(i, j));
        if (ops) {
          if (a.style.tshadow) out.push(shadowWrap((await groupOps(ctx, l, l.segs.slice(i, j), true)) || ''));
          out.push(ops);
          for (let k = i; k < j; k++) drawn.add(k);
        }
      }
      i = j;
    }
    for (let si = 0; si < l.segs.length; si++) {
      const s = l.segs[si];
      if (!s.text) continue;
      const st = s.style;
      if (st.highlight) {
        const hx = colorHex(d, st.highlight);
        if (hx !== 'none') { const [hr, hg, hb] = rgb(hx); out.push(`q ${n(hr)} ${n(hg)} ${n(hb)} rg ${n(l.x + s.x)} ${n(l.y - l.ascent)} ${n(s.w)} ${n(l.ascent * 1.25)} re f Q`); }
      }
      const color = rgb(colorHex(d, st.color));
      let y = l.y;
      if (s.drop) y = l.y + (s.drop - 1) * l.height;
      y -= segRaise(st, s.size);
      const fx: TextFx = { hscale: hscaleOf(st), outline: st.outline };
      if (!drawn.has(si)) {
        if (st.tshadow) { const off = s.size / 12; out.push(shadowWrap(await textOps(ctx, s.text, s.font, st.b, st.i, s.size, l.x + s.x + off, y + off, color, st.spc || 0, st.caps, 0, { hscale: fx.hscale }))); }
        out.push(await textOps(ctx, s.text, s.font, st.b, st.i, s.size, l.x + s.x, y, color, st.spc || 0, st.caps, 0, fx));
      }
      if (st.u || st.strike) {
        const [r, g, b] = color;
        const yy = st.u ? y + s.size * 0.12 : y - s.size * 0.3;
        out.push(`q ${n(r)} ${n(g)} ${n(b)} RG ${n(Math.max(0.5, s.size / 16))} w [] 0 d ${n(l.x + s.x)} ${n(yy)} m ${n(l.x + s.x + s.w)} ${n(yy)} l S Q`);
      }
      if (st.link) addLink(ctx, l.x + s.x, l.y - l.ascent, s.w, l.ascent * 1.25, st.link);
    }
  }
  return out.join('\n');
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
    const color = rgb(colorHex(pub.data, st.color));
    const k = hscaleOf(st);
    if (st.tshadow) {
      // The shadow offset runs along the glyph's own axes (down and right of the glyph).
      const off = g.size / 12;
      out.push(shadowWrap(await textOps(ctx, g.ch, g.font, st.b, st.i, g.size, ox + off * (Math.cos(a) - Math.sin(a)), oy + off * (Math.sin(a) + Math.cos(a)), color, 0, st.caps, g.angle, { hscale: k })));
    }
    out.push(await textOps(ctx, g.ch, g.font, st.b, st.i, g.size, ox, oy, color, 0, st.caps, g.angle, { hscale: k, outline: st.outline }));
  }
  // Footnotes: the note area under the item's box, in the item's local coordinates (position, rotation, flips).
  const notes = pathTextNotes(e, layoutOptions(pub, []));
  if (notes.lines.length) {
    const saved = ctx.m;
    out.push('q');
    cm(ctx, out, 1, 0, 0, 1, e.x, e.y);
    rotateFlip(ctx, out, e.w / 2, e.h / 2, e.rot, e.flipH, e.flipV, e.skew);
    const fo = pub.data.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS;
    const sp = notes.separator;
    if (sp && sp.w > 0 && fo.separator.width > 0) out.push(`q 0 G ${n(fo.separator.width)} w ${n(sp.x)} ${n(sp.y)} m ${n(sp.x + sp.w)} ${n(sp.y)} l S Q`);
    out.push(await linesOps(ctx, notes.lines), 'Q');
    ctx.m = saved;
  }
  out.push('Q');
}

/** Places a picture in its frame (frame-local coordinates) as the renderer does for each fit. */
function placePicture(e: Extract<Item, { kind: 'picture' }>, im: ImageEntry, mediaW: number, mediaH: number): string {
  const [cl, ct, cr, cb] = e.crop || [0, 0, 0, 0];
  const fit = e.fit || 'fill';
  const draw = (x: number, y: number, dw: number, dh: number) => `q ${n(dw)} 0 0 ${n(-dh)} ${n(x)} ${n(y + dh)} cm ${im.res} Do Q`;
  if (fit === 'tile') {
    const tw = mediaW * 0.75 * (e.pos?.scale || 1), th = mediaH * 0.75 * (e.pos?.scale || 1);
    if (tw < 0.5 || th < 0.5) return '';
    const parts: string[] = [];
    for (let y = 0; y < e.h && parts.length < 2500; y += th) for (let x = 0; x < e.w && parts.length < 2500; x += tw) parts.push(draw(x, y, tw, th));
    return parts.join('\n');
  }
  // The visible (cropped) part of the picture, in the media's own pixel proportions.
  const vw = Math.max(1e-6, (1 - cl - cr) * mediaW), vh = Math.max(1e-6, (1 - ct - cb) * mediaH);
  let dw = e.w, dh = e.h, dx = 0, dy = 0;
  if (fit === 'fit' || fit === 'fill') {
    const k = fit === 'fit' ? Math.min(e.w / vw, e.h / vh) : Math.max(e.w / vw, e.h / vh);
    dw = vw * k; dh = vh * k; dx = (e.w - dw) / 2; dy = (e.h - dh) / 2;
  } else if (fit === 'none') { const k = (e.pos?.scale || 1) * 0.75; dw = vw * k; dh = vh * k; dx = e.pos?.x || 0; dy = e.pos?.y || 0; }
  // Full image placement so that the crop window maps onto the destination rectangle.
  const fw = dw / Math.max(1e-6, 1 - cl - cr), fh = dh / Math.max(1e-6, 1 - ct - cb);
  return draw(dx - cl * fw, dy - ct * fh, fw, fh);
}

async function itemOps(ctx: Ctx, e: Item, owner: Page | Master, fromMaster: boolean, out: string[]): Promise<void> {
  if (e.hidden) return;
  const layer = ctx.pub.layer(e.layer);
  if (layer?.hidden) return;
  const pub = ctx.pub;
  if (e.kind === 'pathText') { await pathTextOps(ctx, e, out); return; }
  const saved = ctx.m;
  out.push('q');
  rotateFlip(ctx, out, e.x + e.w / 2, e.y + e.h / 2, e.rot, e.flipH, e.flipV, e.skew);
  if (e.alpha != null && e.alpha < 1) out.push(`/GSa${Math.round(e.alpha * 100)} gs`);
  const os = pub.objectStyle(e.ostyle);
  const fill = e.fill ?? os?.fill;
  const line = e.line ?? os?.line;
  const at = `1 0 0 1 ${n(e.x)} ${n(e.y)} cm`;
  switch (e.kind) {
    // Children are in page coordinates; the group only adds its rotation and flips (above).
    case 'group': for (const c of e.children) await itemOps(ctx, c, owner, fromMaster, out); break;
    case 'line': {
      const l = line ?? { fill: { type: 'solid', color: 'Black' }, width: 1 };
      const so = strokeOp(ctx, l);
      if (so) {
        out.push(`q ${so} ${n(e.x)} ${n(e.y)} m ${n(e.x + e.w)} ${n(e.y + e.h)} l S Q`);
        const ends: PathEnds = { start: { x: e.x, y: e.y, dx: -e.w, dy: -e.h }, end: { x: e.x + e.w, y: e.y + e.h, dx: e.w, dy: e.h } };
        const arrows = lineEndsOps(ctx, l, ends);
        if (arrows) out.push(arrows);
      }
      break;
    }
    case 'shape': {
      const { d, open } = geometryPath(e.geom, e.w, e.h, e.adj, e.path);
      const def = defaultShapeFillLine(e);
      const ends: PathEnds = {};
      const path = pathOps(d, ends);
      const f = open ? undefined : fill ?? def.fill;
      const l = line ?? def.line;
      const so = strokeOp(ctx, l);
      out.push(`q ${at}`);
      if (f && f.type !== 'none') { const sh = await effectsOps(ctx, e.effects, path, true); if (sh) out.push(sh); }
      const fo = await fillPath(ctx, f, path, e.w, e.h, true);
      if (fo) out.push(fo);
      if (so) out.push(`q ${so}\n${path}\nS Q`);
      if (so) { const arrows = lineEndsOps(ctx, l, ends); if (arrows) out.push(arrows); }
      out.push('Q');
      break;
    }
    case 'text': {
      const { d } = geometryPath(e.geom || 'rect', e.w, e.h);
      const path = pathOps(d);
      const so = strokeOp(ctx, line);
      out.push(`q ${at}`);
      if (fill && fill.type !== 'none') { const sh = await effectsOps(ctx, e.effects, path); if (sh) out.push(sh); }
      const fo = await fillPath(ctx, fill, path, e.w, e.h);
      if (fo) out.push(fo);
      if (so) out.push(`q ${so}\n${path}\nS Q`);
      out.push('Q');
      let lines: LaidLine[];
      let separators: { x: number; y: number; w: number }[] = [];
      let rules: { x: number; y: number; w: number; width: number; color: string }[] = [];
      if (fromMaster) { const story = pub.story(e.story); const boxes: FlowBox[] = frameBoxes(e, owner, ctx.pageIndex, pub); const r = story ? layoutStory(story.paras, layoutOptions(pub, boxes, { anchor: (e.columns || 1) === 1 ? e.anchor : undefined })) : null; lines = r ? r.lines : []; rules = r ? r.rules : []; }
      else { const fl = frameLines(pub, e); lines = fl.lines; separators = fl.separators; rules = fl.rules; }
      // Clip to the frame (a frame that grows with its text: to the height its lines reach); the lines
      // are in the same coordinates as the frame's position.
      const clipH = frameClipHeight(e, lines);
      out.push(`q ${at}\n${clipH > e.h ? `0 0 ${n(e.w)} ${n(clipH)} re` : path}\nW n 1 0 0 1 ${n(-e.x)} ${n(-e.y)} cm`);
      for (const ru of rules) { const hx = colorHex(pub.data, ru.color); if (hx === 'none') continue; const [rr, rg, rb] = rgb(hx); out.push(`q ${n(rr)} ${n(rg)} ${n(rb)} RG ${n(ru.width)} w [] 0 d 0 J ${n(ru.x)} ${n(ru.y)} m ${n(ru.x + ru.w)} ${n(ru.y)} l S Q`); }
      out.push(await linesOps(ctx, lines));
      // Footnote separators: a rule above the notes at the bottom of a column.
      const sepW = pub.data.footnoteOptions?.separator.width ?? 0.5;
      for (const sp of separators) if (sepW > 0) out.push(`q 0 G ${n(sepW)} w ${n(sp.x)} ${n(sp.y)} m ${n(sp.x + sp.w)} ${n(sp.y)} l S Q`);
      out.push('Q');
      break;
    }
    case 'picture': {
      const { d } = geometryPath(e.geom || 'rect', e.w, e.h);
      const path = pathOps(d);
      out.push(`q ${at}`);
      if (e.media || (fill && fill.type !== 'none')) { const sh = await effectsOps(ctx, e.effects, path); if (sh) out.push(sh); }
      const fo = await fillPath(ctx, fill, path, e.w, e.h);
      if (fo) out.push(fo);
      if (e.media) {
        const im = await imageObj(ctx, e.media, pictureFilter(e));
        const m = pub.media[e.media];
        if (im) out.push(`q\n${path}\nW n\n${placePicture(e, im, m?.w || im.w, m?.h || im.h)}\nQ`);
        else out.push(`q 0.95 g\n${path}\nf Q`);
      }
      const so = strokeOp(ctx, line);
      if (so) out.push(`q ${so}\n${path}\nS Q`);
      out.push('Q');
      break;
    }
    case 'table': {
      const cols = e.cols;
      const tl = tableLayout(pub, e, ctx.pageIndex);
      const totalW = tl.w, totalH = tl.rowsH;
      const tsaved = ctx.m;
      out.push('q');
      cm(ctx, out, 1, 0, 0, 1, e.x, e.y);
      for (const c of tl.cells) {
        const rect = `${n(c.x)} ${n(c.y)} ${n(c.w)} ${n(c.h)} re`;
        if (c.fill && c.fill.type !== 'none') {
          // The cell's fill in its own box (gradients and pictures are laid out in the cell).
          const fo = await fillPath(ctx, c.fill, `0 0 ${n(c.w)} ${n(c.h)} re`, c.w, c.h);
          if (fo) out.push(`q 1 0 0 1 ${n(c.x)} ${n(c.y)} cm ${fo} Q`);
        }
        out.push(`q ${rect} W n`, await linesOps(ctx, c.lines), 'Q');
      }
      const inner = strokeOp(ctx, e.innerBorder ?? { fill: { type: 'solid', color: 'Gray' }, width: 0.5 });
      if (inner) {
        let xx = 0; for (let c = 1; c < cols.length; c++) { xx += cols[c - 1]; out.push(`q ${inner} ${n(xx)} 0 m ${n(xx)} ${n(totalH)} l S Q`); }
        let yy = 0; for (let r = 1; r < e.rows.length; r++) { yy += e.rows[r - 1].h; out.push(`q ${inner} 0 ${n(yy)} m ${n(totalW)} ${n(yy)} l S Q`); }
      }
      const outer = strokeOp(ctx, e.border ?? { fill: { type: 'solid', color: 'Black' }, width: 0.75 });
      if (outer) out.push(`q ${outer} 0 0 ${n(totalW)} ${n(totalH)} re S Q`);
      // Footnotes referenced from the cells: the note area under the rows.
      if (tl.notes.length) {
        const fo = pub.data.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS;
        const sp = tl.separator;
        if (sp && sp.w > 0 && fo.separator.width > 0) out.push(`q 0 G ${n(fo.separator.width)} w ${n(sp.x)} ${n(sp.y)} m ${n(sp.x + sp.w)} ${n(sp.y)} l S Q`);
        out.push(await linesOps(ctx, tl.notes));
      }
      out.push('Q');
      ctx.m = tsaved;
      break;
    }
  }
  if (e.link) addLink(ctx, e.x, e.y, e.w, e.h, e.link);
  out.push('Q');
  ctx.m = saved;
}

/** Builds the PDF for the publication. */
export async function pubToPdf(pub: Pub, opts: PdfOptions = {}): Promise<Uint8Array> {
  // Anchored objects sit where the text flow last put them.
  syncAnchors(pub);
  const w = new Writer();
  const fonts = new Map<string, number>(), images = new Map<string, ImageEntry>();
  const fontRes: string[] = [], imgRes: string[] = [], shadings: string[] = [], patRes: string[] = [];
  const patterns = new Map<string, string>();
  const fontSet = new PdfFonts(opts.fontLoader, opts.onWarning);
  const bleed = opts.bleed ? pub.data.bleed : 0;
  const marksPad = opts.marks ? Math.max(bleed, 18) + 18 : 0;
  const pad = Math.max(bleed, marksPad);
  const W = pub.size.w + pad * 2, H = pub.size.h + pad * 2;
  const pageMatrix = `1 0 0 -1 ${n(pad)} ${n(H - pad)}`;
  const pagesObj = w.reserve();
  const pageObjs: number[] = [];
  const pages = opts.pages ? pub.pages.filter((p) => opts.pages!.includes(p.id)) : pub.pages;
  const gsObjs = new Set<number>();
  let missing = 0;
  const pageData: { content: number; links: Ctx['links'] }[] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const pageIndex = pub.pageIndex(page.id);
    const ctx: Ctx = { pub, w, fontSet, fonts, images, fontRes, imgRes, shadings, patterns, patRes, pageMatrix, H, pad, bleed, opts, pageIndex, m: [...IDENTITY], links: [], missing: 0 };
    const ops: string[] = [];
    // Flip to y-down page coordinates: origin at the top-left of the trim box.
    ops.push(`${pageMatrix} cm`);
    if (page.bg && page.bg.type !== 'none') { const fo = await fillPath(ctx, page.bg, `0 0 ${n(W)} ${n(H)} re`, W, H); if (fo) ops.push(`q 1 0 0 1 ${n(-pad)} ${n(-pad)} cm ${fo} Q`); }
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
      ops.push(`BT 0 g ${f} 7 Tf 0 Tc 100 Tz 1 0 0 -1 ${n(0)} ${n(-off - L - 4)} Tm ${pdfText(`${pub.data.props.title || 'Untitled'}  page ${pub.pageLabel(pageIndex) || pageIndex + 1}  ${new Date().toLocaleDateString()}`)} Tj ET`);
    }
    for (const line of ops) for (const mm of line.matchAll(/\/GSa(\d+) gs/g)) gsObjs.add(+mm[1]);
    pageData.push({ content: w.stream('', ops.join('\n')), links: ctx.links });
    pageObjs.push(w.reserve());
    missing += ctx.missing;
    opts.onProgress?.(pi + 1, pages.length);
  }
  await fontSet.finish(w, deflate);
  lastWarnings = [...fontSet.warnings];
  if (missing) lastWarnings.push(`${missing} character${missing === 1 ? '' : 's'} had no glyph in the embedded fonts and print as "?" in the PDF.`);
  const gsRes = [...gsObjs].map((a) => `/GSa${a} ${w.add(`<< /Type /ExtGState /ca ${n(a / 100)} /CA ${n(a / 100)} >>`)} 0 R`);
  const resources = `<< /Font << ${fontRes.join(' ')} >> /XObject << ${imgRes.join(' ')} >> /ExtGState << ${gsRes.join(' ')} >> /Shading << ${shadings.join(' ')} >> /Pattern << ${patRes.join(' ')} >> /ProcSet [/PDF /Text /ImageB /ImageC] >>`;
  const resObj = w.add(resources);
  pages.forEach((_page, i) => {
    const boxes = `/MediaBox [0 0 ${n(W)} ${n(H)}]${pad ? ` /TrimBox [${n(pad)} ${n(pad)} ${n(pad + pub.size.w)} ${n(pad + pub.size.h)}] /BleedBox [${n(pad - bleed)} ${n(pad - bleed)} ${n(pad + pub.size.w + bleed)} ${n(pad + pub.size.h + bleed)}]` : ''}`;
    const links = pageData[i].links.map((l) => w.add(`<< /Type /Annot /Subtype /Link /Rect [${l.rect.map(n).join(' ')}] /Border [0 0 0] /A << /S /URI /URI ${pdfText(encodeURI(decodeURISafe(l.uri)))} >> >>`));
    w.set(pageObjs[i], `<< /Type /Page /Parent ${pagesObj} 0 R ${boxes} /Contents ${pageData[i].content} 0 R /Resources ${resObj} 0 R${links.length ? ` /Annots [${links.map((o) => `${o} 0 R`).join(' ')}]` : ''} >>`);
  });
  w.set(pagesObj, `<< /Type /Pages /Kids [${pageObjs.map((o) => `${o} 0 R`).join(' ')}] /Count ${pageObjs.length} >>`);
  // Page labels from sections
  let labels = '';
  if (pub.data.sections.length) {
    const nums: string[] = [];
    const secs = [...pub.data.sections].sort((a, b) => a.start - b.start);
    if (!secs.some((s) => s.start === 0)) nums.push(`0 << /S /D >>`);
    for (const s of secs) { const style = s.numbering === 'none' ? '' : /romanLc/.test(s.numbering) ? '/S /r' : /romanUc/.test(s.numbering) ? '/S /R' : /alphaLc/.test(s.numbering) ? '/S /a' : /alphaUc/.test(s.numbering) ? '/S /A' : '/S /D'; nums.push(`${s.start} << ${style} /St ${s.startAt}${s.prefix ? ` /P ${pdfTextString(s.prefix)}` : ''} >>`); }
    labels = ` /PageLabels << /Nums [${nums.join(' ')}] >>`;
  }
  const catalog = w.add(`<< /Type /Catalog /Pages ${pagesObj} 0 R${labels} >>`);
  const p = pub.data.props;
  const date = (t?: number) => { const d = new Date(t || Date.now()); const z = (v: number) => String(v).padStart(2, '0'); return `(D:${d.getUTCFullYear()}${z(d.getUTCMonth() + 1)}${z(d.getUTCDate())}${z(d.getUTCHours())}${z(d.getUTCMinutes())}${z(d.getUTCSeconds())}Z)`; };
  const info = w.add(`<< /Producer (QuillPress) /Creator (QuillPress)${p.title ? ` /Title ${pdfTextString(p.title)}` : ''}${p.author ? ` /Author ${pdfTextString(p.author)}` : ''}${p.subject ? ` /Subject ${pdfTextString(p.subject)}` : ''}${p.keywords ? ` /Keywords ${pdfTextString(p.keywords)}` : ''} /CreationDate ${date(p.created)} /ModDate ${date(p.modified)} >>`);
  return w.build(catalog, info);
}

function decodeURISafe(s: string): string { try { return decodeURI(s); } catch { return s; } }

export { pathOps as svgPathToPdf };
export type { TextFrame };
