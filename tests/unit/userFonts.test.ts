import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import JSZip from 'jszip';
import { Pub } from '../../src/model/pub';
import { buildSfnt, type SfntTable } from '../../src/export/fonts/woff';
import { TrueTypeFont } from '../../src/export/fonts/truetype';
import { parseFontFile, fontFormatOf, firstFaceOfCollection, styleFromName, familyFromName } from '../../src/export/fonts/fontfile';
import { WOFF_SOURCES } from '../../src/export/fonts/sources';
import { PdfFonts } from '../../src/export/fonts/embed';
import { pubToPdf, lastPdfWarnings } from '../../src/export/pdf';
import { addUserFont, userFonts, userFont, removeUserFont, allFontFamilies, userFontFamilies, isUserFamily, userFaces, userFontsFor, resetUserFonts, setPackageFonts, registerPackagedFonts, onPackagedFonts } from '../../src/fonts';
import { exportQpp, importQpp, fontsToPackage } from '../../src/io/qpp';

/** Reads a bundled WOFF from node_modules by the file name in its URL (vitest cannot fetch). */
const fontLoader = async (url: string): Promise<Uint8Array> => {
  const file = basename(url.split('?')[0]);
  const pkg = file.split('-latin-')[0];
  return new Uint8Array(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`));
};
const bundled = (family: string, weight: number, style: string) => fontLoader(WOFF_SOURCES.find((s) => s.family === family && s.weight === weight && s.style === style)!.url);

// ------------------------------------------------------------------------------------------
// A synthetic CFF-flavored OpenType font: three glyphs (.notdef, A, B), with name, OS/2 and post tables.

const be16 = (dv: DataView, o: number, v: number) => dv.setUint16(o, v & 0xffff);
const utf16 = (s: string) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) >> 8; b[i * 2 + 1] = s.charCodeAt(i) & 0xff; } return b; };

function nameTable(names: Record<number, string>): Uint8Array {
  const ids = Object.keys(names).map(Number).sort((a, b) => a - b);
  const strings = ids.map((id) => utf16(names[id]));
  const strOff = 6 + ids.length * 12;
  const total = strOff + strings.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  be16(dv, 0, 0); be16(dv, 2, ids.length); be16(dv, 4, strOff);
  let off = 0;
  ids.forEach((id, i) => {
    const o = 6 + i * 12;
    be16(dv, o, 3); be16(dv, o + 2, 1); be16(dv, o + 4, 0x409); be16(dv, o + 6, id); be16(dv, o + 8, strings[i].length); be16(dv, o + 10, off);
    out.set(strings[i], strOff + off); off += strings[i].length;
  });
  return out;
}

function cmapFormat4AB(): Uint8Array {
  // Two segments: 'A'..'B' → gids 1, 2 (delta = 1 - 0x41), and the 0xFFFF terminator.
  const segs = [[0x42, 0x41, (1 - 0x41) & 0xffff, 0], [0xffff, 0xffff, 1, 0]];
  const sub = new Uint8Array(16 + segs.length * 8);
  const dv = new DataView(sub.buffer);
  be16(dv, 0, 4); be16(dv, 2, sub.length); be16(dv, 4, 0); be16(dv, 6, segs.length * 2); be16(dv, 8, 4); be16(dv, 10, 1); be16(dv, 12, 0);
  const ends = 14, starts = ends + segs.length * 2 + 2, deltas = starts + segs.length * 2, ros = deltas + segs.length * 2;
  segs.forEach((s, i) => { be16(dv, ends + i * 2, s[0]); be16(dv, starts + i * 2, s[1]); be16(dv, deltas + i * 2, s[2]); be16(dv, ros + i * 2, s[3]); });
  const out = new Uint8Array(12 + sub.length);
  const od = new DataView(out.buffer);
  be16(od, 0, 0); be16(od, 2, 1); be16(od, 4, 3); be16(od, 6, 1); od.setUint32(8, 12);
  out.set(sub, 12);
  return out;
}

interface SynthOpts { family?: string; subfamily?: string; psName?: string; weight?: number; italic?: boolean; fsType?: number }

/** Builds an "OTTO" font whose CFF table is a placeholder (the writer embeds it whole without reading it). */
function syntheticOtf(o: SynthOpts = {}): Uint8Array {
  const family = o.family ?? 'Test Serif', subfamily = o.subfamily ?? 'Bold', weight = o.weight ?? 700;
  const head = new Uint8Array(54); const hd = new DataView(head.buffer);
  hd.setUint32(0, 0x00010000); hd.setUint32(12, 0x5f0f3cf5); be16(hd, 18, 1000); hd.setInt16(36, -50); hd.setInt16(38, -250); hd.setInt16(40, 950); hd.setInt16(42, 800); be16(hd, 44, o.italic ? 2 : 0); hd.setInt16(50, 0);
  const hhea = new Uint8Array(36); const hh = new DataView(hhea.buffer);
  hh.setUint32(0, 0x00010000); hh.setInt16(4, 800); hh.setInt16(6, -200); be16(hh, 34, 3);
  const maxp = new Uint8Array(6); const mp = new DataView(maxp.buffer); mp.setUint32(0, 0x00005000); be16(mp, 4, 3);
  const hmtx = new Uint8Array(12); const hm = new DataView(hmtx.buffer); be16(hm, 0, 500); be16(hm, 4, 600); be16(hm, 8, 700);
  const os2 = new Uint8Array(96); const os = new DataView(os2.buffer);
  be16(os, 0, 2); be16(os, 4, weight); be16(os, 8, o.fsType ?? 0); be16(os, 62, (o.italic ? 1 : 0) | (weight >= 700 ? 32 : 64)); os.setInt16(68, 800); os.setInt16(70, -200); os.setInt16(86, 480); os.setInt16(88, 690);
  const post = new Uint8Array(32); const ps = new DataView(post.buffer); ps.setUint32(0, 0x00030000); ps.setInt32(4, o.italic ? -12 * 65536 : 0);
  const cff = new Uint8Array([1, 0, 4, 1, 0, 1, 1, 1, 5, 84, 101, 115, 116, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const tables: SfntTable[] = [
    { tag: 'CFF ', data: cff }, { tag: 'head', data: head }, { tag: 'hhea', data: hhea }, { tag: 'hmtx', data: hmtx }, { tag: 'maxp', data: maxp },
    { tag: 'cmap', data: cmapFormat4AB() }, { tag: 'OS/2', data: os2 }, { tag: 'post', data: post },
    { tag: 'name', data: nameTable({ 1: family, 2: subfamily, 4: `${family} ${subfamily}`, 6: o.psName ?? `${family.replace(/\s+/g, '')}-${subfamily.replace(/\s+/g, '')}` }) },
  ];
  return buildSfnt(tables, 0x4f54544f);
}

/** Wraps fonts in a TrueType collection (each face keeps its own tables). */
function collection(fonts: Uint8Array[]): Uint8Array {
  const header = 12 + fonts.length * 4;
  let total = header;
  for (const f of fonts) total += Math.ceil(f.length / 4) * 4;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0); dv.setUint32(4, 0x00010000); dv.setUint32(8, fonts.length);
  let pos = header;
  fonts.forEach((f, i) => {
    dv.setUint32(12 + i * 4, pos);
    // Table offsets inside each face are relative to the face start; make them absolute.
    const face = f.slice();
    const fd = new DataView(face.buffer);
    const n = fd.getUint16(4);
    for (let t = 0; t < n; t++) fd.setUint32(12 + t * 16 + 8, fd.getUint32(12 + t * 16 + 8) + pos);
    out.set(face, pos);
    pos += Math.ceil(face.length / 4) * 4;
  });
  return out;
}

function pubWithFont(family: string, text = 'AB', extra: any = {}): Pub {
  const p = Pub.blank();
  p.pages[0].items.push(p.newTextFrame({ x: 36, y: 40, w: 400, h: 60 }, [{ style: 'Body', runs: [{ text, font: family, size: 14, ...extra }] }]));
  return p;
}

beforeEach(() => { resetUserFonts(); setPackageFonts(true); onPackagedFonts(null); });

// ------------------------------------------------------------------------------------------

describe('font file parsing', () => {
  it('reads family, weight, style and PostScript name from a bundled WOFF', async () => {
    const regular = await parseFontFile(await bundled('Tinos', 400, 'normal'), 'tinos-latin-400-normal.woff');
    expect(regular.format).toBe('woff');
    expect(regular.family).toBe('Tinos');
    expect(regular.weight).toBe(400);
    expect(regular.style).toBe('normal');
    expect(regular.psName).toMatch(/^Tinos/);
    expect(regular.embeddable).toBe(true);
    expect(regular.cff).toBe(false);
    expect(regular.sfnt!.length).toBeGreaterThan(0);
    const boldItalic = await parseFontFile(await bundled('Tinos', 700, 'italic'), 'tinos-latin-700-italic.woff');
    expect(boldItalic.weight).toBe(700);
    expect(boldItalic.style).toBe('italic');
    expect(boldItalic.subfamily).toMatch(/bold/i);
  });

  it('identifies formats from the first bytes and from the file name', () => {
    expect(fontFormatOf(syntheticOtf())).toBe('otf');
    expect(fontFormatOf(collection([syntheticOtf()]))).toBe('ttc');
    expect(fontFormatOf(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('woff2');
    expect(fontFormatOf(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('ttf');
    expect(fontFormatOf(new Uint8Array(12), 'x.woff2')).toBe('woff2');
    expect(fontFormatOf(new Uint8Array(12), 'x.txt')).toBeNull();
  });

  it('parses a CFF-based OpenType font (OTTO) for metadata and widths', async () => {
    const p = await parseFontFile(syntheticOtf(), 'TestSerif-Bold.otf');
    expect(p.format).toBe('otf');
    expect(p.cff).toBe(true);
    expect(p.family).toBe('Test Serif');
    expect(p.subfamily).toBe('Bold');
    expect(p.psName).toBe('TestSerif-Bold');
    expect(p.weight).toBe(700);
    expect(p.style).toBe('normal');
    expect(p.embeddable).toBe(true);
    const f = p.font!;
    expect(f.glyphFor(0x41)).toBe(1);
    expect(f.glyphFor(0x42)).toBe(2);
    expect(f.advance(1)).toBe(600);
    expect(f.width1000(2)).toBe(700);
    const it = await parseFontFile(syntheticOtf({ subfamily: 'Italic', weight: 400, italic: true }), 'x.otf');
    expect(it.style).toBe('italic');
    expect(it.weight).toBe(400);
  });

  it('reads the OS/2 embedding bits', async () => {
    expect((await parseFontFile(syntheticOtf({ fsType: 2 }), 'r.otf')).embeddable).toBe(false);
    expect((await parseFontFile(syntheticOtf({ fsType: 4 }), 'p.otf')).embeddable).toBe(true); // preview & print
    expect((await parseFontFile(syntheticOtf({ fsType: 8 }), 'e.otf')).embeddable).toBe(true); // editable
    expect((await parseFontFile(syntheticOtf({ fsType: 2 | 8 }), 'e.otf')).embeddable).toBe(true); // a higher permission wins
  });

  it('takes the first face of a collection', async () => {
    const ttc = collection([syntheticOtf({ family: 'First Face', subfamily: 'Regular', weight: 400 }), syntheticOtf({ family: 'Second Face' })]);
    const first = new TrueTypeFont(firstFaceOfCollection(ttc));
    expect(first.family).toBe('First Face');
    expect(first.glyphFor(0x41)).toBe(1);
    const p = await parseFontFile(ttc, 'faces.ttc');
    expect(p.format).toBe('ttc');
    expect(p.family).toBe('First Face');
    expect(p.weight).toBe(400);
  });

  it('describes a WOFF2 file from its name and marks it not embeddable', async () => {
    const bytes = new Uint8Array(40); bytes.set([0x77, 0x4f, 0x46, 0x32], 0);
    const p = await parseFontFile(bytes, 'MyFont-BoldItalic.woff2');
    expect(p.format).toBe('woff2');
    expect(p.family).toBe('My Font');
    expect(p.weight).toBe(700);
    expect(p.style).toBe('italic');
    expect(p.embeddable).toBe(false);
    expect(p.font).toBeUndefined();
    expect(styleFromName('Foo-SemiBold')).toEqual({ weight: 600, style: 'normal' });
    expect(styleFromName('Foo Light Oblique')).toEqual({ weight: 300, style: 'italic' });
    expect(familyFromName('/fonts/OpenSans-Regular.ttf')).toBe('Open Sans');
  });

  it('rejects files that are not fonts', async () => {
    await expect(parseFontFile(new TextEncoder().encode('hello world, not a font'), 'x.ttf')).rejects.toThrow();
  });
});

describe('user font registry', () => {
  it('adds, lists, resolves and removes fonts', async () => {
    const f = await addUserFont(syntheticOtf(), 'TestSerif-Bold.otf', { session: true });
    expect(f.family).toBe('Test Serif');
    expect(f.cff).toBe(true);
    expect(f.size).toBeGreaterThan(0);
    expect(userFonts().map((x) => x.id)).toEqual([f.id]);
    expect(userFont(f.id)?.psName).toBe('TestSerif-Bold');
    expect(isUserFamily('test serif')).toBe(true);
    expect(isUserFamily('Tinos')).toBe(false);
    expect(allFontFamilies()).toContain('Test Serif');
    expect(allFontFamilies()).toContain('Tinos');
    expect(userFontFamilies()).toEqual(['Test Serif']);
    expect(userFaces('Test Serif')).toHaveLength(1);
    expect(userFontsFor(['Test Serif', 'Tinos'])).toHaveLength(1);
    // The same family, weight and style replaces the earlier face.
    const again = await addUserFont(syntheticOtf({ psName: 'TestSerif-Bold2' }), 'TestSerif-Bold2.otf', { session: true });
    expect(userFonts()).toHaveLength(1);
    expect(userFonts()[0].psName).toBe('TestSerif-Bold2');
    await removeUserFont(again.id);
    expect(userFonts()).toHaveLength(0);
    expect(allFontFamilies()).not.toContain('Test Serif');
  });

  it('keeps a WOFF as an sfnt and reads its metadata', async () => {
    const f = await addUserFont(await bundled('Tinos', 400, 'normal'), 'tinos.woff', { session: true });
    expect(f.format).toBe('woff');
    expect(f.family).toBe('Tinos');
    expect(f.embeddable).toBe(true);
  });
});

describe('PDF export with user fonts', () => {
  it('embeds a CFF OpenType font whole as FontFile3 with a CIDFontType0 descendant', async () => {
    await addUserFont(syntheticOtf(), 'TestSerif-Bold.otf', { session: true });
    const warnings: string[] = [];
    const pdf = await pubToPdf(pubWithFont('Test Serif', 'AB', { b: true }), { fontLoader, onWarning: (m) => warnings.push(m) });
    const s = new TextDecoder('latin1').decode(pdf);
    expect(s).toContain('/FontFile3');
    expect(s).toContain('/Subtype /CIDFontType0C');
    expect(s).toContain('/Subtype /CIDFontType0 ');
    expect(s).toContain('/BaseFont /TestSerif-Bold');
    expect(s).toContain('/Encoding /Identity-H');
    expect(s).toContain('/W [1 [600 700]]');
    expect(s).not.toContain('/CIDToGIDMap');
    expect(warnings.filter((w) => /Test Serif/.test(w))).toHaveLength(0);
  });

  it('resolves the closest weight and style and synthesizes the rest', async () => {
    await addUserFont(syntheticOtf({ subfamily: 'Regular', weight: 400, psName: 'TestSerif-Regular' }), 'TestSerif-Regular.otf', { session: true });
    const fonts = new PdfFonts(fontLoader);
    const regular = await fonts.face('Test Serif', false, false);
    expect(regular?.user?.psName).toBe('TestSerif-Regular');
    expect(regular?.synthBold).toBe(false);
    const bold = await fonts.face('Test Serif', true, true);
    expect(bold?.user?.psName).toBe('TestSerif-Regular');
    expect(bold?.synthBold).toBe(true);
    expect(bold?.synthItalic).toBe(true);
    await addUserFont(syntheticOtf({ subfamily: 'Bold', weight: 700, psName: 'TestSerif-Bold' }), 'TestSerif-Bold.otf', { session: true });
    const fonts2 = new PdfFonts(fontLoader);
    const bold2 = await fonts2.face('Test Serif', true, false);
    expect(bold2?.user?.psName).toBe('TestSerif-Bold');
    expect(bold2?.synthBold).toBe(false);
  });

  it('embeds a user-supplied TrueType font (from WOFF) as a subset', async () => {
    const f = await addUserFont(await bundled('Tinos', 700, 'normal'), 'tinos-bold.woff', { session: true });
    expect(f.cff).toBeUndefined();
    const fonts = new PdfFonts(async () => { throw new Error('the registry has the bytes'); });
    const face = await fonts.face('Tinos', true, false);
    expect(face?.user?.id).toBe(f.id);
    expect(face?.font.glyphFor(0x41)).toBeGreaterThan(0);
    const pdf = new TextDecoder('latin1').decode(await pubToPdf(pubWithFont('Tinos', 'Hello', { b: true }), { fontLoader: async () => { throw new Error('offline'); } }));
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Tinos/);
  });

  it('skips fonts whose license forbids embedding and WOFF2 files, with a warning', async () => {
    await addUserFont(syntheticOtf({ family: 'Locked Serif', fsType: 2, psName: 'LockedSerif-Bold' }), 'LockedSerif-Bold.otf', { session: true });
    const w2 = new Uint8Array(40); w2.set([0x77, 0x4f, 0x46, 0x32], 0);
    await addUserFont(w2, 'WebOnly-Regular.woff2', { session: true });
    const p = pubWithFont('Locked Serif', 'AB', { b: true });
    p.pages[0].items.push(p.newTextFrame({ x: 36, y: 120, w: 400, h: 60 }, [{ style: 'Body', runs: [{ text: 'web only', font: 'Web Only', size: 14 }] }]));
    const warnings: string[] = [];
    const s = new TextDecoder('latin1').decode(await pubToPdf(p, { fontLoader, onWarning: (m) => warnings.push(m) }));
    expect(s).not.toContain('/FontFile3');
    expect(s).not.toContain('LockedSerif');
    expect(warnings.some((w) => /Locked Serif/.test(w) && /license/i.test(w))).toBe(true);
    expect(warnings.some((w) => /Web Only/.test(w) && /WOFF2/.test(w))).toBe(true);
    expect(lastPdfWarnings().some((w) => /Locked Serif/.test(w))).toBe(true);
  });
});

describe('fonts packaged in .qpp', () => {
  it('writes the used, embeddable user fonts under fonts/ with an index and registers them on open', async () => {
    const used = await addUserFont(syntheticOtf(), 'TestSerif-Bold.otf', { session: true });
    await addUserFont(syntheticOtf({ family: 'Unused Sans', psName: 'UnusedSans-Bold' }), 'UnusedSans-Bold.otf', { session: true });
    await addUserFont(syntheticOtf({ family: 'Locked Serif', fsType: 2, psName: 'LockedSerif-Bold' }), 'LockedSerif-Bold.otf', { session: true });
    const pub = pubWithFont('Test Serif', 'AB');
    pub.pages[0].items.push(pub.newTextFrame({ x: 36, y: 120, w: 400, h: 60 }, [{ style: 'Body', runs: [{ text: 'locked', font: 'Locked Serif', size: 14 }] }]));
    expect(fontsToPackage(pub).map((f) => f.entry.family)).toEqual(['Test Serif']);
    const bytes = await exportQpp(pub);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('fonts.json')).toBeTruthy();
    expect(zip.file(`fonts/${used.id}.otf`)).toBeTruthy();
    const index = JSON.parse(await zip.file('fonts.json')!.async('string'));
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ family: 'Test Serif', weight: 700, style: 'normal', format: 'otf', psName: 'TestSerif-Bold' });

    // Opening on a device without the font registers it for the session and tells the UI.
    resetUserFonts();
    const offered: string[] = [];
    onPackagedFonts((fonts) => offered.push(...fonts.map((f) => f.family)));
    const back = await importQpp(bytes);
    expect(back.pages[0].items).toHaveLength(2);
    expect(userFonts()).toHaveLength(1);
    expect(userFonts()[0]).toMatchObject({ family: 'Test Serif', packaged: true, cff: true, embeddable: true });
    expect(offered).toEqual(['Test Serif']);
    // The packaged copy embeds in PDF like any other user font.
    const s = new TextDecoder('latin1').decode(await pubToPdf(back, { fontLoader }));
    expect(s).toContain('/FontFile3');
  });

  it('leaves fonts out when packaging is off, and a device copy wins over a packaged one', async () => {
    await addUserFont(syntheticOtf(), 'TestSerif-Bold.otf', { session: true });
    setPackageFonts(false);
    const zip = await JSZip.loadAsync(await exportQpp(pubWithFont('Test Serif')));
    expect(zip.file('fonts.json')).toBeNull();
    expect(Object.keys(zip.files).some((n) => n.startsWith('fonts/'))).toBe(false);
    setPackageFonts(true);
    const withFonts = await exportQpp(pubWithFont('Test Serif'));
    // The same face is already on this device (not packaged): the package's copy is skipped.
    await importQpp(withFonts);
    expect(userFonts()).toHaveLength(1);
    expect(userFonts()[0].packaged).toBeUndefined();
    const added = await registerPackagedFonts([{ family: 'Other Serif', weight: 400, style: 'normal', format: 'otf', file: 'o.otf', bytes: syntheticOtf({ family: 'Other Serif', subfamily: 'Regular', weight: 400 }) }]);
    expect(added).toHaveLength(1);
    expect(added[0].packaged).toBe(true);
    expect(userFonts()).toHaveLength(2);
  });
});
