/** View commands: single page / spreads / preview, show and hide, zoom, color modes, window, Quick Access Bar and ribbon. */
import { def, getCommand } from './registry';
import type { App, ViewMode } from '../app';
import { openDialog, toast } from '../ui/dialog';
import { addAllQatChoices, type Prefs } from '../prefs';

function setView(app: App, v: ViewMode): void {
  const t = app.tab;
  if (t.ui.editingText) t.ui.commitText();
  if (t.view === v) return;
  t.view = v;
  t.ui.select([]);
  t.ui.layout();
  app.ui.renderTabs();
  app.refresh();
}

const viewCmd = (id: string, v: ViewMode, label: string, icon: string, extra: any = {}) => ({
  id, label, icon, tab: 'View', group: 'Views', kind: 'toggle' as const, noRecord: true,
  isActive: (app: App) => app.tab?.view === v, run: (app: App) => setView(app, v), ...extra,
});

type BoolPref = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];

const pref = (key: BoolPref) => ({
  kind: 'toggle' as const, noRecord: true,
  isActive: (app: App) => !!app.prefs[key],
  run: (app: App) => { (app.prefs as any)[key] = !app.prefs[key]; app.savePrefs(); app.tab.ui.layout(); app.tab.ui.invalidate(); app.refresh(); },
});

const ZOOMS = [25, 50, 75, 100, 125, 150, 200, 300, 400, 800];

