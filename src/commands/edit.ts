/** Edit commands: clipboard (objects, pages, text, pictures), undo/redo, find and replace, selection, format painter. */
import { def } from './registry';
import type { App } from '../app';
import type { Pub } from '../model/pub';
import type { Item, Page, Paragraph, Story, Fill, Line, Effects, RunProps, ParaProps, TextFrame } from '../model/types';
import { clone, newId, reId } from '../model/pub';
import { edit, selection, deleteSelection, duplicateSelection, forEachText, textTargets, insertItem, newTextFrame, replaceInPara, flatItems } from '../edit/ops';
import { activeTextEditor } from '../edit/textEdit';
import { openDialog, toast } from '../ui/dialog';
import { readClipboardText, writeClipboardText } from '../platform/native';
import { registerPane } from '../ui/panes';
import { h, clear, icon } from '../ui/dom';

export interface ClipItem { kind: 'items' | 'pages'; data: any; stories: Story[]; media: Record<string, any>; text: string; time: number }

/** Clipboard history shown in the Clipboard pane (newest first). */
export const clipHistory: ClipItem[] = [];

function collectMedia(pub: Pub, json: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const id of Object.keys(pub.media)) if (json.includes(`"${id}"`)) out[id] = pub.media[id];
  return out;
}

function storiesOf(pub: Pub, items: Item[]): Story[] {
  const ids = new Set<string>();
  const walk = (els: Item[]) => { for (const e of els) { if (e.kind === 'text') ids.add(e.story); else if (e.kind === 'group') walk(e.children); } };
  walk(items);
  return pub.data.stories.filter((s) => ids.has(s.id)).map((s) => clone(s));
}

