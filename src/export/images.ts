/**
 * Page pictures: SVG (the renderer's output with the web fonts embedded, so it looks the same
 * anywhere), and PNG or JPEG rasterized from it with a canvas.
 */
import type { Pub } from '../model/pub';
import type { Page } from '../model/types';
import { pageSvg } from '../render/page';
import { FACES } from '../fonts';
import { b64 } from '../io/xml';

let fontCss: string | null = null;

/** @font-face rules with the bundled fonts inlined as data URLs (cached). */
export async function embeddedFontCss(): Promise<string> {
  if (fontCss != null) return fontCss;
  const rules: string[] = [];
  if (typeof fetch === 'function') {
    for (const [fam, aliases, weight, style, url] of FACES) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const data = b64(new Uint8Array(await r.arrayBuffer()));
        const src = `url(data:font/woff2;base64,${data}) format("woff2")`;
        rules.push(`@font-face{font-family:"${fam}";src:${src};font-weight:${weight};font-style:${style}}`);
        for (const a of aliases) rules.push(`@font-face{font-family:"${a}";src:${src};font-weight:${weight};font-style:${style}}`);
      } catch { /* offline dev server without the font */ }
    }
  }
  fontCss = rules.join('\n');
  return fontCss;
}

export interface ImageOptions { width?: number; format?: 'png' | 'jpeg'; quality?: number; bleed?: boolean; fonts?: boolean; grayscale?: boolean }

/** A page as a standalone SVG document. */
export async function pageToSvg(pub: Pub, page: Page, opts: ImageOptions = {}): Promise<string> {
  let svg = pageSvg(pub, page, { mode: 'export', bleed: opts.bleed, grayscale: opts.grayscale, width: opts.width });
  if (opts.fonts !== false) {
    const css = await embeddedFontCss();
    if (css) svg = svg.replace(/^(<svg[^>]*>)/, `$1<style>${css}</style>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
}

/** A page as PNG or JPEG bytes. */
export async function pageToImage(pub: Pub, page: Page, opts: ImageOptions = {}): Promise<Uint8Array> {
  const svg = await pageToSvg(pub, page, { ...opts, width: undefined });
  const width = opts.width || 1600;
  const bleed = opts.bleed ? pub.data.bleed : 0;
  const W = pub.size.w + bleed * 2, H = pub.size.h + bleed * 2;
  const height = Math.round((width * H) / W);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('The page picture could not be rendered.')); im.src = url; });
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const g = c.getContext('2d')!;
    if (opts.format === 'jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, width, height); }
    g.drawImage(img, 0, 0, width, height);
    const dataUrl = c.toDataURL(opts.format === 'jpeg' ? 'image/jpeg' : 'image/png', opts.quality ?? 0.92);
    const bin = atob(dataUrl.split(',')[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } finally { URL.revokeObjectURL(url); }
}
