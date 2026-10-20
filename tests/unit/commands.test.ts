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
