/**
 * QuarkXPress 3.1–4.1 layout import (.qxp, .qxd, .qxt; Mac and Windows).
 *
 * Reads the page geometry, the boxes (text, picture, empty), lines, text paths (4.x), groups, the
 * text with its character and paragraph formatting, the color table and the text chains, and
 * builds a publication with the same pages. What the format does not carry in the file (pictures are
 * linked, not embedded; master items are stored as copies on each page) is reported in the warnings.
 * When the header names a version this reader does not know (5 and later) or the chains are damaged,
 * the import falls back to the text-and-pictures harvest of src/io/legacyLayout.ts.
 *
 * The format description was worked out from the Document Liberation Project's published reader
 * (used as a reference for the byte layout only); this code is original.
 */
import { Pub, newId } from '../../model/pub';
import type { Page, Item, TextFrame, PictureFrame, ShapeItem, LineItem, GroupItem, PathTextItem, Fill, Line, Dash, Paragraph } from '../../model/types';
import { harvestLayout, picturesFrom, type LegacyImport } from '../legacyLayout';
import { mediaFromBytes } from '../images';
import { Reader, getChain } from './blocks';
import { readQxpHeader, unwrapMacBinary, type QxpHeader } from './header';
import { QxpTables, type LineStyle, type Rect, type Pt } from './records';
import { readPages, type QxpObject, type QxpPage, type Frame, type Gradient } from './objects';
import { readStory, storyParagraphs, textRange, textWithout, type QxpText } from './text';

export { unwrapMacBinary, isMacBinaryQxp, readQxpHeader } from './header';

/** Imports a QuarkXPress document; falls back to the text harvest when the layout cannot be read. */
export async function importQxp(data: Uint8Array, name: string): Promise<LegacyImport> {
  const bytes = unwrapMacBinary(data);
  let header: QxpHeader;
  try { header = readQxpHeader(bytes); } catch (e) { return harvestLayout(bytes, name, 'qxp', (e as Error).message); }
  if (header.type === 'BK' || header.type === 'LB') return harvestLayout(bytes, name, 'qxp', `${header.label} ${header.type === 'BK' ? 'book' : 'library'} files hold no pages of their own.`);
  if (header.pagesCount === 0) return harvestLayout(bytes, name, 'qxp', `${header.label}: the file holds no document pages (a library or an empty document).`);
  try {
    return await readLayout(bytes, name, header);
  } catch (e) {
    return harvestLayout(bytes, name, 'qxp', `${header.label}: the layout could not be read (${(e as Error).message}).`);
  }
}

interface TextRef { frame: TextFrame | PathTextItem; link: { linkId: number; offsetIntoText: number; contentIndex: number }; text?: QxpText }

interface Ctx {
  pub: Pub; header: QxpHeader; tables: QxpTables; bytes: Uint8Array; warnings: string[];
  refs: TextRef[]; counts: Record<string, number>; previews: number; missingPictures: number; customText: number;
}

