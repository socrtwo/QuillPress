/** Review tab: spelling, statistics, reading level, preflight, fonts, links, accessibility, comments, language. */
import { def } from './registry';
import type { App } from '../app';
import type { Comment, Item, Page, Paragraph, PictureFrame, TextFrame } from '../model/types';
import { newId } from '../model/pub';
import { fontsUsed, resolvePara, resolveRun } from '../model/styles';
import { forEachText, edit, selection, flatItems } from '../edit/ops';
import { paraText } from '../edit/textEdit';
import { oversetFrames } from '../render/flow';
import { openDialog, toast, confirmDialog, promptDialog } from '../ui/dialog';
import { h, clear, icon } from '../ui/dom';
import { registerPane, typingIn, sigOf } from '../ui/panes';
import { FONT_LIST } from '../fonts';
import { replaceInPara } from '../edit/ops';
import { effectiveDpi } from './picture';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ------------------------------------------------------------------------------------------
// Spelling

async function spelling(app: App): Promise<void> {
  if (app.tab.ui.editingText) app.tab.ui.commitText();
  const { workerChecker, wordsIn, dictionaryKey, spellTargets } = await import('../proof/proofing');
  const pub = app.pub;
  const dict = (await dictionaryKey(pub.data.props.language || app.prefs.language, app.prefs.spellDialect as any)) || 'any';
  const targets = spellTargets(pub.data, { fromPage: app.tab.current });
  const ignored = new Set(app.prefs.ignoredWords.map((w) => w.toLowerCase()));
  const mine = new Set(app.prefs.dictionary.map((w) => w.toLowerCase()));
  const all = new Set<string>();
  for (const t of targets) for (const w of wordsIn(paraText(t.para))) all.add(w.word);
  let bad: Set<string>;
  try { bad = await workerChecker.check([...all], dict); } catch (e: any) { toast(`Spelling: ${e?.message || e}`); return; }
  const changeAll = new Map<string, string>();
  let changed = 0;
  for (const t of targets) {
    let from = 0;
    for (;;) {
      const p = t.para;
      const words = wordsIn(paraText(p)).filter((w) => w.start >= from);
      const w = words.find((x) => bad.has(x.word) && !ignored.has(x.word.toLowerCase()) && !mine.has(x.word.toLowerCase()));
      if (!w) break;
      const pageIds = t.page ? [t.page.id] : undefined;
      const auto = changeAll.get(w.word);
      if (auto != null) { pub.transact('Spelling', () => replaceInPara(p, w.start, w.end, auto), pageIds); changed++; from = w.start + auto.length; continue; }
      if (t.page && app.tab.current !== t.page.id) app.goToPage(t.page.id);
      if (t.frameId && t.page) app.tab.ui.select([t.frameId]);
      const sugg = await workerChecker.suggest(w.word, dict).catch(() => [] as string[]);
      const text = paraText(p);
      const r = await openDialog({ title: 'Spelling', fields: [
        { key: 'ctx', type: 'info', html: `<p>${t.table ? '<i>(Table)</i> ' : ''}${esc(text.slice(Math.max(0, w.start - 40), w.start))}<b style="color:#c62828;text-decoration:underline wavy">${esc(w.word)}</b>${esc(text.slice(w.end, w.end + 40))}</p>` },
        { key: 'to', label: 'Change to', type: 'combo', options: sugg, value: sugg[0] || w.word },
        { key: 'act', label: 'Action', type: 'radio', options: [{ value: 'change', label: 'Change' }, { value: 'changeAll', label: 'Change All' }, { value: 'ignore', label: 'Ignore Once' }, { value: 'ignoreAll', label: 'Ignore All' }, { value: 'add', label: 'Add to Dictionary' }], value: sugg.length ? 'change' : 'ignore' },
      ], ok: 'Apply', cancel: 'Stop' });
      if (!r) { toast(changed ? `Stopped. ${changed} change(s) made.` : 'Spelling check stopped.'); return; }
      if (r.act === 'change' || r.act === 'changeAll') {
        const to = String(r.to);
        pub.transact('Spelling', () => replaceInPara(p, w.start, w.end, to), pageIds);
        changed++;
        if (r.act === 'changeAll') changeAll.set(w.word, to);
        from = w.start + to.length;
      } else {
        if (r.act === 'ignoreAll') { ignored.add(w.word.toLowerCase()); app.prefs.ignoredWords = [...new Set([...app.prefs.ignoredWords, w.word])]; app.savePrefs(); }
        if (r.act === 'add') { mine.add(w.word.toLowerCase()); app.prefs.dictionary = [...new Set([...app.prefs.dictionary, w.word])]; app.savePrefs(); try { await workerChecker.add?.(w.word); } catch { /* */ } }
        from = w.end;
      }
    }
  }
  toast(changed ? `Spelling check complete: ${changed} change(s).` : 'Spelling check complete. No errors found.');
}

