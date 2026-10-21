/**
 * Turns the intermediate layout document of a Publisher file into a QuillPress publication:
 * pages and master pages, text frames with their stories and chains, picture frames with the
 * embedded pictures, shapes, lines, groups and tables, with the palette as swatches.
 */
import { Pub, newId } from '../../model/pub';
import type { Item, TextFrame, PictureFrame, ShapeItem, LineItem, GroupItem, TableItem, TableCell, Paragraph, Master, Page, Fill, Line, Story } from '../../model/types';
import { b64 } from '../xml';
import type { LDoc, LShape, LPage } from './shapes';
import { storyParagraphs, paraByteLength, hex, type TextEnv } from './text';
import type { QPara } from './quill';

/** Office Art shape type numbers → QuillPress preset geometry names. */
const PRESETS: Record<number, string> = {
  1: 'rect', 2: 'roundRect', 3: 'ellipse', 4: 'diamond', 5: 'triangle', 6: 'rtTriangle', 7: 'parallelogram', 8: 'trapezoid', 9: 'hexagon', 10: 'octagon', 11: 'plus', 12: 'star5', 13: 'rightArrow', 15: 'homePlate', 16: 'cube', 17: 'wedgeRectCallout', 19: 'arc', 21: 'plaque', 22: 'can', 23: 'donut', 24: 'rect',
  32: 'line', 33: 'bentConnector3', 34: 'bentConnector3', 35: 'bentConnector3', 36: 'bentConnector3', 37: 'curvedConnector3', 38: 'curvedConnector3', 39: 'curvedConnector3', 40: 'curvedConnector3', 41: 'borderCallout1', 42: 'borderCallout1', 43: 'borderCallout1',
  53: 'ribbon2', 54: 'ribbon2', 55: 'chevron', 56: 'pentagon', 57: 'noSmoking', 58: 'star8', 59: 'star16', 60: 'star24', 64: 'wave', 65: 'foldedCorner', 66: 'leftArrow', 67: 'downArrow', 68: 'upArrow', 69: 'leftRightArrow', 70: 'upDownArrow', 71: 'irregularSeal1', 72: 'irregularSeal1', 73: 'lightningBolt', 74: 'heart', 75: 'rect', 76: 'quadArrow',
  84: 'bevel', 85: 'bracketPair', 86: 'bracketPair', 87: 'bracePair', 88: 'bracePair', 92: 'star24', 93: 'stripedRightArrow', 94: 'notchedRightArrow', 95: 'pie', 96: 'smileyFace', 97: 'verticalScroll', 98: 'horizontalScroll', 99: 'circularArrow', 101: 'uturnArrow',
  109: 'flowChartProcess', 110: 'flowChartDecision', 111: 'flowChartInputOutput', 112: 'flowChartPredefinedProcess', 114: 'flowChartDocument', 116: 'flowChartTerminator', 117: 'flowChartPreparation', 118: 'flowChartManualInput', 119: 'flowChartManualOperation', 120: 'flowChartConnector', 121: 'flowChartPunchedCard', 126: 'flowChartSort', 127: 'flowChartExtract', 128: 'flowChartMerge', 132: 'flowChartMagneticDisk', 135: 'flowChartDelay', 176: 'flowChartAlternateProcess', 177: 'flowChartOffpageConnector',
  183: 'sun', 184: 'moon', 185: 'bracketPair', 186: 'bracePair', 187: 'star4', 188: 'wave', 189: 'actionButtonBlank', 190: 'actionButtonHome', 193: 'actionButtonForwardNext', 194: 'actionButtonBackPrevious', 195: 'actionButtonEnd', 196: 'actionButtonBeginning', 197: 'actionButtonReturn', 202: 'rect',
};
const LINE_TYPES = new Set([20, 32]);

