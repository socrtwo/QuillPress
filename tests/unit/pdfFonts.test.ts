import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Pub } from '../../src/model/pub';
import { woffTables, woffToSfnt, buildSfnt, tableChecksum } from '../../src/export/fonts/woff';
import { TrueTypeFont } from '../../src/export/fonts/truetype';
import { PdfFonts, bundledFamily } from '../../src/export/fonts/embed';
import { WOFF_SOURCES } from '../../src/export/fonts/sources';
import { pubToPdf, lastPdfWarnings } from '../../src/export/pdf';

/** Reads a bundled WOFF from node_modules by the file name in its URL (vitest cannot fetch). */
const fontLoader = async (url: string): Promise<Uint8Array> => {
  const file = basename(url.split('?')[0]);
  const pkg = file.split(/-(?:latin|cyrillic|greek)-/)[0];
  return new Uint8Array(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`));
};

const tinos = () => fontLoader(WOFF_SOURCES.find((s) => s.family === 'Tinos' && s.weight === 400 && s.style === 'normal')!.url);

function pubWithFonts(): Pub {
  const p = Pub.blank();
  const page = p.pages[0];
  const frame = (y: number, font: string, text: string, extra: any = {}) => page.items.push(p.newTextFrame({ x: 36, y, w: 400, h: 40 }, [{ style: 'Body', runs: [{ text, font, size: 14, ...extra }] }]));
  frame(40, 'Tinos', 'Hello, Wörld — Tinos “quoted” €');
  frame(90, 'Arimo', 'Arimo bold italic', { b: true, i: true });
  frame(140, 'Arial', 'Arial becomes Arimo');
  frame(190, 'Calibri', 'Calibri becomes Carlito; small caps', { caps: 'small' });
  frame(240, 'Wingdings', 'Not bundled: the screen fallback face');
  frame(290, 'Tinos', 'Missing glyphs fall back: 漢字 and ✓', { spc: 0.5 });
  return p;
}

describe('WOFF to TrueType', () => {
  it('rebuilds a bundled font as an sfnt with its tables', async () => {
    const woff = await tinos();
    const { tables } = await woffTables(woff);
    const tags = tables.map((t) => t.tag);
    for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf']) expect(tags).toContain(t);
    const sfnt = await woffToSfnt(woff);
    expect(sfnt.length).toBeGreaterThan(woff.length);
    const dv = new DataView(sfnt.buffer);
    expect(dv.getUint32(0)).toBe(0x00010000);
    // The whole-font checksum adjustment makes the font sum to 0xB1B0AFBA.
    expect(tableChecksum(sfnt)).toBe(0xb1b0afba);
    const font = new TrueTypeFont(sfnt);
    expect(font.numGlyphs).toBeGreaterThan(100);
    expect(font.unitsPerEm).toBeGreaterThan(0);
    expect(font.glyphFor('A'.codePointAt(0)!)).toBeGreaterThan(0);
    expect(font.glyphFor('é'.codePointAt(0)!)).toBeGreaterThan(0);
    expect(font.glyphFor(0x6f22)).toBe(0); // 漢 is not in the latin subset
    expect(font.advance(font.glyphFor(0x41))).toBeGreaterThan(0);
    expect(font.psName).toMatch(/Tinos/);
    expect(font.ascent).toBeGreaterThan(0);
    expect(font.descent).toBeLessThan(0);
  });

  it('subsets to the glyphs used and parses again', async () => {
    const font = new TrueTypeFont(await woffToSfnt(await tinos()));
    const gids = [...'Hello, Wörld'].map((c) => font.glyphFor(c.codePointAt(0)!));
    expect(gids.every((g) => g > 0)).toBe(true);
    const sub = font.subset(gids);
    expect(sub.length).toBeLessThan(font.bytes.length);
    const again = new TrueTypeFont(sub);
    expect(again.numGlyphs).toBe(font.numGlyphs);
    expect(again.indexToLocFormat).toBe(1);
    for (const g of gids) {
      // Glyphs are kept byte for byte; the subset pads each one to four bytes.
      const a = font.glyphData(g), b = again.glyphData(g);
      expect(b.length, `glyph ${g}`).toBeGreaterThanOrEqual(a.length);
      expect(b.length - a.length, `glyph ${g} padding`).toBeLessThan(4);
      expect([...b.subarray(0, a.length)]).toEqual([...a]);
    }
    const unused = font.glyphFor('Z'.codePointAt(0)!);
    expect(unused).toBeGreaterThan(0);
    expect(again.glyphData(unused).length).toBe(0);
    expect(again.advance(gids[0])).toBe(font.advance(gids[0]));
    expect(again.table('post')!.length).toBe(32);
    expect(again.table('cmap')).toBeUndefined();
  });

  it('writes an sfnt directory in tag order with correct checksums', () => {
    const a = new Uint8Array([1, 2, 3]), b = new Uint8Array([4, 5, 6, 7, 8]);
    const out = buildSfnt([{ tag: 'zzzz', data: b }, { tag: 'aaaa', data: a }]);
    const dv = new DataView(out.buffer);
    expect(dv.getUint16(4)).toBe(2);
    expect(String.fromCharCode(out[12], out[13], out[14], out[15])).toBe('aaaa');
    expect(dv.getUint32(16)).toBe(tableChecksum(a));
    expect(dv.getUint32(24)).toBe(3);
  });
});

describe('embedded fonts in PDF export', () => {
  it('resolves bundled families and aliases', () => {
    expect(bundledFamily('Tinos')).toBe('Tinos');
    expect(bundledFamily('Times New Roman')).toBe('Tinos');
    expect(bundledFamily('arial')).toBe('Arimo');
    expect(bundledFamily('Calibri')).toBe('Carlito');
    expect(bundledFamily('Aptos Display')).toBe('Carlito');
    expect(bundledFamily('Wingdings')).toBeNull();
    expect(bundledFamily(undefined)).toBeNull();
  });

  it('encodes text as glyph ids with fallbacks for missing characters', async () => {
    const fonts = new PdfFonts(fontLoader);
    const face = (await fonts.face('Times New Roman', true, false))!;
    expect(face.family).toBe('Tinos');
    expect(face.weight).toBe(700);
    expect(face.synthBold).toBe(false);
    const pieces = fonts.encode(face, 'Ab 漢c', 12, 0);
    expect(pieces.map((p) => ('hex' in p ? 'hex' : 'fb'))).toEqual(['hex', 'fb', 'hex']);
    const first = pieces[0] as { hex: string; width: number };
    expect(first.hex).toHaveLength(12); // three glyphs × 4 hex digits
    expect(first.width).toBeGreaterThan(10);
    expect((pieces[1] as any).fallback).toBe('漢');
    expect(face.used.size).toBe(4);
  });

  it('embeds subsets with ToUnicode and keeps standard fonts for the rest', async () => {
    const p = pubWithFonts();
    const warnings: string[] = [];
    const pdf = await pubToPdf(p, { fontLoader, onWarning: (m) => warnings.push(m) });
    const s = new TextDecoder('latin1').decode(pdf);
    expect(s).toContain('/Subtype /Type0');
    expect(s).toContain('/Subtype /CIDFontType2');
    expect(s).toContain('/FontFile2');
    expect(s).toContain('/Encoding /Identity-H');
    expect(s).toContain('/CIDToGIDMap /Identity');
    expect(s).toMatch(/\/BaseFont \/[A-Z]{6}\+Tinos/);
    expect(s).toMatch(/\/BaseFont \/[A-Z]{6}\+Arimo-BoldItalic/);
    expect(s).toMatch(/\/BaseFont \/[A-Z]{6}\+Carlito/);
    expect(s).toContain('beginbfchar');
    expect(s).toContain('/Length1');
    // Wingdings is not bundled: printed in Carlito, the face the screen falls back to, with a warning;
    // glyphs no bundled face has (CJK, check mark) use Times for that piece only and are counted.
    expect(s).not.toContain('/BaseFont /Helvetica');
    expect(s).toContain('/BaseFont /Times-Roman');
    expect(s).toMatch(/<[0-9a-f]{8,}> Tj/);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Wingdings is not available to the PDF writer; its text is printed in Carlito/);
    expect(lastPdfWarnings()).toEqual([warnings[0], '3 characters had no glyph in the embedded fonts and print as "?" in the PDF.']);
    // Every indirect reference resolves and the cross-reference table counts every object.
    const objs = new Set([...s.matchAll(/(\d+) 0 obj/g)].map((m) => +m[1]));
    for (const m of s.matchAll(/(\d+) 0 R/g)) expect(objs.has(+m[1]), `object ${m[1]}`).toBe(true);
    expect(s).toContain(`xref\n0 ${objs.size + 1}\n`);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    // Fonts are counted once per face, not once per run.
    expect((s.match(/\/Subtype \/Type0/g) || []).length).toBe(4); // Tinos, Arimo bold italic, Arimo, Carlito
  });

  it('can be switched off, and reports fonts that fail to load', async () => {
    const p = pubWithFonts();
    const off = new TextDecoder('latin1').decode(await pubToPdf(p, { embedFonts: false, fontLoader }));
    expect(off).not.toContain('/Type0');
    expect(off).toContain('/BaseFont /Times-Roman');
    const warnings: string[] = [];
    const broken = new TextDecoder('latin1').decode(await pubToPdf(p, { fontLoader: async () => { throw new Error('offline'); }, onWarning: (m) => warnings.push(m) }));
    expect(broken).not.toContain('/Type0');
    expect(warnings.join(' ')).toMatch(/Tinos.*offline/);
    expect(lastPdfWarnings().length).toBeGreaterThan(0);
  });
});
