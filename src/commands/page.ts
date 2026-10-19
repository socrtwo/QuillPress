/** Page Design tab: pages, page setup, master pages, guides and grids, numbering, schemes and swatches. */
import { def, type MenuEntry } from './registry';
import type { App } from '../app';
import type { Guide, Master, NumScheme, Page, Section, Swatch } from '../model/types';
import { PAGE_SIZES, UNITS } from '../model/types';
import { clone, newId, reId } from '../model/pub';
import { COLOR_SCHEMES, FONT_SCHEMES, applyColorScheme, applyFontScheme, colorHex, hexToCmyk, cmykToHex } from '../model/styles';
import { addPageAfter } from '../edit/flowOps';
import { editPages, edit, selection, detachStory, unlinkFrame } from '../edit/ops';
import { openDialog, toast, confirmDialog, promptDialog, colorMenu } from '../ui/dialog';
import { TEMPLATES } from '../templates';

const u = (app: App) => UNITS[app.prefs.unit];
const toU = (app: App, pt: number) => +(pt / u(app).pt).toFixed(u(app).digits);
const fromU = (app: App, v: any) => Math.max(0, (+v || 0) * u(app).pt);

const NUM_OPTIONS: { value: NumScheme | 'none'; label: string }[] = [
  { value: 'arabicPlain', label: '1, 2, 3' }, { value: 'romanLcPeriod', label: 'i, ii, iii' }, { value: 'romanUcPeriod', label: 'I, II, III' }, { value: 'alphaLcPeriod', label: 'a, b, c' }, { value: 'alphaUcPeriod', label: 'A, B, C' }, { value: 'none', label: 'No number' },
];

function goTo(app: App, p: Page | undefined): void { if (p) app.goToPage(p.id); }

function insertPages(app: App, count: number, before = false, master?: string): void {
  const pub = app.pub;
  const cur = app.page;
  let first: Page | undefined;
  pub.transact(count > 1 ? 'Insert Pages' : 'Insert Page', () => {
    let after: Page | undefined = cur;
    if (before && cur) { const i = pub.pageIndex(cur.id); after = i > 0 ? pub.pages[i - 1] : undefined; }
    for (let k = 0; k < count; k++) {
      const p = before && !after && k === 0 ? (() => { const np: Page = { id: newId('pg'), master: master || cur?.master || pub.data.masters[0].id, items: [] }; pub.data.pages.unshift(np); return np; })() : addPageAfter(pub, after);
      if (master) p.master = master;
      first ||= p;
      after = p;
    }
  });
  goTo(app, first);
}

/** Enters master editing for the given master (or the current page's). */
export function editMaster(app: App, id?: string): void {
  const t = app.tab;
  if (t.ui.editingText) t.ui.commitText();
  const m = id ? app.pub.master(id) : app.page ? app.pub.masterOf(app.page) : app.pub.data.masters[0];
  t.masterTarget = m.id;
  t.ui.select([]);
  t.ui.layout();
  app.ui.currentTab = 'masterPage';
  app.ui.renderTabs();
  app.ui.renderRibbon();
  app.refresh();
}

export function closeMaster(app: App): void {
  const t = app.tab;
  if (!t.masterTarget) return;
  if (t.ui.editingText) t.ui.commitText();
  t.masterTarget = '';
  t.ui.select([]);
  t.ui.layout();
  if (app.ui.currentTab === 'masterPage') app.ui.currentTab = 'pageDesign';
  app.ui.renderTabs();
  app.ui.renderRibbon();
  app.refresh();
}

function nextMasterName(app: App): string {
  const used = new Set(app.pub.data.masters.map((m) => m.name));
  for (let i = 0; i < 26; i++) { const n = `${String.fromCharCode(65 + i)}-Master`; if (!used.has(n)) return n; }
  return `Master ${app.pub.data.masters.length + 1}`;
}

async function swatchDialog(app: App, sw?: Swatch): Promise<Swatch | null> {
  const names = app.pub.data.swatches.map((s) => s.name).filter((n) => n !== sw?.name);
  const hex = sw ? colorHex(app.pub.data, sw.color, '#000000') : '#5B3C9E';
  const cmyk = sw?.cmyk || hexToCmyk(hex);
  const r = await openDialog({ title: sw ? `Swatch: ${sw.name}` : 'New Swatch', fields: [
    { key: 'name', label: 'Name', type: 'text', value: sw?.name || `Swatch ${app.pub.data.swatches.length + 1}` },
    { key: 'mode', label: 'Define by', type: 'radio', options: [{ value: 'rgb', label: 'RGB (hex)' }, { value: 'cmyk', label: 'CMYK (process)' }], value: sw?.cmyk && !sw.spot ? 'cmyk' : 'rgb' },
    { key: 'hex', label: 'Color', type: 'color', value: hex, visibleIf: (v) => v.mode === 'rgb' },
    { key: 'c', label: 'C %', type: 'number', min: 0, max: 100, value: cmyk[0], half: true, visibleIf: (v) => v.mode === 'cmyk' }, { key: 'm', label: 'M %', type: 'number', min: 0, max: 100, value: cmyk[1], half: true, visibleIf: (v) => v.mode === 'cmyk' },
    { key: 'y', label: 'Y %', type: 'number', min: 0, max: 100, value: cmyk[2], half: true, visibleIf: (v) => v.mode === 'cmyk' }, { key: 'k', label: 'K %', type: 'number', min: 0, max: 100, value: cmyk[3], half: true, visibleIf: (v) => v.mode === 'cmyk' },
    { key: 'spot', label: 'Spot color (named ink; kept as a name in exports)', type: 'checkbox', value: !!sw?.spot },
  ], validate: (v) => (!v.name?.trim() ? 'Give the swatch a name.' : names.includes(v.name.trim()) ? 'A swatch with that name exists.' : null) });
  if (!r) return null;
  const color = r.mode === 'cmyk' ? cmykToHex(+r.c, +r.m, +r.y, +r.k) : r.hex;
  return { name: r.name.trim(), color, cmyk: r.mode === 'cmyk' ? [+r.c, +r.m, +r.y, +r.k] : hexToCmyk(color), spot: r.spot || undefined };
}

/** Renames a swatch everywhere it is used (fills, lines, text colors, rules). */
function renameSwatch(app: App, from: string, to: string): void {
  const fix = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(fix); return; }
    for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string' && (k === 'color' || k === 'fg' || k === 'bg') && v === from) o[k] = to; else if (typeof v === 'object') fix(v); }
  };
  fix(app.pub.data.pages); fix(app.pub.data.masters); fix(app.pub.data.stories); fix(app.pub.data.styles);
}

const sectionAt = (app: App, index: number): Section | undefined => [...app.pub.data.sections].sort((a, b) => a.start - b.start).filter((s) => s.start <= index).pop();