export function itemText(pub: Pub, e: Item): string {
  if (e.kind === 'text') { const s = pub.story(e.story); return s ? s.paras.map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n') : ''; }
  if (e.kind === 'table') return e.rows.map((r) => r.cells.map((c) => c.text.map((p) => p.runs.map((x) => x.text).join('')).join(' ')).join('\t')).join('\n');
  if (e.kind === 'group') return e.children.map((c) => itemText(pub, c)).filter(Boolean).join('\n');
  return '';
}

function putClip(app: App, item: ClipItem): void {
  app.clip = item;
  clipHistory.unshift(item);
  if (clipHistory.length > 24) clipHistory.pop();
  void writeClipboardText(item.text);
  if (app.ui.paneOpen('clipboard')) app.refresh();
}

const railFocused = () => !!document.activeElement?.closest?.('.qp-pages-rail');

function copySelection(app: App): boolean {
  const pub = app.pub;
  const els = selection(app);
  if ((railFocused() || !els.length) && !app.tab.masterTarget) {
    const pages = app.targetPages();
    if (!pages.length) return false;
    const data = clone(pages);
    const stories = storiesOf(pub, pages.flatMap((p) => p.items));
    const json = JSON.stringify(data) + JSON.stringify(stories);
    putClip(app, { kind: 'pages', data, stories, media: collectMedia(pub, json), text: pages.map((p) => p.items.map((e) => itemText(pub, e)).filter(Boolean).join('\n')).join('\n\n'), time: Date.now() });
    toast(`${pages.length} page${pages.length > 1 ? 's' : ''} copied`);
    return true;
  }
  if (!els.length) return false;
  const data = clone(els);
  const stories = storiesOf(pub, els);
  const json = JSON.stringify(data) + JSON.stringify(stories);
  putClip(app, { kind: 'items', data, stories, media: collectMedia(pub, json), text: els.map((e) => itemText(pub, e)).filter(Boolean).join('\n'), time: Date.now() });
  return true;
}

/** Copies items with new ids, new story copies, and links kept only among the copies. */
function cloneItems(pub: Pub, src: Item[], stories: Story[]): Item[] {
  const idMap = new Map<string, string>();
  const storyMap = new Map<string, string>();
  const out = src.map((e) => {
    const c = reId(e);
    const pair = (a: Item, b: Item) => { idMap.set(a.id, b.id); if (a.kind === 'group' && b.kind === 'group') a.children.forEach((x, i) => pair(x, b.children[i])); };
    pair(e, c);
    return c;
  });
  const fix = (e: Item) => {
    if (e.kind === 'text') {
      let ns = storyMap.get(e.story);
      if (!ns) {
        const s = stories.find((x) => x.id === e.story);
        ns = newId('st');
        pub.data.stories.push({ id: ns, paras: s ? clone(s.paras) : [{ style: 'Body', runs: [] }], name: s?.name });
        storyMap.set(e.story, ns);
      }
      e.story = ns;
      e.prev = e.prev && idMap.has(e.prev) ? idMap.get(e.prev) : undefined;
      e.next = e.next && idMap.has(e.next) ? idMap.get(e.next) : undefined;
    } else if (e.kind === 'group') e.children.forEach(fix);
  };
  out.forEach(fix);
  return out;
}

/** Pastes pages from the clipboard after the current page. */
export function pastePages(app: App, item: ClipItem): void {
  const pub = app.pub;
  for (const [k, v] of Object.entries(item.media)) if (!pub.media[k]) pub.media[k] = v;
  const at = Math.max(0, pub.pageIndex(app.tab.current)) + 1;
  pub.transact('Paste Pages', () => {
    const pages: Page[] = clone(item.data);
    const ids: string[] = [];
    pages.forEach((p, i) => {
      p.id = newId('pg');
      if (!pub.data.masters.some((m) => m.id === p.master)) p.master = pub.data.masters[0].id;
      p.items = cloneItems(pub, p.items, item.stories);
      p.comments = [];
      pub.data.pages.splice(at + i, 0, p);
      ids.push(p.id);
    });
    app.tab.current = ids[0];
    app.tab.pageSel = ids;
  });
  app.tab.ui.showPage(app.tab.current);
}

function pasteItems(app: App, item: ClipItem, asText = false): void {
  const pub = app.pub;
  for (const [k, v] of Object.entries(item.media)) if (!pub.media[k]) pub.media[k] = v;
  if (asText) { if (item.text) insertItem(app, newTextFrame(app, item.text), 'Paste'); return; }
  let els: Item[] = [];
  edit(app, 'Paste', (own) => {
    els = cloneItems(pub, item.data, item.stories);
    const same = els.some((e) => own.items.some((x) => x.x === e.x && x.y === e.y));
    for (const e of els) {
      if (same) { e.x += 12; e.y += 12; if (e.kind === 'group') for (const c of e.children) { c.x += 12; c.y += 12; } }
      own.items.push(e);
    }
  });
  app.tab.ui.select(els.map((e) => e.id));
}

async function pasteFromSystem(app: App, mode: 'auto' | 'text' | 'picture' = 'auto'): Promise<void> {
  try {
    if (mode !== 'text' && (navigator.clipboard as any)?.read) {
      const items = await (navigator.clipboard as any).read();
      for (const it of items) {
        const type = it.types.find((t: string) => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const buf = new Uint8Array(await blob.arrayBuffer());
          app.exec('insert.pictureFiles', { files: [new File([buf], 'Pasted picture', { type })] });
          return;
        }
      }
    }
  } catch { /* permission denied or unsupported */ }
  const text = await readClipboardText();
  if (app.clip && (text == null || text === app.clip.text || !text)) {
    if (app.clip.kind === 'pages') pastePages(app, app.clip);
    else pasteItems(app, app.clip, mode === 'text');
    return;
  }
  if (!text) { toast('The clipboard is empty, or this browser does not allow reading it here. Use Ctrl+V.'); return; }
  const targets = textTargets(app);
  if (targets.length === 1) {
    app.tab.ui.editText(targets[0].id);
    requestAnimationFrame(() => document.execCommand('insertText', false, text));
    return;
  }
  insertItem(app, newTextFrame(app, text.replace(/\r\n?/g, '\n')), 'Paste');
}

// ------------------------------------------------------------------------------------------
// Format painter

interface CopiedFormat { fill?: Fill; line?: Line; effects?: Effects; run?: RunProps; para?: ParaProps; wrap?: Item['wrap']; insets?: TextFrame['insets']; columns?: number }

function copyFormat(app: App): CopiedFormat | null {
  const ed = activeTextEditor();
  if (ed) return { run: ed.caretRun(), para: stripPara(ed.caretPara()) };
  const e = selection(app)[0];
  if (!e) return null;
  const f: CopiedFormat = { fill: e.fill, line: e.line, effects: e.effects, wrap: e.wrap };
  if (e.kind === 'text') {
    f.insets = e.insets; f.columns = e.columns;
    const p = app.pub.story(e.story)?.paras[0];
    if (p) { f.run = { ...(p.runs[0] || p.end || {}) }; delete (f.run as any).text; delete (f.run as any).field; f.para = stripPara(p); }
  }
  return f;
}

function stripPara(p: Partial<Paragraph>): ParaProps {
  const { runs: _r, end: _e, ...rest } = p as any;
  return rest;
}

function pasteFormat(app: App, f: CopiedFormat): void {
  const ed = activeTextEditor();
  if (ed) { if (f.run) ed.applyRun(f.run); if (f.para) ed.applyPara(f.para); return; }
  const els = selection(app);
  if (!els.length) return;
  edit(app, 'Paste Formatting', () => {
    for (const e of els) {
      if (f.fill !== undefined) e.fill = clone(f.fill);
      if (f.line !== undefined) e.line = clone(f.line);
      if (f.effects !== undefined) e.effects = clone(f.effects);
      if (f.wrap !== undefined) e.wrap = clone(f.wrap);
      if (e.kind === 'text') {
        if (f.insets) e.insets = [...f.insets]; if (f.columns) e.columns = f.columns;
        const s = app.pub.story(e.story);
        if (s && (f.run || f.para)) for (const p of s.paras) { if (f.para) Object.assign(p, f.para); if (f.run) for (const r of p.runs) Object.assign(r, f.run); }
      }
    }
  });
}

let painterWatch: (() => void) | null = null;

function stopPainter(app: App): void {
  painterWatch?.(); painterWatch = null; app.painter = null; document.body.classList.remove('qp-painting'); app.refresh();
}

function startPainter(app: App, sticky: boolean): void {
  const f = copyFormat(app);
  if (!f) { toast('Select an object or text whose formatting you want to copy.'); return; }
  painterWatch?.();
  app.painter = { fmt: f, sticky };
  const source = new Set(app.tab.ui.selection);
  let last = [...source].join(',');
  document.body.classList.add('qp-painting');
  toast(sticky ? 'Format Painter is on: click objects to apply. Press Esc or click Format Painter again to stop.' : 'Click an object to apply the formatting.');
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc, true); stopPainter(app); } };
  document.addEventListener('keydown', esc, true);
  const off = app.onRefresh(() => {
    const cur = app.tab.ui.selection.join(',');
    if (cur === last || !cur) return;
    last = cur;
    if (app.tab.ui.selection.every((id) => source.has(id))) return;
    const p = app.painter;
    if (!p) return;
    pasteFormat(app, p.fmt);
    if (!p.sticky) { document.removeEventListener('keydown', esc, true); stopPainter(app); }
  });
  painterWatch = () => { off(); document.removeEventListener('keydown', esc, true); };
}

