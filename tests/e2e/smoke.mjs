// Browser smoke test: serves dist/ with `vite preview`, builds a small publication, and checks the results.
// Usage: npm run build && npm run e2e   (set QP_URL to test an already-running server instead)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4193;
let server = null;
let url = process.env.QP_URL;
if (!url) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  url = `http://localhost:${PORT}/`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const exe = existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
const browser = await chromium.launch(exe);
const failures = [];
const check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.addInitScript(() => localStorage.setItem('quillpress.prefs.v1', JSON.stringify({ firstRun: false })));
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForSelector('.qp-page-host svg');
  await p.waitForTimeout(500);

  check('commands registered', await p.evaluate(() => window.__qpAllIds.length > 400), true);
  check('blank publication', await p.evaluate(() => [qp.pub.pages.length, qp.pub.size.w, qp.pub.size.h]), [1, 612, 792]);

  // A text frame placed by command, typed into, and committed.
  await p.evaluate(() => qp.exec('insert.textFrame', 'Hello press'));
  check('frame text', await p.evaluate(() => qp.pub.story(qp.page.items[0].story).paras[0].runs.map((r) => r.text).join('')), 'Hello press');
  const box = await p.evaluate(() => { const r = document.querySelector('.qp-page-host [data-id]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + 12]; });
  await p.mouse.dblclick(box[0], box[1]);
  await p.keyboard.press('End');
  await p.keyboard.type(' and more');
  await p.keyboard.press('Escape');
  check('typed text', await p.evaluate(() => qp.pub.story(qp.page.items[0].story).paras[0].runs.map((r) => r.text).join('')), 'Hello press and more');

  // Formatting through commands, then undo/redo.
  await p.evaluate(() => { qp.tab.ui.select([qp.page.items[0].id]); qp.exec('fmt.bold'); });
  check('bold', await p.evaluate(() => !!qp.pub.story(qp.page.items[0].story).paras[0].runs[0].b), true);
  await p.evaluate(() => qp.exec('edit.undo'));
  check('undo', await p.evaluate(() => !!qp.pub.story(qp.page.items[0].story).paras[0].runs[0].b), false);
  await p.evaluate(() => qp.exec('edit.redo'));
  check('redo', await p.evaluate(() => !!qp.pub.story(qp.page.items[0].story).paras[0].runs[0].b), true);

  // A footnote inserted while editing shows its note at the bottom of the frame, starting with its number.
  await p.mouse.dblclick(box[0], box[1]);
  await p.keyboard.press('End');
  await p.evaluate(() => qp.exec('text.insertFootnote', 'Source'));
  await p.waitForTimeout(200);
  check('footnote stored', await p.evaluate(() => { const s = qp.pub.story(qp.page.items[0].story); return [s.footnotes.length, s.paras[0].runs.at(-1).footnote === s.footnotes[0].id, s.paras[0].runs.at(-1).text]; }), [1, true, '1']);
  check('footnote drawn', await p.evaluate(() => { const g = document.querySelector(`.qp-page-host [data-id="${qp.page.items[0].id}"]`); const spans = [...g.querySelectorAll('tspan')].map((t) => t.textContent); return [spans.includes('1'), g.textContent.includes('Source'), !!g.querySelector('.qp-fn-sep')]; }), [true, true, true]);

  // Double-clicking the note at the bottom of the column edits it in place; Escape commits and returns to the reference.
  const noteBox = await p.evaluate(() => { const r = document.querySelector('.qp-page-host text[data-fn]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.mouse.dblclick(noteBox[0], noteBox[1]);
  await p.waitForTimeout(200);
  check('footnote island', await p.evaluate(() => [!!document.querySelector('.qp-textedit.qp-fnedit'), (document.querySelector('.qp-textedit.qp-fnedit .qp-fnlabel')?.textContent || '').trim(), document.querySelector('.qp-page-host text[data-fn]').style.visibility]), [true, '1', 'hidden']);
  await p.keyboard.press('End');
  await p.keyboard.type(' added');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  check('footnote edited in place', await p.evaluate(() => { const s = qp.pub.story(qp.page.items[0].story); return [s.footnotes[0].paras.map((x) => x.runs.map((r) => r.text).join('')).join('|'), !!document.querySelector('.qp-textedit:not(.qp-fnedit)'), !document.querySelector('.qp-fnedit')]; }), ['Source added', true, true]);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  check('edited note drawn', await p.evaluate(() => [!document.querySelector('.qp-textedit'), document.querySelector('.qp-page-host [data-id]').textContent.includes('added')]), [true, true]);
  await p.evaluate(() => qp.exec('edit.undo'));
  check('footnote edit undone', await p.evaluate(() => qp.pub.story(qp.page.items[0].story).footnotes[0].paras[0].runs.map((r) => r.text).join('')), 'Source');
  await p.evaluate(() => qp.exec('edit.redo'));
  check('footnote edit redone', await p.evaluate(() => qp.pub.story(qp.page.items[0].story).footnotes[0].paras[0].runs.map((r) => r.text).join('')), 'Source added');

  // Optical margin alignment moves a justified line that starts with a quotation mark left of the margin.
  await p.evaluate(() => qp.exec('insert.textFrame', '“Quoted opening words that run on long enough to wrap onto a second line of the frame, and more,'));
  await p.waitForTimeout(150);
  const omId = await p.evaluate(() => qp.page.items.at(-1).id);
  const xBefore = await p.evaluate((id) => +document.querySelector(`.qp-page-host [data-id="${id}"] text tspan`).getAttribute('x'), omId);
  await p.evaluate((id) => { qp.tab.ui.select([id]); qp.exec('fmt.justify'); qp.exec('fmt.opticalMargin'); }, omId);
  await p.waitForTimeout(200);
  const xAfter = await p.evaluate((id) => +document.querySelector(`.qp-page-host [data-id="${id}"] text tspan`).getAttribute('x'), omId);
  check('optical margin', [xAfter < xBefore - 1, await p.evaluate((id) => qp.pub.story(qp.page.items.find((e) => e.id === id).story).paras[0].opticalMargin, omId)], [true, true]);
  await p.evaluate((id) => { qp.tab.ui.select([id]); qp.exec('edit.delete'); qp.tab.ui.select([]); }, omId);
  check('optical frame removed', await p.evaluate((id) => qp.page.items.some((e) => e.id === id), omId), false);

  // Text on a path draws rotated glyphs.
  await p.evaluate(() => qp.exec('insert.textOnPath', { preset: 'arcUp', text: 'Curved words' }));
  await p.waitForTimeout(150);
  check('path text', await p.evaluate(() => { const e = qp.page.items.at(-1); const g = [...document.querySelectorAll(`.qp-page-host [data-id="${e.id}"] .qp-pathtext-glyphs text`)]; const angles = g.map((t) => +/rotate\(([-\d.]+)\)/.exec(t.getAttribute('transform'))[1]); return [e.kind, g.length, angles.some((a) => a > 5 && a < 355)]; }), ['pathText', 11, true]);

  // An inline anchored object moves down when a paragraph is added before its anchor.
  await p.evaluate(() => { const f = qp.page.items[0]; qp.pub.transact('Add box', () => { qp.page.items.push({ id: 'anc', kind: 'shape', geom: 'rect', x: 500, y: 600, w: 40, h: 20 }); }); qp.tab.ui.select([f.id, 'anc']); qp.exec('arrange.anchorInline'); });
  await p.waitForTimeout(200);
  const ancBefore = await p.evaluate(() => { const e = qp.page.items.find((x) => x.id === 'anc'); return [e.anchored.mode, e.x, e.y]; });
  check('anchored inline', [ancBefore[0], ancBefore[1] < 400, ancBefore[2] < 500], ['inline', true, true]);
  await p.evaluate(() => { const s = qp.pub.story(qp.page.items[0].story); qp.pub.transact('Paragraph before', () => { s.paras.unshift({ style: 'Body', runs: [{ text: 'A paragraph added before the anchor pushes the object down the frame.' }] }); }); });
  await p.waitForTimeout(200);
  check('anchored object moved', await p.evaluate((y0) => qp.page.items.find((x) => x.id === 'anc').y > y0, ancBefore[2]), true);
  // Editing the frame keeps the anchor placeholder and the footnote reference as runs.
  await p.evaluate(() => { qp.tab.ui.select([]); });
  const box2 = await p.evaluate(() => { const r = document.querySelector(`.qp-page-host [data-id="${qp.page.items[0].id}"]`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + 12]; });
  await p.mouse.dblclick(box2[0], box2[1]);
  check('placeholders in editor', await p.evaluate(() => [document.querySelectorAll('.qp-textedit .qp-anchor-ph').length, document.querySelectorAll('.qp-textedit .qp-fnref').length]), [1, 1]);
  await p.keyboard.press('Control+End');
  await p.keyboard.type(' tail');
  await p.keyboard.press('Escape');
  check('runs kept after editing', await p.evaluate(() => { const s = qp.pub.story(qp.page.items[0].story); const runs = s.paras.flatMap((p) => p.runs); return [runs.filter((r) => r.anchor).length, runs.filter((r) => r.footnote).length, s.paras.at(-1).runs.at(-1).text.endsWith(' tail'), s.footnotes.length]; }), [1, 1, true, 1]);
  await p.evaluate(() => { qp.tab.ui.select(['anc']); qp.exec('arrange.releaseAnchor'); qp.tab.ui.select([]); });

  // Draw a shape by dragging on the page, then a picture frame by command.
  await p.evaluate(() => qp.exec('insert.shape', 'roundRect'));
  const st = await p.evaluate(() => { const r = document.querySelector('.qp-edit-stage').getBoundingClientRect(); return [r.x, r.y, qp.tab.ui.zoom]; });
  await p.mouse.move(st[0] + 300 * st[2], st[1] + 400 * st[2]);
  await p.mouse.down();
  await p.mouse.move(st[0] + 450 * st[2], st[1] + 500 * st[2], { steps: 6 });
  await p.mouse.up();
  check('shape', await p.evaluate(() => qp.page.items.at(-1).geom), 'roundRect');
  await p.evaluate(() => qp.exec('insert.table', { rows: 2, cols: 2 }));
  check('table', await p.evaluate(() => qp.page.items.at(-1).kind), 'table');

  // Pages, masters, spreads and preview.
  await p.evaluate(() => qp.exec('page.insert'));
  check('pages', await p.evaluate(() => qp.pub.pages.length), 2);
  await p.evaluate(() => qp.exec('page.facing'));
  for (const v of ['view.spread', 'view.previewMode', 'view.single']) { await p.evaluate((id) => qp.exec(id), v); await p.waitForTimeout(150); }
  await p.evaluate(() => qp.exec('page.editMaster'));
  check('master editing', await p.evaluate(() => !!qp.tab.masterTarget), true);
  await p.evaluate(() => qp.exec('insert.pageNumber'));
  check('master folio', await p.evaluate(() => qp.owner.items.length), 1);
  await p.evaluate(() => qp.exec('page.closeMaster'));
  check('master closed', await p.evaluate(() => qp.tab.masterTarget), '');

  // Linked frames and autoflow of a long story.
  await p.evaluate(() => { qp.exec('page.first'); qp.exec('insert.placeholderText', 8); });
  check('placeholder frame', await p.evaluate(() => qp.page.items.some((e) => e.kind === 'text' && qp.pub.story(e.story).paras.length >= 8)), true);
  const before = await p.evaluate(() => qp.pub.pages.length);
  await p.evaluate(() => qp.exec('text.autoflow'));
  check('autoflow added pages or frames', await p.evaluate((b) => qp.pub.pages.length >= b, before), true);

  // Save as .qpp, .sla and .json, then open them again; export a PDF and a web page.
  const round = await p.evaluate(async () => {
    const io = await window.__qpIO();
    const out = [];
    for (const f of ['qpp', 'sla', 'json']) {
      const { data } = await io.exportPublication(qp.pub, f);
      const { pub } = await io.importPublication(data, `t.${f}`);
      out.push([f, pub.pages.length === qp.pub.pages.length]);
    }
    return out;
  });
  check('round trips', round, [['qpp', true], ['sla', true], ['json', true]]);
  const pdfOk = await p.evaluate(async () => { const r = await qp.exec('file.export.pdf', { quick: true }); return r !== false; });
  check('pdf export command', pdfOk, true);

  // Panes and the command palette render without errors.
  for (const id of ['fmt.stylesPane', 'page.swatchesPane', 'text.threadsPane', 'view.layersPane', 'review.preflight']) { await p.evaluate((x) => qp.exec(x), id); await p.waitForTimeout(100); }
  await p.evaluate(() => qp.exec('view.cmdSearch'));
  await p.keyboard.type('spelling');
  await p.keyboard.press('Escape');

  if (errs.length) failures.push(...errs);
} finally {
  await browser.close();
  if (server) try { process.kill(-server.pid); } catch { /* already gone */ }
}

if (failures.length) { console.error('E2E failures:\n' + failures.join('\n')); process.exit(1); }
console.log('E2E smoke test passed');