def([
  {
    id: 'page.insert', label: 'Insert Page', icon: 'add_box', tab: 'Page Design', group: 'Pages', keys: ['Mod-Shift-p'], popular: true, edits: true,
    tip: 'A new page after the current one, on the same master',
    run: (app, master?: string) => insertPages(app, 1, false, typeof master === 'string' ? master : undefined),
  },
  { id: 'page.insertBefore', label: 'Insert Page Before', icon: 'add_box', tab: 'Page Design', group: 'Pages', edits: true, run: (app) => insertPages(app, 1, true) },
  {
    id: 'page.insertMany', label: 'Insert Pages…', icon: 'library_add', tab: 'Page Design', group: 'Pages', edits: true,
    run: async (app) => {
      const r = await openDialog({ title: 'Insert Pages', fields: [{ key: 'n', label: 'Number of pages', type: 'number', min: 1, max: 500, value: 1, half: true }, { key: 'where', label: 'Place', type: 'select', options: [{ value: 'after', label: 'After the current page' }, { value: 'before', label: 'Before the current page' }, { value: 'end', label: 'At the end' }], value: 'after', half: true }, { key: 'master', label: 'Master page', type: 'select', options: app.pub.data.masters.map((m) => ({ value: m.id, label: m.name })), value: app.page?.master || app.pub.data.masters[0].id }] });
      if (!r) return;
      if (r.where === 'end') { const last = app.pub.pages[app.pub.pages.length - 1]; app.goToPage(last.id); }
      insertPages(app, Math.max(1, +r.n || 1), r.where === 'before', r.master);
    },
  },
  {
    id: 'page.delete', label: 'Delete Page', icon: 'delete', tab: 'Page Design', group: 'Pages', edits: true,
    tip: 'Delete the selected pages (text flows on into the remaining frames of each story)',
    run: async (app, id?: string) => {
      const pub = app.pub;
      const pages = id ? [pub.page(id)!].filter(Boolean) : app.targetPages();
      if (!pages.length) return;
      if (pages.length >= pub.pages.length) { toast('A publication keeps at least one page.'); return; }
      const items = pages.reduce((a, p) => a + p.items.length, 0);
      if (items && !(await confirmDialog('Delete Page', `Delete ${pages.length} page(s) with ${items} object(s)?`, 'Delete'))) return;
      const i = pub.pageIndex(pages[0].id);
      pub.transact(pages.length > 1 ? 'Delete Pages' : 'Delete Page', () => {
        const ids = new Set(pages.map((p) => p.id));
        for (const p of pages) for (const e of p.items) unlinkFrame(app, e);
        pub.data.pages = pub.data.pages.filter((p) => !ids.has(p.id));
        for (const s of pub.data.sections) if (s.start >= pub.pages.length) s.start = Math.max(0, pub.pages.length - 1);
        pub.pruneStories();
      });
      goTo(app, pub.pages[Math.min(i, pub.pages.length - 1)]);
    },
  },
  {
    id: 'page.duplicate', label: 'Duplicate Page', icon: 'control_point_duplicate', tab: 'Page Design', group: 'Pages', edits: true,
    tip: 'A copy of the selected pages after them (text frames get their own copies of the stories)',
    run: (app) => {
      const pub = app.pub;
      const pages = app.targetPages();
      if (!pages.length) return;
      let first: Page | undefined;
      pub.transact('Duplicate Page', () => {
        const at = pub.pageIndex(pages[pages.length - 1].id) + 1;
        pages.forEach((p, k) => {
          const copy: Page = { ...clone(p), id: newId('pg'), comments: [], items: p.items.map((e) => { const c = reId(e); detachStory(app, c); return c; }) };
          pub.data.pages.splice(at + k, 0, copy);
          first ||= copy;
        });
      });
      goTo(app, first);
    },
  },
  {
    id: 'page.move', label: 'Move Page…', icon: 'low_priority', tab: 'Page Design', group: 'Pages', edits: true,
    run: async (app) => {
      const pub = app.pub;
      const cur = app.page; if (!cur) return;
      const r = await openDialog({ title: 'Move Page', fields: [{ key: 'to', label: `Move page ${pub.pageIndex(cur.id) + 1} to position`, type: 'number', min: 1, max: pub.pages.length, value: pub.pageIndex(cur.id) + 1 }] });
      if (!r) return;
      const target = pub.pages[Math.max(0, Math.min(pub.pages.length - 1, +r.to - 1))];
      app.exec('page.moveTo', { id: cur.id, target: target.id, before: +r.to - 1 < pub.pageIndex(cur.id) });
    },
  },
  {
    id: 'page.moveTo', label: 'Move Page To', icon: 'low_priority', tab: 'Page Design', group: 'Pages', internal: true, edits: true,
    run: (app, arg: { id: string; target: string; before?: boolean }) => {
      const pub = app.pub;
      const moving = app.tab.pageSel.includes(arg.id) ? app.targetPages() : [pub.page(arg.id)!].filter(Boolean);
      if (!moving.length || moving.some((p) => p.id === arg.target)) return;
      pub.transact('Move Page', () => {
        const ids = new Set(moving.map((p) => p.id));
        const rest = pub.data.pages.filter((p) => !ids.has(p.id));
        let i = rest.findIndex((p) => p.id === arg.target);
        if (i < 0) i = rest.length; else if (!arg.before) i++;
        rest.splice(i, 0, ...moving);
        pub.data.pages = rest;
      });
      app.tab.ui.showPage(moving[0].id);
    },
  },
  { id: 'page.moveUp', label: 'Move Page Up', icon: 'arrow_upward', tab: 'Page Design', group: 'Pages', keys: ['Mod-Alt-ArrowUp'], edits: true, run: (app) => { const p = app.page; if (!p) return; const i = app.pub.pageIndex(p.id); if (i > 0) app.exec('page.moveTo', { id: p.id, target: app.pub.pages[i - 1].id, before: true }); } },
  { id: 'page.moveDown', label: 'Move Page Down', icon: 'arrow_downward', tab: 'Page Design', group: 'Pages', keys: ['Mod-Alt-ArrowDown'], edits: true, run: (app) => { const p = app.page; if (!p) return; const i = app.pub.pageIndex(p.id); if (i < app.pub.pages.length - 1) app.exec('page.moveTo', { id: p.id, target: app.pub.pages[i + 1].id, before: false }); } },
  {
    id: 'page.rename', label: 'Name Page…', icon: 'edit', tab: 'Page Design', group: 'Pages', edits: true,
    tip: 'A name for the page in the Pages pane and Navigator (page numbers come from sections)',
    run: async (app) => { const p = app.page; if (!p) return; const n = await promptDialog('Name Page', 'Name', p.name || ''); if (n == null) return; app.pub.transact('Name Page', () => { p.name = n.trim() || undefined; }, [p.id]); },
  },
  {
    id: 'page.notes', label: 'Page Notes…', icon: 'sticky_note_2', tab: 'Page Design', group: 'Pages', edits: true,
    tip: 'Production notes for this page (not printed)',
    run: async (app) => { const p = app.page; if (!p) return; const r = await openDialog({ title: 'Page Notes', fields: [{ key: 'n', label: 'Notes', type: 'textarea', rows: 8, value: p.notes || '' }] }); if (!r) return; app.pub.transact('Page Notes', () => { p.notes = String(r.n).trim() || undefined; }, [p.id]); },
  },
  {
    id: 'page.goTo', label: 'Go to Page…', icon: 'my_location', tab: 'Navigation', group: 'Pages', keys: ['Mod-g'], noRecord: true,
    run: async (app, id?: string) => {
      if (id && app.pub.page(id)) { app.goToPage(id); return; }
      const n = await promptDialog('Go to Page', `Page number (1–${app.pub.pages.length}) or label`, String(app.pub.pageIndex(app.tab.current) + 1));
      if (n == null) return;
      const i = app.pub.pages.findIndex((_, k) => app.pub.pageLabel(k) === n.trim());
      const p = i >= 0 ? app.pub.pages[i] : app.pub.pages[Math.max(0, Math.min(app.pub.pages.length - 1, (+n || 1) - 1))];
      goTo(app, p);
    },
  },
  { id: 'page.next', label: 'Next Page', icon: 'navigate_next', tab: 'Navigation', group: 'Pages', keys: ['PageDown', 'Shift-PageDown'], noRecord: true, run: (app) => goTo(app, app.pub.pages[Math.min(app.pub.pages.length - 1, app.pub.pageIndex(app.tab.current) + 1)]) },
  { id: 'page.prev', label: 'Previous Page', icon: 'navigate_before', tab: 'Navigation', group: 'Pages', keys: ['PageUp', 'Shift-PageUp'], noRecord: true, run: (app) => goTo(app, app.pub.pages[Math.max(0, app.pub.pageIndex(app.tab.current) - 1)]) },
  { id: 'page.first', label: 'First Page', icon: 'first_page', tab: 'Navigation', group: 'Pages', keys: ['Mod-Home'], noRecord: true, run: (app) => goTo(app, app.pub.pages[0]) },
  { id: 'page.last', label: 'Last Page', icon: 'last_page', tab: 'Navigation', group: 'Pages', keys: ['Mod-End'], noRecord: true, run: (app) => goTo(app, app.pub.pages[app.pub.pages.length - 1]) },
  { id: 'page.nextSpread', label: 'Next Spread', icon: 'keyboard_double_arrow_right', tab: 'Navigation', group: 'Pages', keys: ['Alt-PageDown'], noRecord: true, run: (app) => goTo(app, app.pub.pages[Math.min(app.pub.pages.length - 1, app.pub.pageIndex(app.tab.current) + 2)]) },
  { id: 'page.prevSpread', label: 'Previous Spread', icon: 'keyboard_double_arrow_left', tab: 'Navigation', group: 'Pages', keys: ['Alt-PageUp'], noRecord: true, run: (app) => goTo(app, app.pub.pages[Math.max(0, app.pub.pageIndex(app.tab.current) - 2)]) },
]);

