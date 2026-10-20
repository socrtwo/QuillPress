import { describe, it, expect } from 'vitest';
import '../../src/commands/index';
import { allCommands, getCommand } from '../../src/commands/registry';
import { DEFAULT_TABS } from '../../src/ui/ribbonLayout';
import { PANES } from '../../src/ui/panes';
import { smartQuotes, cleanupParas } from '../../src/commands/tools';
import { parseTabs } from '../../src/commands/fmt';
import { parseTsv } from '../../src/commands/insert';
import { findAll } from '../../src/commands/edit';
import { parseRange, printPages } from '../../src/export/print';
import { parseDraft, parseJsonLoose, linesOf } from '../../src/ai/press';
import { Pub, parasFromText } from '../../src/model/pub';
import { spellTargets, wordsIn, replaceInParagraph, dialectFor, SpellSession, type SpellChecker } from '../../src/proof/proofing';
import { storyLayout, layoutOptions } from '../../src/render/flow';
import { pathTextGlyphs } from '../../src/render/pathText';
import { pageSvg } from '../../src/render/page';

describe('command modules', () => {
  it('registers several hundred commands across every area', () => {
    const cmds = allCommands();
    expect(cmds.length).toBeGreaterThan(400);
    const areas = new Set(cmds.map((c) => c.id.split('.')[0]));
    for (const a of ['file', 'edit', 'view', 'fmt', 'insert', 'page', 'text', 'arrange', 'shape', 'picture', 'table', 'review', 'tools', 'ai', 'dev', 'help']) expect(areas.has(a), a).toBe(true);
    const ids = cmds.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.[A-Za-z0-9.]+$/);
  });

  it('exposes every contextual tab and the panes the commands open', () => {
    expect(DEFAULT_TABS.filter((t) => t.contextual).map((t) => t.id)).toEqual(['masterPage', 'textFrame', 'pictureFormat', 'shapeFormat', 'lineFormat', 'textPath', 'tableDesign', 'tableLayout']);
    for (const id of ['navigator', 'layers', 'styles', 'swatches', 'threads', 'versions', 'clipboard', 'preflight', 'accessibility', 'links', 'comments', 'footnotes']) expect(PANES[id], id).toBeTruthy();
  });

  it('marks document-changing commands and keeps navigation out of macros', () => {
    expect(getCommand('fmt.bold')?.edits).toBe(true);
    expect(getCommand('page.next')?.noRecord).toBe(true);
    expect(getCommand('edit.undo')?.keys).toContain('Mod-z');
    expect(getCommand('review.spelling')?.keys).toContain('F7');
  });
});

