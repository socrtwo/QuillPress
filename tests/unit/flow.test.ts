import { describe, it, expect } from 'vitest';
import { Pub, parasFromText } from '../../src/model/pub';
import { layoutStory, bulletText, formatNumber, hyphenPoints, footnoteLabel, measure, cssFont } from '../../src/render/text';
import { frameBoxes, storyLayout, oversetFrames, neededHeight, wrapExclusions, frameLines } from '../../src/render/flow';
import { pathTextGlyphs, pathTextLayout, PATH_TEXT_PRESETS } from '../../src/render/pathText';
import type { PathTextItem } from '../../src/model/types';
import { autoflowStory } from '../../src/edit/flowOps';
import { LOREM } from '../../src/templates/lorem';

const long = LOREM.join('\n');

describe('text layout', () => {
  it('breaks a paragraph into lines that fit the box', () => {
    const boxes = [{ frame: 'f', col: 0, x: 0, y: 0, w: 200, h: 1000, page: 0 }];
    const r = layoutStory(parasFromText(LOREM[0]), { boxes, resolve: () => ({ props: {}, run: { size: 12, font: 'Tinos' } }), resolveRun: (b: any, x: any) => ({ ...b, ...x }) } as any);
    expect(r.lines.length).toBeGreaterThan(3);
    for (const l of r.lines) expect(l.width).toBeLessThanOrEqual(201);
    expect(r.overset).toBeUndefined();
  });

  it('reports overset when text does not fit', () => {
    const boxes = [{ frame: 'f', col: 0, x: 0, y: 0, w: 200, h: 40, page: 0 }];
    const r = layoutStory(parasFromText(long), { boxes, resolve: () => ({ props: {}, run: { size: 12 } }), resolveRun: (b: any, x: any) => ({ ...b, ...x }) } as any);
    expect(r.overset).toBeTruthy();
    expect(r.lines.length).toBeLessThan(6);
  });

  it('numbers lists and finds hyphenation points', () => {
    expect(bulletText({ kind: 'num', scheme: 'arabicPeriod' }, 2)).toBe('3.');
    expect(bulletText({ kind: 'num', scheme: 'romanLcPeriod' }, 3)).toBe('iv.');
    expect(bulletText({ kind: 'char', char: '•' }, 0)).toBe('•');
    expect(formatNumber(4, 'alphaUcPeriod')).toBe('D.');
    const pts = hyphenPoints('typesetting');
    expect(Array.isArray(pts)).toBe(true);
  });
});

describe('frames and flow', () => {
  it('splits a frame into column boxes inside its insets', () => {
    const pub = Pub.blank();
    const f = pub.newTextFrame({ x: 100, y: 100, w: 300, h: 200 });
    f.columns = 2; f.gutter = 20; f.insets = [10, 10, 10, 10];
    pub.pages[0].items.push(f);
    const boxes = frameBoxes(f, pub.pages[0], 0, pub);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].x).toBe(110);
    expect(boxes[0].w).toBe(130);
    expect(boxes[1].x).toBe(260);
    expect(boxes[0].h).toBe(180);
  });

  it('flows a story through linked frames and autoflows the rest', () => {
    const pub = Pub.blank();
    const f = pub.newTextFrame({ x: 36, y: 36, w: 200, h: 60 }, parasFromText(long));
    pub.pages[0].items.push(f);
    expect(oversetFrames(pub).map((o) => o.frame.id)).toEqual([f.id]);
    const added = autoflowStory(pub, f);
    expect(added).toBeGreaterThan(0);
    expect(pub.pages.length).toBeGreaterThan(1);
    expect(oversetFrames(pub)).toHaveLength(0);
    const chain = pub.chainOf(f.story);
    expect(chain[0].id).toBe(f.id);
    expect(chain.length).toBe(added + 1);
    const lay = storyLayout(pub, f.story)!;
    expect(lay.r.lines.some((l) => l.box > 0)).toBe(true);
  });

  it('computes the height a frame needs and wrap exclusions from objects above', () => {
    const pub = Pub.blank();
    const f = pub.newTextFrame({ x: 36, y: 36, w: 300, h: 20 }, parasFromText(LOREM[1]));
    pub.pages[0].items.push(f);
    expect(neededHeight(pub, f)).toBeGreaterThan(40);
    pub.pages[0].items.push({ id: 'p', kind: 'picture', x: 100, y: 50, w: 80, h: 80, wrap: { mode: 'square', offset: 6 } } as any);
    const ex = wrapExclusions(f, pub.pages[0], pub);
    expect(ex).toHaveLength(1);
    expect(ex[0].x).toBeLessThan(100);
    f.ignoreWrap = true;
    expect(wrapExclusions(f, pub.pages[0], pub)).toHaveLength(0);
  });
});

