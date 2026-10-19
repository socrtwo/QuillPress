/** File (backstage) commands: new, open, save, export, print, share, info, versions, options. */
import { def } from './registry';
import type { App, PubTab } from '../app';
import { Pub } from '../model/pub';
import type { Page } from '../model/types';
import { FORMATS, formatById, formatFromName, importPublication, exportPublication, PasswordNeeded } from '../io';
import { openDocument, saveAs, writeBack, shareFile, readUri, OPEN_ACCEPT, OPEN_MIMES, isDesktop } from '../platform/native';
import { openDialog, toast, confirmDialog, choiceDialog, promptDialog } from '../ui/dialog';
import { kvGet, kvSet, kvKeys, kvDel } from '../util/store';
import { TEMPLATES } from '../templates';
import { showRecoveryReport, showManualRecovery, recoverySummary } from '../ui/recovery';
import { sanitizePrefs, DEFAULT_REPLACEMENTS } from '../prefs';
import { SPELL_DIALECTS } from '../proof/proofing';
import { PAGE_SIZES, UNITS } from '../model/types';

/** Key for a publication's cached copy, Recent entry and snapshots. */
export function docKey(tab: PubTab): string {
  return (tab.uri && !tab.uri.startsWith('fsa:') ? tab.uri : '') || tab.key || `doc:${tab.id}`;
}

export function localKey(name: string, data: ArrayBuffer): string {
  const b = new Uint8Array(data);
  let hh = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) hh = Math.imul(hh ^ b[i], 0x01000193);
  return `doc:${name}:${b.length.toString(36)}.${(hh >>> 0).toString(36)}`;
}

/** An untouched new publication can be replaced by the next file opened. */
export function isPristine(tab: PubTab): boolean {
  const p = tab.pub;
  return !tab.dirty && !tab.uri && !p.canUndo && p.pages.length <= 1 && p.pages.every((pg) => pg.items.length === 0) && !p.data.stories.some((s) => s.paras.some((x) => x.runs.some((r) => r.text)));
}

const toBlob = (data: Uint8Array | string, mime: string) => new Blob([data as BlobPart], { type: mime });

/** Formats whose file QuillPress keeps writing back to (everything else is saved as .qpp). */
const KEEPS_FILE = ['qpp', 'qppe', 'sla', 'json'];

export async function openBuffer(app: App, data: ArrayBuffer, name: string, uri: string | null, opts: { repair?: boolean; key?: string; password?: string } = {}): Promise<PubTab | null> {
  try {
    if (opts.repair) toast(`Repairing ${name}…`);
    let res;
    try {
      res = await importPublication(new Uint8Array(data), name, { repair: opts.repair, password: opts.password });
    } catch (e) {
      if (e instanceof PasswordNeeded) {
        const pw = await promptDialog('Password', `${name} is encrypted. Enter its password:`, '', { type: 'password' });
        if (pw == null) return null;
        return openBuffer(app, data, name, uri, { ...opts, password: pw });
      }
      throw e;
    }
    const { pub, format, recovery, warnings } = res;
    const fmt = formatById(format) || formatFromName(name);
    const cur = app.tab;
    const base = name.replace(/\.[^.]+$/, '');
    const keepsFile = !!fmt && KEEPS_FILE.includes(fmt.id);
    const meta: Partial<PubTab> = recovery
      ? { title: `${base} (Recovered)`, fileName: `${base} (Recovered).qpp`, format: 'qpp', uri: null, key: '' }
      : { title: base, fileName: keepsFile ? name : `${base}.qpp`, format: keepsFile ? fmt!.id : 'qpp', uri: keepsFile ? uri : null, key: uri && !uri.startsWith('fsa:') ? '' : opts.key || localKey(name, data) };
    pub.clearHistory();
    let tab: PubTab;
    if (cur && isPristine(cur)) {
      Object.assign(cur, meta);
      app.replacePub(cur, pub);
      tab = cur;
      app.ui.tabsChanged();
    } else tab = app.createTab(pub, meta);
    tab.dirty = !!recovery;
    tab.recovery = recovery || null;
    if (!recovery) {
      addRecent(app, tab);
      await kvSet('file:' + docKey(tab), { name, data, uri, when: Date.now() });
    }
    app.activate(tab);
    const details = () => openDialog({ title: 'Import Notes', content: Object.assign(document.createElement('pre'), { className: 'ql-notices', textContent: (warnings || []).join('\n') }), cancel: false });
    if (recovery) toast(`${name} was damaged. ${recoverySummary(recovery)}`, { action: 'Details', onAction: () => app.exec('file.recoveryReport'), ms: 9000 });
    else if (warnings?.length) toast(`Opened ${name} (${warnings.length} note${warnings.length > 1 ? 's' : ''})`, { action: 'Details', onAction: details, ms: 9000 });
    else if (!keepsFile) toast(`Opened ${name}. Save as .qpp to keep your changes.`, { ms: 6000 });
    else toast(`Opened ${name}`);
    return tab;
  } catch (e: any) {
    console.error(e);
    toast(`Could not open ${name}: ${e?.message || e}`, { action: 'Repair', onAction: () => openBuffer(app, data, name, uri, { repair: true }), ms: 9000 });
    return null;
  }
}

function addRecent(app: App, tab: PubTab) {
  const key = docKey(tab);
  const list = app.prefs.recent.filter((r) => r.key !== key);
  const old = app.prefs.recent.find((r) => r.key === key);
  list.unshift({ key, name: tab.displayName, when: Date.now(), uri: tab.uri || undefined, format: tab.format, pinned: old?.pinned });
  app.prefs.recent = [...list.filter((r) => r.pinned), ...list.filter((r) => !r.pinned)].slice(0, 40);
  app.savePrefs();
}

export async function snapshot(_app: App, tab: PubTab, label: string) {
  await kvSet(`snap:${docKey(tab)}:${Date.now()}`, { label, json: tab.pub.toJSON(), when: Date.now(), name: tab.displayName });
}