// ------------------------------------------------------------------------------------------
// Find and replace

export interface Hit { story?: string; item?: string; para: number; off: number; len: number }

export function findAll(pub: Pub, needle: string, opts: { matchCase?: boolean; whole?: boolean } = {}): Hit[] {
  if (!needle) return [];
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(opts.whole ? `\\b${esc}\\b` : esc, opts.matchCase ? 'g' : 'gi');
  const hits: Hit[] = [];
  const scan = (paras: Paragraph[], where: { story?: string; item?: string }) => paras.forEach((p, pi) => {
    const t = p.runs.map((r) => (r.br ? '\n' : r.text)).join('');
    for (const m of t.matchAll(re)) hits.push({ ...where, para: pi, off: m.index!, len: m[0].length });
  });
  for (const s of pub.data.stories) scan(s.paras, { story: s.id });
  const walk = (items: Item[]) => { for (const e of items) { if (e.kind === 'table') for (const r of e.rows) for (const c of r.cells) scan(c.text, { item: e.id }); if (e.kind === 'group') walk(e.children); } };
  for (const p of pub.pages) walk(p.items);
  for (const m of pub.data.masters) walk(m.items);
  return hits;
}

function parasOf(pub: Pub, hit: Hit): Paragraph[] | null {
  if (hit.story) return pub.story(hit.story)?.paras || null;
  // Table cells: the hit's paragraph index counts across the table's cells in order.
  return null;
}