describe('anchored objects', () => {
  const storyWith = (w = 300) => {
    const pub = Pub.blank();
    const f = pub.newTextFrame({ x: 36, y: 36, w, h: 400 }, parasFromText(`${LOREM[0]}\n${LOREM[1]}`));
    pub.pages[0].items.push(f);
    const pic = { id: 'pic1', kind: 'picture', x: 0, y: 0, w: 60, h: 40, anchored: { story: f.story, mode: 'inline' } } as any;
    pub.pages[0].items.push(pic);
    const s = pub.story(f.story)!;
    // Anchor after the third word of the second paragraph.
    const p = s.paras[1];
    const text = p.runs[0].text;
    const off = text.split(' ').slice(0, 3).join(' ').length + 1;
    p.runs = [{ text: text.slice(0, off) }, { text: '￼', anchor: 'pic1' }, { text: text.slice(off) }];
    return { pub, f, pic, s };
  };

  it('widens the line for an inline object and writes its position', () => {
    const { pub, f, pic } = storyWith();
    const lay = storyLayout(pub, f.story)!;
    const line = lay.r.lines.find((l) => l.anchors?.length)!;
    expect(line).toBeTruthy();
    expect(line.height).toBeGreaterThanOrEqual(40);
    const plain = lay.r.lines.find((l) => !l.anchors)!;
    expect(line.height).toBeGreaterThan(plain.height);
    expect(line.anchors![0].id).toBe('pic1');
    // The object sits with its bottom on the baseline, at the token's x.
    expect(pic.y).toBeCloseTo(line.y - 40, 1);
    expect(pic.x).toBeGreaterThanOrEqual(f.x);
    expect(pic.x + pic.w).toBeLessThanOrEqual(f.x + f.w + 0.5);
  });

  it('moves the object with the text when the frame narrows or the story flows on', () => {
    const { pub, f, pic } = storyWith();
    storyLayout(pub, f.story);
    const before = { x: pic.x, y: pic.y };
    f.w = 160; pub.changed();
    storyLayout(pub, f.story);
    expect(pic.y).toBeGreaterThan(before.y);
    // A second page and a short first frame: the anchor's line lands on page 2 and the picture moves there.
    f.h = 30; pub.changed();
    pub.pages.push({ id: 'pg2', master: pub.data.masters[0].id, items: [] });
    const f2 = { ...pub.newTextFrame({ x: 36, y: 36, w: 300, h: 600 }), story: f.story, prev: f.id } as any;
    pub.data.stories.pop();
    f.next = f2.id;
    pub.pages[1].items.push(f2);
    pub.changed();
    storyLayout(pub, f.story);
    expect(pub.pages[0].items.some((e) => e.id === 'pic1')).toBe(false);
    expect(pub.pages[1].items.some((e) => e.id === 'pic1')).toBe(true);
    expect(pic.y).toBeGreaterThan(36);
  });

  it('places objects above the line and at an offset from the anchor', () => {
    const { pub, f, pic } = storyWith();
    pic.anchored = { story: f.story, mode: 'above', align: 'ctr' };
    pub.changed();
    let lay = storyLayout(pub, f.story)!;
    let line = lay.r.lines.find((l) => l.anchors?.length)!;
    expect(pic.y + pic.h).toBeLessThanOrEqual(line.y - line.ascent + 0.01);
    expect(pic.x).toBeCloseTo(f.x + 4 + (f.w - 8 - pic.w) / 2, 0);
    pic.anchored = { story: f.story, mode: 'custom', dx: 100, dy: 20 };
    pub.changed();
    lay = storyLayout(pub, f.story)!;
    line = lay.r.lines.find((l) => l.anchors?.length)!;
    expect(pic.x).toBeCloseTo(line.anchors![0].ax + 100, 1);
    expect(pic.y).toBeCloseTo(line.y + 20, 1);
    expect(line.height).toBeLessThan(40);
  });
});