// ------------------------------------------------------------------------------------------
// Statistics and reading level

export function pubStats(app: App): Record<string, number> {
  const pub = app.pub;
  let words = 0, chars = 0, paras = 0, sentences = 0, syllables = 0;
  const count = (t: string) => t.split(/\s+/).filter(Boolean).length;
  forEachText(app, (ps) => { for (const p of ps) { const t = paraText(p); if (!t.trim()) continue; words += count(t); chars += t.length; paras++; sentences += (t.match(/[.!?]+(\s|$)/g) || []).length || 1; for (const w of t.toLowerCase().match(/[a-z]+/g) || []) syllables += syllablesOf(w); } });
  let pictures = 0, shapes = 0, tables = 0, frames = 0, empty = 0;
  for (const p of pub.pages) for (const e of flatItems(p)) { if (e.kind === 'picture') { pictures++; if (!e.media) empty++; } else if (e.kind === 'table') tables++; else if (e.kind === 'text') frames++; else if (e.kind !== 'group') shapes++; }
  return { Pages: pub.pages.length, 'Master pages': pub.data.masters.length, Stories: pub.data.stories.length, 'Text frames': frames, Words: words, Characters: chars, Paragraphs: paras, Sentences: sentences, Syllables: syllables, Pictures: pictures, 'Empty picture frames': empty, Shapes: shapes, Tables: tables, 'Overset frames': oversetFrames(pub).length, Comments: pub.pages.reduce((a, s) => a + (s.comments?.length || 0), 0) };
}

function syllablesOf(w: string): number {
  if (w.length <= 3) return 1;
  const v = (w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g) || []).length;
  return Math.max(1, v);
}

// ------------------------------------------------------------------------------------------
// Preflight and accessibility

export interface Issue { kind: 'error' | 'warning' | 'tip'; text: string; page?: string; item?: string; fix?: string }