describe('text helpers', () => {
  it('converts quotes and cleans pasted text', () => {
    expect(smartQuotes('"Hi," she said. It\'s 5\' tall.')).toBe('“Hi,” she said. It’s 5′ tall.');
    const out = cleanupParas([{ style: 'Body', runs: [{ text: 'A line that is bro-' }] }, { style: 'Body', runs: [{ text: 'ken  across lines .' }] }, { style: 'Body', runs: [{ text: 'New sentence.' }] }], { joinLines: true, dehyphenate: true, spaces: true, quotes: true, ligatures: true });
    expect(out).toHaveLength(2);
    expect(out[0].runs.map((r) => r.text).join('')).toBe('A line that is broken across lines.');
  });

  it('parses tab stops, separated values, ranges and AI answers', () => {
    expect(parseTabs('72 l\n300 r .')).toEqual([{ pos: 72, align: 'l', leader: undefined }, { pos: 300, align: 'r', leader: '.' }]);
    expect(parseTsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTsv('"a";b')).toEqual([['a', 'b']]);
    expect([...parseRange('1-2, 4', 5)!]).toEqual([0, 1, 3]);
    expect(parseRange('', 5)).toBeNull();
    expect(parseJsonLoose('Here: ```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(linesOf('- one\n2. two\n\n• three')).toEqual(['one', 'two', 'three']);
    const d = parseDraft('{"title":"T","pages":[{"heading":"H","body":["p1","p2"]}]}')!;
    expect(d.pages[0].body).toHaveLength(2);
    const md = parseDraft('# Title\n## First\npara\n## Second\nmore')!;
    expect(md.title).toBe('Title');
    expect(md.pages.map((p) => p.heading)).toEqual(['First', 'Second']);
  });

  it('finds text across stories and table cells', () => {
    const p = Pub.blank();
    p.pages[0].items.push(p.newTextFrame({ x: 0, y: 0, w: 100, h: 100 }, parasFromText('The cat sat.\nThe Cat again')));
    p.pages[0].items.push({ id: 't', kind: 'table', x: 0, y: 0, w: 10, h: 10, cols: [10], rows: [{ h: 10, cells: [{ text: parasFromText('a cat') }] }] } as any);
    expect(findAll(p, 'cat')).toHaveLength(3);
    expect(findAll(p, 'cat', { matchCase: true })).toHaveLength(2);
    expect(findAll(p, 'cat', { whole: true, matchCase: false }).filter((h) => h.item)).toHaveLength(1);
  });

  it('builds print sheets with crop marks and spreads', () => {
    const p = Pub.blank({ w: 612, h: 792 }, { facing: true, pages: 3 });
    p.data.bleed = 9;
    const single = printPages(p, { range: '2-3', marks: true, bleed: true });
    expect(single.pages).toHaveLength(2);
    expect(single.pages[0]).toContain('qp-pp-marks');
    const spreads = printPages(p, { spreads: true });
    expect(spreads.pages).toHaveLength(2);
    expect(spreads.pages[1]).toContain('qp-pp-spread');
  });
});

describe('proofing', () => {
  it('lists words and paragraphs to check in reading order', () => {
    const p = Pub.blank({ w: 612, h: 792 }, { pages: 2 });
    p.pages[1].items.push(p.newTextFrame({ x: 0, y: 0, w: 100, h: 100 }, parasFromText('second page')));
    p.pages[0].items.push(p.newTextFrame({ x: 0, y: 0, w: 100, h: 100 }, parasFromText('first page')));
    p.pages[0].items.push({ id: 't', kind: 'table', x: 0, y: 0, w: 10, h: 10, cols: [10], rows: [{ h: 10, cells: [{ text: parasFromText('cell text') }] }] } as any);
    const t = spellTargets(p.data);
    expect(t.map((x) => x.para.runs[0].text)).toEqual(['first page', 'cell text', 'second page']);
    expect(spellTargets(p.data, { fromPage: p.pages[1].id }).map((x) => x.para.runs[0].text)[0]).toBe('second page');
    expect(wordsIn('Visit www.example.com for A4 paper and NASA data').map((w) => w.word)).toEqual(['Visit', 'for', 'paper', 'and', 'data']);
    expect(dialectFor('document', 'en-AU')).toBe('en-AU');
    expect(dialectFor('any', 'en-GB')).toBe('any');
  });

  it('walks misspellings and applies changes through the writer', async () => {
    const p = Pub.blank();
    p.pages[0].items.push(p.newTextFrame({ x: 0, y: 0, w: 100, h: 100 }, parasFromText('Teh quick fox. Teh end.')));
    const checker: SpellChecker = { async check(words) { return new Set(words.filter((w) => w === 'Teh')); }, async suggest() { return ['The']; } };
    const s = new SpellSession(spellTargets(p.data), checker, { dict: 'any', ignored: new Set(), dictionary: new Set(), write: (t, a, b, text) => { replaceInParagraph(t.para, a, b, text); return true; } });
    await s.start();
    const first = await s.next();
    expect(first?.word).toBe('Teh');
    expect(s.changeAll('The')).toBe(true);
    expect(await s.next()).toBeNull();
    expect(p.data.stories[0].paras[0].runs.map((r) => r.text).join('')).toBe('The quick fox. The end.');
    expect(s.changed).toBe(2);
  });
});

/** Enough of App for commands that work on the first page's items. */
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

describe('anchored objects, footnotes and text on a path commands', () => {
  it('registers the new ids', () => {
    for (const id of ['arrange.anchorInline', 'arrange.anchorAbove', 'arrange.anchorCustom', 'arrange.releaseAnchor', 'arrange.anchorOptions', 'insert.inlinePicture', 'insert.inlineFrame', 'text.insertFootnote', 'text.editFootnote', 'text.deleteFootnote', 'text.nextFootnote', 'text.prevFootnote', 'text.goToReference', 'text.footnoteOptions', 'text.footnotesToEndnotes', 'text.endnotesToFootnotes', 'text.footnotesPane', 'insert.textOnPath', 'path.fromShape', 'path.editText', 'path.align', 'path.offset', 'path.baseline', 'path.flip', 'path.spacing', 'path.showPath', 'path.release']) expect(getCommand(id), id).toBeTruthy();
    expect(getCommand('text.insertFootnote')?.keys).toContain('Mod-Alt-f');
  });

  it('anchors a picture in a frame, changes its options, releases it, and undoes', () => {
    const app = fakeApp();
    const pub: Pub = app.pub;
    const f = pub.newTextFrame({ x: 36, y: 36, w: 300, h: 200 }, parasFromText('One two three four five six.'));
    const pic = { id: 'pic', kind: 'picture', x: 400, y: 400, w: 50, h: 30 } as any;
    pub.pages[0].items.push(f, pic);
    app.tab.ui.select([f.id, 'pic']);
    expect(app.exec('arrange.anchorInline')).toBe(1);
    expect(pic.anchored).toEqual({ story: f.story, mode: 'inline' });
    const s = pub.story(f.story)!;
    expect(s.paras[0].runs[0]).toEqual({ text: '￼', anchor: 'pic' });
    expect(pub.pages[0].items.indexOf(pic)).toBe(pub.pages[0].items.indexOf(f) + 1);
    app.tab.ui.select(['pic']);
    app.exec('arrange.anchorOptions', { mode: 'above', dx: 5, dy: 3, align: 'ctr' });
    expect(pic.anchored).toEqual({ story: f.story, mode: 'above', dx: 5, dy: 3, align: 'ctr' });
    app.exec('arrange.releaseAnchor');
    expect(pic.anchored).toBeUndefined();
    expect(s.paras[0].runs.some((r) => r.anchor)).toBe(false);
    pub.undo();
    expect(pub.data.pages[0].items.find((e) => e.id === 'pic')?.anchored?.mode).toBe('above');
    pub.undo(); pub.undo();
    expect(pub.data.pages[0].items.find((e) => e.id === 'pic')?.anchored).toBeUndefined();
    expect(pub.story(f.story)!.paras[0].runs.some((r) => r.anchor)).toBe(false);
    // Anchoring at an offset keeps the object where it was.
    app.tab.ui.select([f.id, 'pic']);
    const at = { x: pic.x, y: pic.y };
    app.exec('arrange.anchorCustom');
    const p2 = pub.pages[0].items.find((e) => e.id === 'pic')!;
    expect(p2.anchored?.mode).toBe('custom');
    expect(p2.x).toBeCloseTo(at.x, 0); expect(p2.y).toBeCloseTo(at.y, 0);
  });

  it('inserts, numbers, converts and deletes footnotes', () => {
    const app = fakeApp();
    const pub: Pub = app.pub;
    const f = pub.newTextFrame({ x: 36, y: 36, w: 300, h: 300 }, parasFromText('A claim.\nAnother claim.'));
    pub.pages[0].items.push(f);
    app.tab.ui.select([f.id]);
    app.exec('text.insertFootnote', 'Source one');
    app.exec('text.insertFootnote', 'Source two');
    const s = pub.story(f.story)!;
    expect(s.footnotes).toHaveLength(2);
    expect(pub.data.styles.para.some((x) => x.name === 'Footnote')).toBe(true);
    const refs = s.paras[1].runs.filter((r) => r.footnote);
    expect(refs.map((r) => r.text)).toEqual(['1', '2']);
    const lay = storyLayout(pub, f.story)!;
    expect(lay.r.lines.filter((l) => l.footnote).length).toBe(2);
    app.exec('text.footnoteOptions', { scheme: 'symbols' });
    expect(storyLayout(pub, f.story)!.r.footnoteLabels).toEqual({ [refs[0].footnote!]: '*', [refs[1].footnote!]: '†' });
    expect(s.paras[1].runs.filter((r) => r.footnote).map((r) => r.text)).toEqual(['*', '†']);
    app.exec('text.footnotesToEndnotes');
    expect(s.footnotes).toBeUndefined();
    expect(s.paras.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['A claim.', 'Another claim.*†', 'Notes', '* Source one', '† Source two']);
    app.exec('text.endnotesToFootnotes');
    expect(s.footnotes?.map((x) => x.paras[0].runs.map((r) => r.text).join(''))).toEqual(['Source one', 'Source two']);
    expect(s.paras).toHaveLength(2);
    expect(s.paras[1].runs.filter((r) => r.footnote)).toHaveLength(2);
    app.exec('text.deleteFootnote', s.footnotes![0].id);
    expect(s.footnotes).toHaveLength(1);
    expect(s.paras[1].runs.filter((r) => r.footnote)).toHaveLength(1);
    pub.undo();
    expect(pub.story(f.story)!.footnotes).toHaveLength(2);
    const t = spellTargets(pub.data);
    expect(t.some((x) => x.para.runs[0]?.text === 'Source one')).toBe(true);
  });

  it('makes text on a path from presets and shapes, formats it, and releases it', () => {
    const app = fakeApp();
    const pub: Pub = app.pub;
    app.exec('insert.textOnPath', { preset: 'circle', text: 'Round and round' });
    const pt = pub.pages[0].items[0] as any;
    expect(pt.kind).toBe('pathText');
    expect(pt.path.d).toContain('A');
    expect(pt.text[0].runs[0].text).toBe('Round and round');
    expect(app.tab.ui.selection).toEqual([pt.id]);
    app.exec('path.align', 'end');
    expect(pt.align).toBe('end');
    app.exec('path.editText', 'New words');
    expect(pt.text[0].runs[0].text).toBe('New words');
    expect(pt.text[0].runs[0].size).toBe(18);
    app.exec('fmt.italic');
    expect(pt.text[0].runs[0].i).toBe(true);
    app.exec('path.offset', 12); app.exec('path.baseline', -3); app.exec('path.spacing', 1); app.exec('path.flip'); app.exec('path.showPath');
    expect([pt.offset, pt.baseline, pt.spacing, pt.flip, pt.showPath]).toEqual([12, -3, 1, true, true]);
    const glyphs = pathTextGlyphs(pt, layoutOptions(pub, []));
    expect(glyphs.map((g) => g.ch).join('')).toBe('Newwords');
    expect(pageSvg(pub, pub.pages[0], { mode: 'export' })).toContain('rotate(');
    app.exec('path.release');
    const tf = pub.pages[0].items[0] as any;
    expect(tf.kind).toBe('text');
    expect(pub.story(tf.story)!.paras[0].runs[0].text).toBe('New words');
    pub.undo();
    expect(pub.pages[0].items[0].kind).toBe('pathText');
    const sh = { id: 'sh', kind: 'shape', geom: 'ellipse', x: 10, y: 10, w: 100, h: 60 } as any;
    pub.pages[0].items.push(sh);
    app.tab.ui.select(['sh']);
    app.exec('path.fromShape', { keep: false, text: 'Along the oval' });
    expect(pub.pages[0].items.some((e) => e.id === 'sh')).toBe(false);
    const from = pub.pages[0].items[1] as any;
    expect(from.kind).toBe('pathText');
    expect(from.w).toBe(100);
    expect(pathTextGlyphs(from, layoutOptions(pub, [])).length).toBe('Alongtheoval'.length);
  });
});