def([
  viewCmd('view.single', 'single', 'Single Page', 'crop_portrait', { tip: 'One page at a time' }),
  viewCmd('view.spread', 'spread', 'Spreads', 'auto_stories', { tip: 'Facing pages side by side, as the reader sees them' }),
  viewCmd('view.previewMode', 'preview', 'Preview', 'preview', { keys: ['Mod-Shift-w'], tip: 'Hide guides, frame edges and panes: see the page as it prints (W toggles while nothing is selected)' }),
  { id: 'view.pagesPane', label: 'Pages Pane', icon: 'view_sidebar', tab: 'View', group: 'Show', ...pref('showPagesPane') },
  { id: 'view.rulers', label: 'Rulers', icon: 'straighten', tab: 'View', group: 'Show', keys: ['Mod-r'], ...pref('showRulers') },
  { id: 'view.guides', label: 'Guides', icon: 'border_inner', tab: 'View', group: 'Show', keys: ['Mod-;'], ...pref('showGuides'), tip: 'Margin, column and ruler guides' },
  { id: 'view.grid', label: 'Document Grid', icon: 'grid_4x4', tab: 'View', group: 'Show', keys: ["Mod-'"], ...pref('showGrid') },
  { id: 'view.baselineGrid', label: 'Baseline Grid', icon: 'format_line_spacing', tab: 'View', group: 'Show', keys: ['Mod-Alt-\''], ...pref('showBaselineGrid'), tip: 'The grid lines text baselines snap to (Page Design ▸ Baseline Grid sets its spacing)' },
  { id: 'view.frameEdges', label: 'Frame Edges', icon: 'crop_square', tab: 'View', group: 'Show', keys: ['Mod-Alt-h'], ...pref('showFrameEdges') },
  { id: 'view.textThreads', label: 'Text Threads', icon: 'link', tab: 'View', group: 'Show', keys: ['Mod-Alt-y'], ...pref('showTextThreads'), tip: 'Lines between linked text frames' },
  { id: 'view.snapToGuides', label: 'Snap to Guides', icon: 'align_horizontal_left', tab: 'View', group: 'Show', ...pref('snapToGuides') },
  { id: 'view.snapToGrid', label: 'Snap to Grid', icon: 'grid_goldenratio', tab: 'View', group: 'Show', ...pref('snapToGrid') },
  { id: 'view.smartGuides', label: 'Smart Guides', icon: 'straighten', tab: 'View', group: 'Show', ...pref('smartGuides') },
  {
    id: 'view.gridSettings', label: 'Grids and Guides…', icon: 'grid_on', tab: 'View', group: 'Show', noRecord: true,
    run: async (app) => {
      const p = app.prefs;
      const r = await openDialog({ title: 'Grids and Guides', fields: [
        { key: 'guides', label: 'Show guides', type: 'checkbox', value: p.showGuides, half: true },
        { key: 'snapG', label: 'Snap to guides and margins', type: 'checkbox', value: p.snapToGuides, half: true },
        { key: 'grid', label: 'Show the document grid', type: 'checkbox', value: p.showGrid, half: true },
        { key: 'snap', label: 'Snap to grid', type: 'checkbox', value: p.snapToGrid, half: true },
        { key: 'size', label: 'Grid spacing (points)', type: 'number', min: 2, max: 144, value: p.gridSize, half: true },
        { key: 'smart', label: 'Smart guides when objects align', type: 'checkbox', value: p.smartGuides, half: true },
        { key: 'base', label: 'Show the baseline grid', type: 'checkbox', value: p.showBaselineGrid, half: true },
        { key: 'edges', label: 'Show frame edges', type: 'checkbox', value: p.showFrameEdges, half: true },
      ], help: 'Hold Alt while dragging to move freely without snapping. The baseline grid spacing is set under Page Design ▸ Baseline Grid.' });
      if (!r) return;
      Object.assign(p, { showGuides: r.guides, snapToGuides: r.snapG, showGrid: r.grid, snapToGrid: r.snap, gridSize: Math.max(2, Math.min(144, +r.size || 12)), smartGuides: r.smart, showBaselineGrid: r.base, showFrameEdges: r.edges });
      app.savePrefs();
      app.tab.ui.layout(); app.tab.ui.invalidate();
    },
  },
  { id: 'view.navigator', label: 'Navigator', icon: 'list_alt', tab: 'View', group: 'Panes', noRecord: true, origin: 'Navigator panes in office suites', run: (app) => app.ui.togglePane('navigator') },
  { id: 'view.layersPane', label: 'Layers', icon: 'layers', tab: 'View', group: 'Panes', keys: ['Alt-F10'], noRecord: true, run: (app) => app.ui.togglePane('layers') },
  {
    id: 'view.zoom', label: 'Zoom', icon: 'zoom_in', tab: 'View', group: 'Zoom', kind: 'size', noRecord: true,
    tip: 'Zoom percentage',
    value: (app) => (app.tab?.ui ? `${Math.round(app.tab.ui.zoom * 100)}%` : ''),
    menu: (app) => [{ id: 'view.fitPage', label: 'Fit Page' }, { id: 'view.fitWidth', label: 'Fit Width' }, { separator: true }, ...ZOOMS.map((z) => ({ id: 'view.zoom', arg: z, label: `${z}%`, checked: Math.round(app.tab.ui.zoom * 100) === z }))],
    run: async (app, pct?: number | string) => {
      if (pct == null) {
        const r = await openDialog({ title: 'Zoom', fields: [{ key: 'z', label: 'Zoom to', type: 'radio', options: [{ value: 'fit', label: 'Fit page' }, { value: 'width', label: 'Fit width' }, ...ZOOMS.map((z) => ({ value: String(z), label: `${z}%` }))], value: 'fit' }, { key: 'pct', label: 'Percent', type: 'number', min: 5, max: 1600, value: Math.round(app.tab.ui.zoom * 100) }], onChange: (v, ctl, k) => { if (k === 'z' && v.z !== 'fit' && v.z !== 'width') ctl.set('pct', +v.z); } });
        if (!r) return;
        app.tab.ui.setZoom(r.z === 'fit' ? 'fit' : r.z === 'width' ? 'width' : (+r.pct || 100) / 100);
        return;
      }
      const n = parseFloat(String(pct));
      if (!isNaN(n)) app.tab.ui.setZoom(Math.max(0.05, Math.min(16, n / 100)));
    },
  },
  { id: 'view.fitPage', label: 'Fit Page', icon: 'fit_screen', tab: 'View', group: 'Zoom', keys: ['Mod-0'], noRecord: true, run: (app) => app.tab.ui.setZoom('fit') },
  { id: 'view.fitWidth', label: 'Fit Width', icon: 'fit_width', tab: 'View', group: 'Zoom', keys: ['Mod-Alt-0'], noRecord: true, run: (app) => app.tab.ui.setZoom('width') },
  { id: 'view.actualSize', label: 'Actual Size', icon: 'crop_original', tab: 'View', group: 'Zoom', keys: ['Mod-1'], noRecord: true, run: (app) => app.tab.ui.setZoom(1) },
  { id: 'view.zoomIn', label: 'Zoom In', icon: 'zoom_in', tab: 'View', group: 'Zoom', keys: ['Mod-='], noRecord: true, run: (app) => app.tab.ui.setZoom(Math.min(16, app.tab.ui.zoom * 1.25)) },
  { id: 'view.zoomOut', label: 'Zoom Out', icon: 'zoom_out', tab: 'View', group: 'Zoom', keys: ['Mod--'], noRecord: true, run: (app) => app.tab.ui.setZoom(Math.max(0.05, app.tab.ui.zoom / 1.25)) },
  { id: 'view.zoomSelection', label: 'Zoom to Selection', icon: 'center_focus_strong', tab: 'View', group: 'Zoom', keys: ['Mod-Alt-='], noRecord: true, isEnabled: (app) => app.selected.length > 0, run: (app) => { const sel = app.selected; const w = Math.max(...sel.map((e) => e.x + e.w)) - Math.min(...sel.map((e) => e.x)); const host = app.tab.ui.el.querySelector('.qp-center') as HTMLElement | null; const avail = (host?.clientWidth || 800) - 80; app.tab.ui.setZoom(Math.max(0.1, Math.min(8, avail / Math.max(40, w)))); } },
  { id: 'view.color', label: 'Color', icon: 'palette', tab: 'View', group: 'Color', kind: 'toggle', noRecord: true, isActive: (app) => !app.tab?.colorMode, run: (app) => { app.tab.colorMode = undefined; app.tab.ui.layout(); app.tab.ui.invalidate(); } },
  { id: 'view.grayscale', label: 'Grayscale', icon: 'filter_b_and_w', tab: 'View', group: 'Color', kind: 'toggle', noRecord: true, tip: 'Preview the pages as they print in grayscale', isActive: (app) => app.tab?.colorMode === 'grayscale', run: (app) => { app.tab.colorMode = app.tab.colorMode === 'grayscale' ? undefined : 'grayscale'; app.tab.ui.layout(); app.tab.ui.invalidate(); } },
  {
    id: 'view.switchWindow', label: 'Switch Windows', icon: 'tab', tab: 'View', group: 'Window', kind: 'menu', keys: ['Mod-F6'], noRecord: true,
    menu: (app) => app.docs.map((d) => ({ id: 'view.switchWindow', arg: d.id, label: d.displayName + (d.dirty ? ' •' : ''), checked: d === app.tab })),
    run: (app, id?: string) => { const d = app.docs.find((x) => x.id === id) || app.docs[(app.docs.indexOf(app.tab) + 1) % app.docs.length]; if (d) app.activate(d); },
  },
  {
    id: 'view.fullScreen', label: 'Full Screen', icon: 'fullscreen', tab: 'View', group: 'Window', kind: 'toggle', noRecord: true,
    tip: 'Hide the ribbon and use the whole screen for the pages (Esc returns)',
    isActive: () => document.body.classList.contains('ql-fullscreen'),
    run: () => {
      const on = !document.body.classList.contains('ql-fullscreen');
      document.body.classList.toggle('ql-fullscreen', on);
      try { if (on) void document.documentElement.requestFullscreen?.(); else if (document.fullscreenElement) void document.exitFullscreen(); } catch { /* not allowed */ }
    },
  },
  {
    id: 'view.newWindow', label: 'New Window', icon: 'open_in_new', tab: 'View', group: 'Window', noRecord: true,
    tip: 'A second view of this publication in the same window (as a tab): edits show in both',
    run: (app) => {
      const t = app.tab;
      const twin = app.createTab(t.pub, { title: t.title, fileName: t.fileName, format: t.format, uri: t.uri, key: t.key });
      t.pub.onChange = () => { app.pubChanged(t); app.pubChanged(twin); };
      twin.title = `${t.title}:2`;
      app.ui.tabsChanged();
    },
  },
  { id: 'view.statusBar', label: 'Status Bar', icon: 'horizontal_split', tab: 'View', group: 'Window', kind: 'toggle', noRecord: true, isActive: () => !document.body.classList.contains('ql-no-status'), run: () => document.body.classList.toggle('ql-no-status') },
]);

