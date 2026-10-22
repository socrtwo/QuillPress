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
import type { Page, Item, TextFrame, PictureFrame, ShapeItem, LineItem, GroupItem, Fill, Line, Dash } from '../../model/types';
import { harvestLayout, type LegacyImport } from '../legacyLayout';
import { mediaFromBytes } from '../images';
import { openPageMaker, readXforms, readFonts, readColors, readGlobalInfo, UNITS_PER_POINT, type PmFile, type Pt } from './records';
import { readPages, readMasters, type PmShape, type PmStroke, type PmFill } from './shapes';
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

interface Ctx { pub: Pub; env: TextEnv; warnings: string[]; counts: Record<string, number>; missingPictures: number; metafiles: number; nonPrinting: number }

/** Layer for objects PageMaker marks non-printing (QuillPress layers have no print switch of their own). */
const NON_PRINTING_LAYER = 'pm-nonprinting';

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
  const ctx: Ctx = { pub, env, warnings, counts: {}, missingPictures: 0, metafiles: 0, nonPrinting: 0 };
  const master = pub.data.masters[0];
  const halfW = global.pageW / 2, halfH = global.pageH / 2;
  // Single-sided: shapes sit around the page center. Double-sided: each page record holds the
  // shapes of a spread around the spine; those left of the spine belong to the previous (left-hand)
  // page, and a shape across the spine is drawn on both pages.
  const placed: { shape: PmShape; origin: Pt }[][] = pmPages.map(() => []);
  for (let i = 0; i < pmPages.length; i++) {
    for (const s of pmPages[i].shapes) {
      if (!global.doubleSided) { placed[i].push({ shape: s, origin: { x: halfW, y: halfH } }); continue; }
      const [x0, x1] = [Math.min(s.tl.x, s.br.x), Math.max(s.tl.x, s.br.x)];
      if (x1 >= 0) placed[i].push({ shape: s, origin: { x: 0, y: halfH } });
      if (x0 < 0 && i > 0 && (x1 < 0 || s.kind !== 'text')) placed[i - 1].push({ shape: s, origin: { x: global.pageW, y: halfH } });
    }
  }
  // Master pages: imported only when they hold objects (every master in the sample set is empty).
  // A single-sided publication uses the right-hand master; a double-sided one gets a left and a right
  // master, placed like the pages of a spread around the spine.
  const pmMasters = readMasters(file, xforms, warnings).filter((m) => m.shapes.length);
  const masterFor: { left?: string; right?: string } = {};
  if (pmMasters.length) {
    const used = global.doubleSided ? pmMasters : pmMasters.filter((m) => m.side === 'right').slice(0, 1);
    for (const m of used) {
      const qm = { ...master, id: newId('mst'), name: global.doubleSided ? `${m.name} (${m.side})` : m.name, side: (global.doubleSided ? m.side : 'single') as 'left' | 'right' | 'single', items: [] as Item[] };
      const origin: Pt = !global.doubleSided ? { x: halfW, y: halfH } : m.side === 'left' ? { x: global.pageW, y: halfH } : { x: 0, y: halfH };
      for (const shape of m.shapes) {
        try { const item = await toItem(ctx, shape, origin); if (item) qm.items.push(item); } catch (e) { warnings.push(`An object on the master page "${m.name}" was skipped (${(e as Error).message}).`); }
      }
      if (!qm.items.length) continue;
      pub.data.masters.push(qm);
      masterFor[m.side] = qm.id;
      ctx.counts.masterItems = (ctx.counts.masterItems || 0) + qm.items.length;
    }
    if (ctx.counts.masterItems) warnings.push(`${ctx.counts.masterItems} master page object${ctx.counts.masterItems === 1 ? ' was' : 's were'} imported; the master records were identified from the file layout, and their placement has not been checked against a file whose masters hold objects.`);
  }
  for (let i = 0; i < pmPages.length; i++) {
    // The first page of a double-sided publication is a right-hand page.
    const side = global.doubleSided ? (i % 2 === 0 ? 'right' : 'left') : 'right';
    const page: Page = { id: newId('pg'), master: masterFor[side] || masterFor.right || master.id, items: [] };
    for (const { shape, origin } of placed[i]) {
      try {
        const item = await toItem(ctx, shape, origin);
        if (item && shape.nonPrinting) {
          if (!pub.data.layers.some((l) => l.id === NON_PRINTING_LAYER)) pub.data.layers.push({ id: NON_PRINTING_LAYER, name: 'Non-printing (PageMaker)', color: '#9e9e9e' });
          item.layer = NON_PRINTING_LAYER;
          ctx.nonPrinting++;
        }
        if (item) page.items.push(item);
      } catch (e) { warnings.push(`An object on page ${i + 1} was skipped (${(e as Error).message}).`); }
    }
    pub.pages.push(page);
  }
  pub.pruneStories();
  summarize(ctx, name);
  return { pub, warnings, textOnly: false };
}

