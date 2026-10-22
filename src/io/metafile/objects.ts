/**
 * GDI objects as the metafile players keep them (pens, brushes, fonts, regions, palettes), their
 * defaults, and helpers that turn them into SVG: CSS font families, hatch patterns, colours and the
 * code page of a font's character set.
 */

export interface Pen {
  /** PS_SOLID 0, DASH 1, DOT 2, DASHDOT 3, DASHDOTDOT 4, NULL 5, INSIDEFRAME 6, USERSTYLE 7, ALTERNATE 8. */
  style: number;
  /** Logical width (0 = one device pixel). */
  width: number;
  color: string;
  /** Cosmetic pens are one device pixel wide whatever their width says. */
  cosmetic: boolean;
  cap: 'round' | 'square' | 'butt';
  join: 'round' | 'bevel' | 'miter';
  /** PS_USERSTYLE dash lengths (logical units for geometric pens). */
  dash?: number[];
}

export interface Brush {
  style: 'solid' | 'null' | 'hatch' | 'pattern';
  color: string;
  /** HS_HORIZONTAL 0, VERTICAL 1, FDIAGONAL 2, BDIAGONAL 3, CROSS 4, DIAGCROSS 5. */
  hatch?: number;
  /** Pattern brushes: the tile as a data URI and its size in pixels. */
  image?: { href: string; w: number; h: number };
}

export interface Font {
  /** lfHeight: negative = character (em) height, positive = cell height, logical units. */
  height: number;
  width: number;
  /** Tenths of a degree, counterclockwise. */
  escapement: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  charset: number;
  pitchFamily: number;
  face: string;
}

/** Rectangles [left, top, right, bottom]. */
export interface Region { rects: [number, number, number, number][] }

export type GdiObject =
  | { kind: 'pen'; pen: Pen }
  | { kind: 'brush'; brush: Brush }
  | { kind: 'font'; font: Font }
  | { kind: 'region'; region: Region }
  | { kind: 'palette'; colors: string[] }
  | { kind: 'other' };

export const DEFAULT_PEN: Pen = { style: 0, width: 0, color: '#000000', cosmetic: true, cap: 'round', join: 'round' };
export const DEFAULT_BRUSH: Brush = { style: 'solid', color: '#ffffff' };
export const DEFAULT_FONT: Font = { height: 0, width: 0, escapement: 0, weight: 400, italic: false, underline: false, strike: false, charset: 0, pitchFamily: 0, face: 'Arial' };