export async function saveTab(app: App, tab: PubTab, opts: { as?: boolean; format?: string; copy?: boolean } = {}): Promise<boolean> {
  if (tab.ui.editingText) tab.ui.commitText();
  let format = opts.format || (formatById(tab.format)?.canExport ? tab.format : app.prefs.defaultSaveFormat);
  let fmt = formatById(format);
  if (!fmt?.canExport) { format = 'qpp'; fmt = formatById('qpp')!; }
  if (!opts.copy && format === 'sla') {
    const c = await choiceDialog('Keep Scribus Format?', 'Scribus documents keep pages, frames, styles and pictures, but not every QuillPress setting (effects, baseline grid, comments, variables).', ['Save as QuillPress Publication (.qpp)', 'Keep Scribus (.sla)']);
    if (c < 0) return false;
    if (c === 0) { format = 'qpp'; fmt = formatById('qpp')!; opts = { ...opts, as: true }; }
  }
  const base = (tab.fileName || tab.title || 'Publication').replace(/\.[^.]+$/, '');
  const name = `${base}.${fmt.ext[0]}`;
  tab.pub.data.props.lastModifiedBy = app.prefs.author;
  tab.pub.data.props.modified = Date.now();
  const version = tab.pub.version;
  let password: string | undefined;
  if (format === 'qppe') {
    const r = await openDialog({ title: 'Encrypt Publication', fields: [{ key: 'p1', label: 'Password', type: 'password' }, { key: 'p2', label: 'Confirm', type: 'password' }], validate: (x) => (!x.p1 ? 'Enter a password.' : x.p1 !== x.p2 ? 'Passwords do not match.' : null) });
    if (!r) return false;
    password = r.p1;
  }
  const out = await exportPublication(tab.pub, format, { password });
  const blob = toBlob(out.data, out.mime);
  if (!opts.as && !opts.copy && tab.uri && format === tab.format) {
    try {
      if (await writeBack(tab.uri, blob)) { markSaved(app, tab, version); toast(`Saved ${tab.displayName}`); await snapshot(app, tab, 'Saved'); return true; }
    } catch (e) { console.warn(e); }
  }
  const r = await saveAs(blob, name);
  if (!r) return false;
  if (!opts.copy) {
    tab.fileName = r.name; tab.title = r.name.replace(/\.[^.]+$/, ''); tab.format = formatFromName(r.name)?.id || format; tab.uri = r.uri;
    markSaved(app, tab, version);
    addRecent(app, tab);
    await kvSet('file:' + docKey(tab), { name: r.name, data: out.data.buffer.slice(out.data.byteOffset, out.data.byteOffset + out.data.byteLength), uri: r.uri, when: Date.now() });
    await snapshot(app, tab, 'Saved');
  }
  toast(`Saved ${r.name}`);
  return true;
}

function markSaved(app: App, tab: PubTab, version: number) {
  tab.saved = Date.now();
  if (tab.pub.version === version) { tab.dirty = false; kvDel('draft:' + tab.id); } else app.scheduleAutosave();
  app.ui.tabsChanged();
  document.title = `${tab.displayName}${tab.dirty ? ' •' : ''} – QuillPress`;
}

/** Saves bytes produced by an export with the system save dialog. */
export async function saveBytes(data: Uint8Array | string, name: string, mime: string): Promise<void> {
  const r = await saveAs(toBlob(data, mime), name);
  if (r) toast(`Saved ${r.name}`);
}

export const baseName = (app: App) => (app.tab.fileName || app.tab.title || 'Publication').replace(/\.[^.]+$/, '');

/** Pages chosen in an export dialog: all, the selected ones, or the current page. */
function chosenPages(app: App, which: string): Page[] | undefined {
  if (which === 'selected') return app.targetPages();
  if (which === 'current') return app.page ? [app.page] : [];
  return undefined;
}

async function makePdf(app: App, o: { pages?: Page[]; bleed?: boolean; marks?: boolean; quality?: string; spreads?: boolean } = {}): Promise<Uint8Array> {
  const { pubToPdf } = await import('../export/pdf');
  const px = o.quality === 'small' ? 1000 : o.quality === 'high' ? 4000 : 2000;
  return pubToPdf(app.pub, { pages: o.pages?.map((p) => p.id), bleed: o.bleed, marks: o.marks, spreads: o.spreads, maxImagePx: px, quality: o.quality === 'small' ? 0.7 : o.quality === 'high' ? 0.95 : 0.85, onProgress: (d, t) => app.ui.status?.(`Creating PDF… page ${d} of ${t}`) });
}

