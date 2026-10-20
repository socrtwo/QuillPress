/**
 * Footnotes: references in the text, notes at the bottom of the column (stories), under the rows
 * (tables) or under the box (text on a path); in-place editing of a note; endnote conversion; the
 * Footnotes pane.
 */
import { def } from './registry';
import type { App } from '../app';
import type { Footnote, FootnoteOptions, NumScheme, Paragraph, PathTextItem, Run, Story, TableItem, TextFrame } from '../model/types';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';
import { newId, clone, textOf } from '../model/pub';
import { ensureFootnoteStyles } from '../model/styles';
import { textTargets, selection } from '../edit/ops';
import { activeTextEditor, paraText } from '../edit/textEdit';
import { storyLayout } from '../render/flow';
import { footnoteLabel } from '../render/text';
import { registerPane, sigOf, typingIn } from '../ui/panes';
import { h, icon, clear } from '../ui/dom';
import { openDialog, toast, confirmDialog } from '../ui/dialog';
import { insertRunAt } from './anchor';

const fnOpts = (app: App): FootnoteOptions => app.pub.data.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS;

/** Where footnotes live: a story (set in its frames), a table or a text-on-a-path item. */
export type NoteSource = { kind: 'story'; story: Story; frame: TextFrame } | { kind: 'table'; item: TableItem } | { kind: 'path'; item: PathTextItem };

/** The story being edited or of the first selected frame. */
function currentStory(app: App): { story: Story; frame: TextFrame } | null {
  const ed = activeTextEditor();
  const frame = ed?.frame || textTargets(app)[0];
  const story = frame ? app.pub.story(frame.story) : undefined;
  return story && frame ? { story, frame } : null;
}

/** The footnote source at the caret or in the selection: the edited story, else the first selected frame, table or path text. */
export function currentSource(app: App): NoteSource | null {
  const cur = currentStory(app);
  if (cur) return { kind: 'story', ...cur };
  for (const e of selection(app)) {
    if (e.kind === 'table') return { kind: 'table', item: e };
    if (e.kind === 'pathText') return { kind: 'path', item: e };
  }
  return null;
}

/** Footnote references of a story in text order. */
export function footnoteRefs(story: Story): { id: string; para: number; off: number; run: Run }[] {
  const out: { id: string; para: number; off: number; run: Run }[] = [];
  story.paras.forEach((p, pi) => { let off = 0; for (const r of p.runs) { if (r.footnote) out.push({ id: r.footnote, para: pi, off, run: r }); off += r.br ? 1 : r.text.length; } });
  return out;
}

/** The paragraphs of a source that may hold references (cells in reading order for a table). */
function sourceParas(src: NoteSource): Paragraph[] {
  if (src.kind === 'story') return src.story.paras;
  if (src.kind === 'path') return src.item.text;
  return src.item.rows.flatMap((r) => r.cells.filter((c) => !c.merged).flatMap((c) => c.text));
}

/** References of a source in reading order. */
export function sourceRefs(src: NoteSource): { id: string; run: Run }[] {
  const out: { id: string; run: Run }[] = [];
  for (const p of sourceParas(src)) for (const r of p.runs) if (r.footnote) out.push({ id: r.footnote, run: r });
  return out;
}

function sourceNotes(src: NoteSource): Footnote[] { return (src.kind === 'story' ? src.story.footnotes : src.item.footnotes) || []; }
function setSourceNotes(src: NoteSource, notes: Footnote[] | undefined): void {
  if (src.kind === 'story') { if (notes) src.story.footnotes = notes; else delete src.story.footnotes; }
  else if (notes) src.item.footnotes = notes; else delete src.item.footnotes;
}
const sourceLabel = (src: NoteSource) => src.kind === 'story' ? 'story' : src.kind === 'table' ? 'table' : 'text on a path';

/** The footnote whose reference is at (or just before) the caret, else the first of the story. */
function footnoteAtCaret(app: App, story: Story): string | undefined {
  const ed = activeTextEditor();
  const refs = footnoteRefs(ed && !ed.footnote ? { ...story, paras: ed.read() } : story);
  if (!refs.length) return undefined;
  const pos = ed && !ed.footnote ? ed.caretPos() : null;
  if (!pos) return refs[0].id;
  const before = refs.filter((r) => r.para < pos.para || (r.para === pos.para && r.off <= pos.off));
  return (before[before.length - 1] || refs[0]).id;
}

