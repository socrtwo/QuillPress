/**
 * Type effects and skew: horizontal scale, baseline shift in points, outline and shadow type, item skew,
 * and the effects the PDF writer draws (blurred shadow fallback without a canvas).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import '../../src/commands/index';
import { getCommand } from '../../src/commands/registry';
import { Pub, newId } from '../../src/model/pub';
import type { Item, Paragraph, RunProps } from '../../src/model/types';
import { layoutStory, hscaleOf, segRaise, type LayoutOptions } from '../../src/render/text';
import { pageSvg } from '../../src/render/page';
import { pubToPdf } from '../../src/export/pdf';
import { parsePdfPath, effectsOps } from '../../src/export/pdfEffects';
import { resolveRun } from '../../src/model/styles';

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
const fontLoader = async (url: string): Promise<Uint8Array> => {
  const file = basename(url.split('?')[0]);
  const pkg = file.split(/-(?:latin|cyrillic|greek)-/)[0];
  return new Uint8Array(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}`));
};

/** A layout with a fixed 5 pt per character measure (scaled by nothing but the run's own settings). */
function lay(paras: Paragraph[], w = 400): ReturnType<typeof layoutStory> {
  const o: LayoutOptions = {
    boxes: [{ frame: 'f', col: 0, x: 0, y: 0, w, h: 400 }],
    resolve: () => ({ props: { lineSpacing: 120 }, run: { size: 10 } }),
    resolveRun: (base: RunProps, r: RunProps) => ({ ...base, ...r }),
    measure: (text) => text.length * 5,
  };
  return layoutStory(paras, o);
}

function fakeApp(pub = Pub.blank()) {
  const app: any = {
    pub, prefs: { unit: 'pt', touchMode: false, spellcheck: false }, recording: null,
    tab: { ui: { selection: [] as string[], select(ids: string[]) { this.selection = ids; }, commitText() {}, editText() {}, setTool() {}, invalidate() {} }, masterTarget: '', view: 'single', title: 'Test' },
    get owner() { return pub.pages[0]; }, get page() { return pub.pages[0]; },
    get selected() { return app.tab.ui.selection.map((id: string) => pub.findItem(pub.pages[0], id)).filter(Boolean); },
    exec(id: string, arg?: any) { const c = getCommand(id); if (!c) throw new Error(`no command ${id}`); return c.run(app, arg); },
    refresh() {}, goToPage() {}, isReadOnly: () => false, targetPages: () => [pub.pages[0]], ui: { togglePane() {}, anchorFor: () => document.body },
  };
  return app;
}

describe('text engine', () => {
  it('scales advance widths by the horizontal scale and keeps tracking in points', () => {
    const r = lay([{ style: 'Body', runs: [{ text: 'abcd' }, { text: ' ' }, { text: 'efgh', hscale: 50 }, { text: ' ' }, { text: 'ijkl', hscale: 200, spc: 1 }] }]);
    const segs = r.lines[0].segs.filter((s) => s.text.trim());
    expect(segs.map((s) => s.w)).toEqual([20, 10, 44]); // 4 × 5; half; double plus 4 × 1 pt tracking
    expect(segs[2].x - segs[1].x).toBeCloseTo(10 + 5, 5); // the space between keeps its normal width
    expect(hscaleOf({ hscale: 100 })).toBe(1);
    expect(hscaleOf({})).toBe(1);
  });

  it('raises and lowers runs by points and keeps the line clear of them', () => {
    expect(segRaise({ shift: 3 }, 10)).toBe(3);
    expect(segRaise({ shift: -2, baseline: 33 }, 10 * 0.67)).toBeCloseTo(-2 + 3.3, 5);
    const plain = lay([{ style: 'Body', runs: [{ text: 'one' }] }, { style: 'Body', runs: [{ text: 'two' }] }]);
    const raised = lay([{ style: 'Body', runs: [{ text: 'one ' }, { text: 'up', shift: 12 }] }, { style: 'Body', runs: [{ text: 'two' }] }]);
    const lowered = lay([{ style: 'Body', runs: [{ text: 'one ' }, { text: 'down', shift: -10 }] }, { style: 'Body', runs: [{ text: 'two' }] }]);
    // A raised run pushes its line's baseline down; a lowered run pushes the next line down.
    expect(raised.lines[0].y).toBeGreaterThan(plain.lines[0].y + 5);
    expect(lowered.lines[1].y - lowered.lines[0].y).toBeGreaterThan(plain.lines[1].y - plain.lines[0].y + 5);
  });

  it('keeps the new properties through style resolution and overrides', () => {
    const p = Pub.blank();
    const r = resolveRun(p.data, { size: 12 }, { text: 'x', shift: 2, hscale: 80, outline: true, tshadow: true } as any);
    expect([r.shift, r.hscale, r.outline, r.tshadow]).toEqual([2, 80, true, true]);
  });
});

