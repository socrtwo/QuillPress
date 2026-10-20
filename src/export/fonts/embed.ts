/**
 * Font embedding for the PDF writer. Each face the publication uses (family × weight × style) becomes
 * a Type0 font with an Identity-H encoding: the user's own fonts first (TrueType outlines as a subset
 * in a CIDFontType2 / FontFile2, CFF-based OpenType whole in a CIDFontType0 / FontFile3), then the
 * bundled WOFF faces as TrueType subsets. A ToUnicode map keeps text searchable and copyable. Families
 * that are neither fall back to the standard 14 fonts in the writer; aliases (Arial → Arimo, Times
 * New Roman → Tinos, Calibri → Carlito…) use the metric-compatible bundled face, as the screen does.
 * Fonts whose license bits forbid embedding (OS/2 fsType "Restricted License") and WOFF2 files, which
 * cannot be converted offline, fall back too, with a warning.
 */
import { FACES, userFaces, userFontBytes, type UserFont } from '../../fonts';
import { woffSource } from './sources';
import { woffToSfnt } from './woff';
import { TrueTypeFont } from './truetype';

export type FontLoader = (url: string) => Promise<Uint8Array>;

export interface EmbeddedFace {
  key: string;
  family: string;
  weight: 400 | 700;
  style: 'normal' | 'italic';
  font: TrueTypeFont;
  /** The requested weight or style is not bundled: the writer synthesizes it. */
  synthBold: boolean;
  synthItalic: boolean;
  /** Glyph ids used so far, with the first code point seen for each (for ToUnicode). */
  used: Map<number, number>;
  /** A user-supplied font (its id), embedded from the registry's bytes. */
  user?: UserFont;
  /** PDF object number of the Type0 font once reserved, and its resource name. */
  obj: number;
  res: string;
}

/** A piece of a text segment: glyphs of the embedded face, or characters the face lacks (for a fallback font). */
export type TextPiece = { hex: string; width: number; size: number } | { fallback: string; width: number; size: number };

export interface FontWriter {
  reserve(): number;
  add(body: string): number;
  set(num: number, body: string): void;
  stream(dict: string, data: Uint8Array): number;
}

const SERIF = /^(Tinos|Caladea|Gelasio|EB Garamond|Libre Baskerville|Merriweather)$/;
const MONO = /^(Cousine|Courier Prime)$/;

/** Bundled family for a font name: the family itself or an alias (metric-compatible face). */
export function bundledFamily(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (!n) return null;
  if (/^aptos/.test(n)) return 'Carlito';
  for (const [fam, aliases] of FACES) {
    if (fam.toLowerCase() === n) return fam;
    if (aliases.some((a) => a.toLowerCase() === n)) return fam;
  }
  return null;
}

/** Parsed fonts per loader (the app's default loader shares one cache across exports). */
const caches = new WeakMap<FontLoader, Map<string, Promise<TrueTypeFont>>>();