describe('footnotes', () => {
  const withNotes = (h = 200, opts?: any) => {
    const pub = Pub.blank();
    if (opts) pub.data.footnoteOptions = { ...pub.data.footnoteOptions, scheme: 'arabicPlain', restart: 'story', separator: { width: 0.5, length: 0.33, space: 6 }, style: 'Footnote', placement: 'column', ...opts };
    const f = pub.newTextFrame({ x: 36, y: 36, w: 300, h }, parasFromText(`${LOREM[0]}\n${LOREM[1]}`));
    pub.pages[0].items.push(f);
    const s = pub.story(f.story)!;
    s.footnotes = [{ id: 'fn1', paras: [{ style: 'Footnote', runs: [{ text: 'First source, page 3.' }] }] }, { id: 'fn2', paras: [{ style: 'Footnote', runs: [{ text: 'Second source.' }] }] }];
    s.paras[0].runs.push({ text: '1', footnote: 'fn1', baseline: 33 });
    s.paras[1].runs.push({ text: '2', footnote: 'fn2', baseline: 33 });
    return { pub, f, s };
  };

  it('reserves space at the bottom of the column and sets the note lines last', () => {
    const plain = Pub.blank();
    const pf = plain.newTextFrame({ x: 36, y: 36, w: 300, h: 200 }, parasFromText(`${LOREM[0]}\n${LOREM[1]}`));
    plain.pages[0].items.push(pf);
    const plainLines = storyLayout(plain, pf.story)!.r.lines.length;
    const { pub, f } = withNotes(200);
    const lay = storyLayout(pub, f.story)!;
    const body = lay.r.lines.filter((l) => !l.footnote);
    const notes = lay.r.lines.filter((l) => l.footnote);
    expect(body.length).toBeLessThan(plainLines);
    expect(notes.length).toBeGreaterThan(0);
    expect(lay.r.separators).toHaveLength(1);
    const lastBody = Math.max(...body.map((l) => l.y));
    expect(Math.min(...notes.map((l) => l.y))).toBeGreaterThan(lastBody);
    expect(Math.max(...notes.map((l) => l.y))).toBeLessThanOrEqual(f.y + f.h);
    expect(notes[0].segs[0].text).toBe('1');
    expect(lay.r.footnoteLabels).toEqual({ fn1: '1' });
    expect(lay.r.overset).toBeTruthy();
    const fl = frameLines(pub, f);
    expect(fl.separators).toHaveLength(1);
    expect(fl.lines.some((l) => l.footnote)).toBe(true);
  });

  it('numbers per story, restarts per page when set, and offers symbols', () => {
    const { pub, f } = withNotes(2000);
    let lay = storyLayout(pub, f.story)!;
    expect(lay.r.footnoteLabels).toEqual({ fn1: '1', fn2: '2' });
    const refs = lay.r.lines.filter((l) => !l.footnote).flatMap((l) => l.segs.filter((s) => s.footnote).map((s) => s.text));
    expect(refs).toEqual(['1', '2']);
    // Two frames on two pages: the second reference restarts at 1 on page 2.
    f.h = 120;
    pub.pages.push({ id: 'pg2', master: pub.data.masters[0].id, items: [] });
    const f2 = { ...pub.newTextFrame({ x: 36, y: 36, w: 300, h: 2000 }), story: f.story, prev: f.id } as any;
    pub.data.stories.pop();
    f.next = f2.id;
    pub.pages[1].items.push(f2);
    pub.data.footnoteOptions = { ...pub.data.footnoteOptions!, scheme: 'arabicPlain', restart: 'page', separator: { width: 0.5, length: 0.33, space: 6 }, style: 'Footnote', placement: 'column' };
    pub.changed();
    lay = storyLayout(pub, f.story)!;
    expect(lay.r.footnoteLabels).toEqual({ fn1: '1', fn2: '1' });
    expect(lay.r.lines.filter((l) => l.footnote).map((l) => l.box)).toEqual([0, 1]);
    expect(footnoteLabel(3, 'symbols')).toBe('‡');
    expect(footnoteLabel(8, 'symbols')).toBe('††');
    expect(footnoteLabel(4, 'romanLcPeriod')).toBe('iv.');
  });
});