def([
  {
    id: 'file.new', label: 'New', icon: 'note_add', tab: 'Backstage', group: 'New', keys: ['Mod-n'], popular: true, noRecord: true,
    tip: 'New publication (blank, or from a template)',
    run: (app, arg) => {
      const t = TEMPLATES.find((x) => x.id === arg);
      const prev = app.tab && isPristine(app.tab) ? app.tab : null;
      if (t && t.id !== 'blank') {
        const pub = t.build();
        pub.data.props.author = app.prefs.author;
        pub.data.props.created = Date.now();
        pub.data.unit = app.prefs.unit;
        pub.clearHistory();
        const tab = app.createTab(pub, { title: t.name });
        if (prev) app.closeTab(prev);
        app.activate(tab);
        app.ui.hideBackstage();
        return;
      }
      if (prev) { app.ui.hideBackstage(); app.focus(); return; }
      app.createTab();
      app.ui.hideBackstage();
    },
  },
  { id: 'file.newFromTemplate', label: 'New from Template…', icon: 'library_books', tab: 'Backstage', group: 'New', noRecord: true, run: (app) => app.ui.showBackstage('new') },
  {
    id: 'file.newWithSize', label: 'New Publication with Page Size…', icon: 'crop_free', tab: 'Backstage', group: 'New', noRecord: true,
    tip: 'Choose the page size, orientation, facing pages, margins and columns of a new publication',
    run: async (app) => {
      const u = UNITS[app.prefs.unit];
      const r = await openDialog({ title: 'New Publication', fields: [
        { key: 'size', label: 'Page size', type: 'select', options: [...PAGE_SIZES.map((s) => ({ value: s.id, label: s.label })), { value: 'custom', label: 'Custom…' }], value: 'letter' },
        { key: 'w', label: `Width (${u.label})`, type: 'number', value: +(612 / u.pt).toFixed(u.digits), half: true, visibleIf: (v) => v.size === 'custom' },
        { key: 'h', label: `Height (${u.label})`, type: 'number', value: +(792 / u.pt).toFixed(u.digits), half: true, visibleIf: (v) => v.size === 'custom' },
        { key: 'orient', label: 'Orientation', type: 'radio', options: [{ value: 'p', label: 'Portrait' }, { value: 'l', label: 'Landscape' }], value: 'p' },
        { key: 'facing', label: 'Facing pages (spreads)', type: 'checkbox', value: false, half: true },
        { key: 'pages', label: 'Pages', type: 'number', value: 1, min: 1, max: 500, half: true },
        { key: 'margin', label: `Margins (${u.label})`, type: 'number', value: +(36 / u.pt).toFixed(u.digits), half: true },
        { key: 'cols', label: 'Columns', type: 'number', value: 1, min: 1, max: 12, half: true },
      ], ok: 'Create' });
      if (!r) return;
      const base = PAGE_SIZES.find((s) => s.id === r.size);
      let w = base ? base.w : (+r.w || 8.5) * u.pt, h = base ? base.h : (+r.h || 11) * u.pt;
      if (r.orient === 'l' ? w < h : w > h) [w, h] = [h, w];
      const m = Math.max(0, (+r.margin || 0) * u.pt);
      const pub = Pub.blank({ w, h }, { facing: !!r.facing, margins: [m, m, m, m], columns: Math.max(1, +r.cols || 1), pages: Math.max(1, +r.pages || 1) });
      pub.data.unit = app.prefs.unit;
      pub.data.props.author = app.prefs.author;
      pub.data.props.created = Date.now();
      pub.clearHistory();
      const prev = app.tab && isPristine(app.tab) ? app.tab : null;
      const tab = app.createTab(pub);
      if (prev) app.closeTab(prev);
      app.activate(tab);
      app.ui.hideBackstage();
    },
  },
  {
    id: 'file.open', label: 'Open', icon: 'folder_open', tab: 'Backstage', group: 'Open', keys: ['Mod-o', 'Mod-F12'], popular: true, noRecord: true,
    run: async (app) => {
      const f = await openDocument(OPEN_ACCEPT, OPEN_MIMES);
      if (!f) return;
      await openBuffer(app, f.data, f.name, f.uri);
      app.ui.hideBackstage();
    },
  },
  {
    id: 'file.openDropped', label: 'Open Dropped Files', icon: 'file_open', tab: 'Backstage', group: 'Open', internal: true, noRecord: true,
    run: async (app, files: File[]) => { for (const f of files || []) await openBuffer(app, await f.arrayBuffer(), f.name, null); },
  },
  {
    id: 'file.openRepair', label: 'Open and Repair…', icon: 'healing', tab: 'Backstage', group: 'Open', noRecord: true,
    tip: 'Open a damaged publication: rebuild its package from raw bytes, repair its JSON or XML, salvage pages, pictures and text, and show what was recovered',
    keywords: 'corrupt damaged recover fix broken salvage',
    run: async (app) => {
      const f = await openDocument('*/*', ['*/*']);
      if (!f) return;
      const tab = await openBuffer(app, f.data, f.name, f.uri, { repair: true });
      app.ui.hideBackstage();
      if (tab?.recovery) await showRecoveryReport(tab.recovery, { open: () => app.activate(tab) });
    },
  },
  {
    id: 'file.recoverAny', label: 'Recover Data from Any File…', icon: 'text_snippet', tab: 'Backstage', group: 'Open', noRecord: true,
    tip: 'Extract readable text and pictures from any file, however damaged',
    keywords: 'corrupt salvage strings extract',
    run: async (app) => { await showManualRecovery({ openPub: (pub, name, report) => { const t = app.createTab(pub, { title: `${name.replace(/\.[^.]+$/, '')} (Recovered)` }); t.recovery = report; t.dirty = true; } }); },
  },
  {
    id: 'file.recoveryReport', label: 'Recovery Report', icon: 'fact_check', tab: 'Backstage', group: 'Open', noRecord: true,
    isEnabled: (app) => !!app.tab?.recovery,
    run: async (app) => {
      const r = app.tab?.recovery;
      if (!r) { toast('This publication was not recovered from a damaged file.'); return; }
      await showRecoveryReport(r, {});
    },
  },
  { id: 'file.recoveryHelp', label: 'Manual Recovery Options', icon: 'support', tab: 'Backstage', group: 'Open', noRecord: true, run: () => showManualRecovery() },
  {
    id: 'file.openRecent', label: 'Open Recent File', icon: 'history', tab: 'Backstage', group: 'Open', kind: 'menu', noRecord: true,
    run: async (app, key) => {
      if (!key) return app.ui.showBackstage('open');
      const rec = app.prefs.recent.find((r) => r.key === key);
      if (!rec) return;
      const existing = app.docs.find((d) => docKey(d) === key);
      if (existing) { app.activate(existing); app.ui.hideBackstage(); return; }
      let f = rec.uri ? await readUri(rec.uri) : null;
      if (!f) { const cached = await kvGet('file:' + key); if (cached) f = { name: cached.name, data: cached.data, uri: cached.uri }; }
      if (!f) { toast('That file is no longer available. Use Open to locate it.'); return; }
      await openBuffer(app, f.data, f.name, f.uri, { key });
      app.ui.hideBackstage();
    },
    menu: (app) => app.prefs.recent.length ? app.prefs.recent.slice(0, 12).map((r) => ({ id: 'file.openRecent', arg: r.key, label: (r.pinned ? '📌 ' : '') + r.name })) : [{ label: '(no recent publications)' }],
  },
  { id: 'file.pinRecent', label: 'Pin / Unpin Recent File', icon: 'push_pin', tab: 'Backstage', group: 'Open', internal: true, noRecord: true, run: (app, key: string) => { const r = app.prefs.recent.find((x) => x.key === key); if (r) { r.pinned = !r.pinned; app.savePrefs(); app.ui.showBackstage('open'); } } },
  { id: 'file.clearRecent', label: 'Clear Unpinned Recent Publications', icon: 'delete_sweep', tab: 'Backstage', group: 'Open', noRecord: true, run: (app) => { app.prefs.recent = app.prefs.recent.filter((r) => r.pinned); app.savePrefs(); app.ui.showBackstage('open'); } },
  {
    id: 'file.openEncrypted', label: 'Open Encrypted Publication…', icon: 'lock_open', tab: 'Backstage', group: 'Open', noRecord: true,
    run: async (app) => {
      const f = await openDocument('.qppe', ['application/octet-stream', '*/*']);
      if (!f) return;
      await openBuffer(app, f.data, f.name, null);
    },
  },
  { id: 'file.save', label: 'Save', icon: 'save', tab: 'Backstage', group: 'Save', keys: ['Mod-s', 'Shift-F12'], popular: true, noRecord: true, run: (app) => saveTab(app, app.tab) },
  { id: 'file.saveAs', label: 'Save As', icon: 'save_as', tab: 'Backstage', group: 'Save', keys: ['F12'], popular: true, noRecord: true, run: (app) => app.ui.showBackstage('saveas') },
  { id: 'file.saveCopy', label: 'Save a Copy…', icon: 'file_copy', tab: 'Backstage', group: 'Save', noRecord: true, run: (app) => saveTab(app, app.tab, { copy: true }) },
  { id: 'file.saveAll', label: 'Save All', icon: 'library_add_check', tab: 'Backstage', group: 'Save', noRecord: true, run: async (app) => { for (const d of app.docs) if (d.dirty) await saveTab(app, d); } },
  {
    id: 'file.saveAsFormat', label: 'Save As Format', icon: 'save_as', tab: 'Backstage', group: 'Save', internal: true, noRecord: true,
    run: async (app, format: string) => { await saveTab(app, app.tab, { as: true, format }); app.ui.hideBackstage(); },
  },
  {
    id: 'file.exportAs', label: 'Export a Copy As', icon: 'ios_share', tab: 'Backstage', group: 'Export', internal: true, noRecord: true,
    run: async (app, format: string) => { await saveTab(app, app.tab, { copy: true, format }); app.ui.hideBackstage(); },
  },
  {
    id: 'file.saveTemplate', label: 'Save as Template', icon: 'bookmark_add', tab: 'Backstage', group: 'Save', noRecord: true,
    tip: 'Keep this publication\'s design (masters, styles, swatches, and the pages if you want) as a starting point under File ▸ New ▸ My Templates',
    run: async (app) => {
      const r = await openDialog({ title: 'Save as Template', fields: [{ key: 'name', label: 'Template name', type: 'text', value: app.tab.title }, { key: 'pages', label: 'Keep the pages and their contents (otherwise only masters, styles and swatches)', type: 'checkbox', value: true }] });
      if (!r?.name) return;
      const copy = JSON.parse(JSON.stringify(app.pub.toJSON()));
      if (!r.pages) { const first = copy.data.pages[0]; copy.data.pages = first ? [{ ...first, items: [], comments: [] }] : []; copy.data.stories = []; copy.media = {}; }
      await kvSet(`tpl:${r.name}`, { name: r.name, json: copy, when: Date.now() });
      toast(`Template "${r.name}" saved`);
    },
  },
  {
    id: 'file.openTemplate', label: 'Open My Template', icon: 'bookmark', tab: 'Backstage', group: 'New', internal: true, noRecord: true,
    run: async (app, name: string) => {
      const t = await kvGet(`tpl:${name}`);
      if (!t) { toast('That template is no longer available.'); return; }
      const pub = Pub.fromJSON(t.json);
      pub.clearHistory();
      const prev = app.tab && isPristine(app.tab) ? app.tab : null;
      const tab = app.createTab(pub, { title: name });
      if (prev) app.closeTab(prev);
      app.activate(tab);
      app.ui.hideBackstage();
    },
  },
  { id: 'file.deleteTemplate', label: 'Delete My Template', icon: 'bookmark_remove', tab: 'Backstage', group: 'New', internal: true, noRecord: true, run: async (app, name: string) => { if (await confirmDialog('Delete Template', `Delete the template "${name}"?`, 'Delete')) { await kvDel(`tpl:${name}`); app.ui.showBackstage('new'); } } },
  { id: 'file.autosave', label: 'AutoSave', icon: 'autorenew', tab: 'Backstage', group: 'Save', kind: 'toggle', noRecord: true, run: (app) => { app.prefs.autosave = !app.prefs.autosave; app.savePrefs(); toast(app.prefs.autosave ? 'AutoSave on (drafts saved automatically)' : 'AutoSave off'); }, isActive: (app) => app.prefs.autosave },
  {
    id: 'file.revert', label: 'Revert to Saved', icon: 'settings_backup_restore', tab: 'Backstage', group: 'Info', noRecord: true,
    run: async (app) => {
      const tab = app.tab;
      const cached = await kvGet('file:' + docKey(tab));
      if (!cached) { toast('No saved version to revert to.'); return; }
      if (!(await confirmDialog('Revert', 'Discard all changes since the last save?'))) return;
      const { pub } = await importPublication(new Uint8Array(cached.data), cached.name);
      pub.clearHistory();
      app.replacePub(tab, pub); tab.dirty = false; app.ui.tabsChanged();
    },
  },
]);

