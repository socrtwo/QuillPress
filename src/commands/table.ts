/** Table Design and Table Layout tabs. */
import { def } from './registry';
import type { App } from '../app';
import type { Fill, Line, Paragraph, TableCell, TableItem } from '../model/types';
import { UNITS } from '../model/types';
import { clone, newId } from '../model/pub';
import { colorHex } from '../model/styles';
import { selection, edit, insertItem, placeNew } from '../edit/ops';
import { paraText } from '../edit/textEdit';
import { makeTable } from './insert';
import { openDialog, toast, colorMenu, confirmDialog } from '../ui/dialog';

const u = (app: App) => UNITS[app.prefs.unit];
const toU = (app: App, pt: number) => +(pt / u(app).pt).toFixed(u(app).digits);
const fromU = (app: App, v: any) => Math.max(1, (+v || 0) * u(app).pt);

function table(app: App): TableItem | undefined { return selection(app).find((e): e is TableItem => e.kind === 'table'); }
const hasTable = (app: App) => !!table(app);

/** The cell the user is working in (kept on the app between commands; defaults to the first cell). */
function cursor(app: App, t: TableItem): { r: number; c: number } {
  const cur = (app as any).tableCursor as { id: string; r: number; c: number } | undefined;
  if (cur && cur.id === t.id && cur.r < t.rows.length && cur.c < t.cols.length) return { r: cur.r, c: cur.c };
  return { r: 0, c: 0 };
}

function patch(app: App, label: string, fn: (t: TableItem) => void): void {
  const t = table(app);
  if (!t) { toast('Select a table first.'); return; }
  edit(app, label, () => { fn(t); t.h = t.rows.reduce((a, r) => a + r.h, 0); t.w = t.cols.reduce((a, c) => a + c, 0); });
}

const cell = (style = 'Table Text', text = ''): TableCell => ({ text: [{ style, runs: text ? [{ text }] : [] }] });

const TABLE_STYLES: { name: string; style: TableItem['style']; border: Line; inner: Line }[] = [
  { name: 'Plain', style: {}, border: { fill: { type: 'solid', color: 'Black' }, width: 0.5 }, inner: { fill: { type: 'solid', color: 'Gray' }, width: 0.5 } },
  { name: 'Header Row', style: { firstRow: true, headerFill: { type: 'solid', color: 'Primary' } }, border: { fill: { type: 'solid', color: 'Black' }, width: 0.5 }, inner: { fill: { type: 'solid', color: 'Gray' }, width: 0.5 } },
  { name: 'Banded', style: { firstRow: true, bandedRows: true, headerFill: { type: 'solid', color: 'Primary' }, bandColor: 'Light Gray' }, border: { fill: { type: 'none' } }, inner: { fill: { type: 'none' } } },
  { name: 'Light Grid', style: { firstRow: true, bandedRows: false, headerFill: { type: 'solid', color: 'Light Gray' } }, border: { fill: { type: 'solid', color: 'Gray' }, width: 0.5 }, inner: { fill: { type: 'solid', color: 'Light Gray' }, width: 0.5 } },
  { name: 'Rules Only', style: { firstRow: true, headerFill: { type: 'none' } }, border: { fill: { type: 'none' } }, inner: { fill: { type: 'solid', color: 'Black' }, width: 0.5 } },
  { name: 'Accent', style: { firstRow: true, bandedRows: true, firstCol: true, headerFill: { type: 'solid', color: 'Secondary' }, bandColor: 'Light Gray' }, border: { fill: { type: 'solid', color: 'Secondary' }, width: 1 }, inner: { fill: { type: 'none' } } },
];

