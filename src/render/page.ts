/**
 * The one page renderer: SVG markup for a page or a master page, used by the editing canvas,
 * thumbnails, print and the SVG, PNG and PDF exporters. Master items are drawn under page items.
 */
import type { Pub } from '../model/pub';
import type { Fill, Item, Line, Master, Page, PictureFrame, ShapeItem, TableItem, TextFrame, LineItem, Paragraph, PathTextItem } from '../model/types';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';
import { colorHex, resolvePara, resolveRun } from '../model/styles';
import { geometryPath, scalePath } from '../model/geometry';
import { frameBoxes, frameLines, layoutOptions, storyOptions, cssFamily, syncAnchors, anchorPointOf } from './flow';
import { layoutStory, type LaidLine, type FlowBox, cssFont } from './text';
import { pathTextLayout } from './pathText';
import { escHtml } from '../util/sanitize';

export type Owner = Page | Master;
export const isPage = (o: Owner): o is Page => 'master' in o;

export interface RenderOptions {
  mode?: 'edit' | 'thumb' | 'print' | 'export';
  /** Emit data-id attributes (for hit testing). */
  ids?: boolean;
  /** Items not drawn (being edited in place). */
  hide?: Set<string>;
  /** Margin, column and ruler guides. */
  guides?: boolean;
  /** Document grid spacing (0 = none). */
  grid?: number;
  baselineGrid?: boolean;
  frameEdges?: boolean;
  /** Show the bleed area: adds `bleed` points around the page to the viewBox. */
  bleed?: boolean;
  grayscale?: boolean;
  /** Draw the master's items under the page (default true). */
  master?: boolean;
  /** Highlight the frames of this story (text threads). */
  threads?: string | null;
  /** Page index for page-number fields (default: the page's position). */
  pageIndex?: number;
  /** Replace the page's items (previews while dragging). */
  items?: Item[];
  /** Hidden layers are not drawn (default true in all modes). */
  width?: number;
}

interface Ctx { pub: Pub; opts: RenderOptions; defs: string[]; prefix: string; pageIndex: number; owner: Owner; onPage: boolean }

const n = (v: number) => (Math.round(v * 100) / 100).toString();
let uid = 0;

/** SVG markup of a page (or master) at the publication's page size. */
export function pageSvg(pub: Pub, owner: Owner, opts: RenderOptions = {}): string {
  const { w, h } = pub.size;
  const bleed = opts.bleed ? pub.data.bleed : 0;
  const pad = bleed;
  const pageIndex = opts.pageIndex ?? (isPage(owner) ? pub.pageIndex(owner.id) : -1);
  const ctx: Ctx = { pub, opts, defs: [], prefix: `p${(uid++ % 100000).toString(36)}`, pageIndex, owner, onPage: isPage(owner) };
  // Objects anchored in text sit where the text puts them; lay out those stories before drawing.
  if (!opts.items) syncAnchors(pub);
  const body: string[] = [];
  // Background
  const bg = isPage(owner) ? owner.bg : undefined;
  body.push(`<rect x="${n(-pad)}" y="${n(-pad)}" width="${n(w + pad * 2)}" height="${n(h + pad * 2)}" fill="#fff" class="qp-bg"/>`);
  if (bg && bg.type !== 'none') body.push(`<rect x="${n(-pad)}" y="${n(-pad)}" width="${n(w + pad * 2)}" height="${n(h + pad * 2)}" fill="${fillPaint(ctx, bg, w, h)}"/>`);
  // Master items under page items
  if (isPage(owner) && opts.master !== false && !owner.hideMasterItems) {
    const m = pub.masterOf(owner);
    const overridden = new Set(owner.items.map((e) => e.masterOf).filter(Boolean));
    body.push(`<g class="qp-master-items" data-master="${m.id}">`);
    for (const e of m.items) if (!overridden.has(e.id)) body.push(itemSvg({ ...ctx, ids: false } as any, e, m, true));
    body.push('</g>');
  }
  const items = opts.items || owner.items;
  body.push('<g class="qp-items">');
  for (const e of items) body.push(itemSvg(ctx, e, owner, false));
  body.push('</g>');
  if (opts.mode === 'edit') body.push(chrome(ctx, owner, w, h, bleed));
  const filter = opts.grayscale ? ` filter="grayscale(1)"` : '';
  const viewBox = `${n(-pad)} ${n(-pad)} ${n(w + pad * 2)} ${n(h + pad * 2)}`;
  const width = opts.width ? ` width="${n(opts.width)}" height="${n((opts.width * (h + pad * 2)) / (w + pad * 2))}"` : ` width="${n(w + pad * 2)}" height="${n(h + pad * 2)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}"${width} class="qp-page-svg"${filter}>${ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : ''}${body.join('')}</svg>`;
}

