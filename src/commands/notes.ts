/** Footnotes: references in the text, notes at the bottom of the column, endnote conversion, the Footnotes pane. */
import { def } from './registry';
import type { App } from '../app';
import type { Footnote, FootnoteOptions, NumScheme, Paragraph, Run, Story, TextFrame } from '../model/types';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';
import { newId, clone, textOf } from '../model/pub';
import { ensureFootnoteStyles } from '../model/styles';
import { textTargets } from '../edit/ops';
import { activeTextEditor, paraText } from '../edit/textEdit';
import { storyLayout } from '../render/flow';
import { footnoteLabel } from '../render/text';
import { registerPane, sigOf, typingIn } from '../ui/panes';
import { h, icon, clear } from '../ui/dom';
import { openDialog, toast, confirmDialog } from '../ui/dialog';
import { insertRunAt } from './anchor';

const fnOpts = (app: App): FootnoteOptions => app.pub.data.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS;

/** The story being edited or of the first selected frame. */
function currentStory(app: App): { story: Story; frame: TextFrame } | null {
  const ed = activeTextEditor();
  const frame = ed?.frame || textTargets(app)[0];
  const story = frame ? app.pub.story(frame.story) : undefined;
  return story && frame ? { story, frame } : null;
}

/** Footnote references of a story in text order. */
export function footnoteRefs(story: Story): { id: string; para: number; off: number; run: Run }[] {
  const out: { id: string; para: number; off: number; run: Run }[] = [];
  story.paras.forEach((p, pi) => { let off = 0; for (const r of p.runs) { if (r.footnote) out.push({ id: r.footnote, para: pi, off, run: r }); off += r.br ? 1 : r.text.length; } });
  return out;
}

/** The footnote whose reference is at (or just before) the caret, else the first of the story. */
function footnoteAtCaret(app: App, story: Story): string | undefined {
  const ed = activeTextEditor();
  const refs = footnoteRefs(ed ? { ...story, paras: ed.read() } : story);
  if (!refs.length) return undefined;
  const pos = ed?.caretPos();
  if (!pos) return refs[0].id;
  const before = refs.filter((r) => r.para < pos.para || (r.para === pos.para && r.off <= pos.off));
  return (before[before.length - 1] || refs[0]).id;
}

/** Selects the frame whose column shows a footnote's reference and puts the caret after it. */
function goToReference(app: App, story: Story, id: string): void {
  const pub = app.pub;
  const lay = storyLayout(pub, story.id);
  const ref = footnoteRefs(story).find((r) => r.id === id);
  if (!ref) return;
  const line = lay?.r.lines.find((l) => !l.footnote && l.segs.some((s) => s.footnote === id));
  const frameId = line ? lay!.boxes[line.box]?.frame : pub.chainOf(story.id)[0]?.id;
  const frame = frameId ? pub.frame(frameId) : undefined;
  if (!frame) return;
  const pg = pub.pageOfItem(frame.id);
  if (pg) app.goToPage(pg.id);
  app.tab.ui.select([frame.id]);
  app.tab.ui.editText(frame.id);
  requestAnimationFrame(() => activeTextEditor()?.setPos({ para: ref.para, off: ref.off + ref.run.text.length }));
}

async function editFootnoteDialog(app: App, story: Story, fn: Footnote): Promise<void> {
  const text = fn.paras.map(paraText).join('\n');
  const label = footnoteRefs(story).find((r) => r.id === fn.id)?.run.text || '';
  const r = await openDialog({ title: `Footnote ${label}`.trim(), wide: true, fields: [{ key: 't', label: 'Note text (one paragraph per line)', type: 'textarea', rows: 6, value: text, autofocus: true }], help: 'Character formatting is kept in paragraphs whose text is unchanged.' });
  if (!r || r.t === text) return;
  const lines = String(r.t).replace(/\r\n?/g, '\n').split('\n');
  app.pub.transact('Edit Footnote', () => {
    fn.paras = lines.map((l, i) => {
      const old = fn.paras[i];
      if (old && paraText(old) === l) return old;
      const fmt = old?.runs.find((x) => !x.br) || old?.end || {};
      const { text: _t, br: _b, footnote: _f, anchor: _a, ...keep } = fmt as any;
      return { style: old?.style || fnOpts(app).style, runs: l ? [{ ...keep, text: l }] : [] };
    });
    if (!fn.paras.length) fn.paras = [{ style: fnOpts(app).style, runs: [] }];
  });
}