// Exports -------------------------------------------------------------------------------------

for (const f of FORMATS.filter((x) => x.canExport)) {
  def({ id: `file.export.${f.id}`, label: `Export as ${f.label}`, icon: 'ios_share', tab: 'Backstage', group: 'Export', noRecord: true, run: (app) => saveTab(app, app.tab, { copy: true, format: f.id }) });
}

def([
  {
    id: 'file.export.pdf', label: 'Export to PDF', icon: 'picture_as_pdf', tab: 'Backstage', group: 'Export', popular: true, noRecord: true,
    tip: 'A vector PDF with selectable text, page labels, an optional bleed box and crop marks',
    run: async (app, arg?: { quick?: boolean }) => {
      const pub = app.pub;
      const r = arg?.quick ? { which: 'all', bleed: false, marks: false, quality: 'standard', spreads: false } : await openDialog({ title: 'Export to PDF', fields: [
        { key: 'which', label: 'Pages', type: 'radio', options: [{ value: 'all', label: 'All pages' }, { value: 'selected', label: 'Selected pages' }, { value: 'current', label: 'Current page' }], value: 'all' },
        { key: 'bleed', label: `Include bleed (${pub.data.bleed} pt) and set the trim box`, type: 'checkbox', value: pub.data.bleed > 0, visibleIf: () => pub.data.bleed > 0 },
        { key: 'marks', label: 'Crop marks', type: 'checkbox', value: false, visibleIf: (v) => !!v.bleed },
        { key: 'spreads', label: 'Spreads (facing pages on one sheet)', type: 'checkbox', value: false, visibleIf: () => pub.data.facing },
        { key: 'quality', label: 'Picture quality', type: 'select', options: [{ value: 'standard', label: 'Standard (print and screen)' }, { value: 'small', label: 'Smallest file' }, { value: 'high', label: 'High (press)' }], value: 'standard' },
      ], ok: 'Export', help: 'Text is set in the standard PDF fonts closest to the publication\'s fonts. For the exact screen fonts, use Print ▸ Save as PDF.' });
      if (!r) return;
      app.ui.hideBackstage();
      toast('Creating the PDF…');
      try {
        const pdf = await makePdf(app, { pages: chosenPages(app, r.which), bleed: !!r.bleed, marks: !!r.marks, quality: r.quality, spreads: !!r.spreads });
        await saveBytes(pdf, `${baseName(app)}.pdf`, 'application/pdf');
      } finally { app.ui.status?.(''); }
    },
  },
  {
    id: 'file.export.images', label: 'Export Pages as Pictures…', icon: 'image', tab: 'Backstage', group: 'Export', noRecord: true,
    run: async (app) => {
      const r = await openDialog({ title: 'Export Pages as Pictures', fields: [
        { key: 'format', label: 'Format', type: 'select', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'svg', label: 'SVG (vector)' }], value: 'png' },
        { key: 'which', label: 'Pages', type: 'radio', options: [{ value: 'current', label: 'Current page' }, { value: 'selected', label: 'Selected pages' }, { value: 'all', label: 'All pages (one ZIP file)' }], value: 'current' },
        { key: 'width', label: 'Width in pixels', type: 'number', value: 1600, min: 160, max: 10000, visibleIf: (v) => v.format !== 'svg' },
        { key: 'bleed', label: 'Include bleed', type: 'checkbox', value: false, visibleIf: () => app.pub.data.bleed > 0 },
      ], ok: 'Export' });
      if (!r) return;
      const { pageToSvg, pageToImage } = await import('../export/images');
      const pages = chosenPages(app, r.which) || app.pub.pages;
      const files: { name: string; data: Uint8Array | string }[] = [];
      for (const p of pages) {
        const i = app.pub.pageIndex(p.id);
        const name = `${baseName(app)} page ${String(i + 1).padStart(3, '0')}.${r.format === 'jpeg' ? 'jpg' : r.format}`;
        files.push({ name, data: r.format === 'svg' ? await pageToSvg(app.pub, p, { bleed: r.bleed }) : await pageToImage(app.pub, p, { format: r.format, width: +r.width || 1600, bleed: r.bleed }) });
      }
      if (files.length === 1) { await saveBytes(files[0].data, files[0].name, r.format === 'svg' ? 'image/svg+xml' : `image/${r.format}`); return; }
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f.data);
      await saveBytes(await zip.generateAsync({ type: 'uint8array' }), `${baseName(app)} pages.zip`, 'application/zip');
    },
  },
  {
    id: 'file.export.html', label: 'Export Web Page', icon: 'html', tab: 'Backstage', group: 'Export', noRecord: true,
    tip: 'One self-contained web page with every page as searchable vector graphics and the text for screen readers',
    run: async (app) => {
      const r = await openDialog({ title: 'Export Web Page', fields: [{ key: 'reflow', label: 'Also show the stories as flowing text under the pages (phones)', type: 'checkbox', value: true }, { key: 'fonts', label: 'Embed the fonts (larger file, exact look)', type: 'checkbox', value: true }] });
      if (!r) return;
      const { pubToHtml } = await import('../export/html');
      await saveBytes(await pubToHtml(app.pub, { title: app.tab.title, reflow: r.reflow, fonts: r.fonts }), `${baseName(app)}.html`, 'text/html');
    },
  },
  {
    id: 'file.export.text', label: 'Export Text…', icon: 'notes', tab: 'Backstage', group: 'Export', noRecord: true,
    tip: 'All stories as plain text or Markdown (headings and lists from the paragraph styles)',
    run: async (app) => {
      const r = await openDialog({ title: 'Export Text', fields: [{ key: 'f', label: 'Format', type: 'radio', options: [{ value: 'txt', label: 'Plain text (.txt)' }, { value: 'md', label: 'Markdown (.md)' }], value: 'txt' }] });
      if (!r) return;
      const { pubToText } = await import('../export/html');
      await saveBytes(pubToText(app.pub, r.f === 'md'), `${baseName(app)}.${r.f}`, r.f === 'md' ? 'text/markdown' : 'text/plain');
    },
  },
  {
    id: 'file.export.svg', label: 'Export Current Page as SVG', icon: 'polyline', tab: 'Backstage', group: 'Export', noRecord: true,
    run: async (app) => { if (!app.page) return; const { pageToSvg } = await import('../export/images'); await saveBytes(await pageToSvg(app.pub, app.page), `${baseName(app)} page ${app.pub.pageIndex(app.page.id) + 1}.svg`, 'image/svg+xml'); },
  },
  {
    id: 'file.package', label: 'Package Publication…', icon: 'inventory_2', tab: 'Backstage', group: 'Export', noRecord: true, origin: 'Collect for Output (QuarkXPress), Package (InDesign)',
    tip: 'A ZIP with the publication (.qpp and .sla), every picture as a file, a PDF, a web page, and a report of fonts and pictures used',
    run: async (app) => {
      toast('Packaging…');
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const b = baseName(app);
      const pub = app.pub;
      zip.file(`${b}.qpp`, (await exportPublication(pub, 'qpp')).data);
      zip.file(`${b}.sla`, (await exportPublication(pub, 'sla')).data);
      const { pubToHtml } = await import('../export/html');
      zip.file(`${b}.html`, await pubToHtml(pub, { title: app.tab.title }));
      try { zip.file(`${b}.pdf`, await makePdf(app)); } catch (e) { console.warn('PDF not packaged', e); }
      const links = zip.folder('Links')!;
      const { unb64 } = await import('../io/xml');
      for (const [id, m] of Object.entries(pub.media)) { const ext = (m.mime.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg'); links.file(m.name && /\.[a-z0-9]+$/i.test(m.name) ? m.name : `${id}.${ext}`, unb64(m.b64)); }
      const { fontsUsed } = await import('../model/styles');
      const report = [`Package of "${app.tab.title}" made by QuillPress on ${new Date().toLocaleString()}`, '', `Pages: ${pub.pages.length} (${pub.size.w} × ${pub.size.h} pt${pub.data.facing ? ', facing' : ''}, bleed ${pub.data.bleed} pt)`, `Fonts: ${fontsUsed(pub.data).join(', ') || '(defaults)'}`, `Pictures: ${Object.keys(pub.media).length}`, '', 'Files:', `  ${b}.qpp — the publication (open with QuillPress)`, `  ${b}.sla — Scribus document`, `  ${b}.pdf — PDF for printing`, `  ${b}.html — web page`, '  Links/ — every picture'].join('\n');
      zip.file('Package report.txt', report);
      await saveBytes(await zip.generateAsync({ type: 'uint8array' }), `${b} package.zip`, 'application/zip');
    },
  },
]);