// ------------------------------------------------------------------------------------------
// Chrome: margins, columns, guides, grids, bleed

function chrome(ctx: Ctx, owner: Owner, w: number, h: number, bleed: number): string {
  const pub = ctx.pub;
  const o = ctx.opts;
  const out: string[] = [];
  const g = isPage(owner) ? pub.geometry(owner) : { margins: owner.margins, columns: owner.columns, gutter: owner.gutter };
  if (o.guides !== false) {
    let [mt, mr, mb, ml] = g.margins;
    const side = isPage(owner) ? pub.pageSide(ctx.pageIndex) : owner.side || 'single';
    if (side === 'left') [ml, mr] = [mr, ml];
    out.push(`<rect x="${n(ml)}" y="${n(mt)}" width="${n(w - ml - mr)}" height="${n(h - mt - mb)}" fill="none" stroke="#e040a0" stroke-width="0.5" vector-effect="non-scaling-stroke" class="qp-margins"/>`);
    const cols = Math.max(1, g.columns);
    if (cols > 1) {
      const cw = (w - ml - mr - g.gutter * (cols - 1)) / cols;
      for (let c = 1; c < cols; c++) {
        const x1 = ml + c * cw + (c - 1) * g.gutter, x2 = x1 + g.gutter;
        out.push(`<path d="M${n(x1)} ${n(mt)} V${n(h - mb)} M${n(x2)} ${n(mt)} V${n(h - mb)}" stroke="#9b6bd6" stroke-width="0.5" vector-effect="non-scaling-stroke" class="qp-columns"/>`);
      }
    }
    for (const gd of [...(isPage(owner) ? pub.masterOf(owner).guides || [] : []), ...(owner.guides || [])]) {
      out.push(gd.dir === 'h' ? `<path d="M${n(-bleed)} ${n(gd.pos)} H${n(w + bleed)}" stroke="#00b8d9" stroke-width="0.5" vector-effect="non-scaling-stroke" class="qp-guide" data-guide="${gd.dir}:${n(gd.pos)}"/>` : `<path d="M${n(gd.pos)} ${n(-bleed)} V${n(h + bleed)}" stroke="#00b8d9" stroke-width="0.5" vector-effect="non-scaling-stroke" class="qp-guide" data-guide="${gd.dir}:${n(gd.pos)}"/>`);
    }
  }
  if (bleed > 0) out.push(`<rect x="${n(-bleed)}" y="${n(-bleed)}" width="${n(w + bleed * 2)}" height="${n(h + bleed * 2)}" fill="none" stroke="#d32f2f" stroke-width="0.5" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" class="qp-bleed"/>`);
  if (o.grid && o.grid > 0) {
    const id = `${ctx.prefix}grid`;
    ctx.defs.push(`<pattern id="${id}" width="${n(o.grid)}" height="${n(o.grid)}" patternUnits="userSpaceOnUse"><path d="M${n(o.grid)} 0 L0 0 0 ${n(o.grid)}" fill="none" stroke="#bbb" stroke-width="0.3"/></pattern>`);
    out.push(`<rect width="${n(w)}" height="${n(h)}" fill="url(#${id})" pointer-events="none"/>`);
  }
  if (o.baselineGrid && pub.data.baselineGrid.step > 0) {
    const { start, step } = pub.data.baselineGrid;
    const d: string[] = [];
    for (let y = start; y < h; y += step) d.push(`M0 ${n(y)} H${n(w)}`);
    out.push(`<path d="${d.join(' ')}" stroke="#8ab4f8" stroke-width="0.25" vector-effect="non-scaling-stroke" opacity="0.8" pointer-events="none"/>`);
  }
  return `<g class="qp-chrome" pointer-events="none">${out.join('')}</g>`;
}

// ------------------------------------------------------------------------------------------
// Fills and lines

