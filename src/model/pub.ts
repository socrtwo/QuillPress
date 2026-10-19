/**
 * Pub: the publication document with transactions and before-image undo/redo.
 *
 * Every change runs inside Pub.transact(). A transaction scoped to some pages records those pages'
 * previous state (and the stories, which flow across pages); any other transaction records the whole
 * document. Undo swaps the before-image back in and keeps the after-image for redo, so no command
 * needs inverse logic. Media are append-only during a session and are not part of the images.
 */
import type { Publication, Page, Master, Item, Story, Paragraph, MediaItem, ParaStyle, CharStyle, ObjectStyle, TextFrame, Swatch, Layer, Run } from './types';
import { defaultStyles, defaultSwatches } from './styles';

let seq = 0;
export function newId(prefix = 'i'): string {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const clone = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

type Image =
  | { kind: 'pages'; ids: string[]; pages: (Page | null)[]; stories: Story[] }
  | { kind: 'all'; data: Publication };

interface UndoEntry { label: string; before: Image; after?: Image; selection?: any }

export const DEFAULT_MARGINS: [number, number, number, number] = [36, 36, 36, 36];

export function textOf(paras: Paragraph[] | undefined): string {
  return (paras || []).map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n');
}

export function parasFromText(text: string, style?: string): Paragraph[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => ({ ...(style ? { style } : {}), runs: l ? [{ text: l }] : [] }));
}

export function emptyParas(style = 'Body'): Paragraph[] { return [{ style, runs: [] }]; }

/** Words of a story. */
export function wordCount(paras: Paragraph[]): number {
  return textOf(paras).split(/\s+/).filter(Boolean).length;
}

export interface PubJSON { format: 'quillpress'; version: number; data: Publication; media: Record<string, MediaItem> }

export class Pub {
  data: Publication;
  media: Record<string, MediaItem> = {};
  version = 0;
  onChange: (() => void) | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private depth = 0;
  private pending: UndoEntry | null = null;
  maxUndo = 200;

  constructor(data?: Publication) {
    this.data = data || Pub.blankData();
  }

  static blankData(size = { w: 612, h: 792 }, opts: { facing?: boolean; margins?: [number, number, number, number]; columns?: number; pages?: number } = {}): Publication {
    const master: Master = { id: newId('mst'), name: 'A-Master', items: [], margins: opts.margins ? [...opts.margins] as any : [...DEFAULT_MARGINS] as any, columns: opts.columns || 1, gutter: 12, side: 'single' };
    const pub: Publication = {
      size: { ...size }, facing: !!opts.facing, bleed: 0, pages: [], masters: [master], stories: [],
      styles: defaultStyles(), swatches: defaultSwatches(), layers: [{ id: 'default', name: 'Layer 1' }], sections: [], variables: [],
      baselineGrid: { start: 36, step: 14 }, unit: 'in', props: {},
    };
    for (let i = 0; i < (opts.pages ?? 1); i++) pub.pages.push({ id: newId('pg'), master: master.id, items: [] });
    return pub;
  }

  /** A new publication with one page. */
  static blank(size?: { w: number; h: number }, opts?: { facing?: boolean; margins?: [number, number, number, number]; columns?: number; pages?: number }): Pub {
    return new Pub(Pub.blankData(size, opts));
  }

  // ------------------------------------------------------------------------------------------
  // Lookup

