/**
 * InDesign Markup Language (.idml) export: writes the package Adobe's IDML specification describes
 * (`mimetype` first and stored, designmap.xml, META-INF/container.xml and metadata.xml, Resources/
 * Fonts.xml, Graphic.xml, Preferences.xml and Styles.xml, MasterSpreads/*.xml, Spreads/*.xml,
 * Stories/*.xml, XML/BackingStory.xml and XML/Tags.xml). Pages, masters, frames and chains, shapes,
 * lines, groups, pictures (embedded as base64 `Contents` so the package is self-contained), styles,
 * colors, layers, sections, variables, stories with footnotes, hyperlinks, anchored objects, tables
 * (as InDesign tables in a story) and text on a path (a path with a TextPath child) are written.
 * src/io/idmlExportText.ts writes the resources and the stories; src/io/idml.ts reads packages.
 *
 * Coordinates: IDML items carry their path in their own space and an ItemTransform into spread
 * space; a page's ItemTransform places it in the spread. QuillPress items are written with a path in
 * the item's own box (0..w, 0..h) and a transform translate(center) · rotate · flip · translate(−w/2,
 * −h/2), which the importer inverts.
 */
import JSZip from 'jszip';
import type { Pub } from '../model/pub';
import type { Item, LineItem, Master, Page, PathTextItem, PictureFrame, Publication, ShapeItem, TextFrame } from '../model/types';
import { geometryPath, scalePath } from '../model/geometry';
import { parsePath } from '../model/pathGeom';
import { esc, XML_DECL } from './xml';
import { IDML_MIME } from './index';
import { addModelStory, addStory, addTableStory, colorRef, DOM_VERSION, encName, fillStrokeAttrs, fontsXml, graphicXml, IDML_NS, n, objectSelf, pkgClose, pkgOpen, registerSwatches, stylesXml, type ExportCtx } from './idmlExportText';

// ------------------------------------------------------------------------------------------
// Geometry

interface PathPt { x: number; y: number; l?: { x: number; y: number }; r?: { x: number; y: number } }
interface SubPath { pts: PathPt[]; open: boolean }

/** SVG path data → IDML path points (anchors with left/right direction handles), one list per subpath. */
export function pathPointsOf(d: string): SubPath[] {
  const out: SubPath[] = [];
  let cur: SubPath | null = null;
  for (const s of parsePath(d)) {
    if (s.kind === 'move') { cur = { pts: [{ x: s.x, y: s.y }], open: true }; out.push(cur); continue; }
    if (!cur) { cur = { pts: [{ x: 0, y: 0 }], open: true }; out.push(cur); }
    if (s.kind === 'line') cur.pts.push({ x: s.x, y: s.y });
    else if (s.kind === 'cubic') { const prev = cur.pts[cur.pts.length - 1]; prev.r = { x: s.x1, y: s.y1 }; cur.pts.push({ x: s.x, y: s.y, l: { x: s.x2, y: s.y2 } }); }
    else if (s.kind === 'close') {
      cur.open = false;
      const first = cur.pts[0], last = cur.pts[cur.pts.length - 1];
      if (cur.pts.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) { if (last.l) first.l = last.l; cur.pts.pop(); }
      cur = null;
    }
  }
  return out.filter((p) => p.pts.length > 1 || (p.pts.length === 1 && !p.open));
}

function pathGeometryXml(subpaths: SubPath[]): string {
  const pt = (p: { x: number; y: number }) => `${n(p.x)} ${n(p.y)}`;
  return '<Properties><PathGeometry>' + subpaths.map((sp) => `<GeometryPathType PathOpen="${sp.open ? 'true' : 'false'}"><PathPointArray>${sp.pts.map((p) => `<PathPointType Anchor="${pt(p)}" LeftDirection="${pt(p.l || p)}" RightDirection="${pt(p.r || p)}"/>`).join('')}</PathPointArray></GeometryPathType>`).join('') + '</PathGeometry></Properties>';
}

const rectPoints = (w: number, h: number): SubPath[] => [{ pts: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], open: false }];

