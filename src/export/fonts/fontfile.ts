/**
 * Font files people add themselves: identification and metadata for .ttf, .otf, .ttc, .woff and
 * .woff2. TrueType, CFF-based OpenType and WOFF files are parsed (WOFF is inflated to an sfnt first);
 * a TrueType collection gives its first face. WOFF2 needs Brotli, which is not available offline, so
 * its family, weight and style come from the file name and it can be shown but not embedded in PDF.
 */
import { woffToSfnt, buildSfnt, type SfntTable } from './woff';
import { TrueTypeFont } from './truetype';

export type FontFormat = 'ttf' | 'otf' | 'ttc' | 'woff' | 'woff2';

export interface ParsedFontFile {
  format: FontFormat;
  /** TrueType or CFF-based OpenType bytes (the first face of a collection), when the format allows parsing. */
  sfnt?: Uint8Array;
  font?: TrueTypeFont;
  family: string;
  subfamily: string;
  psName: string;
  weight: number;
  style: 'normal' | 'italic';
  fsType: number;
  embeddable: boolean;
  cff: boolean;
}

const tag4 = (b: Uint8Array, o = 0) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** The format of a font file from its first bytes, or null. */
export function fontFormatOf(bytes: Uint8Array, fileName = ''): FontFormat | null {
  if (bytes.length < 12) return null;
  const t = tag4(bytes);
  if (t === 'wOFF') return 'woff';
  if (t === 'wOF2') return 'woff2';
  if (t === 'ttcf') return 'ttc';
  if (t === 'OTTO') return 'otf';
  if (t === 'true' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return 'ttf';
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return ext === 'ttf' || ext === 'otf' || ext === 'ttc' || ext === 'woff' || ext === 'woff2' ? (ext as FontFormat) : null;
}

/** Rebuilds the first face of a TrueType collection as a standalone sfnt. */
export function firstFaceOfCollection(bytes: Uint8Array): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numFonts = dv.getUint32(8);
  if (!numFonts) throw new Error('The collection has no fonts');
  const off = dv.getUint32(12);
  const flavor = dv.getUint32(off);
  const numTables = dv.getUint16(off + 4);
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = off + 12 + i * 16;
    const tag = tag4(bytes, o);
    const to = dv.getUint32(o + 8), len = dv.getUint32(o + 12);
    tables.push({ tag, data: bytes.slice(to, Math.min(bytes.length, to + len)) });
  }
  return buildSfnt(tables, flavor);
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/\b(thin|hairline)\b/i, 100], [/\b(extra[- ]?light|ultra[- ]?light)\b/i, 200], [/\blight\b/i, 300], [/\b(regular|normal|book|roman)\b/i, 400],
  [/\bmedium\b/i, 500], [/\b(semi[- ]?bold|demi[- ]?bold)\b/i, 600], [/\b(extra[- ]?bold|ultra[- ]?bold)\b/i, 800], [/\b(black|heavy)\b/i, 900], [/\bbold\b/i, 700],
];

/** Weight and style guessed from a style name or a file name ("MyFont-BoldItalic"). */
export function styleFromName(name: string): { weight: number; style: 'normal' | 'italic' } {
  const n = name.replace(/\.[a-z0-9]+$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  let weight = 400;
  for (const [re, w] of WEIGHT_WORDS) if (re.test(n)) { weight = w; break; }
  return { weight, style: /\b(italic|oblique|slanted)\b/i.test(n) ? 'italic' : 'normal' };
}

/** Family name guessed from a file name ("MyFont-BoldItalic.woff2" → "My Font"). */
export function familyFromName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '');
  const head = base.split(/[-_]/)[0] || base;
  return head.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s*\b(regular|bold|italic|oblique|light|medium|black|thin|semibold|demibold|extrabold|heavy)\b\s*/gi, ' ').replace(/\s+/g, ' ').trim() || 'Font';
}

/** Parses a font file. Throws when the bytes are not a font. */
export async function parseFontFile(bytes: Uint8Array, fileName = ''): Promise<ParsedFontFile> {
  const format = fontFormatOf(bytes, fileName);
  if (!format) throw new Error('This file is not a TrueType, OpenType, WOFF or WOFF2 font.');
  if (format === 'woff2') {
    const { weight, style } = styleFromName(fileName);
    return { format, family: familyFromName(fileName), subfamily: `${weight === 400 ? 'Regular' : weight}${style === 'italic' ? ' Italic' : ''}`, psName: familyFromName(fileName).replace(/\s+/g, ''), weight, style, fsType: 0, embeddable: false, cff: false };
  }
  let sfnt: Uint8Array;
  if (format === 'woff') sfnt = await woffToSfnt(bytes);
  else if (format === 'ttc') sfnt = firstFaceOfCollection(bytes);
  else sfnt = bytes.slice();
  const font = new TrueTypeFont(sfnt);
  const fromName = styleFromName(font.subfamily);
  const weight = font.weightClass && font.weightClass !== 400 ? font.weightClass : fromName.weight;
  const style: 'normal' | 'italic' = font.italic || fromName.style === 'italic' ? 'italic' : 'normal';
  return { format, sfnt, font, family: font.family, subfamily: font.subfamily, psName: font.psName, weight, style, fsType: font.fsType, embeddable: font.embeddable, cff: font.cff };
}
