import { describe, it, expect } from 'vitest';
import { Pub, textOf, parasFromText, reId } from '../../src/model/pub';
import { resolvePara, resolveRun, colorHex, applyColorScheme, COLOR_SCHEMES, applyFontScheme, FONT_SCHEMES, fontsUsed } from '../../src/model/styles';
import { GEOMETRY, geometryPath } from '../../src/model/geometry';
import { PAGE_SIZES } from '../../src/model/types';
import { pageSvg } from '../../src/render/page';
import { TEMPLATES } from '../../src/templates';

describe('publication model', () => {
  it('creates a blank letter publication with one page on A-Master', () => {
    const p = Pub.blank();
    expect(p.size).toEqual({ w: 612, h: 792 });
    expect(p.pages).toHaveLength(1);
    expect(p.data.masters[0].name).toBe('A-Master');
    expect(p.geometry(p.pages[0]).margins).toEqual([36, 36, 36, 36]);
    expect(p.data.styles.para.map((s) => s.name)).toContain('Body');
    expect(p.data.swatches.map((s) => s.name)).toContain('Primary');
  });

  it('knows every page size and facing sides', () => {
    expect(PAGE_SIZES.find((s) => s.id === 'a4')).toMatchObject({ w: 595.28, h: 841.89 });
    const p = Pub.blank({ w: 400, h: 500 }, { facing: true, pages: 3 });
    expect(p.pages.map((_, i) => p.pageSide(i))).toEqual(['right', 'left', 'right']);
    expect(Pub.blank().pageSide(0)).toBe('single');
  });

  it('resolves paragraph and character styles through basedOn chains', () => {
    const p = Pub.blank();
    const r = resolvePara(p.data, { style: 'Heading 1', runs: [] });
    expect(r.run.b).toBe(true);
    expect(r.run.size).toBeGreaterThan(11);
    const body = resolvePara(p.data, { style: 'Body First', runs: [] });
    expect(body.props.indent ?? 0).toBe(0);
    const run = resolveRun(p.data, body.run, { text: 'x', cstyle: 'Emphasis' });
    expect(run.i).toBe(true);
    const local = resolveRun(p.data, body.run, { text: 'x', size: 20, cstyle: 'Strong' });
    expect(local.size).toBe(20);
    expect(local.b).toBe(true);
  });

  it('resolves swatch names to colors and applies schemes', () => {
    const p = Pub.blank();
    expect(colorHex(p.data, 'Black')).toBe('#000000');
    expect(colorHex(p.data, '#123456')).toBe('#123456');
    expect(colorHex(p.data, 'Nope 1', '#ff00ff')).toBe('#ff00ff');
    applyColorScheme(p.data, COLOR_SCHEMES[1]);
    expect(colorHex(p.data, 'Primary').toLowerCase()).toBe(COLOR_SCHEMES[1].colors.Primary.toLowerCase());
    applyFontScheme(p.data, FONT_SCHEMES[2]);
    expect(p.paraStyle('Body')?.run?.font).toBe(FONT_SCHEMES[2].body);
    expect(p.paraStyle('Heading 1')?.run?.font).toBe(FONT_SCHEMES[2].head);
    expect(fontsUsed(p.data)).toContain(FONT_SCHEMES[2].body);
  });

  it('undoes and redoes page-scoped and whole-document transactions', () => {
    const p = Pub.blank();
    const pg = p.pages[0];
    p.transact('Add frame', () => { pg.items.push(p.newTextFrame({ x: 10, y: 10, w: 100, h: 50 }, parasFromText('Hello'))); }, [pg.id]);
    expect(p.pages[0].items).toHaveLength(1);
    expect(p.data.stories).toHaveLength(1);
    p.transact('Bleed', () => { p.data.bleed = 9; });
    expect(p.canUndo).toBe(true);
    expect(p.undoLabels()).toEqual(['Bleed', 'Add frame']);
    p.undo();
    expect(p.data.bleed).toBe(0);
    p.undo();
    expect(p.pages[0].items).toHaveLength(0);
    expect(p.data.stories).toHaveLength(0);
    p.redo();
    expect(p.pages[0].items).toHaveLength(1);
    expect(textOf(p.data.stories[0].paras)).toBe('Hello');
    // A transaction that changes nothing adds no undo entry.
    const n = p.undoLabels().length;
    p.transact('Nothing', () => {});
    expect(p.undoLabels().length).toBe(n);
  });

  it('links frames into chains and prunes unused stories', () => {
    const p = Pub.blank({ w: 612, h: 792 }, { pages: 2 });
    const a = p.newTextFrame({ x: 0, y: 0, w: 100, h: 100 }, parasFromText('one'));
    const b = p.newTextFrame({ x: 0, y: 0, w: 100, h: 100 });
    b.story = a.story; a.next = b.id; b.prev = a.id;
    p.pages[0].items.push(a); p.pages[1].items.push(b);
    p.pruneStories();
    expect(p.data.stories).toHaveLength(1);
    expect(p.chainOf(a.story).map((f) => f.id)).toEqual([a.id, b.id]);
    expect(p.pageOfItem(b.id)?.id).toBe(p.pages[1].id);
    expect(p.frame(b.id)?.prev).toBe(a.id);
  });

  it('labels pages by section numbering', () => {
    const p = Pub.blank({ w: 612, h: 792 }, { pages: 5 });
    p.data.sections = [{ id: 's1', name: 'Front', start: 0, numbering: 'romanLcPeriod', startAt: 1 }, { id: 's2', name: 'Body', start: 2, numbering: 'arabicPlain', startAt: 1, prefix: 'B-' }];
    expect([0, 1, 2, 3, 4].map((i) => p.pageLabel(i))).toEqual(['i', 'ii', 'B-1', 'B-2', 'B-3']);
  });

  it('round-trips JSON and sanitizes damaged data', () => {
    const p = Pub.blank();
    p.data.props.title = 'T';
    p.pages[0].items.push(p.newTextFrame({ x: 1, y: 2, w: 3, h: 4 }, parasFromText('a')));
    const q = Pub.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(q.data.props.title).toBe('T');
    expect(q.pages[0].items).toHaveLength(1);
    const bad = Pub.fromJSON({ format: 'quillpress', version: 1, data: { size: { w: -1, h: 0 }, pages: [{ id: 'x', master: 'missing' }], masters: [] } as any, media: {} });
    expect(bad.size.w).toBeGreaterThan(0);
    expect(bad.pages[0].master).toBe(bad.data.masters[0].id);
    expect(bad.pages[0].items).toEqual([]);
  });

  it('gives copies new ids down into groups', () => {
    const g: any = { id: 'g', kind: 'group', x: 0, y: 0, w: 10, h: 10, children: [{ id: 'c', kind: 'shape', geom: 'rect', x: 0, y: 0, w: 5, h: 5, masterOf: 'm' }] };
    const c = reId(g);
    expect(c.id).not.toBe('g');
    expect(c.children[0].id).not.toBe('c');
    expect(c.children[0].masterOf).toBeUndefined();
  });

  it('has preset geometry for every shape and renders a page to SVG', () => {
    for (const [id, d] of Object.entries(GEOMETRY)) { const p = geometryPath(id, 100, 60, d.adj); expect(p.d.length, id).toBeGreaterThan(3); }
    const pub = Pub.blank();
    pub.pages[0].items.push({ id: 's', kind: 'shape', geom: 'star5', x: 10, y: 10, w: 100, h: 100, fill: { type: 'solid', color: 'Primary' } } as any);
    pub.pages[0].items.push(pub.newTextFrame({ x: 50, y: 200, w: 300, h: 100 }, parasFromText('Hello world')));
    const svg = pageSvg(pub, pub.pages[0], { mode: 'export' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('Hello');
    expect(svg).toContain('<path');
    const edit = pageSvg(pub, pub.pages[0], { mode: 'edit', ids: true, guides: true });
    expect(edit).toContain('data-id="s"');
  });

  it('builds every template into a valid publication', () => {
    for (const t of TEMPLATES) {
      const p = t.build();
      expect(p.pages.length, t.id).toBeGreaterThan(0);
      expect(p.data.masters.length, t.id).toBeGreaterThan(0);
      for (const pg of p.pages) for (const e of pg.items) if (e.kind === 'text') expect(p.story(e.story), `${t.id} story`).toBeTruthy();
      const svg = pageSvg(p, p.pages[0], { mode: 'thumb' });
      expect(svg, t.id).toContain('<svg');
    }
  });
});