// Print, share, close ------------------------------------------------------------------------

def([
  {
    id: 'file.print', label: 'Print Preview and Print', icon: 'print', tab: 'Backstage', group: 'Print', keys: ['Mod-p'], popular: true, noRecord: true,
    run: async (app) => { app.ui.hideBackstage(); const { printPreviewDialog } = await import('../export/print'); await printPreviewDialog(app); },
  },
  {
    id: 'file.quickPrint', label: 'Quick Print', icon: 'print', tab: 'Backstage', group: 'Print', noRecord: true,
    tip: 'Print all pages with the current settings, without the preview',
    run: async (app) => { const { printPub } = await import('../export/print'); await printPub(app, {}); },
  },
  {
    id: 'file.share', label: 'Share', icon: 'share', tab: 'Backstage', group: 'Share', popular: true, noRecord: true,
    run: async (app) => {
      const r = await openDialog({ title: 'Share', fields: [{ key: 'fmt', label: 'Send as', type: 'radio', options: [{ value: 'pdf', label: 'PDF' }, ...FORMATS.filter((f) => f.canExport && f.id !== 'qppe').map((f) => ({ value: f.id, label: f.label }))], value: 'pdf' }] });
      if (!r) return;
      const b = baseName(app);
      if (r.fmt === 'pdf') { await shareFile(toBlob(await makePdf(app), 'application/pdf'), `${b}.pdf`, app.tab.title); return; }
      const out = await exportPublication(app.pub, r.fmt);
      await shareFile(toBlob(out.data, out.mime), `${b}.${out.ext}`, app.tab.title);
    },
  },
  {
    id: 'file.email', label: 'Email', icon: 'attach_email', tab: 'Backstage', group: 'Share', noRecord: true,
    tip: 'Send the publication as an attachment (uses the system share sheet, which includes your mail app and QuillPost when installed)',
    run: async (app) => { const out = await exportPublication(app.pub, 'qpp'); await shareFile(toBlob(out.data, out.mime), `${baseName(app)}.qpp`, app.tab.title); },
  },
  {
    id: 'file.emailPdf', label: 'Email as PDF', icon: 'forward_to_inbox', tab: 'Backstage', group: 'Share', noRecord: true,
    run: async (app) => { await shareFile(toBlob(await makePdf(app), 'application/pdf'), `${baseName(app)}.pdf`, app.tab.title); },
  },
  {
    id: 'file.close', label: 'Close', icon: 'close', tab: 'Backstage', group: 'Close', keys: ['Mod-w', 'Mod-F4'], popular: true, noRecord: true,
    run: async (app, arg) => {
      const tab = app.docs.find((d) => d.id === arg) || app.tab;
      if (tab.dirty && app.prefs.confirmClose) {
        const c = await choiceDialog('Save Changes?', `Save changes to "${tab.displayName}" before closing?`, ['Save', "Don't Save"]);
        if (c < 0) return;
        if (c === 0 && !(await saveTab(app, tab))) return;
      }
      app.closeTab(tab);
      app.ui.hideBackstage();
    },
  },
  { id: 'file.closeAll', label: 'Close All', icon: 'tab_close', tab: 'Backstage', group: 'Close', noRecord: true, run: async (app) => { for (const d of [...app.docs]) { app.activate(d); await app.exec('file.close', d.id); } } },
  {
    id: 'file.exit', label: 'Exit', icon: 'logout', tab: 'Backstage', group: 'Close', noRecord: true,
    run: async (app) => {
      for (const d of [...app.docs]) if (d.dirty) { app.activate(d); await app.exec('file.close', d.id); if (app.docs.includes(d)) return; }
      await app.saveDrafts();
      if (isDesktop()) { window.close(); return; }
      try { const { App: CapApp } = await import('@capacitor/app'); await CapApp.exitApp(); } catch { window.close(); }
    },
  },
]);