async function defaultLoader(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

function loadFont(url: string, loader: FontLoader): Promise<TrueTypeFont> {
  let cache = caches.get(loader);
  if (!cache) { cache = new Map(); caches.set(loader, cache); }
  let p = cache.get(url);
  if (!p) {
    p = loader(url).then(woffToSfnt).then((sfnt) => new TrueTypeFont(sfnt));
    p.catch(() => cache!.delete(url));
    cache.set(url, p);
  }
  return p;
}

let subsetSeq = 0;
function subsetTag(): string {
  // Six uppercase letters, unique within a document (and across documents in a session).
  let n = (subsetSeq++ + Date.now()) % 308915776;
  let s = '';
  for (let i = 0; i < 6; i++) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

export class PdfFonts {
  private faces = new Map<string, Promise<EmbeddedFace | null>>();
  private warned = new Set<string>();
  readonly warnings: string[] = [];

  constructor(private loader: FontLoader = defaultLoader, private onWarning?: (msg: string) => void) {}

  /** The embedded face for a font name and style, or null when the family is neither the user's nor bundled, or failed to load. */
  face(name: string | undefined, bold?: boolean, italic?: boolean): Promise<EmbeddedFace | null> {
    const mine = userFaces(name);
    if (mine.length) {
      const key = `user:${mine[0].family}|${bold ? 700 : 400}|${italic ? 'italic' : 'normal'}`;
      let p = this.faces.get(key);
      if (!p) { p = this.loadUser(mine, bold ? 700 : 400, italic ? 'italic' : 'normal', key); this.faces.set(key, p); }
      return p;
    }
    const family = bundledFamily(name);
    if (!family) return Promise.resolve(null);
    const key = `${family}|${bold ? 700 : 400}|${italic ? 'italic' : 'normal'}`;
    let p = this.faces.get(key);
    if (!p) {
      p = this.load(family, bold ? 700 : 400, italic ? 'italic' : 'normal', key);
      this.faces.set(key, p);
    }
    return p;
  }

  /** Picks the user's face closest to the requested weight and style; synthesizes bold or italic when the family lacks them. */
  private async loadUser(faces: UserFont[], weight: 400 | 700, style: 'normal' | 'italic', key: string): Promise<EmbeddedFace | null> {
    const family = faces[0].family;
    const score = (f: UserFont) => Math.abs(f.weight - weight) + (f.style === style ? 0 : 1000);
    const sorted = [...faces].sort((a, b) => score(a) - score(b));
    const chosen = sorted[0];
    if (chosen.format === 'woff2') { this.warn(`${family}: WOFF2 fonts cannot be embedded in PDF (no converter offline); text set in it uses a standard font. Add the TrueType or OpenType file to embed it.`); return null; }
    if (!chosen.embeddable) { this.warn(`${family}: the font's license bits forbid embedding; text set in it uses a standard font.`); return null; }
    const bytes = userFontBytes(chosen.id);
    if (!bytes) return null;
    try {
      let p = this.userCache.get(chosen.id);
      if (!p) {
        p = (async () => {
          const { parseFontFile } = await import('./fontfile');
          const parsed = await parseFontFile(bytes, chosen.file);
          if (!parsed.font) throw new Error('not parsable');
          return parsed.font;
        })();
        this.userCache.set(chosen.id, p);
      }
      const font = await p;
      const synthBold = weight >= 700 && chosen.weight < 600;
      const synthItalic = style === 'italic' && chosen.style !== 'italic';
      return { key, family, weight, style, font, synthBold, synthItalic, used: new Map(), obj: 0, res: '', user: chosen };
    } catch (e: any) {
      this.warn(`${family}: the font file could not be read (${e?.message || e}); text set in it uses a standard font.`);
      return null;
    }
  }
  private userCache = new Map<string, Promise<TrueTypeFont>>();

  private async load(family: string, weight: 400 | 700, style: 'normal' | 'italic', key: string): Promise<EmbeddedFace | null> {
    let src = woffSource(family, weight, style);
    let synthBold = false, synthItalic = false;
    if (!src && weight === 700) { src = woffSource(family, 400, style); synthBold = !!src; }
    if (!src && style === 'italic') { src = woffSource(family, weight, 'normal'); synthItalic = !!src; }
    if (!src && weight === 700 && style === 'italic') { src = woffSource(family, 400, 'normal'); synthBold = synthItalic = !!src; }
    if (!src) return null;
    try {
      const font = await loadFont(src.url, this.loader);
      return { key, family, weight, style, font, synthBold, synthItalic, used: new Map(), obj: 0, res: '' };
    } catch (e: any) {
      this.warn(`${family}: the font file could not be loaded (${e?.message || e}); text set in it uses a standard font.`);
      return null;
    }
  }

  private warn(msg: string): void {
    if (this.warned.has(msg)) return;
    this.warned.add(msg);
    this.warnings.push(msg);
    this.onWarning?.(msg);
  }

  /**
   * Encodes text for a face: glyph-id hex strings for the characters it has, fallback runs for the
   * rest. Widths are in points at `size`, including tracking (`spc`).
   */
  encode(face: EmbeddedFace, text: string, size: number, spc = 0): TextPiece[] {
    const out: TextPiece[] = [];
    const f = face.font;
    let hex = '', width = 0, fb = '', fbw = 0;
    const flushHex = () => { if (hex) { out.push({ hex, width, size }); hex = ''; width = 0; } };
    const flushFb = () => { if (fb) { out.push({ fallback: fb, width: fbw, size }); fb = ''; fbw = 0; } };
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const gid = f.glyphFor(cp);
      if (gid || cp === 0x20 || cp === 0xa0) {
        flushFb();
        const g = gid || f.glyphFor(0x20);
        if (!face.used.has(g)) face.used.set(g, cp);
        hex += g.toString(16).padStart(4, '0');
        width += (f.advance(g) / f.unitsPerEm) * size + spc;
      } else if (cp < 0x20) {
        continue;
      } else {
        flushHex();
        fb += ch;
        // The fallback piece is measured by the writer with its standard font; keep tracking here.
        fbw += spc;
      }
    }
    flushHex(); flushFb();
    return out;
  }

  /** Writes the font objects of every used face; returns the warnings collected. */
  async finish(w: FontWriter, deflate: (data: Uint8Array) => Promise<{ data: Uint8Array; filter: string }>): Promise<void> {
    for (const p of this.faces.values()) {
      const face = await p;
      if (!face || !face.obj) continue;
      const f = face.font;
      const gids = [...face.used.keys()].sort((a, b) => a - b);
      const scale = 1000 / f.unitsPerEm;
      let fileRef: string;
      let name: string;
      if (f.cff) {
        // CFF outlines: the whole CFF table as a CIDFontType0C program (CIDs select glyphs directly when the CFF is not CID-keyed).
        const cffTable = f.table('CFF ');
        if (!cffTable) continue;
        const z = await deflate(cffTable.slice());
        const file = w.stream(`/Subtype /CIDFontType0C${z.filter}`, z.data);
        fileRef = `/FontFile3 ${file} 0 R`;
        name = (f.psName || face.family.replace(/\s+/g, '')).replace(/[^A-Za-z0-9+_.-]/g, '');
      } else {
        const subset = f.subset(gids);
        const z = await deflate(subset);
        const file = w.stream(`/Length1 ${subset.length}${z.filter}`, z.data);
        fileRef = `/FontFile2 ${file} 0 R`;
        name = `${subsetTag()}+${(f.psName || face.family.replace(/\s+/g, '')).replace(/[^A-Za-z0-9+_.-]/g, '')}`;
      }
      let flags = 32; // Nonsymbolic
      if (f.fixedPitch || MONO.test(face.family)) flags |= 1;
      if (SERIF.test(face.family) || (face.user && /serif|roman|garamond|baskerville|georgia|times|book/i.test(face.family) && !/sans/i.test(face.family))) flags |= 2;
      if (face.style === 'italic' || f.italicAngle) flags |= 64;
      if (face.weight >= 700) flags |= 1 << 18;
      const bbox = [f.bbox.xMin, f.bbox.yMin, f.bbox.xMax, f.bbox.yMax].map((v) => Math.round(v * scale));
      const desc = w.add(`<< /Type /FontDescriptor /FontName /${name} /Flags ${flags} /FontBBox [${bbox.join(' ')}] /ItalicAngle ${face.synthItalic ? -12 : f.italicAngle} /Ascent ${Math.round(f.ascent * scale)} /Descent ${Math.round(f.descent * scale)} /CapHeight ${Math.round(f.capHeight * scale)} /XHeight ${Math.round(f.xHeight * scale)} /StemV ${face.weight >= 700 ? 120 : 80} ${fileRef} >>`);
      // Widths: runs of consecutive glyph ids.
      const wParts: string[] = [];
      for (let i = 0; i < gids.length;) {
        let j = i;
        const ws: number[] = [];
        while (j < gids.length && gids[j] === gids[i] + (j - i)) { ws.push(f.width1000(gids[j])); j++; }
        wParts.push(`${gids[i]} [${ws.join(' ')}]`);
        i = j;
      }
      const cid = w.add(`<< /Type /Font /Subtype /${f.cff ? 'CIDFontType0' : 'CIDFontType2'} /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW ${f.width1000(f.glyphFor(0x20)) || 500} /W [${wParts.join(' ')}]${f.cff ? '' : ' /CIDToGIDMap /Identity'} >>`);
      const toUni = this.toUnicode(face);
      const tu = w.stream('', new TextEncoder().encode(toUni));
      w.set(face.obj, `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
    }
  }

  private toUnicode(face: EmbeddedFace): string {
    const entries = [...face.used.entries()].sort((a, b) => a[0] - b[0]);
    const lines: string[] = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      lines.push(`${chunk.length} beginbfchar`);
      for (const [gid, cp] of chunk) {
        let u: string;
        if (cp > 0xffff) { const v = cp - 0x10000; u = (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'); } else u = cp.toString(16).padStart(4, '0');
        lines.push(`<${gid.toString(16).padStart(4, '0')}> <${u}>`);
      }
      lines.push('endbfchar');
    }
    lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
    return lines.join('\n');
  }
}