// Quick Access Bar and ribbon -----------------------------------------------------------------

def([
  { id: 'view.cmdSearch', label: 'Search Commands', icon: 'search', tab: 'View', group: 'Help', keys: ['Alt-q'], popular: true, noRecord: true, run: (app) => app.ui.commandPalette() },
  {
    id: 'view.qatAddAll', label: 'Add All Quick Access Choices (A–Z)', icon: 'sort_by_alpha', tab: 'View', group: 'Quick Access Bar', noRecord: true,
    tip: 'Put every drop-down choice on the Quick Access Bar: Save and Print first, then the rest alphabetically',
    run: (app) => { app.prefs.qat = addAllQatChoices(app.prefs.qat, (id) => getCommand(id)?.label); app.prefs.qatHidden = false; app.savePrefs(); app.ui.applyPrefs(); app.ui.renderQat(); toast('All Quick Access choices added'); },
  },
  {
    id: 'view.qatPosition', label: 'Quick Access Bar Position', icon: 'swap_vert', tab: 'View', group: 'Quick Access Bar', kind: 'menu', noRecord: true,
    menu: (app) => (['top', 'below', 'bottom'] as const).map((p) => ({ id: 'view.qatPosition', arg: p, label: p === 'top' ? 'Show Above the Ribbon' : p === 'below' ? 'Show Below the Ribbon' : 'Show at the Bottom (near keyboard)', checked: app.prefs.qatPosition === p })),
    run: (app, pos?: 'top' | 'below' | 'bottom') => { const order: ('top' | 'below' | 'bottom')[] = ['top', 'below', 'bottom']; app.prefs.qatPosition = pos || order[(order.indexOf(app.prefs.qatPosition) + 1) % 3]; app.savePrefs(); app.ui.applyPrefs(); },
  },
  { id: 'view.qatLabels', label: 'Quick Access Bar Labels', icon: 'label', tab: 'View', group: 'Quick Access Bar', kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.qatLabels, run: (app) => { app.prefs.qatLabels = !app.prefs.qatLabels; app.savePrefs(); app.ui.renderQat(); } },
  { id: 'view.qatShow', label: 'Show Quick Access Bar', icon: 'bolt', tab: 'View', group: 'Quick Access Bar', noRecord: true, run: (app) => { app.prefs.qatHidden = false; app.savePrefs(); app.ui.applyPrefs(); } },
  { id: 'view.qatHide', label: 'Hide Quick Access Bar', icon: 'visibility_off', tab: 'View', group: 'Quick Access Bar', noRecord: true, run: (app) => { app.prefs.qatHidden = true; app.savePrefs(); app.ui.applyPrefs(); } },
  { id: 'view.collapseRibbon', label: 'Collapse the Ribbon', icon: 'expand_less', tab: 'View', group: 'Ribbon', keys: ['Mod-F1'], kind: 'toggle', noRecord: true, isActive: (app) => app.prefs.ribbon !== 'full', run: (app) => { app.prefs.ribbon = app.prefs.ribbon === 'full' ? 'tabs' : 'full'; app.savePrefs(); app.ui.applyPrefs(); } },
  { id: 'view.touchMode', label: 'Touch/Mouse Mode', icon: 'touch_app', tab: 'View', group: 'Ribbon', kind: 'toggle', noRecord: true, tip: 'More space between commands for fingers', isActive: (app) => app.prefs.touchMode, run: (app) => { app.prefs.touchMode = !app.prefs.touchMode; app.savePrefs(); app.ui.applyPrefs(); } },
  {
    id: 'view.theme', label: 'Dark Mode', icon: 'dark_mode', tab: 'View', group: 'Appearance', kind: 'menu', noRecord: true,
    menu: (app) => (['system', 'light', 'dark'] as const).map((t) => ({ id: 'view.theme', arg: t, label: t === 'system' ? 'Follow the System' : t === 'light' ? 'Light' : 'Dark', checked: app.prefs.theme === t })),
    run: (app, t?: 'system' | 'light' | 'dark') => { app.prefs.theme = t || (app.prefs.theme === 'dark' ? 'light' : 'dark'); app.savePrefs(); app.ui.applyPrefs(); },
  },
  {
    id: 'view.unit', label: 'Measurement Unit', icon: 'square_foot', tab: 'View', group: 'Appearance', kind: 'menu', noRecord: true,
    tip: 'The unit shown in rulers, the status bar and dialogs',
    menu: (app) => (['in', 'mm', 'cm', 'pt', 'pica', 'px'] as const).map((u) => ({ id: 'view.unit', arg: u, label: { in: 'Inches', mm: 'Millimeters', cm: 'Centimeters', pt: 'Points', pica: 'Picas', px: 'Pixels' }[u], checked: app.prefs.unit === u })),
    run: (app, u?: Prefs['unit']) => { if (!u) return; app.prefs.unit = u; app.pub.data.unit = u; app.savePrefs(); app.tab.ui.layout(); app.refresh(); },
  },
]);
