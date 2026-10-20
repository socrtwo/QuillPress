/**
 * Table layout: the laid lines of every cell plus the note area under the rows that holds the
 * footnotes referenced from the cells. Both renderers (SVG and PDF) and hit-testing read the same
 * geometry from here, so the table's drawn height (rows plus notes) never diverges between them.
 * Coordinates are local to the table (0,0 at its top-left); `t.h` is never changed.
 */
import type { Pub } from '../model/pub';
import type { Fill, Paragraph, TableItem, Footnote } from '../model/types';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';
import { layoutOptions } from './flow';
import { layoutStory, labeledFootnote, type FlowBox, type LaidLine } from './text';

export interface TableCellLayout {
  ri: number;
  ci: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: Fill;
  lines: LaidLine[];
}

export interface TableLayout {
  cells: TableCellLayout[];
  /** Width of the rows. */
  w: number;
  /** Height of the rows (the grid). */
  rowsH: number;
  /** Lines of the footnote text under the rows (local coordinates). */
  notes: LaidLine[];
  /** Separator rule above the notes (local coordinates), when there are notes. */
  separator?: { x: number; y: number; w: number };
  /** Height of the note area (separator space plus the note lines), 0 without notes. */
  notesH: number;
  /** Total drawn height: rows plus notes. */
  h: number;
  /** Label of every footnote referenced, by id. */
  labels: Record<string, string>;
  /** Footnotes in reading order. */
  order: { id: string; label: string }[];
}

/** Footnote ids referenced from the cells in reading order (row by row, cell by cell). */
export function tableFootnoteRefs(t: TableItem): string[] {
  const ids: string[] = [];
  for (const row of t.rows) for (const cell of row.cells) { if (cell.merged) continue; for (const p of cell.text) for (const r of p.runs) if (r.footnote) ids.push(r.footnote); }
  return ids;
}

export const TABLE_NOTE_INSET = 4;

/** Lays out the table's cells and its footnote area. */
export function tableLayout(pub: Pub, t: TableItem, pageIndex: number): TableLayout {
  const cols = t.cols;
  const cells: TableCellLayout[] = [];
  const labels: Record<string, string> = {};
  const fnOpts = pub.data.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS;
  let count = 0;
  let y = 0;
  t.rows.forEach((row, ri) => {
    let x = 0;
    row.cells.forEach((cell, ci) => {
      const cw = cols[ci] || 0;
      if (cell.merged) { x += cw; return; }
      const span = cell.colSpan || 1, rspan = cell.rowSpan || 1;
      const w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0);
      const h = t.rows.slice(ri, ri + rspan).reduce((a, r) => a + r.h, 0);
      const band = t.style?.bandedRows && ri % 2 === 1 ? ({ type: 'solid', color: t.style.bandColor || 'Light Gray' } as Fill) : undefined;
      const header = (t.style?.firstRow && ri === 0) || row.header ? (t.style?.headerFill || ({ type: 'solid', color: 'Primary' } as Fill)) : undefined;
      const fill = cell.fill ?? header ?? band;
      const ins = cell.insets || [4, 3, 4, 3];
      const box: FlowBox = { frame: t.id, col: 0, x: x + ins[0], y: y + ins[1], w: Math.max(1, w - ins[0] - ins[2]), h: Math.max(1, h - ins[1] - ins[3]), page: pageIndex };
      const paras: Paragraph[] = cell.text.length ? cell.text : [{ style: 'Table Text', runs: [] }];
      const r = layoutStory(paras, layoutOptions(pub, [box], { anchor: cell.anchor || 't', unbounded: true, footnoteStart: count }));
      count = r.footnoteCount;
      Object.assign(labels, r.footnoteLabels || {});
      cells.push({ ri, ci, x, y, w, h, fill, lines: r.lines });
      x += cw;
    });
    y += row.h;
  });
  const w = cols.reduce((a, b) => a + b, 0);
  const rowsH = t.rows.reduce((a, r) => a + r.h, 0);
  // The reference runs show their labels (as story layout does for frames).
  for (const row of t.rows) for (const cell of row.cells) for (const p of cell.text) for (const r of p.runs) if (r.footnote && labels[r.footnote] && r.text !== labels[r.footnote]) r.text = labels[r.footnote];
  const order = tableFootnoteRefs(t).map((id) => ({ id, label: labels[id] || '' }));
  const notes: LaidLine[] = [];
  let separator: TableLayout['separator'];
  let notesH = 0;
  const present = order.filter((o) => (t.footnotes || []).some((f) => f.id === o.id));
  if (present.length) {
    const sepTotal = fnOpts.separator.space + 2;
    const nx = TABLE_NOTE_INSET, nw = Math.max(1, w - TABLE_NOTE_INSET * 2);
    separator = { x: nx, y: rowsH + fnOpts.separator.space * 0.5, w: nw * Math.max(0, Math.min(1, fnOpts.separator.length)) };
    let ny = rowsH + sepTotal;
    for (const { id, label } of present) {
      const fn = (t.footnotes as Footnote[]).find((f) => f.id === id)!;
      const box: FlowBox = { frame: t.id, col: 0, x: nx, y: ny, w: nw, h: 1e6, page: pageIndex };
      const r = layoutStory(labeledFootnote(fn.paras, label, fnOpts.style), layoutOptions(pub, [box], { unbounded: true }));
      for (const l of r.lines) { l.footnote = true; l.footnoteId = id; notes.push(l); }
      ny += r.used;
    }
    notesH = ny - rowsH + 2;
  }
  return { cells, w, rowsH, notes, separator, notesH, h: rowsH + notesH, labels, order };
}
