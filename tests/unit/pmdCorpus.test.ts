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

  it('opens every sample without throwing and never falls back to the harvest', async () => {
    const { readdirSync } = await import('node:fs');
    for (const name of readdirSync(SAMPLES)) {
      const r = await importPublication(load(name), name.includes('.') ? name : `${name}.pmd`, { noRecovery: true });
      expect(r.format, name).toBe('pmd');
      expect(r.warnings[0], name).toMatch(/^PageMaker publication/);
    }
  });
});
