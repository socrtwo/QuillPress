/**
 * PageMaker reader checked against files saved by PageMaker 6.0, 6.5 and 7 (Windows and Mac). The
 * files are not part of the repository: the tests run when the sample directory exists and are
 * skipped otherwise.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { importPageMaker } from '../../src/io/pagemaker/index';
import { openPageMaker } from '../../src/io/pagemaker/records';
import { importPublication, sniffFormat } from '../../src/io';
import { textOf } from '../../src/model/pub';
import type { TextFrame, ShapeItem, LineItem, GroupItem, Item } from '../../src/model/types';

const SAMPLES = '/home/user/samples/pmd/pmd';
const load = (name: string) => new Uint8Array(readFileSync(`${SAMPLES}/${name}`));
const flat = (items: Item[]): Item[] => items.flatMap((i) => (i.kind === 'group' ? [i, ...flat(i.children)] : [i]));

describe.skipIf(!existsSync(SAMPLES))('PageMaker real files', () => {
  it('opens the compound-file wrapper of PageMaker 6.5/7 and the raw record store of 6.0', () => {
    const f65 = openPageMaker(load('A4doc.pmd'));
    expect(f65.be).toBe(false);
    expect(f65.v60).toBe(false);
    const f60 = openPageMaker(load('shapes.6'));
    expect(f60.be).toBe(true);
    expect(f60.v60).toBe(true);
    expect(sniffFormat(load('text.pmd'), 'text.pmd')).toBe('pmd');
  });

  it('reads an A4 page with a text block and an ellipse', async () => {
    const r = await importPageMaker(load('A4doc.pmd'), 'A4doc.pmd');
    expect(r.textOnly).toBe(false);
    expect(r.pub.size).toEqual({ w: 595.3, h: 841.9 });
    const items = r.pub.pages[0].items;
    expect(items.map((i) => i.kind)).toEqual(['shape', 'text']);
    const text = items[1] as TextFrame;
    expect(textOf(r.pub.story(text.story)!.paras)).toBe(' THis is A4 Document');
    expect(r.pub.story(text.story)!.paras[0].runs[0]).toMatchObject({ font: 'Times New Roman', size: 12 });
    expect([text.x, text.y]).toEqual([172.15, 232]);
    expect((items[0] as ShapeItem).geom).toBe('ellipse');
  });

  it('reads the Mac 6.5 shapes file: two lines, two rectangles, two ellipses, two hexagons', async () => {
    const r = await importPageMaker(load('shapes'), 'shapes');
    const items = r.pub.pages[0].items;
    expect(items.map((i) => i.kind)).toEqual(['line', 'line', 'shape', 'shape', 'shape', 'shape', 'shape', 'shape']);
    const diagonal = items[0] as LineItem;
    expect(diagonal.w).toBeGreaterThan(70);
    expect(diagonal.h).toBeGreaterThan(60);
    expect(diagonal.line?.width).toBe(1);
    const horizontal = items[1] as LineItem;
    expect(horizontal.h).toBe(0);
    expect((items[2] as ShapeItem).line?.width).toBe(1);
    expect((items[4] as ShapeItem).geom).toBe('ellipse');
    const hex = items[6] as ShapeItem;
    expect(hex.geom).toBe('custom');
    expect(hex.path?.[0].d.split('L')).toHaveLength(6);
  });

  it('reads PageMaker 6.0 shape records (136 bytes each)', async () => {
    const r = await importPageMaker(load('shapes.6'), 'shapes.6');
    expect(r.pub.pages[0].items.map((i) => i.kind)).toEqual(['line', 'line', 'shape', 'shape', 'shape']);
  });

  it('reads stroke colors, tints, widths and rotation', async () => {
    const r = await importPageMaker(load('shape_stroke.pmd'), 'shape_stroke.pmd');
    const [rect, oval, hex, open] = r.pub.pages[0].items as ShapeItem[];
    expect(rect.line).toMatchObject({ width: 8 });
    expect(rect.line?.fill).toEqual({ type: 'solid', color: '#ffffa6' }); // yellow at 35%
    expect(oval.geom).toBe('ellipse');
    expect(oval.rot).toBe(-10);
    expect(oval.line?.fill).toEqual({ type: 'solid', color: '#ffbfff' }); // magenta at 25%
    expect(hex.rot).toBe(-20);
    expect(hex.line?.fill).toEqual({ type: 'solid', color: '#ff1919' }); // red at 90%
    expect(hex.geom).toBe('custom');
    expect(hex.x).toBeGreaterThan(300);
    expect(open.path?.[0].d.endsWith('Z')).toBe(false);
  });

  it('reads character formatting', async () => {
    const r = await importPageMaker(load('text_formatting.pmd'), 'text_formatting.pmd');
    const text = r.pub.pages[0].items[0] as TextFrame;
    const runs = r.pub.story(text.story)!.paras.flatMap((p) => p.runs);
    expect(runs.find((x) => x.text === 'b')).toMatchObject({ color: '#00ffff' });
    expect(runs.find((x) => x.text === 'k')).toMatchObject({ color: '#ff00ff' });
    expect(runs.find((x) => x.text === 'q')).toMatchObject({ b: true });
    expect(runs.find((x) => x.text === 't')).toMatchObject({ i: true });
    expect(runs.find((x) => x.text === 'v')).toMatchObject({ u: true });
    expect(runs.some((x) => x.strike)).toBe(true);
    expect(runs.find((x) => x.text === '34')).toMatchObject({ baseline: 33 });
    expect(runs.find((x) => x.text === '890')).toMatchObject({ baseline: -33 });
  });

  it('reads paragraph formatting of a PageMaker 6.0 Mac file', async () => {
    const r = await importPageMaker(load('para-format.6'), 'para-format.6');
    expect(r.pub.pages).toHaveLength(2);
    const text = r.pub.pages[0].items[0] as TextFrame;
    const paras = r.pub.story(text.story)!.paras;
    const by = (s: string) => paras.find((p) => textOf([p]).startsWith(s))!;
    expect(by('Aligned to center').align).toBe('ctr');
    expect(by('Aligned to right').align).toBe('r');
    expect(by('Justified').align).toBe('just');
    expect(by('Force').align).toBe('justAll');
    expect(by('Left 1 inch').marL).toBe(72);
    expect(by('First 1.5').indent).toBe(108);
    expect(by('Right 0.5').marR).toBe(36);
    expect(by('o.2 inches before').spaceBefore).toBe(14.4);
    expect(by('0.1 inches after').spaceAfter).toBe(7.2);
    expect(by('Keep lines together').keepLines).toBe(true);
    expect(by('Keep with next').keepWithNext).toBe(true);
  });

  it('keeps hanging indents (negative first-line indent) and groups', async () => {
    const r = await importPageMaker(load('sub_records.pmd'), 'sub_records.pmd');
    expect(r.pub.size).toEqual({ w: 841.9, h: 595.3 });
    expect(r.pub.pages).toHaveLength(2);
    const all = flat(r.pub.pages[0].items);
    const block = all.find((i) => i.kind === 'text' && textOf(r.pub.story((i as TextFrame).story)!.paras).includes('Template Type')) as TextFrame;
    expect(block).toBeTruthy();
    expect(r.pub.story(block.story)!.paras[0]).toMatchObject({ marL: 117, indent: -117 });
    expect(r.pub.pages[1].items.filter((i) => i.kind === 'group')).toHaveLength(8);
    const group = r.pub.pages[1].items.find((i) => i.kind === 'group') as GroupItem;
    expect(group.children).toHaveLength(4);
    expect(group.w).toBeGreaterThan(50);
    const rules = all.filter((i) => i.kind === 'line') as LineItem[];
    expect(rules[0].line?.width).toBe(0.5);
  });

  it('places the shapes of a double-sided publication on left and right pages', async () => {
    const r = await importPageMaker(load('double_sided_multi_page.pmd'), 'double_sided_multi_page.pmd');
    expect(r.pub.pages).toHaveLength(5);
    expect(r.pub.pages[0].items.map((i) => i.kind)).toEqual(['shape', 'text']);
    // The rectangle left of the spine in page record 3 belongs to page 2; the ellipse across the
    // spine is drawn on both pages.
    expect(r.pub.pages[1].items.map((i) => i.kind)).toEqual(['shape', 'shape']);
    const rect = r.pub.pages[1].items[0] as ShapeItem;
    expect(rect.x + rect.w).toBeLessThan(r.pub.size.w);
    expect(r.pub.pages[2].items.map((i) => i.kind)).toEqual(['shape', 'shape']);
    expect(r.pub.pages[3].items).toHaveLength(1);
    expect(r.pub.pages[4].items).toHaveLength(0);
  });

  it('keeps line breaks that fall at the end of a character run, and centres them', async () => {
    const r = await importPageMaker(load('sub_records.pmd'), 'sub_records.pmd');
    const frames = flat(r.pub.pages[0].items).filter((i) => i.kind === 'text') as TextFrame[];
    const paras = (f: TextFrame) => r.pub.story(f.story)!.paras;
    const address = frames.find((f) => textOf(paras(f)).startsWith('Street Address'))!;
    const p = paras(address)[0];
    expect(p.align).toBe('ctr');
    expect(p.runs.filter((x) => x.br)).toHaveLength(2);
    expect(p.runs.filter((x) => !x.br).map((x) => x.text)).toEqual(['Street Address, City, ST  91234', 'Tel: 555 555 5555  Fax: 555 555 5555', 'email@address.com  www.company123.com']);
    // The template's instruction block: seven lines in one hanging-indent paragraph.
    const block = frames.find((f) => textOf(paras(f)).includes('Template Type'))!;
    expect(paras(block)[0].runs.filter((x) => x.br).length).toBeGreaterThanOrEqual(6);
    // The white LOGO letters over the coloured squares.
    const letters = frames.filter((f) => /^[LOG]$/.test(textOf(paras(f))));
    expect(letters.map((f) => textOf(paras(f))).sort()).toEqual(['G', 'L', 'O', 'O']);
    expect(paras(letters[0])[0].runs[0].color).toBe('#ffffff');
  });

  it('sets every paragraph property so the Body style does not leak in, with PageMaker leading', async () => {
    const r = await importPageMaker(load('para-format.6'), 'para-format.6');
    const paras = r.pub.story((r.pub.pages[0].items[0] as TextFrame).story)!.paras;
    const by = (s: string) => paras.find((p) => textOf([p]).startsWith(s))!;
    expect(by('Aligned to center')).toMatchObject({ spaceBefore: 0, spaceAfter: 0, indent: 0, marL: 0, marR: 0, lineSpacing: 120, lineSpacingPt: false });
    expect(by('Auto leading 110%')).toMatchObject({ lineSpacing: 110, lineSpacingPt: false });
    // Fixed leading is a character attribute: 115 pt for the 140 pt display letters.
    const sr = await importPageMaker(load('sub_records.pmd'), 'sub_records.pmd');
    const big = flat(sr.pub.pages[1].items).filter((i) => i.kind === 'text').map((f) => sr.pub.story((f as TextFrame).story)!.paras[0]).find((p) => p.runs[0]?.size === 140)!;
    expect(big).toMatchObject({ lineSpacing: 115, lineSpacingPt: true });
  });

  it('sizes superscripts once (the text engine scales shifted runs itself) and reads paragraph rules', async () => {
    const r = await importPageMaker(load('text_formatting.pmd'), 'text_formatting.pmd');
    const runs = r.pub.story((r.pub.pages[0].items[0] as TextFrame).story)!.paras.flatMap((p) => p.runs);
    const sup = runs.find((x) => x.text === '34')!;
    expect(sup.size! * 0.67).toBeCloseTo(36 * 0.583, 1);
    const rule = await importPageMaker(load('rule'), 'rule.pmd');
    const para = rule.pub.story((rule.pub.pages[0].items[0] as TextFrame).story)!.paras[0];
    expect(para.ruleAbove?.width).toBe(2.5);
  });

  it('puts objects PageMaker marks non-printing on their own layer', async () => {
    const r = await importPageMaker(load('sub_records.pmd'), 'sub_records.pmd');
    const layer = r.pub.data.layers.find((l) => l.name === 'Non-printing (PageMaker)')!;
    expect(layer).toBeTruthy();
    const on = (pg: number) => r.pub.pages[pg].items.filter((i) => i.layer === layer.id);
    // The instruction block (text and frame) and the fold line on page 1, the fold line on page 2.
    expect(on(0).map((i) => i.kind).sort()).toEqual(['line', 'shape', 'text']);
    expect(on(1).map((i) => i.kind)).toEqual(['line']);
    expect(r.warnings.some((w) => /non-printing/.test(w))).toBe(true);
    const plain = await importPageMaker(load('A4doc.pmd'), 'A4doc.pmd');
    expect(plain.pub.data.layers).toHaveLength(1);
  });

  it('opens every sample without throwing and never falls back to the harvest', async () => {
    const { readdirSync } = await import('node:fs');
    for (const name of readdirSync(SAMPLES)) {
      const r = await importPublication(load(name), name.includes('.') ? name : `${name}.pmd`, { noRecovery: true });
      expect(r.format, name).toBe('pmd');
      expect(r.warnings[0], name).toMatch(/^PageMaker publication/);
    }
  });

  it('reads Mac colour records (16-bit RGB and CMYK) and every character attribute of the 6.0 sample', async () => {
    const r = await importPageMaker(load('text-format.6'), 'text-format.6');
    const runs = r.pub.data.stories.flatMap((s) => s.paras.flatMap((p) => p.runs)).filter((x) => x.text);
    const run = (t: string) => runs.find((x) => x.text.replace(/\u00a0/g, ' ').startsWith(t))!;
    expect(run('outline').outline).toBe(true);
    expect(run('shadow').tshadow).toBe(true);
    expect(run('reverse').color).toBe('#ffffff');
    expect(run('blue color').color).toBe('#0000ff');
    expect(run('horiz. scale').hscale).toBe(90);
    expect(run('baseline shifr 5').shift).toBe(5);
    expect(run('baseline shifr 2').shift).toBe(-2);
    expect(run('loose tracking').spc).toBeCloseTo(0.04 * 12, 2);
    expect(run('line end: no break').text).toContain('\u00a0');
    expect(run('line end: no break').text).not.toContain(' ');
  });

  it('skews boxes about their centre, centred on the skewed bounding box', async () => {
    const r = await importPageMaker(load('rect_skew.pmd'), 'rect_skew.pmd');
    const s = flat(r.pub.data.pages[0].items).find((i) => i.kind === 'shape') as ShapeItem;
    expect(s.skew).toBe(30);
    expect(s.rot).toBeUndefined();
    // Unskewed 4905 × 2216 twips; the skewed outline spans x 3218..9402 around the spine (x = 0).
    expect(s.w).toBeCloseTo(4905 / 20, 1);
    expect(s.x + s.w / 2).toBeCloseTo((3218 + 9402) / 40, 1);
    const e = flat((await importPageMaker(load('ellipse_skew.pmd'), 'ellipse_skew.pmd')).pub.data.pages[0].items).find((i) => i.kind === 'shape') as ShapeItem;
    expect(e.skew).toBe(20);
    expect(r.warnings.join(' ')).not.toMatch(/skew is ignored/);
  });

  it('finds the master page records (left and right "Document Master", empty in every sample)', async () => {
    const { readMasters } = await import('../../src/io/pagemaker/shapes');
    const { readXforms } = await import('../../src/io/pagemaker/records');
    for (const name of ['A4doc.pmd', 'double_sided_multi_page.pmd', 'shapes.6', 'sub_records.pmd']) {
      const f = openPageMaker(load(name));
      const m = readMasters(f, readXforms(f), []);
      expect(m.map((x) => `${x.name}/${x.side}`), name).toEqual(['Document Master/left', 'Document Master/right']);
      expect(m.every((x) => x.shapes.length === 0), name).toBe(true);
    }
  });
});

describe('PageMaker master pages', () => {
  it('imports the objects of a master page record and applies the master by side', async () => {
    const { readMasters } = await import('../../src/io/pagemaker/shapes');
    // A minimal little-endian record store: a master container (type 0x2f, two 508-byte records) and
    // a shape container (type 0x19) holding one rectangle under the right master's sequence number.
    const bytes = new Uint8Array(4096);
    const dv = new DataView(bytes.buffer);
    const name = 'A-Master';
    for (let side = 0; side < 2; side++) {
      const o = 64 + side * 508;
      for (let k = 0; k < name.length; k++) bytes[o + k] = name.charCodeAt(k);
      dv.setUint16(o + 34, side === 0 ? 2 : 3, true);
      dv.setUint16(o + 38, side === 0 ? 18 : 19, true);
    }
    const rect = 2048;
    bytes[rect] = 0x04;
    dv.setInt16(rect + 6, -1440, true); dv.setInt16(rect + 8, -720, true); dv.setInt16(rect + 10, 1440, true); dv.setInt16(rect + 12, 720, true);
    dv.setUint32(rect + 34, 5 * 256, true);
    const file = {
      bytes, be: false, encoding: 'windows-1252' as const, v60: false,
      records: [{ type: 0x2f, offset: 64, seq: 17, count: 2 }, { type: 0x19, offset: rect, seq: 19, count: 1 }],
      byType: new Map([[0x2f, [{ type: 0x2f, offset: 64, seq: 17, count: 2 }]], [0x19, [{ type: 0x19, offset: rect, seq: 19, count: 1 }]]]),
    };
    const m = readMasters(file as any, new Map(), []);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ name: 'A-Master', side: 'left' });
    expect(m[0].shapes).toHaveLength(0);
    expect(m[1].side).toBe('right');
    expect(m[1].shapes.map((s) => s.kind)).toEqual(['rect']);
    expect(m[1].shapes[0].tl).toEqual({ x: -1440, y: -720 });
  });
});
