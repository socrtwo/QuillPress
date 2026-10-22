/**
 * The QuarkXPress reader against files saved by QuarkXPress 3.1–4.1 (the Document Liberation
 * Project's seed corpus). The files are not part of the repository: the tests run when the corpus
 * is present at the path below and are skipped otherwise.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { importQxp } from '../../src/io/qxp/index';
import type { TextFrame, PathTextItem, ShapeItem, GroupItem, LineItem, PictureFrame } from '../../src/model/types';

const DIR = '/home/user/samples/qxp/qxp';
const has = existsSync(DIR);

const load = (name: string) => importQxp(new Uint8Array(readFileSync(join(DIR, name))), name);
const items = (r: Awaited<ReturnType<typeof load>>, page = 0) => r.pub.data.pages[page].items;
const storyText = (r: Awaited<ReturnType<typeof load>>, f: TextFrame) => r.pub.story(f.story)!.paras.map((p) => p.runs.map((x) => x.text).join('')).join('\n');

describe.skipIf(!has)('QuarkXPress corpus', () => {
  it('reads every file of the corpus without throwing and in reasonable time', async () => {
    const names = readdirSync(DIR).filter((n) => !n.endsWith('.zip'));
    expect(names.length).toBeGreaterThan(150);
    let layout = 0;
    for (const n of names) {
      const t0 = Date.now();
      const r = await load(n);
      expect(r.pub.data.pages.length, n).toBeGreaterThan(0);
      expect(Date.now() - t0, `${n} took too long`).toBeLessThan(10000);
      if (!r.textOnly) layout++;
    }
    // Only books, libraries and a 1.x file go to the text harvest.
    expect(layout).toBeGreaterThanOrEqual(names.length - 6);
  });

  it('3.3 Windows text boxes: geometry, rotation, text and alignment', async () => {
    const r = await load('3.3_win-textboxes.qxd');
    expect(r.textOnly).toBe(false);
    expect(r.pub.data.size).toEqual({ w: 651.97, h: 566.93 });
    const frames = items(r).filter((i): i is TextFrame => i.kind === 'text');
    expect(frames).toHaveLength(6);
    const big = frames.find((f) => storyText(r, f).startsWith('Lorem ipsum dolor sit amet'))!;
    expect(big).toBeTruthy();
    // QuarkXPress draws frames inside the box: the 1 pt frame takes half a point off each side of the
    // outline QuillPress strokes, and the text is inset by the other half on top of the box inset.
    expect(big.w).toBeCloseTo(348.88, 1);
    expect(big.insets).toEqual([1.5, 1.5, 1.5, 1.5]);
    expect(big.line?.width).toBe(1);
    const rotated = frames.find((f) => f.rot)!;
    expect(rotated.rot).toBe(-35);
    expect(rotated.fill).toEqual({ type: 'solid', color: '#b3e2ee' });
    expect(rotated.line?.fill).toEqual({ type: 'solid', color: '#00ff00' });
    const centered = frames.find((f) => storyText(r, f).startsWith('center'))!;
    expect(centered.anchor).toBe('ctr');
    expect(r.pub.story(big.story)!.paras[0].runs[0]).toMatchObject({ font: 'Arial', size: 12 });
  });

  it('3.3 Mac files decode the same text as their Windows twins', async () => {
    const mac = await load('3.3_mac-textboxes');
    const win = await load('3.3_win-textboxes.qxd');
    const text = (r: typeof mac) => r.pub.data.stories.map((s) => s.paras.map((p) => p.runs.map((x) => x.text).join('')).join('\n')).sort();
    expect(text(mac)).toEqual(text(win));
    expect(mac.pub.data.stories.flatMap((s) => s.paras).flatMap((p) => p.runs)[0].font).toBe('Helvetica');
  });

  it('character formats: fonts, sizes, styles and baseline', async () => {
    const r = await load('4.0_win-formatting.qxd');
    const runs = r.pub.data.stories.flatMap((s) => s.paras).flatMap((p) => p.runs).map((x) => ({ ...x, text: x.text.trim() }));
    expect(runs.find((x) => x.text === '123')).toMatchObject({ size: 36 });
    expect(runs.find((x) => x.text === 'Times')).toMatchObject({ font: 'Times', size: 24 });
    expect(runs.find((x) => x.text === 'bold')).toMatchObject({ b: true });
    expect(runs.find((x) => x.text === 'italic')).toMatchObject({ i: true });
    expect(runs.find((x) => x.text === 'strike')).toMatchObject({ strike: true });
    expect(runs.find((x) => x.text === 'allcaps')).toMatchObject({ caps: 'all' });
    expect(runs.find((x) => x.text === 'smallcaps')).toMatchObject({ caps: 'small' });
    expect(runs.find((x) => x.text === 'sup')?.baseline).toBeGreaterThan(0);
    expect(runs.find((x) => x.text === 'sub')?.baseline).toBeLessThan(0);
    const paras = r.pub.data.stories.flatMap((s) => s.paras);
    expect(paras.find((p) => p.runs[0]?.text === 'center')?.align).toBe('ctr');
    expect(paras.find((p) => p.runs[0]?.text === 'right')?.align).toBe('r');
    expect(paras.find((p) => p.runs[0]?.text.startsWith('justified'))?.align).toBe('just');
  });

  it('gradients, dashes and arrows', async () => {
    const g = await load('3.3_win-gradients.qxd');
    const shapes = items(g).filter((i): i is ShapeItem => i.kind === 'shape');
    expect(shapes).toHaveLength(10);
    expect(shapes.every((s) => s.fill?.type === 'gradient')).toBe(true);
    expect(shapes.some((s) => s.fill?.type === 'gradient' && s.fill.path === 'radial')).toBe(true);
    expect(shapes.some((s) => s.geom === 'ellipse')).toBe(true);
    const d = await load('3.3_mac-dashes');
    const lines = items(d).filter((i): i is LineItem => i.kind === 'line');
    expect(lines).toHaveLength(8);
    // Dash styles map to the closest preset in line widths; stripes (parallel lines) draw solid.
    expect(new Set(lines.map((l) => l.line?.dash || 'solid'))).toContain('sysDash');
    expect(new Set(lines.map((l) => l.line?.dash || 'solid'))).toContain('dashDot');
    expect(lines.filter((l) => !l.line?.dash).length).toBeGreaterThanOrEqual(2);
    expect(new Set(lines.map((l) => l.line?.dash || 'solid'))).toContain('dot');
    const a = await load('4.0_win-arrows.qxd');
    const arrows = items(a).filter((i): i is LineItem => i.kind === 'line');
    expect(arrows.some((l) => l.line?.head && !l.line.tail)).toBe(true);
    expect(arrows.some((l) => l.line?.head && l.line.tail)).toBe(true);
    // Arrow type 1 puts the arrowhead at the line's end, 2 at its start; 3 and 4 add a tail feather.
    expect(arrows.some((l) => l.line?.tail === 'triangle' && !l.line.head)).toBe(true);
    expect(arrows.some((l) => l.line?.head === 'diamond' && l.line.tail === 'triangle')).toBe(true);
  });

  it('4.x lines take their color from the frame record, not the box color', async () => {
    const r = await load('group.qxd');
    const groups = items(r).filter((i): i is GroupItem => i.kind === 'group');
    expect(groups.length).toBeGreaterThan(0);
    const flat = (list: GroupItem['children']): GroupItem['children'] => list.flatMap((i) => (i.kind === 'group' ? [i, ...flat(i.children)] : [i]));
    const lines = flat(groups).filter((i): i is LineItem => i.kind === 'line');
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.line?.fill?.type === 'solid' && l.line.fill.color === '#000000')).toBe(true);
    const b = await load('4.0_mac-bezier_lines');
    const curves = items(b).filter((i): i is ShapeItem => i.kind === 'shape');
    expect(curves).toHaveLength(6);
    expect(curves.every((s) => s.geom === 'custom' && s.line?.fill?.type === 'solid' && s.line.fill.color !== '#ffffff')).toBe(true);
  });

  it('3.1 Mac picture boxes and polygons keep the objects after them in step', async () => {
    const r = await load('shapes-31');
    expect(r.textOnly).toBe(false);
    expect(items(r).map((i) => i.kind).sort()).toEqual(['line', 'line', 'picture', 'picture', 'picture', 'text']);
    const poly = await load('shape-31-2');
    // A polygon picture box is its outline grouped with the picture frame.
    const grp = items(poly)[0] as GroupItem;
    expect(grp.kind).toBe('group');
    expect(grp.children.map((c) => c.kind)).toEqual(['shape', 'picture']);
    expect((grp.children[0] as ShapeItem).geom).toBe('custom');
    expect(poly.warnings.some((w) => /could not be read/.test(w))).toBe(false);
  });

  it('3.3 picture boxes linked to a file carry the file record and name', async () => {
    const r = await load('test.qxd');
    expect(r.textOnly).toBe(false);
    const flat = (list: GroupItem['children']): GroupItem['children'] => list.flatMap((i) => (i.kind === 'group' ? [i, ...flat(i.children)] : [i]));
    const pics = flat(items(r)).filter((i): i is PictureFrame => i.kind === 'picture');
    expect(pics).toHaveLength(8);
    expect(pics.some((p) => p.name?.includes('bikers.pcx'))).toBe(true);
    expect(items(r).filter((i) => i.kind === 'text')).toHaveLength(4);
  });

  it('keeps the objects read before a damaged one', async () => {
    const r = await load('shapes.qxd');
    expect(r.textOnly).toBe(false);
    expect(items(r).length).toBe(6);
    expect(r.warnings.some((w) => /could not be read in full/.test(w))).toBe(true);
  });

  it('many master pages are accepted and master items become masters', async () => {
    const m5 = await load('masters5.qxd');
    expect(m5.textOnly).toBe(false);
    expect(m5.pub.data.pages).toHaveLength(2);
    const mt = await load('master-text1.qxd');
    expect(mt.pub.data.masters.length).toBeGreaterThanOrEqual(2);
    const frames = mt.pub.data.masters.flatMap((m) => m.items).filter((i): i is TextFrame => i.kind === 'text');
    expect(frames.some((f) => storyText(mt, f) === 'aaaa')).toBe(true);
    expect(mt.pub.data.pages[0].items).toHaveLength(0);
    expect(mt.warnings[0]).toMatch(/imported as masters but not applied/);
  });

  it('text paths in a chain take their share of the text', async () => {
    const r = await load('4.0_mac-linked_texts');
    const paths = r.pub.data.pages.flatMap((p) => p.items).filter((i): i is PathTextItem => i.kind === 'pathText');
    const texts = paths.map((p) => p.text.map((x) => x.runs.map((y) => y.text).join('')).join(''));
    expect(texts).toEqual(expect.arrayContaining(['678', 't4']));
    expect(texts.some((t) => t.startsWith('t3qqq'))).toBe(true);
    const chains = r.pub.data.pages.flatMap((p) => p.items).filter((i): i is TextFrame => i.kind === 'text' && !!i.next);
    expect(chains.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => /imported empty/.test(w))).toBe(false);
  });

  it('libraries, books and empty documents fall back with a clear reason', async () => {
    const lib = await load('Q33-TEST.QXL');
    expect(lib.textOnly).toBe(true);
    expect(lib.warnings[0]).toMatch(/holds no document pages/);
    const lib4 = await load('library.qxl');
    expect(lib4.warnings[0]).toMatch(/library files hold no pages/);
    const book = await load('book.qxb');
    expect(book.textOnly).toBe(true);
  });

  it('facing pages and runaround', async () => {
    const f = await load('3.3_mac-facing_pages');
    expect(f.pub.data.pages).toHaveLength(5);
    expect(f.pub.data.facing).toBe(true);
    const r = await load('q4run.qxd');
    const wrapped = items(r).filter((i) => (i as ShapeItem).wrap?.mode === 'square');
    expect(wrapped.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------------------------
  // Checked against LibreOffice's rendering of the same files (its import library reads QuarkXPress
  // from the same public description): the cases below were wrong before that comparison.

  const flatAll = (r: Awaited<ReturnType<typeof load>>, page = 0) => {
    const flat = (list: GroupItem['children']): GroupItem['children'] => list.flatMap((i) => (i.kind === 'group' ? [i, ...flat(i.children)] : [i]));
    return flat(items(r, page));
  };

  it('paragraphs state QuarkXPress spacing so the Body style does not add its own', async () => {
    const r = await load('3.3_win-textboxes.qxd');
    for (const s of r.pub.data.stories) for (const p of s.paras) {
      expect(p.spaceBefore).toBe(0);
      expect(p.spaceAfter).toBe(0);
    }
  });

  it('blends: counter-clockwise angles, second colour at the centre of circular blends', async () => {
    const r = await load('3.3_win-gradients.qxd');
    const fills = items(r).map((i) => (i as ShapeItem).fill).filter((f) => f?.type === 'gradient') as Extract<ShapeItem['fill'], { type: 'gradient' }>[];
    // Box 3 runs from blue at the bottom to yellow at the top (90° counter-clockwise = 270° clockwise).
    expect(fills.some((f) => f.path === 'linear' && f.angle === 270 && f.stops[0].color === '#0000ff')).toBe(true);
    const radial = fills.filter((f) => f.path === 'radial');
    expect(radial.length).toBeGreaterThan(0);
    // The salmon-and-cyan circular blend has salmon at the centre.
    expect(radial.some((f) => f.stops[0].color === '#ff6666' && f.stops[1].color === '#02a0c6')).toBe(true);
  });

  it('lines keep their direction and arrowheads; zero-width lines are hairlines', async () => {
    const r = await load('3.3_mac-arrows');
    const lines = items(r).filter((i): i is LineItem => i.kind === 'line');
    // The thin line rising to the right: its box is normalised and the direction kept by a flip.
    const rising = lines.find((l) => l.w > 200 && l.h > 100)!;
    expect(rising).toBeTruthy();
    expect(rising.flipV).toBe(true);
    expect(rising.line?.tail).toBe('triangle');
    const t = await load('4.0_win-text_paths.qxd');
    const paths = flatAll(t).filter((i): i is PathTextItem => i.kind === 'pathText');
    expect(paths.some((p) => p.line?.width === 0.25 && p.showPath)).toBe(true);
    // Text sits on the top of a thick line (baseline alignment, line alignment top): shifted up by half its width.
    expect(paths.some((p) => p.line && p.line.width! >= 6 && p.baseline === p.line.width! / 2)).toBe(true);
    // Some paths hang their text below the line (ascent alignment).
    expect(paths.some((p) => p.baseline < 0)).toBe(true);
  });

  it('polygon and Bézier boxes keep their outline; vertex lists are read as straight edges', async () => {
    const p = await load('3.3_win-polygons.qxd');
    const star = flatAll(p).find((i): i is ShapeItem => i.kind === 'shape' && i.name === 'Picture Box Outline')!;
    expect(star.geom).toBe('custom');
    expect(star.path![0].d.split('L').length).toBeGreaterThan(30);
    const tb = await load('4.0_win-textboxes.qxd');
    const g = items(tb).find((i): i is GroupItem => i.kind === 'group' && i.name === 'Text Box')!;
    expect(g.children.map((c) => c.kind)).toEqual(['shape', 'text']);
    expect((g.children[0] as ShapeItem).path![0].d).toMatch(/C/);
    const fin = await load('FINCOLOR-4.qxd');
    const bands = flatAll(fin).filter((i): i is ShapeItem => i.kind === 'shape' && i.name === 'Picture Box Outline');
    expect(bands.length).toBe(7);
    expect(bands.every((b) => /^M[^C]*Z$/.test(b.path![0].d))).toBe(true);
  });

  it('frames are drawn inside the box and the text is inset by them', async () => {
    const r = await load('q33_obj_0x2046.qxd');
    const f = items(r).find((i): i is TextFrame => i.kind === 'text' && i.line?.width === 42)!;
    expect(f).toBeTruthy();
    expect([f.x, f.y, f.w, f.h]).toEqual([131.25, 186, 223.25, 140.75]);
    expect(f.insets![0]).toBe(22);
  });

  it('dash styles map to the nearest preset in line widths; stripes are solid', async () => {
    const r = await load('4.0_mac-dashes');
    const lines = items(r).filter((i): i is LineItem => i.kind === 'line');
    // 7.2 pt on, 4.8 pt off on a 6 pt line is nearest to one width on, one width off.
    expect(lines.some((l) => l.line?.width === 6 && l.line.dash === 'sysDot')).toBe(true);
    expect(lines.filter((l) => !l.line?.dash).length).toBeGreaterThanOrEqual(3);
  });

  it('baseline shifts are not turned into subscripts', async () => {
    const r = await load('char-format1.qxd');
    const runs = r.pub.data.stories.flatMap((s) => s.paras.flatMap((p) => p.runs)).filter((x) => x.text);
    expect(runs.map((x) => x.text).join('')).toBe('ab');
    expect(runs.every((x) => x.baseline === undefined)).toBe(true);
    expect(r.warnings.some((w) => /baseline shift/.test(w))).toBe(true);
  });

  it('group members carry page coordinates inside their group, also across the spine of a spread', async () => {
    for (const name of ['4.0_mac-groups', 'group.qxd', 'group-facing.qxd', 'q4_group']) {
      const r = await load(name);
      const groups = r.pub.data.pages.flatMap((p) => p.items).filter((i): i is GroupItem => i.kind === 'group');
      expect(groups.length, name).toBeGreaterThan(0);
      for (const g of groups) for (const c of g.children) {
        // Rotated members (lines) can poke out of the box; their centre stays inside it.
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        expect(cx, `${name} ${c.name}`).toBeGreaterThanOrEqual(g.x - 1);
        expect(cx, `${name} ${c.name}`).toBeLessThanOrEqual(g.x + g.w + 1);
        expect(cy, `${name} ${c.name}`).toBeGreaterThanOrEqual(g.y - 1);
        expect(cy, `${name} ${c.name}`).toBeLessThanOrEqual(g.y + g.h + 1);
      }
    }
  });
});