// Info ---------------------------------------------------------------------------------------

def([
  {
    id: 'file.properties', label: 'Properties…', icon: 'info', tab: 'Backstage', group: 'Info', noRecord: true,
    run: async (app) => {
      const p = app.pub.data.props;
      const r = await openDialog({ title: 'Publication Properties', wide: true, fields: [
        { key: 'title', label: 'Title', type: 'text', value: p.title || '' }, { key: 'subject', label: 'Subject', type: 'text', value: p.subject || '' },
        { key: 'author', label: 'Author', type: 'text', value: p.author || app.prefs.author, half: true }, { key: 'language', label: 'Language (BCP 47, e.g. en-US)', type: 'text', value: p.language || '', half: true },
        { key: 'keywords', label: 'Tags / keywords', type: 'text', value: p.keywords || '' },
        { key: 'description', label: 'Comments', type: 'textarea', rows: 3, value: p.description || '' },
        { key: 'custom', label: 'Custom properties (name=value per line)', type: 'textarea', rows: 3, value: Object.entries(p.custom || {}).map(([k, x]) => `${k}=${x}`).join('\n') },
        { key: 'stats', type: 'info', html: `<p class="ql-help">Pages: ${app.pub.pages.length} · Created: ${p.created ? new Date(p.created).toLocaleString() : '—'} · Modified: ${p.modified ? new Date(p.modified).toLocaleString() : '—'} · Last saved: ${app.tab.saved ? new Date(app.tab.saved).toLocaleString() : '—'}</p>` },
      ] });
      if (!r) return;
      app.pub.transact('Properties', () => {
        Object.assign(app.pub.data.props, { title: r.title, subject: r.subject, author: r.author, language: r.language || undefined, keywords: r.keywords, description: r.description });
        app.pub.data.props.custom = Object.fromEntries(String(r.custom).split('\n').map((l) => l.split('=')).filter((x) => x[0]?.trim()).map(([k, ...rest]) => [k.trim(), rest.join('=').trim()]));
      });
    },
  },
  {
    id: 'file.inspect', label: 'Inspect Publication…', icon: 'policy', tab: 'Backstage', group: 'Info', noRecord: true,
    tip: 'Find and remove comments, page notes, hidden objects, off-page content, unused pictures and personal information before sharing',
    run: async (app) => {
      const pub = app.pub;
      const { w, h } = pub.size;
      let comments = 0, notes = 0, offPage = 0, hidden = 0;
      for (const pg of pub.pages) {
        comments += pg.comments?.length || 0;
        if (pg.notes?.trim()) notes++;
        for (const e of pg.items) { if (e.hidden) hidden++; if (e.x + e.w < -pub.data.bleed || e.y + e.h < -pub.data.bleed || e.x > w + pub.data.bleed || e.y > h + pub.data.bleed) offPage++; }
      }
      const used = new Set<string>();
      const walk = (items: any[]) => { for (const e of items) { if (e.media) used.add(e.media); if (e.fill?.type === 'image') used.add(e.fill.media); if (e.children) walk(e.children); } };
      for (const pg of pub.pages) { walk(pg.items); if (pg.bg?.type === 'image') used.add(pg.bg.media); }
      for (const m of pub.data.masters) walk(m.items);
      const unused = Object.keys(pub.media).filter((k) => !used.has(k));
      const r = await openDialog({ title: 'Publication Inspector', help: 'Select the content to remove before sharing. You can undo the removal.', fields: [
        { key: 'comments', label: `Comments (${comments})`, type: 'checkbox', value: comments > 0 },
        { key: 'props', label: 'Document properties and personal information', type: 'checkbox', value: true },
        { key: 'notes', label: `Page notes (${notes} pages)`, type: 'checkbox', value: false },
        { key: 'hidden', label: `Hidden objects (${hidden})`, type: 'checkbox', value: false },
        { key: 'offPage', label: `Objects entirely off the page (${offPage})`, type: 'checkbox', value: false },
        { key: 'media', label: `Unused pictures (${unused.length})`, type: 'checkbox', value: unused.length > 0 },
        { key: 'tags', label: 'Object tags', type: 'checkbox', value: false },
      ], ok: 'Remove' });
      if (!r) return;
      pub.transact('Inspect Publication', () => {
        for (const pg of pub.pages) {
          if (r.comments) pg.comments = [];
          if (r.notes) delete pg.notes;
          if (r.hidden) pg.items = pg.items.filter((e) => !e.hidden);
          if (r.offPage) pg.items = pg.items.filter((e) => !(e.x + e.w < -pub.data.bleed || e.y + e.h < -pub.data.bleed || e.x > w + pub.data.bleed || e.y > h + pub.data.bleed));
          if (r.tags) for (const e of pg.items) delete e.tags;
        }
        if (r.props) { const keep = pub.data.props.title; pub.data.props = { title: keep, created: pub.data.props.created }; }
        if (r.media) for (const k of unused) delete pub.media[k];
        pub.pruneStories();
      });
      toast('Publication inspected and cleaned');
    },
  },
  { id: 'file.encrypt', label: 'Encrypt with Password…', icon: 'enhanced_encryption', tab: 'Backstage', group: 'Info', noRecord: true, tip: 'Save an AES-256 encrypted QuillPress copy (.qppe)', run: (app) => saveTab(app, app.tab, { copy: true, format: 'qppe' }) },
  {
    id: 'file.markFinal', label: 'Mark as Final', icon: 'verified', tab: 'Backstage', group: 'Info', kind: 'toggle', noRecord: true,
    tip: 'Make the publication read-only so readers know it is finished',
    isActive: (app) => !!app.pub?.data.finalMarked,
    run: (app) => { const d = app.pub; d.data.finalMarked = !d.data.finalMarked; d.changed(); toast(d.data.finalMarked ? 'Marked as final: editing is turned off.' : 'Editing is allowed again.'); },
  },
  {
    id: 'file.readOnly', label: 'Open Read-Only', icon: 'lock', tab: 'Backstage', group: 'Info', kind: 'toggle', noRecord: true,
    tip: 'Protect this tab from changes until you turn this off',
    isActive: (app) => !!app.tab?.readOnly,
    run: (app) => { app.tab.readOnly = !app.tab.readOnly; app.refresh(); toast(app.tab.readOnly ? 'Read-only: changes are blocked.' : 'Editing is allowed again.'); },
  },
  { id: 'file.versions', label: 'Version History', icon: 'history', tab: 'Backstage', group: 'Info', popular: true, noRecord: true, origin: 'Snapshots and version history in writing tools', run: (app) => { app.ui.hideBackstage(); app.ui.openPane('versions'); } },
  { id: 'file.snapshot', label: 'Take Snapshot', icon: 'add_a_photo', tab: 'Backstage', group: 'Info', keys: ['Mod-Alt-5'], noRecord: true, run: async (app) => { const label = await promptDialog('Take Snapshot', 'Snapshot name', `Snapshot ${new Date().toLocaleString()}`); if (label) { await snapshot(app, app.tab, label); toast('Snapshot saved'); } } },
  {
    id: 'file.recoverUnsaved', label: 'Recover Unsaved Publications', icon: 'restore_page', tab: 'Backstage', group: 'Info', noRecord: true,
    run: async (app) => {
      const keys = (await kvKeys('draft:')).filter((k) => !app.docs.some((d) => 'draft:' + d.id === k));
      if (!keys.length) { toast('No unsaved drafts found.'); return; }
      const drafts = await Promise.all(keys.map(async (k) => ({ k, d: await kvGet(k) })));
      const r = await openDialog({ title: 'Publication Recovery', fields: [{ key: 'k', label: 'Available drafts', type: 'list', multiple: true, rows: 8, options: drafts.map(({ k, d }) => ({ value: k, label: `${d.fileName || d.title} — ${new Date(d.time).toLocaleString()}` })), value: keys }], buttons: [{ label: 'Discard All', onClick: async (_v, ctl) => { for (const k of keys) await kvDel(k); ctl.close(); toast('Drafts discarded'); } }], ok: 'Recover' });
      if (!r?.k?.length) return;
      for (const { k, d } of drafts.filter((x) => r.k.includes(x.k))) {
        try {
          const tab = app.createTab(Pub.fromJSON(d.json), { title: d.title, fileName: d.fileName, format: d.format, uri: d.uri, key: d.key || '' });
          tab.dirty = true;
          await kvDel(k);
        } catch (e) { toast(`Could not restore ${d.title}: ${(e as Error).message}`); }
      }
    },
  },
]);

