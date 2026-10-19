/** Shape, frame and line formatting: geometry, object styles, fill, outline, effects, transparency, size. */
import { def, type MenuEntry } from './registry';
import type { App } from '../app';
import type { ArrowEnd, Dash, Fill, Item, Line, ObjectStyle, ShapeItem, TextFrame } from '../model/types';
import { UNITS } from '../model/types';
import { clone, newId, emptyParas } from '../model/pub';
import { GEOMETRY, SHAPE_GROUPS } from '../model/geometry';
import { colorHex } from '../model/styles';
import { selection, edit, setFill, setLine, setBox } from '../edit/ops';
import { openDialog, toast, colorMenu, confirmDialog, showMenu } from '../ui/dialog';

const u = (app: App) => UNITS[app.prefs.unit];
const toU = (app: App, pt: number) => +(pt / u(app).pt).toFixed(u(app).digits);
const fromU = (app: App, v: any) => Math.max(0, (+v || 0) * u(app).pt);
const hasSel = (app: App) => app.selected.length > 0;

function patch(app: App, label: string, fn: (e: Item) => void): void {
  const sel = selection(app);
  if (!sel.length) { toast('Select an object first.'); return; }
  edit(app, label, () => sel.forEach(fn));
}

const DASHES: { v: Dash; label: string }[] = [{ v: 'solid', label: 'Solid' }, { v: 'dash', label: 'Dashed' }, { v: 'dot', label: 'Dotted' }, { v: 'dashDot', label: 'Dash-dot' }, { v: 'longDash', label: 'Long dashes' }, { v: 'longDashDot', label: 'Long dash-dot' }, { v: 'sysDash', label: 'Short dashes' }, { v: 'sysDot', label: 'Fine dots' }];
const ENDS: { v: ArrowEnd; label: string }[] = [{ v: 'none', label: 'None' }, { v: 'triangle', label: 'Triangle' }, { v: 'arrow', label: 'Open arrow' }, { v: 'stealth', label: 'Stealth' }, { v: 'diamond', label: 'Diamond' }, { v: 'oval', label: 'Circle' }];
const WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12];

function swatchEntries(app: App, id: string, cur?: string): MenuEntry[] {
  return app.pub.data.swatches.map((s) => ({ id, arg: s.name, label: s.name, checked: cur === s.name, swatch: s.color === 'none' ? 'transparent' : colorHex(app.pub.data, s.color) }));
}

async function pickColor(app: App, id: string, arg: any, opts: { none?: string; title: string }): Promise<string | null | undefined> {
  if (typeof arg === 'string' && arg !== 'menu') return arg;
  return colorMenu(app.ui.anchorFor(id), { none: opts.none, title: opts.title });
}

