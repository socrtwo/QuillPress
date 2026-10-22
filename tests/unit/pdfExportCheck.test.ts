/**
 * PDF export checks found by comparing exported files with poppler and with the screen renderer:
 * byte encoding, text strings, group coordinates, gradients, patterns, line ends, links, CSS colors,
 * unbundled and non-Latin text, paragraph rules, autosize clipping, text state, and the shift of
 * superscripts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Pub, newId } from '../../src/model/pub';
import type { Item } from '../../src/model/types';
import { pubToPdf, lastPdfWarnings, pdfTextString } from '../../src/export/pdf';
import { rgb } from '../../src/export/pdfPaint';
import { jpegInfo } from '../../src/export/pdfImages';
import { pageSvg } from '../../src/render/page';
import { frameLines, frameClipHeight } from '../../src/render/flow';
import { baselineShift, cssFont, SHIFTED_SIZE } from '../../src/render/text';

const fontLoader = async (url: string): Promise<Uint8Array> => {
  const file = basename(url.split('?')[0]);
  const pkg = file.split(/-(?:latin|cyrillic|greek)-/)[0];
  return new Uint8Array(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`));
};
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
const rect = (x: number, y: number, extra: Partial<Item> = {}): Item => ({ id: newId('sh'), kind: 'shape', geom: 'rect', x, y, w: 50, h: 30, fill: { type: 'solid', color: '#ff0000' }, ...extra } as Item);

describe('PDF export encoding and text state', () => {
  it('writes standard-font text as WinAnsi bytes and document information as UTF-16', async () => {
    const p = Pub.blank();
    p.data.props.title = 'Catalogue d’été — Ελληνικά';
    p.pages[0].items.push(p.newTextFrame({ x: 36, y: 36, w: 300, h: 40 }, [{ style: 'Body', runs: [{ text: 'intérieur Année', font: 'Tinos' }] }]));
    const bytes = await pubToPdf(p, { embedFonts: false });
    const s = latin1(bytes);
    // é is one byte (0xE9), not the two bytes of UTF-8 (which print as "Ã©").
    expect(s).toContain('(int\xe9rieur');
    expect(s).toContain('(Ann\xe9e)');
    expect(s).not.toContain('Ã©');
    expect(s).toContain(`/Title ${pdfTextString(p.data.props.title)}`);
    expect(pdfTextString('Plain')).toBe('(Plain)');
    expect(pdfTextString('é')).toBe('<FEFF00E9>');
  });

  it('sets the character spacing in every text object, so tracking does not leak into later runs', async () => {
    const p = Pub.blank();
    p.pages[0].items.push(p.newTextFrame({ x: 36, y: 36, w: 400, h: 80 }, [
      { style: 'Body', runs: [{ text: 'TRACKED BYLINE', font: 'Tinos', spc: 1 }] },
      { style: 'Body', runs: [{ text: 'Plain text that follows', font: 'Tinos' }] },
    ]));
    const s = latin1(await pubToPdf(p, { fontLoader }));
    const tfs = [...s.matchAll(/ Tf( -?[\d.]+ Tc)?/g)];
    expect(tfs.length).toBeGreaterThan(1);
    for (const m of tfs) expect(m[1], 'Tc after every Tf').toBeTruthy();
    expect(s).toContain(' 1 Tc');
    expect(s).toContain(' 0 Tc');
    // Words of one style go out as one TJ string with the space glyphs inside it.
    expect(s).toMatch(/\[<[0-9a-f]+> (-?[\d.]+ )?<0003>/);
  });
});

describe('PDF export matches the screen', () => {
  it('keeps group children in page coordinates (renderer and writer)', async () => {
    const p = Pub.blank();
    const child = rect(100, 120);
    p.pages[0].items.push({ id: newId('grp'), kind: 'group', x: 100, y: 120, w: 50, h: 30, children: [child] } as Item);
    const svg = pageSvg(p, p.pages[0]);
    expect(svg).not.toContain('translate(100 120) rotate'); // the group does not translate its children
    expect(svg).toContain('translate(100 120)'); // the child places itself
    const s = latin1(await pubToPdf(p, { fontLoader }));
    expect(s).toContain('1 0 0 1 100 120 cm');
    expect(s).not.toContain('1 0 0 1 200 240 cm');
  });

  it('paints gradients as shadings, hatch patterns as tiling patterns and draws line ends', async () => {
    const p = Pub.blank();
    p.pages[0].items.push(
      rect(36, 36, { fill: { type: 'gradient', stops: [{ pos: 0, color: '#0000ff' }, { pos: 0.5, color: '#ff0000' }, { pos: 1, color: '#ffff00' }], angle: 0 } }),
      rect(100, 36, { fill: { type: 'gradient', path: 'radial', stops: [{ pos: 0, color: 'white' }, { pos: 1, color: 'navy' }] } }),
      rect(160, 36, { fill: { type: 'pattern', fg: '#000000', bg: '#ffffff', preset: 'horz' } }),
      { id: newId('ln'), kind: 'line', x: 36, y: 200, w: 200, h: 0, line: { fill: { type: 'solid', color: '#000000' }, width: 2, head: 'oval', tail: 'triangle' } } as Item,
    );
    const s = latin1(await pubToPdf(p, { fontLoader }));
    expect(s).toContain('/ShadingType 2');
    expect(s).toContain('/ShadingType 3');
    expect(s).toContain('/FunctionType 3'); // three stops stitch two segments
    expect(s).toMatch(/\/Sh1 sh/);
    expect(s).toContain('/PatternType 1');
    expect(s).toMatch(/\/Pattern cs \/Pa1 scn/);
    expect(s).toContain('0 0 m 10 5 l 0 10 l h f'); // triangle at the tail
    expect(s).toContain('9 5 m 9 7.209'); // oval at the head
  });

  it('turns item and run links into URI annotations', async () => {
    const p = Pub.blank();
    p.pages[0].items.push(rect(36, 300, { link: 'https://example.org/item' }));
    p.pages[0].items.push(p.newTextFrame({ x: 36, y: 400, w: 300, h: 40 }, [{ style: 'Body', runs: [{ text: 'Visit ' }, { text: 'our site', link: 'https://example.org/run' }] }]));
    const s = latin1(await pubToPdf(p, { fontLoader }));
    expect(s).toContain('/Subtype /Link');
    expect(s).toContain('(https://example.org/item)');
    expect(s).toContain('(https://example.org/run)');
    expect(s).toMatch(/\/Annots \[\d+ 0 R \d+ 0 R\]/);
  });

  it('reads every CSS color the renderer accepts', () => {
    expect(rgb('white')).toEqual([1, 1, 1]);
    expect(rgb('#fff')).toEqual([1, 1, 1]);
    expect(rgb('#00ff0080')).toEqual([0, 1, 0]);
    expect(rgb('rgb(255, 0, 0)')).toEqual([1, 0, 0]);
    expect(rgb('hsl(240, 100%, 50%)').map((v) => Math.round(v * 255))).toEqual([0, 0, 255]);
    expect(rgb('navy').map((v) => Math.round(v * 255))).toEqual([0, 0, 128]);
  });

  it('embeds the screen fallback face for unbundled fonts and the core subsets for non-Latin text', async () => {
    const p = Pub.blank();
    p.pages[0].items.push(p.newTextFrame({ x: 36, y: 36, w: 400, h: 40 }, [{ style: 'Body', runs: [{ text: 'Franklin text', font: 'Franklin Gothic Book' }] }]));
    p.pages[0].items.push(p.newTextFrame({ x: 36, y: 100, w: 400, h: 40 }, [{ style: 'Body', runs: [{ text: 'Русский текст, Ελληνικά, příliš žluťoučký', font: 'Tinos' }] }]));
    const s = latin1(await pubToPdf(p, { fontLoader }));
    expect(s).toMatch(/\/BaseFont \/[A-Z]{6}\+Carlito/);
    expect(s).not.toContain('/BaseFont /Helvetica');
    expect(s).not.toContain('/BaseFont /Times-Roman');
    // Tinos latin plus its Cyrillic, Greek and Latin Extended subsets.
    expect((s.match(/\/BaseFont \/[A-Z]{6}\+Tinos/g) || []).length).toBeGreaterThanOrEqual(8);
    const w = lastPdfWarnings();
    expect(w.some((m) => /Franklin Gothic Book is not available to the PDF writer; its text is printed in Carlito/.test(m))).toBe(true);
    expect(w.some((m) => /print as "\?"/.test(m))).toBe(false);
  });

  it('draws paragraph rules on screen and in the PDF', async () => {
    const p = Pub.blank();
    const f = p.newTextFrame({ x: 36, y: 36, w: 300, h: 120 }, [{ style: 'Body', ruleAbove: { width: 2, color: '#123456', offset: 3 }, ruleBelow: { width: 1, color: '#654321' }, runs: [{ text: 'A pull quote between rules.' }] }]);
    p.pages[0].items.push(f);
    const fl = frameLines(p, f);
    expect(fl.rules).toHaveLength(2);
    const [above, below] = fl.rules;
    const line = fl.lines[0];
    expect(above.y).toBeCloseTo(line.y - line.ascent - 3 - 1, 5);
    expect(below.y).toBeGreaterThan(line.y);
    expect(above.w).toBeCloseTo(fl.boxes[0].w, 5);
    expect(pageSvg(p, p.pages[0])).toContain('qp-para-rule');
    const s = latin1(await pubToPdf(p, { fontLoader }));
    expect(s).toMatch(/0\.071 0\.204 0\.337 RG 2 w \[\] 0 d 0 J/);
  });

  it('clips a frame that grows with its text to the height its lines reach', () => {
    const p = Pub.blank();
    const f = p.newTextFrame({ x: 36, y: 36, w: 120, h: 20 }, [{ style: 'Body', runs: [{ text: 'Several lines of text that do not fit into a twenty point frame at all.' }] }]);
    f.autosize = 'height';
    p.pages[0].items.push(f);
    const fl = frameLines(p, f);
    expect(fl.lines.length).toBeGreaterThan(2);
    expect(frameClipHeight(f, fl.lines)).toBeGreaterThan(40);
    f.autosize = 'none';
    expect(frameClipHeight(f, fl.lines)).toBe(20);
  });

  it('shifts superscripts by a percent of the run size, the same on screen and in the PDF', () => {
    expect(baselineShift(33, 12 * SHIFTED_SIZE)).toBeCloseTo(3.96, 5);
    expect(baselineShift(-20, 10 * SHIFTED_SIZE)).toBeCloseTo(-2, 5);
    expect(baselineShift(undefined, 12)).toBe(0);
    const p = Pub.blank();
    p.pages[0].items.push(p.newTextFrame({ x: 36, y: 36, w: 300, h: 60 }, [{ style: 'Body', runs: [{ text: 'E = mc' }, { text: '2', baseline: 33 }] }]));
    expect(pageSvg(p, p.pages[0])).toMatch(/baseline-shift="[\d.]+"/);
  });

  it('measures small capitals and unbundled fonts as the screen draws them', () => {
    expect(cssFont({ caps: 'small' }, 12, 'Tinos')).toContain('small-caps');
    expect(cssFont({}, 12, 'Franklin Gothic Book')).toContain('"Carlito"');
  });

  it('breaks a line that moves to the next frame again at that frame\'s width', () => {
    const p = Pub.blank();
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const a = p.newTextFrame({ x: 36, y: 36, w: 90, h: 40 }, [{ style: 'Body', runs: [{ text: words }] }]);
    const b = p.newTextFrame({ x: 36, y: 200, w: 400, h: 300 });
    b.story = a.story; a.next = b.id; b.prev = a.id;
    p.pages[0].items.push(a, b);
    const lb = frameLines(p, b).lines;
    const la = frameLines(p, a).lines;
    expect(la.length).toBeGreaterThan(0);
    // The first line of the wide frame is as full as its others, not the narrow frame's leftover break.
    expect(lb[0].width).toBeGreaterThan(300);
    expect(lb[0].segs.length).toBeGreaterThan(la[0].segs.length);
  });

  it('sizes arrowheads at three line widths, on screen and in the PDF', async () => {
    const p = Pub.blank();
    p.pages[0].items.push({ id: newId('ln'), kind: 'line', x: 36, y: 100, w: 200, h: 0, line: { fill: { type: 'solid', color: '#000000' }, width: 6, tail: 'triangle' } } as Item);
    expect(pageSvg(p, p.pages[0])).toContain('markerWidth="3" markerHeight="3"');
    const s = latin1(await pubToPdf(p, { fontLoader }));
    expect(s).toContain('1.8 0 0 1.8 0 0 cm'); // 3 × 6 pt over the 10-unit marker box
  });

  it('reads JPEG frame size, Adobe marker and EXIF orientation', () => {
    // SOI, APP1 Exif (little-endian TIFF, one IFD entry: orientation 6), APP14 Adobe, SOF0 8×4 3 components.
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
    const app1 = [0xff, 0xe1, 0, exif.length + 2, ...exif];
    const adobe = [0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0];
    const sof = [0xff, 0xc0, 0, 17, 8, 0, 4, 0, 8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    const info = jpegInfo(new Uint8Array([0xff, 0xd8, ...app1, ...adobe, ...sof, 0xff, 0xd9]));
    expect(info).toEqual({ w: 8, h: 4, comps: 3, adobe: true, orientation: 6 });
  });
});