/** The note at the caret (stories) or the remembered one (tables, path text), else the first. */
function noteAt(app: App, src: NoteSource): string | undefined {
  if (src.kind === 'story') return footnoteAtCaret(app, src.story);
  const refs = sourceRefs(src);
  const cur = (app as any).noteCursor as { item: string; id: string } | undefined;
  return (cur && cur.item === src.item.id && refs.some((r) => r.id === cur.id) ? cur.id : refs[0]?.id);
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

/** Goes to a note's reference: the caret after it (stories) or the item selected (tables, path text). */
function goToNote(app: App, src: NoteSource, id: string): void {
  if (src.kind === 'story') { goToReference(app, src.story, id); return; }
  const pg = app.pub.pageOfItem(src.item.id);
  if (pg) app.goToPage(pg.id);
  app.tab.ui.select([src.item.id]);
  (app as any).noteCursor = { item: src.item.id, id };
}

const labelOf = (src: NoteSource, id: string) => sourceRefs(src).find((r) => r.id === id)?.run.text || '';

async function editFootnoteDialog(app: App, label: string, fn: Footnote): Promise<void> {
  const text = fn.paras.map(paraText).join('\n');
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

/**
 * Edits a note: in place (a second island over the note lines) for a story whose note is laid out,
 * unless touch mode is on; otherwise in the dialog (tables, path text, the pane, phones).
 */
async function editNote(app: App, src: NoteSource, fn: Footnote): Promise<void> {
  if (src.kind === 'story' && !app.prefs.touchMode) {
    const ui = app.tab.ui as unknown as { editFootnote?: (frameId: string, fnId: string) => boolean };
    if (typeof ui.editFootnote === 'function' && ui.editFootnote(src.frame.id, fn.id)) return;
  }
  if (activeTextEditor()) app.tab.ui.commitText();
  await editFootnoteDialog(app, labelOf(src, fn.id), fn);
}

// ------------------------------------------------------------------------------------------
// `[^note text]` markers: plain-text editors (table cells, the path text dialog) show a reference as
// its note's text inside the marker and read it back into a reference run and a note.

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
const unesc = (t: string) => t.replace(/\\(.)/g, '$1');
const MARKER = /\[\^((?:[^\]\\]|\\.)*)\]/g;

/** The text of paragraphs with footnote references written as `[^note text]` markers. */
export function notesMarkup(paras: Paragraph[], notes: Footnote[] | undefined): string[] {
  return paras.map((p) => p.runs.map((r) => {
    if (r.br) return '\n';
    if (!r.footnote) return r.text;
    const fn = notes?.find((f) => f.id === r.footnote);
    return `[^${esc(fn ? fn.paras.map(paraText).join(' ') : '')}]`;
  }).join(''));
}

/**
 * Builds paragraphs from marked-up lines. A marker whose text equals that of a note referenced in
 * `old` (in order) keeps that note; other markers make new notes (appended to `notes`). Paragraphs
 * whose markup is unchanged are kept as they are (formatting included).
 */
export function parseNotesMarkup(lines: string[], old: Paragraph[], notes: Footnote[], style: string, fnStyle: string, keepOf: (i: number) => Record<string, unknown>): Paragraph[] {
  const oldMarkup = notesMarkup(old, notes);
  const unused = old.flatMap((p) => p.runs.filter((r) => r.footnote).map((r) => r.footnote!));
  const textOfNote = (id: string) => { const fn = notes.find((f) => f.id === id); return fn ? fn.paras.map(paraText).join(' ') : ''; };
  return lines.map((l, i) => {
    const o = old[i];
    if (o && oldMarkup[i] === l) { for (const r of o.runs) if (r.footnote) { const k = unused.indexOf(r.footnote); if (k >= 0) unused.splice(k, 1); } return o; }
    const keep = keepOf(i);
    const runs: Run[] = [];
    let last = 0;
    for (const m of l.matchAll(MARKER)) {
      const before = l.slice(last, m.index);
      if (before) runs.push({ ...keep, text: before } as Run);
      const text = unesc(m[1]);
      let id = unused.find((u) => textOfNote(u) === text);
      if (id) unused.splice(unused.indexOf(id), 1);
      else { id = newId('fn'); notes.push({ id, paras: [{ style: fnStyle, runs: text ? [{ text }] : [] }] }); }
      runs.push({ text: '1', footnote: id, cstyle: 'Footnote Reference', baseline: 33 });
      last = (m.index || 0) + m[0].length;
    }
    const tail = l.slice(last);
    if (tail) runs.push({ ...keep, text: tail } as Run);
    return { style: o?.style || style, runs };
  });
}

/** Drops the notes of a source that no reference uses any more. */
export function pruneNotes(src: NoteSource): void {
  const used = new Set(sourceRefs(src).map((r) => r.id));
  const notes = sourceNotes(src).filter((f) => used.has(f.id));
  setSourceNotes(src, notes.length ? notes : undefined);
}

// ------------------------------------------------------------------------------------------

/** Inserts a footnote at the caret (stories), at the end of the current cell (tables) or of the text (path text). */
export function insertFootnote(app: App, text?: string): string | null {
  const ed = activeTextEditor();
  if (ed?.footnote) { toast('A footnote cannot hold another footnote.'); return null; }
  const src = currentSource(app);
  if (!src) { toast('Click in the text where the footnote reference should go.'); return null; }
  const id = newId('fn');
  const opts = fnOpts(app);
  if (src.kind === 'story') {
    const { story } = src;
    let pos = { para: story.paras.length - 1, off: Infinity };
    if (ed) { pos = ed.caretPos() || pos; app.tab.ui.commitText(); }
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
  const n = sourceRefs(src).length + 1;
  app.pub.transact('Insert Footnote', () => {
    ensureFootnoteStyles(app.pub.data);
    const item = src.item;
    let p: Paragraph | undefined;
    if (item.kind === 'table') {
      const cur = (app as any).tableCursor as { id: string; r: number; c: number } | undefined;
      const r = cur?.id === item.id ? cur.r : 0, c = cur?.id === item.id ? cur.c : 0;
      const cell = item.rows[r]?.cells[c] || item.rows[0]?.cells[0];
      if (!cell) return;
      if (!cell.text.length) cell.text.push({ style: 'Table Text', runs: [] });
      p = cell.text[cell.text.length - 1];
    } else {
      if (!item.text.length) item.text.push({ style: 'Body', runs: [] });
      p = item.text[item.text.length - 1];
    }
    (item.footnotes ||= []).push({ id, paras: [{ style: opts.style, runs: text ? [{ text }] : [] }] });
    p.runs.push({ text: footnoteLabel(n, opts.scheme), footnote: id, cstyle: 'Footnote Reference', baseline: 33 });
  });
  (app as any).noteCursor = { item: src.item.id, id };
  return id;
}

/** Deletes a note and its reference from any source. */
function deleteNote(app: App, src: NoteSource, id: string): void {
  app.pub.transact('Delete Footnote', () => {
    for (const p of sourceParas(src)) p.runs = p.runs.filter((r) => r.footnote !== id);
    setSourceNotes(src, sourceNotes(src).filter((f) => f.id !== id));
    if (!sourceNotes(src).length) setSourceNotes(src, undefined);
  });
}

/** The reference label of each note of a source, by id (the laid labels where the layout has them). */
function noteLabels(app: App, src: NoteSource): Record<string, string> {
  const out: Record<string, string> = {};
  const scheme = fnOpts(app).scheme;
  if (src.kind === 'story') { const lay = storyLayout(app.pub, src.story.id); if (lay?.r.footnoteLabels) Object.assign(out, lay.r.footnoteLabels); }
  sourceRefs(src).forEach((r, i) => { if (!out[r.id]) out[r.id] = r.run.text || footnoteLabel(i + 1, scheme); });
  return out;
}

def([
  {
    id: 'text.insertFootnote', label: 'Insert Footnote', icon: 'superscript', tab: 'Text', group: 'Notes', keys: ['Mod-Alt-f'], popular: true, edits: true, origin: 'Footnotes (Ventura Publisher, FrameMaker, InDesign)',
    tip: 'A numbered reference at the caret, with its note set at the bottom of the column (under a table or a text path); on a reference, opens its note',
    run: async (app, text?: string) => {
      const ed = activeTextEditor();
      if (ed?.footnote) { ed.finish(true); return; }
      if (ed && typeof text !== 'string') {
        // The caret on (just after) a reference: jump into its note instead of adding one.
        const pos = ed.caretPos();
        const story = app.pub.story(ed.frame.story);
        if (pos && story) {
          const at = footnoteRefs({ ...story, paras: ed.read() }).find((r) => r.para === pos.para && (r.off === pos.off || r.off + r.run.text.length === pos.off));
          if (at && story.footnotes?.some((f) => f.id === at.id)) { await app.exec('text.editFootnote', at.id); return; }
        }
      }
      const id = insertFootnote(app, typeof text === 'string' ? text : undefined);
      if (!id || typeof text === 'string') return;
      const src = currentSource(app);
      const fn = src && sourceNotes(src).find((f) => f.id === id);
      if (src && fn) await editNote(app, src, fn);
    },
  },
  {
    id: 'text.editFootnote', label: 'Edit Footnote', icon: 'edit_note', tab: 'Text', group: 'Notes', edits: true,
    tip: 'Edit the text of the footnote at the caret in place (in a dialog for tables, path text and touch mode)',
    run: async (app, id?: string) => {
      const ed = activeTextEditor();
      if (ed?.footnote && (!id || id === ed.footnote.id)) { ed.finish(true); return; }
      const src = currentSource(app);
      if (!src) { toast('Click in the text near the footnote reference first.'); return; }
      const fid = id || noteAt(app, src);
      const fn = sourceNotes(src).find((f) => f.id === fid);
      if (!fn) { toast(`This ${sourceLabel(src)} has no footnotes. Insert one with Text ▸ Insert Footnote.`); return; }
      await editNote(app, src, fn);
    },
  },
  {
    id: 'text.deleteFootnote', label: 'Delete Footnote', icon: 'delete_sweep', tab: 'Text', group: 'Notes', edits: true,
    tip: 'Remove the footnote at the caret and its reference',
    run: (app, id?: string) => {
      const src = currentSource(app);
      if (!src) { toast('Click in the text near the footnote reference first.'); return; }
      const fid = id || noteAt(app, src);
      if (!fid) { toast('No footnote here.'); return; }
      if (activeTextEditor()) app.tab.ui.commitText();
      deleteNote(app, src, fid);
    },
  },
  {
    id: 'text.nextFootnote', label: 'Next Footnote', icon: 'arrow_downward', tab: 'Text', group: 'Notes', noRecord: true,
    run: async (app) => { const src = currentSource(app); if (!src) { toast('Select a text frame, table or text path first.'); return; } const refs = sourceRefs(src); if (!refs.length) { toast(`No footnotes in this ${sourceLabel(src)}.`); return; } const at = noteAt(app, src); const i = refs.findIndex((r) => r.id === at); const next = refs[(i + 1) % refs.length]; app.tab.ui.commitText(); goToNote(app, src, next.id); if (src.kind !== 'story') { const fn = sourceNotes(src).find((f) => f.id === next.id); if (fn) await editNote(app, src, fn); } },
  },
  {
    id: 'text.prevFootnote', label: 'Previous Footnote', icon: 'arrow_upward', tab: 'Text', group: 'Notes', noRecord: true,
    run: async (app) => { const src = currentSource(app); if (!src) { toast('Select a text frame, table or text path first.'); return; } const refs = sourceRefs(src); if (!refs.length) { toast(`No footnotes in this ${sourceLabel(src)}.`); return; } const at = noteAt(app, src); const i = refs.findIndex((r) => r.id === at); const prev = refs[(i - 1 + refs.length) % refs.length]; app.tab.ui.commitText(); goToNote(app, src, prev.id); if (src.kind !== 'story') { const fn = sourceNotes(src).find((f) => f.id === prev.id); if (fn) await editNote(app, src, fn); } },
  },
  {
    id: 'text.goToReference', label: 'Go to Reference', icon: 'subdirectory_arrow_left', tab: 'Text', group: 'Notes', noRecord: true,
    tip: 'Put the caret after the reference of a footnote (selects the table or text path holding it)',
    run: (app, id?: string) => { const src = currentSource(app); if (!src) { toast('Select a text frame first.'); return; } const fid = id || noteAt(app, src); if (!fid) { toast(`No footnotes in this ${sourceLabel(src)}.`); return; } app.tab.ui.commitText(); goToNote(app, src, fid); },
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
        ], help: 'Numbering, the note style and the separator also apply to footnotes in tables (numbered per table) and in text on a path (numbered per item).' });
        if (!r) return;
        r = { scheme: r.scheme, restart: r.restart, style: r.style, placement: r.placement, separator: { width: +r.width || 0, length: (+r.length || 0) / 100, space: +r.space || 0 } };
      }
      app.pub.transact('Footnote Options', () => { app.pub.data.footnoteOptions = { ...cur, ...r, separator: { ...cur.separator, ...(r.separator || {}) } }; });
    },
  },
  {
    id: 'text.footnotesToEndnotes', label: 'Footnotes to Endnotes', icon: 'low_priority', tab: 'Text', group: 'Notes', edits: true,
    tip: 'Move the footnotes into a "Notes" section at the end of the story (for a table or text path: the first text frame on its page, or a new frame), keeping the numbers as links',
    run: async (app) => {
      const src = currentSource(app);
      if (!src || !sourceNotes(src).length) { toast('The selection has no footnotes.'); return; }
      if (activeTextEditor()) app.tab.ui.commitText();
      const opts = fnOpts(app);
      const pub = app.pub;
      const endnotes = (refs: { id: string; run: Run }[], notes: Footnote[]): Paragraph[] => {
        const out: Paragraph[] = [{ style: 'Heading 3', runs: [{ text: 'Notes' }] }];
        refs.forEach((ref, i) => {
          const fn = notes.find((f) => f.id === ref.id);
          const label = footnoteLabel(i + 1, opts.scheme);
          ref.run.text = label; delete ref.run.footnote; ref.run.link = `#fn-${ref.id}`;
          const paras = fn ? clone(fn.paras) : [{ style: opts.style, runs: [] }];
          paras[0].runs.unshift({ text: label, cstyle: 'Footnote Reference', link: `#fn-${ref.id}` }, { text: ' ' });
          out.push(...paras);
        });
        return out;
      };
      if (src.kind === 'story') {
        pub.transact('Footnotes to Endnotes', () => {
          const s = pub.story(src.story.id)!;
          s.paras.push(...endnotes(footnoteRefs(s), s.footnotes || []));
          delete s.footnotes;
        });
        return;
      }
      // A table or text path: the notes go to the first text frame on its page, else to a new frame under the item.
      const page = pub.pageOfItem(src.item.id);
      const host = page?.items.find((e): e is TextFrame => e.kind === 'text' && !!pub.story(e.story));
      pub.transact('Footnotes to Endnotes', () => {
        const paras = endnotes(sourceRefs(src), sourceNotes(src));
        delete src.item.footnotes;
        if (host) { pub.story(host.story)!.paras.push(...paras); return; }
        const it = src.item;
        const f = pub.newTextFrame({ x: it.x, y: it.y + it.h + 12, w: Math.max(120, it.w), h: 72 }, paras);
        f.autosize = 'height';
        (page || app.page)?.items.push(f);
      });
      toast(host ? `Notes appended to "${host.name || 'the first text frame'}" on this page.` : 'Notes placed in a new frame under the item.');
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
  { id: 'text.footnotesPane', label: 'Footnotes', icon: 'notes', tab: 'Text', group: 'Notes', noRecord: true, tip: 'Every footnote of the publication (stories, tables, text on paths): click one to go to its reference, edit its text in place', run: (app) => app.ui.togglePane('footnotes') },
]);