async function readLayout(bytes: Uint8Array, name: string, header: QxpHeader): Promise<LegacyImport> {
  const warnings: string[] = [];
  const tables = new QxpTables(header);
  const doc = new Reader(getChain(bytes, 3, header.bigEndian), header.bigEndian);
  if (doc.length < 64) throw new Error('the document chain is empty');
  tables.readAll(doc);
  warnings.push(...tables.warnings);
  const pages = readPages(doc, header, tables, warnings);
  const docPages = pages.filter((p) => !p.master);
  if (!docPages.length) throw new Error('no document pages were found');
  const first = docPages[0].offsets[0];
  const size = { w: r2(first.right - first.left), h: r2(first.bottom - first.top) };
  if (!(size.w > 10 && size.h > 10 && size.w < 20000 && size.h < 20000)) throw new Error('the page size is not plausible');
  const facing = docPages.some((p) => p.offsets.length === 2);
  const pub = Pub.blank(size, { facing, pages: 0 });
  pub.data.props.title = name.replace(/\.[^.]+$/, '');
  const ctx: Ctx = { pub, header, tables, bytes, warnings, refs: [], counts: {}, previews: 0, missingPictures: 0, customText: 0 };
  const master = pub.data.masters[0];

  for (const qp of docPages) {
    const pagesOf: Page[] = qp.offsets.map(() => ({ id: newId('pg'), master: master.id, items: [] }));
    await placeObjects(ctx, qp, pagesOf.map((p) => p.items), `page ${pub.pages.length + 1}`);
    for (const p of pagesOf) pub.pages.push(p);
  }
  // Master pages with objects become masters of their own. QuarkXPress copies master items onto
  // the pages, so the masters are not applied (that would draw the items twice); they are kept
  // for pages that lack their copies.
  const pageCounts = { ...ctx.counts };
  let masterIndex = 0;
  for (const qp of pages.filter((p) => p.master)) {
    masterIndex++;
    if (!qp.objects.length) continue;
    const sides: Item[][] = qp.offsets.map(() => []);
    await placeObjects(ctx, qp, sides, `master page ${masterIndex}`);
    const base = qp.name || `${String.fromCharCode(64 + Math.min(26, masterIndex))}-Master`;
    sides.forEach((items, i) => {
      if (!items.length) return;
      const name = sides.length === 2 ? `${base} (${i === 0 ? 'left' : 'right'})` : base;
      pub.data.masters.push({ id: newId('mst'), name, items, margins: [...master.margins] as [number, number, number, number], columns: master.columns, gutter: master.gutter, side: sides.length === 2 ? (i === 0 ? 'left' : 'right') : 'single' });
      ctx.counts.masters = (ctx.counts.masters || 0) + 1;
    });
  }
  resolveStories(ctx);
  addSwatches(ctx);
  pub.pruneStories();
  summarize(ctx, name, pageCounts);
  return { pub, warnings, textOnly: false };
}

/** Converts a page's objects and distributes them over the pages of its spread (groups own their members). */
async function placeObjects(ctx: Ctx, qp: QxpPage, sides: Item[][], where: string): Promise<void> {
  const items: (Item | null)[] = [];
  const sideOf: number[] = [];
  for (const o of qp.objects) {
    const side = qp.offsets.length === 2 && o.bbox.left >= qp.offsets[1].left ? 1 : 0;
    sideOf.push(side);
    let item: Item | null = null;
    try { item = await toItem(ctx, o, qp.offsets[side]); } catch (e) { ctx.warnings.push(`An object on ${where} was skipped (${(e as Error).message}).`); }
    items.push(item);
  }
  // Objects are stored top-first.
  const taken = new Set<number>();
  qp.objects.forEach((o: QxpObject, i: number) => {
    const g = items[i];
    if (!o.members || !g || g.kind !== 'group') return;
    const kids: Item[] = [];
    for (const m of o.members) { const k = items[m]; if (k && !taken.has(m)) { taken.add(m); kids.push(k); } }
    g.children = kids.reverse();
    if (!kids.length) items[i] = null;
  });
  for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (it && !taken.has(i)) sides[sideOf[i]].push(it); }
}

// ------------------------------------------------------------------------------------------
// Objects to items

const r2 = (v: number) => Math.round(v * 100) / 100;