export function fillPaint(ctx: Ctx, fill: Fill | undefined, w: number, h: number): string {
  const d = ctx.pub.data;
  if (!fill || fill.type === 'none') return 'none';
  if (fill.type === 'solid') return colorHex(d, fill.color);
  if (fill.type === 'gradient') {
    const id = `${ctx.prefix}g${ctx.defs.length}`;
    const stops = fill.stops.map((s) => `<stop offset="${n(s.pos * 100)}%" stop-color="${colorHex(d, s.color)}"/>`).join('');
    if (fill.path === 'radial') ctx.defs.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
    else {
      const a = ((fill.angle ?? 90) * Math.PI) / 180;
      const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
      ctx.defs.push(`<linearGradient id="${id}" x1="${n(0.5 - dx)}" y1="${n(0.5 - dy)}" x2="${n(0.5 + dx)}" y2="${n(0.5 + dy)}">${stops}</linearGradient>`);
    }
    return `url(#${id})`;
  }
  if (fill.type === 'image') {
    const id = `${ctx.prefix}i${ctx.defs.length}`;
    const href = ctx.pub.mediaUrl(fill.media);
    if (fill.mode === 'tile') ctx.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="96" height="96"><image href="${href}" width="96" height="96"/></pattern>`);
    else ctx.defs.push(`<pattern id="${id}" patternUnits="objectBoundingBox" width="1" height="1" patternContentUnits="objectBoundingBox"><image href="${href}" width="1" height="1" preserveAspectRatio="${fill.mode === 'fit' ? 'xMidYMid meet' : 'none'}"${fill.alpha != null ? ` opacity="${fill.alpha}"` : ''}/></pattern>`);
    return `url(#${id})`;
  }
  if (fill.type === 'pattern') {
    const id = `${ctx.prefix}p${ctx.defs.length}`;
    const fg = colorHex(d, fill.fg), bg = colorHex(d, fill.bg, '#FFFFFF');
    const p = fill.preset || '';
    const mark = /horz/i.test(p) ? `<path d="M0 4 H8" stroke="${fg}"/>` : /vert/i.test(p) ? `<path d="M4 0 V8" stroke="${fg}"/>` : /dn|down|wd/i.test(p) ? `<path d="M0 0 L8 8" stroke="${fg}"/>` : /cross/i.test(p) ? `<path d="M0 4 H8 M4 0 V8" stroke="${fg}"/>` : /up/i.test(p) ? `<path d="M0 8 L8 0" stroke="${fg}"/>` : `<rect x="3" y="3" width="2" height="2" fill="${fg}"/>`;
    ctx.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="${bg}"/>${mark}</pattern>`);
    return `url(#${id})`;
  }
  void w; void h;
  return 'none';
}

const DASH: Record<string, (w: number) => string> = {
  dash: (w) => `${4 * w} ${3 * w}`, dot: (w) => `${w} ${2 * w}`, dashDot: (w) => `${4 * w} ${2 * w} ${w} ${2 * w}`,
  longDash: (w) => `${8 * w} ${3 * w}`, longDashDot: (w) => `${8 * w} ${3 * w} ${w} ${3 * w}`, sysDash: (w) => `${3 * w} ${w}`, sysDot: (w) => `${w} ${w}`,
};

export function strokeAttrs(ctx: Ctx, line: Line | undefined): string {
  if (!line || !line.fill || line.fill.type === 'none') return ' stroke="none"';
  const color = line.fill.type === 'solid' ? colorHex(ctx.pub.data, line.fill.color) : fillPaint(ctx, line.fill, 1, 1);
  const w = line.width ?? 0.75;
  let a = ` stroke="${color}" stroke-width="${n(w)}"`;
  if (line.dash && line.dash !== 'solid') a += ` stroke-dasharray="${DASH[line.dash]?.(Math.max(w, 1)) || ''}"`;
  if (line.cap) a += ` stroke-linecap="${line.cap === 'flat' ? 'butt' : line.cap}"`;
  if (line.join) a += ` stroke-linejoin="${line.join}"`;
  for (const end of ['head', 'tail'] as const) {
    const kind = line[end];
    if (!kind || kind === 'none') continue;
    const id = `${ctx.prefix}m${ctx.defs.length}`;
    const shape = kind === 'oval' ? '<circle cx="5" cy="5" r="4"/>' : kind === 'diamond' ? '<path d="M5 0 L10 5 L5 10 L0 5 Z"/>' : kind === 'arrow' ? `<path d="M0 0 L10 5 L0 10" fill="none" stroke="${color}" stroke-width="1.5"/>` : kind === 'stealth' ? '<path d="M0 0 L10 5 L0 10 L3 5 Z"/>' : '<path d="M0 0 L10 5 L0 10 Z"/>';
    ctx.defs.push(`<marker id="${id}" viewBox="0 0 10 10" refX="${end === 'tail' ? 8 : 2}" refY="5" markerWidth="${n(Math.max(3, 3 + w))}" markerHeight="${n(Math.max(3, 3 + w))}" orient="auto-start-reverse" fill="${color}">${shape}</marker>`);
    a += end === 'head' ? ` marker-start="url(#${id})"` : ` marker-end="url(#${id})"`;
  }
  return a;
}

function effectsAttr(ctx: Ctx, e: Item): string {
  const ef = e.effects;
  if (!ef || (!ef.shadow && !ef.glow && !ef.softEdge)) return '';
  const id = `${ctx.prefix}f${ctx.defs.length}`;
  const d = ctx.pub.data;
  const parts: string[] = [];
  if (ef.shadow) { const a = (ef.shadow.dir * Math.PI) / 180; parts.push(`<feDropShadow dx="${n(Math.cos(a) * ef.shadow.dist)}" dy="${n(Math.sin(a) * ef.shadow.dist)}" stdDeviation="${n(ef.shadow.blur / 2)}" flood-color="${colorHex(d, ef.shadow.color)}" flood-opacity="${ef.shadow.alpha ?? 0.5}"/>`); }
  if (ef.glow) parts.push(`<feMorphology operator="dilate" radius="${n(ef.glow.rad / 2)}" in="SourceAlpha" result="dl"/><feGaussianBlur in="dl" stdDeviation="${n(ef.glow.rad / 2)}" result="bl"/><feFlood flood-color="${colorHex(d, ef.glow.color)}" flood-opacity="0.7"/><feComposite in2="bl" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>`);
  if (ef.softEdge) parts.push(`<feGaussianBlur stdDeviation="${n(ef.softEdge / 2)}"/>`);
  ctx.defs.push(`<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">${parts.join('')}</filter>`);
  return ` filter="url(#${id})"`;
}

// ------------------------------------------------------------------------------------------
// Items

function transformOf(e: Item): string {
  const t: string[] = [`translate(${n(e.x)} ${n(e.y)})`];
  if (e.rot) t.push(`rotate(${n(e.rot)} ${n(e.w / 2)} ${n(e.h / 2)})`);
  if (e.flipH || e.flipV) t.push(`translate(${e.flipH ? n(e.w) : 0} ${e.flipV ? n(e.h) : 0}) scale(${e.flipH ? -1 : 1} ${e.flipV ? -1 : 1})`);
  return t.join(' ');
}

export function itemSvg(ctx: Ctx & { ids?: boolean }, e: Item, owner: Owner, fromMaster: boolean): string {
  if (e.hidden || ctx.opts.hide?.has(e.id)) return '';
  const layer = ctx.pub.layer(e.layer);
  if (layer?.hidden) return '';
  const ids = ctx.ids !== false && ctx.opts.ids;
  const attrs = `${ids ? ` data-id="${e.id}"` : ''} data-kind="${e.kind}"${fromMaster ? ' data-from-master="1"' : ''}${e.alpha != null && e.alpha < 1 ? ` opacity="${e.alpha}"` : ''}${effectsAttr(ctx, e)}`;
  let inner = '';
  switch (e.kind) {
    case 'text': inner = textFrameSvg(ctx, e, owner, fromMaster); break;
    case 'picture': inner = pictureSvg(ctx, e); break;
    case 'shape': inner = shapeSvg(ctx, e); break;
    case 'line': inner = lineSvg(ctx, e); break;
    case 'table': inner = tableSvg(ctx, e); break;
    case 'group': inner = e.children.map((c) => itemSvg(ctx, c, owner, fromMaster)).join(''); break;
    case 'pathText': inner = pathTextSvg(ctx, e); break;
  }
  const link = e.link && ctx.opts.mode !== 'edit' ? [`<a href="${escHtml(e.link)}">`, '</a>'] : ['', ''];
  let mark = '';
  if (e.anchored && ctx.opts.mode === 'edit' && !fromMaster) {
    // Anchor marker at the point on the line the object hangs from, and a dotted line to the object.
    const ap = anchorPointOf(ctx.pub, e.id);
    const ax = ap ? ap.x : e.x, ay = ap ? ap.y : e.y;
    mark = `<g class="qp-anchor-mark" pointer-events="none">${ap && (Math.abs(ap.x - e.x) > 2 || Math.abs(ap.y - e.y) > 2) ? `<path d="M${n(ax)} ${n(ay)} L${n(e.x)} ${n(e.y)}" stroke="#1e88e5" stroke-width="0.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` : ''}<g transform="translate(${n(ax - 4)} ${n(ay - 9)})"><rect width="8" height="8" rx="1.5" fill="#1e88e5"/><path d="M4 1.5 V6.5 M2 4 H6 M1.8 5.2 Q4 7.4 6.2 5.2" stroke="#fff" stroke-width="0.9" fill="none"/></g></g>`;
  }
  return `${link[0]}<g transform="${transformOf(e)}" class="qp-item qp-${e.kind}${e.anchored ? ' qp-anchored' : ''}"${attrs}>${inner}</g>${link[1]}${mark}`;
}

function frameFillLine(ctx: Ctx, e: Item): { fill: Fill | undefined; line: Line | undefined } {
  const os = ctx.pub.objectStyle(e.ostyle);
  return { fill: e.fill ?? os?.fill, line: e.line ?? os?.line };
}

function textFrameSvg(ctx: Ctx, f: TextFrame, owner: Owner, fromMaster: boolean): string {
  const pub = ctx.pub;
  const { fill, line } = frameFillLine(ctx, f);
  const { d } = geometryPath(f.geom || 'rect', f.w, f.h);
  let out = '';
  const paint = fillPaint(ctx, fill, f.w, f.h);
  const stroke = strokeAttrs(ctx, line);
  if (paint !== 'none' || !stroke.includes('stroke="none"')) out += `<path d="${d}" fill="${paint}"${stroke}/>`;
  else out += `<path d="${d}" fill="transparent" stroke="none"/>`;
  // Lines: frames on the page use the story's cached flow; master frames shown on a page are laid out for that page.
  let lines: LaidLine[];
  let overset = false;
  let separators: { x: number; y: number; w: number }[] = [];
  if (fromMaster && ctx.onPage) {
    const story = pub.story(f.story);
    const boxes = frameBoxes(f, owner, ctx.pageIndex, pub);
    const r = story ? layoutStory(story.paras, storyOptions(pub, story, boxes, { anchor: (f.columns || 1) === 1 ? f.anchor : undefined })) : { lines: [], overset: undefined, separators: [] };
    lines = r.lines; overset = !!r.overset; separators = r.separators;
  } else {
    const fl = frameLines(pub, f);
    lines = fl.lines; overset = fl.overset; separators = fl.separators;
  }
  const clipId = `${ctx.prefix}c${ctx.defs.length}`;
  ctx.defs.push(`<clipPath id="${clipId}"><path d="${d}"/></clipPath>`);
  const sepW = (pub.data.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS).separator.width;
  const seps = separators.filter((sp) => sp.w > 0 && sepW > 0).map((sp) => `<path d="M${n(sp.x)} ${n(sp.y)} H${n(sp.x + sp.w)}" stroke="${colorHex(pub.data, 'Black')}" stroke-width="${n(sepW)}" class="qp-fn-sep"/>`).join('');
  out += `<g clip-path="url(#${clipId})" transform="translate(${n(-f.x)} ${n(-f.y)})">${linesSvg(ctx, lines)}${seps}</g>`;
  if (ctx.opts.mode === 'edit') {
    if (ctx.opts.frameEdges !== false) out += `<path d="${d}" fill="none" stroke="#9aa0a6" stroke-width="0.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" class="qp-frame-edge"/>`;
    if (overset) out += `<g class="qp-overset" transform="translate(${n(f.w - 10)} ${n(f.h - 10)})"><rect width="9" height="9" fill="#fff" stroke="#d32f2f" stroke-width="0.8"/><path d="M4.5 2 V7 M2 4.5 H7" stroke="#d32f2f" stroke-width="1.2"/></g>`;
    if (ctx.opts.threads && ctx.opts.threads === f.story) out += `<path d="${d}" fill="none" stroke="#1e88e5" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    if (!lines.length && ctx.opts.mode === 'edit' && !fromMaster) out += `<text x="${n((f.insets || [4])[0] + 2)}" y="${n((f.insets || [4, 4])[1] + 11)}" font-size="9" fill="#9aa0a6" font-family="system-ui, sans-serif" class="qp-prompt">${f.next || f.prev ? '' : 'Type or place text'}</text>`;
  }
  return out;
}

/** SVG <text> elements for laid-out lines (page coordinates). */
export function linesSvg(ctx: Ctx, lines: LaidLine[]): string {
  const d = ctx.pub.data;
  const out: string[] = [];
  for (const l of lines) {
    const parts: string[] = [];
    if (l.bullet) parts.push(`<text x="${n(l.bullet.x)}" y="${n(l.y)}" font-size="${n(l.bullet.size)}" font-family="${escHtml(cssFamily(l.bullet.font))}" fill="${colorHex(d, l.bullet.color)}">${escHtml(l.bullet.text)}</text>`);
    const spans: string[] = [];
    for (const s of l.segs) {
      if (!s.text) continue;
      const st = s.style;
      const color = colorHex(d, st.color);
      const deco = [st.u ? 'underline' : '', st.strike ? 'line-through' : ''].filter(Boolean).join(' ');
      const baseline = st.baseline ? ` baseline-shift="${st.baseline > 0 ? 'super' : 'sub'}"` : '';
      let style = `font-family:${escHtml(cssFamily(s.font))};font-size:${n(s.size)}px;${st.b ? 'font-weight:bold;' : ''}${st.i ? 'font-style:italic;' : ''}${deco ? `text-decoration:${deco};` : ''}${st.caps === 'small' ? 'font-variant:small-caps;' : ''}${st.spc ? `letter-spacing:${n(st.spc)}px;` : ''}${st.liga === false ? 'font-variant-ligatures:none;' : ''}${st.kern === false ? 'font-kerning:none;' : ''}`;
      if (st.highlight) { const hx = colorHex(d, st.highlight); parts.push(`<rect x="${n(l.x + s.x)}" y="${n(l.y - l.ascent)}" width="${n(s.w)}" height="${n(l.ascent * 1.25)}" fill="${hx}"/>`); }
      if (s.drop) {
        const dy = l.y + (s.drop - 1) * l.height;
        parts.push(`<text x="${n(l.x + s.x)}" y="${n(dy)}" fill="${color}" style="${style}" xml:space="preserve">${escHtml(s.text)}</text>`);
        continue;
      }
      spans.push(`<tspan x="${n(l.x + s.x)}" fill="${color}" style="${style}"${baseline}>${escHtml(s.text)}</tspan>`);
    }
    if (spans.length) parts.push(`<text y="${n(l.y)}" xml:space="preserve" data-line="${l.para}:${l.start}">${spans.join('')}</text>`);
    out.push(parts.join(''));
  }
  return out.join('');
}

/** Text on a path: one positioned <text> per glyph (the PDF writer places the same glyphs), plus the path when shown. */
function pathTextSvg(ctx: Ctx, e: PathTextItem): string {
  const pub = ctx.pub;
  const d = pub.data;
  const out: string[] = [];
  const sx = e.path.w ? e.w / e.path.w : 1, sy = e.path.h ? e.h / e.path.h : 1;
  const local = scalePath(e.path.d, sx, sy);
  const { line } = frameFillLine(ctx, e);
  const stroke = strokeAttrs(ctx, line);
  if (e.showPath && !stroke.includes('stroke="none"')) out.push(`<path d="${local}" fill="none"${stroke}/>`);
  else if (ctx.opts.mode === 'edit') out.push(`<path d="${local}" fill="none" stroke="#9aa0a6" stroke-width="0.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" class="qp-frame-edge"/>`);
  // Glyphs in the item's local box (the group's transform adds the position, rotation and flips).
  const r = pathTextLayout({ ...e, x: 0, y: 0, rot: undefined, flipH: undefined, flipV: undefined }, layoutOptions(pub, []));
  const glyphs: string[] = [];
  for (const g of r.glyphs) {
    const st = g.style;
    const deco = [st.u ? 'underline' : '', st.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    const style = `font-family:${escHtml(cssFamily(g.font))};font-size:${n(g.size)}px;${st.b ? 'font-weight:bold;' : ''}${st.i ? 'font-style:italic;' : ''}${deco ? `text-decoration:${deco};` : ''}${st.caps === 'small' ? 'font-variant:small-caps;' : ''}`;
    glyphs.push(`<text transform="translate(${n(g.x)} ${n(g.y)}) rotate(${n(g.angle)})" text-anchor="middle" fill="${colorHex(d, st.color)}" style="${style}" data-glyph="1">${escHtml(g.ch)}</text>`);
  }
  out.push(`<g class="qp-pathtext-glyphs">${glyphs.join('')}</g>`);
  if (ctx.opts.mode === 'edit' && !r.glyphs.length) out.push(`<text x="4" y="${n(Math.min(e.h, 14))}" font-size="9" fill="#9aa0a6" font-family="system-ui, sans-serif" class="qp-prompt">Double-click to type on the path</text>`);
  if (ctx.opts.mode === 'edit' && r.overflow) out.push(`<g class="qp-overset" transform="translate(${n(e.w - 10)} ${n(e.h - 10)})"><rect width="9" height="9" fill="#fff" stroke="#d32f2f" stroke-width="0.8"/><path d="M4.5 2 V7 M2 4.5 H7" stroke="#d32f2f" stroke-width="1.2"/></g>`);
  return out.join('');
}

function pictureSvg(ctx: Ctx, p: PictureFrame): string {
  const pub = ctx.pub;
  const { fill, line } = frameFillLine(ctx, p);
  const { d } = geometryPath(p.geom || 'rect', p.w, p.h);
  let out = '';
  const paint = fillPaint(ctx, fill, p.w, p.h);
  if (paint !== 'none') out += `<path d="${d}" fill="${paint}"/>`;
  const href = pub.mediaUrl(p.media);
  if (href) {
    const m = pub.media[p.media!];
    const mw = m.w || 1000, mh = m.h || Math.round(1000 * (p.h / Math.max(1, p.w)));
    const [cl, ct, cr, cb] = p.crop || [0, 0, 0, 0];
    const vb = `${n(cl * mw)} ${n(ct * mh)} ${n(Math.max(1, (1 - cl - cr) * mw))} ${n(Math.max(1, (1 - ct - cb) * mh))}`;
    const fit = p.fit || 'fill';
    const par = fit === 'fill' ? 'xMidYMid slice' : fit === 'fit' ? 'xMidYMid meet' : 'none';
    const filters: string[] = [];
    if (p.brightness) filters.push(`brightness(${1 + p.brightness / 100})`);
    if (p.contrast) filters.push(`contrast(${1 + p.contrast / 100})`);
    if (p.saturation != null && p.saturation !== 0) filters.push(`saturate(${1 + p.saturation / 100})`);
    if (p.grayscale) filters.push('grayscale(1)');
    const filter = filters.length ? ` style="filter:${filters.join(' ')}"` : '';
    const clipId = `${ctx.prefix}c${ctx.defs.length}`;
    ctx.defs.push(`<clipPath id="${clipId}"><path d="${d}"/></clipPath>`);
    if (fit === 'tile') {
      const pid = `${ctx.prefix}t${ctx.defs.length}`;
      const tw = (mw * 0.75) * (p.pos?.scale || 1), th = (mh * 0.75) * (p.pos?.scale || 1);
      ctx.defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${n(tw)}" height="${n(th)}"><image href="${href}" width="${n(tw)}" height="${n(th)}"/></pattern>`);
      out += `<path d="${d}" fill="url(#${pid})"${filter}/>`;
    } else if (fit === 'none') {
      const sc = (p.pos?.scale || 1) * 0.75;
      out += `<g clip-path="url(#${clipId})"><svg x="${n(p.pos?.x || 0)}" y="${n(p.pos?.y || 0)}" width="${n(mw * (1 - cl - cr) * sc)}" height="${n(mh * (1 - ct - cb) * sc)}" viewBox="${vb}" preserveAspectRatio="none"${filter}><image href="${href}" width="${n(mw)}" height="${n(mh)}" preserveAspectRatio="none"/></svg></g>`;
    } else {
      out += `<g clip-path="url(#${clipId})"><svg width="${n(p.w)}" height="${n(p.h)}" viewBox="${vb}" preserveAspectRatio="${par}"${filter}><image href="${href}" width="${n(mw)}" height="${n(mh)}" preserveAspectRatio="none"/></svg></g>`;
    }
  } else if (ctx.opts.mode === 'edit') {
    out += `<path d="${d}" fill="#f3f4f6"/><path d="M0 0 L${n(p.w)} ${n(p.h)} M${n(p.w)} 0 L0 ${n(p.h)}" stroke="#c0c4cc" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`;
  }
  const stroke = strokeAttrs(ctx, line);
  if (!stroke.includes('stroke="none"')) out += `<path d="${d}" fill="none"${stroke}/>`;
  if (ctx.opts.mode === 'edit' && ctx.opts.frameEdges !== false) out += `<path d="${d}" fill="none" stroke="#9aa0a6" stroke-width="0.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" class="qp-frame-edge"/>`;
  return out;
}