// Page setup --------------------------------------------------------------------------------

function setPageSize(app: App, w: number, h: number): void {
  const pub = app.pub;
  pub.transact('Page Size', () => {
    const sx = w / pub.size.w, sy = h / pub.size.h;
    pub.data.size = { w, h };
    // Items keep their distance from the top-left corner; frames filling the margins stretch.
    const stretch = (items: any[], mw: number, mh: number) => { for (const e of items) { if (e.kind === 'text' && Math.abs(e.x + e.w - mw) < 2 && Math.abs(e.y + e.h - mh) < 2) { e.w = Math.max(10, e.w * sx); e.h = Math.max(10, e.h * sy); } } };
    for (const m of pub.data.masters) stretch(m.items, pub.size.w / sx, pub.size.h / sy);
    for (const p of pub.pages) stretch(p.items, pub.size.w / sx, pub.size.h / sy);
  });
  app.tab.ui.layout();
}

def([
  {
    id: 'page.size', label: 'Page Size', icon: 'crop_free', tab: 'Page Design', group: 'Page Setup', kind: 'menu', edits: true,
    menu: (app) => [...PAGE_SIZES.map((s) => ({ id: 'page.size', arg: s.id, label: s.label, checked: Math.abs(app.pub.size.w - s.w) < 0.5 && Math.abs(app.pub.size.h - s.h) < 0.5 || Math.abs(app.pub.size.h - s.w) < 0.5 && Math.abs(app.pub.size.w - s.h) < 0.5 })), { separator: true }, { id: 'page.size', arg: 'custom', label: 'Custom Size…' }],
    run: async (app, id?: string) => {
      const pub = app.pub;
      const s = PAGE_SIZES.find((x) => x.id === id);
      if (s) { const land = pub.size.w > pub.size.h; setPageSize(app, land ? Math.max(s.w, s.h) : Math.min(s.w, s.h), land ? Math.min(s.w, s.h) : Math.max(s.w, s.h)); return; }
      const r = await openDialog({ title: 'Custom Page Size', fields: [{ key: 'w', label: `Width (${u(app).label})`, type: 'number', min: 0.1, value: toU(app, pub.size.w), half: true }, { key: 'h', label: `Height (${u(app).label})`, type: 'number', min: 0.1, value: toU(app, pub.size.h), half: true }] });
      if (!r) return;
      setPageSize(app, Math.max(36, fromU(app, r.w)), Math.max(36, fromU(app, r.h)));
    },
  },
  {
    id: 'page.orientation', label: 'Orientation', icon: 'screen_rotation', tab: 'Page Design', group: 'Page Setup', kind: 'menu', edits: true,
    menu: (app) => [{ id: 'page.orientation', arg: 'p', label: 'Portrait', checked: app.pub.size.h >= app.pub.size.w }, { id: 'page.orientation', arg: 'l', label: 'Landscape', checked: app.pub.size.w > app.pub.size.h }],
    run: (app, o?: 'p' | 'l') => { const { w, h } = app.pub.size; const want = o || (w > h ? 'p' : 'l'); if ((want === 'l') === (w > h)) return; setPageSize(app, h, w); },
  },
  {
    id: 'page.margins', label: 'Margins', icon: 'margin', tab: 'Page Design', group: 'Page Setup', kind: 'menu', edits: true,
    tip: 'Margins of the master (or of the selected pages only)',
    menu: (app) => [...[[36, 'Normal (0.5 in)'], [72, 'Wide (1 in)'], [18, 'Narrow (0.25 in)'], [0, 'None']].map(([v, l]) => ({ id: 'page.margins', arg: v, label: l as string, checked: app.page ? app.pub.geometry(app.page).margins.every((m) => m === v) : false })), { separator: true }, { id: 'page.margins', arg: 'dialog', label: 'Custom Margins…' }],
    run: async (app, arg?: number | string) => {
      const pub = app.pub;
      const owner = app.owner; if (!owner) return;
      const cur = 'master' in owner ? pub.geometry(owner).margins : owner.margins;
      let m: [number, number, number, number];
      let where = 'master';
      if (typeof arg === 'number') m = [arg, arg, arg, arg];
      else {
        const r = await openDialog({ title: 'Margins', fields: [
          { key: 't', label: `Top (${u(app).label})`, type: 'number', min: 0, value: toU(app, cur[0]), half: true }, { key: 'b', label: `Bottom (${u(app).label})`, type: 'number', min: 0, value: toU(app, cur[2]), half: true },
          { key: 'l', label: `${pub.data.facing ? 'Inside' : 'Left'} (${u(app).label})`, type: 'number', min: 0, value: toU(app, cur[3]), half: true }, { key: 'r', label: `${pub.data.facing ? 'Outside' : 'Right'} (${u(app).label})`, type: 'number', min: 0, value: toU(app, cur[1]), half: true },
          ...('master' in owner ? [{ key: 'where', label: 'Apply to', type: 'radio' as const, options: [{ value: 'master', label: `The master (${pub.masterOf(owner).name}) and every page using it` }, { value: 'pages', label: 'The selected pages only' }], value: 'master' }] : []),
        ] });
        if (!r) return;
        m = [fromU(app, r.t), fromU(app, r.r), fromU(app, r.b), fromU(app, r.l)];
        where = r.where || 'master';
      }
      if ('master' in owner && where === 'pages') { editPages(app, 'Margins', (p) => { p.margins = m; }); return; }
      const master = 'master' in owner ? pub.masterOf(owner) : owner;
      pub.transact('Margins', () => { master.margins = m; for (const p of pub.pages) if (p.master === master.id) delete p.margins; });
    },
  },
  {
    id: 'page.columns', label: 'Columns', icon: 'view_column', tab: 'Page Design', group: 'Page Setup', kind: 'menu', edits: true,
    tip: 'Column guides of the master (new text frames placed over the margins use them)',
    menu: (app) => [...[1, 2, 3, 4, 5, 6].map((n) => ({ id: 'page.columns', arg: n, label: `${n} column${n > 1 ? 's' : ''}`, checked: app.page ? app.pub.geometry(app.page).columns === n : false })), { separator: true }, { id: 'page.columns', arg: 'dialog', label: 'Columns and Gutter…' }],
    run: async (app, arg?: number | string) => {
      const pub = app.pub;
      const owner = app.owner; if (!owner) return;
      const g = 'master' in owner ? pub.geometry(owner) : owner;
      let cols = typeof arg === 'number' ? arg : g.columns, gutter = g.gutter, where = 'master';
      if (typeof arg !== 'number') {
        const r = await openDialog({ title: 'Columns', fields: [{ key: 'c', label: 'Columns', type: 'number', min: 1, max: 20, value: g.columns, half: true }, { key: 'g', label: `Gutter (${u(app).label})`, type: 'number', min: 0, value: toU(app, g.gutter), half: true }, ...('master' in owner ? [{ key: 'where', label: 'Apply to', type: 'radio' as const, options: [{ value: 'master', label: 'The master and every page using it' }, { value: 'pages', label: 'The selected pages only' }, { value: 'frames', label: 'The selected text frames' }], value: selection(app).some((e) => e.kind === 'text') ? 'frames' : 'master' }] : []) ] });
        if (!r) return;
        cols = Math.max(1, +r.c || 1); gutter = fromU(app, r.g); where = r.where || 'master';
      }
      if (where === 'frames') { app.exec('text.columns', { columns: cols, gutter }); return; }
      if ('master' in owner && where === 'pages') { editPages(app, 'Columns', (p) => { p.columns = cols; p.gutter = gutter; }); return; }
      const master = 'master' in owner ? pub.masterOf(owner) : owner;
      pub.transact('Columns', () => { master.columns = cols; master.gutter = gutter; for (const p of pub.pages) if (p.master === master.id) { delete p.columns; delete p.gutter; } });
    },
  },
  {
    id: 'page.bleed', label: 'Bleed', icon: 'select_all', tab: 'Page Design', group: 'Page Setup', edits: true, origin: 'Bleed and slug (prepress)',
    tip: 'Extra area outside the page edge that is trimmed off after printing; pictures and colors that run to the edge should extend into it',
    run: async (app) => {
      const r = await openDialog({ title: 'Bleed', fields: [{ key: 'b', label: `Bleed on each side (${u(app).label})`, type: 'number', min: 0, value: toU(app, app.pub.data.bleed) }], help: 'Printers commonly ask for 0.125 in (3 mm). The bleed area shows as a red line around the page; PDF export can include it with crop marks.' });
      if (!r) return;
      app.pub.transact('Bleed', () => { app.pub.data.bleed = fromU(app, r.b); });
      app.tab.ui.layout();
    },
  },
  {
    id: 'page.facing', label: 'Facing Pages', icon: 'auto_stories', tab: 'Page Design', group: 'Page Setup', kind: 'toggle', edits: true,
    tip: 'Lay out pages in left/right spreads with inside and outside margins',
    isActive: (app) => !!app.pub?.data.facing,
    run: (app) => { app.pub.transact('Facing Pages', () => { app.pub.data.facing = !app.pub.data.facing; }); if (!app.pub.data.facing && app.tab.view === 'spread') app.exec('view.single'); app.tab.ui.layout(); },
  },
  {
    id: 'page.setupDialog', label: 'Page Setup…', icon: 'settings', tab: 'Page Design', group: 'Page Setup', keys: ['Mod-Alt-p'], edits: true,
    run: async (app) => {
      const pub = app.pub;
      const m = pub.data.masters[0];
      const cur = PAGE_SIZES.find((s) => Math.abs(Math.min(s.w, s.h) - Math.min(pub.size.w, pub.size.h)) < 0.5 && Math.abs(Math.max(s.w, s.h) - Math.max(pub.size.w, pub.size.h)) < 0.5)?.id || 'custom';
      const r = await openDialog({ title: 'Page Setup', wide: true, fields: [
        { key: 'size', label: 'Page size', type: 'select', options: [...PAGE_SIZES.map((s) => ({ value: s.id, label: s.label })), { value: 'custom', label: 'Custom' }], value: cur, half: true },
        { key: 'orient', label: 'Orientation', type: 'select', options: [{ value: 'p', label: 'Portrait' }, { value: 'l', label: 'Landscape' }], value: pub.size.w > pub.size.h ? 'l' : 'p', half: true },
        { key: 'w', label: `Width (${u(app).label})`, type: 'number', min: 0.1, value: toU(app, pub.size.w), half: true, visibleIf: (v) => v.size === 'custom' }, { key: 'h', label: `Height (${u(app).label})`, type: 'number', min: 0.1, value: toU(app, pub.size.h), half: true, visibleIf: (v) => v.size === 'custom' },
        { key: 'facing', label: 'Facing pages', type: 'checkbox', value: pub.data.facing, half: true }, { key: 'bleed', label: `Bleed (${u(app).label})`, type: 'number', min: 0, value: toU(app, pub.data.bleed), half: true },
        { key: 'h1', type: 'heading', label: `Margins and columns of ${m.name}` },
        { key: 't', label: 'Top', type: 'number', min: 0, value: toU(app, m.margins[0]), half: true }, { key: 'b', label: 'Bottom', type: 'number', min: 0, value: toU(app, m.margins[2]), half: true },
        { key: 'l', label: pub.data.facing ? 'Inside' : 'Left', type: 'number', min: 0, value: toU(app, m.margins[3]), half: true }, { key: 'r', label: pub.data.facing ? 'Outside' : 'Right', type: 'number', min: 0, value: toU(app, m.margins[1]), half: true },
        { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 20, value: m.columns, half: true }, { key: 'gutter', label: 'Gutter', type: 'number', min: 0, value: toU(app, m.gutter), half: true },
      ] });
      if (!r) return;
      const s = PAGE_SIZES.find((x) => x.id === r.size);
      let w = s ? s.w : fromU(app, r.w), h = s ? s.h : fromU(app, r.h);
      if (r.orient === 'l' ? w < h : w > h) [w, h] = [h, w];
      pub.transact('Page Setup', () => {
        pub.data.facing = !!r.facing; pub.data.bleed = fromU(app, r.bleed);
        m.margins = [fromU(app, r.t), fromU(app, r.r), fromU(app, r.b), fromU(app, r.l)]; m.columns = Math.max(1, +r.cols || 1); m.gutter = fromU(app, r.gutter);
      });
      if (w !== pub.size.w || h !== pub.size.h) setPageSize(app, w, h); else app.tab.ui.layout();
    },
  },
]);