/** ItemTransform of an item whose path lives in its own w × h box: center in spread space, rotation (degrees clockwise) and flips. */
export function itemTransform(cx: number, cy: number, w: number, h: number, rot = 0, flipH = false, flipV = false): string {
  const t = (rot * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const fx = flipH ? -1 : 1, fy = flipV ? -1 : 1;
  const a = cos * fx, b = sin * fx, c = -sin * fy, d = cos * fy;
  const tx = cx - (a * w) / 2 - (c * h) / 2, ty = cy - (b * w) / 2 - (d * h) / 2;
  return [a, b, c, d, tx, ty].map(n).join(' ');
}

// ------------------------------------------------------------------------------------------
// Items

interface Env extends ExportCtx {
  frameSelf: Map<string, string>;
  layerSelf: Map<string, string>;
  pictures: number;
}

const WRAP: Record<string, string> = { square: 'BoundingBoxTextWrap', tight: 'Contour', topBottom: 'JumpObjectTextWrap' };
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/tiff': 'tif' };
const LINK_FORMAT: Record<string, string> = { png: '$ID/Portable Network Graphics (PNG)', jpg: '$ID/JPEG', gif: '$ID/GIF', bmp: '$ID/Windows Bitmap', tif: '$ID/TIFF', svg: '$ID/SVG' };

/** Attributes every page item carries. */
function commonAttrs(env: Env, item: Item, self: string, kind: 'text' | 'graphic' | 'none'): string {
  let s = ` Self="${self}"`;
  if (item.name) s += ` Name="${esc(item.name)}"`;
  s += ` Visible="${item.hidden ? 'false' : 'true'}" Locked="${item.locked ? 'true' : 'false'}"`;
  s += ` ItemLayer="${env.layerSelf.get(item.layer || 'default') || env.layerSelf.get('default') || 'ub1'}"`;
  s += ` AppliedObjectStyle="${esc(objectSelf(env, item.ostyle, kind))}"`;
  if (kind !== 'none') s += ' ContentType="' + (kind === 'text' ? 'TextType' : 'GraphicType') + '"';
  return s;
}

/** Children every page item may carry: text wrap and opacity. */
function commonChildren(item: Item): string {
  let s = '';
  if (item.wrap && item.wrap.mode !== 'none' && item.wrap.mode !== 'behind') {
    const o = n(item.wrap.offset ?? 6);
    s += `<TextWrapPreference Inverse="false" ApplyToMasterPageOnly="false" TextWrapSide="BothSides" TextWrapMode="${WRAP[item.wrap.mode] || 'BoundingBoxTextWrap'}"><Properties><TextWrapOffset Top="${o}" Left="${o}" Bottom="${o}" Right="${o}"/></Properties></TextWrapPreference>`;
  }
  if (item.alpha != null && item.alpha < 1) s += `<TransparencySetting><BlendingSetting Opacity="${n(Math.max(0, item.alpha) * 100)}"/></TransparencySetting>`;
  if (item.alt) s += `<ObjectExportOption AltTextSourceType="CustomAltText" CustomAltText="${esc(item.alt)}"/>`;
  return s;
}

function anchorChildren(item: Item): string {
  const an = item.anchored;
  if (!an) return '';
  const pos = an.mode === 'inline' ? 'InlinePosition' : an.mode === 'above' ? 'AboveLine' : 'Anchored';
  const align = an.align === 'ctr' ? 'CenterAlign' : an.align === 'r' ? 'RightAlign' : 'LeftAlign';
  return `<AnchoredObjectSetting AnchoredPosition="${pos}" SpineRelative="false" LockPosition="false" PinPosition="true" AnchorPoint="BottomLeftAnchor" HorizontalAlignment="${align}" HorizontalReferencePoint="TextFrame" VerticalReferencePoint="LineBaseline" AnchorXoffset="${n(an.dx || 0)}" AnchorYoffset="${n(an.dy || 0)}"/>`;
}

const insetXml = (ins: [number, number, number, number] | undefined) => {
  const i = ins || [0, 0, 0, 0];
  return `<Properties><InsetSpacing type="list"><ListItem type="unit">${n(i[1])}</ListItem><ListItem type="unit">${n(i[0])}</ListItem><ListItem type="unit">${n(i[3])}</ListItem><ListItem type="unit">${n(i[2])}</ListItem></InsetSpacing></Properties>`;
};

function textFrameXml(env: Env, f: TextFrame, transform: string, storySelf: string): string {
  const self = env.frameSelf.get(f.id) || env.nextId();
  const prev = f.prev && env.frameSelf.get(f.prev), next = f.next && env.frameSelf.get(f.next);
  const vj = f.anchor === 'ctr' ? 'CenterAlign' : f.anchor === 'b' ? 'BottomAlign' : f.anchor === 'just' ? 'JustifyAlign' : 'TopAlign';
  const fbo = f.firstBaseline === 'leading' ? 'LeadingOffset' : f.firstBaseline === 'capHeight' ? 'CapHeight' : 'AscentOffset';
  const geom = f.geom && f.geom !== 'rect' ? pathPointsOf(geometryPath(f.geom, f.w, f.h).d) : rectPoints(f.w, f.h);
  return `<TextFrame${commonAttrs(env, f, self, 'text')} ParentStory="${storySelf}" PreviousTextFrame="${prev || 'n'}" NextTextFrame="${next || 'n'}"${fillStrokeAttrs(env, f.fill, f.line)} ItemTransform="${transform}">`
    + pathGeometryXml(geom.length ? geom : rectPoints(f.w, f.h))
    + `<TextFramePreference TextColumnCount="${Math.max(1, f.columns || 1)}" TextColumnGutter="${n(f.gutter ?? 12)}" VerticalJustification="${vj}" AutoSizingType="${f.autosize === 'height' ? 'HeightOnly' : 'Off'}" IgnoreWrap="${f.ignoreWrap ? 'true' : 'false'}" FirstBaselineOffset="${fbo}" ColumnsPositions="" TextColumnFixedWidth="${n(Math.max(1, (f.w - (f.insets?.[0] || 0) - (f.insets?.[2] || 0) - (f.gutter ?? 12) * (Math.max(1, f.columns || 1) - 1)) / Math.max(1, f.columns || 1)))}">${insetXml(f.insets)}</TextFramePreference>`
    + commonChildren(f) + anchorChildren(f) + '</TextFrame>\n';
}

function pictureXml(env: Env, p: PictureFrame, transform: string): string {
  const self = env.nextId();
  const tag = p.geom === 'ellipse' ? 'Oval' : 'Rectangle';
  const geom = p.geom && p.geom !== 'rect' ? pathPointsOf(geometryPath(p.geom, p.w, p.h).d) : rectPoints(p.w, p.h);
  let inner = pathGeometryXml(geom.length ? geom : rectPoints(p.w, p.h));
  const media = p.media ? env.pub.media[p.media] : undefined;
  if (media || p.src) {
    env.pictures++;
    const ext = media ? MIME_EXT[media.mime] || (p.src && /\.([a-z0-9]+)$/i.exec(p.src)?.[1]) || 'png' : /\.([a-z0-9]+)$/i.exec(p.src || '')?.[1]?.toLowerCase() || 'png';
    const name = (p.src && p.src.replace(/^.*[\\/]/, '')) || media?.name || `${p.id}.${ext}`;
    const mw = media?.w || p.w, mh = media?.h || p.h;
    const scale = p.fit === 'stretch' ? { x: p.w / (mw || 1), y: p.h / (mh || 1) } : p.fit === 'fit' ? (() => { const k = Math.min(p.w / (mw || 1), p.h / (mh || 1)); return { x: k, y: k }; })() : (() => { const k = Math.max(p.w / (mw || 1), p.h / (mh || 1)); return { x: k, y: k }; })();
    inner += `<Image Self="${env.nextId()}" Space="$ID/#Links_RGB" ActualPpi="72 72" EffectivePpi="${n(72 / (scale.x || 1))} ${n(72 / (scale.y || 1))}" ImageTypeName="$ID/${ext.toUpperCase()}" ItemTransform="${n(scale.x)} 0 0 ${n(scale.y)} 0 0">`
      + `<Properties><Profile type="string">$ID/Embedded</Profile><GraphicBounds Left="0" Top="0" Right="${n(mw || p.w)}" Bottom="${n(mh || p.h)}"/>${media ? `<Contents>${media.b64}</Contents>` : ''}</Properties>`
      + `<Link Self="${env.nextId()}" AssetURL="$ID/" AssetID="$ID/" LinkResourceURI="file:///${encodeURIComponent(name)}" LinkResourceFormat="${esc(LINK_FORMAT[ext] || `$ID/${ext.toUpperCase()}`)}" StoredState="${media ? 'Embedded' : 'Normal'}" LinkClassID="35906" LinkClientID="257" LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport" LinkImportStamp="" LinkImportModificationTime="2000-01-01T00:00:00" LinkImportTime="2000-01-01T00:00:00" LinkResourceSize="${media ? Math.floor((media.b64.length * 3) / 4) : 0}"/>`
      + '</Image>';
    inner += `<FrameFittingOption AutoFit="false" FittingOnEmptyFrame="${p.fit === 'fit' ? 'Proportionally' : p.fit === 'stretch' ? 'ContentToFrame' : p.fit === 'none' ? 'None' : 'FillProportionally'}" FittingAlignment="CenterAnchor"/>`;
  }
  return `<${tag}${commonAttrs(env, p, self, 'graphic')}${fillStrokeAttrs(env, p.fill, p.line)} ItemTransform="${transform}">${inner}${commonChildren(p)}${anchorChildren(p)}</${tag}>\n`;
}

function shapeXml(env: Env, s: ShapeItem, transform: string): string {
  const self = env.nextId();
  const tag = s.geom === 'rect' && !s.adj ? 'Rectangle' : s.geom === 'ellipse' ? 'Oval' : 'Polygon';
  const path = geometryPath(s.geom, s.w, s.h, s.adj, s.path);
  const pts = tag === 'Rectangle' ? rectPoints(s.w, s.h) : pathPointsOf(path.d);
  return `<${tag}${commonAttrs(env, s, self, 'none')}${fillStrokeAttrs(env, s.fill, s.line)} ItemTransform="${transform}">${pathGeometryXml(pts.length ? pts : rectPoints(s.w, s.h))}${commonChildren(s)}${anchorChildren(s)}</${tag}>\n`;
}

function lineXml(env: Env, l: LineItem, transform: string): string {
  const self = env.nextId();
  const line = l.line || { fill: { type: 'solid', color: 'Black' }, width: 1 };
  return `<GraphicLine${commonAttrs(env, l, self, 'none')}${fillStrokeAttrs(env, { type: 'none' }, line.width ? line : { ...line, width: 1 }, true)} ItemTransform="${transform}">${pathGeometryXml([{ pts: [{ x: 0, y: 0 }, { x: l.w, y: l.h }], open: true }])}${commonChildren(l)}${anchorChildren(l)}</GraphicLine>\n`;
}

function pathTextXml(env: Env, p: PathTextItem, transform: string): string {
  const self = env.nextId();
  const d = scalePath(p.path.d, p.path.w ? p.w / p.path.w : 1, p.path.h ? p.h / p.path.h : 1);
  const pts = pathPointsOf(d);
  const open = !pts.length || pts[0].open;
  const tag = open ? 'GraphicLine' : 'Polygon';
  const storySelf = addStory(env, p.text, { name: p.name, footnotes: (p as any).footnotes });
  const align = p.align === 'center' ? 'CenterAlign' : p.align === 'end' ? 'RightAlign' : p.align === 'justify' ? 'FullyJustified' : 'LeftAlign';
  const pathAlign = p.baseline > 0 ? 'BottomPathAlignment' : p.baseline < 0 ? 'TopPathAlignment' : 'CenterPathAlignment';
  const line = p.showPath ? p.line : undefined;
  return `<${tag}${commonAttrs(env, p, self, 'none')}${fillStrokeAttrs(env, { type: 'none' }, line)} ItemTransform="${transform}">${pathGeometryXml(pts.length ? pts : [{ pts: [{ x: 0, y: 0 }, { x: p.w, y: p.h }], open: true }])}`
    + `<TextPath Self="${env.nextId()}" ParentStory="${storySelf}" PathEffect="RainbowPathEffect" PathAlignment="${pathAlign}" TextAlignment="BaselineAlignment" PathSpacing="${n(p.spacing || 0)}" StartBracket="${n(p.offset || 0)}" EndBracket="${n(Math.hypot(p.w, p.h) * 4)}" Flip="${p.flip ? 'true' : 'false'}" TextPathJustification="${align}"/>`
    + commonChildren(p) + anchorChildren(p) + `</${tag}>\n`;
}

/** XML of an item placed with its page's origin in spread space. */
function itemXml(env: Env, item: Item, ox: number, oy: number): string {
  const cx = ox + item.x + item.w / 2, cy = oy + item.y + item.h / 2;
  const t = itemTransform(cx, cy, item.w, item.h, item.rot || 0, item.flipH, item.flipV);
  switch (item.kind) {
    case 'text': { const story = env.pub.story(item.story); const storySelf = story ? addModelStory(env, story) : addStory(env, [], {}); return textFrameXml(env, item, t, storySelf); }
    case 'picture': return pictureXml(env, item, t);
    case 'shape': return shapeXml(env, item, t);
    case 'line': return lineXml(env, item, t);
    case 'pathText': return pathTextXml(env, item, t);
    case 'table': {
      const storySelf = addTableStory(env, item);
      const frame: TextFrame = { id: item.id, kind: 'text', story: '', x: item.x, y: item.y, w: item.w, h: item.h, rot: item.rot, flipH: item.flipH, flipV: item.flipV, name: item.name, hidden: item.hidden, locked: item.locked, layer: item.layer, wrap: item.wrap, alpha: item.alpha, insets: [0, 0, 0, 0], anchored: item.anchored };
      if (!env.frameSelf.has(item.id)) env.frameSelf.set(item.id, env.nextId());
      return textFrameXml(env, frame, t, storySelf);
    }
    case 'group': {
      const self = env.nextId();
      return `<Group${commonAttrs(env, item, self, 'none')} ItemTransform="1 0 0 1 0 0">${commonChildren(item)}${anchorChildren(item)}${item.children.filter((c) => !env.anchoredWritten.has(c.id)).map((c) => itemXml(env, c, ox, oy)).join('')}</Group>\n`;
    }
    default: return '';
  }
}

// ------------------------------------------------------------------------------------------
// Spreads

interface SpreadPage { self: string; page: Page | Master; ox: number; oy: number; applied: string; name: string }

function marginXml(g: { margins: [number, number, number, number]; columns: number; gutter: number }, w: number): string {
  const [t, r, b, l] = g.margins;
  const cols = Math.max(1, g.columns);
  const colW = (w - l - r - g.gutter * (cols - 1)) / cols;
  const pos: number[] = [];
  for (let i = 0; i < cols; i++) { pos.push(l + i * (colW + g.gutter)); pos.push(l + i * (colW + g.gutter) + colW); }
  return `<MarginPreference ColumnCount="${cols}" ColumnGutter="${n(g.gutter)}" Top="${n(t)}" Bottom="${n(b)}" Left="${n(l)}" Right="${n(r)}" ColumnDirection="Horizontal" ColumnsPositions="${pos.map(n).join(' ')}"/>`;
}

function pagesXml(env: Env, pages: SpreadPage[], geometryOf: (p: Page | Master) => { margins: [number, number, number, number]; columns: number; gutter: number }): string {
  const { w, h } = env.P.size;
  return pages.map((sp) => `<Page Self="${sp.self}" Name="${esc(sp.name)}" AppliedMaster="${sp.applied}" OverrideList="" AppliedTrapPreset="TrapPreset/$ID/kDefaultTrapStyleName" GeometricBounds="0 0 ${n(h)} ${n(w)}" ItemTransform="1 0 0 1 ${n(sp.ox)} ${n(sp.oy)}" MasterPageTransform="1 0 0 1 0 0">${marginXml(geometryOf(sp.page), w)}</Page>\n`).join('');
}

function spreadItemsXml(env: Env, pages: SpreadPage[]): string {
  return pages.map((sp) => sp.page.items.filter((it) => !env.anchoredWritten.has(it.id)).map((it) => itemXml(env, it, sp.ox, sp.oy)).join('')).join('');
}

/** Facing masters named "X (Left)" / "X (Right)" (or sided masters sharing a base name) form one master spread. */
function masterGroups(masters: Master[]): Master[][] {
  const groups: Master[][] = [];
  const used = new Set<string>();
  const base = (m: Master) => m.name.replace(/\s*\((Left|Right)\)\s*$/i, '');
  for (const m of masters) {
    if (used.has(m.id)) continue;
    used.add(m.id);
    if (m.side === 'left' || m.side === 'right') {
      const other = masters.find((o) => !used.has(o.id) && o.side !== m.side && o.side !== 'single' && base(o) === base(m));
      if (other) { used.add(other.id); groups.push(m.side === 'left' ? [m, other] : [other, m]); continue; }
    }
    groups.push([m]);
  }
  return groups;
}

function masterNameParts(group: Master[], index: number): { prefix: string; base: string } {
  const name = group[0].name.replace(/\s*\((Left|Right)\)\s*$/i, '');
  const m = /^([A-Za-z]{1,4})-(.+)$/.exec(name);
  if (m) return { prefix: m[1], base: m[2] };
  return { prefix: String.fromCharCode(65 + (index % 26)), base: name || 'Master' };
}

// ------------------------------------------------------------------------------------------
// Package

const UNITS: Record<Publication['unit'], string> = { in: 'Inches', mm: 'Millimeters', cm: 'Centimeters', pt: 'Points', pica: 'Picas', px: 'Pixels' };
const NUMBERING: Record<string, string> = { arabicPlain: 'Arabic', arabicPeriod: 'Arabic', arabicParenR: 'Arabic', romanUcPeriod: 'UpperRoman', romanLcPeriod: 'LowerRoman', alphaUcPeriod: 'UpperLetters', alphaLcPeriod: 'LowerLetters', alphaLcParenR: 'LowerLetters', none: 'Arabic' };

function metadataXml(P: Publication): string {
  const alt = (v: string | undefined) => (v ? `<rdf:Alt><rdf:li xml:lang="x-default">${esc(v)}</rdf:li></rdf:Alt>` : '');
  const when = new Date(P.props.modified || P.props.created || Date.now()).toISOString();
  return `${XML_DECL}<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">`
    + '<dc:format>application/vnd.adobe.indesign-idml-package</dc:format>'
    + (P.props.title ? `<dc:title>${alt(P.props.title)}</dc:title>` : '')
    + (P.props.author ? `<dc:creator><rdf:Seq><rdf:li>${esc(P.props.author)}</rdf:li></rdf:Seq></dc:creator>` : '')
    + (P.props.description ? `<dc:description>${alt(P.props.description)}</dc:description>` : '')
    + (P.props.keywords ? `<dc:subject><rdf:Bag>${P.props.keywords.split(/[,;]\s*/).filter(Boolean).map((k) => `<rdf:li>${esc(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>` : '')
    + `<xmp:CreatorTool>QuillPress</xmp:CreatorTool><xmp:ModifyDate>${when}</xmp:ModifyDate>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>\n';
}

function preferencesXml(env: Env): string {
  const P = env.P;
  const fo = P.footnoteOptions;
  const scheme = fo?.scheme === 'symbols' ? 'Symbols' : NUMBERING[fo?.scheme || 'arabicPlain'] || 'Arabic';
  return pkgOpen('Preferences')
    + `<DocumentPreference PageHeight="${n(P.size.h)}" PageWidth="${n(P.size.w)}" PagesPerDocument="${P.pages.length}" FacingPages="${P.facing ? 'true' : 'false'}" DocumentBleedTopOffset="${n(P.bleed)}" DocumentBleedBottomOffset="${n(P.bleed)}" DocumentBleedInsideOrLeftOffset="${n(P.bleed)}" DocumentBleedOutsideOrRightOffset="${n(P.bleed)}" DocumentBleedUniformSize="true" SlugTopOffset="0" SlugBottomOffset="0" SlugInsideOrLeftOffset="0" SlugRightOrOutsideOffset="0" DocumentSlugUniformSize="false" PreserveLayoutWhenShuffling="true" AllowPageShuffle="true" OverprintBlack="true" PageBinding="LeftToRight" ColumnDirection="Horizontal" PageOrientation="${P.size.w > P.size.h ? 'Landscape' : 'Portrait'}" CreatePrimaryTextFrame="false" StartPageNumber="1" ColumnGuideColor="Violet" MarginGuideColor="Magenta"/>\n`
    + `<ViewPreference HorizontalMeasurementUnits="${UNITS[P.unit] || 'Inches'}" VerticalMeasurementUnits="${UNITS[P.unit] || 'Inches'}" RulerOrigin="SpreadOrigin" ShowRulers="true" HorizontalCustomPoints="12" VerticalCustomPoints="12" PointsPerInch="72" StrokeMeasurementUnits="Points" TypographicMeasurementUnits="Points" TextSizeMeasurementUnits="Points" KeyboardIncrements="1" CursorKeyIncrements="1" BaselineShiftKeyIncrements="2" KerningKeyIncrements="20" LeadingKeyIncrements="2" ShowFrameEdges="true" GuideSnapToZone="4"/>\n`
    + `<GridPreference BaselineStart="${n(P.baselineGrid.start)}" BaselineDivision="${n(P.baselineGrid.step || 12)}" BaselineShown="${P.baselineGrid.show ? 'true' : 'false'}" BaselineGridRelativeOption="TopOfPageOption" BaselineViewThreshold="75" DocumentGridShown="false" DocumentGridSnapto="false" GuidesInBack="false" GuidesLocked="false" GuidesShown="true" GuidesSnapto="true" HorizontalGridlineDivision="72" HorizontalGridSubdivision="8" VerticalGridlineDivision="72" VerticalGridSubdivision="8"/>\n`
    + `<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="${n((P as any).opticalMarginSize ?? 12)}" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>\n`
    + `<FootnoteOption FootnoteNumberingStyle="${scheme}" StartAt="1" RestartNumbering="${fo?.restart === 'page' ? 'PageRestart' : 'DontRestart'}" ShowPrefixSuffix="NoPrefixSuffix" Prefix="" Suffix="" FootnoteMarkerPositioning="SuperscriptMarker" FootnoteTextPositioning="NormalMarker" Spacer="" SpaceBetween="0" SpaceFirst="0" SeparatorText="&#x9;" EruditeFootnotes="false" NoSplitting="false" FootnoteMarkerStyle="CharacterStyle/$ID/[No character style]" FootnoteTextStyle="${esc(`ParagraphStyle/${encName(fo?.style || 'Footnote')}`)}" FootnoteFirstBaselineOffset="LeadingOffset" FootnoteMinimumFirstBaselineOffset="0"/>\n`
    + pkgClose('Preferences');
}

function makeEnv(pub: Pub): Env {
  let counter = 0x100;
  const anchoredItems = new Map<string, Item>();
  const collect = (items: Item[]) => { for (const it of items) { if (it.anchored) anchoredItems.set(it.id, it); if (it.kind === 'group') collect(it.children); } };
  for (const p of pub.data.pages) collect(p.items);
  for (const m of pub.data.masters) collect(m.items);
  const env: Env = {
    pub, P: pub.data,
    nextId: () => `u${(counter++).toString(16)}`,
    colors: new Map(), gradients: [], dashDot: false, storyFiles: [], hyperlinks: [], anchoredWritten: new Set(),
    anchoredItem: (id) => anchoredItems.get(id),
    anchoredXml: (item) => { const an = item.anchored; return itemXml(env, { ...item, x: an?.dx || 0, y: (an?.mode === 'inline' ? -item.h : 0) + (an?.dy || 0) }, 0, 0); },
    storySelf: new Map(), frameSelf: new Map(), layerSelf: new Map(), pictures: 0,
  };
  return env;
}

/** Writes the publication as an IDML package. */
export async function exportIdml(pub: Pub): Promise<Uint8Array> {
  const env = makeEnv(pub);
  const P = env.P;
  registerSwatches(env);
  // Layers (the default layer first, as the importer expects).
  const layers = [...P.layers.filter((l) => l.id === 'default'), ...P.layers.filter((l) => l.id !== 'default')];
  if (!layers.length) layers.push({ id: 'default', name: 'Layer 1' });
  for (const l of layers) env.layerSelf.set(l.id, env.nextId());
  // Frame ids first, so chains can refer forward.
  for (const f of pub.textFrames()) env.frameSelf.set(f.id, env.nextId());
  // Stories referenced by frames, before the spreads consume their anchored objects.
  for (const f of pub.textFrames()) { const s = pub.story(f.story); if (s) addModelStory(env, s); }
  // Master spreads.
  const masterParts: { self: string; file: string; xml: string }[] = [];
  const masterSpreadOf = new Map<string, string>();
  const { w: W, h: H } = P.size;
  masterGroups(P.masters).forEach((group, gi) => {
    const self = env.nextId();
    const { prefix, base } = masterNameParts(group, gi);
    const pages: SpreadPage[] = group.map((m, i) => {
      masterSpreadOf.set(m.id, self);
      const ox = group.length > 1 ? (i === 0 ? -W : 0) : -W / 2;
      return { self: env.nextId(), page: m, ox, oy: -H / 2, applied: 'n', name: `${prefix}-${base}` };
    });
    const xml = pkgOpen('MasterSpread') + `<MasterSpread Self="${self}" Name="${esc(`${prefix}-${base}`)}" NamePrefix="${esc(prefix)}" BaseName="${esc(base)}" ShowMasterItems="true" PageCount="${pages.length}" OverriddenPageItemProps="" ItemTransform="1 0 0 1 0 0">\n`
      + `<Properties><PageColor type="enumeration">UseMasterColor</PageColor></Properties>\n`
      + pagesXml(env, pages, (p) => ({ margins: (p as Master).margins, columns: (p as Master).columns, gutter: (p as Master).gutter }))
      + spreadItemsXml(env, pages)
      + '</MasterSpread>\n' + pkgClose('MasterSpread');
    masterParts.push({ self, file: `MasterSpreads/MasterSpread_${self}.xml`, xml });
  });
  // Spreads: one per page, or per facing pair.
  const spreadParts: { self: string; file: string; xml: string }[] = [];
  const pageSelf = new Map<string, string>();
  const groups: number[][] = [];
  if (P.facing) { if (P.pages.length) groups.push([0]); for (let i = 1; i < P.pages.length; i += 2) groups.push(i + 1 < P.pages.length ? [i, i + 1] : [i]); }
  else P.pages.forEach((_, i) => groups.push([i]));
  for (const g of groups) {
    const self = env.nextId();
    const pages: SpreadPage[] = g.map((idx, i) => {
      const page = P.pages[idx];
      const ps = env.nextId();
      pageSelf.set(page.id, ps);
      const ox = g.length > 1 ? (i === 0 ? -W : 0) : P.facing ? 0 : -W / 2;
      return { self: ps, page, ox, oy: -H / 2, applied: masterSpreadOf.get(page.master) || masterSpreadOf.values().next().value || 'n', name: pub.pageLabel(idx) || String(idx + 1) };
    });
    const xml = pkgOpen('Spread') + `<Spread Self="${self}" FlattenerOverride="Default" ShowMasterItems="true" PageCount="${pages.length}" BindingLocation="${g.length > 1 ? 1 : 0}" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0">\n`
      + '<FlattenerPreference LineArtAndTextResolution="300" GradientAndMeshResolution="150" ClipComplexRegions="false" ConvertAllStrokesToOutlines="false" ConvertAllTextToOutlines="false"><Properties><RasterVectorBalance type="double">50</RasterVectorBalance></Properties></FlattenerPreference>\n'
      + pagesXml(env, pages, (p) => pub.geometry(p as Page))
      + spreadItemsXml(env, pages)
      + '</Spread>\n' + pkgClose('Spread');
    spreadParts.push({ self, file: `Spreads/Spread_${self}.xml`, xml });
  }
  // designmap.xml
  const layersXml = layers.map((l) => `<Layer Self="${env.layerSelf.get(l.id)}" Name="${esc(l.name)}" Visible="${l.hidden ? 'false' : 'true'}" Locked="${l.locked ? 'true' : 'false'}" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer>\n`).join('');
  const sections = [...P.sections].sort((a, b) => a.start - b.start).filter((s) => s.start >= 0 && s.start < P.pages.length);
  if (!sections.length || sections[0].start !== 0) sections.unshift({ id: '', name: '', start: 0, numbering: 'arabicPlain', startAt: 1 });
  const sectionsXml = sections.map((s, i) => {
    const end = i + 1 < sections.length ? sections[i + 1].start : P.pages.length;
    const page = P.pages[s.start];
    return `<Section Self="${env.nextId()}" Length="${Math.max(1, end - s.start)}" Name="${esc(s.name)}" ContinueNumbering="${i === 0 && s.startAt === 1 ? 'true' : 'false'}" IncludeSectionPrefix="${s.prefix ? 'true' : 'false'}" Marker="" PageNumberStart="${s.startAt}" SectionPrefix="${esc(s.prefix || '')}" AlternateLayout="" AlternateLayoutLength="0" PageStart="${pageSelf.get(page.id)}" PageNumberStyle="${s.numbering === 'none' ? 'Arabic' : NUMBERING[s.numbering] || 'Arabic'}"><Properties><Label><KeyValuePair Key="" Value=""/></Label></Properties></Section>\n`;
  }).join('');
  const variablesXml = P.variables.map((v) => `<TextVariable Self="${env.nextId()}" Name="${esc(v.name)}" VariableType="CustomTextType"><CustomTextVariablePreference TextString="${esc(v.value)}"/></TextVariable>\n`).join('');
  const hyperlinksXml = env.hyperlinks.map((h) => {
    const dest = env.nextId();
    return `<HyperlinkURLDestination Self="HyperlinkURLDestination/${dest}" Name="${esc(h.url)}" DestinationURL="${esc(h.url)}" DestinationUniqueKey="${parseInt(dest.slice(1), 16)}" Hidden="false"/>\n<Hyperlink Self="${env.nextId()}" Name="${esc(h.name)}" Source="${h.source}" Visible="false" Highlight="None" Width="Thin" BorderStyle="Solid" Hidden="false" DestinationUniqueKey="${parseInt(dest.slice(1), 16)}"><Properties><BorderColor type="enumeration">Black</BorderColor><Destination type="object">HyperlinkURLDestination/${dest}</Destination></Properties></Hyperlink>\n`;
  }).join('');
  const docName = `${(P.props.title || 'Publication').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Publication'}.indd`;
  const designmap = `${XML_DECL}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="16.0(16)" ?>\n`
    + `<Document xmlns:idPkg="${IDML_NS}" DOMVersion="${DOM_VERSION}" Self="d" StoryList="${env.storyFiles.map((s) => s.self).join(' ')}" Name="${esc(docName)}" ZeroPoint="0 0" ActiveLayer="${env.layerSelf.get('default')}" CMYKProfile="U.S. Web Coated (SWOP) v2" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="PreserveEmbeddedProfiles" AccurateLABSpots="false">\n`
    + '<Properties><Label><KeyValuePair Key="kAdobeDPS_DocumentCreator" Value="QuillPress"/></Label></Properties>\n'
    + `<Language Self="Language/$ID/English%3a USA" Name="$ID/English: USA" SingleQuotes="&#x2018;&#x2019;" DoubleQuotes="&#x201c;&#x201d;" PrimaryLanguageName="$ID/English" SublanguageName="$ID/USA" Id="269" HyphenationVendor="Hunspell" SpellingVendor="Hunspell"/>\n`
    + '<idPkg:Graphic src="Resources/Graphic.xml"/>\n<idPkg:Fonts src="Resources/Fonts.xml"/>\n<idPkg:Styles src="Resources/Styles.xml"/>\n<idPkg:Preferences src="Resources/Preferences.xml"/>\n'
    + variablesXml + layersXml + sectionsXml
    + '<idPkg:Tags src="XML/Tags.xml"/>\n'
    + masterParts.map((m) => `<idPkg:MasterSpread src="${m.file}"/>\n`).join('')
    + spreadParts.map((s) => `<idPkg:Spread src="${s.file}"/>\n`).join('')
    + '<idPkg:BackingStory src="XML/BackingStory.xml"/>\n'
    + hyperlinksXml
    + env.storyFiles.map((s) => `<idPkg:Story src="${s.file}"/>\n`).join('')
    + '</Document>\n';
  // Package, in the order the specification lists the parts.
  const zip = new JSZip();
  zip.file('mimetype', IDML_MIME, { compression: 'STORE' });
  zip.file('designmap.xml', designmap);
  zip.file('META-INF/container.xml', `${XML_DECL}<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>\n`);
  zip.file('META-INF/metadata.xml', metadataXml(P));
  zip.file('Resources/Fonts.xml', fontsXml(env));
  zip.file('Resources/Graphic.xml', graphicXml(env));
  zip.file('Resources/Preferences.xml', preferencesXml(env));
  zip.file('Resources/Styles.xml', stylesXml(env));
  for (const m of masterParts) zip.file(m.file, m.xml);
  for (const s of spreadParts) zip.file(s.file, s.xml);
  for (const s of env.storyFiles) zip.file(s.file, s.xml);
  zip.file('XML/BackingStory.xml', pkgOpen('BackingStory') + `<XmlStory Self="${env.nextId()}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n"><StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/><InCopyExportOption IncludeGraphicProxies="true" IncludeAllResources="false"/><XMLElement Self="di2" MarkupTag="XMLTag/Root"/></XmlStory>\n` + pkgClose('BackingStory'));
  zip.file('XML/Tags.xml', pkgOpen('Tags') + '<XMLTag Self="XMLTag/Root" Name="Root"><Properties><TagColor type="enumeration">LightBlue</TagColor></Properties></XMLTag>\n' + pkgClose('Tags'));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: IDML_MIME });
}
