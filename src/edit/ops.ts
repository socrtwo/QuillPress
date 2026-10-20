/**
 * Editing operations shared by the commands and the canvas: transactions on the current page or
 * master, inserting and removing items, geometry, text formatting on stories, linking frames, arranging.
 */
import type { App } from '../app';
import type { Item, Page, Master, Paragraph, ParaProps, RunProps, Story, TextFrame, Fill, Line, Run, PathTextItem } from '../model/types';
import { clone, newId, reId, emptyParas } from '../model/pub';
import { toast } from '../ui/dialog';
import { activeTextEditor } from './textEdit';
import { rotatedBounds, neededHeight, storyLayout } from '../render/flow';

export type Owner = Page | Master;
export interface Box { x: number; y: number; w: number; h: number; rot: number }

export const isPage = (o: Owner | undefined): o is Page => !!o && 'master' in o;

/** Runs fn as one undoable step on the canvas owner (page-scoped when editing a page). */
export function edit<T>(app: App, label: string, fn: (owner: Owner) => T): T | undefined {
  const o = app.owner;
  if (!o) { toast('There is no page to change. Add a page first.'); return undefined; }
  return app.pub.transact(label, () => fn(o), isPage(o) ? [o.id] : undefined);
}

/** Runs fn on each target page (selected thumbnails, or the current page). */
export function editPages(app: App, label: string, fn: (p: Page) => void): void {
  const pages = app.targetPages();
  if (!pages.length) return;
  app.pub.transact(label, () => pages.forEach(fn), pages.map((p) => p.id));
}

export function boxOf(e: Item): Box { return { x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot || 0 }; }

/** Writes a box into the item (scaling the children of a group with it). */
export function setBox(e: Item, b: Partial<Box>): void {
  const cur = boxOf(e);
  const nb = { ...cur, ...b };
  if (e.kind === 'group') {
    const sx = cur.w ? nb.w / cur.w : 1, sy = cur.h ? nb.h / cur.h : 1;
    const walk = (els: Item[]) => {
      for (const c of els) {
        const cb = { x: c.x, y: c.y, w: c.w, h: c.h };
        c.x = nb.x + (cb.x - cur.x) * sx; c.y = nb.y + (cb.y - cur.y) * sy; c.w = cb.w * sx; c.h = cb.h * sy;
        if (c.kind === 'group') walk(c.children);
      }
    };
    walk(e.children);
  }
  if (e.kind === 'table' && cur.w && nb.w !== cur.w) { const k = nb.w / cur.w; e.cols = e.cols.map((c) => c * k); }
  if (e.kind === 'table' && cur.h && nb.h !== cur.h) { const k = nb.h / cur.h; for (const r of e.rows) r.h *= k; }
  e.x = round(nb.x); e.y = round(nb.y); e.w = round(Math.max(e.kind === 'line' ? 0 : 1, nb.w)); e.h = round(Math.max(e.kind === 'line' ? 0 : 1, nb.h));
  if (b.rot != null) e.rot = ((b.rot % 360) + 360) % 360 || undefined;
}

export const round = (v: number) => Math.round(v * 100) / 100;

/** Position for a new item: inside the margins, cascading so repeated inserts do not stack exactly. */
export function placeNew(app: App, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const o = app.owner;
  const { w: pw, h: ph } = app.pub.size;
  const g = o && isPage(o) ? app.pub.geometry(o) : { margins: app.pub.data.masters[0].margins };
  const [mt, mr, mb, ml] = g.margins;
  const n = (o?.items.length || 0) % 6;
  const cw = Math.min(w, pw - ml - mr), ch = Math.min(h, ph - mt - mb);
  return { x: round(ml + n * 12), y: round(mt + n * 12), w: round(cw), h: round(ch) };
}

export function selection(app: App): Item[] { return app.selected; }

export function insertItem(app: App, el: Item, label = 'Insert', select = true): Item | undefined {
  const r = edit(app, label, (o) => { o.items.push(el); return el; });
  if (r && select) app.tab.ui.select([el.id]);
  return r;
}

