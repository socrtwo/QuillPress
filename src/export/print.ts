/**
 * Printing through the browser's print dialog: the pages as inline SVG on sheets of the page size
 * (or spreads), optionally with crop marks, grayscale, and a page range.
 */
import type { App } from '../app';
import type { Pub } from '../model/pub';
import type { Page } from '../model/types';
import { pageSvg } from '../render/page';
import { printDocument } from '../platform/native';
import { openDialog } from '../ui/dialog';

export interface PrintOptions {
  range?: string;
  spreads?: boolean;
  grayscale?: boolean;
  marks?: boolean;
  bleed?: boolean;
  /** Scale pages to fit this paper instead of printing at the page size. */
  paper?: 'page' | 'letter' | 'a4';
  copies?: number;
}

/** "1-3, 5" → set of 0-based indexes (null = all). */
export function parseRange(range: string | undefined, count: number): Set<number> | null {
  const t = (range || '').trim();
  if (!t) return null;
  const out = new Set<number>();
  for (const part of t.split(/[,\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const a = Math.max(1, +m[1]), b = Math.min(count, m[2] ? +m[2] : +m[1]);
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return out;
}

function chosenPages(pub: Pub, o: PrintOptions): Page[] {
  const set = parseRange(o.range, pub.pages.length);
  return pub.pages.filter((_, i) => !set || set.has(i));
}

/** The sheets (HTML strings) and the CSS to print them. */
export function printPages(pub: Pub, o: PrintOptions): { css: string; pages: string[] } {
  const bleed = o.bleed ? pub.data.bleed : 0;
  const W = pub.size.w + bleed * 2, H = pub.size.h + bleed * 2;
  const pages = chosenPages(pub, o);
  const sheets: string[] = [];
  const svgOf = (p: Page) => pageSvg(pub, p, { mode: 'export', bleed: o.bleed, grayscale: o.grayscale }).replace(/ width="[^"]*" height="[^"]*"/, '');
  if (o.spreads && pub.data.facing) {
    let i = 0;
    while (i < pages.length) {
      const idx = pub.pageIndex(pages[i].id);
      const side = pub.pageSide(idx);
      if (side === 'left' && pages[i + 1] && pub.pageSide(pub.pageIndex(pages[i + 1].id)) === 'right') {
        sheets.push(`<div class="qp-pp-page qp-pp-spread" style="width:${W * 2}pt;height:${H}pt"><div class="qp-pp-half">${svgOf(pages[i])}</div><div class="qp-pp-half">${svgOf(pages[i + 1])}</div></div>`);
        i += 2;
      } else { sheets.push(`<div class="qp-pp-page" style="width:${W}pt;height:${H}pt">${svgOf(pages[i])}</div>`); i++; }
    }
  } else for (const p of pages) sheets.push(`<div class="qp-pp-page" style="width:${W}pt;height:${H}pt">${o.marks ? marksSvg(W, H, bleed) : ''}${svgOf(p)}</div>`);
  const paper = o.paper === 'letter' ? '8.5in 11in' : o.paper === 'a4' ? '210mm 297mm' : `${o.spreads && pub.data.facing ? W * 2 : W}pt ${H}pt`;
  const css = `@page { size: ${paper}; margin: 0 } .qp-pp-page { page-break-after: always; break-after: page; overflow: hidden; box-sizing: border-box; position: relative; display: flex; margin: 0 auto } .qp-pp-page:last-child { page-break-after: auto; break-after: auto } .qp-pp-page svg { width: 100%; height: 100%; display: block } .qp-pp-half { width: 50%; height: 100% } .qp-pp-marks { position: absolute; inset: 0; width: 100%; height: 100% } ${o.paper && o.paper !== 'page' ? '.qp-pp-page { max-width: 100%; max-height: 100vh; width: auto !important; height: auto !important; aspect-ratio: ' + (W / H).toFixed(4) + ' }' : ''}`;
  return { css, pages: sheets };
}

/** Crop marks drawn around the trim box inside the bleed area. */
function marksSvg(W: number, H: number, bleed: number): string {
  if (bleed <= 2) return '';
  const g = Math.min(bleed - 1, 9), len = bleed - 2;
  const m = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="0.25"/>`;
  const l = bleed, r = W - bleed, t = bleed, b = H - bleed;
  return `<svg class="qp-pp-marks" viewBox="0 0 ${W} ${H}">${[
    m(l - g, t, l - g - len, t), m(l, t - g, l, t - g - len), m(r + g, t, r + g + len, t), m(r, t - g, r, t - g - len),
    m(l - g, b, l - g - len, b), m(l, b + g, l, b + g + len), m(r + g, b, r + g + len, b), m(r, b + g, r, b + g + len),
  ].join('')}</svg>`;
}

/** Prints the publication through the system print dialog. */
export async function printPub(app: App, o: PrintOptions): Promise<void> {
  const { css, pages } = printPages(app.pub, o);
  if (!pages.length) return;
  const style = document.createElement('style');
  style.id = 'qp-print-css';
  style.textContent = `@media screen { .qp-print-root { display: none } }
    @media print { body > *:not(.qp-print-root) { display: none !important } .qp-print-root { display: block } html, body { margin: 0; background: #fff } ${css} }`;
  const root = document.createElement('div');
  root.className = 'qp-print-root';
  root.innerHTML = pages.join('');
  document.getElementById('qp-print-css')?.remove();
  document.querySelector('.qp-print-root')?.remove();
  document.head.appendChild(style);
  document.body.appendChild(root);
  const cleanup = () => { style.remove(); root.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  try {
    await (document as any).fonts?.ready;
    await new Promise((r) => setTimeout(r, 50));
    await printDocument(app.tab.displayName || 'Publication');
  } finally {
    setTimeout(cleanup, 60000);
  }
}

/** Print screen: options with a live preview, then print. */
export async function printPreviewDialog(app: App): Promise<void> {
  const pub = app.pub;
  const previewOf = (v: Record<string, any>) => {
    const { css, pages } = printPages(pub, toOptions(v));
    const scoped = css.replace(/@page[^}]*\}/g, '');
    return `<style>.qp-pp-preview .qp-pp-page{transform-origin:0 0;background:#fff;box-shadow:0 1px 4px #0004;margin:0 auto 12px} ${scoped.replace(/\.qp-pp-/g, '.qp-pp-preview .qp-pp-')}</style>
      <div class="qp-pp-preview" style="zoom:0.3">${pages.slice(0, 3).join('')}</div><p class="ql-help">${pages.length} sheet${pages.length === 1 ? '' : 's'}</p>`;
  };
  const r = await openDialog({
    title: 'Print', wide: true, ok: 'Print', preview: true,
    fields: [
      { key: 'range', label: 'Pages (e.g. 1-3, 5)', type: 'text', value: '', placeholder: 'All pages' },
      { key: 'spreads', label: 'Print spreads (facing pages side by side)', type: 'checkbox', value: false, visibleIf: () => pub.data.facing },
      { key: 'bleed', label: 'Include bleed', type: 'checkbox', value: pub.data.bleed > 0, visibleIf: () => pub.data.bleed > 0 },
      { key: 'marks', label: 'Crop marks', type: 'checkbox', value: false, visibleIf: (v) => !!v.bleed },
      { key: 'grayscale', label: 'Grayscale', type: 'checkbox', value: false },
      { key: 'paper', label: 'Paper', type: 'select', value: 'page', options: [{ value: 'page', label: 'Page size' }, { value: 'letter', label: 'Scale to Letter' }, { value: 'a4', label: 'Scale to A4' }] },
    ],
    onOpen: (ctl) => ctl.setPreview(previewOf(ctl.values())),
    onChange: (v, ctl) => ctl.setPreview(previewOf(v)),
    help: 'To make a PDF, choose "Save as PDF" in the system print dialog, or use File ▸ Export ▸ PDF for a vector PDF with page labels and bleed.',
  });
  if (r) await printPub(app, toOptions(r));
}

function toOptions(v: Record<string, any>): PrintOptions {
  return { range: v.range || '', spreads: !!v.spreads, bleed: !!v.bleed, marks: !!v.marks, grayscale: !!v.grayscale, paper: v.paper || 'page' };
}
