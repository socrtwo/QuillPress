/**
 * HTML export: one responsive web page with every publication page as inline vector SVG (text stays
 * selectable and searchable), a page navigation, and the stories as plain text for screen readers.
 */
import type { Pub } from '../model/pub';
import { pageSvg } from '../render/page';
import { escHtml } from '../util/sanitize';
import { embeddedFontCss } from './images';
import { textOf } from '../model/pub';
import type { Story } from '../model/types';
import { pathTextString } from '../render/pathText';

/** Footnotes of a story as "label text" lines, in reference order. */
function footnoteLines(s: Story): string[] {
  if (!s.footnotes?.length) return [];
  const order = s.paras.flatMap((p) => p.runs.filter((r) => r.footnote).map((r) => ({ id: r.footnote!, label: r.text })));
  return order.map((o) => { const fn = s.footnotes!.find((f) => f.id === o.id); return fn ? `${o.label} ${textOf(fn.paras)}` : ''; }).filter(Boolean);
}

/** Text set on paths, page by page. */
function pathTexts(pub: Pub): string[] {
  const out: string[] = [];
  const walk = (items: any[]) => { for (const e of items) { if (e.kind === 'pathText') { const t = pathTextString(e).trim(); if (t) out.push(t); } else if (e.kind === 'group') walk(e.children); } };
  for (const p of pub.pages) walk(p.items);
  return out;
}

export interface HtmlOptions { title?: string; fonts?: boolean; reflow?: boolean }

export async function pubToHtml(pub: Pub, opts: HtmlOptions = {}): Promise<string> {
  const title = opts.title || pub.data.props.title || 'Publication';
  const css = opts.fonts === false ? '' : await embeddedFontCss();
  const pages = pub.pages.map((p, i) => {
    const svg = pageSvg(pub, p, { mode: 'export' }).replace(/ width="[^"]*" height="[^"]*"/, '');
    return `<section class="page" id="page-${i + 1}" aria-label="Page ${escHtml(pub.pageLabel(i) || String(i + 1))}">${svg}</section>`;
  });
  const stories = pub.data.stories.map((s) => `<article>${s.paras.map((p) => `<p class="${escHtml((p.style || 'Body').replace(/\s+/g, '-').toLowerCase())}">${escHtml(textOf([p]))}</p>`).join('')}${footnoteLines(s).length ? `<footer class="footnotes">${footnoteLines(s).map((l) => `<p class="footnote">${escHtml(l)}</p>`).join('')}</footer>` : ''}</article>`).join('') + (pathTexts(pub).length ? `<aside>${pathTexts(pub).map((t) => `<p class="path-text">${escHtml(t)}</p>`).join('')}</aside>` : '');
  const nav = pub.pages.map((_, i) => `<a href="#page-${i + 1}">${escHtml(pub.pageLabel(i) || String(i + 1))}</a>`).join(' ');
  return `<!doctype html>
<html lang="${escHtml(pub.data.props.language || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="generator" content="QuillPress">
${pub.data.props.author ? `<meta name="author" content="${escHtml(pub.data.props.author)}">` : ''}
<style>
${css}
:root { color-scheme: light; }
body { margin: 0; background: #e6e8ec; font-family: system-ui, sans-serif; }
header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #d0d4da; padding: 8px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
header h1 { font-size: 16px; margin: 0; }
nav a { color: #5b3c9e; text-decoration: none; padding: 2px 6px; border-radius: 4px; }
nav a:hover { background: #ece6f6; }
main { max-width: 960px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 24px; }
.page { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.18); }
.page svg { display: block; width: 100%; height: auto; }
.reflow { display: ${opts.reflow ? 'block' : 'none'}; max-width: 720px; margin: 24px auto; background: #fff; padding: 24px; line-height: 1.5; }
.reflow p.heading-1 { font-size: 1.8em; font-weight: bold; } .reflow p.heading-2 { font-size: 1.4em; font-weight: bold; } .reflow p.heading-3 { font-weight: bold; }
.sr { position: absolute; left: -9999px; }
@media print { header { display: none; } body { background: #fff; } main { padding: 0; gap: 0; } .page { box-shadow: none; page-break-after: always; } }
</style>
</head>
<body>
<header><h1>${escHtml(title)}</h1><nav aria-label="Pages">${nav}</nav></header>
<main>
${pages.join('\n')}
</main>
<div class="${opts.reflow ? 'reflow' : 'sr'}" aria-label="Text of the publication">${stories}</div>
</body>
</html>`;
}

/** All stories as plain text or Markdown (headings and lists from the paragraph styles). */
export function pubToText(pub: Pub, markdown = false): string {
  const out: string[] = [];
  for (const s of pub.data.stories) {
    for (const p of s.paras) {
      const t = textOf([p]);
      if (!markdown) { out.push(t); continue; }
      const st = (p.style || '').toLowerCase();
      if (/heading 1|headline/.test(st)) out.push(`# ${t}`);
      else if (/heading 2|deck/.test(st)) out.push(`## ${t}`);
      else if (/heading 3|subhead/.test(st)) out.push(`### ${t}`);
      else if (/bullet/.test(st)) out.push(`- ${t}`);
      else if (/numbered/.test(st)) out.push(`1. ${t}`);
      else if (/quote/.test(st)) out.push(`> ${t}`);
      else out.push(t);
    }
    const notes = footnoteLines(s);
    if (notes.length) { out.push(''); out.push(...notes.map((l) => (markdown ? `[^${l.split(' ')[0]}]: ${l.slice(l.indexOf(' ') + 1)}` : l))); }
    out.push('');
  }
  const paths = pathTexts(pub);
  if (paths.length) { out.push(...paths); out.push(''); }
  return out.join('\n');
}
