/** Text tab: frame linking and flow, frame options, copy fitting, story editor, counts. */
import { def } from './registry';
import type { App } from '../app';
import type { Paragraph, TextFrame } from '../model/types';
import { UNITS } from '../model/types';
import { newId, clone, emptyParas, wordCount as countWords } from '../model/pub';
import { textTargets, selection, edit, unlinkAfter, fitFrameHeight, applyRun, linkFrames } from '../edit/ops';
import { activeTextEditor, paraText } from '../edit/textEdit';
import { storyLayout, oversetFrames, neededHeight } from '../render/flow';
import { autoflowStory } from '../edit/flowOps';
import { resolvePara, resolveRun } from '../model/styles';
import { openDialog, toast, confirmDialog } from '../ui/dialog';

const u = (app: App) => UNITS[app.prefs.unit];
const toU = (app: App, pt: number) => +(pt / u(app).pt).toFixed(u(app).digits);
const fromU = (app: App, v: any) => Math.max(0, (+v || 0) * u(app).pt);

function oneFrame(app: App): TextFrame | undefined {
  const f = textTargets(app)[0];
  if (!f) toast('Select a text frame first.');
  return f;
}

/** Selects a frame wherever it is (page or master). */
function showFrame(app: App, f: TextFrame): void {
  const pg = app.pub.pageOfItem(f.id);
  if (pg) app.goToPage(pg.id);
  app.tab.ui.select([f.id]);
}

/** Frame patch applied to every selected text frame as one step. */
function patchFrames(app: App, label: string, fn: (f: TextFrame) => void): boolean {
  const frames = textTargets(app);
  if (!frames.length) { toast('Select a text frame first.'); return false; }
  edit(app, label, () => frames.forEach(fn));
  return true;
}

/** Shrinks (or grows) the story's type until it fits its frames; returns the scale used. */
export function fitStory(app: App, f: TextFrame, opts: { grow?: boolean; min?: number } = {}): number {
  const pub = app.pub;
  const s = pub.story(f.story);
  if (!s) return 1;
  const orig = clone(s.paras);
  const sizeOf = (p: Paragraph, r: any) => resolveRun(pub.data, resolvePara(pub.data, p).run, r).size || 11;
  const apply = (k: number) => { s.paras = clone(orig).map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, size: +(sizeOf(p, r) * k).toFixed(2) })), end: p.end ? { ...p.end, size: +(sizeOf(p, p.end) * k).toFixed(2) } : undefined })); pub.version++; };
  const fits = () => { const lay = storyLayout(pub, s.id); return !!lay && !lay.r.overset; };
  if (fits() && !opts.grow) return 1;
  let lo = opts.min ?? 0.4, hi = opts.grow ? 3 : 1;
  if (opts.grow) { let k = 1; while (k < hi) { apply(k * 1.1); if (!fits()) break; k *= 1.1; } hi = k * 1.1; lo = Math.min(lo, 1); }
  let best = lo;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; apply(mid); if (fits()) { best = mid; lo = mid; } else hi = mid; }
  apply(best);
  return best;
}