interface Env {
  pub: Pub;
  doc: LDoc;
  text: TextEnv | null;
  /** Media id by picture number. */
  media: Map<number, string>;
  /** Picture numbers whose format could not be placed (metafiles). */
  skippedPictures: Set<number>;
  /** Text frames by Quill text id, in placement order (for chains). */
  frames: Map<number, TextFrame[]>;
  stories: Map<number, Story>;
  counts: { unknownShapes: number; metafiles: number; emptyBoxes: number };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function boxOf(env: Env, s: LShape): { x: number; y: number; w: number; h: number } | null {
  if (!s.box) return null;
  const W = env.doc.width, H = env.doc.height;
  const x = (W / 2 + s.box.xs) / 12700, y = (H / 2 + s.box.ys) / 12700;
  return { x: r2(x), y: r2(y), w: r2(Math.max(0, s.box.xe - s.box.xs) / 12700), h: r2(Math.max(0, s.box.ye - s.box.ys) / 12700) };
}

function lineProp(s: LShape): Line | undefined {
  if (!s.line) return undefined;
  const l: Line = { fill: { type: 'solid', color: s.line.color }, width: s.line.width };
  if (s.line.dash) l.dash = s.line.dash;
  if (s.line.head) l.head = s.line.head;
  if (s.line.tail) l.tail = s.line.tail;
  if (s.line.cap) l.cap = s.line.cap;
  return l;
}

function mediaOf(env: Env, n: number): string | undefined {
  if (env.media.has(n)) return env.media.get(n);
  const pic = env.doc.pictures[n - 1];
  if (!pic || !pic.data.length) return undefined;
  if (pic.kind === 'wmf' || pic.kind === 'emf' || pic.kind === 'pict' || pic.kind === 'unknown') { env.skippedPictures.add(n); env.counts.metafiles++; return undefined; }
  const id = env.pub.addMedia({ mime: pic.mime, b64: b64(pic.data), name: `picture-${n}.${pic.kind === 'jpeg' ? 'jpg' : pic.kind === 'dib' ? 'bmp' : pic.kind}` });
  env.media.set(n, id);
  return id;
}

function fillOf(env: Env, f: Fill | undefined): Fill | undefined {
  if (!f) return undefined;
  if (f.type === 'image' && f.media.startsWith('pic:')) {
    const id = mediaOf(env, parseInt(f.media.slice(4), 10));
    return id ? { ...f, media: id } : undefined;
  }
  return f;
}

function common(env: Env, s: LShape, box: { x: number; y: number; w: number; h: number }, id: string): Omit<Item, 'kind'> & { kind?: never } {
  const base: any = { id, ...box };
  if (s.rot) base.rot = s.rot;
  if (s.flipH) base.flipH = true;
  if (s.flipV) base.flipV = true;
  const fill = s.fillBgOnly ? undefined : fillOf(env, s.fill);
  if (fill) base.fill = fill;
  const line = lineProp(s);
  if (line) base.line = line;
  if (s.shadow) base.effects = { shadow: { color: s.shadow.color, blur: 0, dist: s.shadow.dist, dir: s.shadow.dir, ...(s.shadow.alpha != null && s.shadow.alpha < 1 ? { alpha: s.shadow.alpha } : {}) } };
  if (s.wrap) base.wrap = { mode: 'square' };
  if (s.fill?.type === 'solid' && s.fill.alpha != null && s.fill.alpha < 1 && !fill) base.alpha = s.fill.alpha;
  return base;
}

function tableCells(env: Env, s: LShape, paras: QPara[] | undefined): TableItem['rows'] {
  const t = s.table!;
  const grid: TableCell[][] = [];
  for (let r = 0; r < t.rows; r++) { const row: TableCell[] = []; for (let c = 0; c < t.cols; c++) row.push({ text: [{ style: 'Body', runs: [] }] }); grid.push(row); }
  const anchors: { r: number; c: number }[] = [];
  for (const cell of t.cells) {
    const r0 = Math.min(cell.r0, t.rows - 1), c0 = Math.min(cell.c0, t.cols - 1);
    const r1 = Math.min(Math.max(cell.r1, r0), t.rows - 1), c1 = Math.min(Math.max(cell.c1, c0), t.cols - 1);
    anchors.push({ r: r0, c: c0 });
    if (r1 > r0) grid[r0][c0].rowSpan = r1 - r0 + 1;
    if (c1 > c0) grid[r0][c0].colSpan = c1 - c0 + 1;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r !== r0 || c !== c0) grid[r][c].merged = true;
  }
  if (!anchors.length) for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) anchors.push({ r, c });
  if (paras && env.text) {
    const ends = s.textId != null ? env.doc.quill?.cellEnds.get(s.textId) : undefined;
    const perCell: QPara[][] = anchors.map(() => []);
    if (ends?.length) {
      let bytes = 0, ci = 0;
      for (const p of paras) {
        bytes += paraByteLength(p);
        while (ci < ends.length - 1 && bytes > ends[ci]) ci++;
        perCell[Math.min(ci, perCell.length - 1)].push(p);
      }
    } else perCell[0].push(...paras);
    perCell.forEach((ps, i) => { if (ps.length) grid[anchors[i].r][anchors[i].c].text = storyParagraphs(ps, env.text!); });
  }
  const rows: TableItem['rows'] = [];
  for (let r = 0; r < t.rows; r++) rows.push({ h: r2(t.rowHeights[r] / 12700), cells: grid[r] });
  return rows;
}