function shapeSvg(ctx: Ctx, s: ShapeItem): string {
  const { fill, line } = frameFillLine(ctx, s);
  const { d, open } = geometryPath(s.geom, s.w, s.h, s.adj, s.path);
  const def = defaultShapeFillLine(s);
  const paint = open ? 'none' : fillPaint(ctx, fill ?? def.fill, s.w, s.h);
  const stroke = strokeAttrs(ctx, line ?? def.line);
  if (paint === 'none' && stroke.includes('stroke="none"')) return `<path d="${d}" fill="transparent" stroke="none"/>`;
  return `<path d="${d}" fill="${paint}"${stroke} fill-rule="evenodd"/>`;
}

export function defaultShapeFillLine(s: ShapeItem): { fill: Fill; line: Line } {
  if (/^(line|straightConnector1|bentConnector\d|curvedConnector\d|arc|bracketPair|bracePair)$/.test(s.geom)) return { fill: { type: 'none' }, line: { fill: { type: 'solid', color: 'Black' }, width: 1 } };
  return { fill: { type: 'solid', color: 'Primary' }, line: { fill: { type: 'none' } } };
}

function lineSvg(ctx: Ctx, l: LineItem): string {
  const { line } = frameFillLine(ctx, l);
  const stroke = strokeAttrs(ctx, line ?? { fill: { type: 'solid', color: 'Black' }, width: 1 });
  return `<path d="M0 0 L${n(l.w)} ${n(l.h)}" fill="none"${stroke}/><path d="M0 0 L${n(l.w)} ${n(l.h)}" fill="none" stroke="transparent" stroke-width="8"/>`;
}

