/** Arrange tab: order, align and distribute, group, lock, rotate and flip, text wrap, size and position, layers. */
import { def, type MenuEntry } from './registry';
import type { App } from '../app';
import type { Item, Layer, WrapMode } from '../model/types';
import { UNITS } from '../model/types';
import { newId, reId } from '../model/pub';
import { reorder, align, distribute, group, ungroup, selection, edit, setBox, detachStory, flatItems } from '../edit/ops';
import { openDialog, toast, confirmDialog, promptDialog } from '../ui/dialog';

const u = (app: App) => UNITS[app.prefs.unit];
const toU = (app: App, pt: number) => +(pt / u(app).pt).toFixed(u(app).digits);
const fromU = (app: App, v: any) => (+v || 0) * u(app).pt;

const hasSel = (app: App) => app.selected.length > 0;
const many = (app: App) => app.selected.length > 1;

function patch(app: App, label: string, fn: (e: Item) => void): void {
  const sel = selection(app);
  if (!sel.length) { toast('Select an object first.'); return; }
  edit(app, label, () => sel.forEach(fn));
}

function alignToPage(app: App): boolean { return !!(app as any).alignToPage; }

const WRAPS: { v: WrapMode; label: string; icon: string; tip: string }[] = [
  { v: 'none', label: 'No Wrap', icon: 'block', tip: 'Text runs under the object' },
  { v: 'square', label: 'Wrap Around Bounding Box', icon: 'wrap_text', tip: 'Text keeps clear of the object\'s rectangle' },
  { v: 'tight', label: 'Wrap Around Shape', icon: 'rounded_corner', tip: 'Text follows the shape (and the picture\'s edges)' },
  { v: 'topBottom', label: 'Jump Object', icon: 'vertical_distribute', tip: 'Text stops above and continues below' },
  { v: 'behind', label: 'Behind Text', icon: 'flip_to_back', tip: 'No wrap; text runs over the object' },
];

function layerById(app: App, id?: string): Layer | undefined { return app.pub.layer(id); }