function demoPub(): Pub {
  const p = Pub.blank();
  p.pages[0].items.push(p.newTextFrame({ x: 36, y: 36, w: 500, h: 200 }, [
    { style: 'Body', runs: [{ text: 'Plain ', font: 'Arimo', size: 14 }, { text: 'OUTLINE', font: 'Arimo', size: 20, outline: true, color: '#ff0000' }, { text: ' and ', font: 'Arimo', size: 14 }, { text: 'SHADOW', font: 'Arimo', size: 20, tshadow: true }] },
    { style: 'Body', runs: [{ text: 'narrow words', font: 'Arimo', size: 14, hscale: 50 }, { text: ' up', font: 'Arimo', size: 14, shift: 4 }, { text: ' after', font: 'Arimo', size: 14 }] },
  ]));
  p.pages[0].items.push({ id: newId('sh'), kind: 'shape', geom: 'rect', x: 100, y: 300, w: 100, h: 50, fill: { type: 'solid', color: '#00ff00' }, skew: 20 } as Item);
  return p;
}

describe('screen rendering', () => {
  it('draws outline, shadow, scaled runs, shifted runs and skewed items', () => {
    const p = demoPub();
    const svg = pageSvg(p, p.pages[0], { mode: 'export' });
    expect(svg).toMatch(/stroke:#ff0000;stroke-width:[\d.]+px/); // outline stroked in the text colour…
    expect(svg).toMatch(/fill="#ffffff" style="[^"]*stroke:#ff0000/); // …over a paper fill
    expect(svg).toContain('class="qp-tshadow"');
    expect(svg).toContain('fill-opacity="0.45"');
    expect(svg).toContain('transform="scale(0.5 1)"'); // the scaled run is its own text element
    expect(svg).toMatch(/baseline-shift="4"/);
    expect(svg).toContain('skewX(-20)');
  });

  it('skews groups about their centre', () => {
    const p = Pub.blank();
    const a = { id: newId('sh'), kind: 'shape', geom: 'rect', x: 0, y: 0, w: 10, h: 10 } as Item;
    p.pages[0].items.push({ id: newId('grp'), kind: 'group', x: 0, y: 0, w: 40, h: 20, children: [a], skew: -10 } as Item);
    expect(pageSvg(p, p.pages[0], { mode: 'export' })).toContain('translate(20 10) skewX(10) translate(-20 -10)');
  });
});

describe('PDF export', () => {
  it('writes Tz in every text object, outline as fill+stroke, a marked shadow pass and Ts-free shifts', async () => {
    const bytes = await pubToPdf(demoPub(), { fontLoader });
    const s = latin1(bytes);
    expect(s).toContain(' 50 Tz');
    // Every text object sets its horizontal scaling (it is text state that outlives ET).
    const bts = s.match(/BT [^]*?ET/g) || [];
    expect(bts.length).toBeGreaterThan(4);
    for (const bt of bts) expect(bt).toMatch(/ \d+(\.\d+)? Tz/);
    expect(s).toMatch(/1 1 1 rg [^]*? 2 Tr [\d.]+ w 1 0 0 RG/); // outline: paper fill, red stroke
    expect(s).toContain('/Span << /ActualText () >> BDC'); // the shadow copy is not text
    expect(s).toContain('/GSa45 gs');
  });

  it('skews items in the content stream as the screen does', async () => {
    const s = latin1(await pubToPdf(demoPub(), { embedFonts: false }));
    // tan(-20°) about the item's centre (150, 325).
    expect(s).toContain('1 0 0 1 150 325 cm\n1 0 -0.364 1 0 0 cm\n1 0 0 1 -150 -325 cm');
  });

  it('falls back to the hard-edged shadow without a canvas and leaves the glow out', async () => {
    const p = Pub.blank();
    const ctx: any = { pub: p, images: new Map(), imgRes: [], w: { add: () => 1, stream: () => 1 }, opts: {}, shadings: [], patterns: new Map(), patRes: [], pageMatrix: '' };
    const path = '0 0 m 100 0 l 100 50 l 0 50 l h';
    const hard = await effectsOps(ctx, { shadow: { color: '#000000', blur: 10, dist: 5, dir: 45, alpha: 0.5 }, glow: { color: '#ff0000', rad: 8 } }, path);
    expect(hard).toContain('/GSa40 gs');
    expect(hard).toMatch(/cm \/GSa40 gs 0 0 0 rg\n0 0 m/);
    expect(ctx.imgRes).toHaveLength(0);
    expect(await effectsOps(ctx, { glow: { color: '#ff0000', rad: 8 } }, path)).toBe('');
  });

  it('parses the path operators it rasterizes', () => {
    const r = parsePdfPath('10 20 m 30 20 l 30 40 40 50 60 70 c h 5 5 10 10 re f')!;
    expect(r.segs.map((s) => s.op)).toEqual(['m', 'l', 'c', 'h', 're']);
    expect(r.box).toEqual([5, 5, 60, 70]);
    expect(parsePdfPath('f S')).toBeNull();
  });
});

describe('commands', () => {
  it('toggle outline and shadow, set scale and shift, and skew objects', () => {
    for (const id of ['fmt.outline', 'fmt.textShadow', 'fmt.hscale', 'fmt.baselineShiftPoints', 'arrange.skew']) expect(getCommand(id), id).toBeTruthy();
    const app = fakeApp();
    const pub: Pub = app.pub;
    app.exec('insert.textOnPath', { preset: 'circle', text: 'Round' });
    const pt = pub.pages[0].items[0] as any;
    app.exec('fmt.outline'); app.exec('fmt.textShadow'); app.exec('fmt.hscale', 80); app.exec('fmt.baselineShiftPoints', 2);
    expect([pt.text[0].runs[0].outline, pt.text[0].runs[0].tshadow, pt.text[0].runs[0].hscale, pt.text[0].runs[0].shift]).toEqual([true, true, 80, 2]);
    app.exec('fmt.hscale', 100); app.exec('fmt.outline');
    expect([pt.text[0].runs[0].hscale, pt.text[0].runs[0].outline]).toEqual([undefined, undefined]);
    app.exec('arrange.skew', 30);
    expect(pt.skew).toBe(30);
    app.exec('arrange.skew', 90);
    expect(pt.skew).toBe(75); // clamped
    app.exec('arrange.skew', 0);
    expect(pt.skew).toBeUndefined();
  });
});

describe('soft edges', () => {
  const softPub = () => {
    const p = Pub.blank({ w: 400, h: 300 }, { pages: 1 });
    p.pages[0].items.push({ id: 'e', kind: 'shape', geom: 'ellipse', x: 50, y: 50, w: 200, h: 120, fill: { type: 'solid', color: '#C00000' }, effects: { softEdge: 20, shadow: { color: '#000000', blur: 6, dist: 6, dir: 45, alpha: 0.5 }, glow: { color: '#FFC000', rad: 8 } } } as Item);
    return p;
  };

  it('feathers the object on screen with a round mask and chains glow and shadow onto it', () => {
    const svg = pageSvg(softPub(), softPub().pages[0], {});
    const filter = /<filter[\s\S]*?<\/filter>/.exec(svg)![0];
    // Round feather: blur of the alpha remapped to 2a − 1 (no square erosion), contents kept sharp.
    expect(filter).toContain(`<feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round((20 / 2.25) * 100) / 100}" result="sb"/>`);
    expect(filter).toContain('<feFuncA type="linear" slope="2" intercept="-1"/>');
    expect(filter).toContain('<feComposite in="SourceGraphic" in2="sf" operator="in" result="soft"/>');
    expect(filter).not.toContain('operator="erode"');
    // The glow sits behind the softened object and the shadow is cast by both.
    expect(filter).toContain('<feMergeNode in="soft"/>');
    expect(filter).toContain('<feDropShadow in="glowed"');
  });

  it('exports a valid PDF without a canvas, drawing the object unfaded', async () => {
    const pdf = new TextDecoder('latin1').decode(await pubToPdf(softPub()));
    expect(pdf).not.toContain('/SMask << /Type /Mask');
    expect(pdf).toMatch(/0\.753 0 0 rg|0\.75\d* 0 0 rg/);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