export function deleteSelection(app: App): void {
  const ids = app.tab.ui.selection;
  if (!ids.length) return;
  edit(app, 'Delete', (o) => {
    const gone: string[] = [];
    const walk = (items: Item[]) => { for (let i = items.length - 1; i >= 0; i--) { if (ids.includes(items[i].id)) { unlinkFrame(app, items[i]); collectIds(items[i], gone); items.splice(i, 1); } else if (items[i].kind === 'group') walk((items[i] as any).children); } };
    walk(o.items);
    app.pub.pruneStories();
    removeAnchorRuns(app, gone);
  });
  app.tab.ui.select([]);
}

function collectIds(e: Item, out: string[]): void { out.push(e.id); if (e.kind === 'group') e.children.forEach((c) => collectIds(c, out)); }

/** Removes a frame from its story chain (the text flows into the remaining frames). */
export function unlinkFrame(app: App, e: Item): void {
  if (e.kind !== 'text') { if (e.kind === 'group') e.children.forEach((c) => unlinkFrame(app, c)); return; }
  const pub = app.pub;
  const prev = e.prev ? pub.frame(e.prev) : undefined;
  const next = e.next ? pub.frame(e.next) : undefined;
  if (prev) prev.next = next?.id;
  if (next) next.prev = prev?.id;
  if (!prev && !next) return;
  e.prev = undefined; e.next = undefined;
}

export function duplicateSelection(app: App, dx = 12, dy = 12): void {
  const els = selection(app);
  if (!els.length) return;
  const copies = els.map((e) => { const c = reId(e); shift(c, dx, dy); detachStory(app, c); return c; });
  edit(app, 'Duplicate', (o) => { for (const c of copies) o.items.push(c); });
  app.tab.ui.select(copies.map((c) => c.id));
}

/** A copied text frame gets its own copy of the story (and no links). */
export function detachStory(app: App, e: Item): void {
  if (e.kind === 'group') { e.children.forEach((c) => detachStory(app, c)); return; }
  if (e.kind !== 'text') return;
  const s = app.pub.story(e.story);
  const ns: Story = { id: newId('st'), paras: s ? clone(s.paras) : emptyParas() };
  app.pub.data.stories.push(ns);
  e.story = ns.id; e.prev = undefined; e.next = undefined;
}

export function shift(e: Item, dx: number, dy: number): void {
  e.x = round(e.x + dx); e.y = round(e.y + dy);
  if (e.kind === 'group') e.children.forEach((c) => shift(c, dx, dy));
}

export function nudge(app: App, dx: number, dy: number): void {
  const ids = app.tab.ui.selection;
  if (!ids.length) return;
  edit(app, 'Move', (o) => { for (const id of ids) { const e = o.items.find((x) => x.id === id); if (e && !e.locked) shift(e, dx, dy); } });
}

// ------------------------------------------------------------------------------------------
// Text frames and stories

export function newTextFrame(app: App, text?: string, box?: { x: number; y: number; w: number; h: number }, style?: string): TextFrame {
  const b = box || placeNew(app, 300, 120);
  const paras: Paragraph[] = text ? text.replace(/\r\n?/g, '\n').split('\n').map((l) => ({ style: style || 'Body', runs: l ? [{ text: l }] : [] })) : [{ style: style || 'Body', runs: [] }];
  return app.pub.newTextFrame(b, paras);
}

/** Text frames among the selection (inside groups too). */
export function textTargets(app: App): TextFrame[] {
  const out: TextFrame[] = [];
  const walk = (els: Item[]) => { for (const e of els) { if (e.kind === 'text') out.push(e); else if (e.kind === 'group') walk(e.children); } };
  walk(selection(app));
  return out;
}

/** Plain text of a frame's story. */
export function frameText(app: App, f: TextFrame): string {
  const s = app.pub.story(f.story);
  return s ? s.paras.map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n') : '';
}