def([
  {
    id: 'text.link', label: 'Link Frames', icon: 'link', tab: 'Text', group: 'Text Frames', keys: ['Mod-Shift-l'], popular: true, edits: true, origin: 'Linked text frames (Ventura, PageMaker, QuarkXPress)',
    tip: 'Flow the selected frame\'s story into another frame: click this, then click the frame the text should continue in',
    run: (app, arg?: { from: string; to: string }) => {
      const pub = app.pub;
      if (arg?.from && arg?.to) { const a = pub.frame(arg.from), b = pub.frame(arg.to); if (a && b) linkFrames(app, a, b); return; }
      const sel = textTargets(app);
      if (sel.length === 2) { if (linkFrames(app, sel[0], sel[1])) toast('Frames linked.'); return; }
      const f = oneFrame(app); if (!f) return;
      app.tab.ui.setTool({ kind: 'link', from: f });
      toast('Click the text frame the story should continue in (Esc cancels). Tip: select two frames and run Link Frames to link them in order.', { ms: 5000 });
    },
  },
  { id: 'text.unlink', label: 'Unlink Frame', icon: 'link_off', tab: 'Text', group: 'Text Frames', edits: true, tip: 'Break the chain after the selected frame; the text that follows gets its own story', run: (app) => { const f = oneFrame(app); if (f) unlinkAfter(app, f); } },
  { id: 'text.nextFrame', label: 'Next Frame in Story', icon: 'arrow_forward', tab: 'Text', group: 'Text Frames', keys: ['Mod-Alt-PageDown'], noRecord: true, run: (app) => { const f = oneFrame(app); if (!f) return; const n = f.next ? app.pub.frame(f.next) : undefined; if (n) showFrame(app, n); else toast('This is the last frame of the story.'); } },
  { id: 'text.prevFrame', label: 'Previous Frame in Story', icon: 'arrow_back', tab: 'Text', group: 'Text Frames', keys: ['Mod-Alt-PageUp'], noRecord: true, run: (app) => { const f = oneFrame(app); if (!f) return; const p = f.prev ? app.pub.frame(f.prev) : undefined; if (p) showFrame(app, p); else toast('This is the first frame of the story.'); } },
  {
    id: 'text.autoflow', label: 'Autoflow', icon: 'playlist_add', tab: 'Text', group: 'Text Frames', edits: true, popular: true, origin: 'Autoflow (PageMaker)',
    tip: 'Add linked frames (and pages) until every overset story fits',
    run: (app) => {
      const pub = app.pub;
      const sel = textTargets(app);
      const over = oversetFrames(pub).map((o) => o.frame).filter((f) => !sel.length || sel.some((s) => s.story === f.story));
      if (!over.length) { toast('No overset text: every story fits its frames.'); return; }
      let frames = 0;
      const before = pub.pages.length;
      pub.transact('Autoflow', () => { for (const f of over) frames += autoflowStory(pub, f); });
      const pages = pub.pages.length - before;
      toast(`Added ${frames} frame(s)${pages ? ` on ${pages} new page(s)` : ''}.`);
    },
  },
  { id: 'text.threadsPane', label: 'Text Threads', icon: 'account_tree', tab: 'Text', group: 'Text Frames', noRecord: true, run: (app) => app.ui.togglePane('threads') },
  {
    id: 'text.splitStory', label: 'Split Story Here', icon: 'content_cut', tab: 'Text', group: 'Text Frames', edits: true,
    tip: 'Make the selected frame the start of a new story (the frames before it keep theirs)',
    run: (app) => { const f = oneFrame(app); if (!f) return; const p = f.prev ? app.pub.frame(f.prev) : undefined; if (!p) { toast('This frame already starts its story.'); return; } unlinkAfter(app, p); },
  },
  {
    id: 'text.columns', label: 'Frame Columns', icon: 'view_column', tab: 'Text', group: 'Frame Options', kind: 'menu', edits: true,
    menu: (app) => { const f = textTargets(app)[0]; return [...[1, 2, 3, 4].map((n) => ({ id: 'text.columns', arg: { columns: n }, label: `${n} column${n > 1 ? 's' : ''}`, checked: (f?.columns || 1) === n })), { separator: true }, { id: 'text.columns', arg: 'dialog', label: 'Columns and Gutter…' }]; },
    run: async (app, arg?: { columns?: number; gutter?: number } | string) => {
      const f = oneFrame(app); if (!f) return;
      let cols = f.columns || 1, gutter = f.gutter ?? 12;
      if (typeof arg === 'object') { cols = arg.columns ?? cols; gutter = arg.gutter ?? gutter; }
      else { const r = await openDialog({ title: 'Frame Columns', fields: [{ key: 'c', label: 'Columns', type: 'number', min: 1, max: 20, value: cols, half: true }, { key: 'g', label: `Gutter (${u(app).label})`, type: 'number', min: 0, value: toU(app, gutter), half: true }] }); if (!r) return; cols = Math.max(1, +r.c || 1); gutter = fromU(app, r.g); }
      patchFrames(app, 'Frame Columns', (x) => { x.columns = cols > 1 ? cols : undefined; x.gutter = gutter; });
    },
  },
  {
    id: 'text.insets', label: 'Insets', icon: 'padding', tab: 'Text', group: 'Frame Options', kind: 'menu', edits: true,
    tip: 'Space between the frame edge and its text',
    menu: () => [{ id: 'text.insets', arg: 0, label: 'None' }, { id: 'text.insets', arg: 4, label: 'Small (4 pt)' }, { id: 'text.insets', arg: 9, label: 'Medium (9 pt)' }, { id: 'text.insets', arg: 18, label: 'Large (18 pt)' }, { separator: true }, { id: 'text.insets', arg: 'dialog', label: 'Custom…' }],
    run: async (app, arg?: number | string) => {
      const f = oneFrame(app); if (!f) return;
      let ins: [number, number, number, number];
      if (typeof arg === 'number') ins = [arg, arg, arg, arg];
      else {
        const cur = f.insets || [4, 4, 4, 4];
        const r = await openDialog({ title: 'Insets', fields: [{ key: 'l', label: `Left (${u(app).label})`, type: 'number', min: 0, value: toU(app, cur[0]), half: true }, { key: 't', label: 'Top', type: 'number', min: 0, value: toU(app, cur[1]), half: true }, { key: 'r', label: 'Right', type: 'number', min: 0, value: toU(app, cur[2]), half: true }, { key: 'b', label: 'Bottom', type: 'number', min: 0, value: toU(app, cur[3]), half: true }] });
        if (!r) return;
        ins = [fromU(app, r.l), fromU(app, r.t), fromU(app, r.r), fromU(app, r.b)];
      }
      patchFrames(app, 'Insets', (x) => { x.insets = ins; });
    },
  },
  {
    id: 'text.verticalAlign', label: 'Vertical Alignment', icon: 'vertical_align_center', tab: 'Text', group: 'Frame Options', kind: 'menu', edits: true,
    menu: (app) => { const f = textTargets(app)[0]; return ([['t', 'Top', 'vertical_align_top'], ['ctr', 'Center', 'vertical_align_center'], ['b', 'Bottom', 'vertical_align_bottom'], ['just', 'Justify', 'format_align_justify']] as const).map(([v, l, i]) => ({ id: 'text.verticalAlign', arg: v, label: l, icon: i, checked: (f?.anchor || 't') === v })); },
    run: (app, v?: TextFrame['anchor']) => { if (!v) return; patchFrames(app, 'Vertical Alignment', (x) => { x.anchor = v === 't' ? undefined : v; }); },
  },
  {
    id: 'text.autosize', label: 'Auto-Size Height', icon: 'height', tab: 'Text', group: 'Frame Options', kind: 'toggle', edits: true,
    tip: 'The frame grows or shrinks to fit its text (single frames only)',
    isActive: (app) => textTargets(app)[0]?.autosize === 'height',
    run: (app) => { const f = oneFrame(app); if (!f) return; const on = f.autosize === 'height'; patchFrames(app, 'Auto-Size', (x) => { x.autosize = on ? undefined : 'height'; }); if (!on) edit(app, 'Auto-Size', () => textTargets(app).forEach((x) => fitFrameHeight(app, x))); },
  },
  { id: 'text.fitFrameToText', label: 'Fit Frame to Text', icon: 'fit_screen', tab: 'Text', group: 'Frame Options', keys: ['Mod-Alt-c'], edits: true, run: (app) => { if (!textTargets(app).length) { toast('Select a text frame first.'); return; } edit(app, 'Fit Frame to Text', () => textTargets(app).forEach((x) => fitFrameHeight(app, x))); } },
  { id: 'text.ignoreWrap', label: 'Ignore Text Wrap', icon: 'wrap_text', tab: 'Text', group: 'Frame Options', kind: 'toggle', edits: true, tip: 'Text in this frame flows under objects that have wrap on', isActive: (app) => !!textTargets(app)[0]?.ignoreWrap, run: (app) => { const f = oneFrame(app); if (!f) return; const on = !!f.ignoreWrap; patchFrames(app, 'Ignore Text Wrap', (x) => { x.ignoreWrap = on ? undefined : true; }); } },
  { id: 'text.vertical', label: 'Vertical Text', icon: 'text_rotate_vertical', tab: 'Text', group: 'Frame Options', kind: 'toggle', edits: true, tip: 'Rotate the text 90° inside the frame (for spines and tabs)', isActive: (app) => !!textTargets(app)[0]?.vertical, run: (app) => { const f = oneFrame(app); if (!f) return; const on = !!f.vertical; patchFrames(app, 'Vertical Text', (x) => { x.vertical = on ? undefined : true; }); } },
  {
    id: 'text.frameOptions', label: 'Text Frame Options…', icon: 'tune', tab: 'Text', group: 'Frame Options', keys: ['Mod-Alt-b'], edits: true,
    run: async (app) => {
      const f = oneFrame(app); if (!f) return;
      const ins = f.insets || [4, 4, 4, 4];
      const r = await openDialog({ title: 'Text Frame Options', wide: true, fields: [
        { key: 'name', label: 'Name', type: 'text', value: f.name || '', half: true },
        { key: 'anchor', label: 'Vertical alignment', type: 'select', options: [{ value: 't', label: 'Top' }, { value: 'ctr', label: 'Center' }, { value: 'b', label: 'Bottom' }, { value: 'just', label: 'Justify' }], value: f.anchor || 't', half: true },
        { key: 'c', label: 'Columns', type: 'number', min: 1, max: 20, value: f.columns || 1, half: true }, { key: 'g', label: `Gutter (${u(app).label})`, type: 'number', min: 0, value: toU(app, f.gutter ?? 12), half: true },
        { key: 'l', label: `Inset left (${u(app).label})`, type: 'number', min: 0, value: toU(app, ins[0]), half: true }, { key: 't', label: 'Inset top', type: 'number', min: 0, value: toU(app, ins[1]), half: true },
        { key: 'r', label: 'Inset right', type: 'number', min: 0, value: toU(app, ins[2]), half: true }, { key: 'b', label: 'Inset bottom', type: 'number', min: 0, value: toU(app, ins[3]), half: true },
        { key: 'auto', label: 'Auto-size height to the text', type: 'checkbox', value: f.autosize === 'height', half: true },
        { key: 'ignore', label: 'Ignore text wrap from other objects', type: 'checkbox', value: !!f.ignoreWrap, half: true },
        { key: 'vertical', label: 'Vertical text', type: 'checkbox', value: !!f.vertical, half: true },
        { key: 'first', label: 'First baseline', type: 'select', options: [{ value: 'ascent', label: 'Ascent' }, { value: 'capHeight', label: 'Cap height' }, { value: 'leading', label: 'Leading' }], value: f.firstBaseline || 'ascent', half: true },
      ] });
      if (!r) return;
      patchFrames(app, 'Text Frame Options', (x) => { x.name = r.name || undefined; x.anchor = r.anchor === 't' ? undefined : r.anchor; x.columns = +r.c > 1 ? +r.c : undefined; x.gutter = fromU(app, r.g); x.insets = [fromU(app, r.l), fromU(app, r.t), fromU(app, r.r), fromU(app, r.b)]; x.autosize = r.auto ? 'height' : undefined; x.ignoreWrap = r.ignore || undefined; x.vertical = r.vertical || undefined; x.firstBaseline = r.first === 'ascent' ? undefined : r.first; });
      if (r.auto) edit(app, 'Auto-Size', () => textTargets(app).forEach((x) => fitFrameHeight(app, x)));
    },
  },
  {
    id: 'text.fitCopy', label: 'Fit Copy', icon: 'compress', tab: 'Text', group: 'Tools', kind: 'split', edits: true, origin: 'Copy fitting (QuarkXPress, Ventura)',
    tip: 'Scale the story\'s type down (or up) so it exactly fills its frames',
    menu: () => [{ id: 'text.fitCopy', arg: 'shrink', label: 'Shrink to Fit' }, { id: 'text.fitCopy', arg: 'grow', label: 'Grow to Fill' }, { id: 'text.fitCopy', arg: 'frame', label: 'Fit Frame Height to Text' }],
    run: (app, how: string = 'shrink') => {
      const f = oneFrame(app); if (!f) return;
      if (how === 'frame') { app.exec('text.fitFrameToText'); return; }
      let k = 1;
      app.pub.transact('Fit Copy', () => { k = fitStory(app, f, { grow: how === 'grow' }); });
      toast(k === 1 ? 'The text already fits.' : `Type scaled to ${Math.round(k * 100)}%.`);
    },
  },
  {
    id: 'text.oversetReport', label: 'Overset Text', icon: 'error', tab: 'Text', group: 'Tools', noRecord: true,
    tip: 'Every frame whose story does not fit, with the characters cut off',
    run: async (app) => {
      const pub = app.pub;
      const over = oversetFrames(pub);
      if (!over.length) { toast('No overset text.'); return; }
      const r = await openDialog({ title: 'Overset Text', fields: [{ key: 'f', label: `${over.length} frame(s) have text that does not fit`, type: 'list', rows: 8, options: over.map((o) => { const pg = pub.pageOfItem(o.frame.id); return { value: o.frame.id, label: `${pg ? `Page ${pub.pageIndex(pg.id) + 1}` : 'Master'}: ${o.frame.name || 'Text frame'} — ${o.chars} characters overset` }; }), value: over[0].frame.id }], ok: 'Go To', buttons: [{ label: 'Autoflow All', onClick: (_v, ctl) => { ctl.close(); app.exec('text.autoflow'); } }] });
      if (!r) return;
      const f = pub.frame(r.f);
      if (f) showFrame(app, f);
    },
  },
  {
    id: 'text.storyEditor', label: 'Story Editor', icon: 'edit_note', tab: 'Text', group: 'Tools', keys: ['Mod-y'], edits: true, origin: 'Story Editor (PageMaker), Story Editor (Scribus)',
    tip: 'Edit the whole story as plain paragraphs in a window, whatever frames it flows through',
    run: async (app) => {
      const f = oneFrame(app); if (!f) return;
      const pub = app.pub;
      const s = pub.story(f.story); if (!s) return;
      const text = s.paras.map((p) => `${p.style && p.style !== 'Body' ? `[${p.style}] ` : ''}${paraText(p)}`).join('\n');
      const r = await openDialog({ title: `Story Editor${s.name ? `: ${s.name}` : ''}`, wide: true, fields: [{ key: 't', label: 'Paragraphs (one per line; start a line with [Style Name] to set its paragraph style)', type: 'textarea', rows: 18, value: text }], help: 'Character formatting inside a paragraph is kept where the text is unchanged; edited paragraphs take the formatting of their first run.' });
      if (!r || r.t === text) return;
      const lines = String(r.t).replace(/\r\n?/g, '\n').split('\n');
      pub.transact('Story Editor', () => {
        const out: Paragraph[] = lines.map((l, i) => {
          const m = /^\[([^\]]+)\]\s?/.exec(l);
          const style = m ? m[1] : s.paras[i]?.style || 'Body';
          const body = m ? l.slice(m[0].length) : l;
          const old = s.paras[i];
          if (old && paraText(old) === body && (old.style || 'Body') === style) return old;
          const fmt = old?.runs.find((x) => !x.br && !x.field) || old?.end || {};
          const { text: _t, br: _b, field: _f, varName: _v, ...keep } = fmt as any;
          return { ...(old ? { ...old, runs: [] } : {}), style, runs: body ? [{ ...keep, text: body }] : [] };
        });
        s.paras = out.length ? out : emptyParas();
      });
    },
  },
  {
    id: 'text.wordCount', label: 'Word Count', icon: 'pin', tab: 'Text', group: 'Tools', noRecord: true,
    run: async (app) => {
      const pub = app.pub;
      const ed = activeTextEditor();
      const selText = ed?.selectedText() || '';
      const f = textTargets(app)[0];
      const story = f ? pub.story(f.story) : undefined;
      const count = (t: string) => ({ words: (t.match(/\S+/g) || []).length, chars: t.length, charsNoSpace: t.replace(/\s/g, '').length });
      const storyText = story ? story.paras.map(paraText).join('\n') : '';
      const all = pub.data.stories.map((s) => s.paras.map(paraText).join('\n')).join('\n');
      const rows = [selText ? ['Selection', count(selText)] : null, story ? ['Story', count(storyText)] : null, ['Publication', count(all)]].filter(Boolean) as [string, ReturnType<typeof count>][];
      await openDialog({ title: 'Word Count', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<table class="ql-table"><tr><th></th><th>Words</th><th>Characters</th><th>Without spaces</th></tr>${rows.map(([n, c]) => `<tr><td>${n}</td><td>${c.words}</td><td>${c.chars}</td><td>${c.charsNoSpace}</td></tr>`).join('')}</table><p class="ql-help">Pages: ${pub.pages.length} · Stories: ${pub.data.stories.length} · Paragraphs: ${pub.data.stories.reduce((a, s) => a + s.paras.length, 0)}</p>` }] });
    },
  },
  { id: 'text.changeCase', label: 'Change Case', icon: 'match_case', tab: 'Text', group: 'Tools', kind: 'menu', edits: true, menu: () => [{ id: 'fmt.changeCase', arg: 'sentence', label: 'Sentence case.' }, { id: 'fmt.changeCase', arg: 'lower', label: 'lowercase' }, { id: 'fmt.changeCase', arg: 'upper', label: 'UPPERCASE' }, { id: 'fmt.changeCase', arg: 'title', label: 'Capitalize Each Word' }], run: (app) => app.exec('fmt.changeCase', 'toggle') },
  { id: 'text.insertLorem', label: 'Fill with Placeholder Text', icon: 'notes', tab: 'Text', group: 'Tools', edits: true, run: (app) => app.exec('insert.placeholderText') },
  { id: 'text.editText', label: 'Edit Text', icon: 'edit', tab: 'Text', group: 'Tools', keys: ['F2'], noRecord: true, tip: 'Start editing the selected frame\'s text', run: (app) => { const f = textTargets(app)[0]; if (f) app.tab.ui.editText(f.id); else toast('Select a text frame first.'); } },
  {
    id: 'text.newStoryFromSelection', label: 'Text to New Frame', icon: 'open_in_new', tab: 'Text', group: 'Tools', edits: true,
    tip: 'Move the selected text into a new frame of its own',
    run: (app) => {
      const ed = activeTextEditor();
      const t = ed?.selectedText();
      if (!ed || !t) { toast('Select some text inside a frame first.'); return; }
      const run = ed.caretRun();
      ed.insertText('');
      app.tab.ui.commitText();
      const paras = t.split('\n').map((l) => ({ style: 'Body', runs: l ? [{ ...run, text: l }] : [] })) as Paragraph[];
      const { x, y, w } = selection(app)[0] || { x: 72, y: 72, w: 200 };
      const f = app.pub.newTextFrame({ x: x + 24, y: y + 24, w, h: Math.max(40, 16 * paras.length + 10) }, paras);
      edit(app, 'Text to New Frame', (o) => { o.items.push(f); });
      app.tab.ui.select([f.id]);
    },
  },
  {
    id: 'text.scaleType', label: 'Scale Type…', icon: 'format_size', tab: 'Text', group: 'Tools', edits: true,
    tip: 'Multiply every type size in the selected frames by a factor',
    run: async (app) => {
      const r = await openDialog({ title: 'Scale Type', fields: [{ key: 'k', label: 'Scale (%)', type: 'number', min: 10, max: 1000, value: 90 }] });
      if (!r) return;
      const k = (+r.k || 100) / 100;
      applyRun(app, 'Scale Type', (x) => ({ size: +(((x.size || resolveRun(app.pub.data, resolvePara(app.pub.data, {} as Paragraph).run, x).size || 11)) * k).toFixed(2) }));
    },
  },
  {
    id: 'text.storyName', label: 'Name Story…', icon: 'label', tab: 'Text', group: 'Tools', edits: true,
    run: async (app) => { const f = oneFrame(app); if (!f) return; const s = app.pub.story(f.story); if (!s) return; const r = await openDialog({ title: 'Name Story', fields: [{ key: 'n', label: 'Name (shown in the Text Threads pane)', type: 'text', value: s.name || '' }] }); if (!r) return; app.pub.transact('Name Story', () => { s.name = r.n.trim() || undefined; }); },
  },
  {
    id: 'text.clearStory', label: 'Clear Story Text', icon: 'backspace', tab: 'Text', group: 'Tools', edits: true,
    run: async (app) => { const f = oneFrame(app); if (!f) return; const s = app.pub.story(f.story); if (!s) return; if (countWords(s.paras) > 20 && !(await confirmDialog('Clear Story', `Remove all ${countWords(s.paras)} words of this story?`, 'Clear'))) return; app.pub.transact('Clear Story', () => { s.paras = emptyParas(s.paras[0]?.style); }); },
  },
  { id: 'text.neededHeight', label: 'Report Needed Height', icon: 'straighten', tab: 'Text', group: 'Tools', noRecord: true, tip: 'How tall the selected frame must be for its text', run: (app) => { const f = oneFrame(app); if (!f) return; toast(`Needs ${toU(app, neededHeight(app.pub, f))} ${u(app).label} (frame is ${toU(app, f.h)} ${u(app).label}).`); } },
]);