/** COLORREF (0x00bbggrr) as #rrggbb; palette-index references (0x01xxxxxx) resolve through `palette`. */
export function colorRef(v: number, palette?: string[]): string {
  const flag = (v >>> 24) & 0xff;
  if (flag === 1 && palette) return palette[v & 0xffff] || '#000000';
  const r = v & 0xff, g = (v >>> 8) & 0xff, b = (v >>> 16) & 0xff;
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Brush from LOGBRUSH style/colour/hatch (BS_SOLID 0, NULL 1, HATCHED 2, PATTERN 3, DIBPATTERN 5/6). */
export function brushOf(style: number, color: string, hatch: number): Brush {
  if (style === 1) return { style: 'null', color };
  if (style === 2) return { style: 'hatch', color, hatch };
  return { style: 'solid', color };
}

/** Pen from a style word (low byte style, PS_ENDCAP_* 0x0F00, PS_JOIN_* 0xF000, PS_GEOMETRIC 0x10000). */
export function penOf(styleWord: number, width: number, color: string): Pen {
  const style = styleWord & 0x0f;
  const capBits = styleWord & 0x0f00, joinBits = styleWord & 0xf000;
  const geometric = (styleWord & 0x000f0000) === 0x00010000;
  return {
    style, width, color,
    cosmetic: !geometric && width <= 1,
    cap: capBits === 0x0100 ? 'square' : capBits === 0x0200 ? 'butt' : 'round',
    join: joinBits === 0x1000 ? 'bevel' : joinBits === 0x2000 ? 'miter' : 'round',
  };
}

const SERIF = /times|roman|georgia|garamond|baskerville|bodoni|book|cambria|century|palatino|serif|minion|caslon|elephant|rockwell|goudy|bell mt|perpetua/i;
const MONO = /courier|mono|consol|lucida console|fixed|typewriter/i;
const SYMBOL = /symbol|wingdings|webdings|dingbat|marlett/i;

/** A CSS font-family list for a GDI font (the face first, then a metric-compatible or generic fallback). */
export function fontCss(f: Font): string {
  const face = (f.face || '').replace(/["<>&]/g, '').trim();
  const fam = f.pitchFamily & 0xf0;
  const generic = MONO.test(face) || fam === 0x30 ? 'monospace' : SERIF.test(face) || fam === 0x10 ? 'serif' : fam === 0x40 ? 'cursive' : 'sans-serif';
  const alias: Record<string, string> = { arial: 'Arimo', helvetica: 'Arimo', 'times new roman': 'Tinos', 'courier new': 'Cousine', calibri: 'Carlito', cambria: 'Caladea', georgia: 'Gelasio' };
  const a = alias[face.toLowerCase()];
  const parts = [face && `'${face.replace(/'/g, '')}'`, a && `'${a}'`, SYMBOL.test(face) ? '' : generic].filter(Boolean);
  return parts.join(', ') || 'sans-serif';
}

/** Text decoder label for a LOGFONT character set. */
export function codePage(charset: number): string {
  const map: Record<number, string> = {
    0: 'windows-1252', 1: 'windows-1252', 2: 'windows-1252', 77: 'macintosh', 128: 'shift_jis', 129: 'euc-kr', 130: 'euc-kr', 134: 'gbk', 136: 'big5',
    161: 'windows-1253', 162: 'windows-1254', 163: 'windows-1258', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 204: 'windows-1251', 222: 'windows-874', 238: 'windows-1250', 255: 'ibm437',
  };
  return map[charset] || 'windows-1252';
}

const decoders = new Map<string, TextDecoder>();
/** Windows-1252's 0x80–0x9F (some decoders treat the label as ISO-8859-1 and keep C1 controls). */
const CP1252_HIGH = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
/** 8-bit text in a font's character set. Symbol fonts keep their byte values (U+0020–U+00FF). */
export function decodeText(bytes: Uint8Array, charset: number): string {
  if (charset === 2) return String.fromCharCode(...bytes);
  const label = codePage(charset);
  if (label === 'windows-1252') { let s = ''; for (const b of bytes) s += String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : b); return s; }
  let d = decoders.get(label);
  if (!d) { try { d = new TextDecoder(label); } catch { d = new TextDecoder('windows-1252'); } decoders.set(label, d); }
  return d.decode(bytes);
}

/** An SVG pattern for a hatched brush, cell `size` device units, with an optional background. */
export function hatchPattern(id: string, hatch: number, color: string, bk: string | null, size: number): string {
  const s = Math.max(size, 1e-6), sw = s / 8;
  const lines: Record<number, string> = {
    0: `M0 ${s / 2}H${s}`,
    1: `M${s / 2} 0V${s}`,
    2: `M0 0L${s} ${s}M${-s / 2} ${s / 2}L${s / 2} ${s * 1.5}M${s / 2} ${-s / 2}L${s * 1.5} ${s / 2}`,
    3: `M0 ${s}L${s} 0M${-s / 2} ${s / 2}L${s / 2} ${-s / 2}M${s / 2} ${s * 1.5}L${s * 1.5} ${s / 2}`,
    4: `M0 ${s / 2}H${s}M${s / 2} 0V${s}`,
    5: `M0 0L${s} ${s}M0 ${s}L${s} 0`,
  };
  const bg = bk ? `<rect width="${s}" height="${s}" fill="${bk}"/>` : '';
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}">${bg}<path d="${lines[hatch] ?? lines[0]}" stroke="${color}" stroke-width="${sw}" fill="none"/></pattern>`;
}

/** LOGFONT (16-bit fields): height, width, escapement, orientation, weight, then bytes and the face name. */
export function readLogFont(d: Uint8Array, a: number, end: number, wide = false): Font {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const i = (o: number) => (wide ? (o + 4 <= d.length ? dv.getInt32(o, true) : 0) : o + 2 <= d.length ? dv.getInt16(o, true) : 0);
  const step = wide ? 4 : 2;
  const b = a + 5 * step;
  const charset = d[b + 3] ?? 0;
  let face = '';
  if (wide) { for (let o = b + 8; o + 1 < Math.min(end, b + 8 + 64); o += 2) { const c = d[o] | (d[o + 1] << 8); if (!c) break; face += String.fromCharCode(c); } }
  else { let e = b + 8; while (e < Math.min(end, b + 40) && d[e]) e++; face = decodeText(d.subarray(b + 8, e), charset === 2 ? 0 : charset); }
  return {
    height: i(a), width: Math.abs(i(a + step)), escapement: i(a + 2 * step), weight: i(a + 4 * step) || 400,
    italic: !!d[b], underline: !!d[b + 1], strike: !!d[b + 2], charset, pitchFamily: d[b + 7] ?? 0, face: face.trim(),
  };
}


/** What a raster operation does to the picture we can draw. */
export function ropKind(rop: number): { kind: 'copy' | 'fill' | 'black' | 'white' | 'skip'; blend?: string } {
  switch (rop >>> 16) {
    case 0x00: return { kind: 'black' };
    case 0xff: return { kind: 'white' };
    case 0xf0: return { kind: 'fill' }; // PATCOPY
    case 0x5a: return { kind: 'fill', blend: 'difference' }; // PATINVERT
    case 0xfb: return { kind: 'fill' }; // PATPAINT, approximated
    case 0xaa: case 0x55: return { kind: 'skip' }; // destination only (no-op, invert)
    case 0xcc: return { kind: 'copy' }; // SRCCOPY
    case 0x88: return { kind: 'copy', blend: 'multiply' }; // SRCAND
    case 0xee: return { kind: 'copy', blend: 'lighten' }; // SRCPAINT
    case 0x66: return { kind: 'copy', blend: 'difference' }; // SRCINVERT
    case 0x44: case 0x33: case 0x11: case 0xbb: case 0xc0: return { kind: 'copy' };
    default: return { kind: 'copy' };
  }
}


export interface MetafileHints {
  /** Logical bounds of the picture (a BLIP header's) when the file itself has no placeable header. */
  bounds?: { left: number; top: number; right: number; bottom: number };
  /** Size of the picture in points. */
  sizePt?: { w: number; h: number };
}