/** Calls fn for every story's paragraphs (optionally restricted to the given pages' frames). */
export function forEachStory(app: App, fn: (paras: Paragraph[], story: Story, frames: TextFrame[]) => void, pages?: Page[]): void {
  const pub = app.pub;
  const frames = pub.textFrames();
  for (const s of pub.data.stories) {
    const fs = frames.filter((f) => f.story === s.id);
    if (pages && !fs.some((f) => pages.some((p) => !!pub.findItem(p, f.id)))) continue;
    fn(s.paras, s, fs);
  }
}

/** Table cells' paragraphs too. */
export function forEachText(app: App, fn: (paras: Paragraph[], where: { story?: Story; item?: Item }) => void): void {
  forEachStory(app, (paras, story) => fn(paras, { story }));
  const walk = (items: Item[]) => { for (const e of items) { if (e.kind === 'table') for (const r of e.rows) for (const c of r.cells) fn(c.text, { item: e }); if (e.kind === 'group') walk(e.children); } };
  for (const p of app.pub.pages) walk(p.items);
  for (const m of app.pub.data.masters) walk(m.items);
}

/**
 * Applies character formatting: to the selection inside the active text editor, or to every run of
 * the selected frames' stories.
 */
export function applyRun(app: App, label: string, props: Partial<RunProps> | ((cur: RunProps) => Partial<RunProps>)): boolean {
  const ed = activeTextEditor();
  if (ed) { ed.applyRun(props); return true; }
  const frames = textTargets(app);
  const tables = selection(app).filter((e) => e.kind === 'table');
  const paths = pathTextTargets(app);
  if (!frames.length && !tables.length && !paths.length) { toast('Select a text frame, or click inside text, to format it.'); return false; }
  const pub = app.pub;
  pub.transact(label, () => {
    const paras: Paragraph[] = [];
    for (const f of new Set(frames.map((f) => f.story))) { const s = pub.story(f); if (s) paras.push(...s.paras); }
    for (const t of tables) if (t.kind === 'table') for (const r of t.rows) for (const c of r.cells) paras.push(...c.text);
    for (const pt of paths) paras.push(...pt.text);
    for (const p of paras) {
      for (const r of p.runs) if (!r.br) Object.assign(r, typeof props === 'function' ? props(r) : props);
      p.end = { ...(p.end || {}), ...(typeof props === 'function' ? props(p.end || {}) : props) };
    }
  });
  return true;
}

/** Applies paragraph formatting the same way. */
export function applyPara(app: App, label: string, props: Partial<ParaProps> | ((p: Paragraph) => Partial<Paragraph>)): boolean {
  const ed = activeTextEditor();
  if (ed) { ed.applyPara(props); return true; }
  const frames = textTargets(app);
  const tables = selection(app).filter((e) => e.kind === 'table');
  const paths = pathTextTargets(app);
  if (!frames.length && !tables.length && !paths.length) { toast('Select a text frame, or click inside text, to format it.'); return false; }
  const pub = app.pub;
  pub.transact(label, () => {
    const paras: Paragraph[] = [];
    for (const f of new Set(frames.map((f) => f.story))) { const s = pub.story(f); if (s) paras.push(...s.paras); }
    for (const t of tables) if (t.kind === 'table') for (const r of t.rows) for (const c of r.cells) paras.push(...c.text);
    for (const pt of paths) paras.push(...pt.text);
    for (const p of paras) Object.assign(p, typeof props === 'function' ? props(p) : props);
  });
  return true;
}

/** The run formatting at the caret or of the first selected frame (for the ribbon's state). */
export function currentRun(app: App): RunProps {
  const ed = activeTextEditor();
  if (ed) return ed.caretRun();
  const f = textTargets(app)[0];
  const p = f ? app.pub.story(f.story)?.paras[0] : pathTextTargets(app)[0]?.text[0];
  if (!p) return {};
  const r = p.runs.find((x) => !x.br && !x.anchor && !x.footnote) || p.end;
  return r ? { ...r } : {};
}

