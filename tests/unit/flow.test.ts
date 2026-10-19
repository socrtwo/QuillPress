import { describe, it, expect } from 'vitest';
import { Pub, parasFromText } from '../../src/model/pub';
import { layoutStory, bulletText, formatNumber, hyphenPoints } from '../../src/render/text';
import { frameBoxes, storyLayout, oversetFrames, neededHeight, wrapExclusions } from '../../src/render/flow';
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
