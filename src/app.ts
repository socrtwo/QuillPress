/** QuillPress application core: publication tabs, command execution, macro recording, autosave. */
import { isSafeExternalUrl } from './util/sanitize';
import { Pub } from './model/pub';
import type { Item, Page, Master } from './model/types';
import { getCommand, allCommands, type Command } from './commands/registry';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { kvSet, kvDel } from './util/store';
import { toast } from './ui/dialog';
import { canonicalKey } from './util/keys';
import type { Shell } from './ui/shell';

let tabCounter = 0;

export type ViewMode = 'single' | 'spread' | 'preview';

/** The view mounted for a tab (edit/workspace.ts). */
export interface TabView {
  el: HTMLElement;
  layout(): void;
  invalidate(): void;
  focus(): void;
  destroy(): void;
  /** True while text is being edited in place. */
  readonly editingText: boolean;
  commitText(): void;
  /** Ids of items selected on the canvas. */
  selection: string[];
  select(ids: string[]): void;
  /** Starts editing a text frame's story, optionally selecting all of it. */
  editText(id: string, selectAll?: boolean): void;
  /** Item whose text is being edited. */
  readonly editing: string | null;
  setZoom(z: number | 'fit' | 'width'): void;
  readonly zoom: number;
  /** Scrolls the current page into view. */
  showPage(id: string): void;
}

export class PubTab {
  id = `t${Date.now().toString(36)}${tabCounter++}`;
  title = 'Publication';
  fileName = '';
  format = 'qpp';
  uri: string | null = null;
  dirty = false;
  created = Date.now();
  saved = 0;
  readOnly = false;
  key = '';
  view: ViewMode = 'single';
  /** Current page id. */
  current = '';
  /** Master being edited (empty = editing pages). */
  masterTarget = '';
  el!: HTMLElement;
  ui!: TabView;
  recovery: any = null;
  /** Pages selected in the Pages pane (current page included). */
  pageSel: string[] = [];
  colorMode?: 'grayscale';
  constructor(public app: App, public pub: Pub) {
    this.current = pub.pages[0]?.id || '';
  }
  get displayName(): string { return this.fileName || this.title; }
}

export class App {
  prefs: Prefs = loadPrefs();
  docs: PubTab[] = [];
  active!: PubTab;
  ui!: Shell;
  recording: { name: string; steps: { id: string; arg?: any }[] } | null = null;
  recordingPaused = false;
  private refreshQueued = false;
  private autosaveTimer: any = null;
  private listeners = new Set<(app: App) => void>();
  lastCommand: { id: string; arg?: any } | null = null;
  keyIndex = new Map<string, string>();
  /** Clipboard of items and pages copied inside QuillPress. */
  clip: { kind: 'items' | 'pages'; data: any; stories: any[]; media: Record<string, any>; text: string; time: number } | null = null;
  /** Format Painter: copied formatting, and whether it stays on. */
  painter: { fmt: any; sticky: boolean } | null = null;

  constructor(public host: HTMLElement) {
    this.rebuildKeyIndex();
  }

  get tab(): PubTab { return this.active; }
  get pub(): Pub { return this.active.pub; }
  /** The current page (undefined in an empty publication). */
  get page(): Page | undefined { return this.pub.page(this.active.current) || this.pub.pages[0]; }
  /** What the canvas edits: the current page, or the master in master editing. */
  get owner(): Page | Master | undefined {
    const t = this.active;
    if (t.masterTarget) return this.pub.data.masters.find((m) => m.id === t.masterTarget) || this.pub.data.masters[0];
    return this.page;
  }
  /** Selected items on the canvas. */
  get selected(): Item[] {
    const o = this.owner;
    if (!o || !this.active.ui) return [];
    return this.active.ui.selection.map((id) => this.pub.findItem(o, id)).filter(Boolean) as Item[];
  }