export function currentPara(app: App): Partial<Paragraph> {
  const ed = activeTextEditor();
  if (ed) return ed.caretPara();
  const f = textTargets(app)[0];
  if (f) return app.pub.story(f.story)?.paras[0] || {};
  return pathTextTargets(app)[0]?.text[0] || {};
}

/** Text-on-a-path items among the selection (inside groups too); their text is one paragraph target. */
export function pathTextTargets(app: App): PathTextItem[] {
  const out: PathTextItem[] = [];
  const walk = (els: Item[]) => { for (const e of els) { if (e.kind === 'pathText') out.push(e); else if (e.kind === 'group') walk(e.children); } };
  walk(selection(app));
  return out;
}

/** Removes the anchor runs of items that are gone (or released), so the text no longer leaves room for them. */
export function removeAnchorRuns(app: App, ids: string[]): void {
  if (!ids.length) return;
  for (const s of app.pub.data.stories) for (const p of s.paras) if (p.runs.some((r) => r.anchor && ids.includes(r.anchor))) p.runs = p.runs.filter((r) => !(r.anchor && ids.includes(r.anchor)));
}

// ------------------------------------------------------------------------------------------
// Linking frames

/** Links frame b after frame a: b joins a's story (b's own text is appended to the story). */
export function linkFrames(app: App, a: TextFrame, b: TextFrame): boolean {
  if (a.id === b.id) return false;
  const pub = app.pub;
  if (pub.chainOf(a.story).some((f) => f.id === b.id)) { toast('These frames are already linked.'); return false; }
  pub.transact('Link Frames', () => {
    const sa = pub.story(a.story)!;
    const sb = pub.story(b.story);
    if (sb && sb.id !== sa.id) {
      // Append b's text (if any) to the end of a's story and retire b's story if no other frame uses it.
      if (sb.paras.some((p) => p.runs.some((r) => r.text))) sa.paras.push(...clone(sb.paras));
      for (const f of pub.textFrames()) if (f.story === sb.id) f.story = sa.id;
      pub.pruneStories();
    }
    // Insert b after a in the chain.
    const oldNext = a.next ? pub.frame(a.next) : undefined;
    a.next = b.id; b.prev = a.id;
    b.next = oldNext?.id;
    if (oldNext) oldNext.prev = b.id;
  });
  return true;
}

/** Breaks the chain after frame f: the following frames get their own story with the overflow text. */
export function unlinkAfter(app: App, f: TextFrame): void {
  const pub = app.pub;
  if (!f.next) { toast('This frame is the last of its chain.'); return; }
  pub.transact('Unlink Frames', () => {
    const chain = pub.chainOf(f.story);
    const i = chain.findIndex((x) => x.id === f.id);
    const rest = chain.slice(i + 1);
    const s = pub.story(f.story)!;
    const lay = storyLayout(pub, s.id);
    // Text that did not fit up to f stays with the first part; the rest moves to the new story.
    let split: { para: number; off: number } | null = null;
    if (lay) {
      const lastBoxOfF = Math.max(...lay.boxes.map((b, k) => (b.frame === f.id ? k : -1)));
      const after = lay.r.lines.filter((l) => l.box > lastBoxOfF && !l.footnote);
      if (after.length) split = { para: after[0].para, off: after[0].start };
      else if (lay.r.overset) split = lay.r.overset;
    }
    const ns: Story = { id: newId('st'), paras: [] };
    if (split) {
      const keep = s.paras.slice(0, split.para);
      const p = s.paras[split.para];
      if (p) {
        const [head, tail] = splitParagraph(p, split.off);
        keep.push(head);
        ns.paras.push(tail, ...s.paras.slice(split.para + 1));
      }
      s.paras = keep.length ? keep : emptyParas();
    }
    if (!ns.paras.length) ns.paras = emptyParas();
    pub.data.stories.push(ns);
    for (const r of rest) r.story = ns.id;
    rest[0].prev = undefined;
    f.next = undefined;
  });
}