function tableSvg(ctx: Ctx, t: TableItem): string {
  const pub = ctx.pub;
  const out: string[] = [];
  const cols = t.cols;
  let y = 0;
  const outer = t.border ?? { fill: { type: 'solid', color: 'Black' }, width: 0.75 };
  const inner = t.innerBorder ?? { fill: { type: 'solid', color: 'Gray' }, width: 0.5 };
  t.rows.forEach((row, ri) => {
    let x = 0;
    row.cells.forEach((cell, ci) => {
      const cw = cols[ci] || 0;
      if (cell.merged) { x += cw; return; }
      const span = cell.colSpan || 1, rspan = cell.rowSpan || 1;
      const w = cols.slice(ci, ci + span).reduce((a, b) => a + b, 0);
      const h = t.rows.slice(ri, ri + rspan).reduce((a, r) => a + r.h, 0);
      const band = t.style?.bandedRows && ri % 2 === 1 ? { type: 'solid', color: t.style.bandColor || 'Light Gray' } as Fill : undefined;
      const header = (t.style?.firstRow && ri === 0) || row.header ? (t.style?.headerFill || { type: 'solid', color: 'Primary' } as Fill) : undefined;
      const fill = cell.fill ?? header ?? band;
      if (fill && fill.type !== 'none') out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fillPaint(ctx, fill, w, h)}"/>`);
      const ins = cell.insets || [4, 3, 4, 3];
      const box: FlowBox = { frame: t.id, col: 0, x: x + ins[0], y: y + ins[1], w: Math.max(1, w - ins[0] - ins[2]), h: Math.max(1, h - ins[1] - ins[3]), page: ctx.pageIndex };
      const paras: Paragraph[] = cell.text.length ? cell.text : [{ style: 'Table Text', runs: [] }];
      const r = layoutStory(paras, layoutOptions(pub, [box], { anchor: cell.anchor || 't', unbounded: true }));
      out.push(`<g clip-path="inset(0)">${linesSvg(ctx, r.lines)}</g>`);
      x += cw;
    });
    y += row.h;
  });
  const totalW = cols.reduce((a, b) => a + b, 0), totalH = t.rows.reduce((a, r) => a + r.h, 0);
  // Inner lines
  const inn = strokeAttrs(ctx, inner);
  if (!inn.includes('stroke="none"')) {
    const d: string[] = [];
    let xx = 0; for (let c = 1; c < cols.length; c++) { xx += cols[c - 1]; d.push(`M${n(xx)} 0 V${n(totalH)}`); }
    let yy = 0; for (let r = 1; r < t.rows.length; r++) { yy += t.rows[r - 1].h; d.push(`M0 ${n(yy)} H${n(totalW)}`); }
    if (d.length) out.push(`<path d="${d.join(' ')}" fill="none"${inn}/>`);
  }
  out.push(`<rect width="${n(totalW)}" height="${n(totalH)}" fill="none"${strokeAttrs(ctx, outer)}/>`);
  return out.join('');
}

// ------------------------------------------------------------------------------------------

export function svgElement(markup: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return t.content.firstElementChild as SVGSVGElement;
}

/** The first non-empty line of text on a page (for the Pages pane and navigator). */
export function pageTitle(pub: Pub, page: Page): string {
  for (const e of page.items) {
    if (e.kind !== 'text') continue;
    const s = pub.story(e.story);
    const t = s?.paras.map((p) => p.runs.map((r) => r.text).join('')).find((x) => x.trim());
    if (t) return t.trim().slice(0, 60);
  }
  return '';
}

export type { Ctx as RenderCtx };
export { cssFont, resolvePara, resolveRun };