  onRefresh(fn: (app: App) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  savePrefs(): void { savePrefs(this.prefs); this.rebuildKeyIndex(); }

  rebuildKeyIndex(): void {
    this.keyIndex.clear();
    for (const c of allCommands()) for (const k of c.keys || []) this.keyIndex.set(canonicalKey(k), c.id);
    for (const [k, id] of Object.entries(this.prefs.keymap)) {
      if (id) this.keyIndex.set(canonicalKey(k), id); else this.keyIndex.delete(canonicalKey(k));
    }
  }

  // ------------------------------------------------------------------------------------------
  // Publications

  createTab(pub?: Pub, meta: Partial<PubTab> = {}): PubTab {
    if (!pub) {
      const sz = this.prefs.defaultPageSize;
      pub = Pub.blank(sz, { facing: this.prefs.defaultFacing, margins: this.prefs.defaultMargins, columns: this.prefs.defaultColumns });
      pub.data.unit = this.prefs.unit;
      pub.data.props.author = this.prefs.author;
      pub.data.props.created = Date.now();
    }
    const tab = new PubTab(this, pub);
    Object.assign(tab, meta);
    pub.onChange = () => this.pubChanged(tab);
    this.ui.mountTab(tab);
    this.docs.push(tab);
    this.activate(tab);
    return tab;
  }

  activate(tab: PubTab): void {
    this.active = tab;
    for (const d of this.docs) d.el.classList.toggle('ql-hidden-tab', d !== tab);
    this.ui.tabsChanged();
    tab.ui.layout();
    this.refresh();
    document.title = `${tab.displayName}${tab.dirty ? ' •' : ''} – QuillPress`;
  }

  closeTab(tab: PubTab): void {
    const i = this.docs.indexOf(tab);
    if (i < 0) return;
    tab.ui.destroy();
    tab.el.remove();
    this.docs.splice(i, 1);
    kvDel('draft:' + tab.id);
    if (!this.docs.length) this.createTab();
    else this.activate(this.docs[Math.max(0, i - 1)]);
  }

  replacePub(tab: PubTab, pub: Pub): void {
    tab.pub = pub;
    pub.onChange = () => this.pubChanged(tab);
    tab.current = pub.pages[0]?.id || '';
    tab.pageSel = [];
    tab.masterTarget = '';
    tab.ui.select([]);
    tab.ui.layout();
    this.refresh();
  }

  /** Called after every transaction, undo and redo. */
  pubChanged(tab: PubTab): void {
    if (!tab.pub.page(tab.current)) tab.current = tab.pub.pages[0]?.id || '';
    tab.pageSel = tab.pageSel.filter((id) => tab.pub.page(id));
    if (tab.masterTarget && !tab.pub.data.masters.some((m) => m.id === tab.masterTarget)) tab.masterTarget = '';
    if (!tab.dirty) { tab.dirty = true; this.ui.tabsChanged(); document.title = `${tab.displayName} • – QuillPress`; }
    this.scheduleAutosave();
    tab.ui.invalidate();
    this.refresh();
  }

  /** Makes a page current and shows it. */
  goToPage(id: string, opts: { extend?: boolean; toggle?: boolean } = {}): void {
    const t = this.active;
    if (!t.pub.page(id)) return;
    if (t.ui.editingText) t.ui.commitText();
    if (opts.toggle) t.pageSel = t.pageSel.includes(id) ? t.pageSel.filter((x) => x !== id) : [...t.pageSel, id];
    else if (opts.extend && t.current) {
      const a = t.pub.pageIndex(t.current), b = t.pub.pageIndex(id);
      t.pageSel = t.pub.pages.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id);
    } else t.pageSel = [id];
    t.current = id;
    if (t.masterTarget) { t.masterTarget = ''; this.ui.renderTabs(); }
    t.ui.select([]);
    t.ui.invalidate();
    t.ui.showPage(id);
    this.refresh();
  }

  /** Pages the page commands act on: the selected thumbnails, or the current page. */
  targetPages(): Page[] {
    const t = this.active;
    const ids = t.pageSel.length ? t.pageSel : [t.current];
    return t.pub.pages.filter((p) => ids.includes(p.id));
  }

  refresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      if (!this.active) return;
      this.ui.refresh();
      for (const l of this.listeners) l(this);
    });
  }

  // ------------------------------------------------------------------------------------------
  // Commands

  handleKey(key: string): boolean {
    const id = this.keyIndex.get(canonicalKey(key));
    if (!id) return false;
    const c = getCommand(id);
    if (!c) return false;
    if (c.isEnabled && !c.isEnabled(this)) return false;
    this.exec(id);
    return true;
  }

  isReadOnly(): boolean {
    return this.tab.readOnly || !!this.pub.data.finalMarked;
  }

  exec(id: string, arg?: any): unknown {
    const c = getCommand(id);
    if (!c) { toast(`Unknown command: ${id}`); return false; }
    if (c.edits && this.isReadOnly()) { toast('This publication is read-only.'); return false; }
    if (c.isEnabled && !c.isEnabled(this)) { toast(`${c.label} is not available here.`); return false; }
    if (this.recording && !c.noRecord && id !== 'dev.recordMacro' && id !== 'dev.stopRecording') this.recordStep(id, arg);
    if (!c.noRecord && id !== 'edit.repeat') this.lastCommand = { id, arg };
    try {
      const r = c.run(this, arg);
      if (r instanceof Promise) r.catch((e) => this.reportError(c, e)).finally(() => this.refresh());
      this.refresh();
      return r;
    } catch (e) {
      this.reportError(c, e);
      return false;
    }
  }

  private reportError(c: Command, e: unknown): void {
    console.error(e);
    toast(`${c.label}: ${(e as any)?.message || e}`);
  }

  recordStep(id: string, arg?: any): void {
    if (!this.recording || this.recordingPaused) return;
    this.recording.steps.push(arg === undefined ? { id } : { id, arg: JSON.parse(JSON.stringify(arg)) });
  }

  // ------------------------------------------------------------------------------------------
  // Autosave and drafts

  scheduleAutosave(): void {
    if (!this.prefs.autosave || this.autosaveTimer) return;
    this.autosaveTimer = setTimeout(() => { this.autosaveTimer = null; void this.saveDrafts(); }, Math.max(3, this.prefs.autosaveSeconds) * 1000);
  }

  async saveDrafts(): Promise<void> {
    for (const tab of this.docs) {
      if (!tab.dirty) continue;
      try {
        await kvSet('draft:' + tab.id, { id: tab.id, json: tab.pub.toJSON(), title: tab.title, fileName: tab.fileName, format: tab.format, uri: tab.uri, key: tab.key, time: Date.now() });
      } catch { /* storage full */ }
    }
    this.ui.status?.('Draft saved');
  }

  followLink(href: string): void {
    if (!isSafeExternalUrl(href)) { toast(`Blocked a link with an unsupported or unsafe address: ${href.slice(0, 60)}`); return; }
    import('./platform/native').then(({ openExternal }) => openExternal(href));
  }

  focus(): void { this.active?.ui.focus(); }
}