async function toItem(ctx: Ctx, o: QxpObject, off: Rect): Promise<Item | null> {
  const x = r2(o.bbox.left - off.left), y = r2(o.bbox.top - off.top);
  const w = r2(Math.max(0, o.bbox.right - o.bbox.left)), h = r2(Math.max(0, o.bbox.bottom - o.bbox.top));
  const base = { x, y, w, h, ...(o.rotation ? { rot: r2(-o.rotation) } : {}), ...(o.hflip ? { flipH: true } : {}), ...(o.vflip ? { flipV: true } : {}) };
  const fill = fillOf(o.fill);
  const line = lineOf(o.frame);
  const wrap = o.runaround ? { wrap: { mode: 'square' as const, offset: 0 } } : {};
  const count = (k: string) => { ctx.counts[k] = (ctx.counts[k] || 0) + 1; };
  const isLine = o.shape === 'line' || o.shape === 'orthoLine' || o.shape === 'bezierLine';

  if (o.content === 'objects') {
    count('groups');
    const g: GroupItem = { id: newId('grp'), kind: 'group', name: 'Group', ...base, children: [] };
    return g;
  }
  if (o.content === 'none') {
    if (isLine && o.shape !== 'bezierLine') {
      count('lines');
      const l: LineItem = { id: newId('ln'), kind: 'line', name: 'Line', ...base, ...wrap, line: line || { width: 1, fill: { type: 'solid', color: '#000000' } } };
      return l;
    }
    count(o.shape === 'bezierLine' ? 'lines' : 'shapes');
    const s: ShapeItem = { id: newId('shp'), kind: 'shape', name: o.shape === 'bezierLine' ? 'Line' : 'Box', ...base, ...wrap, ...geomOf(o, w, h), ...(fill ? { fill } : { fill: { type: 'none' } }), ...(line ? { line } : {}) };
    return s;
  }
  if (o.content === 'picture') {
    count('pictures');
    const p: PictureFrame = { id: newId('pic'), kind: 'picture', name: 'Picture Box', ...base, ...wrap, ...(fill ? { fill } : {}), ...(line ? { line } : {}), fit: 'fill' };
    const g = geomOf(o, w, h);
    if (g.geom !== 'rect' && g.geom !== 'custom') p.geom = g.geom;
    const data = o.picture?.data;
    if (data && data.length > 16) {
      const media = await previewMedia(data);
      if (media) { p.media = ctx.pub.addMedia(media); ctx.previews++; }
    }
    if (!p.media) {
      ctx.missingPictures++;
      const file = o.picture?.file?.split(/[\\/:]/).pop();
      p.name = file ? `Picture Box (${file} not in file)` : 'Picture Box (picture not in file)';
    }
    return p;
  }
  // text
  if (isLine) {
    count('textPaths');
    const path = isLine && o.shape !== 'bezierLine' ? { d: `M0 0 L${w} ${h}`, w: w || 1, h: h || 1 } : customPath(o, w, h) || { d: `M0 0 L${w} 0`, w: w || 1, h: 1 };
    const t: PathTextItem = { id: newId('pt'), kind: 'pathText', name: 'Text Path', ...base, ...wrap, path, text: [{ style: 'Body', runs: [] }], align: 'start', offset: 0, baseline: 0, ...(line ? { line, showPath: true } : {}) };
    if (o.link) ctx.refs.push({ frame: t, link: o.link, text: ownText(ctx, o) });
    return t;
  }
  count('textBoxes');
  const ts = o.text;
  const f: TextFrame = {
    id: newId('tf'), kind: 'text', name: 'Text Box', story: '', ...base, ...wrap, ...(fill ? { fill } : {}), ...(line ? { line } : {}),
    columns: ts?.columns && ts.columns > 1 ? ts.columns : undefined, gutter: ts && ts.columns > 1 ? r2(ts.gutter) : undefined,
    insets: ts ? [r2(ts.insets.top), r2(ts.insets.right), r2(ts.insets.bottom), r2(ts.insets.left)] : [0, 0, 0, 0],
    anchor: ts && ts.vAlign !== 't' ? ts.vAlign : undefined,
  };
  for (const k of ['columns', 'gutter', 'anchor'] as const) if (f[k] === undefined) delete f[k];
  const g = geomOf(o, w, h);
  if (g.geom === 'custom') ctx.customText++;
  else if (g.geom !== 'rect') f.geom = g.geom;
  if (o.link) ctx.refs.push({ frame: f, link: o.link, text: ownText(ctx, o) });
  return f;
}

/** The story of a text object that starts a chain (the others share it). */
function ownText(ctx: Ctx, o: QxpObject): QxpText | undefined {
  const l = o.link!;
  // Blocks 1–3 hold the header and the document chain, so an index below 4 never names a story.
  if (l.contentIndex < 4 || l.offsetIntoText !== 0) return undefined;
  try { return readStory(ctx.bytes, l.contentIndex, ctx.header, ctx.tables); } catch (e) {
    ctx.warnings.push(`The text of a box could not be read (${(e as Error).message}).`);
    return undefined;
  }
}

function fillOf(f: string | Gradient | undefined): Fill | undefined {
  if (!f) return undefined;
  if (typeof f === 'string') return { type: 'solid', color: f };
  const radial = f.kind === 'circular' || f.kind === 'fullCircular' || f.kind === 'rectangular' || f.kind === 'diamond';
  return { type: 'gradient', stops: [{ pos: 0, color: f.color1 }, { pos: 1, color: f.color2 }], angle: r2(f.angle), path: radial ? 'radial' : 'linear' };
}

function dashOf(s: LineStyle | undefined): Dash {
  if (!s || s.segments.length < 2) return 'solid';
  const on = s.proportional ? s.segments[0] * s.patternLength : s.segments[0];
  if (s.segments.length >= 4) return 'dashDot';
  if (on <= 1.5 || s.segments[0] <= 0.3) return 'dot';
  if (on >= 8) return 'longDash';
  return 'dash';
}

