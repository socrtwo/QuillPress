/**
 * PageMaker 6–7 layout import (.pmd, .p65, .pm6, .pmt; Mac and Windows).
 *
 * Reads the page size and sides, the shapes on each page (text blocks with their character and
 * paragraph formatting, lines, rectangles, ellipses, polygons, placed bitmaps with their TIFF bytes),
 * the fonts and colors, and builds a publication with the same pages. PageMaker 5 and earlier use
 * another file structure and go to the text harvest of src/io/legacyLayout.ts, as does any file this
 * reader cannot parse.
 */
import { Pub, newId } from '../../model/pub';
import type { Page, Item, TextFrame, PictureFrame, ShapeItem, LineItem, Fill, Line, Dash } from '../../model/types';
import { harvestLayout, type LegacyImport } from '../legacyLayout';
import { mediaFromBytes } from '../images';
import { openPageMaker, readXforms, readFonts, readColors, readGlobalInfo, UNITS_PER_POINT, type PmFile, type Pt } from './records';
import { readPages, type PmShape, type PmStroke, type PmFill } from './shapes';
import { textParagraphs, tinted, type TextEnv } from './text';

/** Imports a PageMaker publication; falls back to the text harvest when the layout cannot be read. */
export async function importPageMaker(data: Uint8Array, name: string): Promise<LegacyImport> {
  let file: PmFile;
  try { file = openPageMaker(data); } catch (e) { return harvestLayout(data, name, 'pmd', (e as Error).message); }
  try {
    return await readLayout(file, name);
  } catch (e) {
    return harvestLayout(data, name, 'pmd', `PageMaker 6–7 file: the layout could not be read (${(e as Error).message}).`);
  }
}

interface Ctx { pub: Pub; env: TextEnv; warnings: string[]; counts: Record<string, number>; missingPictures: number; metafiles: number }

const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (units: number) => units / UNITS_PER_POINT;

async function readLayout(file: PmFile, name: string): Promise<LegacyImport> {
  const warnings: string[] = [];
  const global = readGlobalInfo(file);
  const size = { w: r2(pt(global.pageW)), h: r2(pt(global.pageH)) };
  if (!(size.w > 10 && size.h > 10 && size.w < 20000 && size.h < 20000)) throw new Error('the page size is not plausible');
  const xforms = readXforms(file);
  const env: TextEnv = { fonts: readFonts(file), colors: readColors(file), encoding: file.encoding };
  const pmPages = readPages(file, xforms, warnings);
  if (!pmPages.length) throw new Error('no pages were found');
  const pub = Pub.blank(size, { facing: global.doubleSided, pages: 0 });
  pub.data.props.title = name.replace(/\.[^.]+$/, '');
  const ctx: Ctx = { pub, env, warnings, counts: {}, missingPictures: 0, metafiles: 0 };
  const master = pub.data.masters[0];
  const halfW = global.pageW / 2, halfH = global.pageH / 2;
  for (let i = 0; i < pmPages.length; i++) {
    const page: Page = { id: newId('pg'), master: master.id, items: [] };
    // Shapes sit around the page center; in a double-sided publication around the spine, with the
    // first page a right-hand page.
    const left = global.doubleSided && i % 2 === 1;
    const origin: Pt = global.doubleSided ? { x: left ? global.pageW : 0, y: halfH } : { x: halfW, y: halfH };
    for (const s of pmPages[i].shapes) {
      try {
        const item = await toItem(ctx, s, origin);
        if (!item) continue;
        if (global.doubleSided) {
          const cx = item.x + item.w / 2;
          if (cx < -size.w * 0.05 || cx > size.w * 1.05) continue; // the other page of the spread
        }
        page.items.push(item);
      } catch (e) { warnings.push(`An object on page ${i + 1} was skipped (${(e as Error).message}).`); }
    }
    pub.pages.push(page);
  }
  pub.pruneStories();
  summarize(ctx, name);
  return { pub, warnings, textOnly: false };
}

function strokeLine(ctx: Ctx, s: PmStroke | undefined): Line | undefined {
  if (!s) return undefined;
  const color = tinted(ctx.env.colors[s.color] || '#000000', s.tint || 100);
  const width = s.width > 0 ? r2(s.width / 5) : 0.25;
  const dash: Dash | undefined = s.type === 5 ? 'dash' : s.type === 6 ? 'sysDot' : s.type === 7 ? 'dot' : undefined;
  const l: Line = { width, fill: { type: 'solid', color } };
  if (dash) l.dash = dash;
  if (s.type === 7) l.cap = 'round';
  return l;
}

function fillOf(ctx: Ctx, f: PmFill | undefined): Fill {
  if (!f || f.type === 0) return { type: 'none' };
  if (f.type === 1) return { type: 'solid', color: '#ffffff' };
  const color = tinted(ctx.env.colors[f.color] || '#000000', f.tint || 100);
  if (f.type === 2) return { type: 'solid', color };
  const preset = ({ 3: 'vert', 4: 'vertTight', 5: 'horz', 6: 'horzTight', 7: 'dnDiag', 8: 'dnDiagTight', 9: 'cross', 10: 'crossTight' } as Record<number, string>)[f.type] || 'dots';
  return { type: 'pattern', fg: color, bg: '#ffffff', preset };
}