/** Shows a hit: goes to its page and selects the frame or table. */
function showHit(app: App, hit: Hit): void {
  const pub = app.pub;
  let id = hit.item;
  if (hit.story) {
    const chain = pub.chainOf(hit.story);
    id = chain[0]?.id;
  }
  if (!id) return;
  const pg = pub.pageOfItem(id);
  if (pg) app.goToPage(pg.id);
  else { const m = pub.data.masters.find((x) => !!pub.findItem(x, id!)); if (m) app.exec('page.editMaster', m.id); }
  app.tab.ui.select([id]);
}

function replaceHit(pub: Pub, hit: Hit, text: string): boolean {
  const paras = parasOf(pub, hit);
  if (paras) { replaceInPara(paras[hit.para], hit.off, hit.len, text); return true; }
  // Table cell hit: find the cell paragraph by walking the table's cells.
  let k = 0, done = false;
  const walk = (items: Item[]) => { for (const e of items) { if (done) return; if (e.kind === 'table' && e.id === hit.item) { for (const r of e.rows) for (const c of r.cells) for (const p of c.text) { if (k++ === hit.para) { replaceInPara(p, hit.off, hit.len, text); done = true; return; } } } if (e.kind === 'group') walk(e.children); } };
  for (const p of pub.pages) walk(p.items);
  for (const m of pub.data.masters) walk(m.items);
  return done;
}

async function findDialog(app: App, replace: boolean): Promise<void> {
  const sel = activeTextEditor()?.selectedText() || '';
  let hits: Hit[] = [];
  let at = -1;
  let ctlRef: any = null;
  const opts = () => ({ matchCase: !!ctlRef?.get('case'), whole: !!ctlRef?.get('whole') });
  const show = (hit: Hit) => { showHit(app, hit); app.ui.status(`Match ${at + 1} of ${hits.length}`); };
  await openDialog({
    title: replace ? 'Replace' : 'Find', modeless: true,
    fields: [
      { key: 'q', label: 'Find what', type: 'text', value: sel },
      ...(replace ? [{ key: 'r', label: 'Replace with', type: 'text' as const, value: '' }] : []),
      { key: 'case', label: 'Match case', type: 'checkbox', value: false, half: true },
      { key: 'whole', label: 'Find whole words only', type: 'checkbox', value: false, half: true },
    ],
    buttons: [
      { label: 'Find Next', onClick: (v: any, ctl: any) => { ctlRef = ctl; hits = findAll(app.pub, v.q, opts()); if (!hits.length) { toast(`"${v.q}" was not found.`); return; } at = (at + 1) % hits.length; show(hits[at]); } },
      ...(replace ? [
        { label: 'Replace', onClick: (v: any, ctl: any) => {
          ctlRef = ctl;
          hits = findAll(app.pub, v.q, opts());
          if (!hits.length) { toast(`"${v.q}" was not found.`); return; }
          const hit = hits[Math.max(0, Math.min(at, hits.length - 1))];
          app.pub.transact('Replace', () => replaceHit(app.pub, hit, v.r));
          hits = findAll(app.pub, v.q, opts());
          if (hits.length) { at = Math.min(Math.max(0, at), hits.length - 1); show(hits[at]); }
        } },
        { label: 'Replace All', onClick: (v: any, ctl: any) => {
          ctlRef = ctl;
          const all = findAll(app.pub, v.q, opts());
          if (!all.length) { toast(`"${v.q}" was not found.`); return; }
          app.pub.transact('Replace All', () => { for (const hit of [...all].sort((a, b) => b.off - a.off)) replaceHit(app.pub, hit, v.r); });
          toast(`Replaced ${all.length} occurrence${all.length > 1 ? 's' : ''}.`);
        } },
      ] : []),
    ],
    ok: 'Close', cancel: false,
  } as any);
}

// ------------------------------------------------------------------------------------------