function lineOf(f: Frame | undefined): Line | undefined {
  if (!f || !(f.width > 0)) return undefined;
  const l: Line = { width: r2(f.width), fill: { type: 'solid', color: f.color } };
  const d = dashOf(f.dash);
  if (d !== 'solid') l.dash = d;
  if (f.dash?.cap === 'round') l.cap = 'round';
  if (f.dash?.join && f.dash.join !== 'miter') l.join = f.dash.join;
  switch (f.arrow) {
    case 1: l.head = 'triangle'; break;
    case 2: l.tail = 'triangle'; break;
    case 3: l.head = 'triangle'; l.tail = 'arrow'; break;
    case 4: l.head = 'arrow'; l.tail = 'triangle'; break;
    case 5: l.head = 'triangle'; l.tail = 'triangle'; break;
  }
  return l;
}

function geomOf(o: QxpObject, w: number, h: number): { geom: string; adj?: Record<string, number>; path?: { d: string; w: number; h: number }[] } {
  const ss = Math.max(1, Math.min(w, h));
  const adj = Math.max(0, Math.min(50000, Math.round((o.cornerRadius / ss) * 100000)));
  switch (o.shape) {
    case 'oval': return { geom: 'ellipse' };
    case 'roundRect': return { geom: 'roundRect', adj: { adj } };
    case 'concaveRect': return { geom: 'plaque', adj: { adj } };
    case 'beveledRect': return { geom: 'octagon', adj: { adj } };
    case 'bezier': case 'polygon': case 'bezierLine': {
      const p = customPath(o, w, h);
      return p ? { geom: 'custom', path: [p] } : { geom: 'rect' };
    }
    default: return { geom: 'rect' };
  }
}

/** A path in the object's local box from its polygon corners (3.x) or bezier components (4.x). */
function customPath(o: QxpObject, w: number, h: number): { d: string; w: number; h: number } | null {
  const lx = (p: Pt) => r2(p.x - o.bbox.left), ly = (p: Pt) => r2(p.y - o.bbox.top);
  if (o.polygon && o.polygon.length >= 2) {
    const d = o.polygon.map((p, i) => `${i ? 'L' : 'M'}${lx(p)} ${ly(p)}`).join(' ') + ' Z';
    return { d, w: w || 1, h: h || 1 };
  }
  if (!o.curves?.length) return null;
  const parts: string[] = [];
  const closedShape = o.shape === 'bezier';
  for (const c of o.curves) {
    const n = Math.floor(c.points.length / 3);
    if (n < 2) continue;
    const node = (k: number) => ({ cin: c.points[k * 3], a: c.points[k * 3 + 1], cout: c.points[k * 3 + 2] });
    let d = `M${lx(node(0).a)} ${ly(node(0).a)}`;
    for (let k = 1; k < n; k++) {
      const prev = node(k - 1), cur = node(k);
      d += ` C${lx(prev.cout)} ${ly(prev.cout)} ${lx(cur.cin)} ${ly(cur.cin)} ${lx(cur.a)} ${ly(cur.a)}`;
    }
    const first = node(0).a, last = node(n - 1).a;
    const same = Math.abs(first.x - last.x) < 0.01 && Math.abs(first.y - last.y) < 0.01;
    if (closedShape) {
      if (!same) { const prev = node(n - 1), cur = node(0); d += ` C${lx(prev.cout)} ${ly(prev.cout)} ${lx(cur.cin)} ${ly(cur.cin)} ${lx(cur.a)} ${ly(cur.a)}`; }
      d += ' Z';
    }
    parts.push(d);
  }
  return parts.length ? { d: parts.join(' '), w: w || 1, h: h || 1 } : null;
}

/** A picture box's embedded preview (4.x stores one for some pictures), if it decodes. */
async function previewMedia(data: Uint8Array) {
  try { return await mediaFromBytes(data, 'picture'); } catch { /* not a picture by itself */ }
  try {
    const pics = await picturesFrom([data]);
    if (pics.length) return await mediaFromBytes(pics[0].data, 'picture');
  } catch { /* nothing usable */ }
  return null;
}

// ------------------------------------------------------------------------------------------
// Stories and chains