  get pages(): Page[] { return this.data.pages; }
  get size(): { w: number; h: number } { return this.data.size; }
  page(id: string): Page | undefined { return this.data.pages.find((p) => p.id === id); }
  pageIndex(id: string): number { return this.data.pages.findIndex((p) => p.id === id); }
  master(id: string): Master { return this.data.masters.find((m) => m.id === id) || this.data.masters[0]; }
  masterOf(page: Page): Master { return this.master(page.master); }
  story(id: string): Story | undefined { return this.data.stories.find((s) => s.id === id); }
  paraStyle(name: string | undefined): ParaStyle | undefined { return this.data.styles.para.find((s) => s.name === name); }
  charStyle(name: string | undefined): CharStyle | undefined { return this.data.styles.char.find((s) => s.name === name); }
  objectStyle(name: string | undefined): ObjectStyle | undefined { return this.data.styles.object.find((s) => s.name === name); }
  swatch(name: string): Swatch | undefined { return this.data.swatches.find((s) => s.name === name); }
  layer(id: string | undefined): Layer | undefined { return this.data.layers.find((l) => l.id === (id || 'default')); }

  /** Margins and columns in effect on a page. */
  geometry(page: Page): { margins: [number, number, number, number]; columns: number; gutter: number } {
    const m = this.masterOf(page);
    return { margins: page.margins || m.margins, columns: page.columns ?? m.columns, gutter: page.gutter ?? m.gutter };
  }

  /** Finds an item anywhere on a page or master (including inside groups). */
  findItem(owner: { items: Item[] }, id: string): Item | undefined {
    const walk = (els: Item[]): Item | undefined => {
      for (const e of els) {
        if (e.id === id) return e;
        if (e.kind === 'group') { const f = walk(e.children); if (f) return f; }
      }
      return undefined;
    };
    return walk(owner.items);
  }

  /** The owner (page or master) holding an item. */
  ownerOfItem(id: string): Page | Master | undefined {
    for (const p of this.data.pages) if (this.findItem(p, id)) return p;
    for (const m of this.data.masters) if (this.findItem(m, id)) return m;
    return undefined;
  }

  /** Every text frame (pages first, then masters), in page order. */
  textFrames(): TextFrame[] {
    const out: TextFrame[] = [];
    const walk = (els: Item[]) => { for (const e of els) { if (e.kind === 'text') out.push(e); else if (e.kind === 'group') walk(e.children); } };
    for (const p of this.data.pages) walk(p.items);
    for (const m of this.data.masters) walk(m.items);
    return out;
  }

  frame(id: string): TextFrame | undefined { return this.textFrames().find((f) => f.id === id); }

  /** Frames of a story in chain order. */
  chainOf(storyId: string): TextFrame[] {
    const frames = this.textFrames().filter((f) => f.story === storyId);
    const byId = new Map(frames.map((f) => [f.id, f]));
    let head = frames.find((f) => !f.prev || !byId.has(f.prev));
    const out: TextFrame[] = [];
    const seen = new Set<string>();
    while (head && !seen.has(head.id)) { out.push(head); seen.add(head.id); head = head.next ? byId.get(head.next) : undefined; }
    for (const f of frames) if (!seen.has(f.id)) out.push(f);
    return out;
  }

  /** The page an item sits on (undefined for master items). */
  pageOfItem(id: string): Page | undefined { return this.data.pages.find((p) => !!this.findItem(p, id)); }

  addMedia(item: MediaItem): string {
    for (const [k, v] of Object.entries(this.media)) if (v.b64 === item.b64) return k;
    const id = newId('m');
    this.media[id] = item;
    return id;
  }

  mediaUrl(id: string | undefined): string {
    const m = id ? this.media[id] : undefined;
    return m ? `data:${m.mime};base64,${m.b64}` : '';
  }

  /** A new story with the given paragraphs. */
  newStory(paras: Paragraph[] = emptyParas(), name?: string): Story {
    const s: Story = { id: newId('st'), paras, ...(name ? { name } : {}) };
    this.data.stories.push(s);
    return s;
  }

  /** A text frame on a new story. */
  newTextFrame(box: { x: number; y: number; w: number; h: number }, paras?: Paragraph[]): TextFrame {
    const s = this.newStory(paras);
    return { id: newId('tf'), kind: 'text', story: s.id, ...box, insets: [4, 4, 4, 4] };
  }