export function splitParagraph(p: Paragraph, off: number): [Paragraph, Paragraph] {
  const a: Paragraph = { ...clone(p), runs: [] }, b: Paragraph = { ...clone(p), runs: [] };
  let pos = 0;
  for (const r of p.runs) {
    const len = r.br ? 1 : r.text.length;
    if (pos + len <= off) a.runs.push(clone(r));
    else if (pos >= off) b.runs.push(clone(r));
    else { a.runs.push({ ...clone(r), text: r.text.slice(0, off - pos) }); b.runs.push({ ...clone(r), text: r.text.slice(off - pos) }); }
    pos += len;
  }
  return [a, b];
}

/** Splits runs so [from, to) is covered by whole runs, applies fn, and merges neighbors. */
export function splitRuns(runs: Run[], from: number, to: number, fn: (r: Run) => void): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const len = r.br ? 1 : r.text.length;
    const s = pos, e = pos + len;
    pos = e;
    if (r.br || e <= from || s >= to) { out.push({ ...r }); continue; }
    const a = Math.max(from, s) - s, b = Math.min(to, e) - s;
    if (a > 0) out.push({ ...r, text: r.text.slice(0, a) });
    const mid: Run = { ...r, text: r.text.slice(a, b) };
    fn(mid);
    out.push(mid);
    if (b < len) out.push({ ...r, text: r.text.slice(b) });
  }
  const merged: Run[] = [];
  for (const r of out) {
    if (!(r.text || r.br || r.field)) continue;
    const last = merged[merged.length - 1];
    if (last && !last.br && !r.br && !last.field && !r.field && sameRun(last, r)) last.text += r.text;
    else merged.push(r);
  }
  return merged;
}

export function sameRun(a: Run, b: Run): boolean {
  if (a.anchor || b.anchor || a.footnote || b.footnote) return false;
  const { text: _a, ...ra } = a as any; const { text: _b, ...rb } = b as any;
  return JSON.stringify(ra) === JSON.stringify(rb);
}

/** Replaces [off, off+len) of a paragraph's text, keeping the formatting of the first affected run. */
export function replaceInPara(p: Paragraph, off: number, len: number, text: string): void {
  let pos = 0;
  const out: Run[] = [];
  let inserted = false;
  for (const r of p.runs) {
    const rl = r.br ? 1 : r.text.length;
    const s = pos, e = pos + rl;
    pos = e;
    if (r.br || e <= off || s >= off + len) {
      if (!inserted && len === 0 && s === off && !r.br) { out.push({ ...r, text: text + r.text }); inserted = true; continue; }
      out.push(r); continue;
    }
    const a = Math.max(off, s) - s, b = Math.min(off + len, e) - s;
    const keep = r.text.slice(0, a) + (inserted ? '' : text) + r.text.slice(b);
    inserted = true;
    if (keep) out.push({ ...r, text: keep });
  }
  if (!inserted) out.push({ text });
  p.runs = out;
}

/** Grows an autosize frame to its text. */
export function fitFrameHeight(app: App, f: TextFrame): void {
  const hh = neededHeight(app.pub, f);
  if (Math.abs(hh - f.h) > 0.5) f.h = round(hh);
}

// ------------------------------------------------------------------------------------------
// Arranging

export function bounds(items: Item[]): { x: number; y: number; w: number; h: number } {
  const bs = items.map(rotatedBounds);
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w)), b2 = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b2 - y };
}

export function reorder(app: App, how: 'front' | 'back' | 'forward' | 'backward'): void {
  const ids = app.tab.ui.selection;
  if (!ids.length) return;
  edit(app, 'Arrange', (o) => {
    const items = o.items;
    const sel = items.filter((e) => ids.includes(e.id));
    if (how === 'front') { for (const e of sel) items.splice(items.indexOf(e), 1); items.push(...sel); }
    else if (how === 'back') { for (const e of sel) items.splice(items.indexOf(e), 1); items.unshift(...sel); }
    else if (how === 'forward') { for (let i = items.length - 2; i >= 0; i--) if (ids.includes(items[i].id) && !ids.includes(items[i + 1].id)) [items[i], items[i + 1]] = [items[i + 1], items[i]]; }
    else { for (let i = 1; i < items.length; i++) if (ids.includes(items[i].id) && !ids.includes(items[i - 1].id)) [items[i], items[i - 1]] = [items[i - 1], items[i]]; }
  });
}