// Masters -----------------------------------------------------------------------------------

def([
  {
    id: 'page.editMaster', label: 'Edit Master Page', icon: 'dashboard_customize', tab: 'Page Design', group: 'Master Pages', kind: 'menu', keys: ['Mod-Shift-m'], popular: true, noRecord: true,
    tip: 'Edit the items every page built on this master shares (folios, running heads, rules)',
    menu: (app) => [...app.pub.data.masters.map((m) => ({ id: 'page.editMaster', arg: m.id, label: m.name, checked: app.tab.masterTarget === m.id })), { separator: true }, { id: 'page.newMaster', label: 'New Master…', icon: 'add' }],
    isActive: (app) => !!app.tab?.masterTarget,
    run: (app, id?: string) => editMaster(app, typeof id === 'string' ? id : undefined),
  },
  { id: 'page.closeMaster', label: 'Close Master Page', icon: 'close', tab: 'Page Design', group: 'Master Pages', noRecord: true, isEnabled: (app) => !!app.tab?.masterTarget, run: (app) => closeMaster(app) },
  {
    id: 'page.applyMaster', label: 'Apply Master', icon: 'dashboard', tab: 'Page Design', group: 'Master Pages', kind: 'menu', edits: true,
    tip: 'Apply a master to the selected pages',
    menu: (app) => [...app.pub.data.masters.map((m) => ({ id: 'page.applyMaster', arg: m.id, label: m.name, checked: app.page?.master === m.id })), { id: 'page.applyMaster', arg: '', label: '[None]' }],
    run: async (app, id?: string) => {
      const pub = app.pub;
      if (id === undefined) { const r = await openDialog({ title: 'Apply Master', fields: [{ key: 'm', label: 'Master', type: 'select', options: pub.data.masters.map((m) => ({ value: m.id, label: m.name })), value: app.page?.master }] }); if (!r) return; id = r.m; }
      const m = pub.data.masters.find((x) => x.id === id);
      editPages(app, 'Apply Master', (p) => { p.master = m ? m.id : pub.data.masters[0].id; p.hideMasterItems = m ? undefined : true; });
    },
  },
  { id: 'page.applyMasterAll', label: 'Apply Master to All Pages', icon: 'dashboard', tab: 'Page Design', group: 'Master Pages', edits: true, run: (app) => { const m = app.tab.masterTarget || app.page?.master; if (!m) return; app.pub.transact('Apply Master to All', () => { for (const p of app.pub.pages) p.master = m; }); } },
  {
    id: 'page.newMaster', label: 'New Master…', icon: 'add', tab: 'Page Design', group: 'Master Pages', edits: true,
    run: async (app) => {
      const pub = app.pub;
      const base = app.tab.masterTarget ? pub.master(app.tab.masterTarget) : app.page ? pub.masterOf(app.page) : pub.data.masters[0];
      const r = await openDialog({ title: 'New Master', fields: [{ key: 'name', label: 'Name', type: 'text', value: nextMasterName(app) }, { key: 'basedOn', label: 'Based on', type: 'select', options: [{ value: '', label: '[None] — blank, same margins' }, ...pub.data.masters.map((m) => ({ value: m.id, label: m.name }))], value: '' }, { key: 'side', label: 'Side', type: 'select', options: [{ value: 'single', label: 'Any page' }, { value: 'left', label: 'Left-hand pages' }, { value: 'right', label: 'Right-hand pages' }], value: 'single', visibleIf: () => pub.data.facing }] });
      if (!r?.name) return;
      const src = pub.data.masters.find((m) => m.id === r.basedOn);
      const m: Master = { id: newId('mst'), name: r.name, items: src ? src.items.map((e) => { const c = reId(e); detachStory(app, c); return c; }) : [], margins: [...base.margins] as any, columns: base.columns, gutter: base.gutter, side: r.side || 'single', basedOn: src?.id, guides: src?.guides ? clone(src.guides) : undefined };
      pub.transact('New Master', () => { pub.data.masters.push(m); });
      editMaster(app, m.id);
    },
  },
  {
    id: 'page.duplicateMaster', label: 'Duplicate Master', icon: 'content_copy', tab: 'Page Design', group: 'Master Pages', edits: true,
    run: (app, id?: string) => {
      const pub = app.pub;
      const src = pub.master(id || app.tab.masterTarget || app.page?.master || '');
      const m: Master = { ...clone(src), id: newId('mst'), name: nextMasterName(app), items: src.items.map((e) => { const c = reId(e); detachStory(app, c); return c; }) };
      pub.transact('Duplicate Master', () => { pub.data.masters.push(m); });
      editMaster(app, m.id);
    },
  },
  {
    id: 'page.renameMaster', label: 'Rename Master…', icon: 'edit', tab: 'Page Design', group: 'Master Pages', edits: true,
    run: async (app, id?: string) => { const m = app.pub.master(id || app.tab.masterTarget || app.page?.master || ''); const n = await promptDialog('Rename Master', 'Name', m.name); if (n?.trim()) app.pub.transact('Rename Master', () => { m.name = n.trim(); }); },
  },
  {
    id: 'page.deleteMaster', label: 'Delete Master…', icon: 'delete', tab: 'Page Design', group: 'Master Pages', edits: true,
    run: async (app, id?: string) => {
      const pub = app.pub;
      const m = pub.master(id || app.tab.masterTarget || app.page?.master || '');
      if (pub.data.masters.length < 2) { toast('A publication keeps at least one master page.'); return; }
      const others = pub.data.masters.filter((x) => x !== m);
      const r = await openDialog({ title: 'Delete Master', fields: [{ key: 'to', label: `Pages using "${m.name}" change to`, type: 'select', options: others.map((x) => ({ value: x.id, label: x.name })), value: others[0].id }], ok: 'Delete' });
      if (!r) return;
      pub.transact('Delete Master', () => { pub.data.masters = others; for (const p of pub.pages) if (p.master === m.id) p.master = r.to; for (const x of others) if (x.basedOn === m.id) delete x.basedOn; });
      if (app.tab.masterTarget === m.id) closeMaster(app);
    },
  },
  {
    id: 'page.masterOptions', label: 'Master Options…', icon: 'tune', tab: 'Page Design', group: 'Master Pages', edits: true,
    run: async (app, id?: string) => {
      const pub = app.pub;
      const m = pub.master(id || app.tab.masterTarget || app.page?.master || '');
      const r = await openDialog({ title: `Master Options: ${m.name}`, fields: [
        { key: 'name', label: 'Name', type: 'text', value: m.name, half: true },
        { key: 'side', label: 'Side', type: 'select', options: [{ value: 'single', label: 'Any page' }, { value: 'left', label: 'Left-hand pages' }, { value: 'right', label: 'Right-hand pages' }], value: m.side || 'single', half: true },
        { key: 'basedOn', label: 'Based on (its items show under this master\'s)', type: 'select', options: [{ value: '', label: '[None]' }, ...pub.data.masters.filter((x) => x !== m).map((x) => ({ value: x.id, label: x.name }))], value: m.basedOn || '' },
        { key: 't', label: `Top margin (${u(app).label})`, type: 'number', min: 0, value: toU(app, m.margins[0]), half: true }, { key: 'b', label: 'Bottom', type: 'number', min: 0, value: toU(app, m.margins[2]), half: true },
        { key: 'l', label: pub.data.facing ? 'Inside' : 'Left', type: 'number', min: 0, value: toU(app, m.margins[3]), half: true }, { key: 'r', label: pub.data.facing ? 'Outside' : 'Right', type: 'number', min: 0, value: toU(app, m.margins[1]), half: true },
        { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 20, value: m.columns, half: true }, { key: 'gutter', label: `Gutter (${u(app).label})`, type: 'number', min: 0, value: toU(app, m.gutter), half: true },
      ] });
      if (!r) return;
      pub.transact('Master Options', () => { m.name = r.name || m.name; m.side = r.side; m.basedOn = r.basedOn || undefined; m.margins = [fromU(app, r.t), fromU(app, r.r), fromU(app, r.b), fromU(app, r.l)]; m.columns = Math.max(1, +r.cols || 1); m.gutter = fromU(app, r.gutter); });
      app.tab.ui.layout();
    },
  },
  {
    id: 'page.hideMasterItems', label: 'Hide Master Items', icon: 'visibility_off', tab: 'Page Design', group: 'Master Pages', kind: 'toggle', edits: true,
    tip: 'Hide the master page\'s items on the selected pages',
    isActive: (app) => !!app.page?.hideMasterItems,
    run: (app) => { const on = !!app.page?.hideMasterItems; editPages(app, 'Hide Master Items', (p) => { p.hideMasterItems = on ? undefined : true; }); },
  },
  {
    id: 'page.overrideMasterItem', label: 'Override Master Item', icon: 'layers', tab: 'Page Design', group: 'Master Pages', edits: true, origin: 'Master item overrides (page layout programs)',
    tip: 'Copy a master page item onto this page so it can be changed here (choose it from the list)',
    run: async (app) => {
      const pub = app.pub;
      const p = app.page; if (!p || app.tab.masterTarget) return;
      const m = pub.masterOf(p);
      const items = m.items.filter((e) => !p.items.some((x) => x.masterOf === e.id));
      if (!items.length) { toast('Every item of this master is already overridden on this page (or the master is empty).'); return; }
      const r = await openDialog({ title: 'Override Master Item', fields: [{ key: 'i', label: 'Master item', type: 'list', options: items.map((e) => ({ value: e.id, label: e.name || e.kind })), value: items[0].id }] });
      if (!r) return;
      const src = items.find((e) => e.id === r.i)!;
      const c = reId(src); detachStory(app, c); c.masterOf = src.id;
      pub.transact('Override Master Item', () => { p.items.push(c); }, [p.id]);
      app.tab.ui.select([c.id]);
    },
  },
]);