/** Inserts a footnote at the caret (or at the end of the selected frame's story). */
export function insertFootnote(app: App, text?: string): string | null {
  const cur = currentStory(app);
  if (!cur) { toast('Click in the text where the footnote reference should go.'); return null; }
  const { story } = cur;
  const ed = activeTextEditor();
  let pos = { para: story.paras.length - 1, off: Infinity };
  if (ed) { pos = ed.caretPos() || pos; app.tab.ui.commitText(); }
  const id = newId('fn');
  const opts = fnOpts(app);
  app.pub.transact('Insert Footnote', () => {
    ensureFootnoteStyles(app.pub.data);
    const s = app.pub.story(story.id)!;
    (s.footnotes ||= []).push({ id, paras: [{ style: opts.style, runs: text ? [{ text }] : [] }] });
    const p = s.paras[Math.min(pos.para, s.paras.length - 1)];
    const len = paraText(p).length;
    const n = footnoteRefs(s).filter((r) => r.para < pos.para || (r.para === pos.para && r.off < Math.min(pos.off, len))).length + 1;
    insertRunAt(p, Math.min(pos.off, len), { text: footnoteLabel(n, opts.scheme), footnote: id, cstyle: 'Footnote Reference', baseline: 33 });
  });
  return id;
}

def([
  {
    id: 'text.insertFootnote', label: 'Insert Footnote', icon: 'superscript', tab: 'Text', group: 'Notes', keys: ['Mod-Alt-f'], popular: true, edits: true, origin: 'Footnotes (Ventura Publisher, FrameMaker, InDesign)',
    tip: 'A numbered reference at the caret, with its note set at the bottom of the column',
    run: async (app, text?: string) => {
      const id = insertFootnote(app, typeof text === 'string' ? text : undefined);
      if (!id || typeof text === 'string') return;
      const cur = currentStory(app);
      const fn = cur?.story.footnotes?.find((f) => f.id === id);
      if (cur && fn) await editFootnoteDialog(app, cur.story, fn);
    },
  },
  {
    id: 'text.editFootnote', label: 'Edit Footnote…', icon: 'edit_note', tab: 'Text', group: 'Notes', edits: true,
    tip: 'Edit the text of the footnote at the caret',
    run: async (app, id?: string) => {
      const cur = currentStory(app);
      if (!cur) { toast('Click in the text near the footnote reference first.'); return; }
      const fid = id || footnoteAtCaret(app, cur.story);
      const fn = cur.story.footnotes?.find((f) => f.id === fid);
      if (!fn) { toast('This story has no footnotes. Insert one with Text ▸ Insert Footnote.'); return; }
      if (activeTextEditor()) app.tab.ui.commitText();
      await editFootnoteDialog(app, cur.story, fn);
    },
  },
  {
    id: 'text.deleteFootnote', label: 'Delete Footnote', icon: 'delete_sweep', tab: 'Text', group: 'Notes', edits: true,
    tip: 'Remove the footnote at the caret and its reference',
    run: (app, id?: string) => {
      const cur = currentStory(app);
      if (!cur) { toast('Click in the text near the footnote reference first.'); return; }
      const fid = id || footnoteAtCaret(app, cur.story);
      if (!fid) { toast('No footnote here.'); return; }
      if (activeTextEditor()) app.tab.ui.commitText();
      app.pub.transact('Delete Footnote', () => {
        const s = app.pub.story(cur.story.id)!;
        s.footnotes = (s.footnotes || []).filter((f) => f.id !== fid);
        for (const p of s.paras) p.runs = p.runs.filter((r) => r.footnote !== fid);
      });
    },
  },
  {
    id: 'text.nextFootnote', label: 'Next Footnote', icon: 'arrow_downward', tab: 'Text', group: 'Notes', noRecord: true,
    run: (app) => { const cur = currentStory(app); if (!cur) { toast('Select a text frame first.'); return; } const refs = footnoteRefs(cur.story); if (!refs.length) { toast('No footnotes in this story.'); return; } const at = footnoteAtCaret(app, cur.story); const i = refs.findIndex((r) => r.id === at); const next = refs[(i + 1) % refs.length]; app.tab.ui.commitText(); goToReference(app, cur.story, next.id); },
  },
  {
    id: 'text.prevFootnote', label: 'Previous Footnote', icon: 'arrow_upward', tab: 'Text', group: 'Notes', noRecord: true,
    run: (app) => { const cur = currentStory(app); if (!cur) { toast('Select a text frame first.'); return; } const refs = footnoteRefs(cur.story); if (!refs.length) { toast('No footnotes in this story.'); return; } const at = footnoteAtCaret(app, cur.story); const i = refs.findIndex((r) => r.id === at); const prev = refs[(i - 1 + refs.length) % refs.length]; app.tab.ui.commitText(); goToReference(app, cur.story, prev.id); },
  },
  {
    id: 'text.goToReference', label: 'Go to Reference', icon: 'subdirectory_arrow_left', tab: 'Text', group: 'Notes', noRecord: true,
    tip: 'Put the caret after the reference of a footnote',
    run: (app, id?: string) => { const cur = currentStory(app); if (!cur) { toast('Select a text frame first.'); return; } const fid = id || footnoteAtCaret(app, cur.story); if (!fid) { toast('No footnotes in this story.'); return; } app.tab.ui.commitText(); goToReference(app, cur.story, fid); },
  },
  {
    id: 'text.footnoteOptions', label: 'Footnote Options…', icon: 'tune', tab: 'Text', group: 'Notes', edits: true,
    run: async (app, arg?: Partial<FootnoteOptions>) => {
      const cur = fnOpts(app);
      let r: any = arg;
      if (!r) {
        const schemes: { value: NumScheme | 'symbols'; label: string }[] = [{ value: 'arabicPlain', label: '1, 2, 3' }, { value: 'romanLcPeriod', label: 'i., ii., iii.' }, { value: 'alphaLcPeriod', label: 'a., b., c.' }, { value: 'symbols', label: '*, †, ‡, §' }];
        r = await openDialog({ title: 'Footnote Options', fields: [
          { key: 'scheme', label: 'Numbering', type: 'select', options: schemes, value: cur.scheme, half: true },
          { key: 'restart', label: 'Restart numbering', type: 'select', options: [{ value: 'story', label: 'Never (per story)' }, { value: 'page', label: 'Every page' }], value: cur.restart, half: true },
          { key: 'style', label: 'Paragraph style of notes', type: 'select', options: app.pub.data.styles.para.map((s) => s.name), value: cur.style, half: true },
          { key: 'placement', label: 'Place notes at the bottom of', type: 'select', options: [{ value: 'column', label: 'The column of the reference' }, { value: 'frame', label: 'The last column of the frame' }], value: cur.placement, half: true },
          { key: 'width', label: 'Separator rule width (pt, 0 = none)', type: 'number', min: 0, step: 0.25, value: cur.separator.width, half: true },
          { key: 'length', label: 'Separator length (% of column)', type: 'number', min: 0, max: 100, value: Math.round(cur.separator.length * 100), half: true },
          { key: 'space', label: 'Space above notes (pt)', type: 'number', min: 0, value: cur.separator.space, half: true },
        ] });
        if (!r) return;
        r = { scheme: r.scheme, restart: r.restart, style: r.style, placement: r.placement, separator: { width: +r.width || 0, length: (+r.length || 0) / 100, space: +r.space || 0 } };
      }
      app.pub.transact('Footnote Options', () => { app.pub.data.footnoteOptions = { ...cur, ...r, separator: { ...cur.separator, ...(r.separator || {}) } }; });
    },
  },
  {
    id: 'text.footnotesToEndnotes', label: 'Footnotes to Endnotes', icon: 'low_priority', tab: 'Text', group: 'Notes', edits: true,
    tip: 'Move the story\'s footnotes into a "Notes" section at its end, keeping the numbers as links',
    run: async (app) => {
      const cur = currentStory(app);
      if (!cur || !cur.story.footnotes?.length) { toast('The selected story has no footnotes.'); return; }
      if (activeTextEditor()) app.tab.ui.commitText();
      const opts = fnOpts(app);
      app.pub.transact('Footnotes to Endnotes', () => {
        const s = app.pub.story(cur.story.id)!;
        const refs = footnoteRefs(s);
        const notes: Paragraph[] = [{ style: 'Heading 3', runs: [{ text: 'Notes' }] }];
        refs.forEach((ref, i) => {
          const fn = s.footnotes!.find((f) => f.id === ref.id);
          const label = footnoteLabel(i + 1, opts.scheme);
          ref.run.text = label; delete ref.run.footnote; ref.run.link = `#fn-${ref.id}`;
          const paras = fn ? clone(fn.paras) : [{ style: opts.style, runs: [] }];
          paras[0].runs.unshift({ text: label, cstyle: 'Footnote Reference', link: `#fn-${ref.id}` }, { text: ' ' });
          notes.push(...paras);
        });
        s.paras.push(...notes);
        delete s.footnotes;
      });
    },
  },
  {
    id: 'text.endnotesToFootnotes', label: 'Endnotes to Footnotes', icon: 'vertical_align_bottom', tab: 'Text', group: 'Notes', edits: true,
    tip: 'Turn a "Notes" section made by Footnotes to Endnotes back into footnotes (the number links must still be there)',
    run: (app) => {
      const cur = currentStory(app);
      if (!cur) { toast('Select a text frame first.'); return; }
      if (activeTextEditor()) app.tab.ui.commitText();
      const s = cur.story;
      const start = s.paras.findIndex((p) => p.runs[0]?.link?.startsWith('#fn-') && !p.runs.some((r) => r.baseline && r.link?.startsWith('#fn-') && r !== p.runs[0]));
      const refs = s.paras.flatMap((p) => p.runs.filter((r) => r.link?.startsWith('#fn-') && !r.footnote && r.baseline));
      if (start < 0 || !refs.length) { toast('No endnote markers found in this story.'); return; }
      app.pub.transact('Endnotes to Footnotes', () => {
        const footnotes: Footnote[] = [];
        let curFn: Footnote | null = null;
        const body = s.paras.slice(0, start);
        if (body[body.length - 1]?.style === 'Heading 3' && textOf([body[body.length - 1]]) === 'Notes') body.pop();
        for (const p of s.paras.slice(start)) {
          const first = p.runs[0];
          if (first?.link?.startsWith('#fn-') && p.runs[1]?.text === ' ') { curFn = { id: first.link.slice(4), paras: [{ ...p, runs: p.runs.slice(2) }] }; footnotes.push(curFn); }
          else if (curFn) curFn.paras.push(p);
          else body.push(p);
        }
        for (const p of body) for (const r of p.runs) if (r.link?.startsWith('#fn-') && r.baseline) { r.footnote = r.link.slice(4); delete r.link; }
        s.paras = body.length ? body : [{ style: 'Body', runs: [] }];
        s.footnotes = footnotes;
      });
    },
  },
  { id: 'text.footnotesPane', label: 'Footnotes', icon: 'notes', tab: 'Text', group: 'Notes', noRecord: true, tip: 'Every footnote of the publication: click one to go to its reference, edit its text in place', run: (app) => app.ui.togglePane('footnotes') },
]);