def([
  { id: 'arrange.bringToFront', label: 'Bring to Front', icon: 'flip_to_front', tab: 'Arrange', group: 'Order', keys: ['Mod-Shift-]'], edits: true, isEnabled: hasSel, run: (app) => reorder(app, 'front') },
  { id: 'arrange.bringForward', label: 'Bring Forward', icon: 'arrow_upward', tab: 'Arrange', group: 'Order', keys: ['Mod-]'], edits: true, isEnabled: hasSel, run: (app) => reorder(app, 'forward') },
  { id: 'arrange.sendBackward', label: 'Send Backward', icon: 'arrow_downward', tab: 'Arrange', group: 'Order', keys: ['Mod-['], edits: true, isEnabled: hasSel, run: (app) => reorder(app, 'backward') },
  { id: 'arrange.sendToBack', label: 'Send to Back', icon: 'flip_to_back', tab: 'Arrange', group: 'Order', keys: ['Mod-Shift-['], edits: true, isEnabled: hasSel, run: (app) => reorder(app, 'back') },
  {
    id: 'arrange.align', label: 'Align', icon: 'align_horizontal_left', tab: 'Arrange', group: 'Align', kind: 'menu', edits: true, isEnabled: hasSel,
    menu: (app) => [
      { id: 'arrange.alignLeft', label: 'Align Left', icon: 'align_horizontal_left' }, { id: 'arrange.alignCenter', label: 'Align Center', icon: 'align_horizontal_center' }, { id: 'arrange.alignRight', label: 'Align Right', icon: 'align_horizontal_right' },
      { separator: true }, { id: 'arrange.alignTop', label: 'Align Top', icon: 'align_vertical_top' }, { id: 'arrange.alignMiddle', label: 'Align Middle', icon: 'align_vertical_center' }, { id: 'arrange.alignBottom', label: 'Align Bottom', icon: 'align_vertical_bottom' },
      { separator: true }, { id: 'arrange.distributeH', label: 'Distribute Horizontally', icon: 'horizontal_distribute' }, { id: 'arrange.distributeV', label: 'Distribute Vertically', icon: 'vertical_distribute' },
      { separator: true }, { id: 'arrange.alignToPage', label: 'Align to Page', checked: alignToPage(app) }, { id: 'arrange.centerOnPage', label: 'Center on Page' },
    ],
    run: (app) => align(app, 'left', alignToPage(app) || !many(app)),
  },
  ...([['alignLeft', 'left', 'Align Left', 'align_horizontal_left'], ['alignCenter', 'center', 'Align Center', 'align_horizontal_center'], ['alignRight', 'right', 'Align Right', 'align_horizontal_right'], ['alignTop', 'top', 'Align Top', 'align_vertical_top'], ['alignMiddle', 'middle', 'Align Middle', 'align_vertical_center'], ['alignBottom', 'bottom', 'Align Bottom', 'align_vertical_bottom']] as const).map(([id, how, label, icon]) => ({
    id: `arrange.${id}`, label, icon, tab: 'Arrange', group: 'Align', edits: true, isEnabled: hasSel,
    tip: 'Aligns the selected objects to each other (or to the page when Align to Page is on, or only one is selected)',
    run: (app: App) => align(app, how, alignToPage(app) || !many(app)),
  })),
  { id: 'arrange.distributeH', label: 'Distribute Horizontally', icon: 'horizontal_distribute', tab: 'Arrange', group: 'Align', edits: true, isEnabled: (app) => app.selected.length > 2, run: (app) => distribute(app, 'h') },
  { id: 'arrange.distributeV', label: 'Distribute Vertically', icon: 'vertical_distribute', tab: 'Arrange', group: 'Align', edits: true, isEnabled: (app) => app.selected.length > 2, run: (app) => distribute(app, 'v') },
  { id: 'arrange.alignToPage', label: 'Align to Page', icon: 'crop_portrait', tab: 'Arrange', group: 'Align', kind: 'toggle', noRecord: true, isActive: (app) => alignToPage(app), run: (app) => { (app as any).alignToPage = !alignToPage(app); app.refresh(); } },
  { id: 'arrange.centerOnPage', label: 'Center on Page', icon: 'center_focus_weak', tab: 'Arrange', group: 'Align', edits: true, isEnabled: hasSel, run: (app) => { align(app, 'center', true); align(app, 'middle', true); } },
  {
    id: 'arrange.alignToMargins', label: 'Align to Margins', icon: 'margin', tab: 'Arrange', group: 'Align', kind: 'menu', edits: true, isEnabled: hasSel,
    tip: 'Snap the selected objects to the page margins',
    menu: () => [{ id: 'arrange.alignToMargins', arg: 'left', label: 'Left Margin' }, { id: 'arrange.alignToMargins', arg: 'right', label: 'Right Margin' }, { id: 'arrange.alignToMargins', arg: 'top', label: 'Top Margin' }, { id: 'arrange.alignToMargins', arg: 'bottom', label: 'Bottom Margin' }, { id: 'arrange.alignToMargins', arg: 'fill', label: 'Fill the Margins' }],
    run: (app, how = 'fill') => {
      const o = app.owner; if (!o) return;
      const pub = app.pub;
      const g = 'master' in o ? pub.geometry(o) : o;
      let [mt, mr, mb, ml] = g.margins;
      if ('master' in o && pub.pageSide(pub.pageIndex(o.id)) === 'left') [ml, mr] = [mr, ml];
      patch(app, 'Align to Margins', (e) => {
        if (how === 'left') e.x = ml; else if (how === 'right') e.x = pub.size.w - mr - e.w; else if (how === 'top') e.y = mt; else if (how === 'bottom') e.y = pub.size.h - mb - e.h;
        else setBox(e, { x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb });
      });
    },
  },
  { id: 'arrange.group', label: 'Group', icon: 'join', tab: 'Arrange', group: 'Group', keys: ['Mod-Shift-g'], edits: true, isEnabled: many, run: (app) => group(app) },
  { id: 'arrange.ungroup', label: 'Ungroup', icon: 'join_left', tab: 'Arrange', group: 'Group', keys: ['Mod-Alt-Shift-g'], edits: true, isEnabled: (app) => app.selected.some((e) => e.kind === 'group'), run: (app) => ungroup(app) },
  {
    id: 'arrange.lock', label: 'Lock', icon: 'lock', tab: 'Arrange', group: 'Group', keys: ['Mod-Alt-l'], kind: 'toggle', edits: true, isEnabled: hasSel,
    tip: 'Locked objects cannot be moved or resized (they can still be selected and edited)',
    isActive: (app) => app.selected.length > 0 && app.selected.every((e) => e.locked),
    run: (app) => { const lock = !app.selected.every((e) => e.locked); patch(app, lock ? 'Lock' : 'Unlock', (e) => { e.locked = lock || undefined; }); },
  },
  { id: 'arrange.unlockAll', label: 'Unlock All on Page', icon: 'lock_open', tab: 'Arrange', group: 'Group', edits: true, run: (app) => { const o = app.owner; if (!o) return; edit(app, 'Unlock All', () => { for (const e of flatItems(o)) delete e.locked; }); } },
  { id: 'arrange.hide', label: 'Hide', icon: 'visibility_off', tab: 'Arrange', group: 'Group', keys: ['Mod-3'], edits: true, isEnabled: hasSel, tip: 'Hidden objects do not print or export; Show All brings them back', run: (app) => { patch(app, 'Hide', (e) => { e.hidden = true; }); app.tab.ui.select([]); } },
  { id: 'arrange.showAll', label: 'Show All on Page', icon: 'visibility', tab: 'Arrange', group: 'Group', keys: ['Mod-Alt-3'], edits: true, run: (app) => { const o = app.owner; if (!o) return; edit(app, 'Show All', () => { for (const e of flatItems(o)) delete e.hidden; }); } },
  {
    id: 'arrange.rotate', label: 'Rotate', icon: 'rotate_right', tab: 'Arrange', group: 'Rotate', kind: 'menu', edits: true, isEnabled: hasSel,
    menu: () => [{ id: 'arrange.rotateRight', label: 'Rotate Right 90°', icon: 'rotate_right' }, { id: 'arrange.rotateLeft', label: 'Rotate Left 90°', icon: 'rotate_left' }, { id: 'arrange.rotate', arg: 180, label: 'Rotate 180°' }, { separator: true }, { id: 'arrange.flipH', label: 'Flip Horizontal', icon: 'flip' }, { id: 'arrange.flipV', label: 'Flip Vertical', icon: 'flip' }, { separator: true }, { id: 'arrange.rotate', arg: 'dialog', label: 'Rotation…' }, { id: 'arrange.rotate', arg: 0, label: 'Reset Rotation' }, { separator: true }, { id: 'arrange.skew', arg: 'dialog', label: 'Skew…', icon: 'transform' }, { id: 'arrange.skew', arg: 0, label: 'Reset Skew' }],
    run: async (app, deg?: number | string) => {
      if (deg === 'dialog' || deg === undefined) {
        const cur = app.selected[0]?.rot || 0;
        const r = await openDialog({ title: 'Rotation', fields: [{ key: 'd', label: 'Angle (degrees, clockwise)', type: 'number', min: -360, max: 360, step: 0.1, value: cur }] });
        if (!r) return;
        patch(app, 'Rotate', (e) => setBox(e, { rot: +r.d }));
        return;
      }
      const n = +deg;
      if (n === 0) { patch(app, 'Reset Rotation', (e) => setBox(e, { rot: 0 })); return; }
      patch(app, 'Rotate', (e) => setBox(e, { rot: (e.rot || 0) + n }));
    },
  },
  {
    id: 'arrange.skew', label: 'Skew', icon: 'transform', tab: 'Arrange', group: 'Rotate', kind: 'menu', edits: true, isEnabled: hasSel, origin: 'Skew (QuarkXPress, PageMaker)',
    tip: 'Slant the object horizontally about its center (positive leans the top to the right)',
    menu: (app) => { const cur = app.selected[0]?.skew || 0; return [...[-30, -15, 0, 15, 30].map((v) => ({ id: 'arrange.skew', arg: v, label: v === 0 ? 'No Skew' : `${v > 0 ? '+' : ''}${v}°`, checked: Math.abs(cur - v) < 0.01 })), { separator: true }, { id: 'arrange.skew', arg: 'dialog', label: 'Skew…' }] as MenuEntry[]; },
    run: async (app, deg?: number | string) => {
      let v: number;
      if (deg === 'dialog' || deg === undefined) {
        const r = await openDialog({ title: 'Skew', fields: [{ key: 'd', label: 'Horizontal skew (degrees, positive leans the top right)', type: 'number', min: -75, max: 75, step: 0.1, value: app.selected[0]?.skew || 0 }] });
        if (!r) return;
        v = +r.d;
      } else v = +deg;
      if (!Number.isFinite(v)) return;
      v = Math.max(-75, Math.min(75, v));
      patch(app, v ? 'Skew' : 'Reset Skew', (e) => { if (v) e.skew = v; else delete e.skew; });
    },
  },
  { id: 'arrange.rotateLeft', label: 'Rotate Left 90°', icon: 'rotate_left', tab: 'Arrange', group: 'Rotate', edits: true, isEnabled: hasSel, run: (app) => patch(app, 'Rotate Left', (e) => setBox(e, { rot: (e.rot || 0) - 90 })) },
  { id: 'arrange.rotateRight', label: 'Rotate Right 90°', icon: 'rotate_right', tab: 'Arrange', group: 'Rotate', edits: true, isEnabled: hasSel, run: (app) => patch(app, 'Rotate Right', (e) => setBox(e, { rot: (e.rot || 0) + 90 })) },
  { id: 'arrange.flipH', label: 'Flip Horizontal', icon: 'flip', tab: 'Arrange', group: 'Rotate', edits: true, isEnabled: hasSel, run: (app) => patch(app, 'Flip Horizontal', (e) => { e.flipH = !e.flipH || undefined; }) },
  { id: 'arrange.flipV', label: 'Flip Vertical', icon: 'flip', tab: 'Arrange', group: 'Rotate', edits: true, isEnabled: hasSel, run: (app) => patch(app, 'Flip Vertical', (e) => { e.flipV = !e.flipV || undefined; }) },
  {
    id: 'arrange.wrap', label: 'Text Wrap', icon: 'wrap_text', tab: 'Arrange', group: 'Text Wrap', kind: 'menu', edits: true, isEnabled: hasSel, origin: 'Text wrap / runaround (PageMaker, QuarkXPress)',
    tip: 'How text in frames beneath flows around the selected objects',
    menu: (app) => { const cur = app.selected[0]?.wrap?.mode || 'none'; return [...WRAPS.map((w) => ({ id: 'arrange.wrap', arg: w.v, label: w.label, icon: w.icon, checked: cur === w.v })), { separator: true }, { id: 'arrange.wrapOffset', label: 'Wrap Distance…' }] as MenuEntry[]; },
    run: (app, mode?: WrapMode) => { if (!mode) { const cur = app.selected[0]?.wrap?.mode || 'none'; mode = cur === 'none' ? 'square' : 'none'; } patch(app, 'Text Wrap', (e) => { e.wrap = mode === 'none' ? undefined : { mode: mode!, offset: e.wrap?.offset ?? 9 }; }); },
  },
  ...WRAPS.filter((w) => w.v !== 'behind').map((w) => ({ id: `arrange.wrap${w.v[0].toUpperCase()}${w.v.slice(1)}`, label: w.label, icon: w.icon, tab: 'Arrange', group: 'Text Wrap', kind: 'toggle' as const, edits: true, isEnabled: hasSel, tip: w.tip, isActive: (app: App) => (app.selected[0]?.wrap?.mode || 'none') === w.v, run: (app: App) => app.exec('arrange.wrap', w.v) })),
  { id: 'arrange.wrapBehind', label: 'Behind Text', icon: 'flip_to_back', tab: 'Arrange', group: 'Text Wrap', kind: 'toggle', edits: true, isEnabled: hasSel, isActive: (app) => app.selected[0]?.wrap?.mode === 'behind', run: (app) => app.exec('arrange.wrap', 'behind') },
  {
    id: 'arrange.wrapOffset', label: 'Wrap Distance…', icon: 'space_bar', tab: 'Arrange', group: 'Text Wrap', edits: true, isEnabled: hasSel,
    run: async (app) => { const cur = app.selected[0]?.wrap?.offset ?? 9; const r = await openDialog({ title: 'Wrap Distance', fields: [{ key: 'o', label: `Distance between the object and the text (${u(app).label})`, type: 'number', min: 0, value: toU(app, cur) }] }); if (!r) return; patch(app, 'Wrap Distance', (e) => { e.wrap = { mode: e.wrap?.mode || 'square', offset: fromU(app, r.o) }; }); },
  },
  {
    id: 'arrange.sizeDialog', label: 'Size and Position…', icon: 'aspect_ratio', tab: 'Arrange', group: 'Size and Position', keys: ['Mod-Shift-s'], edits: true, isEnabled: hasSel,
    run: async (app) => {
      const e = app.selected[0]; if (!e) return;
      const r = await openDialog({ title: 'Size and Position', fields: [
        { key: 'x', label: `X (${u(app).label})`, type: 'number', step: 0.01, value: toU(app, e.x), half: true }, { key: 'y', label: `Y (${u(app).label})`, type: 'number', step: 0.01, value: toU(app, e.y), half: true },
        { key: 'w', label: `Width (${u(app).label})`, type: 'number', min: 0, step: 0.01, value: toU(app, e.w), half: true }, { key: 'h', label: `Height (${u(app).label})`, type: 'number', min: 0, step: 0.01, value: toU(app, e.h), half: true },
        { key: 'rot', label: 'Rotation (°)', type: 'number', min: -360, max: 360, step: 0.1, value: e.rot || 0, half: true }, { key: 'skew', label: 'Skew (°)', type: 'number', min: -75, max: 75, step: 0.1, value: e.skew || 0, half: true },
        { key: 'prop', label: 'Keep proportions', type: 'checkbox', value: false, half: true },
        { key: 'name', label: 'Name', type: 'text', value: e.name || '' },
      ], onChange: (v, ctl, k) => { if (v.prop && e.w && e.h) { if (k === 'w') ctl.set('h', +((+v.w * e.h) / e.w).toFixed(3)); if (k === 'h') ctl.set('w', +((+v.h * e.w) / e.h).toFixed(3)); } } });
      if (!r) return;
      edit(app, 'Size and Position', () => { const dx = fromU(app, r.x) - e.x, dy = fromU(app, r.y) - e.y; for (const s of app.selected) { if (s === e) { setBox(s, { x: fromU(app, r.x), y: fromU(app, r.y), w: fromU(app, r.w), h: fromU(app, r.h), rot: +r.rot }); const sk = Math.max(-75, Math.min(75, +r.skew || 0)); if (sk) s.skew = sk; else delete s.skew; } else setBox(s, { x: s.x + dx, y: s.y + dy }); } e.name = r.name || undefined; });
    },
  },
  {
    id: 'arrange.stepRepeat', label: 'Step and Repeat…', icon: 'grid_view', tab: 'Arrange', group: 'Size and Position', keys: ['Mod-Alt-u'], edits: true, isEnabled: hasSel, origin: 'Step and Repeat (QuarkXPress, InDesign)',
    tip: 'Copies of the selection at a regular offset (business cards, labels, grids)',
    run: async (app) => {
      const e = app.selected[0]; if (!e) return;
      const r = await openDialog({ title: 'Step and Repeat', fields: [{ key: 'n', label: 'Copies', type: 'number', min: 1, max: 200, value: 3, half: true }, { key: 'grid', label: 'As a grid (rows × columns)', type: 'checkbox', value: false, half: true }, { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 50, value: 2, half: true, visibleIf: (v) => v.grid }, { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 50, value: 2, half: true, visibleIf: (v) => v.grid }, { key: 'dx', label: `Horizontal offset (${u(app).label})`, type: 'number', step: 0.01, value: toU(app, e.w + 9), half: true }, { key: 'dy', label: `Vertical offset (${u(app).label})`, type: 'number', step: 0.01, value: toU(app, r_dy(e)), half: true }] });
      if (!r) return;
      const sel = selection(app);
      const ids: string[] = [];
      edit(app, 'Step and Repeat', (o) => {
        const place = (dx: number, dy: number) => { for (const s of sel) { const c = reId(s); detachStory(app, c); c.x += dx; c.y += dy; if (c.kind === 'group') { const walk = (items: Item[]) => { for (const ch of items) { ch.x += dx; ch.y += dy; if (ch.kind === 'group') walk(ch.children); } }; walk(c.children); } o.items.push(c); ids.push(c.id); } };
        if (r.grid) { for (let row = 0; row < +r.rows; row++) for (let col = 0; col < +r.cols; col++) if (row || col) place(col * fromU(app, r.dx), row * fromU(app, r.dy)); }
        else for (let k = 1; k <= +r.n; k++) place(k * fromU(app, r.dx), k * fromU(app, r.dy));
      });
      app.tab.ui.select(ids);
    },
  },
  { id: 'arrange.layersPane', label: 'Layers', icon: 'layers', tab: 'Arrange', group: 'Size and Position', noRecord: true, run: (app) => app.ui.togglePane('layers') },
  {
    id: 'arrange.moveToLayer', label: 'Move to Layer', icon: 'move_up', tab: 'Arrange', group: 'Size and Position', kind: 'menu', edits: true, isEnabled: hasSel,
    menu: (app) => [...app.pub.data.layers.map((l) => ({ id: 'arrange.moveToLayer', arg: l.id, label: l.name, checked: (app.selected[0]?.layer || 'default') === l.id })), { separator: true }, { id: 'arrange.newLayer', label: 'New Layer…', icon: 'add' }],
    run: async (app, id?: string) => {
      if (!id) { const r = await openDialog({ title: 'Move to Layer', fields: [{ key: 'l', label: 'Layer', type: 'select', options: app.pub.data.layers.map((l) => ({ value: l.id, label: l.name })), value: app.selected[0]?.layer || 'default' }] }); if (!r) return; id = r.l; }
      if (!layerById(app, id)) return;
      patch(app, 'Move to Layer', (e) => { e.layer = id === 'default' ? undefined : id; });
    },
  },
  {
    id: 'arrange.newLayer', label: 'New Layer…', icon: 'add', tab: 'Arrange', group: 'Size and Position', edits: true,
    run: async (app) => { const n = await promptDialog('New Layer', 'Name', `Layer ${app.pub.data.layers.length + 1}`); if (!n) return; const l: Layer = { id: newId('ly'), name: n, color: ['#5B3C9E', '#C2502A', '#1E7A46', '#0D5C8A', '#B3261E'][app.pub.data.layers.length % 5] }; app.pub.transact('New Layer', () => { app.pub.data.layers.push(l); }); if (app.selected.length) patch(app, 'Move to Layer', (e) => { e.layer = l.id; }); },
  },
  {
    id: 'arrange.deleteLayer', label: 'Delete Layer…', icon: 'delete', tab: 'Arrange', group: 'Size and Position', edits: true,
    run: async (app, id?: string) => {
      const pub = app.pub;
      const l = layerById(app, id); if (!l) return;
      if (l.id === 'default') { toast('The first layer cannot be deleted.'); return; }
      const count = [...pub.pages, ...pub.data.masters].reduce((a, o) => a + flatItems(o).filter((e) => e.layer === l.id).length, 0);
      if (!(await confirmDialog('Delete Layer', count ? `Delete "${l.name}" and its ${count} object(s)?` : `Delete "${l.name}"?`, 'Delete'))) return;
      pub.transact('Delete Layer', () => { pub.data.layers = pub.data.layers.filter((x) => x !== l); for (const o of [...pub.pages, ...pub.data.masters]) o.items = o.items.filter((e) => e.layer !== l.id); pub.pruneStories(); });
    },
  },
  {
    id: 'arrange.layerOptions', label: 'Layer Options…', icon: 'tune', tab: 'Arrange', group: 'Size and Position', edits: true,
    run: async (app, id?: string) => {
      const l = layerById(app, id || app.selected[0]?.layer); if (!l) return;
      const r = await openDialog({ title: `Layer: ${l.name}`, fields: [{ key: 'name', label: 'Name', type: 'text', value: l.name }, { key: 'color', label: 'Selection color', type: 'color', value: l.color || '#5B3C9E', half: true }, { key: 'hidden', label: 'Hidden', type: 'checkbox', value: !!l.hidden, half: true }, { key: 'locked', label: 'Locked', type: 'checkbox', value: !!l.locked, half: true }] });
      if (!r) return;
      app.pub.transact('Layer Options', () => { l.name = r.name || l.name; l.color = r.color; l.hidden = r.hidden || undefined; l.locked = r.locked || undefined; });
      app.tab.ui.invalidate();
    },
  },
  { id: 'arrange.toggleLayer', label: 'Show/Hide Layer', icon: 'visibility', tab: 'Arrange', group: 'Size and Position', internal: true, edits: true, run: (app, id: string) => { const l = layerById(app, id); if (!l) return; app.pub.transact(l.hidden ? 'Show Layer' : 'Hide Layer', () => { l.hidden = !l.hidden || undefined; }); app.tab.ui.invalidate(); } },
  { id: 'arrange.lockLayer', label: 'Lock/Unlock Layer', icon: 'lock', tab: 'Arrange', group: 'Size and Position', internal: true, edits: true, run: (app, id: string) => { const l = layerById(app, id); if (!l) return; app.pub.transact(l.locked ? 'Unlock Layer' : 'Lock Layer', () => { l.locked = !l.locked || undefined; }); app.tab.ui.invalidate(); } },
  {
    id: 'arrange.makeSameSize', label: 'Make Same Size', icon: 'photo_size_select_small', tab: 'Arrange', group: 'Size and Position', kind: 'menu', edits: true, isEnabled: many,
    tip: 'Give every selected object the size of the first one selected',
    menu: () => [{ id: 'arrange.makeSameSize', arg: 'w', label: 'Same Width' }, { id: 'arrange.makeSameSize', arg: 'h', label: 'Same Height' }, { id: 'arrange.makeSameSize', arg: 'both', label: 'Same Width and Height' }],
    run: (app, how = 'both') => { const ref = app.selected[0]; if (!ref) return; patch(app, 'Make Same Size', (e) => { if (e === ref) return; setBox(e, { w: how === 'h' ? e.w : ref.w, h: how === 'w' ? e.h : ref.h }); }); },
  },
  {
    id: 'arrange.menu', label: 'Arrange', icon: 'flip_to_front', tab: 'Home', group: 'Objects', kind: 'menu', edits: true,
    menu: () => [{ id: 'arrange.bringToFront', label: 'Bring to Front', icon: 'flip_to_front' }, { id: 'arrange.bringForward', label: 'Bring Forward', icon: 'arrow_upward' }, { id: 'arrange.sendBackward', label: 'Send Backward', icon: 'arrow_downward' }, { id: 'arrange.sendToBack', label: 'Send to Back', icon: 'flip_to_back' }, { separator: true }, { id: 'arrange.group', label: 'Group', icon: 'join' }, { id: 'arrange.ungroup', label: 'Ungroup', icon: 'join_left' }, { separator: true }, { id: 'arrange.align', label: 'Align…', icon: 'align_horizontal_left' }, { id: 'arrange.rotate', label: 'Rotate…', icon: 'rotate_right' }, { id: 'arrange.wrap', label: 'Text Wrap…', icon: 'wrap_text' }, { id: 'arrange.sizeDialog', label: 'Size and Position…', icon: 'aspect_ratio' }],
    run: (app) => app.exec('arrange.sizeDialog'),
  },
  { id: 'arrange.nudge', label: 'Nudge', icon: 'open_with', tab: 'Arrange', group: 'Size and Position', internal: true, edits: true, run: (app, d: { dx: number; dy: number }) => patch(app, 'Nudge', (e) => setBox(e, { x: e.x + (d?.dx || 0), y: e.y + (d?.dy || 0) })) },
]);

function r_dy(e: Item): number { return e.h + 9; }