function convert(env: Env, s: LShape, parent?: { x: number; y: number }): Item | null {
  const box = boxOf(env, s);
  if (!box) return null;
  if (parent) { box.x = r2(box.x - parent.x); box.y = r2(box.y - parent.y); }
  if (s.kind === 'group') {
    const kids = (s.children || []).map((c) => convert(env, c, { x: box.x + (parent?.x || 0), y: box.y + (parent?.y || 0) })).filter((k): k is Item => !!k);
    if (!kids.length) return null;
    const g: GroupItem = { ...common(env, s, box, newId('gr')), kind: 'group', children: kids } as GroupItem;
    delete (g as any).fill; delete (g as any).line;
    return g;
  }
  const paras = s.textId != null ? env.doc.quill?.texts.get(s.textId) : undefined;
  if (s.kind === 'table' && s.table) {
    const t: TableItem = { ...common(env, s, box, newId('tb')), kind: 'table', cols: s.table.colWidths.map((w) => r2(w / 12700)), rows: tableCells(env, s, paras) } as TableItem;
    const line = lineProp(s);
    if (line) { t.border = line; t.innerBorder = { ...line }; }
    delete (t as any).line;
    return t;
  }
  const media = s.picture ? mediaOf(env, s.picture) : undefined;
  if (s.textId != null && !(s.picture && media)) {
    const story = env.stories.get(s.textId) || env.pub.newStory(paras && env.text ? storyParagraphs(paras, env.text) : [{ style: 'Body', runs: [] }]);
    env.stories.set(s.textId, story);
    const f: TextFrame = { ...common(env, s, box, newId('tf')), kind: 'text', story: story.id, insets: s.insets || [4, 4, 4, 4] } as TextFrame;
    if (s.valign === 1) f.anchor = 'ctr'; else if (s.valign === 2) f.anchor = 'b';
    if (s.columns && s.columns > 1) { f.columns = s.columns; if (s.gutter != null) f.gutter = s.gutter; }
    const preset = PRESETS[s.type];
    if (preset && preset !== 'rect' && !LINE_TYPES.has(s.type)) f.geom = preset;
    if (!env.frames.has(s.textId)) env.frames.set(s.textId, []);
    env.frames.get(s.textId)!.push(f);
    return f;
  }
  if (s.picture) {
    const p: PictureFrame = { ...common(env, s, box, newId('pf')), kind: 'picture', fit: 'stretch' } as PictureFrame;
    if (media) p.media = media; else p.src = s.pictureName ? `${s.pictureName} (metafile, not placed)` : `picture ${s.picture} (metafile)`;
    if (media && s.pictureName) p.src = s.pictureName;
    if (s.brightness) p.brightness = s.brightness;
    if (s.contrast) p.contrast = s.contrast;
    if (s.type === 3) p.geom = 'ellipse';
    return p;
  }
  if (LINE_TYPES.has(s.type) && !s.custom) {
    const l: LineItem = { ...common(env, s, box, newId('ln')), kind: 'line' } as LineItem;
    delete (l as any).fill;
    if (!l.line) l.line = { fill: { type: 'solid', color: 'Black' }, width: 0.75 };
    return l;
  }
  const preset = PRESETS[s.type];
  if (!preset && !s.custom) env.counts.unknownShapes++;
  const sh: ShapeItem = { ...common(env, s, box, newId('sh')), kind: 'shape', geom: s.custom ? 'custom' : preset || 'rect' } as ShapeItem;
  if (s.custom) sh.path = [{ d: s.custom.d, w: s.custom.w, h: s.custom.h }];
  if (!sh.fill) sh.fill = { type: 'none' };
  return sh;
}

function placePage(env: Env, pg: LPage, target: { items: Item[] }): void {
  for (const s of pg.shapes) {
    const it = convert(env, s);
    if (it) target.items.push(it);
  }
}

/** Links the frames that show one story, in page order, into a chain. */
function linkChains(env: Env): void {
  for (const frames of env.frames.values()) {
    for (let i = 0; i + 1 < frames.length; i++) { frames[i].next = frames[i + 1].id; frames[i + 1].prev = frames[i].id; }
  }
}

export interface CollectResult { pub: Pub; warnings: string[] }

