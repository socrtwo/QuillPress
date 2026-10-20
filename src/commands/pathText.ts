/** Text on a path: presets, conversion from shapes and lines, alignment and offsets along the path. */
import { def, type MenuEntry } from './registry';
import type { App } from '../app';
import type { Item, Paragraph, PathTextItem } from '../model/types';
import { newId } from '../model/pub';
import { geometryPath } from '../model/geometry';
import { PATH_TEXT_PRESETS, pathTextString } from '../render/pathText';
import { selection, edit, placeNew, insertItem, pathTextTargets } from '../edit/ops';
import { paraText } from '../edit/textEdit';
import { openDialog, toast, showMenu } from '../ui/dialog';

const hasPath = (app: App) => pathTextTargets(app).length > 0;

function onePath(app: App): PathTextItem | undefined {
  const e = pathTextTargets(app)[0];
  if (!e) toast('Select text on a path first (Insert ▸ Text on a Path).');
  return e;
}

function patchPaths(app: App, label: string, fn: (e: PathTextItem) => void): void {
  const els = pathTextTargets(app);
  if (!els.length) { toast('Select text on a path first.'); return; }
  edit(app, label, () => els.forEach(fn));
}

/** A new path text item from a preset at a box. */
export function makePathText(preset: string, b: { x: number; y: number; w: number; h: number }, text = 'Text on a path'): PathTextItem {
  const p = PATH_TEXT_PRESETS[preset] || PATH_TEXT_PRESETS.arcUp;
  return {
    id: newId('pt'), kind: 'pathText', name: `Text on ${p.label.toLowerCase()}`, x: b.x, y: b.y, w: b.w, h: b.h,
    path: { d: p.d, w: p.w, h: p.h }, preset, text: [{ style: 'Body', runs: text ? [{ text, size: 18, font: 'Arimo', b: true }] : [] }],
    align: preset === 'line' || preset === 'zigzag' || preset === 'wave' ? 'start' : 'center', offset: 0, baseline: preset === 'circle' || preset === 'arcUp' ? 2 : 0,
    line: { fill: { type: 'solid', color: 'Gray' }, width: 0.5 },
  };
}

/** A path text item following a shape's outline or a line. */
export function pathTextFromItem(e: Item, text?: string): PathTextItem | null {
  let d: string;
  if (e.kind === 'shape') d = geometryPath(e.geom, e.w, e.h, e.adj, e.path).d;
  else if (e.kind === 'line') d = `M0 0 L${e.w} ${e.h}`;
  else if (e.kind === 'text' || e.kind === 'picture') d = geometryPath(e.geom || 'rect', e.w, e.h).d;
  else return null;
  const paras: Paragraph[] = e.kind === 'text' ? [] : [{ style: 'Body', runs: [{ text: text || 'Text on a path', size: 14, font: 'Arimo', b: true }] }];
  return {
    id: newId('pt'), kind: 'pathText', name: `Text on ${e.name || e.kind}`, x: e.x, y: e.y, w: e.w, h: e.h, rot: e.rot, flipH: e.flipH, flipV: e.flipV, layer: e.layer,
    path: { d, w: e.w, h: e.h }, preset: 'shape', text: paras.length ? paras : [{ style: 'Body', runs: [{ text: text || 'Text on a path', size: 14, font: 'Arimo', b: true }] }],
    align: 'start', offset: 0, baseline: 2, line: e.line, showPath: false,
  };
}

const presetEntries = (): MenuEntry[] => Object.entries(PATH_TEXT_PRESETS).map(([id, p]) => ({ id: 'insert.textOnPath', arg: id, label: p.label, icon: id === 'circle' ? 'circle' : id === 'line' ? 'horizontal_rule' : 'gesture' }));

async function editPathText(app: App, e: PathTextItem): Promise<void> {
  const text = e.text.map(paraText).join('\n');
  const r = await openDialog({ title: 'Text on a Path', fields: [{ key: 't', label: 'Text', type: 'textarea', rows: 3, value: text, autofocus: true }], help: 'Font, size, bold and color apply from the Home tab while the path text is selected.' });
  if (!r || r.t === text) return;
  setPathText(app, e, String(r.t));
}