export function preflightIssues(app: App): Issue[] {
  const pub = app.pub;
  const out: Issue[] = [];
  const { w, h } = pub.size;
  const bleed = pub.data.bleed;
  for (const o of oversetFrames(pub)) { const pg = pub.pageOfItem(o.frame.id); out.push({ kind: 'error', text: `${pg ? `Page ${pub.pageIndex(pg.id) + 1}` : 'Master'}: overset text in ${o.frame.name || 'a text frame'} (${o.chars} characters)`, page: pg?.id, item: o.frame.id, fix: 'Enlarge or link the frame, or use Text ▸ Autoflow.' }); }
  const available = new Set(FONT_LIST.map((f) => f.toLowerCase()));
  for (const f of fontsUsed(pub.data)) if (!available.has(f.toLowerCase())) out.push({ kind: 'warning', text: `Font "${f}" is not bundled; it shows only where the device has it, and PDF export substitutes a standard font`, fix: 'Edit ▸ Replace Fonts, or Tools ▸ Find Font.' });
  pub.pages.forEach((p, i) => {
    const n = `Page ${i + 1}`;
    for (const e of flatItems(p)) {
      if (e.hidden) continue;
      const offAll = e.x + e.w < -bleed || e.y + e.h < -bleed || e.x > w + bleed || e.y > h + bleed;
      const offPart = e.x < -bleed || e.y < -bleed || e.x + e.w > w + bleed || e.y + e.h > h + bleed;
      if (offAll) out.push({ kind: 'warning', text: `${n}: ${e.name || e.kind} is entirely off the page (not printed)`, page: p.id, item: e.id });
      else if (offPart) out.push({ kind: 'tip', text: `${n}: ${e.name || e.kind} extends past the ${bleed ? 'bleed' : 'page edge'}`, page: p.id, item: e.id, fix: bleed ? 'Content past the bleed is cut off.' : 'Set a bleed (Page Design ▸ Bleed) if it should run off the edge.' });
      else if (bleed && (e.x < 0 || e.y < 0 || e.x + e.w > w || e.y + e.h > h) && (e.x > -bleed + 0.5 || e.y > -bleed + 0.5 || e.x + e.w < w + bleed - 0.5 || e.y + e.h < h + bleed - 0.5) && (e.kind === 'picture' || e.fill)) out.push({ kind: 'tip', text: `${n}: ${e.name || e.kind} crosses the trim but does not reach the bleed edge`, page: p.id, item: e.id, fix: 'Extend it to the red bleed line to avoid white slivers after trimming.' });
      if (e.kind === 'picture') {
        if (!e.media) out.push({ kind: 'warning', text: `${n}: empty picture frame`, page: p.id, item: e.id, fix: 'Place a picture or delete the frame.' });
        else { const dpi = effectiveDpi(app, e); if (dpi != null && dpi < 150) out.push({ kind: dpi < 100 ? 'error' : 'warning', text: `${n}: ${e.name || 'picture'} is low resolution (${Math.round(dpi)} ppi)`, page: p.id, item: e.id, fix: 'Use a larger picture or make the frame smaller; 300 ppi is standard for print.' }); const m = pub.media[e.media]; if (m && !m.w) out.push({ kind: 'tip', text: `${n}: ${e.name || 'picture'} has no known pixel size`, page: p.id, item: e.id }); }
      }
      if (e.kind === 'text') {
        const s = pub.story(e.story);
        if (s && !e.prev && !s.paras.some((x) => x.runs.some((r) => r.text))) out.push({ kind: 'tip', text: `${n}: empty text frame`, page: p.id, item: e.id });
        if (s) for (const para of s.paras) { const rp = resolvePara(pub.data, para); for (const r of para.runs) { const size = resolveRun(pub.data, rp.run, r).size || 11; if (r.text.trim() && size < 5) { out.push({ kind: 'warning', text: `${n}: text smaller than 5 pt in ${e.name || 'a frame'}`, page: p.id, item: e.id }); break; } } }
      }
      if (e.link && !/^(https?:|mailto:|#)/i.test(e.link)) out.push({ kind: 'warning', text: `${n}: ${e.name || e.kind} has a link that is not a web address`, page: p.id, item: e.id });
    }
    if (!pub.data.masters.some((m) => m.id === p.master)) out.push({ kind: 'error', text: `${n}: its master page no longer exists`, page: p.id });
  });
  if (!pub.data.props.title) out.push({ kind: 'tip', text: 'The publication has no title (File ▸ Properties); PDF and web exports use it', fix: 'File ▸ Properties.' });
  return out;
}

export function accessibilityIssues(app: App): Issue[] {
  const pub = app.pub;
  const out: Issue[] = [];
  pub.pages.forEach((p, i) => {
    const n = `Page ${i + 1}`;
    for (const e of flatItems(p)) {
      if ((e.kind === 'picture' || e.kind === 'shape' || e.kind === 'group') && !e.alt && !e.decorative && !(e.kind === 'shape' && !e.fill)) out.push({ kind: 'error', text: `${n}: ${e.name || e.kind} has no alternative text`, page: p.id, item: e.id, fix: 'Review ▸ Alt Text, or mark it as decorative.' });
      if (e.kind === 'table' && !e.style?.firstRow && !e.rows[0]?.header) out.push({ kind: 'warning', text: `${n}: table without a header row`, page: p.id, item: e.id });
      if (e.kind === 'text') {
        const s = pub.story(e.story);
        if (s) for (const para of s.paras) { const rp = resolvePara(pub.data, para); for (const r of para.runs) { const size = resolveRun(pub.data, rp.run, r).size || 11; if (r.text.trim() && size < 8) { out.push({ kind: 'tip', text: `${n}: text smaller than 8 pt in ${e.name || 'a frame'} is hard to read`, page: p.id, item: e.id }); break; } } }
        if (s && !e.prev && s.paras.every((x) => !x.style || x.style === 'Body' || x.style === 'Body First' || x.style === 'Body No Indent') && s.paras.length > 12) out.push({ kind: 'tip', text: `${n}: a long story without headings (readers of exports rely on heading styles)`, page: p.id, item: e.id });
      }
    }
  });
  if (!pub.data.props.language) out.push({ kind: 'tip', text: 'No publication language is set (File ▸ Properties or Review ▸ Language); screen readers use it', fix: 'Review ▸ Language.' });
  if (!pub.data.props.title) out.push({ kind: 'tip', text: 'No title for exported documents (File ▸ Properties)' });
  return out;
}

function issuesPane(id: string, title: string, get: (app: App) => Issue[], intro: string): void {
  registerPane({
    id, title,
    render(app, el) { this.update!(app, el, {}); },
    update(app, el) {
      if (!sigOf(el, String(app.pub.version))) return;
      clear(el);
      const list = get(app);
      el.appendChild(h('p', { class: 'ql-help' }, intro));
      if (!list.length) { el.appendChild(h('p', null, icon('check_circle'), ' No issues found.')); return; }
      for (const k of ['error', 'warning', 'tip'] as const) {
        const items = list.filter((i) => i.kind === k);
        if (!items.length) continue;
        el.appendChild(h('h3', { class: 'ql-pane-h' }, `${k === 'error' ? 'Errors' : k === 'warning' ? 'Warnings' : 'Tips'} (${items.length})`));
        for (const it of items) el.appendChild(h('button', { class: 'ql-nav-item', title: it.fix || '', onclick: () => { if (it.page) app.goToPage(it.page); if (it.item) app.tab.ui.select([it.item]); } }, icon(k === 'error' ? 'error' : k === 'warning' ? 'warning' : 'lightbulb'), h('span', null, ' ' + it.text)));
      }
    },
  });
}
issuesPane('preflight', 'Preflight', preflightIssues, 'Problems that would show in print: overset text, missing or low-resolution pictures, fonts not available, objects off the page or short of the bleed. Click an item to go to it.');
issuesPane('accessibility', 'Accessibility', accessibilityIssues, 'Content people with disabilities might find hard to read in the PDF and web exports. Click an item to go to it.');

registerPane({
  id: 'links', title: 'Pictures',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const pub = app.pub;
    if (!sigOf(el, `${pub.version}:${app.tab.ui.selection.join(',')}`)) return;
    clear(el);
    el.appendChild(h('p', { class: 'ql-help' }, 'Every picture in the publication and where it is placed. Pictures are embedded in the file; Tools ▸ Relink replaces one everywhere.'));
    const uses = new Map<string, { page?: Page; item: PictureFrame }[]>();
    for (const p of pub.pages) for (const e of flatItems(p)) if (e.kind === 'picture' && e.media) { if (!uses.has(e.media)) uses.set(e.media, []); uses.get(e.media)!.push({ page: p, item: e }); }
    for (const m of pub.data.masters) for (const e of flatItems(m)) if (e.kind === 'picture' && e.media) { if (!uses.has(e.media)) uses.set(e.media, []); uses.get(e.media)!.push({ item: e }); }
    const ids = Object.keys(pub.media);
    if (!ids.length) el.appendChild(h('p', { class: 'ql-help' }, 'No pictures yet.'));
    for (const id of ids) {
      const m = pub.media[id];
      const list = uses.get(id) || [];
      const kb = Math.round((m.b64.length * 3) / 4 / 1024);
      const first = list[0];
      const dpi = first ? effectiveDpi(app, first.item) : null;
      el.appendChild(h('button', { class: 'ql-nav-item' + (first && app.tab.ui.selection.includes(first.item.id) ? ' ql-on' : ''), onclick: () => { if (first?.page) { app.goToPage(first.page.id); app.tab.ui.select([first.item.id]); } } },
        h('img', { src: pub.mediaUrl(id), class: 'ql-thumb-sm', alt: '' }),
        h('span', null, m.name || id, h('span', { class: 'ql-help' }, ` ${m.w || '?'}×${m.h || '?'} px · ${kb} KB · ${list.length ? `${list.length} use(s)` : 'unused'}${dpi != null ? ` · ${Math.round(dpi)} ppi` : ''}`))));
    }
  },
});

// ------------------------------------------------------------------------------------------
// Comments

function allComments(app: App): { page: Page; c: Comment }[] {
  const out: { page: Page; c: Comment }[] = [];
  for (const p of app.pub.pages) for (const c of p.comments || []) out.push({ page: p, c });
  return out;
}

function stepComment(app: App, dir: 1 | -1): void {
  const all = allComments(app);
  if (!all.length) { toast('No comments in this publication.'); return; }
  const cur = (app as any).currentComment as string | undefined;
  let i = all.findIndex((x) => x.c.id === cur);
  if (i < 0) i = dir > 0 ? -1 : all.length;
  i = (i + dir + all.length) % all.length;
  const { page, c } = all[i];
  (app as any).currentComment = c.id;
  app.goToPage(page.id);
  app.ui.openPane('comments');
  toast(`${c.author}: ${c.text.slice(0, 80)}`);
}

registerPane({
  id: 'comments', title: 'Comments',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const sig = `${app.pub.version}:${(app as any).currentComment || ''}`;
    if (!sigOf(el, sig) || typingIn(el)) return;
    clear(el);
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('review.newComment') }, icon('add_comment'), ' New Comment'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('review.deleteAllComments') }, 'Delete All')));
    const all = allComments(app);
    if (!all.length) el.appendChild(h('p', { class: 'ql-help' }, 'No comments yet. Comments are notes for reviewers; they are not printed.'));
    for (const { page, c } of all) {
      const box = h('div', { class: 'ql-comment-card' + (c.resolved ? ' ql-resolved' : '') + (((app as any).currentComment === c.id) ? ' ql-on' : '') },
        h('div', { class: 'ql-comment-head' }, h('b', null, c.author), h('span', { class: 'ql-help' }, ` · page ${app.pub.pageIndex(page.id) + 1} · ${new Date(c.when).toLocaleString()}`)),
        h('div', { class: 'ql-comment-text' }, c.text),
        ...(c.replies || []).map((r) => h('div', { class: 'ql-comment-reply' }, h('b', null, r.author), ': ', r.text)),
        h('div', { class: 'ql-row' },
          h('button', { class: 'ql-btn ql-sm', onclick: () => { (app as any).currentComment = c.id; app.goToPage(page.id); } }, 'Go To'),
          h('button', { class: 'ql-btn ql-sm', onclick: async () => { const t = await promptDialog('Reply', 'Reply', ''); if (!t) return; app.pub.transact('Reply', () => { (c.replies ||= []).push({ author: app.prefs.author, text: t, when: Date.now() }); }, [page.id]); } }, 'Reply'),
          h('button', { class: 'ql-btn ql-sm', onclick: () => app.pub.transact(c.resolved ? 'Reopen Comment' : 'Resolve Comment', () => { c.resolved = !c.resolved || undefined; }, [page.id]) }, c.resolved ? 'Reopen' : 'Resolve'),
          h('button', { class: 'ql-iconbtn ql-sm', title: 'Delete', onclick: () => app.exec('review.deleteComment', c.id) }, icon('delete'))));
      el.appendChild(box);
    }
  },
});