async function objectStyleDialog(app: App, st?: ObjectStyle, from?: Item): Promise<ObjectStyle | null> {
  const names = app.pub.data.styles.object.map((s) => s.name).filter((n) => n !== st?.name);
  const fill = st?.fill ?? from?.fill, line = st?.line ?? from?.line, eff = st?.effects ?? from?.effects;
  const ins = st?.insets ?? (from?.kind === 'text' ? from.insets : undefined) ?? [4, 4, 4, 4];
  const r = await openDialog({ title: st ? `Object Style: ${st.name}` : 'New Object Style', wide: true, fields: [
    { key: 'name', label: 'Name', type: 'text', value: st?.name || `Object Style ${app.pub.data.styles.object.length + 1}` },
    { key: 'fillKind', label: 'Fill', type: 'select', options: [{ value: 'keep', label: '(not set by the style)' }, { value: 'none', label: 'None' }, { value: 'solid', label: 'Solid color' }], value: !fill ? 'keep' : fill.type === 'none' ? 'none' : 'solid', half: true },
    { key: 'fill', label: 'Fill color', type: 'color', value: fill?.type === 'solid' ? colorHex(app.pub.data, fill.color) : '#5B3C9E', half: true, visibleIf: (v) => v.fillKind === 'solid' },
    { key: 'lineKind', label: 'Outline', type: 'select', options: [{ value: 'keep', label: '(not set by the style)' }, { value: 'none', label: 'None' }, { value: 'solid', label: 'Line' }], value: !line ? 'keep' : line.fill?.type === 'none' ? 'none' : 'solid', half: true },
    { key: 'lineColor', label: 'Outline color', type: 'color', value: line?.fill?.type === 'solid' ? colorHex(app.pub.data, line.fill.color) : '#000000', half: true, visibleIf: (v) => v.lineKind === 'solid' },
    { key: 'lineWidth', label: 'Outline width (pt)', type: 'number', min: 0, step: 0.25, value: line?.width ?? 1, half: true, visibleIf: (v) => v.lineKind === 'solid' },
    { key: 'dash', label: 'Dash', type: 'select', options: DASHES.map((d) => ({ value: d.v, label: d.label })), value: line?.dash || 'solid', half: true, visibleIf: (v) => v.lineKind === 'solid' },
    { key: 'shadow', label: 'Drop shadow', type: 'checkbox', value: !!eff?.shadow, half: true },
    { key: 'l', label: `Inset left (${u(app).label}, text frames)`, type: 'number', min: 0, value: toU(app, ins[0]), half: true }, { key: 't', label: 'Inset top', type: 'number', min: 0, value: toU(app, ins[1]), half: true },
    { key: 'r', label: 'Inset right', type: 'number', min: 0, value: toU(app, ins[2]), half: true }, { key: 'b', label: 'Inset bottom', type: 'number', min: 0, value: toU(app, ins[3]), half: true },
    { key: 'cols', label: 'Columns (text frames)', type: 'number', min: 1, max: 20, value: st?.columns || 1, half: true },
  ], validate: (v) => (!v.name?.trim() ? 'Give the style a name.' : names.includes(v.name.trim()) ? 'A style with that name exists.' : null) });
  if (!r) return null;
  const out: ObjectStyle = { name: r.name.trim() };
  if (r.fillKind === 'none') out.fill = { type: 'none' }; else if (r.fillKind === 'solid') out.fill = { type: 'solid', color: r.fill };
  if (r.lineKind === 'none') out.line = { fill: { type: 'none' } }; else if (r.lineKind === 'solid') out.line = { fill: { type: 'solid', color: r.lineColor }, width: +r.lineWidth || 0.5, dash: r.dash === 'solid' ? undefined : r.dash };
  if (r.shadow) out.effects = { shadow: eff?.shadow || { color: '#000000', blur: 4, dist: 3, dir: 45, alpha: 0.35 } };
  out.insets = [fromU(app, r.l), fromU(app, r.t), fromU(app, r.r), fromU(app, r.b)];
  if (+r.cols > 1) out.columns = +r.cols;
  return out;
}

/** Applies an object style: the item keeps only the overrides a style does not define. */
function applyObjectStyle(app: App, e: Item, st: ObjectStyle | undefined): void {
  e.ostyle = st?.name;
  if (!st) return;
  if (st.fill) delete e.fill; if (st.line) delete e.line; if (st.effects) delete e.effects;
  if (e.kind === 'text') { if (st.insets) e.insets = [...st.insets]; if (st.columns) e.columns = st.columns; if (st.gutter != null) e.gutter = st.gutter; }
}