function resolveStories(ctx: Ctx): void {
  const pub = ctx.pub;
  const groups = new Map<number, TextRef[]>();
  const singles: TextRef[] = [];
  for (const ref of ctx.refs) {
    if (ref.link.linkId === 0) singles.push(ref);
    else { const g = groups.get(ref.link.linkId) || []; g.push(ref); groups.set(ref.link.linkId, g); }
  }
  const assign = (refs: TextRef[]) => {
    refs.sort((a, b) => a.link.offsetIntoText - b.link.offsetIntoText);
    const owner = refs.find((r) => r.text && r.link.offsetIntoText === 0) || refs.find((r) => r.text);
    const frames = refs.filter((r): r is TextRef & { frame: TextFrame } => r.frame.kind === 'text');
    const paths = refs.filter((r): r is TextRef & { frame: PathTextItem } => r.frame.kind === 'pathText');
    const empty = (): Paragraph[] => [{ style: 'Body', runs: [] }];
    // Text paths hold their own text in QuillPress: each one in a chain takes the characters between
    // its offset and the next object's, and the frames of the chain flow the rest.
    const ranges: [number, number][] = [];
    if (owner?.text) {
      refs.forEach((r, i) => {
        if (r.frame.kind !== 'pathText') return;
        const from = r.link.offsetIntoText, to = i + 1 < refs.length ? refs[i + 1].link.offsetIntoText : owner.text!.text.length;
        if (to > from) { ranges.push([from, to]); (r.frame as PathTextItem).text = storyParagraphs(textRange(owner.text!, from, to)); }
      });
    }
    for (const p of paths) if (!p.frame.text?.length || !ranges.length) p.frame.text = empty();
    if (frames.length) {
      const story = pub.newStory(owner?.text ? storyParagraphs(ranges.length ? textWithout(owner.text, ranges) : owner.text) : empty());
      frames.forEach((r, i) => {
        r.frame.story = story.id;
        if (i > 0) r.frame.prev = frames[i - 1].frame.id;
        if (i < frames.length - 1) r.frame.next = frames[i + 1].frame.id;
      });
      if (frames.length > 1) ctx.counts.chains = (ctx.counts.chains || 0) + 1;
    }
  };
  for (const s of singles) assign([s]);
  for (const g of groups.values()) assign(g);
}

function addSwatches(ctx: Ctx): void {
  const sw = ctx.pub.data.swatches;
  for (const [id, name] of ctx.tables.colorNames) {
    const color = ctx.tables.color(id);
    if (!name || sw.some((s) => s.name === name || s.color.toLowerCase() === color)) continue;
    sw.push({ name, color });
  }
}

function summarize(ctx: Ctx, name: string, pageCounts: Record<string, number>): void {
  const c: Record<string, number | undefined> = { ...pageCounts, chains: ctx.counts.chains, masters: ctx.counts.masters };
  const parts: string[] = [];
  const add = (n: number | undefined, one: string, many: string) => { if (n) parts.push(`${n} ${n === 1 ? one : many}`); };
  add(c.textBoxes, 'text box', 'text boxes'); add(c.chains, 'text chain', 'text chains'); add(c.pictures, 'picture box', 'picture boxes');
  add(c.lines, 'line', 'lines'); add(c.shapes, 'box', 'boxes'); add(c.textPaths, 'text path', 'text paths'); add(c.groups, 'group', 'groups');
  const pages = ctx.pub.pages.length;
  const masters = c.masters ? ` ${c.masters} master page${c.masters === 1 ? '' : 's'} with objects ${c.masters === 1 ? 'was' : 'were'} imported as masters but not applied, because QuarkXPress keeps copies of master items on the pages; apply one from the Pages pane if a page lacks them.` : '';
  ctx.warnings.unshift(`${ctx.header.label} document "${name}": ${pages} page${pages === 1 ? '' : 's'} read with ${parts.length ? parts.join(', ') : 'no objects'}.${masters}`);
  if (ctx.missingPictures) ctx.warnings.push(`${ctx.missingPictures} picture box${ctx.missingPictures === 1 ? ' is' : 'es are'} empty: QuarkXPress links pictures instead of embedding them${ctx.previews ? ` (${ctx.previews} had a usable preview in the file)` : ''}. Place the original picture files again.`);
  if (ctx.customText) ctx.warnings.push(`${ctx.customText} text box${ctx.customText === 1 ? ' has' : 'es have'} a bezier or polygon outline; QuillPress sets their text in the rectangle.`);
}