// Options ------------------------------------------------------------------------------------

def([
  {
    id: 'file.options', label: 'Options…', icon: 'settings', tab: 'Backstage', group: 'Options', popular: true, noRecord: true,
    run: async (app) => {
      const p = app.prefs;
      const u = UNITS[p.unit];
      const r = await openDialog({ title: 'QuillPress Options', wide: true, fields: [
        { key: 'h1', type: 'heading', label: 'General' },
        { key: 'author', label: 'User name', type: 'text', value: p.author, half: true },
        { key: 'initials', label: 'Initials', type: 'text', value: p.initials, half: true },
        { key: 'theme', label: 'App theme', type: 'select', options: ['system', 'light', 'dark'], value: p.theme, half: true },
        { key: 'uiScale', label: 'Toolbar size', type: 'select', options: [{ value: '0.85', label: 'Compact' }, { value: '1', label: 'Normal' }, { value: '1.15', label: 'Large (touch)' }], value: String(p.uiScale), half: true },
        { key: 'qatPosition', label: 'Quick Access Bar', type: 'select', options: [{ value: 'top', label: 'Above the ribbon' }, { value: 'below', label: 'Below the ribbon' }, { value: 'bottom', label: 'At the bottom (near keyboard)' }], value: p.qatPosition, half: true },
        { key: 'qatLabels', label: 'Show labels on Quick Access Bar', type: 'checkbox', value: p.qatLabels, half: true },
        { key: 'h2', type: 'heading', label: 'Units and new publications' },
        { key: 'unit', label: 'Measurement unit', type: 'select', options: Object.entries(UNITS).map(([k, v]) => ({ value: k, label: `${k === 'pica' ? 'Picas' : k === 'in' ? 'Inches' : k === 'mm' ? 'Millimeters' : k === 'cm' ? 'Centimeters' : k === 'pt' ? 'Points' : 'Pixels'} (${v.label})` })), value: p.unit, half: true },
        { key: 'defaultPageSize', label: 'Default page size', type: 'select', options: PAGE_SIZES.map((s) => ({ value: s.id, label: s.label })), value: PAGE_SIZES.find((s) => s.w === p.defaultPageSize.w && s.h === p.defaultPageSize.h)?.id || 'letter', half: true },
        { key: 'defaultFacing', label: 'Facing pages by default', type: 'checkbox', value: p.defaultFacing, half: true },
        { key: 'defaultColumns', label: 'Default columns', type: 'number', min: 1, max: 12, value: p.defaultColumns, half: true },
        { key: 'defaultMargin', label: `Default margins (${u.label})`, type: 'number', value: +(p.defaultMargins[0] / u.pt).toFixed(u.digits), half: true },
        { key: 'defaultSaveFormat', label: 'Default save format', type: 'select', options: FORMATS.filter((f) => f.canExport && f.id !== 'qppe').map((f) => ({ value: f.id, label: f.label })), value: p.defaultSaveFormat, half: true },
        { key: 'h3', type: 'heading', label: 'Layout' },
        { key: 'snapToGuides', label: 'Snap to guides and margins', type: 'checkbox', value: p.snapToGuides, half: true },
        { key: 'snapToGrid', label: 'Snap to grid', type: 'checkbox', value: p.snapToGrid, half: true },
        { key: 'gridSize', label: 'Grid spacing (points)', type: 'number', min: 2, max: 144, value: p.gridSize, half: true },
        { key: 'smartGuides', label: 'Smart guides when moving objects', type: 'checkbox', value: p.smartGuides, half: true },
        { key: 'greekBelow', label: 'Greek text below (points on screen; 0 = never)', type: 'number', min: 0, max: 24, value: p.greekBelow, half: true },
        { key: 'displayQuality', label: 'Picture display', type: 'select', options: [{ value: 'fast', label: 'Fast' }, { value: 'typical', label: 'Typical' }, { value: 'high', label: 'High quality' }], value: p.displayQuality, half: true },
        { key: 'h4', type: 'heading', label: 'Typing' },
        { key: 'typographerQuotes', label: 'Typographer\'s quotes', type: 'checkbox', value: p.typographerQuotes, half: true },
        { key: 'autoLists', label: 'Automatic bulleted and numbered lists', type: 'checkbox', value: p.autoLists, half: true },
        { key: 'autoCorrect', label: 'AutoCorrect as you type', type: 'checkbox', value: p.autoCorrect, half: true },
        { key: 'autoCapitalize', label: 'Capitalize the first letter of sentences', type: 'checkbox', value: p.autoCapitalize, half: true },
        { key: 'h5', type: 'heading', label: 'Save and Proofing' },
        { key: 'autosave', label: 'AutoSave drafts', type: 'checkbox', value: p.autosave, half: true },
        { key: 'autosaveSeconds', label: 'Every (seconds)', type: 'number', value: p.autosaveSeconds, half: true },
        { key: 'confirmClose', label: 'Ask to save when closing', type: 'checkbox', value: p.confirmClose, half: true },
        { key: 'spellcheck', label: 'Check spelling as you type', type: 'checkbox', value: p.spellcheck, half: true },
        { key: 'spellDialect', label: 'English spelling', type: 'select', options: SPELL_DIALECTS, value: p.spellDialect || 'any', half: true },
        { key: 'h6', type: 'heading', label: 'Customize' },
        { key: 'bq', type: 'button', label: 'Customize Quick Access Bar…', onClick: () => app.exec('file.customizeQat') },
        { key: 'br', type: 'button', label: 'Customize Tabs (Ribbon)…', onClick: () => app.exec('file.customizeRibbon') },
        { key: 'bk', type: 'button', label: 'Customize Keyboard…', onClick: () => app.exec('file.customizeKeyboard') },
        { key: 'ba', type: 'button', label: 'AutoCorrect Options…', onClick: () => app.exec('file.autocorrectOptions') },
        { key: 'bx', type: 'button', label: 'Export / Import All Settings…', onClick: () => app.exec('file.exportSettings') },
      ] });
      if (!r) return;
      const size = PAGE_SIZES.find((s) => s.id === r.defaultPageSize) || PAGE_SIZES[0];
      const nu = UNITS[r.unit as keyof typeof UNITS] ? r.unit : p.unit;
      const m = Math.max(0, (+r.defaultMargin || 0) * u.pt);
      Object.assign(p, {
        author: r.author || 'Author', initials: r.initials || (r.author || 'A')[0], theme: r.theme, uiScale: parseFloat(r.uiScale), qatPosition: r.qatPosition, qatLabels: r.qatLabels,
        unit: nu, defaultPageSize: { w: size.w, h: size.h }, defaultFacing: !!r.defaultFacing, defaultColumns: Math.max(1, +r.defaultColumns || 1), defaultMargins: [m, m, m, m], defaultSaveFormat: r.defaultSaveFormat,
        snapToGuides: r.snapToGuides, snapToGrid: r.snapToGrid, gridSize: Math.max(2, Math.min(144, +r.gridSize || 12)), smartGuides: r.smartGuides, greekBelow: Math.max(0, +r.greekBelow || 0), displayQuality: r.displayQuality,
        typographerQuotes: r.typographerQuotes, autoLists: r.autoLists, autoCorrect: r.autoCorrect, autoCapitalize: r.autoCapitalize,
        autosave: r.autosave, autosaveSeconds: Math.max(3, +r.autosaveSeconds || 10), confirmClose: r.confirmClose, spellcheck: r.spellcheck, spellDialect: r.spellDialect,
      });
      app.savePrefs();
      app.ui.applyPrefs();
      app.tab.ui.layout();
    },
  },
  { id: 'file.customizeQat', label: 'Customize Quick Access Bar…', icon: 'tune', tab: 'Backstage', group: 'Options', popular: true, noRecord: true, run: (app) => app.ui.customizeQat() },
  { id: 'file.customizeRibbon', label: 'Customize Tabs…', icon: 'view_quilt', tab: 'Backstage', group: 'Options', noRecord: true, run: (app) => app.ui.customizeRibbon() },
  { id: 'file.customizeKeyboard', label: 'Customize Keyboard…', icon: 'keyboard', tab: 'Backstage', group: 'Options', noRecord: true, run: (app) => app.ui.customizeKeyboard() },
  {
    id: 'file.autocorrectOptions', label: 'AutoCorrect Options…', icon: 'auto_fix_normal', tab: 'Backstage', group: 'Options', noRecord: true,
    run: async (app) => {
      const r = await openDialog({ title: 'AutoCorrect', wide: true, fields: [
        { key: 'on', label: 'Replace text as you type', type: 'checkbox', value: app.prefs.autoCorrect },
        { key: 'caps', label: 'Capitalize the first letter of sentences', type: 'checkbox', value: app.prefs.autoCapitalize },
        { key: 'quotes', label: 'Typographer\'s quotes (“ ” ‘ ’) as you type', type: 'checkbox', value: app.prefs.typographerQuotes },
        { key: 'lists', label: 'Automatic bulleted and numbered lists', type: 'checkbox', value: app.prefs.autoLists },
        { key: 'list', label: 'Replacements (one per line: typo => correction)', type: 'textarea', rows: 12, value: Object.entries(app.prefs.replacements).map(([k, x]) => `${k} => ${x}`).join('\n') },
      ], buttons: [{ label: 'Reset to Defaults', onClick: (_v, ctl) => ctl.set('list', Object.entries(DEFAULT_REPLACEMENTS).map(([k, x]) => `${k} => ${x}`).join('\n')) }] });
      if (!r) return;
      app.prefs.autoCorrect = r.on; app.prefs.autoCapitalize = r.caps; app.prefs.autoLists = r.lists; app.prefs.typographerQuotes = r.quotes;
      app.prefs.replacements = Object.fromEntries(String(r.list).split('\n').map((l) => l.split('=>')).filter((x) => x.length === 2 && x[0].trim()).map(([k, x]) => [k.trim(), x.trim()]));
      app.savePrefs();
    },
  },
  {
    id: 'file.customDictionary', label: 'Custom Dictionary…', icon: 'book', tab: 'Backstage', group: 'Options', noRecord: true,
    run: async (app) => {
      const r = await openDialog({ title: 'Custom Dictionary', fields: [{ key: 'words', label: 'Words (one per line)', type: 'textarea', rows: 12, value: app.prefs.dictionary.join('\n') }, { key: 'ign', label: 'Ignored words (one per line)', type: 'textarea', rows: 4, value: app.prefs.ignoredWords.join('\n') }] });
      if (!r) return;
      app.prefs.dictionary = String(r.words).split('\n').map((w) => w.trim()).filter(Boolean);
      app.prefs.ignoredWords = String(r.ign).split('\n').map((w) => w.trim()).filter(Boolean);
      app.savePrefs();
    },
  },
  {
    id: 'file.exportSettings', label: 'Export / Import Settings…', icon: 'import_export', tab: 'Backstage', group: 'Options', noRecord: true,
    run: async (app) => {
      const r = await openDialog({ title: 'Settings Transfer', help: 'Copy this text to back up your Quick Access Bar, custom tabs, shortcuts, macros, AutoCorrect and preferences. Paste settings text here and choose Import to restore. The format is shared with the other Quill apps; settings that do not apply to QuillPress are ignored.', fields: [{ key: 'json', label: 'Settings (JSON)', type: 'textarea', rows: 12, value: JSON.stringify({ ...app.prefs, recent: [] }, null, 1) }], ok: 'Import', buttons: [{ label: 'Copy', onClick: (x) => { navigator.clipboard?.writeText(x.json); toast('Copied'); } }] });
      if (!r) return;
      let p: unknown;
      try { p = JSON.parse(r.json); } catch { /* reported below */ }
      if (!p || typeof p !== 'object' || Array.isArray(p)) { toast('That is not valid settings JSON.'); return; }
      const before = JSON.parse(JSON.stringify(app.prefs));
      Object.assign(app.prefs, sanitizePrefs(p), { recent: app.prefs.recent });
      try { app.ui.applyPrefs(); app.ui.rebuild(); } catch (e: any) {
        Object.assign(app.prefs, before); app.ui.applyPrefs(); app.ui.rebuild();
        toast(`These settings could not be applied: ${e?.message || e}`);
        return;
      }
      app.savePrefs();
      toast('Settings imported');
    },
  },
  { id: 'file.resetCustomizations', label: 'Reset All Customizations', icon: 'restart_alt', tab: 'Backstage', group: 'Options', noRecord: true, run: async (app) => { if (!(await confirmDialog('Reset', 'Reset the Quick Access Bar, custom tabs and keyboard shortcuts to defaults?'))) return; const { DEFAULT_QAT } = await import('../prefs'); app.prefs.qat = [...DEFAULT_QAT]; app.prefs.customTabs = []; app.prefs.hiddenTabs = []; app.prefs.tabOrder = []; app.prefs.keymap = {}; app.savePrefs(); app.ui.rebuild(); } },
]);