def([
  {
    id: 'shape.change', label: 'Change Shape', icon: 'change_circle', tab: 'Arrange', group: 'Shape', kind: 'gallery', edits: true, isEnabled: hasSel,
    tip: 'Give the selected frames or shapes another geometry (text and pictures stay)',
    menu: (app) => { const cur = (app.selected[0] as ShapeItem | undefined)?.geom; const out: MenuEntry[] = []; for (const g of SHAPE_GROUPS) { if (g === 'Lines') continue; const items = Object.entries(GEOMETRY).filter(([, d]) => d.group === g); if (!items.length) continue; out.push({ heading: g }); for (const [id, d] of items) out.push({ id: 'shape.change', arg: id, label: d.label, checked: cur === id }); } return out; },
    run: (app, geom?: string) => {
      if (!geom || !GEOMETRY[geom]) { const c = app.selected[0]; showMenu(Object.entries(GEOMETRY).filter(([, d]) => d.group !== 'Lines').map(([id, d]) => ({ id: 'shape.change', arg: id, label: d.label, checked: (c as any)?.geom === id })), { anchor: app.ui.anchorFor('shape.change'), onPick: (e) => app.exec('shape.change', e.arg) }); return; }
      patch(app, 'Change Shape', (e) => { if (e.kind === 'shape') { e.geom = geom; delete e.path; delete e.adj; } else if (e.kind === 'text' || e.kind === 'picture') e.geom = geom === 'rect' ? undefined : geom; });
    },
  },
  {
    id: 'shape.editPoints', label: 'Edit Points…', icon: 'polyline', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: (app) => app.selected[0]?.kind === 'shape',
    tip: 'Edit the shape as an SVG path (M, L, C, Q, Z commands in a 100 × 100 box)',
    run: async (app) => {
      const e = app.selected[0] as ShapeItem | undefined;
      if (!e || e.kind !== 'shape') return;
      const { geometryPath } = await import('../model/geometry');
      const cur = e.path?.[0]?.d || geometryPath(e.geom, 100, 100, e.adj).d;
      const r = await openDialog({ title: 'Edit Points', wide: true, fields: [{ key: 'd', label: 'Path (coordinates 0–100 scale to the shape\'s box)', type: 'textarea', rows: 6, value: cur }], validate: (v) => (/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/.test(v.d) ? null : 'Only path commands and numbers are allowed.') });
      if (!r) return;
      edit(app, 'Edit Points', () => { e.geom = 'custom'; e.path = [{ d: String(r.d).trim(), w: 100, h: 100 }]; });
    },
  },
  {
    id: 'shape.objectStyle', label: 'Object Styles', icon: 'style', tab: 'Arrange', group: 'Shape', kind: 'menu', edits: true, isEnabled: hasSel,
    tip: 'Named fills, outlines, effects and insets for frames and shapes',
    menu: (app) => { const cur = app.selected[0]?.ostyle; return [{ id: 'shape.objectStyle', arg: '', label: '[None]', checked: !cur }, ...app.pub.data.styles.object.map((s) => ({ id: 'shape.objectStyle', arg: s.name, label: s.name, checked: cur === s.name })), { separator: true }, { id: 'shape.newObjectStyle', label: 'New Object Style…', icon: 'add' }, { id: 'fmt.stylesPane', label: 'Styles Pane', icon: 'style' }]; },
    run: async (app, name?: string) => {
      if (name === undefined) { const r = await openDialog({ title: 'Object Style', fields: [{ key: 's', label: 'Style', type: 'list', options: [{ value: '', label: '[None]' }, ...app.pub.data.styles.object.map((s) => s.name)], value: app.selected[0]?.ostyle || '' }] }); if (!r) return; name = r.s; }
      const st = name ? app.pub.objectStyle(name) : undefined;
      if (name && !st) { toast(`No object style named "${name}".`); return; }
      patch(app, 'Object Style', (e) => applyObjectStyle(app, e, st));
    },
  },
  { id: 'shape.newObjectStyle', label: 'New Object Style…', icon: 'add', tab: 'Arrange', group: 'Shape', edits: true, tip: 'A new object style from the selected object\'s formatting', run: async (app) => { const st = await objectStyleDialog(app, undefined, app.selected[0]); if (!st) return; app.pub.transact('New Object Style', () => { app.pub.data.styles.object.push(st); }); if (app.selected.length) patch(app, 'Object Style', (e) => applyObjectStyle(app, e, st)); } },
  {
    id: 'shape.modifyObjectStyle', label: 'Modify Object Style…', icon: 'edit', tab: 'Arrange', group: 'Shape', edits: true,
    run: async (app, name?: string) => { const st = app.pub.objectStyle(name || app.selected[0]?.ostyle); if (!st) { toast('Select an object that uses an object style, or choose one in the Styles pane.'); return; } const out = await objectStyleDialog(app, st); if (!out) return; app.pub.transact('Modify Object Style', () => { const i = app.pub.data.styles.object.indexOf(st); app.pub.data.styles.object[i] = out; if (out.name !== st.name) for (const o of [...app.pub.pages, ...app.pub.data.masters]) for (const e of o.items) if (e.ostyle === st.name) e.ostyle = out.name; }); },
  },
  {
    id: 'shape.redefineObjectStyle', label: 'Redefine Object Style from Selection', icon: 'sync_alt', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: hasSel,
    run: (app, name?: string) => { const e = app.selected[0]; const st = app.pub.objectStyle(name || e?.ostyle); if (!e || !st) { toast('Select an object that uses an object style first.'); return; } app.pub.transact('Redefine Object Style', () => { if (e.fill) st.fill = clone(e.fill); if (e.line) st.line = clone(e.line); if (e.effects) st.effects = clone(e.effects); if (e.kind === 'text') { if (e.insets) st.insets = [...e.insets]; if (e.columns) st.columns = e.columns; } delete e.fill; delete e.line; delete e.effects; }); },
  },
  { id: 'shape.duplicateObjectStyle', label: 'Duplicate Object Style', icon: 'content_copy', tab: 'Arrange', group: 'Shape', edits: true, run: async (app, name?: string) => { const st = app.pub.objectStyle(name || app.selected[0]?.ostyle); if (!st) return; let n = `${st.name} copy`, k = 2; while (app.pub.objectStyle(n)) n = `${st.name} copy ${k++}`; const out = await objectStyleDialog(app, { ...clone(st), name: n }); if (out) app.pub.transact('Duplicate Object Style', () => { app.pub.data.styles.object.push(out); }); } },
  {
    id: 'shape.deleteObjectStyle', label: 'Delete Object Style…', icon: 'delete', tab: 'Arrange', group: 'Shape', edits: true,
    run: async (app, name?: string) => { const st = app.pub.objectStyle(name || app.selected[0]?.ostyle); if (!st) return; if (!(await confirmDialog('Delete Object Style', `Delete "${st.name}"? Objects using it keep their look as local formatting.`, 'Delete'))) return; app.pub.transact('Delete Object Style', () => { for (const o of [...app.pub.pages, ...app.pub.data.masters]) for (const e of o.items) if (e.ostyle === st.name) { e.fill ??= st.fill ? clone(st.fill) : undefined; e.line ??= st.line ? clone(st.line) : undefined; e.effects ??= st.effects ? clone(st.effects) : undefined; delete e.ostyle; } app.pub.data.styles.object = app.pub.data.styles.object.filter((s) => s !== st); }); },
  },
  {
    id: 'shape.fill', label: 'Fill', icon: 'format_color_fill', tab: 'Arrange', group: 'Shape', kind: 'color', popular: true, edits: true, isEnabled: hasSel,
    tip: 'Fill color of the selected frames and shapes (the arrow picks a color or swatch)',
    run: async (app, arg) => {
      if (arg === 'menu' || arg == null) {
        const cur = app.selected[0]?.fill;
        showMenu([{ heading: 'Swatches' }, ...swatchEntries(app, 'shape.applySwatch', cur?.type === 'solid' ? cur.color : undefined), { separator: true }, { id: 'shape.fill', arg: 'none', label: 'No Fill', icon: 'block' }, { id: 'shape.fill', arg: 'pick', label: 'More Colors…', icon: 'palette' }, { id: 'shape.gradient', label: 'Gradient…', icon: 'gradient' }, { id: 'shape.pictureFill', label: 'Picture Fill…', icon: 'image' }], { anchor: app.ui.anchorFor('shape.fill'), onPick: (e) => app.exec(e.id!, e.arg) });
        return;
      }
      if (arg === 'none') { setFill(app, { type: 'none' }, 'No Fill'); return; }
      if (arg === 'pick') { const c = await colorMenu(app.ui.anchorFor('shape.fill'), { title: 'Fill color', none: 'No Fill' }); if (c === undefined) return; setFill(app, c ? { type: 'solid', color: c } : { type: 'none' }); return; }
      setFill(app, { type: 'solid', color: String(arg) });
    },
  },
  { id: 'shape.applySwatch', label: 'Apply Swatch', icon: 'colorize', tab: 'Arrange', group: 'Shape', edits: true, tip: 'Fill the selected objects (or color the text being edited) with a swatch', run: async (app, name: string) => { const { activeTextEditor } = await import('../edit/textEdit'); if (activeTextEditor()) { app.exec('fmt.fontColor', name); return; } if (!app.pub.swatch(name)) return; if (name === 'None') setFill(app, { type: 'none' }); else setFill(app, { type: 'solid', color: name }, 'Fill'); } },
  {
    id: 'shape.gradient', label: 'Gradient Fill…', icon: 'gradient', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: hasSel,
    run: async (app) => {
      const cur = app.selected[0]?.fill;
      const g = cur?.type === 'gradient' ? cur : undefined;
      const r = await openDialog({ title: 'Gradient Fill', fields: [{ key: 'a', label: 'From', type: 'color', value: g ? colorHex(app.pub.data, g.stops[0].color) : '#5B3C9E', half: true }, { key: 'b', label: 'To', type: 'color', value: g ? colorHex(app.pub.data, g.stops[g.stops.length - 1].color) : '#FFFFFF', half: true }, { key: 'path', label: 'Type', type: 'select', options: [{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }], value: g?.path || 'linear', half: true }, { key: 'angle', label: 'Angle (°)', type: 'number', min: 0, max: 360, value: g?.angle ?? 90, half: true, visibleIf: (v) => v.path === 'linear' }] });
      if (!r) return;
      setFill(app, { type: 'gradient', stops: [{ pos: 0, color: r.a }, { pos: 1, color: r.b }], angle: +r.angle, path: r.path }, 'Gradient Fill');
    },
  },
  {
    id: 'shape.pictureFill', label: 'Picture Fill…', icon: 'image', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: hasSel,
    run: async (app) => {
      const { pickFile } = await import('../ui/dom');
      const { IMAGE_ACCEPT, mediaFromBytes } = await import('../io/images');
      const f = (await pickFile(IMAGE_ACCEPT))[0]; if (!f) return;
      const m = await mediaFromBytes(new Uint8Array(await f.arrayBuffer()), f.name);
      const id = app.pub.addMedia(m);
      setFill(app, { type: 'image', media: id, mode: 'stretch' }, 'Picture Fill');
    },
  },
  {
    id: 'shape.outline', label: 'Outline', icon: 'border_color', tab: 'Arrange', group: 'Shape', kind: 'color', popular: true, edits: true, isEnabled: hasSel,
    tip: 'Outline color, width and dash of the selected objects',
    run: async (app, arg) => {
      if (arg === 'menu' || arg == null) {
        const cur = app.selected[0]?.line;
        showMenu([{ heading: 'Swatches' }, ...swatchEntries(app, 'shape.outlineColor', cur?.fill?.type === 'solid' ? cur.fill.color : undefined), { separator: true }, { id: 'shape.outline', arg: 'none', label: 'No Outline', icon: 'block' }, { id: 'shape.outline', arg: 'pick', label: 'More Colors…', icon: 'palette' }, { heading: 'Width' }, ...WIDTHS.map((w) => ({ id: 'shape.lineWidth', arg: w, label: `${w} pt`, checked: cur?.width === w })), { heading: 'Dash' }, ...DASHES.map((d) => ({ id: 'shape.lineDash', arg: d.v, label: d.label, checked: (cur?.dash || 'solid') === d.v }))], { anchor: app.ui.anchorFor('shape.outline'), onPick: (e) => app.exec(e.id!, e.arg) });
        return;
      }
      if (arg === 'none') { setLine(app, { fill: { type: 'none' } }, 'No Outline'); return; }
      if (arg === 'pick') { const c = await colorMenu(app.ui.anchorFor('shape.outline'), { title: 'Outline color', none: 'No Outline' }); if (c === undefined) return; setLine(app, (cur) => ({ ...cur, fill: c ? { type: 'solid', color: c } : { type: 'none' }, width: cur.width || 1 })); return; }
      setLine(app, (cur) => ({ ...cur, fill: { type: 'solid', color: String(arg) }, width: cur.width || 1 }));
    },
  },
  { id: 'shape.outlineColor', label: 'Outline Color', icon: 'border_color', tab: 'Arrange', group: 'Shape', edits: true, run: (app, name: string) => { if (name === 'None') setLine(app, { fill: { type: 'none' } }, 'No Outline'); else setLine(app, (cur) => ({ ...cur, fill: { type: 'solid', color: name }, width: cur.width || 1 }), 'Outline Color'); } },
  {
    id: 'shape.lineWidth', label: 'Line Width', icon: 'line_weight', tab: 'Arrange', group: 'Shape', kind: 'size', edits: true, isEnabled: hasSel,
    value: (app) => app.selected[0]?.line?.width ?? '',
    menu: (app) => WIDTHS.map((w) => ({ id: 'shape.lineWidth', arg: w, label: `${w} pt`, checked: app.selected[0]?.line?.width === w })),
    run: (app, w?: number | string) => { const n = parseFloat(String(w)); if (isNaN(n) || n < 0) return; setLine(app, (cur) => ({ ...cur, width: n, fill: cur.fill?.type === 'none' || !cur.fill ? { type: 'solid', color: 'Black' } : cur.fill }), 'Line Width'); },
  },
  { id: 'shape.lineDash', label: 'Line Dash', icon: 'line_style', tab: 'Arrange', group: 'Shape', kind: 'menu', edits: true, isEnabled: hasSel, menu: (app) => DASHES.map((d) => ({ id: 'shape.lineDash', arg: d.v, label: d.label, checked: (app.selected[0]?.line?.dash || 'solid') === d.v })), run: (app, d?: Dash) => { if (!d) return; setLine(app, { dash: d === 'solid' ? undefined : d }, 'Line Dash'); } },
  {
    id: 'shape.lineEnds', label: 'Line Ends', icon: 'arrow_range', tab: 'Arrange', group: 'Shape', kind: 'menu', edits: true, isEnabled: hasSel,
    menu: (app) => { const l = app.selected[0]?.line; return [{ heading: 'Start' }, ...ENDS.map((e) => ({ id: 'shape.lineEnds', arg: { tail: e.v }, label: e.label, checked: (l?.tail || 'none') === e.v })), { heading: 'End' }, ...ENDS.map((e) => ({ id: 'shape.lineEnds', arg: { head: e.v }, label: e.label, checked: (l?.head || 'none') === e.v }))]; },
    run: async (app, arg?: { head?: ArrowEnd; tail?: ArrowEnd }) => {
      if (!arg) { const l = app.selected[0]?.line; const r = await openDialog({ title: 'Line Ends', fields: [{ key: 'tail', label: 'Start', type: 'select', options: ENDS.map((e) => ({ value: e.v, label: e.label })), value: l?.tail || 'none', half: true }, { key: 'head', label: 'End', type: 'select', options: ENDS.map((e) => ({ value: e.v, label: e.label })), value: l?.head || 'none', half: true }, { key: 'cap', label: 'Cap', type: 'select', options: ['flat', 'round', 'square'], value: l?.cap || 'flat', half: true }, { key: 'join', label: 'Join', type: 'select', options: ['miter', 'round', 'bevel'], value: l?.join || 'miter', half: true }] }); if (!r) return; arg = { head: r.head, tail: r.tail }; setLine(app, { head: r.head === 'none' ? undefined : r.head, tail: r.tail === 'none' ? undefined : r.tail, cap: r.cap === 'flat' ? undefined : r.cap, join: r.join === 'miter' ? undefined : r.join }, 'Line Ends'); return; }
      setLine(app, (cur) => ({ ...cur, ...(arg!.head !== undefined ? { head: arg!.head === 'none' ? undefined : arg!.head } : {}), ...(arg!.tail !== undefined ? { tail: arg!.tail === 'none' ? undefined : arg!.tail } : {}) }), 'Line Ends');
    },
  },
  {
    id: 'shape.effects', label: 'Effects', icon: 'auto_awesome', tab: 'Arrange', group: 'Shape', kind: 'menu', edits: true, isEnabled: hasSel,
    menu: (app) => { const e = app.selected[0]?.effects; return [{ id: 'shape.effects', arg: 'shadow', label: 'Drop Shadow', checked: !!e?.shadow }, { id: 'shape.effects', arg: 'glow', label: 'Glow', checked: !!e?.glow }, { id: 'shape.effects', arg: 'soft', label: 'Soft Edges', checked: !!e?.softEdge }, { separator: true }, { id: 'shape.effects', arg: 'dialog', label: 'Effect Options…' }, { id: 'shape.effects', arg: 'none', label: 'No Effects' }]; },
    run: async (app, what?: string) => {
      if (what === 'none') { patch(app, 'No Effects', (e) => { delete e.effects; }); return; }
      if (what === 'shadow') { const on = !!app.selected[0]?.effects?.shadow; patch(app, 'Drop Shadow', (e) => { e.effects = { ...(e.effects || {}), shadow: on ? undefined : { color: '#000000', blur: 4, dist: 3, dir: 45, alpha: 0.35 } }; }); return; }
      if (what === 'glow') { const on = !!app.selected[0]?.effects?.glow; patch(app, 'Glow', (e) => { e.effects = { ...(e.effects || {}), glow: on ? undefined : { color: 'Accent', rad: 6 } }; }); return; }
      if (what === 'soft') { const on = !!app.selected[0]?.effects?.softEdge; patch(app, 'Soft Edges', (e) => { e.effects = { ...(e.effects || {}), softEdge: on ? undefined : 4 }; }); return; }
      const cur = app.selected[0]?.effects || {};
      const r = await openDialog({ title: 'Effects', fields: [
        { key: 'shadow', label: 'Drop shadow', type: 'checkbox', value: !!cur.shadow }, { key: 'sc', label: 'Shadow color', type: 'color', value: cur.shadow ? colorHex(app.pub.data, cur.shadow.color) : '#000000', half: true, visibleIf: (v) => v.shadow }, { key: 'sa', label: 'Shadow opacity (%)', type: 'number', min: 0, max: 100, value: Math.round((cur.shadow?.alpha ?? 0.35) * 100), half: true, visibleIf: (v) => v.shadow },
        { key: 'sb', label: 'Blur (pt)', type: 'number', min: 0, max: 50, value: cur.shadow?.blur ?? 4, half: true, visibleIf: (v) => v.shadow }, { key: 'sd', label: 'Distance (pt)', type: 'number', min: 0, max: 100, value: cur.shadow?.dist ?? 3, half: true, visibleIf: (v) => v.shadow }, { key: 'sdir', label: 'Direction (°)', type: 'number', min: 0, max: 360, value: cur.shadow?.dir ?? 45, half: true, visibleIf: (v) => v.shadow },
        { key: 'glow', label: 'Glow', type: 'checkbox', value: !!cur.glow }, { key: 'gc', label: 'Glow color', type: 'color', value: cur.glow ? colorHex(app.pub.data, cur.glow.color) : '#F2A33A', half: true, visibleIf: (v) => v.glow }, { key: 'gr', label: 'Glow size (pt)', type: 'number', min: 0, max: 50, value: cur.glow?.rad ?? 6, half: true, visibleIf: (v) => v.glow },
        { key: 'soft', label: 'Soft edges (pt, 0 = none)', type: 'number', min: 0, max: 50, value: cur.softEdge ?? 0 },
      ] });
      if (!r) return;
      patch(app, 'Effects', (e) => { const eff: any = {}; if (r.shadow) eff.shadow = { color: r.sc, alpha: +r.sa / 100, blur: +r.sb, dist: +r.sd, dir: +r.sdir }; if (r.glow) eff.glow = { color: r.gc, rad: +r.gr }; if (+r.soft > 0) eff.softEdge = +r.soft; e.effects = Object.keys(eff).length ? eff : undefined; });
    },
  },
  {
    id: 'shape.transparency', label: 'Transparency', icon: 'opacity', tab: 'Arrange', group: 'Shape', kind: 'size', edits: true, isEnabled: hasSel,
    tip: 'Opacity of the whole object (%)',
    value: (app) => Math.round((app.selected[0]?.alpha ?? 1) * 100),
    menu: () => [100, 90, 75, 50, 25, 10].map((v) => ({ id: 'shape.transparency', arg: v, label: `${v}% opaque` })),
    run: (app, v?: number | string) => { const n = parseFloat(String(v)); if (isNaN(n)) return; patch(app, 'Transparency', (e) => { e.alpha = n >= 100 ? undefined : Math.max(0, n) / 100; }); },
  },
  {
    id: 'shape.convertToText', label: 'Convert to Text Frame', icon: 'text_fields', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: (app) => app.selected.some((e) => e.kind === 'shape' || e.kind === 'picture'),
    tip: 'Make the selected shape or picture frame a text frame of the same geometry (type into it)',
    run: (app) => {
      const sel = selection(app).filter((e) => e.kind === 'shape' || e.kind === 'picture');
      if (!sel.length) { toast('Select a shape or picture frame first.'); return; }
      const ids: string[] = [];
      edit(app, 'Convert to Text Frame', (o) => {
        for (const e of sel) {
          const s = app.pub.newStory(emptyParas());
          const f: TextFrame = { id: newId('tf'), kind: 'text', story: s.id, name: e.name || 'Text Frame', x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot, fill: e.fill, line: e.line, effects: e.effects, alpha: e.alpha, layer: e.layer, wrap: e.wrap, geom: e.kind === 'shape' ? e.geom : e.geom, insets: [6, 6, 6, 6], anchor: 'ctr' };
          const i = o.items.indexOf(e);
          if (i >= 0) o.items[i] = f; else o.items.push(f);
          ids.push(f.id);
        }
      });
      app.tab.ui.select(ids);
      if (ids.length === 1) app.tab.ui.editText(ids[0]);
    },
  },
  {
    id: 'shape.convertToPicture', label: 'Convert to Picture Frame', icon: 'crop_original', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: (app) => app.selected.some((e) => e.kind === 'shape'),
    tip: 'Make the selected shape an empty picture frame of the same geometry',
    run: (app) => {
      const sel = selection(app).filter((e) => e.kind === 'shape') as ShapeItem[];
      edit(app, 'Convert to Picture Frame', (o) => { for (const e of sel) { const i = o.items.indexOf(e); const p: Item = { id: newId('pic'), kind: 'picture', name: e.name || 'Picture Frame', x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot, line: e.line, geom: e.geom === 'rect' ? undefined : e.geom, fit: 'fill', layer: e.layer, wrap: e.wrap }; if (i >= 0) o.items[i] = p; } });
    },
  },
  {
    id: 'shape.height', label: 'Height', icon: 'height', tab: 'Arrange', group: 'Size', kind: 'size', edits: true, isEnabled: hasSel,
    value: (app) => (app.selected[0] ? toU(app, app.selected[0].h) : ''),
    run: (app, v?: number | string) => { const n = parseFloat(String(v)); if (isNaN(n)) return; patch(app, 'Height', (e) => setBox(e, { h: fromU(app, n) })); },
  },
  {
    id: 'shape.width', label: 'Width', icon: 'width', tab: 'Arrange', group: 'Size', kind: 'size', edits: true, isEnabled: hasSel,
    value: (app) => (app.selected[0] ? toU(app, app.selected[0].w) : ''),
    run: (app, v?: number | string) => { const n = parseFloat(String(v)); if (isNaN(n)) return; patch(app, 'Width', (e) => setBox(e, { w: fromU(app, n) })); },
  },
  {
    id: 'shape.corners', label: 'Corner Rounding…', icon: 'rounded_corner', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: hasSel,
    tip: 'Round the corners of rectangular frames and shapes',
    run: async (app) => {
      const e = app.selected[0] as ShapeItem | undefined;
      const r = await openDialog({ title: 'Corner Rounding', fields: [{ key: 'k', label: 'Rounding (% of the shorter side, 0 = square)', type: 'number', min: 0, max: 50, value: e?.kind === 'shape' && e.geom === 'roundRect' ? Math.round((e.adj?.adj ?? 16667) / 1000) : 0 }] });
      if (!r) return;
      const k = +r.k;
      patch(app, 'Corner Rounding', (x) => { if (x.kind === 'shape') { x.geom = k > 0 ? 'roundRect' : 'rect'; x.adj = k > 0 ? { adj: k * 1000 } : undefined; } else if (x.kind === 'text' || x.kind === 'picture') x.geom = k > 0 ? 'roundRect' : undefined; });
    },
  },
  {
    id: 'shape.name', label: 'Name Object…', icon: 'label', tab: 'Arrange', group: 'Shape', edits: true, isEnabled: hasSel,
    run: async (app) => { const e = app.selected[0]; if (!e) return; const { promptDialog } = await import('../ui/dialog'); const n = await promptDialog('Name Object', 'Name (shown in the Layers pane and Navigator)', e.name || ''); if (n == null) return; edit(app, 'Name Object', () => { e.name = n.trim() || undefined; }); },
  },
]);