export function setPathText(app: App, e: PathTextItem, text: string): void {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  edit(app, 'Edit Path Text', () => {
    e.text = lines.map((l, i) => {
      const old = e.text[i];
      if (old && paraText(old) === l) return old;
      const fmt = old?.runs.find((x) => !x.br) || e.text[0]?.runs.find((x) => !x.br) || old?.end || {};
      const { text: _t, br: _b, ...keep } = fmt as any;
      return { style: old?.style || e.text[0]?.style || 'Body', runs: l ? [{ ...keep, text: l }] : [] };
    });
    if (!e.text.length) e.text = [{ style: 'Body', runs: [] }];
  });
}

def([
  {
    id: 'insert.textOnPath', label: 'Text on a Path', icon: 'gesture', tab: 'Insert', group: 'Text', kind: 'menu', edits: true, origin: 'Text on a path (CorelDRAW, Illustrator, InDesign)',
    tip: 'Text set along a line, an arc, a circle, a wave or a zigzag; or convert a shape with Text Path ▸ From Shape',
    menu: () => [...presetEntries(), { separator: true }, { id: 'path.fromShape', label: 'From the Selected Shape or Line' }],
    run: async (app, arg?: string | { preset?: string; text?: string }) => {
      const preset = typeof arg === 'string' ? arg : arg?.preset;
      const text = typeof arg === 'object' ? arg?.text : undefined;
      if (!preset || !PATH_TEXT_PRESETS[preset]) { showMenu(presetEntries(), { anchor: app.ui.anchorFor('insert.textOnPath'), onPick: (e) => app.exec('insert.textOnPath', e.arg) }); return; }
      const p = PATH_TEXT_PRESETS[preset];
      const b = placeNew(app, p.box[0], p.box[1]);
      const e = makePathText(preset, b, typeof text === 'string' ? text : undefined);
      insertItem(app, e, 'Text on a Path');
      if (typeof text !== 'string') await editPathText(app, e);
    },
  },
  {
    id: 'path.fromShape', label: 'From Shape', icon: 'gesture', tab: 'Arrange', group: 'Text Path', edits: true, isEnabled: (app) => app.selected.some((e) => e.kind === 'shape' || e.kind === 'line' || e.kind === 'text' || e.kind === 'picture'),
    tip: 'Set text along the outline of the selected shape, frame or line (the shape itself can stay underneath)',
    run: async (app, arg?: { keep?: boolean; text?: string }) => {
      const src = selection(app).filter((e) => e.kind === 'shape' || e.kind === 'line' || e.kind === 'text' || e.kind === 'picture');
      if (!src.length) { toast('Select a shape, line or frame first.'); return; }
      let keep = arg?.keep;
      if (keep === undefined) { const r = await openDialog({ title: 'Text on the Shape\'s Path', fields: [{ key: 't', label: 'Text', type: 'text', value: arg?.text || 'Text on a path', autofocus: true }, { key: 'keep', label: 'Keep the shape underneath', type: 'checkbox', value: true }] }); if (!r) return; keep = !!r.keep; arg = { keep, text: r.t }; }
      const made: PathTextItem[] = [];
      edit(app, 'Text on Shape Path', (o) => {
        for (const e of src) {
          const pt = pathTextFromItem(e, arg?.text);
          if (!pt) continue;
          const i = o.items.indexOf(e);
          if (keep) o.items.splice(i + 1, 0, pt); else o.items.splice(i, 1, pt);
          made.push(pt);
        }
        if (!keep) app.pub.pruneStories();
      });
      app.tab.ui.select(made.map((e) => e.id));
    },
  },
  { id: 'path.editText', label: 'Edit Path Text…', icon: 'edit', tab: 'Arrange', group: 'Text Path', edits: true, isEnabled: hasPath, run: async (app, text?: string) => { const e = onePath(app); if (!e) return; if (typeof text === 'string') setPathText(app, e, text); else await editPathText(app, e); } },
  {
    id: 'path.align', label: 'Align on Path', icon: 'format_align_center', tab: 'Arrange', group: 'Text Path', kind: 'menu', edits: true, isEnabled: hasPath,
    menu: (app) => { const cur = pathTextTargets(app)[0]?.align; return ([['start', 'Start', 'format_align_left'], ['center', 'Center', 'format_align_center'], ['end', 'End', 'format_align_right'], ['justify', 'Spread Along the Path', 'format_align_justify']] as const).map(([v, l, i]) => ({ id: 'path.align', arg: v, label: l, icon: i, checked: cur === v })); },
    run: (app, v?: PathTextItem['align']) => { if (!v) { app.exec('path.align', 'center'); return; } patchPaths(app, 'Align on Path', (e) => { e.align = v; }); },
  },
  { id: 'path.offset', label: 'Start Offset…', icon: 'start', tab: 'Arrange', group: 'Text Path', edits: true, isEnabled: hasPath, tip: 'Distance along the path before the text starts', run: async (app, v?: number) => { const e = onePath(app); if (!e) return; if (typeof v !== 'number') { const r = await openDialog({ title: 'Start Offset', fields: [{ key: 'v', label: 'Offset along the path (pt)', type: 'number', step: 1, value: e.offset }] }); if (!r) return; v = +r.v || 0; } patchPaths(app, 'Start Offset', (x) => { x.offset = v!; }); } },
  { id: 'path.baseline', label: 'Baseline Shift…', icon: 'vertical_align_center', tab: 'Arrange', group: 'Text Path', edits: true, isEnabled: hasPath, tip: 'Raise the text above the path (negative values put it below)', run: async (app, v?: number) => { const e = onePath(app); if (!e) return; if (typeof v !== 'number') { const r = await openDialog({ title: 'Baseline Shift', fields: [{ key: 'v', label: 'Shift from the path (pt)', type: 'number', step: 0.5, value: e.baseline }] }); if (!r) return; v = +r.v || 0; } patchPaths(app, 'Baseline Shift', (x) => { x.baseline = v!; }); } },
  { id: 'path.flip', label: 'Flip to Other Side', icon: 'flip', tab: 'Arrange', group: 'Text Path', kind: 'toggle', edits: true, isEnabled: hasPath, isActive: (app) => !!pathTextTargets(app)[0]?.flip, tip: 'Set the text on the other side of the path, running the other way', run: (app) => { const e = onePath(app); if (!e) return; const on = !e.flip; patchPaths(app, 'Flip Path Text', (x) => { x.flip = on || undefined; }); } },
  { id: 'path.spacing', label: 'Character Spacing…', icon: 'space_bar', tab: 'Arrange', group: 'Text Path', edits: true, isEnabled: hasPath, run: async (app, v?: number) => { const e = onePath(app); if (!e) return; if (typeof v !== 'number') { const r = await openDialog({ title: 'Character Spacing', fields: [{ key: 'v', label: 'Extra space between characters (pt)', type: 'number', step: 0.25, value: e.spacing || 0 }] }); if (!r) return; v = +r.v || 0; } patchPaths(app, 'Character Spacing', (x) => { x.spacing = v || undefined; }); } },
  { id: 'path.showPath', label: 'Show Path', icon: 'timeline', tab: 'Arrange', group: 'Text Path', kind: 'toggle', edits: true, isEnabled: hasPath, isActive: (app) => !!pathTextTargets(app)[0]?.showPath, tip: 'Draw the path with the item\'s outline (Shape ▸ Outline sets it)', run: (app) => { const e = onePath(app); if (!e) return; const on = !e.showPath; patchPaths(app, 'Show Path', (x) => { x.showPath = on || undefined; if (on && (!x.line || x.line.fill?.type === 'none')) x.line = { fill: { type: 'solid', color: 'Black' }, width: 0.75 }; }); } },
  {
    id: 'path.release', label: 'Release to Text Frame', icon: 'text_fields', tab: 'Arrange', group: 'Text Path', edits: true, isEnabled: hasPath,
    tip: 'Put the text back into an ordinary text frame of the same size',
    run: (app) => {
      const els = pathTextTargets(app);
      if (!els.length) { toast('Select text on a path first.'); return; }
      const ids: string[] = [];
      edit(app, 'Release Path Text', (o) => {
        for (const e of els) {
          const f = app.pub.newTextFrame({ x: e.x, y: e.y, w: e.w, h: Math.max(24, e.h) }, e.text.length ? e.text : [{ style: 'Body', runs: [{ text: pathTextString(e) }] }]);
          f.name = e.name; f.rot = e.rot;
          const i = o.items.indexOf(e);
          if (i >= 0) o.items.splice(i, 1, f); else o.items.push(f);
          ids.push(f.id);
        }
      });
      app.tab.ui.select(ids);
    },
  },
]);