def([
  {
    id: 'edit.undo', label: 'Undo', icon: 'undo', tab: 'Home', group: 'Undo', keys: ['Mod-z'], popular: true, noRecord: true,
    tip: 'Undo the last change', isEnabled: (app) => app.tab?.ui?.editingText || !!app.pub?.canUndo,
    kind: 'split', menu: (app) => app.pub.undoLabels().slice(0, 20).map((l, i) => ({ id: 'edit.undo', arg: i + 1, label: l })),
    run: (app, n?: number) => {
      if (app.tab.ui.editingText) { document.execCommand('undo'); return; }
      for (let i = 0; i < (typeof n === 'number' ? n : 1); i++) app.pub.undo();
      app.tab.ui.select(app.tab.ui.selection);
    },
  },
  {
    id: 'edit.redo', label: 'Redo', icon: 'redo', tab: 'Home', group: 'Undo', keys: ['Mod-y', 'Mod-Shift-z', 'F4'], popular: true, noRecord: true,
    tip: 'Redo the last undone change, or repeat the last command',
    run: (app) => {
      if (app.tab.ui.editingText) { document.execCommand('redo'); return; }
      if (app.pub.canRedo) { app.pub.redo(); return; }
      const last = app.lastCommand;
      if (last && last.id !== 'edit.redo') app.exec(last.id, last.arg);
    },
  },
  { id: 'edit.repeat', label: 'Repeat', icon: 'repeat', tab: 'Home', group: 'Undo', noRecord: true, run: (app) => { const l = app.lastCommand; if (l) app.exec(l.id, l.arg); } },
  {
    id: 'edit.cut', label: 'Cut', icon: 'content_cut', tab: 'Home', group: 'Clipboard', keys: ['Mod-x', 'Shift-Delete'], popular: true, edits: true,
    run: (app) => {
      if (app.tab.ui.editingText) { document.execCommand('cut'); return; }
      if (!copySelection(app)) return;
      if (app.clip?.kind === 'pages') app.exec('page.delete');
      else deleteSelection(app);
    },
  },
  {
    id: 'edit.copy', label: 'Copy', icon: 'content_copy', tab: 'Home', group: 'Clipboard', keys: ['Mod-c', 'Mod-Insert'], popular: true, noRecord: true,
    run: (app) => { if (app.tab.ui.editingText) { document.execCommand('copy'); return; } copySelection(app); },
  },
  {
    id: 'edit.paste', label: 'Paste', icon: 'content_paste', tab: 'Home', group: 'Clipboard', keys: ['Mod-v', 'Shift-Insert'], popular: true, edits: true, kind: 'split',
    menu: () => [
      { id: 'edit.pasteObjects', label: 'Paste Objects', icon: 'category' }, { id: 'edit.pasteInPlace', label: 'Paste in Place', icon: 'place_item' },
      { id: 'edit.pastePicture', label: 'Paste as Picture', icon: 'image' }, { id: 'edit.pasteText', label: 'Keep Text Only', icon: 'text_fields' },
      { separator: true }, { id: 'edit.pasteSpecial', label: 'Paste Special…', icon: 'content_paste_go' },
    ],
    run: async (app) => {
      if (app.tab.ui.editingText) {
        const t = await readClipboardText();
        if (t != null) document.execCommand('insertText', false, t);
        else document.execCommand('paste');
        return;
      }
      await pasteFromSystem(app);
    },
  },
  { id: 'edit.pasteObjects', label: 'Paste Objects', icon: 'category', tab: 'Home', group: 'Clipboard', edits: true, run: (app) => { const c = app.clip; if (!c) return pasteFromSystem(app); if (c.kind === 'pages') pastePages(app, c); else pasteItems(app, c); } },
  {
    id: 'edit.pasteInPlace', label: 'Paste in Place', icon: 'place_item', tab: 'Home', group: 'Clipboard', keys: ['Mod-Alt-Shift-v'], edits: true, origin: 'Paste in Place (page layout programs)',
    tip: 'Paste the copied objects at exactly the position they were copied from (on this page or another)',
    run: (app) => {
      const c = app.clip;
      if (!c || c.kind !== 'items') { toast('Copy some objects first.'); return; }
      let els: Item[] = [];
      edit(app, 'Paste in Place', (own) => { els = cloneItems(app.pub, c.data, c.stories); own.items.push(...els); });
      app.tab.ui.select(els.map((e) => e.id));
    },
  },
  { id: 'edit.pasteText', label: 'Paste: Keep Text Only', icon: 'text_fields', tab: 'Home', group: 'Clipboard', keys: ['Mod-Shift-Alt-t'], edits: true, run: (app) => pasteFromSystem(app, 'text') },
  {
    id: 'edit.pastePicture', label: 'Paste as Picture', icon: 'image', tab: 'Home', group: 'Clipboard', edits: true,
    tip: 'Paste the copied objects as one SVG picture',
    run: async (app) => {
      const c = app.clip;
      if (!c || c.kind !== 'items') return pasteFromSystem(app, 'picture');
      const pub = app.pub;
      for (const [k, v] of Object.entries(c.media)) if (!pub.media[k]) pub.media[k] = v;
      const els: Item[] = cloneItems(pub, c.data, c.stories);
      const x = Math.min(...els.map((e) => e.x)), y = Math.min(...els.map((e) => e.y));
      const r = Math.max(...els.map((e) => e.x + e.w)), b = Math.max(...els.map((e) => e.y + e.h));
      const { pageSvg } = await import('../render/page');
      const page = app.page || pub.pages[0];
      const svg = pageSvg(pub, page, { mode: 'export', items: els }).replace(/viewBox="[^"]*"/, `viewBox="${x} ${y} ${r - x} ${b - y}"`).replace(/ width="[^"]*" height="[^"]*"/, ` width="${r - x}" height="${b - y}"`);
      // The temporary story copies are not needed once rendered.
      const temp = new Set<string>(); const walk = (items: Item[]) => { for (const e of items) { if (e.kind === 'text') temp.add(e.story); if (e.kind === 'group') walk(e.children); } }; walk(els);
      pub.data.stories = pub.data.stories.filter((s) => !temp.has(s.id));
      const b64 = btoa(unescape(encodeURIComponent(svg)));
      const media = pub.addMedia({ mime: 'image/svg+xml', b64, name: 'Pasted picture.svg', w: Math.round(r - x), h: Math.round(b - y) });
      insertItem(app, { id: newId('pic'), kind: 'picture', media, name: 'Picture', x: x + 12, y: y + 12, w: r - x, h: b - y, fit: 'fit' }, 'Paste as Picture');
    },
  },
  {
    id: 'edit.pasteSpecial', label: 'Paste Special…', icon: 'content_paste_go', tab: 'Home', group: 'Clipboard', keys: ['Mod-Alt-v'], edits: true,
    run: async (app) => {
      const c = app.clip;
      const opts = [
        ...(c?.kind === 'pages' ? [{ value: 'edit.pasteObjects', label: 'Pages after the current page' }] : []),
        ...(c?.kind === 'items' ? [{ value: 'edit.pasteObjects', label: 'QuillPress objects' }, { value: 'edit.pasteInPlace', label: 'Objects in place' }, { value: 'edit.pastePicture', label: 'Picture (SVG)' }] : []),
        { value: 'edit.pasteText', label: 'Unformatted text' },
      ];
      const r = await openDialog({ title: 'Paste Special', fields: [{ key: 'as', label: 'As', type: 'radio', options: opts, value: opts[0].value }] });
      if (r) app.exec(r.as);
    },
  },
  { id: 'edit.duplicate', label: 'Duplicate', icon: 'control_point_duplicate', tab: 'Home', group: 'Clipboard', keys: ['Mod-d'], edits: true, tip: 'Duplicate the selected objects (or the current page when nothing is selected)', run: (app) => { if (selection(app).length) duplicateSelection(app); else app.exec('page.duplicate'); } },
  {
    id: 'edit.formatPainter', label: 'Format Painter', icon: 'format_paint', tab: 'Home', group: 'Clipboard', kind: 'toggle', noRecord: true,
    tip: 'Copy formatting from the selection to the next object you click. Double-click (or long-press ▸ Keep Format Painter On) to apply it to several.',
    isActive: (app) => !!app.painter,
    run: (app, arg) => { if (app.painter) { stopPainter(app); return; } startPainter(app, arg === 'sticky'); },
  },
  { id: 'edit.copyFormat', label: 'Copy Formatting', icon: 'format_paint', tab: 'Home', group: 'Clipboard', keys: ['Mod-Shift-c'], noRecord: true, run: (app) => { const f = copyFormat(app); if (f) { (app as any).copiedFormat = f; toast('Formatting copied'); } } },
  { id: 'edit.pasteFormat', label: 'Paste Formatting', icon: 'format_paint', tab: 'Home', group: 'Clipboard', keys: ['Mod-Shift-v'], edits: true, run: (app) => { const f = (app as any).copiedFormat; if (f) pasteFormat(app, f); else toast('Copy formatting first (Ctrl+Shift+C).'); } },
  { id: 'edit.clipboardPane', label: 'Clipboard', icon: 'content_paste_search', tab: 'Home', group: 'Clipboard', noRecord: true, run: (app) => app.ui.togglePane('clipboard') },
  {
    id: 'edit.selectAll', label: 'Select All', icon: 'select_all', tab: 'Home', group: 'Editing', keys: ['Mod-a'], noRecord: true,
    run: (app) => {
      if (app.tab.ui.editingText) { document.execCommand('selectAll'); return; }
      if (railFocused()) { app.tab.pageSel = app.pub.pages.map((p) => p.id); app.tab.ui.invalidate(); app.refresh(); return; }
      const hiddenLayers = new Set(app.pub.data.layers.filter((l) => l.hidden || l.locked).map((l) => l.id));
      app.tab.ui.select((app.owner?.items || []).filter((e) => !e.hidden && !e.locked && !(e.layer && hiddenLayers.has(e.layer))).map((e) => e.id));
    },
  },
  { id: 'edit.selectAllPages', label: 'Select All Pages', icon: 'select_all', tab: 'Home', group: 'Editing', noRecord: true, run: (app) => { app.tab.pageSel = app.pub.pages.map((p) => p.id); app.tab.ui.invalidate(); app.refresh(); } },
  { id: 'edit.deselect', label: 'Deselect All', icon: 'deselect', tab: 'Home', group: 'Editing', keys: ['Mod-Shift-a'], noRecord: true, run: (app) => { if (app.tab.ui.editingText) app.tab.ui.commitText(); app.tab.ui.select([]); } },
  {
    id: 'edit.selectNext', label: 'Select Next Object', icon: 'skip_next', tab: 'Home', group: 'Editing', noRecord: true,
    tip: 'Cycle through the objects of the page (also Tab on the canvas)',
    run: (app, back?: boolean) => { const items = flatItems(app.owner!).filter((e) => !e.hidden); if (!items.length) return; const i = items.findIndex((e) => e.id === app.tab.ui.selection[0]); app.tab.ui.select([items[(i + (back ? -1 : 1) + items.length) % items.length].id]); },
  },
  { id: 'edit.selectPrev', label: 'Select Previous Object', icon: 'skip_previous', tab: 'Home', group: 'Editing', noRecord: true, run: (app) => app.exec('edit.selectNext', true) },
  {
    id: 'edit.selectSimilar', label: 'Select Similar', icon: 'select', tab: 'Home', group: 'Editing', noRecord: true, kind: 'menu',
    menu: () => [{ id: 'edit.selectSimilar', arg: 'type', label: 'Same Type' }, { id: 'edit.selectSimilar', arg: 'fill', label: 'Same Fill' }, { id: 'edit.selectSimilar', arg: 'line', label: 'Same Outline' }, { id: 'edit.selectSimilar', arg: 'layer', label: 'Same Layer' }, { id: 'edit.selectSimilar', arg: 'style', label: 'Same Object Style' }],
    run: (app, kind = 'type') => {
      const ref = selection(app)[0];
      const o = app.owner;
      if (!ref || !o) { toast('Select an object first.'); return; }
      const key = (e: Item) => kind === 'fill' ? JSON.stringify(e.fill || null) : kind === 'line' ? JSON.stringify(e.line || null) : kind === 'layer' ? e.layer || '' : kind === 'style' ? e.ostyle || '' : `${e.kind}:${(e as any).geom || ''}`;
      const k = key(ref);
      app.tab.ui.select(o.items.filter((e) => key(e) === k).map((e) => e.id));
    },
  },
  {
    id: 'edit.selectMenu', label: 'Select', icon: 'arrow_selector_tool', tab: 'Home', group: 'Editing', kind: 'menu', noRecord: true,
    menu: () => [{ id: 'edit.selectAll', label: 'Select All', icon: 'select_all' }, { id: 'edit.selectAllPages', label: 'Select All Pages' }, { id: 'edit.deselect', label: 'Deselect All' }, { separator: true }, { id: 'edit.selectSimilar', arg: 'type', label: 'Select Same Type' }, { id: 'edit.selectSimilar', arg: 'fill', label: 'Select Same Fill' }, { id: 'edit.selectSimilar', arg: 'line', label: 'Select Same Outline' }, { id: 'edit.selectSimilar', arg: 'layer', label: 'Select Same Layer' }, { separator: true }, { id: 'fmt.selectByStyle', label: 'Select Frames by Style…' }, { id: 'view.layersPane', label: 'Layers Pane…', icon: 'layers' }],
    run: (app) => app.exec('edit.selectAll'),
  },
  { id: 'edit.find', label: 'Find', icon: 'search', tab: 'Home', group: 'Editing', keys: ['Mod-f'], popular: true, noRecord: true, run: (app) => findDialog(app, false) },
  { id: 'edit.replace', label: 'Replace', icon: 'find_replace', tab: 'Home', group: 'Editing', keys: ['Mod-h'], noRecord: true, run: (app) => findDialog(app, true) },
  {
    id: 'edit.replaceFonts', label: 'Replace Fonts…', icon: 'font_download', tab: 'Home', group: 'Editing', edits: true,
    tip: 'Change every use of one font to another, in styles and in local formatting',
    run: async (app) => {
      const { fontsUsed, DEFAULT_BODY_FONT } = await import('../model/styles');
      const list = fontsUsed(app.pub.data);
      if (!list.length) { toast('This publication uses only the default fonts.'); return; }
      const { FONT_LIST } = await import('../fonts');
      const r = await openDialog({ title: 'Replace Font', fields: [{ key: 'from', label: 'Replace', type: 'select', options: list, value: list[0] }, { key: 'to', label: 'With', type: 'combo', options: FONT_LIST, value: DEFAULT_BODY_FONT }] });
      if (!r?.to) return;
      const pub = app.pub;
      let n = 0;
      pub.transact('Replace Fonts', () => {
        const fixRun = (x: RunProps | undefined) => { if (x && x.font === r.from) { x.font = r.to; n++; } };
        forEachText(app, (paras) => { for (const p of paras) { for (const rr of p.runs) fixRun(rr); fixRun(p.end); if (p.bullet && p.bullet.font === r.from) p.bullet.font = r.to; } });
        for (const st of pub.data.styles.para) fixRun(st.run);
        for (const st of pub.data.styles.char) fixRun(st);
      });
      toast(`Replaced ${n} use(s) of ${r.from}.`);
    },
  },
  { id: 'edit.delete', label: 'Delete', icon: 'delete', tab: 'Home', group: 'Editing', edits: true, run: (app) => { if (selection(app).length) deleteSelection(app); else app.exec('page.delete'); } },
  {
    id: 'edit.goToObject', label: 'Go to Object…', icon: 'my_location', tab: 'Home', group: 'Editing', noRecord: true,
    tip: 'Select an object by its name',
    run: async (app) => {
      const all: { value: string; label: string }[] = [];
      for (const p of app.pub.pages) for (const e of flatItems(p)) all.push({ value: `${p.id}:${e.id}`, label: `Page ${app.pub.pageIndex(p.id) + 1}: ${e.name || e.kind}` });
      if (!all.length) { toast('There are no objects yet.'); return; }
      const r = await openDialog({ title: 'Go to Object', fields: [{ key: 'o', label: 'Object', type: 'list', rows: 10, options: all, value: all[0].value }] });
      if (!r?.o) return;
      const [pg, id] = String(r.o).split(':');
      app.goToPage(pg);
      app.tab.ui.select([id]);
    },
  },
]);

// ------------------------------------------------------------------------------------------
// Panes

registerPane({
  id: 'clipboard', title: 'Clipboard',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const sig = String(clipHistory.length) + ':' + (clipHistory[0]?.time || 0);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    clear(el);
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn', onclick: () => { clipHistory.length = 0; app.clip = null; el.dataset.sig = ''; app.refresh(); } }, 'Clear All')));
    if (!clipHistory.length) el.appendChild(h('p', { class: 'ql-help' }, 'Cut or copy objects, pages or text to collect items here, then click an item to paste it.'));
    for (const it of clipHistory) {
      const label = it.kind === 'pages' ? `${it.data.length} page(s)` : `${it.data.length} object(s)`;
      el.appendChild(h('button', { class: 'ql-nav-item', onclick: () => { app.clip = it; if (it.kind === 'pages') pastePages(app, it); else pasteItems(app, it); } }, icon(it.kind === 'pages' ? 'auto_stories' : 'category'), h('span', null, label), h('span', { class: 'ql-help' }, (it.text || '').slice(0, 80))));
    }
  },
});