function strokeLine(ctx: Ctx, s: PmStroke | undefined, hairline = false): Line | undefined {
  if (!s || (!hairline && !(s.width > 0))) return undefined;
  const color = tinted(ctx.env.colors[s.color] || '#000000', s.tint || 100);
  const width = s.width > 0 ? r2(Math.max(0.25, s.width / 5)) : 0.25;
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
function boxOf(s: PmShape, origin: Pt): { x: number; y: number; w: number; h: number; rot?: number; skew?: number } {
  const x0 = Math.min(s.tl.x, s.br.x), y0 = Math.min(s.tl.y, s.br.y);
  const w = Math.abs(s.br.x - s.tl.x), h = Math.abs(s.br.y - s.tl.y);
  if (!s.xform.rotation && !s.xform.skew) return { x: r2(pt(x0 + origin.x)), y: r2(pt(y0 + origin.y)), w: r2(pt(w)), h: r2(pt(h)) };
  if (s.xform.skew) {
    // Skewed (and possibly rotated): the transform record holds the untransformed box; the shape
    // record's box bounds the transformed outline, which is symmetric about the shape's centre, so
    // the item is that box centred on the bounding box. PageMaker's positive skew leans the top edge
    // to the right (the pivot is the top-left corner of the leaning top edge), as the item's skew does.
    const bw = Math.abs(s.xform.botRight.x - s.xform.topLeft.x) || w, bh = Math.abs(s.xform.botRight.y - s.xform.topLeft.y) || h;
    const cx = x0 + w / 2 + origin.x, cy = y0 + h / 2 + origin.y;
    const deg = -s.xform.rotation;
    return { x: r2(pt(cx - bw / 2)), y: r2(pt(cy - bh / 2)), w: r2(pt(bw)), h: r2(pt(bh)), ...(deg ? { rot: r2(deg) } : {}), skew: r2(s.xform.skew) };
  }
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
  const base = { x: box.x, y: box.y, w: box.w, h: box.h, ...(box.rot ? { rot: box.rot } : {}), ...(box.skew ? { skew: box.skew } : {}) };
  switch (s.kind) {
    case 'line': {
      count('lines');
      const a = s.from || s.tl, b = s.to || s.br;
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
      // A line runs from its box's top-left to bottom-right unless flipped.
      const flipV = (a.x < b.x) !== (a.y < b.y) && a.y !== b.y;
      const l: LineItem = { id: newId('ln'), kind: 'line', name: 'Line', x: r2(pt(x0 + origin.x)), y: r2(pt(y0 + origin.y)), w: r2(pt(Math.abs(b.x - a.x))), h: r2(pt(Math.abs(b.y - a.y))), ...(flipV ? { flipV: true } : {}), line: strokeLine(ctx, s.stroke, true) };
      return l;
    }
    case 'group': {
      const children: Item[] = [];
      for (const c of s.children || []) { const it = await toItem(ctx, c, origin); if (it) children.push(it); }
      if (!children.length) return null;
      count('groups');
      const x = Math.min(...children.map((c) => c.x)), y = Math.min(...children.map((c) => c.y));
      const x2 = Math.max(...children.map((c) => c.x + c.w)), y2 = Math.max(...children.map((c) => c.y + c.h));
      const g: GroupItem = { id: newId('grp'), kind: 'group', name: 'Group', x: r2(x), y: r2(y), w: r2(x2 - x), h: r2(y2 - y), children };
      return g;
    }
    case 'rect': case 'ellipse': case 'polygon': {
      count('shapes');
      const sh: ShapeItem = { id: newId('shp'), kind: 'shape', name: s.kind === 'ellipse' ? 'Ellipse' : s.kind === 'polygon' ? 'Polygon' : 'Rectangle', ...base, geom: s.kind === 'ellipse' ? 'ellipse' : 'rect', fill: fillOf(ctx, s.fill) };
      const line = strokeLine(ctx, s.stroke);
      if (line) sh.line = line;
      if (s.kind === 'polygon' && s.points && s.points.length >= 2) {
        // Points are in page units; for a rotated or skewed polygon they are relative to the center
        // of its unrotated box (the transform record's box), which the item's rotation then turns.
        const turned = !!(s.xform.rotation || s.xform.skew);
        const x0 = turned ? Math.min(s.xform.topLeft.x, s.xform.botRight.x) : Math.min(s.tl.x, s.br.x);
        const y0 = turned ? Math.min(s.xform.topLeft.y, s.xform.botRight.y) : Math.min(s.tl.y, s.br.y);
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
      // PageMaker sizes a block to its lines exactly; let the frame grow so rounding never hides a line.
      const f: TextFrame = { id: newId('tf'), kind: 'text', name: 'Text Block', story: story.id, ...base, insets: [0, 0, 0, 0], autosize: 'height' };
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
  add(c.textBlocks, 'text block', 'text blocks'); add(c.pictures, 'picture', 'pictures'); add(c.lines, 'line', 'lines'); add(c.shapes, 'shape', 'shapes'); add(c.groups, 'group', 'groups');
  const pages = ctx.pub.pages.length;
  ctx.warnings.unshift(`PageMaker publication "${name}": ${pages} page${pages === 1 ? '' : 's'} read with ${parts.length ? parts.join(', ') : 'no objects'}. Text blocks are independent frames (PageMaker threads are not kept); master pages are imported when they hold objects.`);
  if (ctx.missingPictures) ctx.warnings.push(`${ctx.missingPictures} placed picture${ctx.missingPictures === 1 ? '' : 's'} could not be decoded (PageMaker keeps a TIFF copy in the file; compressed or unusual TIFFs are not readable yet). Place the original picture files again.`);
  if (ctx.nonPrinting) ctx.warnings.push(`${ctx.nonPrinting} object${ctx.nonPrinting === 1 ? ' is' : 's are'} marked non-printing in PageMaker (template instructions, fold lines); ${ctx.nonPrinting === 1 ? 'it is' : 'they are'} on the layer "Non-printing (PageMaker)": hide that layer before printing or exporting.`);
  if (ctx.metafiles) ctx.warnings.push(`${ctx.metafiles} placed Windows metafile${ctx.metafiles === 1 ? ' was' : 's were'} left as empty picture frames.`);
}