/** Every source with footnotes: stories, then tables and path texts page by page. */
function allSources(app: App): NoteSource[] {
  const pub = app.pub;
  const out: NoteSource[] = [];
  for (const s of pub.data.stories) if (s.footnotes?.length) { const frame = pub.chainOf(s.id)[0]; if (frame) out.push({ kind: 'story', story: s, frame }); }
  const walk = (items: TableItem[] | PathTextItem[] | any[]) => { for (const e of items) { if (e.kind === 'table' && e.footnotes?.length) out.push({ kind: 'table', item: e }); else if (e.kind === 'pathText' && e.footnotes?.length) out.push({ kind: 'path', item: e }); else if (e.kind === 'group') walk(e.children); } };
  for (const p of pub.pages) walk(p.items);
  for (const m of pub.data.masters) walk(m.items);
  return out;
}

registerPane({
  id: 'footnotes', title: 'Footnotes',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const pub = app.pub;
    const sig = JSON.stringify([pub.version, app.tab.ui.selection]);
    if (!sigOf(el, sig) || typingIn(el)) return;
    clear(el);
    const cur = currentSource(app);
    const sources = allSources(app);
    if (!sources.length) { el.appendChild(h('p', { class: 'ql-help' }, 'No footnotes yet. Click in the text and use Text ▸ Insert Footnote (Ctrl+Alt+F).')); el.appendChild(h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.insertFootnote') }, icon('superscript'), ' Insert Footnote')); return; }
    const same = (a: NoteSource, b: NoteSource | null) => !!b && a.kind === b.kind && (a.kind === 'story' ? a.story === (b as any).story : a.item === (b as any).item);
    for (const src of [...sources].sort((a, b) => (same(a, cur) ? -1 : same(b, cur) ? 1 : 0))) {
      const refs = sourceRefs(src);
      const notes = sourceNotes(src);
      const labels = noteLabels(app, src);
      const title = src.kind === 'story' ? (src.story.name || src.story.paras.map(paraText).find((t) => t.trim())?.slice(0, 40) || '(story)') : src.kind === 'table' ? `Table${src.item.name ? `: ${src.item.name}` : ''}` : `Text on a path${src.item.name ? `: ${src.item.name}` : ''}`;
      el.appendChild(h('h3', { class: 'ql-pane-h' }, icon(src.kind === 'story' ? 'article' : src.kind === 'table' ? 'table' : 'gesture'), ` ${title}`, h('span', { class: 'ql-help' }, ` ${refs.length} note${refs.length === 1 ? '' : 's'}`)));
      for (const ref of refs) {
        const fn = notes.find((f) => f.id === ref.id);
        if (!fn) continue;
        const label = labels[ref.id] || ref.run.text || '?';
        const ta = h('textarea', { class: 'ql-input qp-fn-text', rows: '2', 'aria-label': `Footnote ${label}` }) as HTMLTextAreaElement;
        ta.value = fn.paras.map(paraText).join('\n');
        ta.addEventListener('keydown', (ev) => ev.stopPropagation());
        ta.addEventListener('change', () => {
          const lines = ta.value.replace(/\r\n?/g, '\n').split('\n');
          pub.transact('Edit Footnote', () => { fn.paras = lines.map((l, i) => { const old = fn.paras[i]; if (old && paraText(old) === l) return old; const fmt = old?.runs.find((x) => !x.br) || {}; const { text: _t, br: _b, footnote: _f, anchor: _a, ...keep } = fmt as any; return { style: old?.style || fnOpts(app).style, runs: l ? [{ ...keep, text: l }] : [] }; }); if (!fn.paras.length) fn.paras = [{ style: fnOpts(app).style, runs: [] }]; });
        });
        el.appendChild(h('div', { class: 'qp-fn-row' },
          h('button', { class: 'ql-btn ql-sm', title: src.kind === 'story' ? 'Go to the reference' : `Select the ${sourceLabel(src)}`, onclick: () => { app.tab.ui.commitText(); goToNote(app, src, ref.id); } }, h('sup', null, label)),
          ta,
          h('button', { class: 'ql-iconbtn ql-sm', title: 'Delete footnote', 'aria-label': 'Delete footnote', onclick: async () => { if (await confirmDialog('Delete Footnote', 'Remove this footnote and its reference?', 'Delete')) deleteNote(app, src, ref.id); } }, icon('delete'))));
      }
    }
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.insertFootnote') }, icon('superscript'), ' Insert Footnote'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.footnoteOptions') }, 'Options…')));
  },
});