export function align(app: App, how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', toPage = false): void {
  const els = selection(app).filter((e) => !e.locked);
  if (!els.length) return;
  const { w: pw, h: ph } = app.pub.size;
  const ref = els.length > 1 && !toPage ? bounds(els) : { x: 0, y: 0, w: pw, h: ph };
  edit(app, 'Align', () => {
    for (const e of els) {
      const b = rotatedBounds(e);
      let dx = 0, dy = 0;
      if (how === 'left') dx = ref.x - b.x;
      if (how === 'center') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
      if (how === 'top') dy = ref.y - b.y;
      if (how === 'middle') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
      shift(e, dx, dy);
    }
  });
}

export function distribute(app: App, dir: 'h' | 'v'): void {
  const els = selection(app).filter((e) => !e.locked);
  if (els.length < 3) { toast('Select three or more objects to distribute.'); return; }
  edit(app, 'Distribute', () => {
    const sorted = [...els].sort((a, b) => (dir === 'h' ? a.x - b.x : a.y - b.y));
    const first = sorted[0], last = sorted[sorted.length - 1];
    const total = dir === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const sizes = sorted.reduce((a, e) => a + (dir === 'h' ? e.w : e.h), 0);
    const gap = (total - sizes) / (sorted.length - 1);
    let pos = dir === 'h' ? first.x : first.y;
    for (const e of sorted) { if (dir === 'h') shift(e, pos - e.x, 0); else shift(e, 0, pos - e.y); pos += (dir === 'h' ? e.w : e.h) + gap; }
  });
}

export function group(app: App): void {
  const els = selection(app);
  if (els.length < 2) { toast('Select two or more objects to group.'); return; }
  const b = bounds(els);
  const g: Item = { id: newId('grp'), kind: 'group', name: 'Group', x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), children: [] };
  edit(app, 'Group', (o) => {
    const ordered = o.items.filter((e) => els.includes(e));
    for (const e of ordered) o.items.splice(o.items.indexOf(e), 1);
    g.children = ordered;
    o.items.push(g);
  });
  app.tab.ui.select([g.id]);
}

export function ungroup(app: App): void {
  const gs = selection(app).filter((e) => e.kind === 'group');
  if (!gs.length) { toast('Select a group to ungroup.'); return; }
  const ids: string[] = [];
  edit(app, 'Ungroup', (o) => {
    for (const g of gs) {
      if (g.kind !== 'group') continue;
      const i = o.items.indexOf(g);
      o.items.splice(i, 1, ...g.children);
      ids.push(...g.children.map((c) => c.id));
    }
  });
  app.tab.ui.select(ids);
}

export function setFill(app: App, fill: Fill | undefined, label = 'Fill'): void {
  const els = selection(app);
  if (!els.length) { toast('Select an object first.'); return; }
  edit(app, label, () => { for (const e of els) { if (e.kind === 'line') continue; e.fill = fill; } });
}

export function setLine(app: App, patch: Partial<Line> | ((cur: Line) => Line), label = 'Outline'): void {
  const els = selection(app);
  if (!els.length) { toast('Select an object first.'); return; }
  edit(app, label, () => { for (const e of els) { const cur = e.line || {}; e.line = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch }; } });
}

/** Everything in z order on the owner (groups flattened), front first. */
export function flatItems(o: Owner): Item[] {
  const out: Item[] = [];
  const walk = (els: Item[]) => { for (const e of els) { out.push(e); if (e.kind === 'group') walk(e.children); } };
  walk(o.items);
  return out;
}