registerPane({
  id: 'footnotes', title: 'Footnotes',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const pub = app.pub;
    const sig = JSON.stringify([pub.version, app.tab.ui.selection]);
    if (!sigOf(el, sig) || typingIn(el)) return;
    clear(el);
    const cur = currentStory(app);
    const stories = pub.data.stories.filter((s) => s.footnotes?.length);
    if (!stories.length) { el.appendChild(h('p', { class: 'ql-help' }, 'No footnotes yet. Click in the text and use Text ▸ Insert Footnote (Ctrl+Alt+F).')); el.appendChild(h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.insertFootnote') }, icon('superscript'), ' Insert Footnote')); return; }
    for (const s of [...stories].sort((a, b) => (a === cur?.story ? -1 : b === cur?.story ? 1 : 0))) {
      const refs = footnoteRefs(s);
      const title = s.name || s.paras.map(paraText).find((t) => t.trim())?.slice(0, 40) || '(story)';
      el.appendChild(h('h3', { class: 'ql-pane-h' }, icon('article'), ` ${title}`, h('span', { class: 'ql-help' }, ` ${refs.length} note${refs.length === 1 ? '' : 's'}`)));
      for (const ref of refs) {
        const fn = s.footnotes!.find((f) => f.id === ref.id);
        if (!fn) continue;
        const ta = h('textarea', { class: 'ql-input qp-fn-text', rows: '2', 'aria-label': `Footnote ${ref.run.text}` }) as HTMLTextAreaElement;
        ta.value = fn.paras.map(paraText).join('\n');
        ta.addEventListener('keydown', (ev) => ev.stopPropagation());
        ta.addEventListener('change', () => {
          const lines = ta.value.replace(/\r\n?/g, '\n').split('\n');
          pub.transact('Edit Footnote', () => { fn.paras = lines.map((l, i) => { const old = fn.paras[i]; if (old && paraText(old) === l) return old; const fmt = old?.runs.find((x) => !x.br) || {}; const { text: _t, br: _b, ...keep } = fmt as any; return { style: old?.style || fnOpts(app).style, runs: l ? [{ ...keep, text: l }] : [] }; }); if (!fn.paras.length) fn.paras = [{ style: fnOpts(app).style, runs: [] }]; });
        });
        el.appendChild(h('div', { class: 'qp-fn-row' },
          h('button', { class: 'ql-btn ql-sm', title: 'Go to the reference', onclick: () => { app.tab.ui.commitText(); goToReference(app, s, ref.id); } }, h('sup', null, ref.run.text || '?')),
          ta,
          h('button', { class: 'ql-iconbtn ql-sm', title: 'Delete footnote', 'aria-label': 'Delete footnote', onclick: async () => { if (await confirmDialog('Delete Footnote', 'Remove this footnote and its reference?', 'Delete')) pub.transact('Delete Footnote', () => { s.footnotes = (s.footnotes || []).filter((f) => f.id !== ref.id); for (const p of s.paras) p.runs = p.runs.filter((r) => r.footnote !== ref.id); }); } }, icon('delete'))));
      }
    }
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.insertFootnote') }, icon('superscript'), ' Insert Footnote'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.footnoteOptions') }, 'Options…')));
  },
});