export function collectPub(doc: LDoc, name: string): CollectResult {
  const size = { w: r2(doc.width / 12700), h: r2(doc.height / 12700) };
  const pub = Pub.blank(size, { pages: 0 });
  const P = pub.data;
  P.props.title = name.replace(/\.[^.]+$/, '');
  P.unit = 'in';
  // Palette → swatches.
  const paletteNames = new Map<number, string>();
  doc.palette.forEach((rgb, i) => {
    const n = `Scheme Color ${i + 1}`;
    paletteNames.set(i, n);
    if (!P.swatches.some((s) => s.name === n)) P.swatches.push({ name: n, color: hex(rgb).toUpperCase() });
  });
  const env: Env = {
    pub, doc, media: new Map(), skippedPictures: new Set(), frames: new Map(), stories: new Map(),
    counts: { unknownShapes: 0, metafiles: 0, emptyBoxes: 0 },
    text: doc.quill ? { quill: doc.quill, palette: doc.palette, paletteNames, dropped: { fields: 0 } } : null,
  };
  // Master pages.
  const masterById = new Map<number, Master>();
  const masters = doc.pages.filter((p) => p.isMaster);
  masters.forEach((mp, i) => {
    const m: Master = { id: newId('mst'), name: `${String.fromCharCode(65 + (i % 26))}-Master`, items: [], margins: [...P.masters[0].margins] as any, columns: 1, gutter: 12, side: 'single' };
    masterById.set(mp.seq, m);
    placePage(env, mp, m);
  });
  if (masters.length) P.masters = [...masterById.values()];
  // Pages.
  for (const lp of doc.pages) {
    if (lp.isMaster) continue;
    const master = (lp.master != null && masterById.get(lp.master)) || P.masters[0];
    const page: Page = { id: newId('pg'), master: master.id, items: [] };
    const bg = fillOf(env, lp.bg);
    if (bg) page.bg = bg;
    placePage(env, lp, page);
    P.pages.push(page);
  }
  if (!P.pages.length) P.pages.push({ id: newId('pg'), master: P.masters[0].id, items: [] });
  linkChains(env);
  pub.pruneStories();
  // Warnings.
  const w: string[] = [...doc.warnings];
  const items = P.pages.reduce((a, p) => a + p.items.length, 0) + P.masters.reduce((a, m) => a + m.items.length, 0);
  w.unshift(`Microsoft Publisher ${doc.version}: ${P.pages.length} page${P.pages.length === 1 ? '' : 's'}${masters.length ? ` and ${masters.length} master page${masters.length === 1 ? '' : 's'}` : ''} with ${items} object${items === 1 ? '' : 's'} and ${P.stories.length} stor${P.stories.length === 1 ? 'y' : 'ies'} were read with their layout.`);
  if (env.counts.metafiles) w.push(`${env.counts.metafiles} picture${env.counts.metafiles === 1 ? ' is a Windows metafile (WMF/EMF) and was' : 's are Windows metafiles (WMF/EMF) and were'} left as empty frames; convert them to PNG and place them again.`);
  if (env.counts.unknownShapes) w.push(`${env.counts.unknownShapes} shape${env.counts.unknownShapes === 1 ? '' : 's'} of a kind QuillPress has no preset for were placed as rectangles.`);
  if (doc.counts.borderArt) w.push(`Decorative borders (Border Art) on ${doc.counts.borderArt} object${doc.counts.borderArt === 1 ? '' : 's'} were not read; plain outlines were kept.`);
  if (doc.counts.calcGeometry) w.push(`${doc.counts.calcGeometry} custom shape${doc.counts.calcGeometry === 1 ? ' uses' : 's use'} computed geometry points; the outline is approximate.`);
  if (doc.embeddedFonts) w.push(`${doc.embeddedFonts} embedded font${doc.embeddedFonts === 1 ? '' : 's'} (EOT) were not installed; the font names were kept.`);
  if (env.text?.dropped.fields) w.push(`${env.text.dropped.fields} field code${env.text.dropped.fields === 1 ? '' : 's'} (page numbers, dates) were dropped from the text.`);
  if (doc.counts.scratch) w.push(`${doc.counts.scratch} object${doc.counts.scratch === 1 ? '' : 's'} on the scratch area outside the pages were skipped.`);
  if (doc.counts.unplaced) w.push(`${doc.counts.unplaced} object${doc.counts.unplaced === 1 ? '' : 's'} belonged to no page and were skipped.`);
  if (!doc.quill) w.push('Text formatting was not available; text was placed with default formatting.');
  return { pub, warnings: w };
}

export { PRESETS as PUB_PRESETS };
export type { Paragraph };