  /** Removes stories no frame shows (after deleting frames). */
  pruneStories(): void {
    const used = new Set(this.textFrames().map((f) => f.story));
    this.data.stories = this.data.stories.filter((s) => used.has(s.id));
  }

  /** The page number text ("3", "iv") for a page index, following sections. */
  pageLabel(index: number): string {
    const secs = [...this.data.sections].sort((a, b) => a.start - b.start);
    let sec = secs.filter((s) => s.start <= index).pop();
    if (!sec) sec = { id: '', name: '', start: 0, numbering: 'arabicPlain', startAt: 1 };
    const n = sec.startAt + (index - sec.start);
    if (sec.numbering === 'none') return '';
    const alpha = (k: number) => { let s = ''; while (k > 0) { k--; s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26); } return s; };
    const roman = (k: number) => { const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (k >= v) { s += r; k -= v; } return s; };
    const body = /roman/i.test(sec.numbering) ? (sec.numbering === 'romanUcPeriod' ? roman(n).toUpperCase() : roman(n)) : /alpha/i.test(sec.numbering) ? (sec.numbering === 'alphaUcPeriod' ? alpha(n).toUpperCase() : alpha(n)) : String(n);
    return (sec.prefix || '') + body;
  }

  /** Left/right side of a page in a facing layout (the first page is a right-hand page). */
  pageSide(index: number): 'left' | 'right' | 'single' {
    if (!this.data.facing) return 'single';
    return index % 2 === 0 ? 'right' : 'left';
  }

  // ------------------------------------------------------------------------------------------
  // Transactions

  private snapshot(pageIds?: string[]): Image {
    if (pageIds) return { kind: 'pages', ids: pageIds, pages: pageIds.map((id) => { const p = this.page(id); return p ? clone(p) : null; }), stories: clone(this.data.stories) };
    return { kind: 'all', data: clone(this.data) };
  }

  private restore(img: Image): void {
    if (img.kind === 'all') { this.data = clone(img.data); return; }
    img.ids.forEach((id, i) => {
      const p = img.pages[i];
      const idx = this.pageIndex(id);
      if (p && idx >= 0) this.data.pages[idx] = clone(p);
      else if (p) this.data.pages.push(clone(p));
      else if (idx >= 0) this.data.pages.splice(idx, 1);
    });
    this.data.stories = clone(img.stories);
  }

  /**
   * Runs fn as one undoable step. `pages` limits the before-image to those pages (and the stories);
   * nested transactions join the outer one.
   */
  transact<T>(label: string, fn: () => T, pages?: string[]): T {
    if (this.depth > 0) { const r = fn(); return r; }
    const entry: UndoEntry = { label, before: this.snapshot(pages) };
    this.pending = entry;
    this.depth++;
    let result: T;
    try {
      result = fn();
    } catch (e) {
      this.depth--;
      this.pending = null;
      this.restore(entry.before);
      throw e;
    }
    this.depth--;
    this.pending = null;
    entry.after = this.snapshot(entry.before.kind === 'pages' ? entry.before.ids : undefined);
    if (JSON.stringify(entry.before) !== JSON.stringify(entry.after)) {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack = [];
      this.data.props.modified = Date.now();
    }
    this.version++;
    this.onChange?.();
    return result;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  undoLabels(): string[] { return [...this.undoStack].reverse().map((e) => e.label); }
  get undoLabel(): string { return this.undoStack[this.undoStack.length - 1]?.label || ''; }
  get redoLabel(): string { return this.redoStack[this.redoStack.length - 1]?.label || ''; }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.restore(e.before);
    this.redoStack.push(e);
    this.version++;
    this.onChange?.();
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e || !e.after) return false;
    this.restore(e.after);
    this.undoStack.push(e);
    this.version++;
    this.onChange?.();
    return true;
  }

  clearHistory(): void { this.undoStack = []; this.redoStack = []; }

  /** Notifies listeners of a change made outside a transaction (not undoable). */
  changed(): void { this.version++; this.onChange?.(); }

  // ------------------------------------------------------------------------------------------
  // Serialization

  toJSON(): PubJSON {
    return { format: 'quillpress', version: 1, data: clone(this.data), media: clone(this.media) };
  }

  static fromJSON(j: any): Pub {
    if (!j || typeof j !== 'object' || !j.data) throw new Error('Not a QuillPress publication.');
    const p = new Pub(Pub.sanitize(j.data));
    p.media = j.media && typeof j.media === 'object' ? j.media : {};
    return p;
  }

  /** Fills in anything a damaged or older file lacks. */
  static sanitize(d: any): Publication {
    const blank = Pub.blankData();
    const out: Publication = { ...blank, ...d };
    if (!out.size || !(out.size.w > 0) || !(out.size.h > 0)) out.size = { w: 612, h: 792 };
    if (!Array.isArray(out.masters) || !out.masters.length) out.masters = blank.masters;
    for (const m of out.masters) { m.items = Array.isArray(m.items) ? m.items : []; m.margins = Array.isArray(m.margins) && m.margins.length === 4 ? m.margins : [...DEFAULT_MARGINS] as any; m.columns = m.columns || 1; m.gutter = m.gutter ?? 12; }
    if (!Array.isArray(out.pages)) out.pages = [];
    for (const p of out.pages) { p.items = Array.isArray(p.items) ? p.items : []; if (!out.masters.some((m) => m.id === p.master)) p.master = out.masters[0].id; }
    if (!out.pages.length) out.pages.push({ id: newId('pg'), master: out.masters[0].id, items: [] });
    if (!Array.isArray(out.stories)) out.stories = [];
    for (const s of out.stories) if (!Array.isArray(s.paras)) s.paras = emptyParas();
    for (const s of out.stories) for (const p of s.paras) if (!Array.isArray(p.runs)) p.runs = [];
    if (!out.styles || typeof out.styles !== 'object') out.styles = defaultStyles();
    out.styles.para = Array.isArray(out.styles.para) && out.styles.para.length ? out.styles.para : defaultStyles().para;
    out.styles.char = Array.isArray(out.styles.char) ? out.styles.char : [];
    out.styles.object = Array.isArray(out.styles.object) ? out.styles.object : [];
    if (!Array.isArray(out.swatches)) out.swatches = defaultSwatches();
    if (!Array.isArray(out.layers) || !out.layers.length) out.layers = [{ id: 'default', name: 'Layer 1' }];
    if (!Array.isArray(out.sections)) out.sections = [];
    if (!Array.isArray(out.variables)) out.variables = [];
    if (!out.baselineGrid) out.baselineGrid = { start: 36, step: 14 };
    if (!out.props || typeof out.props !== 'object') out.props = {};
    if (!out.unit) out.unit = 'in';
    // Frames whose story is missing get an empty one, so nothing crashes.
    const have = new Set(out.stories.map((s) => s.id));
    const walk = (els: Item[]) => { for (const e of els) { if (e.kind === 'text' && !have.has(e.story)) { out.stories.push({ id: e.story, paras: emptyParas() }); have.add(e.story); } if (e.kind === 'group') walk(e.children); } };
    for (const p of out.pages) walk(p.items);
    for (const m of out.masters) walk(m.items);
    return out;
  }
}

/** Gives an item (and its children) new ids; returns the copy. */
export function reId<T extends Item>(e: T): T {
  const c = clone(e);
  const walk = (x: Item) => { x.id = newId(x.kind === 'text' ? 'tf' : x.kind === 'picture' ? 'pic' : x.kind === 'group' ? 'grp' : 'sh'); delete x.masterOf; if (x.kind === 'group') x.children.forEach(walk); };
  walk(c);
  return c;
}

export function runText(r: Run): string { return r.br ? '\n' : r.text; }
