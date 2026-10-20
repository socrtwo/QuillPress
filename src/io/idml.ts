/**
 * InDesign Markup Language (.idml): Adobe's documented interchange package, a ZIP of XML files
 * (designmap.xml, Resources/*.xml, MasterSpreads/*.xml, Spreads/*.xml, Stories/*.xml). Imported:
 * document size, facing pages and bleed; layers; master spreads and their items; spreads with pages,
 * margins and columns; text frames with their story chains, columns, insets, vertical alignment and
 * text wrap; rectangles, ovals, polygons, lines and groups with fills, strokes, opacity, rotation;
 * picture frames (embedded pictures, or the linked file's name when the picture lives outside the
 * package, as IDML normally does); paragraph, character and object styles; colors, tints and
 * gradients; sections and text variables; stories with style ranges, forced line breaks, tables (as
 * tab-separated rows) and footnotes. Everything is in points, as in QuillPress.
 */
import JSZip from 'jszip';
import { Pub, newId } from '../model/pub';
import type { Fill, Item, Line, Master, Page, PictureFrame, TextFrame, Section, Dash } from '../model/types';
import { parseXml, kids, kid } from './xml';
import { readColors, readStyles, readStory, props, type ColorTable, type StyleTable } from './idmlText';

export interface IdmlImport { pub: Pub; warnings: string[] }

interface Matrix { a: number; b: number; c: number; d: number; tx: number; ty: number }
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const matrixOf = (s: string | null | undefined): Matrix => {
  const v = (s || '').trim().split(/\s+/).map(parseFloat);
  return v.length === 6 && v.every(Number.isFinite) ? { a: v[0], b: v[1], c: v[2], d: v[3], tx: v[4], ty: v[5] } : { ...IDENTITY };
};
const apply = (m: Matrix, x: number, y: number) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty });
/** outer ∘ inner: apply inner first. */
const compose = (outer: Matrix, inner: Matrix): Matrix => ({
  a: outer.a * inner.a + outer.c * inner.b, b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d, d: outer.b * inner.c + outer.d * inner.d,
  tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx, ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
});
const num = (v: any, def = 0): number => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : def; };
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Pt { x: number; y: number; l: { x: number; y: number }; r: { x: number; y: number } }
interface Geometry { pts: Pt[]; open: boolean; bounds: { x: number; y: number; w: number; h: number } }

function geometryOf(el: Element): Geometry | null {
  const p = kid(el, 'Properties');
  const pg = p && kid(p, 'PathGeometry');
  const path = pg && kid(pg, 'GeometryPathType');
  const arr = path && kid(path, 'PathPointArray');
  if (!arr) return null;
  const pts: Pt[] = [];
  for (const pp of kids(arr)) {
    const xy = (s: string | null) => { const v = (s || '').trim().split(/\s+/).map(parseFloat); return { x: num(v[0]), y: num(v[1]) }; };
    const a = xy(pp.getAttribute('Anchor'));
    pts.push({ x: a.x, y: a.y, l: pp.getAttribute('LeftDirection') ? xy(pp.getAttribute('LeftDirection')) : a, r: pp.getAttribute('RightDirection') ? xy(pp.getAttribute('RightDirection')) : a });
  }
  if (!pts.length) return null;
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { pts, open: path!.getAttribute('PathOpen') === 'true', bounds: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
}

/** Box of a geometry under a transform: an axis-aligned box plus a rotation when the transform rotates. */
function boxOf(g: Geometry, m: Matrix): { x: number; y: number; w: number; h: number; rot?: number } {
  const angle = Math.atan2(m.b, m.a);
  const sx = Math.hypot(m.a, m.b) || 1, sy = Math.hypot(m.c, m.d) || 1;
  if (Math.abs(angle) < 1e-4) {
    const tl = apply(m, g.bounds.x, g.bounds.y), br = apply(m, g.bounds.x + g.bounds.w, g.bounds.y + g.bounds.h);
    return { x: Math.min(tl.x, br.x), y: Math.min(tl.y, br.y), w: Math.abs(br.x - tl.x), h: Math.abs(br.y - tl.y) };
  }
  const c = apply(m, g.bounds.x + g.bounds.w / 2, g.bounds.y + g.bounds.h / 2);
  const w = g.bounds.w * sx, h = g.bounds.h * sy;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h, rot: ((angle * 180) / Math.PI + 360) % 360 };
}