// ------------------------------------------------------------------------------------------

const LANGS = ['en-US', 'en-GB', 'en-CA', 'en-AU', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'ru', 'uk', 'el', 'tr', 'ar', 'he', 'hi', 'ja', 'ko', 'zh'];

def([
  { id: 'review.spelling', label: 'Spelling', icon: 'spellcheck', tab: 'Review', group: 'Proofing', keys: ['F7'], popular: true, edits: true, tip: 'Check spelling from the current page on', run: (app) => spelling(app) },
  { id: 'review.dictionaries', label: 'Dictionaries…', icon: 'translate', tab: 'Review', group: 'Proofing', noRecord: true, tip: 'Download spelling dictionaries for other languages', run: async (app) => { const { openDictionaryWizard } = await import('../ui/dictWizard'); await openDictionaryWizard(app); } },
  {
    id: 'review.statistics', label: 'Statistics', icon: 'analytics', tab: 'Review', group: 'Proofing', noRecord: true,
    run: async (app) => { const s = pubStats(app); await openDialog({ title: 'Publication Statistics', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<table class="ql-table">${Object.entries(s).map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right">${v.toLocaleString()}</td></tr>`).join('')}</table>` }] }); },
  },
  {
    id: 'review.readingLevel', label: 'Reading Level', icon: 'school', tab: 'Review', group: 'Proofing', noRecord: true,
    tip: 'Readability of the publication\'s text (Flesch reading ease and grade level)',
    run: async (app) => {
      const s = pubStats(app);
      if (!s.Words) { toast('There is no text to measure.'); return; }
      const wps = s.Words / Math.max(1, s.Sentences), spw = s.Syllables / s.Words;
      const ease = 206.835 - 1.015 * wps - 84.6 * spw;
      const grade = 0.39 * wps + 11.8 * spw - 15.59;
      const verdict = ease >= 80 ? 'easy (conversational)' : ease >= 60 ? 'plain English' : ease >= 40 ? 'fairly difficult' : 'difficult (academic)';
      await openDialog({ title: 'Reading Level', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<p><b>Flesch reading ease: ${ease.toFixed(0)}</b> — ${verdict}.</p><p>Grade level: ${Math.max(0, grade).toFixed(1)}. Average sentence: ${wps.toFixed(1)} words; average word: ${spw.toFixed(2)} syllables.</p><p class="ql-help">Newspapers aim for 60–70; shorter sentences and words raise the score.</p>` }] });
    },
  },
  {
    id: 'review.preflight', label: 'Preflight', icon: 'fact_check', tab: 'Review', group: 'Preflight', keys: ['Mod-Alt-Shift-f'], popular: true, noRecord: true, origin: 'Preflight (prepress), Design Checker (Microsoft Publisher)',
    tip: 'Check the publication for printing problems',
    run: (app) => { const n = preflightIssues(app); app.ui.openPane('preflight'); toast(n.length ? `Preflight: ${n.filter((i) => i.kind === 'error').length} error(s), ${n.filter((i) => i.kind === 'warning').length} warning(s), ${n.filter((i) => i.kind === 'tip').length} tip(s).` : 'Preflight: no problems found.'); },
  },
  { id: 'review.preflightPane', label: 'Preflight Pane', icon: 'checklist', tab: 'Review', group: 'Preflight', noRecord: true, run: (app) => app.ui.togglePane('preflight') },
  {
    id: 'review.fontsUsed', label: 'Fonts Used', icon: 'font_download', tab: 'Review', group: 'Preflight', noRecord: true,
    run: async (app) => {
      const fonts = fontsUsed(app.pub.data);
      const avail = new Set(FONT_LIST.map((f) => f.toLowerCase()));
      await openDialog({ title: 'Fonts Used', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: fonts.length ? `<ul>${fonts.map((f) => `<li style="font-family:'${esc(f)}'">${esc(f)}${avail.has(f.toLowerCase()) ? '' : ' <span class="ql-help">(not bundled; substituted in PDF export)</span>'}</li>`).join('')}</ul>` : '<p>Only the default fonts are used.</p>' }], buttons: [{ label: 'Replace Fonts…', onClick: (_v, ctl) => { ctl.close(); app.exec('edit.replaceFonts'); } }] });
    },
  },
  { id: 'review.linksPane', label: 'Pictures Pane', icon: 'photo_library', tab: 'Review', group: 'Preflight', noRecord: true, tip: 'Every picture, its size, resolution and where it is used', run: (app) => app.ui.togglePane('links') },
  { id: 'review.checkAccessibility', label: 'Check Accessibility', icon: 'accessibility_new', tab: 'Review', group: 'Accessibility', noRecord: true, run: (app) => { app.ui.openPane('accessibility'); const n = accessibilityIssues(app).length; toast(n ? `${n} accessibility issue(s) found.` : 'No accessibility issues found.'); } },
  {
    id: 'review.altText', label: 'Alt Text', icon: 'image_search', tab: 'Review', group: 'Accessibility', edits: true, isEnabled: (app) => app.selected.length > 0,
    run: async (app) => {
      const e = selection(app)[0]; if (!e) return;
      const r = await openDialog({ title: 'Alternative Text', fields: [{ key: 'alt', label: `Describe ${e.name || e.kind} for people who cannot see it`, type: 'textarea', rows: 3, value: e.alt || '' }, { key: 'dec', label: 'Decorative (no description needed)', type: 'checkbox', value: !!e.decorative }], buttons: [{ label: 'Write with AI', onClick: (_v, ctl) => { ctl.close(); app.exec('ai.altText'); } }] });
      if (!r) return;
      edit(app, 'Alt Text', () => { for (const x of selection(app)) { x.alt = r.alt.trim() || undefined; x.decorative = r.dec || undefined; } });
    },
  },
  { id: 'review.decorative', label: 'Mark as Decorative', icon: 'hide_image', tab: 'Review', group: 'Accessibility', kind: 'toggle', edits: true, isEnabled: (app) => app.selected.length > 0, isActive: (app) => !!app.selected[0]?.decorative, run: (app) => { const on = !!app.selected[0]?.decorative; edit(app, 'Decorative', () => { for (const x of selection(app)) x.decorative = on ? undefined : true; }); } },
  {
    id: 'review.newComment', label: 'New Comment', icon: 'add_comment', tab: 'Review', group: 'Comments', keys: ['Mod-Alt-m'], edits: true,
    run: async (app, at?: { x: number; y: number }) => {
      const p = app.page; if (!p || app.tab.masterTarget) { toast('Comments go on pages, not masters.'); return; }
      const t = await promptDialog('New Comment', 'Comment', '');
      if (!t) return;
      const sel = selection(app)[0];
      const c: Comment = { id: newId('cm'), author: app.prefs.author, text: t, when: Date.now(), x: at?.x ?? sel?.x ?? 36, y: at?.y ?? sel?.y ?? 36 };
      app.pub.transact('New Comment', () => { (p.comments ||= []).push(c); }, [p.id]);
      (app as any).currentComment = c.id;
      app.ui.openPane('comments');
    },
  },
  { id: 'review.deleteComment', label: 'Delete Comment', icon: 'comments_disabled', tab: 'Review', group: 'Comments', edits: true, run: (app, id?: string) => { const cur = id || (app as any).currentComment; const hit = allComments(app).find((x) => x.c.id === cur) || allComments(app).find((x) => x.page === app.page); if (!hit) { toast('No comment to delete.'); return; } app.pub.transact('Delete Comment', () => { hit.page.comments = (hit.page.comments || []).filter((c) => c !== hit.c); }, [hit.page.id]); } },
  { id: 'review.deleteAllComments', label: 'Delete All Comments', icon: 'delete_sweep', tab: 'Review', group: 'Comments', edits: true, run: async (app) => { const n = allComments(app).length; if (!n) return; if (!(await confirmDialog('Delete All Comments', `Delete all ${n} comment(s)?`, 'Delete'))) return; app.pub.transact('Delete All Comments', () => { for (const p of app.pub.pages) p.comments = []; }); } },
  { id: 'review.prevComment', label: 'Previous Comment', icon: 'skip_previous', tab: 'Review', group: 'Comments', noRecord: true, run: (app) => stepComment(app, -1) },
  { id: 'review.nextComment', label: 'Next Comment', icon: 'skip_next', tab: 'Review', group: 'Comments', noRecord: true, run: (app) => stepComment(app, 1) },
  { id: 'review.commentsPane', label: 'Comments', icon: 'comment', tab: 'Review', group: 'Comments', noRecord: true, run: (app) => app.ui.togglePane('comments') },
  {
    id: 'review.language', label: 'Language', icon: 'language', tab: 'Review', group: 'Language', kind: 'menu', edits: true,
    tip: 'The publication\'s language (spelling dictionary, hyphenation, exports)',
    menu: (app) => LANGS.map((l) => ({ id: 'review.language', arg: l, label: l, checked: (app.pub.data.props.language || '') === l })),
    run: async (app, lang?: string) => { if (!lang) { lang = (await promptDialog('Language', 'Language tag (BCP 47)', app.pub.data.props.language || app.prefs.language || 'en-US')) || undefined; if (!lang) return; } app.pub.transact('Language', () => { app.pub.data.props.language = lang; }); },
  },
  { id: 'review.translate', label: 'Translate', icon: 'g_translate', tab: 'Review', group: 'Language', edits: true, tip: 'Translate the selected text with the AI provider', run: (app) => app.exec('ai.translate') },
  {
    id: 'review.lookUp', label: 'Look Up', icon: 'manage_search', tab: 'Review', group: 'Language', noRecord: true,
    tip: 'Look the selected word up in an online dictionary',
    run: async (app) => { const { activeTextEditor } = await import('../edit/textEdit'); const w = activeTextEditor()?.selectedText()?.trim() || (await promptDialog('Look Up', 'Word or phrase', '')); if (!w) return; app.followLink(`https://en.wiktionary.org/wiki/${encodeURIComponent(w)}`); },
  },
  {
    id: 'review.compare', label: 'Compare with File…', icon: 'difference', tab: 'Review', group: 'Proofing', noRecord: true,
    tip: 'Compare this publication\'s text with another .qpp or .sla file, story by story',
    run: async (app) => {
      const { pickFile } = await import('../ui/dom');
      const f = (await pickFile('.qpp,.json,.sla'))[0]; if (!f) return;
      const { importPublication } = await import('../io');
      let other;
      try { other = (await importPublication(new Uint8Array(await f.arrayBuffer()), f.name, { noRecovery: true })).pub; } catch (e: any) { toast(`Could not read ${f.name}: ${e?.message || e}`); return; }
      const mine = app.pub.data.stories.map((s) => s.paras.map(paraText).join('\n'));
      const theirs = other.data.stories.map((s) => s.paras.map(paraText).join('\n'));
      const added = theirs.filter((t) => !mine.includes(t)).length, removed = mine.filter((t) => !theirs.includes(t)).length;
      await openDialog({ title: 'Compare', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<p>This publication: ${app.pub.pages.length} pages, ${mine.length} stories. ${esc(f.name)}: ${other.pages.length} pages, ${theirs.length} stories.</p><p>${removed} story(ies) here differ from or are missing in the file; ${added} story(ies) in the file differ from or are missing here.</p><p class="ql-help">Open the file in another tab to compare pages side by side (View ▸ Switch Windows).</p>` }], buttons: [{ label: 'Open the File', onClick: (_v, ctl) => { ctl.close(); other!.clearHistory(); app.createTab(other!, { title: f.name.replace(/\.[^.]+$/, '') }); } }] });
    },
  },
]);