// Guides and grids --------------------------------------------------------------------------

function guidesOwner(app: App): { guides?: Guide[] } | undefined { return app.owner; }

def([
  {
    id: 'page.addGuide', label: 'Add Guide', icon: 'border_vertical', tab: 'Page Design', group: 'Guides and Grids', kind: 'split', edits: true,
    tip: 'Drag from a ruler, or click here and drag on the page; the arrow adds a guide at an exact position',
    menu: () => [{ id: 'page.addGuide', arg: 'h', label: 'Horizontal Guide at…' }, { id: 'page.addGuide', arg: 'v', label: 'Vertical Guide at…' }, { separator: true }, { id: 'page.layoutGuides', label: 'Rows and Columns of Guides…' }],
    run: async (app, dir?: 'h' | 'v' | { dir: 'h' | 'v'; pos: number }) => {
      const o = guidesOwner(app); if (!o) return;
      if (dir && typeof dir === 'object') { edit(app, 'Add Guide', () => { (o.guides ||= []).push({ pos: dir.pos, dir: dir.dir }); }); return; }
      if (!dir) { app.tab.ui.setTool({ kind: 'guide' }); toast('Drag on the page to place a guide (Esc cancels).'); return; }
      const r = await promptDialog('Add Guide', `Position (${u(app).label} from the ${dir === 'h' ? 'top' : 'left'} edge)`, String(toU(app, dir === 'h' ? app.pub.size.h / 2 : app.pub.size.w / 2)));
      if (r == null) return;
      edit(app, 'Add Guide', () => { (o.guides ||= []).push({ pos: fromU(app, r), dir }); });
    },
  },
  {
    id: 'page.guidesDialog', label: 'Guides…', icon: 'border_inner', tab: 'Page Design', group: 'Guides and Grids', edits: true,
    run: async (app) => {
      const o = guidesOwner(app); if (!o) return;
      const r = await openDialog({ title: 'Guides', fields: [{ key: 'g', label: `One guide per line: h or v, then the position in ${u(app).label}`, type: 'textarea', rows: 8, value: (o.guides || []).map((g) => `${g.dir} ${toU(app, g.pos)}${g.locked ? ' locked' : ''}`).join('\n') }] });
      if (!r) return;
      const guides: Guide[] = [];
      for (const l of String(r.g).split('\n')) { const m = /^\s*([hv])\s+(-?[\d.]+)(\s+locked)?/i.exec(l); if (m) guides.push({ dir: m[1].toLowerCase() as 'h' | 'v', pos: fromU(app, m[2]), locked: !!m[3] || undefined }); }
      edit(app, 'Guides', () => { o.guides = guides.length ? guides : undefined; });
    },
  },
  { id: 'page.clearGuides', label: 'Clear Guides', icon: 'layers_clear', tab: 'Page Design', group: 'Guides and Grids', edits: true, run: (app) => { const o = guidesOwner(app); if (o) edit(app, 'Clear Guides', () => { o.guides = (o.guides || []).filter((g) => g.locked); }); } },
  {
    id: 'page.lockGuides', label: 'Lock Guides', icon: 'lock', tab: 'Page Design', group: 'Guides and Grids', kind: 'toggle', edits: true,
    isActive: (app) => !!guidesOwner(app)?.guides?.length && guidesOwner(app)!.guides!.every((g) => g.locked),
    run: (app) => { const o = guidesOwner(app); if (!o?.guides?.length) { toast('There are no guides on this page.'); return; } const lock = !o.guides.every((g) => g.locked); edit(app, lock ? 'Lock Guides' : 'Unlock Guides', () => { for (const g of o.guides!) g.locked = lock || undefined; }); },
  },
  {
    id: 'page.baselineGrid', label: 'Baseline Grid…', icon: 'format_line_spacing', tab: 'Page Design', group: 'Guides and Grids', edits: true, origin: 'Baseline grids (magazine layout)',
    tip: 'The spacing text baselines snap to when a paragraph has Align to Baseline Grid on',
    run: async (app) => {
      const g = app.pub.data.baselineGrid;
      const r = await openDialog({ title: 'Baseline Grid', fields: [{ key: 'start', label: 'Start (pt from the top of the page)', type: 'number', min: 0, value: g.start, half: true }, { key: 'step', label: 'Increment every (pt)', type: 'number', min: 1, max: 200, step: 0.5, value: g.step, half: true }, { key: 'show', label: 'Show the grid on screen', type: 'checkbox', value: app.prefs.showBaselineGrid }] });
      if (!r) return;
      app.pub.transact('Baseline Grid', () => { app.pub.data.baselineGrid = { start: +r.start || 0, step: Math.max(1, +r.step || 12) }; });
      app.prefs.showBaselineGrid = !!r.show; app.savePrefs(); app.tab.ui.layout(); app.tab.ui.invalidate();
    },
  },
  {
    id: 'page.layoutGuides', label: 'Layout Guides…', icon: 'grid_on', tab: 'Page Design', group: 'Guides and Grids', edits: true, origin: 'Layout guides (Microsoft Publisher), Create Guides (InDesign)',
    tip: 'Rows and columns of guides inside the margins, for a modular grid',
    run: async (app) => {
      const o = app.owner; if (!o) return;
      const pub = app.pub;
      const g = 'master' in o ? pub.geometry(o) : o;
      const r = await openDialog({ title: 'Layout Guides', fields: [{ key: 'rows', label: 'Rows', type: 'number', min: 1, max: 50, value: 3, half: true }, { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 50, value: g.columns, half: true }, { key: 'gutter', label: `Gutter (${u(app).label})`, type: 'number', min: 0, value: toU(app, g.gutter), half: true }, { key: 'replace', label: 'Replace existing guides', type: 'checkbox', value: true, half: true }] });
      if (!r) return;
      const [mt, mr, mb, ml] = g.margins;
      const gutter = fromU(app, r.gutter);
      const guides: Guide[] = [];
      const cw = (pub.size.w - ml - mr - gutter * (r.cols - 1)) / r.cols, rh = (pub.size.h - mt - mb - gutter * (r.rows - 1)) / r.rows;
      for (let c = 1; c < r.cols; c++) { const x = ml + c * cw + (c - 1) * gutter; guides.push({ dir: 'v', pos: x }, { dir: 'v', pos: x + gutter }); }
      for (let k = 1; k < r.rows; k++) { const y = mt + k * rh + (k - 1) * gutter; guides.push({ dir: 'h', pos: y }, { dir: 'h', pos: y + gutter }); }
      edit(app, 'Layout Guides', () => { o.guides = [...(r.replace ? [] : o.guides || []), ...guides]; });
    },
  },
]);