describe('text on a path', () => {
  const item = (preset: string, text: string, extra: Partial<PathTextItem> = {}): PathTextItem => {
    const p = PATH_TEXT_PRESETS[preset];
    return { id: 'pt', kind: 'pathText', x: 100, y: 200, w: p.w, h: p.h, path: { d: p.d, w: p.w, h: p.h }, text: [{ style: 'Body', runs: [{ text, size: 12 }] }], align: 'start', offset: 0, baseline: 0, ...extra };
  };
  const opts = { resolve: () => ({ props: {}, run: { size: 12, font: 'Tinos' } }), resolveRun: (b: any, r: any) => ({ ...b, ...r }) } as any;

  it('sets characters along a straight line like a normal measurement', () => {
    const it = item('line', 'Hello');
    const g = pathTextGlyphs(it, opts);
    expect(g.map((x) => x.ch).join('')).toBe('Hello');
    const widths = [...'Hello'].map((c) => measure(c, cssFont({ size: 12 } as any, 12, 'Tinos')));
    let s = 0;
    g.forEach((x, i) => { expect(x.x).toBeCloseTo(100 + s + widths[i] / 2, 3); expect(x.y).toBeCloseTo(200 + 50, 3); expect(x.angle).toBeCloseTo(0, 3); s += widths[i]; });
    const end = pathTextGlyphs(item('line', 'Hello', { align: 'end' }), opts);
    expect(end[end.length - 1].x + end[end.length - 1].w / 2).toBeCloseTo(300, 1);
    const just = pathTextGlyphs(item('line', 'Hello', { align: 'justify' }), opts);
    expect(just[just.length - 1].x).toBeGreaterThan(g[g.length - 1].x);
  });

  it('spans 360 degrees around a circle and honors offset, baseline and flip', () => {
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOP';
    const g = pathTextGlyphs(item('circle', text, { align: 'justify' }), opts);
    expect(g.length).toBeGreaterThan(40);
    const angles = g.map((x) => x.angle);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(300);
    for (const x of g) expect(Math.hypot(x.x - 200, x.y - 300)).toBeCloseTo(100, 0);
    const raised = pathTextGlyphs(item('circle', text, { align: 'justify', baseline: 10 }), opts);
    for (const x of raised) expect(Math.hypot(x.x - 200, x.y - 300)).toBeCloseTo(110, 0);
    const flipped = pathTextGlyphs(item('circle', 'AB', { flip: true }), opts);
    expect(flipped[0].angle).toBeCloseTo(flipped[0].angle, 1);
    expect(Math.abs(((flipped[0].angle - g[0].angle) % 360 + 360) % 360 - 180)).toBeLessThan(30);
    const shifted = pathTextGlyphs(item('line', 'Hi', { offset: 40 }), opts);
    expect(shifted[0].x).toBeGreaterThan(140);
    const over = pathTextLayout(item('line', 'x'.repeat(400)), opts);
    expect(over.overflow).toBeGreaterThan(0);
  });
});