/** Box, rotation and position of a shape in page points. */
function boxOf(s: PmShape, origin: Pt): { x: number; y: number; w: number; h: number; rot?: number } {
  const x0 = Math.min(s.tl.x, s.br.x), y0 = Math.min(s.tl.y, s.br.y);
  const w = Math.abs(s.br.x - s.tl.x), h = Math.abs(s.br.y - s.tl.y);
  if (!s.xform.rotation && !s.xform.skew) return { x: r2(pt(x0 + origin.x)), y: r2(pt(y0 + origin.y)), w: r2(pt(w)), h: r2(pt(h)) };
  // Rotated: the transform record holds the unrotated box and the pivot; the box turns about the
  // pivot (its top-left corner), counter-clockwise for positive angles.
  const bw = Math.abs(s.xform.botRight.x - s.xform.topLeft.x) || w, bh = Math.abs(s.xform.botRight.y - s.xform.topLeft.y) || h;
  const deg = -s.xform.rotation;
  const th = (deg * Math.PI) / 180;
  const cx = s.xform.pivot.x + origin.x + (bw * Math.cos(th) - bh * Math.sin(th)) / 2;
  const cy = s.xform.pivot.y + origin.y + (bw * Math.sin(th) + bh * Math.cos(th)) / 2;
  return { x: r2(pt(cx - bw / 2)), y: r2(pt(cy - bh / 2)), w: r2(pt(bw)), h: r2(pt(bh)), rot: r2(deg) };
}

async function toItem(ctx: Ctx, s: PmShape, origin: Pt): Promise<Item | null> {
  const count = (k: string) => { ctx.counts[k] = (ctx.counts[k] || 0) + 1; };
  const box = boxOf(s, origin);
  const base = { x: box.x, y: box.y, w: box.w, h: box.h, ...(box.rot ? { rot: box.rot } : {}) };
  switch (s.kind) {
    case 'line': {
      count('lines');
      const l: LineItem = { id: newId('ln'), kind: 'line', name: 'Line', ...base, ...(s.mirrored ? { flipV: true } : {}), line: strokeLine(ctx, s.stroke) };
      return l;
    }
    case 'rect': case 'ellipse': case 'polygon': {
      count('shapes');
      const sh: ShapeItem = { id: newId('shp'), kind: 'shape', name: s.kind === 'ellipse' ? 'Ellipse' : s.kind === 'polygon' ? 'Polygon' : 'Rectangle', ...base, geom: s.kind === 'ellipse' ? 'ellipse' : 'rect', fill: fillOf(ctx, s.fill) };
      const line = strokeLine(ctx, s.stroke);
      if (line && s.stroke && s.stroke.width > 0) sh.line = line;
      if (s.kind === 'polygon' && s.points && s.points.length >= 2) {
        const x0 = Math.min(s.tl.x, s.br.x), y0 = Math.min(s.tl.y, s.br.y);
        const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${r2(pt(p.x - x0))} ${r2(pt(p.y - y0))}`).join(' ') + (s.closed ? ' Z' : '');
        sh.geom = 'custom';
        sh.path = [{ d, w: box.w || 1, h: box.h || 1 }];
      }
      return sh;
    }
    case 'text': {
      count('textBlocks');
      const paras = s.text ? textParagraphs(s.text, ctx.env) : [{ style: 'Body', runs: [] }];
      const story = ctx.pub.newStory(paras);
      const f: TextFrame = { id: newId('tf'), kind: 'text', name: 'Text Block', story: story.id, ...base, insets: [0, 0, 0, 0] };
      return f;
    }
    case 'picture': {
      count('pictures');
      const p: PictureFrame = { id: newId('pic'), kind: 'picture', name: 'Picture', ...base, fit: 'fill' };
      if (s.pictureKind === 'metafile') { ctx.metafiles++; p.name = 'Picture (metafile not supported)'; return p; }
      if (s.picture && s.picture.length > 8) {
        try { p.media = ctx.pub.addMedia(await mediaFromBytes(s.picture, 'picture.tif')); } catch { /* unreadable */ }
      }
      if (!p.media) { ctx.missingPictures++; p.name = 'Picture (not readable)'; }
      return p;
    }
  }
  return null;
}

function summarize(ctx: Ctx, name: string): void {
  const c = ctx.counts;
  const parts: string[] = [];
  const add = (n: number | undefined, one: string, many: string) => { if (n) parts.push(`${n} ${n === 1 ? one : many}`); };
  add(c.textBlocks, 'text block', 'text blocks'); add(c.pictures, 'picture', 'pictures'); add(c.lines, 'line', 'lines'); add(c.shapes, 'shape', 'shapes');
  const pages = ctx.pub.pages.length;
  ctx.warnings.unshift(`PageMaker publication "${name}": ${pages} page${pages === 1 ? '' : 's'} read with ${parts.length ? parts.join(', ') : 'no objects'}. Text blocks are independent frames (PageMaker threads are not kept); master page items are not stored with the pages and were not imported.`);
  if (ctx.missingPictures) ctx.warnings.push(`${ctx.missingPictures} placed picture${ctx.missingPictures === 1 ? '' : 's'} could not be decoded (PageMaker keeps a TIFF copy in the file; compressed or unusual TIFFs are not readable yet). Place the original picture files again.`);
  if (ctx.metafiles) ctx.warnings.push(`${ctx.metafiles} placed Windows metafile${ctx.metafiles === 1 ? ' was' : 's were'} left as empty picture frames.`);
}