// Numbering, sections, variables ------------------------------------------------------------

def([
  {
    id: 'page.numbering', label: 'Page Numbering…', icon: 'pin', tab: 'Page Design', group: 'Numbering', edits: true,
    tip: 'How pages are numbered from this page on (a section starts here if none does)',
    run: async (app) => {
      const pub = app.pub;
      const p = app.page; if (!p) return;
      const idx = pub.pageIndex(p.id);
      const sec = sectionAt(app, idx);
      const r = await openDialog({ title: 'Page Numbering', fields: [
        { key: 'style', label: 'Style', type: 'select', options: NUM_OPTIONS, value: sec?.numbering || 'arabicPlain', half: true },
        { key: 'start', label: 'Start at', type: 'number', min: 1, value: sec?.startAt ?? 1, half: true },
        { key: 'prefix', label: 'Prefix (e.g. "A-")', type: 'text', value: sec?.prefix || '', half: true },
        { key: 'name', label: 'Section name', type: 'text', value: sec?.name || '', half: true },
        { key: 'here', label: `Start a new section at page ${idx + 1}`, type: 'checkbox', value: !sec || sec.start !== idx, visibleIf: () => !sec || sec.start !== idx },
      ] });
      if (!r) return;
      pub.transact('Page Numbering', () => {
        let s = sec && sec.start === idx ? sec : undefined;
        if (!s && (r.here || !sec)) { s = { id: newId('sec'), name: '', start: idx, numbering: 'arabicPlain', startAt: 1 }; pub.data.sections.push(s); }
        if (!s) s = sec!;
        s.numbering = r.style; s.startAt = Math.max(1, +r.start || 1); s.prefix = r.prefix || undefined; s.name = r.name || '';
      });
    },
  },
  {
    id: 'page.sections', label: 'Sections…', icon: 'segment', tab: 'Page Design', group: 'Numbering', edits: true,
    run: async (app) => {
      const pub = app.pub;
      const secs = [...pub.data.sections].sort((a, b) => a.start - b.start);
      const r = await openDialog({ title: 'Sections', fields: [{ key: 's', label: 'One section per line: first page number, numbering style (1, i, I, a, A or none), start at, prefix, name', type: 'textarea', rows: 8, value: secs.map((s) => `${s.start + 1}, ${({ arabicPlain: '1', romanLcPeriod: 'i', romanUcPeriod: 'I', alphaLcPeriod: 'a', alphaUcPeriod: 'A', none: 'none' } as any)[s.numbering] || '1'}, ${s.startAt}, ${s.prefix || ''}, ${s.name || ''}`).join('\n') }], help: 'Example: "1, i, 1, , Front matter" then "5, 1, 1, , Body" numbers the first four pages i–iv and restarts at 1 on page 5.' });
      if (!r) return;
      const map: Record<string, NumScheme | 'none'> = { '1': 'arabicPlain', i: 'romanLcPeriod', I: 'romanUcPeriod', a: 'alphaLcPeriod', A: 'alphaUcPeriod', none: 'none' };
      const out: Section[] = [];
      for (const l of String(r.s).split('\n')) { if (!l.trim()) continue; const [pg, st, at, prefix, ...name] = l.split(',').map((x) => x.trim()); out.push({ id: newId('sec'), start: Math.max(0, (+pg || 1) - 1), numbering: map[st] || 'arabicPlain', startAt: Math.max(1, +at || 1), prefix: prefix || undefined, name: name.join(',') }); }
      pub.transact('Sections', () => { pub.data.sections = out; });
    },
  },
  {
    id: 'page.variables', label: 'Text Variables…', icon: 'data_object', tab: 'Page Design', group: 'Numbering', edits: true,
    tip: 'Define named text used by Insert ▸ Text Variable; changing a value updates every use',
    run: async (app) => {
      const pub = app.pub;
      const r = await openDialog({ title: 'Text Variables', fields: [{ key: 'v', label: 'One per line: name = value', type: 'textarea', rows: 8, value: pub.data.variables.map((v) => `${v.name} = ${v.value}`).join('\n') }] });
      if (!r) return;
      const vars = String(r.v).split('\n').map((l) => { const i = l.indexOf('='); return i > 0 ? { name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : null; }).filter((x): x is { name: string; value: string } => !!x && !!x.name);
      pub.transact('Text Variables', () => {
        pub.data.variables = vars;
        for (const s of pub.data.stories) for (const p of s.paras) for (const run of p.runs) if (run.field === 'variable' && run.varName && !run.varName.startsWith('index:')) { const v = vars.find((x) => x.name === run.varName); if (v) run.text = v.value; }
      });
    },
  },
]);

// Schemes, swatches, background, templates ---------------------------------------------------

def([
  {
    id: 'page.colorScheme', label: 'Color Scheme', icon: 'palette', tab: 'Page Design', group: 'Schemes', kind: 'gallery', edits: true, origin: 'Color schemes (Microsoft Publisher)',
    tip: 'Set the Primary, Secondary and Accent swatches at once',
    menu: (app) => COLOR_SCHEMES.map((s) => ({ id: 'page.colorScheme', arg: s.name, label: s.name, checked: app.pub.data.scheme?.colors === s.name, preview: `color:${s.colors.Primary};border-left:10px solid ${s.colors.Secondary};padding-left:4px` })),
    run: async (app, name?: string) => {
      let s = COLOR_SCHEMES.find((x) => x.name === name);
      if (!s) { const r = await openDialog({ title: 'Color Scheme', fields: [{ key: 's', label: 'Scheme', type: 'list', options: COLOR_SCHEMES.map((x) => x.name), value: app.pub.data.scheme?.colors || COLOR_SCHEMES[0].name }] }); if (!r) return; s = COLOR_SCHEMES.find((x) => x.name === r.s); }
      if (s) app.pub.transact('Color Scheme', () => applyColorScheme(app.pub.data, s!));
    },
  },
  {
    id: 'page.fontScheme', label: 'Font Scheme', icon: 'text_fields', tab: 'Page Design', group: 'Schemes', kind: 'gallery', edits: true, origin: 'Font schemes (Microsoft Publisher)',
    tip: 'Set the heading and body fonts of every paragraph style at once',
    menu: (app) => FONT_SCHEMES.map((s) => ({ id: 'page.fontScheme', arg: s.name, label: s.name, checked: app.pub.data.scheme?.fonts === s.name, preview: `font-family:"${s.head}"` })),
    run: async (app, name?: string) => {
      let s = FONT_SCHEMES.find((x) => x.name === name);
      if (!s) { const r = await openDialog({ title: 'Font Scheme', fields: [{ key: 's', label: 'Scheme', type: 'list', options: FONT_SCHEMES.map((x) => ({ value: x.name, label: `${x.name} — ${x.head} / ${x.body}` })), value: app.pub.data.scheme?.fonts || FONT_SCHEMES[0].name }] }); if (!r) return; s = FONT_SCHEMES.find((x) => x.name === r.s); }
      if (s) app.pub.transact('Font Scheme', () => applyFontScheme(app.pub.data, s!));
    },
  },
  { id: 'page.swatchesPane', label: 'Swatches', icon: 'colorize', tab: 'Page Design', group: 'Schemes', keys: ['F5'], noRecord: true, run: (app) => app.ui.togglePane('swatches') },
  {
    id: 'page.newSwatch', label: 'New Swatch…', icon: 'add', tab: 'Page Design', group: 'Schemes', edits: true,
    run: async (app) => { const sw = await swatchDialog(app); if (sw) app.pub.transact('New Swatch', () => { app.pub.data.swatches.push(sw); }); },
  },
  {
    id: 'page.editSwatch', label: 'Edit Swatch…', icon: 'edit', tab: 'Page Design', group: 'Schemes', edits: true,
    run: async (app, name?: string) => {
      const pub = app.pub;
      if (!name) { const r = await openDialog({ title: 'Edit Swatch', fields: [{ key: 's', label: 'Swatch', type: 'list', options: pub.data.swatches.map((s) => s.name), value: pub.data.swatches[0]?.name }] }); if (!r) return; name = r.s; }
      const sw = pub.swatch(name!); if (!sw) return;
      if (sw.name === 'None') { toast('The None swatch cannot be changed.'); return; }
      const out = await swatchDialog(app, sw);
      if (!out) return;
      pub.transact('Edit Swatch', () => { if (out.name !== sw.name) renameSwatch(app, sw.name, out.name); Object.assign(sw, out); });
    },
  },
  { id: 'page.duplicateSwatch', label: 'Duplicate Swatch', icon: 'content_copy', tab: 'Page Design', group: 'Schemes', edits: true, run: (app, name?: string) => { const sw = app.pub.swatch(name || ''); if (!sw) return; let n = `${sw.name} copy`, k = 2; while (app.pub.swatch(n)) n = `${sw.name} copy ${k++}`; app.pub.transact('Duplicate Swatch', () => { app.pub.data.swatches.push({ ...clone(sw), name: n }); }); } },
  {
    id: 'page.deleteSwatch', label: 'Delete Swatch…', icon: 'delete', tab: 'Page Design', group: 'Schemes', edits: true,
    run: async (app, name?: string) => {
      const pub = app.pub;
      const sw = pub.swatch(name || ''); if (!sw) return;
      if (sw.name === 'None' || sw.name === 'Black') { toast(`The ${sw.name} swatch cannot be deleted.`); return; }
      const others = pub.data.swatches.filter((s) => s !== sw).map((s) => s.name);
      const r = await openDialog({ title: 'Delete Swatch', fields: [{ key: 'to', label: `Objects using "${sw.name}" change to`, type: 'select', options: others, value: 'Black' }], ok: 'Delete' });
      if (!r) return;
      pub.transact('Delete Swatch', () => { renameSwatch(app, sw.name, r.to); pub.data.swatches = pub.data.swatches.filter((s) => s !== sw); });
    },
  },
  {
    id: 'page.background', label: 'Page Background', icon: 'format_color_fill', tab: 'Page Design', group: 'Schemes', kind: 'color', edits: true,
    tip: 'A color behind everything on the selected pages (the arrow picks it)',
    run: async (app, arg?: string) => {
      let c: string | null | undefined = typeof arg === 'string' && arg !== 'menu' ? arg : undefined;
      if (c === undefined) c = await colorMenu(app.ui.anchorFor('page.background'), { none: 'No Background', title: 'Page background' });
      if (c === undefined) return;
      editPages(app, 'Page Background', (p) => { p.bg = c ? { type: 'solid', color: c } : undefined; });
    },
  },
  {
    id: 'page.applyTemplate', label: 'Apply Template…', icon: 'dashboard_customize', tab: 'Page Design', group: 'Schemes', edits: true,
    tip: 'Take the masters, styles and swatches of a template; the pages keep their content',
    run: async (app) => {
      const r = await openDialog({ title: 'Apply Template', fields: [{ key: 't', label: 'Template', type: 'list', rows: 8, options: TEMPLATES.filter((t) => t.id !== 'blank').map((t) => ({ value: t.id, label: `${t.name} — ${t.description}` })), value: TEMPLATES[1]?.id }, { key: 'what', label: 'Take', type: 'checkbox', value: true }] });
      if (!r?.t) return;
      const t = TEMPLATES.find((x) => x.id === r.t); if (!t) return;
      const src = t.build();
      const pub = app.pub;
      pub.transact('Apply Template', () => {
        pub.data.styles = clone(src.data.styles);
        pub.data.swatches = clone(src.data.swatches);
        pub.data.scheme = clone(src.data.scheme);
        pub.data.masters = clone(src.data.masters);
        for (const [k, v] of Object.entries(src.media)) pub.media[k] = v;
        for (const s of src.data.stories) if (src.data.masters.some((m) => m.items.some((e) => e.kind === 'text' && e.story === s.id))) pub.data.stories.push(clone(s));
        for (const p of pub.pages) p.master = pub.data.masters[0].id;
      });
      app.tab.ui.layout();
    },
  },
]);