def([
  {
    id: 'table.headerRow', label: 'Header Row', icon: 'table_rows', tab: 'Table Design', group: 'Table Style Options', kind: 'toggle', edits: true, isEnabled: hasTable,
    isActive: (app) => !!table(app)?.style?.firstRow,
    run: (app) => patch(app, 'Header Row', (t) => { const on = !t.style?.firstRow; t.style = { ...(t.style || {}), firstRow: on }; t.rows[0].header = on; for (const c of t.rows[0].cells) for (const p of c.text) p.style = on ? 'Table Header' : 'Table Text'; }),
  },
  { id: 'table.bandedRows', label: 'Banded Rows', icon: 'view_agenda', tab: 'Table Design', group: 'Table Style Options', kind: 'toggle', edits: true, isEnabled: hasTable, isActive: (app) => !!table(app)?.style?.bandedRows, run: (app) => patch(app, 'Banded Rows', (t) => { t.style = { ...(t.style || {}), bandedRows: !t.style?.bandedRows }; }) },
  { id: 'table.firstColumn', label: 'First Column', icon: 'view_column', tab: 'Table Design', group: 'Table Style Options', kind: 'toggle', edits: true, isEnabled: hasTable, tip: 'Bold the first column', isActive: (app) => !!table(app)?.style?.firstCol, run: (app) => patch(app, 'First Column', (t) => { const on = !t.style?.firstCol; t.style = { ...(t.style || {}), firstCol: on }; for (const r of t.rows) for (const p of r.cells[0]?.text || []) for (const x of p.runs) x.b = on || undefined; }) },
  {
    id: 'table.style', label: 'Table Styles', icon: 'table_chart', tab: 'Table Design', group: 'Table Styles', kind: 'gallery', edits: true, isEnabled: hasTable,
    menu: () => TABLE_STYLES.map((s) => ({ id: 'table.style', arg: s.name, label: s.name })),
    run: (app, name?: string) => { const s = TABLE_STYLES.find((x) => x.name === name) || TABLE_STYLES[1]; patch(app, 'Table Style', (t) => { t.style = clone(s.style); t.border = clone(s.border); t.innerBorder = clone(s.inner); for (const c of t.rows.flatMap((r) => r.cells)) delete c.fill; t.rows[0].header = !!s.style?.firstRow; }); },
  },
  {
    id: 'table.shading', label: 'Shading', icon: 'format_color_fill', tab: 'Table Design', group: 'Table Styles', kind: 'color', edits: true, isEnabled: hasTable,
    tip: 'Fill of the current cell (the arrow picks the color)',
    run: async (app, arg) => {
      const t = table(app); if (!t) return;
      let c: string | null | undefined = typeof arg === 'string' && arg !== 'menu' ? arg : undefined;
      if (c === undefined) c = await colorMenu(app.ui.anchorFor('table.shading'), { none: 'No Fill', title: 'Cell shading' });
      if (c === undefined) return;
      const { r, c: ci } = cursor(app, t);
      patch(app, 'Shading', (x) => { const cl = x.rows[r].cells[ci]; cl.fill = c ? { type: 'solid', color: c } : { type: 'none' }; });
    },
  },
  {
    id: 'table.borders', label: 'Borders', icon: 'border_outer', tab: 'Table Design', group: 'Table Styles', kind: 'menu', edits: true, isEnabled: hasTable,
    menu: () => [{ id: 'table.borders', arg: 'none', label: 'No Outer Border' }, { id: 'table.borders', arg: 0.5, label: 'Hairline' }, { id: 'table.borders', arg: 1, label: '1 pt' }, { id: 'table.borders', arg: 2, label: '2 pt' }, { separator: true }, { id: 'table.borders', arg: 'dialog', label: 'Border Options…' }],
    run: async (app, arg?: number | string) => {
      if (arg === 'none') { patch(app, 'Borders', (t) => { t.border = { fill: { type: 'none' } }; }); return; }
      if (typeof arg === 'number') { patch(app, 'Borders', (t) => { t.border = { ...(t.border || {}), fill: t.border?.fill?.type === 'solid' ? t.border.fill : { type: 'solid', color: 'Black' }, width: arg }; }); return; }
      const t = table(app); if (!t) return;
      const r = await openDialog({ title: 'Table Borders', fields: [{ key: 'ow', label: 'Outer border width (pt, 0 = none)', type: 'number', min: 0, step: 0.25, value: t.border?.fill?.type === 'none' ? 0 : t.border?.width ?? 0.5, half: true }, { key: 'oc', label: 'Outer color', type: 'color', value: t.border?.fill?.type === 'solid' ? colorHex(app.pub.data, t.border.fill.color) : '#000000', half: true }, { key: 'iw', label: 'Inner lines width (pt, 0 = none)', type: 'number', min: 0, step: 0.25, value: t.innerBorder?.fill?.type === 'none' ? 0 : t.innerBorder?.width ?? 0.5, half: true }, { key: 'ic', label: 'Inner color', type: 'color', value: t.innerBorder?.fill?.type === 'solid' ? colorHex(app.pub.data, t.innerBorder.fill.color) : '#808080', half: true }] });
      if (!r) return;
      patch(app, 'Borders', (x) => { x.border = +r.ow > 0 ? { fill: { type: 'solid', color: r.oc }, width: +r.ow } : { fill: { type: 'none' } }; x.innerBorder = +r.iw > 0 ? { fill: { type: 'solid', color: r.ic }, width: +r.iw } : { fill: { type: 'none' } }; });
    },
  },
  { id: 'table.innerBorders', label: 'Inner Lines', icon: 'border_inner', tab: 'Table Design', group: 'Table Styles', kind: 'toggle', edits: true, isEnabled: hasTable, isActive: (app) => { const t = table(app); return !!t && t.innerBorder?.fill?.type !== 'none'; }, run: (app) => patch(app, 'Inner Lines', (t) => { const on = t.innerBorder?.fill?.type !== 'none'; t.innerBorder = on ? { fill: { type: 'none' } } : { fill: { type: 'solid', color: 'Gray' }, width: 0.5 }; }) },
  { id: 'table.clearStyle', label: 'Clear Table Style', icon: 'format_clear', tab: 'Table Design', group: 'Table Styles', edits: true, isEnabled: hasTable, run: (app) => patch(app, 'Clear Table Style', (t) => { t.style = {}; delete t.border; delete t.innerBorder; for (const c of t.rows.flatMap((r) => r.cells)) delete c.fill; }) },
  // Layout
  {
    id: 'table.deleteMenu', label: 'Delete', icon: 'delete', tab: 'Table Layout', group: 'Rows & Columns', kind: 'menu', edits: true, isEnabled: hasTable,
    menu: () => [{ id: 'table.deleteRow', label: 'Delete Row' }, { id: 'table.deleteColumn', label: 'Delete Column' }, { separator: true }, { id: 'table.deleteTable', label: 'Delete Table' }],
    run: (app) => app.exec('table.deleteRow'),
  },
  { id: 'table.deleteRow', label: 'Delete Row', icon: 'playlist_remove', tab: 'Table Layout', group: 'Rows & Columns', edits: true, isEnabled: hasTable, run: (app) => { const t = table(app); if (!t) return; if (t.rows.length < 2) { app.exec('table.deleteTable'); return; } const { r } = cursor(app, t); patch(app, 'Delete Row', (x) => { x.rows.splice(r, 1); }); } },
  { id: 'table.deleteColumn', label: 'Delete Column', icon: 'playlist_remove', tab: 'Table Layout', group: 'Rows & Columns', edits: true, isEnabled: hasTable, run: (app) => { const t = table(app); if (!t) return; if (t.cols.length < 2) { app.exec('table.deleteTable'); return; } const { c } = cursor(app, t); patch(app, 'Delete Column', (x) => { x.cols.splice(c, 1); for (const row of x.rows) row.cells.splice(c, 1); }); } },
  { id: 'table.deleteTable', label: 'Delete Table', icon: 'delete', tab: 'Table Layout', group: 'Rows & Columns', edits: true, isEnabled: hasTable, run: async (app) => { const t = table(app); if (!t) return; if (!(await confirmDialog('Delete Table', 'Delete the whole table?', 'Delete'))) return; edit(app, 'Delete Table', (o) => { o.items = o.items.filter((e) => e !== t); }); app.tab.ui.select([]); } },
  ...([['insertAbove', 'Insert Above', 'add_row_above', 0], ['insertBelow', 'Insert Below', 'add_row_below', 1]] as const).map(([id, label, icon, off]) => ({
    id: `table.${id}`, label, icon, tab: 'Table Layout', group: 'Rows & Columns', edits: true, isEnabled: hasTable,
    run: (app: App) => { const t = table(app); if (!t) return; const { r } = cursor(app, t); patch(app, label, (x) => { const src = x.rows[r]; x.rows.splice(r + off, 0, { h: src.h, cells: src.cells.map(() => cell()) }); }); },
  })),
  ...([['insertLeft', 'Insert Left', 'add_column_left', 0], ['insertRight', 'Insert Right', 'add_column_right', 1]] as const).map(([id, label, icon, off]) => ({
    id: `table.${id}`, label, icon, tab: 'Table Layout', group: 'Rows & Columns', edits: true, isEnabled: hasTable,
    run: (app: App) => { const t = table(app); if (!t) return; const { c } = cursor(app, t); patch(app, label, (x) => { x.cols.splice(c + off, 0, x.cols[c]); x.rows.forEach((row, ri) => row.cells.splice(c + off, 0, cell(ri === 0 && x.style?.firstRow ? 'Table Header' : 'Table Text'))); }); },
  })),
  {
    id: 'table.merge', label: 'Merge Cells', icon: 'call_merge', tab: 'Table Layout', group: 'Merge', edits: true, isEnabled: hasTable,
    tip: 'Merge the current cell with cells to its right and below',
    run: async (app) => {
      const t = table(app); if (!t) return;
      const { r, c } = cursor(app, t);
      const res = await openDialog({ title: 'Merge Cells', fields: [{ key: 'cs', label: 'Columns to merge', type: 'number', min: 1, max: t.cols.length - c, value: Math.min(2, t.cols.length - c), half: true }, { key: 'rs', label: 'Rows to merge', type: 'number', min: 1, max: t.rows.length - r, value: 1, half: true }] });
      if (!res) return;
      const cs = Math.max(1, +res.cs), rs = Math.max(1, +res.rs);
      patch(app, 'Merge Cells', (x) => {
        const base = x.rows[r].cells[c];
        const text: Paragraph[] = [];
        for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) { const cl = x.rows[i].cells[j]; if (cl === base) continue; if (cl.text.some((p) => paraText(p).trim())) text.push(...cl.text); cl.merged = true; cl.text = [{ style: 'Table Text', runs: [] }]; }
        base.colSpan = cs > 1 ? cs : undefined; base.rowSpan = rs > 1 ? rs : undefined; base.merged = undefined;
        if (text.length) base.text.push(...text);
      });
    },
  },
  {
    id: 'table.split', label: 'Split Cells', icon: 'call_split', tab: 'Table Layout', group: 'Merge', edits: true, isEnabled: hasTable,
    tip: 'Undo a merge: the merged cells become single cells again',
    run: (app) => { const t = table(app); if (!t) return; const { r, c } = cursor(app, t); patch(app, 'Split Cells', (x) => { const base = x.rows[r].cells[c]; const cs = base.colSpan || 1, rs = base.rowSpan || 1; for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) { const cl = x.rows[i]?.cells[j]; if (cl) delete cl.merged; } delete base.colSpan; delete base.rowSpan; }); },
  },
  { id: 'table.distributeRows', label: 'Distribute Rows', icon: 'vertical_distribute', tab: 'Table Layout', group: 'Cell Size', edits: true, isEnabled: hasTable, run: (app) => patch(app, 'Distribute Rows', (t) => { const h = t.h / t.rows.length; for (const r of t.rows) r.h = h; }) },
  { id: 'table.distributeColumns', label: 'Distribute Columns', icon: 'horizontal_distribute', tab: 'Table Layout', group: 'Cell Size', edits: true, isEnabled: hasTable, run: (app) => patch(app, 'Distribute Columns', (t) => { const w = t.w / t.cols.length; t.cols = t.cols.map(() => w); }) },
  {
    id: 'table.rowHeight', label: 'Row Height', icon: 'height', tab: 'Table Layout', group: 'Cell Size', kind: 'size', edits: true, isEnabled: hasTable,
    value: (app) => { const t = table(app); return t ? toU(app, t.rows[cursor(app, t).r].h) : ''; },
    run: (app, v?: number | string) => { const n = parseFloat(String(v)); if (isNaN(n)) return; const t = table(app); if (!t) return; const { r } = cursor(app, t); patch(app, 'Row Height', (x) => { x.rows[r].h = fromU(app, n); }); },
  },
  {
    id: 'table.columnWidth', label: 'Column Width', icon: 'width', tab: 'Table Layout', group: 'Cell Size', kind: 'size', edits: true, isEnabled: hasTable,
    value: (app) => { const t = table(app); return t ? toU(app, t.cols[cursor(app, t).c]) : ''; },
    run: (app, v?: number | string) => { const n = parseFloat(String(v)); if (isNaN(n)) return; const t = table(app); if (!t) return; const { c } = cursor(app, t); patch(app, 'Column Width', (x) => { x.cols[c] = fromU(app, n); }); },
  },
  {
    id: 'table.editCells', label: 'Edit Cells…', icon: 'edit_square', tab: 'Table Layout', group: 'Data', keys: ['Mod-Alt-t'], edits: true, isEnabled: hasTable,
    tip: 'Edit the table\'s text as a grid (one row per line, cells separated by tabs); the cell you choose becomes the current cell for the row/column commands',
    run: async (app) => {
      const t = table(app); if (!t) return;
      const cur = cursor(app, t);
      const text = t.rows.map((r) => r.cells.map((c) => c.text.map(paraText).join(' ⏎ ')).join('\t')).join('\n');
      const r = await openDialog({ title: 'Edit Table', wide: true, fields: [{ key: 't', label: 'Cells (rows on lines, cells separated by tabs; " ⏎ " separates paragraphs inside a cell)', type: 'textarea', rows: Math.min(20, t.rows.length + 3), value: text }, { key: 'row', label: 'Current row', type: 'number', min: 1, max: t.rows.length, value: cur.r + 1, half: true }, { key: 'col', label: 'Current column', type: 'number', min: 1, max: t.cols.length, value: cur.c + 1, half: true }] });
      if (!r) return;
      (app as any).tableCursor = { id: t.id, r: Math.max(0, +r.row - 1), c: Math.max(0, +r.col - 1) };
      if (r.t === text) return;
      const lines = String(r.t).replace(/\r\n?/g, '\n').split('\n');
      patch(app, 'Edit Table', (x) => {
        const cols = Math.max(x.cols.length, ...lines.map((l) => l.split('\t').length));
        while (x.cols.length < cols) x.cols.push(x.cols[x.cols.length - 1] || 72);
        x.rows = lines.map((l, ri) => {
          const old = x.rows[ri];
          const cells = l.split('\t');
          return { h: old?.h || x.rows[x.rows.length - 1]?.h || 22, header: old?.header, cells: x.cols.map((_, ci) => { const o = old?.cells[ci]; const txt = cells[ci] ?? ''; if (o && o.text.map(paraText).join(' ⏎ ') === txt) return o; const style = o?.text[0]?.style || (ri === 0 && x.style?.firstRow ? 'Table Header' : 'Table Text'); const fmt = o?.text[0]?.runs[0]; const { text: _t, ...keep } = (fmt || {}) as any; return { ...(o || {}), text: txt.split(' ⏎ ').map((p) => ({ style, runs: p ? [{ ...keep, text: p }] : [] })) }; }) };
        });
      });
    },
  },
  {
    id: 'table.editCell', label: 'Edit Cell Text', icon: 'edit', tab: 'Table Layout', group: 'Data', internal: true, edits: true,
    run: async (app, at?: { r: number; c: number }) => {
      const t = table(app); if (!t) return;
      const { r, c } = at || cursor(app, t);
      (app as any).tableCursor = { id: t.id, r, c };
      const cl = t.rows[r]?.cells[c]; if (!cl) return;
      const res = await openDialog({ title: `Cell ${r + 1},${c + 1}`, fields: [{ key: 't', label: 'Text (one paragraph per line)', type: 'textarea', rows: 4, value: cl.text.map(paraText).join('\n'), autofocus: true }] });
      if (!res) return;
      patch(app, 'Edit Cell', () => { const style = cl.text[0]?.style || 'Table Text'; const fmt = cl.text[0]?.runs[0]; const { text: _t, ...keep } = (fmt || {}) as any; cl.text = String(res.t).split('\n').map((p) => ({ style, runs: p ? [{ ...keep, text: p }] : [] })); });
    },
  },
  {
    id: 'table.sort', label: 'Sort…', icon: 'sort', tab: 'Table Layout', group: 'Data', edits: true, isEnabled: hasTable,
    run: async (app) => {
      const t = table(app); if (!t) return;
      const r = await openDialog({ title: 'Sort Table', fields: [{ key: 'col', label: 'Sort by column', type: 'number', min: 1, max: t.cols.length, value: 1, half: true }, { key: 'dir', label: 'Order', type: 'select', options: [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }], value: 'asc', half: true }, { key: 'num', label: 'Numeric', type: 'checkbox', value: false, half: true }, { key: 'header', label: 'Keep the first row in place', type: 'checkbox', value: !!t.style?.firstRow, half: true }] });
      if (!r) return;
      patch(app, 'Sort Table', (x) => {
        const start = r.header ? 1 : 0;
        const body = x.rows.slice(start);
        const key = (row: typeof body[0]) => row.cells[+r.col - 1]?.text.map(paraText).join(' ') || '';
        body.sort((a, b) => { const ka = key(a), kb = key(b); const cmp = r.num ? (parseFloat(ka) || 0) - (parseFloat(kb) || 0) : ka.localeCompare(kb, undefined, { numeric: true }); return r.dir === 'desc' ? -cmp : cmp; });
        x.rows = [...x.rows.slice(0, start), ...body];
      });
    },
  },
  {
    id: 'table.toText', label: 'Convert to Text', icon: 'notes', tab: 'Table Layout', group: 'Data', edits: true, isEnabled: hasTable,
    tip: 'Replace the table with a text frame (cells separated by tabs)',
    run: (app) => {
      const t = table(app); if (!t) return;
      const paras: Paragraph[] = t.rows.map((r) => ({ style: 'Body No Indent', tabs: t.cols.slice(0, -1).map((_, i) => ({ pos: t.cols.slice(0, i + 1).reduce((a, w) => a + w, 0), align: 'l' as const })), runs: r.cells.flatMap((c, i) => [...(i ? [{ text: '\t' }] : []), { text: c.text.map(paraText).join(' ') }]) }));
      const f = app.pub.newTextFrame({ x: t.x, y: t.y, w: t.w, h: t.h }, paras);
      edit(app, 'Convert to Text', (o) => { const i = o.items.indexOf(t); if (i >= 0) o.items[i] = f; });
      app.tab.ui.select([f.id]);
    },
  },
  {
    id: 'table.fromFrame', label: 'Text Frame to Table', icon: 'table', tab: 'Table Layout', group: 'Data', edits: true, isEnabled: (app) => app.selected.some((e) => e.kind === 'text'),
    tip: 'Make a table from the selected frame\'s paragraphs (tabs or commas separate cells)',
    run: (app) => {
      const f = selection(app).find((e) => e.kind === 'text'); if (!f || f.kind !== 'text') return;
      const s = app.pub.story(f.story); if (!s) return;
      const rows = s.paras.map(paraText).filter((l) => l.trim()).map((l) => l.split(l.includes('\t') ? '\t' : ','));
      if (!rows.length) { toast('The frame has no text.'); return; }
      const cols = Math.max(...rows.map((r) => r.length));
      const t: TableItem = { id: newId('tbl'), kind: 'table', name: 'Table', x: f.x, y: f.y, w: f.w, h: 22 * rows.length, cols: Array.from({ length: cols }, () => f.w / cols), rows: rows.map((r, ri) => ({ h: 22, header: ri === 0, cells: Array.from({ length: cols }, (_, ci) => cell(ri === 0 ? 'Table Header' : 'Table Text', (r[ci] || '').trim())) })), border: { fill: { type: 'solid', color: 'Black' }, width: 0.5 }, innerBorder: { fill: { type: 'solid', color: 'Gray' }, width: 0.5 }, style: { firstRow: true, bandedRows: true, headerFill: { type: 'solid', color: 'Light Gray' } } };
      edit(app, 'Text to Table', (o) => { const i = o.items.indexOf(f); if (i >= 0) o.items[i] = t; app.pub.pruneStories(); });
      app.tab.ui.select([t.id]);
    },
  },
  {
    id: 'table.cellInsets', label: 'Cell Insets…', icon: 'padding', tab: 'Table Layout', group: 'Data', edits: true, isEnabled: hasTable,
    run: async (app) => {
      const t = table(app); if (!t) return;
      const cur = t.rows[0].cells[0].insets || [4, 3, 4, 3];
      const r = await openDialog({ title: 'Cell Insets', fields: [{ key: 'l', label: `Left (${u(app).label})`, type: 'number', min: 0, value: toU(app, cur[0]), half: true }, { key: 't', label: 'Top', type: 'number', min: 0, value: toU(app, cur[1]), half: true }, { key: 'r', label: 'Right', type: 'number', min: 0, value: toU(app, cur[2]), half: true }, { key: 'b', label: 'Bottom', type: 'number', min: 0, value: toU(app, cur[3]), half: true }, { key: 'all', label: 'Apply to every cell', type: 'checkbox', value: true }] });
      if (!r) return;
      const ins: [number, number, number, number] = [+r.l * u(app).pt, +r.t * u(app).pt, +r.r * u(app).pt, +r.b * u(app).pt];
      const { r: cr, c: cc } = cursor(app, t);
      patch(app, 'Cell Insets', (x) => { if (r.all) for (const row of x.rows) for (const cl of row.cells) cl.insets = ins; else x.rows[cr].cells[cc].insets = ins; });
    },
  },
  {
    id: 'table.cellAlign', label: 'Vertical Cell Alignment', icon: 'vertical_align_center', tab: 'Table Layout', group: 'Alignment', kind: 'menu', edits: true, isEnabled: hasTable,
    menu: () => [{ id: 'table.cellAlign', arg: 't', label: 'Top', icon: 'vertical_align_top' }, { id: 'table.cellAlign', arg: 'ctr', label: 'Middle', icon: 'vertical_align_center' }, { id: 'table.cellAlign', arg: 'b', label: 'Bottom', icon: 'vertical_align_bottom' }],
    run: (app, v?: TableCell['anchor']) => { if (!v) return; patch(app, 'Cell Alignment', (t) => { for (const row of t.rows) for (const cl of row.cells) cl.anchor = v === 't' ? undefined : v; }); },
  },
  {
    id: 'table.headerRepeat', label: 'Header Fill…', icon: 'format_color_fill', tab: 'Table Design', group: 'Table Styles', edits: true, isEnabled: hasTable,
    tip: 'Color of the header row and of the banding',
    run: async (app) => {
      const t = table(app); if (!t) return;
      const hf = t.style?.headerFill;
      const r = await openDialog({ title: 'Header and Band Colors', fields: [{ key: 'h', label: 'Header row fill', type: 'color', value: hf?.type === 'solid' ? colorHex(app.pub.data, hf.color) : '#5B3C9E', half: true }, { key: 'b', label: 'Band color', type: 'color', value: colorHex(app.pub.data, t.style?.bandColor || 'Light Gray'), half: true }] });
      if (!r) return;
      patch(app, 'Header Fill', (x) => { x.style = { ...(x.style || {}), firstRow: true, headerFill: { type: 'solid', color: r.h } as Fill, bandColor: r.b }; x.rows[0].header = true; });
    },
  },
  { id: 'table.new', label: 'New Table Here', icon: 'table', tab: 'Table Layout', group: 'Data', internal: true, edits: true, run: (app) => { const b = placeNew(app, 400, 88); insertItem(app, makeTable(app, 4, 3, b), 'Insert Table'); } },
]);

