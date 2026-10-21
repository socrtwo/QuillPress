/**
 * The Publisher reader against files saved by Publisher itself (the Document Liberation Project's
 * seed corpus). The files are not part of the repository: the tests run when the corpus is present
 * at /home/user/samples/pub2/pub and are skipped otherwise.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { importMsPub } from '../../src/io/mspub';
import type { TextFrame, TableItem, Item } from '../../src/model/types';
import type { Pub } from '../../src/model/pub';

const DIR = '/home/user/samples/pub2/pub';
const have = existsSync(DIR);
const load = (name: string) => importMsPub(new Uint8Array(readFileSync(`${DIR}/${name}`)), name);
const items = (pub: Pub): Item[] => pub.data.pages.flatMap((p) => p.items);
const storyText = (pub: Pub, f: TextFrame) => pub.story(f.story)!.paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
const cellTexts = (t: TableItem) => t.rows.map((r) => r.cells.map((c) => c.text.map((p) => p.runs.map((x) => x.text).join('')).join('|')));

describe.skipIf(!have)('Publisher corpus (real files)', () => {
  it('reads a Publisher 2003 newsletter with its pages, pictures, tables and text', async () => {
    const r = await load('923566.pub');
    expect(r.textOnly).toBe(false);
    expect(r.pub.data.pages).toHaveLength(6);
    expect(r.pub.size).toEqual({ w: 612, h: 792 });
    const all = items(r.pub);
    expect(all.length).toBeGreaterThanOrEqual(70);
    expect(all.filter((i) => i.kind === 'picture').length).toBeGreaterThanOrEqual(7);
    expect(all.filter((i) => i.kind === 'table')).toHaveLength(1);
    expect(Object.keys(r.pub.media)).toHaveLength(3);
    const texts = all.filter((i): i is TextFrame => i.kind === 'text').map((f) => storyText(r.pub, f));
    expect(texts.some((t) => t.includes('What light through yonder window breaks'))).toBe(true);
  });

  it('maps table text to cells by the Quill cell ends (2002+)', async () => {
    const r = await load('tables.pub');
    const tables = items(r.pub).filter((i): i is TableItem => i.kind === 'table');
    expect(tables).toHaveLength(2);
    expect(cellTexts(tables[0])).toEqual([['a', 'aa', 'aaa'], ['aaaa', 'aaaaa', 'aaaaaa']]);
    expect(tables[0].cols).toEqual([144, 144, 144]);
    expect(cellTexts(tables[1])).toEqual([['bb', 'bbbb'], ['bbbbbb', 'bbbbbbbb']]);
  });

  it('keeps merged cells with their spans', async () => {
    const r = await load('table-merged.pub');
    const t = items(r.pub).find((i): i is TableItem => i.kind === 'table')!;
    expect(t.rows).toHaveLength(4);
    expect(t.cols).toHaveLength(6);
    expect(t.rows[0].cells[0].colSpan).toBe(3);
    expect(t.rows[0].cells[4].colSpan).toBe(2);
    expect(t.rows[0].cells[4].rowSpan).toBe(3);
    expect(cellTexts(t)[0][0]).toBe('a b c');
    expect(cellTexts(t)[3][5]).toBe('x');
    expect(t.rows[0].cells[1].merged).toBe(true);
  });

  it('reads Publisher 2000 tables (marker 0x0a records) with their grid, spans and text', async () => {
    const m = await load('multipara.pub');
    expect(m.textOnly).toBe(false);
    const mt = items(m.pub).filter((i): i is TableItem => i.kind === 'table');
    expect(mt).toHaveLength(1);
    expect(mt[0].cols).toHaveLength(2);
    expect(mt[0].rows).toHaveLength(1);
    expect(cellTexts(mt[0])[0][0]).toBe('My hovercraft is full of eels.|My hovercraft is full of eels.');
    const t1 = await load('table1.pub');
    const t = items(t1.pub).find((i): i is TableItem => i.kind === 'table')!;
    expect(t.cols).toHaveLength(3);
    expect(t.rows).toHaveLength(7);
    const b = await load('border1.pub');
    const bt = items(b.pub).find((i): i is TableItem => i.kind === 'table')!;
    expect(bt.cols).toHaveLength(2);
    expect(bt.rows).toHaveLength(7);
    expect(b.warnings.some((w) => /hairline grid/.test(w))).toBe(true);
  });

  it('places WordArt as text in its own colour', async () => {
    const r = await load('fdo64631-2.pub');
    const frames = items(r.pub).filter((i): i is TextFrame => i.kind === 'text');
    expect(frames).toHaveLength(6);
    expect(storyText(r.pub, frames[0])).toContain('Name:');
    expect(r.warnings.some((w) => /WordArt/.test(w))).toBe(true);
    const s = await load('fdo68259-5.pub');
    expect(s.pub.data.pages).toHaveLength(9);
    const wa = items(s.pub).filter((i): i is TextFrame => i.kind === 'text');
    expect(wa.length).toBe(31);
    expect(storyText(s.pub, wa[0])).toBe('Votre texte ici');
    expect(wa[0].h).toBeGreaterThan(0);
    expect(wa[5].rot).toBe(90);
  });

  it('reads Publisher 97 text by page order and guesses the code page', async () => {
    const r = await load('tdf89993-1.pub');
    expect(r.textOnly).toBe(false);
    // Only the page that carries objects becomes a page (the others are scratch and template areas).
    expect(r.pub.data.pages).toHaveLength(1);
    const f = r.pub.data.pages[0].items.find((i): i is TextFrame => i.kind === 'text')!;
    expect(f).toBeTruthy();
    expect(Math.round(f.x)).toBe(78);
    expect(Math.round(f.w)).toBe(419);
    expect(f.rot ?? 0).toBe(0);
    expect(storyText(r.pub, f)).toMatch(/^Lorem ipsum dolor sit amet/);
    expect(r.pub.story(f.story)!.paras.length).toBeGreaterThan(20);
    const ru = await load('fdo59355-1.pub');
    const rf = items(ru.pub).find((i): i is TextFrame => i.kind === 'text')!;
    expect(storyText(ru.pub, rf)).toContain('Русский текст');
  });

  it('reads a Publisher 2010 regression file with 71 objects and five tables', async () => {
    const r = await load('REG-TST2-pub2010.pub');
    expect(r.pub.data.pages).toHaveLength(7);
    const tables = items(r.pub).filter((i): i is TableItem => i.kind === 'table');
    expect(tables).toHaveLength(5);
    const t = tables.find((x) => x.rows.length === 4 && x.cols.length === 5)!;
    expect(cellTexts(t)[1]).toEqual(['aaa', '123', '456', '789', '012']);
    expect(t.rows[0].cells[0].colSpan).toBe(5);
    expect(items(r.pub).filter((i) => i.kind === 'picture').length).toBe(18);
    expect(Object.keys(r.pub.media)).toHaveLength(4);
    expect(r.warnings.some((w) => /13 pictures are Windows metafiles/.test(w))).toBe(true);
  });

  it('reads landscape and A5 publications with masters, groups and embedded pictures', async () => {
    const a = await load('fdo61579-1.pub');
    expect(a.pub.size).toEqual({ w: 841.89, h: 595.28 });
    expect(a.pub.data.pages).toHaveLength(4);
    expect(items(a.pub).filter((i) => i.kind === 'group')).toHaveLength(3);
    expect(Object.keys(a.pub.media)).toHaveLength(2);
    const b = await load('fdo67299-1.pub');
    expect(b.pub.size).toEqual({ w: 420.94, h: 595.28 });
    expect(b.pub.data.pages).toHaveLength(6);
    expect(b.pub.data.masters).toHaveLength(2);
    expect(Object.keys(b.pub.media)).toHaveLength(8);
  });

  it('never throws on damaged or empty files', async () => {
    const d = await load('EDB-29664-1.pub');
    expect(d.textOnly).toBe(true);
    expect(d.pub.data.pages.length).toBeGreaterThanOrEqual(1);
    const e = await load('14.0-metadata.pub');
    expect(e.textOnly).toBe(false);
    expect(e.pub.data.pages).toHaveLength(3);
    expect(items(e.pub)).toHaveLength(0);
  });

  it('reads every corpus file without throwing', async () => {
    const { readdirSync } = await import('node:fs');
    for (const f of readdirSync(DIR)) {
      const r = await load(f);
      expect(r.pub.data.pages.length).toBeGreaterThan(0);
    }
  });
});