/** SVG path of a geometry in its own box. */
function svgPath(g: Geometry): string {
  const b = g.bounds;
  const f = (v: number) => r2(v);
  const parts: string[] = [];
  g.pts.forEach((p, i) => {
    if (i === 0) { parts.push(`M${f(p.x - b.x)} ${f(p.y - b.y)}`); return; }
    const q = g.pts[i - 1];
    const curved = q.r.x !== q.x || q.r.y !== q.y || p.l.x !== p.x || p.l.y !== p.y;
    parts.push(curved ? `C${f(q.r.x - b.x)} ${f(q.r.y - b.y)} ${f(p.l.x - b.x)} ${f(p.l.y - b.y)} ${f(p.x - b.x)} ${f(p.y - b.y)}` : `L${f(p.x - b.x)} ${f(p.y - b.y)}`);
  });
  if (!g.open && g.pts.length > 2) {
    const q = g.pts[g.pts.length - 1], p = g.pts[0];
    const curved = q.r.x !== q.x || q.r.y !== q.y || p.l.x !== p.x || p.l.y !== p.y;
    parts.push(curved ? `C${f(q.r.x - b.x)} ${f(q.r.y - b.y)} ${f(p.l.x - b.x)} ${f(p.l.y - b.y)} ${f(p.x - b.x)} ${f(p.y - b.y)}` : '', 'Z');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const DASH: Record<string, Dash> = { Dashed: 'dash', Dotted: 'dot', 'Dash Dot': 'dashDot', 'Dashed (3 and 2)': 'dash', 'Dashed (4 and 4)': 'longDash' };

interface Env {
  pub: Pub; zip: JSZip; colors: ColorTable; styles: StyleTable; warnings: string[];
  layers: Map<string, string>; stories: Map<string, string>; storyEls: Map<string, Element>;
  frames: Map<string, TextFrame>; links: { frame: TextFrame; next?: string; prev?: string }[];
  missing: string[]; pictures: number; unsupported: Map<string, number>; anchored: { story: string; el: Element }[];
}

interface Parsed { item: Item; cx: number; cy: number; children?: Parsed[] }

async function pictureFrame(env: Env, el: Element, m: Matrix, g: Geometry): Promise<PictureFrame | null> {
  const img = kids(el).find((k) => ['Image', 'PDF', 'EPS', 'ImportedPage', 'PICT', 'WMF', 'Graphic'].includes(k.localName));
  if (!img) return null;
  const box = boxOf(g, m);
  const pf: PictureFrame = { id: newId('pic'), kind: 'picture', x: r2(box.x), y: r2(box.y), w: r2(box.w), h: r2(box.h), ...(box.rot ? { rot: r2(box.rot) } : {}), fit: 'fill' };
  const link = kid(img, 'Link');
  const uri = link?.getAttribute('LinkResourceURI') || '';
  let name = '';
  if (uri) { try { name = decodeURIComponent(uri.split(/[\\/]/).pop() || ''); } catch { name = uri.split(/[\\/]/).pop() || ''; } }
  const p = kid(img, 'Properties');
  const contents = p && kid(p, 'Contents');
  env.pictures++;
  if (contents && contents.textContent && contents.textContent.trim().length > 40) {
    try {
      const bytes = Uint8Array.from(atob(contents.textContent.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      const { mediaFromBytes } = await import('./images');
      const mm = await mediaFromBytes(bytes, name || 'picture');
      pf.media = env.pub.addMedia(mm);
    } catch { if (name) env.missing.push(name); }
  } else if (name) { pf.src = name; env.missing.push(name); }
  else if (img.localName !== 'Image') env.missing.push(`${img.localName} graphic`);
  if (name) pf.src = name;
  return pf;
}

async function readItem(env: Env, el: Element, parent: Matrix): Promise<Parsed | null> {
  const kind = el.localName;
  const m = compose(parent, matrixOf(el.getAttribute('ItemTransform')));
  const a = props(el);
  const common = (item: Item) => {
    if (a.Visible === 'false') item.hidden = true;
    if (a.Locked === 'true') item.locked = true;
    if (typeof a.Name === 'string' && a.Name) item.name = a.Name;
    const layer = env.layers.get(String(a.ItemLayer || ''));
    if (layer && layer !== 'default') item.layer = layer;
    const ts = kid(el, 'TransparencySetting');
    const bs = ts && kid(ts, 'BlendingSetting');
    const op = bs ? num(bs.getAttribute('Opacity'), 100) : 100;
    if (op < 100) item.alpha = op / 100;
    const os = env.styles.object(a.AppliedObjectStyle);
    if (os) item.ostyle = os;
    const wrapEl = kid(el, 'TextWrapPreference');
    const mode = wrapEl?.getAttribute('TextWrapMode');
    if (mode && mode !== 'None') {
      const off = wrapEl && kid(wrapEl, 'Properties') && kid(kid(wrapEl, 'Properties')!, 'TextWrapOffset');
      const o = off ? Math.max(num(off.getAttribute('Top')), num(off.getAttribute('Left')), num(off.getAttribute('Bottom')), num(off.getAttribute('Right'))) : 6;
      item.wrap = { mode: mode === 'Contour' ? 'tight' : mode === 'BoundingBoxTextWrap' ? 'square' : 'topBottom', offset: o };
    }
  };
  const fillLine = (): { fill?: Fill; line?: Line } => {
    const out: { fill?: Fill; line?: Line } = {};
    const fill = env.colors.fill(a.FillColor, a.FillTint != null ? num(a.FillTint, 100) : undefined);
    if (fill) out.fill = fill;
    const sw = num(a.StrokeWeight, 0);
    const sc = env.colors.of(a.StrokeColor);
    if (sc && sw > 0) {
      const line: Line = { fill: { type: 'solid', color: sc }, width: sw };
      const st = String(a.StrokeType || '').replace(/^StrokeStyle\/\$ID\//, '').replace(/^StrokeStyle\//, '');
      if (DASH[st]) line.dash = DASH[st];
      if (/Dash|Dot/i.test(st) && !line.dash) line.dash = 'dash';
      out.line = line;
    }
    return out;
  };
  if (kind === 'Group') {
    const children: Parsed[] = [];
    for (const c of kids(el)) { const r = await readItem(env, c, m); if (r) children.push(r); }
    if (!children.length) return null;
    const xs = children.map((c) => c.item.x), ys = children.map((c) => c.item.y);
    const x2 = Math.max(...children.map((c) => c.item.x + c.item.w)), y2 = Math.max(...children.map((c) => c.item.y + c.item.h));
    const x = Math.min(...xs), y = Math.min(...ys);
    const item: Item = { id: newId('grp'), kind: 'group', x: r2(x), y: r2(y), w: r2(x2 - x), h: r2(y2 - y), children: children.map((c) => c.item) };
    common(item);
    return { item, cx: (x + x2) / 2, cy: (y + y2) / 2, children };
  }
  const g = geometryOf(el);
  if (!g) { if (!['Properties', 'TextFramePreference', 'TextWrapPreference', 'Page', 'FlattenerPreference', 'TransparencySetting', 'InCopyExportOption', 'ObjectExportOption', 'FrameFittingOption', 'AnchoredObjectSetting', 'TextFramePreference'].includes(kind)) env.unsupported.set(kind, (env.unsupported.get(kind) || 0) + 1); return null; }
  const box = boxOf(g, m);
  const base = { x: r2(box.x), y: r2(box.y), w: r2(Math.max(0.5, box.w)), h: r2(Math.max(0.5, box.h)), ...(box.rot ? { rot: r2(box.rot) } : {}) };
  const center = { cx: box.x + box.w / 2, cy: box.y + box.h / 2 };
  let item: Item | null = null;
  if (kind === 'TextFrame') {
    const storyRef = String(a.ParentStory || '');
    let storyId = env.stories.get(storyRef);
    if (!storyId) {
      const se = env.storyEls.get(storyRef);
      if (se) {
        const r = readStory(env.pub, se, env.colors, env.styles);
        storyId = r.story.id;
        env.stories.set(storyRef, storyId);
        for (const an of r.anchored) env.anchored.push({ story: storyId, el: an });
        if (r.notes) env.unsupported.set('Note', (env.unsupported.get('Note') || 0) + r.notes);
        if (r.tables) env.unsupported.set('Table', (env.unsupported.get('Table') || 0) + r.tables);
      } else { storyId = env.pub.newStory().id; env.stories.set(storyRef, storyId); }
    }
    const pref = kid(el, 'TextFramePreference');
    const pa = pref ? props(pref) : {};
    const insetRaw = pa.InsetSpacing;
    const ins: [number, number, number, number] = Array.isArray(insetRaw) && insetRaw.length >= 4
      ? [num(insetRaw[1]), num(insetRaw[0]), num(insetRaw[3]), num(insetRaw[2])]
      : [num(insetRaw), num(insetRaw), num(insetRaw), num(insetRaw)];
    const f: TextFrame = { id: newId('tf'), kind: 'text', story: storyId, ...base, columns: Math.max(1, num(pa.TextColumnCount, 1)), gutter: num(pa.TextColumnGutter, 12), insets: ins, ...fillLine() };
    const vj = String(pa.VerticalJustification || '');
    if (vj === 'CenterAlign') f.anchor = 'ctr'; else if (vj === 'BottomAlign') f.anchor = 'b'; else if (vj === 'JustifyAlign') f.anchor = 'just';
    if (String(pa.AutoSizingType || '').startsWith('Height')) f.autosize = 'height';
    if (pa.IgnoreWrap === 'true') f.ignoreWrap = true;
    const self = String(a.Self || '');
    if (self) env.frames.set(self, f);
    env.links.push({ frame: f, next: a.NextTextFrame && a.NextTextFrame !== 'n' ? String(a.NextTextFrame) : undefined, prev: a.PreviousTextFrame && a.PreviousTextFrame !== 'n' ? String(a.PreviousTextFrame) : undefined });
    item = f;
  } else if (kind === 'GraphicLine') {
    const p0 = apply(m, g.pts[0].x, g.pts[0].y), p1 = apply(m, g.pts[g.pts.length - 1].x, g.pts[g.pts.length - 1].y);
    const fl = fillLine();
    item = { id: newId('ln'), kind: 'line', x: r2(p0.x), y: r2(p0.y), w: r2(p1.x - p0.x), h: r2(p1.y - p0.y), line: fl.line || { fill: { type: 'solid', color: 'Black' }, width: 1 } };
    center.cx = (p0.x + p1.x) / 2; center.cy = (p0.y + p1.y) / 2;
  } else if (kind === 'Rectangle' || kind === 'Oval' || kind === 'Polygon') {
    const pic = await pictureFrame(env, el, m, g);
    if (pic) { const fl = fillLine(); if (fl.line) pic.line = fl.line; if (kind === 'Oval') pic.geom = 'ellipse'; item = pic; }
    else {
      const fl = fillLine();
      const geom = kind === 'Oval' ? 'ellipse' : kind === 'Polygon' ? 'custom' : 'rect';
      item = { id: newId('sh'), kind: 'shape', geom, ...base, fill: fl.fill || { type: 'none' }, ...(fl.line ? { line: fl.line } : {}), ...(geom === 'custom' ? { path: [{ d: svgPath(g), w: r2(g.bounds.w), h: r2(g.bounds.h) }] } : {}) };
    }
  } else {
    env.unsupported.set(kind, (env.unsupported.get(kind) || 0) + 1);
    return null;
  }
  common(item);
  return { item, ...center };
}

function shift(p: Parsed, dx: number, dy: number): void {
  p.item.x = r2(p.item.x + dx); p.item.y = r2(p.item.y + dy);
  for (const c of p.children || []) shift(c, dx, dy);
}

interface PageSlot { el: Element; origin: { x: number; y: number }; rect: { x: number; y: number; w: number; h: number }; target: { items: Item[] } }

function pageSlots(spread: Element, targets: { items: Item[] }[], size: { w: number; h: number }): PageSlot[] {
  const pages = kids(spread).filter((k) => k.localName === 'Page');
  return pages.map((p, i) => {
    const m = matrixOf(p.getAttribute('ItemTransform'));
    const gb = (p.getAttribute('GeometricBounds') || `0 0 ${size.h} ${size.w}`).trim().split(/\s+/).map(parseFloat);
    const top = num(gb[0]), left = num(gb[1]), bottom = num(gb[2], size.h), right = num(gb[3], size.w);
    const o = apply(m, left, top);
    return { el: p, origin: o, rect: { x: o.x, y: o.y, w: right - left, h: bottom - top }, target: targets[i] };
  });
}

async function placeSpreadItems(env: Env, spread: Element, slots: PageSlot[]): Promise<void> {
  if (!slots.length) return;
  for (const c of kids(spread)) {
    if (c.localName === 'Page' || c.localName === 'Properties' || c.localName === 'FlattenerPreference') continue;
    const r = await readItem(env, c, IDENTITY);
    if (!r) continue;
    let slot = slots.find((s) => r.cx >= s.rect.x && r.cx <= s.rect.x + s.rect.w && r.cy >= s.rect.y && r.cy <= s.rect.y + s.rect.h);
    if (!slot) slot = slots.map((s) => ({ s, d: Math.hypot(r.cx - (s.rect.x + s.rect.w / 2), r.cy - (s.rect.y + s.rect.h / 2)) })).sort((p, q) => p.d - q.d)[0].s;
    shift(r, -slot.origin.x, -slot.origin.y);
    slot.target.items.push(r.item);
  }
}

function marginsOf(pageEl: Element): { margins?: [number, number, number, number]; columns?: number; gutter?: number } {
  const mp = kid(pageEl, 'MarginPreference');
  if (!mp) return {};
  const a = props(mp);
  return { margins: [num(a.Top, 36), num(a.Right, 36), num(a.Bottom, 36), num(a.Left, 36)], columns: Math.max(1, num(a.ColumnCount, 1)), gutter: num(a.ColumnGutter, 12) };
}

/** The element inside an idPkg:* wrapper file (or the root itself when a file has no wrapper). */
const inner = (d: Document, name: string): Element | null => kid(d.documentElement, name) || (d.documentElement.localName === name ? d.documentElement : null);

export async function importIdml(data: Uint8Array): Promise<IdmlImport> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(data);
  const xml = async (name: string): Promise<Document | null> => { const f = zip.file(name) || zip.file(name.replace(/^\//, '')); if (!f) return null; return parseXml(await f.async('string')); };
  const designmap = await xml('designmap.xml');
  if (!designmap) throw new Error('The IDML package has no designmap.xml.');
  const doc = designmap.documentElement;
  const prefsDoc = await xml('Resources/Preferences.xml');
  const dp = prefsDoc && kid(prefsDoc.documentElement, 'DocumentPreference');
  const dpa = dp ? props(dp) : {};
  const size = { w: num(dpa.PageWidth, 612), h: num(dpa.PageHeight, 792) };
  const pub = Pub.blank(size, { facing: dpa.FacingPages === 'true' });
  const P = pub.data;
  P.bleed = Math.max(num(dpa.DocumentBleedTopOffset), num(dpa.DocumentBleedBottomOffset), num(dpa.DocumentBleedInsideOrLeftOffset), num(dpa.DocumentBleedOutsideOrRightOffset));
  const vp = prefsDoc && kid(prefsDoc.documentElement, 'ViewPreference');
  const unit = vp?.getAttribute('HorizontalMeasurementUnits') || '';
  P.unit = unit === 'Inches' || unit === 'InchesDecimal' ? 'in' : unit === 'Millimeters' ? 'mm' : unit === 'Centimeters' ? 'cm' : unit === 'Picas' ? 'pica' : unit === 'Pixels' ? 'px' : unit === 'Points' ? 'pt' : P.unit;
  // Metadata
  const meta = zip.file('META-INF/metadata.xml');
  if (meta) {
    const t = await meta.async('string');
    const pick = (tag: string) => { const m = new RegExp(`<${tag}[^>]*>\\s*(?:<rdf:(?:Alt|Seq|Bag)>\\s*<rdf:li[^>]*>)?([^<]*)`).exec(t); return m ? m[1].trim() : ''; };
    const title = pick('dc:title'), author = pick('dc:creator'), desc = pick('dc:description');
    if (title) P.props.title = title;
    if (author) P.props.author = author;
    if (desc) P.props.description = desc;
  }
  // Resources
  const colors = readColors(pub, await xml('Resources/Graphic.xml'));
  const styles = readStyles(pub, await xml('Resources/Styles.xml'), colors);
  // Layers
  const layers = new Map<string, string>();
  const layerEls = kids(doc).filter((k) => k.localName === 'Layer');
  if (layerEls.length) {
    P.layers = [];
    layerEls.forEach((l, i) => {
      const id = i === 0 ? 'default' : newId('lay');
      layers.set(l.getAttribute('Self') || '', id);
      P.layers.push({ id, name: l.getAttribute('Name') || `Layer ${i + 1}`, ...(l.getAttribute('Visible') === 'false' ? { hidden: true } : {}), ...(l.getAttribute('Locked') === 'true' ? { locked: true } : {}) });
    });
  }
  // Stories (read lazily when a frame refers to them)
  const storyEls = new Map<string, Element>();
  for (const ref of kids(doc).filter((k) => k.localName === 'Story')) {
    const src = ref.getAttribute('src');
    const d = src ? await xml(src) : null;
    const s = d && inner(d, 'Story');
    if (s) storyEls.set(s.getAttribute('Self') || src || '', s);
  }
  const env: Env = { pub, zip, colors, styles, warnings, layers, stories: new Map(), storyEls, frames: new Map(), links: [], missing: [], pictures: 0, unsupported: new Map(), anchored: [] };
  // Master spreads
  const masterBySpread = new Map<string, Master[]>();
  P.masters = [];
  for (const ref of kids(doc).filter((k) => k.localName === 'MasterSpread')) {
    const src = ref.getAttribute('src');
    const d = src ? await xml(src) : null;
    const ms = d && inner(d, 'MasterSpread');
    if (!ms) continue;
    const prefix = ms.getAttribute('NamePrefix') || 'A', baseName = ms.getAttribute('BaseName') || 'Master';
    const pages = kids(ms).filter((k) => k.localName === 'Page');
    const masters: Master[] = pages.map((pg, i) => {
      const g = marginsOf(pg);
      const side: Master['side'] = pages.length > 1 ? (i === 0 ? 'left' : 'right') : 'single';
      return { id: newId('mst'), name: `${prefix}-${baseName}${pages.length > 1 ? (i === 0 ? ' (Left)' : ' (Right)') : ''}`, items: [], margins: g.margins || [36, 36, 36, 36], columns: g.columns || 1, gutter: g.gutter ?? 12, side };
    });
    if (!masters.length) continue;
    P.masters.push(...masters);
    masterBySpread.set(ms.getAttribute('Self') || '', masters);
    await placeSpreadItems(env, ms, pageSlots(ms, masters, size));
  }
  if (!P.masters.length) P.masters.push({ id: newId('mst'), name: 'A-Master', items: [], margins: [36, 36, 36, 36], columns: 1, gutter: 12, side: 'single' });
  // Spreads and pages
  P.pages = [];
  const pageBySelf = new Map<string, Page>();
  for (const ref of kids(doc).filter((k) => k.localName === 'Spread')) {
    const src = ref.getAttribute('src');
    const d = src ? await xml(src) : null;
    const sp = d && inner(d, 'Spread');
    if (!sp) continue;
    const pageEls = kids(sp).filter((k) => k.localName === 'Page');
    const pages: Page[] = pageEls.map((pg, i) => {
      const ms = masterBySpread.get(pg.getAttribute('AppliedMaster') || '');
      const side = pageEls.length > 1 ? (i === 0 ? 'left' : 'right') : (P.facing && P.pages.length % 2 === 0 ? 'right' : 'single');
      const master = ms ? ms.find((m) => m.side === side) || ms.find((m) => m.side === 'single') || ms[0] : P.masters[0];
      const page: Page = { id: newId('pg'), master: master.id, items: [] };
      const name = pg.getAttribute('Name');
      if (name && !/^\d+$/.test(name)) page.name = name;
      const g = marginsOf(pg);
      if (g.margins && g.margins.join() !== master.margins.join()) page.margins = g.margins;
      if (g.columns && g.columns !== master.columns) page.columns = g.columns;
      if (g.gutter != null && g.gutter !== master.gutter) page.gutter = g.gutter;
      pageBySelf.set(pg.getAttribute('Self') || '', page);
      return page;
    });
    P.pages.push(...pages);
    await placeSpreadItems(env, sp, pageSlots(sp, pages, size));
  }
  if (!P.pages.length) P.pages.push({ id: newId('pg'), master: P.masters[0].id, items: [] });
  // Chains
  for (const l of env.links) {
    if (l.next) { const n = env.frames.get(l.next); if (n && n !== l.frame) { l.frame.next = n.id; n.prev = l.frame.id; } }
    if (l.prev) { const p = env.frames.get(l.prev); if (p && p !== l.frame) { p.next = l.frame.id; l.frame.prev = p.id; } }
  }
  // Anchored objects: placed as free objects on the page of the story's first frame.
  let placedAnchored = 0;
  for (const an of env.anchored) {
    const head = pub.chainOf(an.story)[0];
    const owner = head ? pub.pageOfItem(head.id) || P.masters.find((m) => !!pub.findItem(m, head.id)) : P.pages[0];
    if (!owner) continue;
    const r = await readItem(env, an.el, IDENTITY);
    if (!r) continue;
    const dx = (head ? head.x : 36) + 12 * (placedAnchored % 8) - r.item.x, dy = (head ? head.y : 36) + 12 * (placedAnchored % 8) - r.item.y;
    shift(r, dx, dy);
    owner.items.push(r.item);
    placedAnchored++;
  }
  // Sections
  const secs = kids(doc).filter((k) => k.localName === 'Section');
  for (const s of secs) {
    const page = pageBySelf.get(s.getAttribute('PageStart') || '');
    if (!page) continue;
    const start = pub.pageIndex(page.id);
    const style = s.getAttribute('PageNumberStyle') || 'Arabic';
    const numbering: Section['numbering'] = style === 'UpperRoman' ? 'romanUcPeriod' : style === 'LowerRoman' ? 'romanLcPeriod' : style === 'UpperLetters' ? 'alphaUcPeriod' : style === 'LowerLetters' ? 'alphaLcPeriod' : 'arabicPlain';
    const startAt = num(s.getAttribute('PageNumberStart'), 1);
    const prefix = s.getAttribute('SectionPrefix') || '';
    const cont = s.getAttribute('ContinueNumbering') === 'true';
    if (start === 0 && numbering === 'arabicPlain' && (cont || startAt === 1) && !prefix && secs.length === 1) continue;
    P.sections.push({ id: newId('sec'), name: s.getAttribute('Name') || `Section ${P.sections.length + 1}`, start, numbering, startAt: cont ? 1 : startAt, ...(prefix ? { prefix } : {}) });
  }
  // Text variables
  for (const v of kids(doc).filter((k) => k.localName === 'TextVariable')) {
    const name = v.getAttribute('Name') || '';
    const custom = kid(v, 'CustomTextVariablePreference');
    if (name && custom) P.variables.push({ name, value: custom.getAttribute('TextString') || '' });
  }
  pub.pruneStories();
  // Warnings
  if (env.missing.length) { const names = [...new Set(env.missing)]; warnings.push(`${names.length} picture${names.length > 1 ? 's are' : ' is'} linked to files outside the package (IDML does not embed them); the frames were kept with the file names (${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}). Use Tools ▸ Relink Picture.`); }
  else if (env.pictures) warnings.push(`${env.pictures} embedded picture${env.pictures > 1 ? 's' : ''} imported.`);
  if (placedAnchored) warnings.push(`${placedAnchored} object${placedAnchored > 1 ? 's' : ''} anchored in text ${placedAnchored > 1 ? 'were' : 'was'} placed as free object${placedAnchored > 1 ? 's' : ''} near the story's first frame.`);
  const tables = env.unsupported.get('Table'); if (tables) { warnings.push(`${tables} table${tables > 1 ? 's' : ''} in text became tab-separated rows.`); env.unsupported.delete('Table'); }
  const notes = env.unsupported.get('Note'); if (notes) { warnings.push(`${notes} editorial note${notes > 1 ? 's were' : ' was'} dropped.`); env.unsupported.delete('Note'); }
  if (env.unsupported.size) warnings.push(`Not imported: ${[...env.unsupported].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}.`);
  if (styles.fonts.size) warnings.push(`Fonts used: ${[...styles.fonts].sort().join(', ')}. Fonts that are not installed show in a substitute.`);
  return { pub, warnings };
}

export const IDML_MIME = 'application/vnd.adobe.indesign-idml-package';
