/**
 * Text flow: lays each story through the chain of its frames (columns, insets, wrap exclusions),
 * caching the result per publication version. Frames on master pages are laid out once per page that
 * shows them, so page-number fields read correctly.
 */
import type { Pub } from '../model/pub';
import type { Item, Page, Master, TextFrame, Paragraph, RunProps, Story } from '../model/types';
import { DEFAULT_FOOTNOTE_OPTIONS } from '../model/types';
import { resolvePara, resolveRun } from '../model/styles';
import { layoutStory, baselineShift, type FlowBox, type LayoutResult, type Rect, type LaidLine, type AnchoredInfo } from './text';
import { fontFamilyCss } from '../fonts';

export interface FrameLayout { frame: TextFrame; lines: LaidLine[]; boxes: FlowBox[]; overset: boolean; separators: { x: number; y: number; w: number }[]; rules: LayoutResult['rules'] }

const cache = new WeakMap<Pub, Map<string, { v: number; r: LayoutResult; boxes: FlowBox[] }>>();
/** Anchor points (on the line) of anchored items, by item id, from the last layout. */
const anchorPoints = new WeakMap<Pub, Map<string, { x: number; y: number }>>();

/** The columns of a text frame, in page coordinates (frame rotation is applied by the renderer). */
export function frameBoxes(frame: TextFrame, owner: { items: Item[] }, pageIndex: number, pub: Pub): FlowBox[] {
  const ins = frame.insets || [4, 4, 4, 4];
  const cols = Math.max(1, frame.columns || 1);
  const gutter = frame.gutter ?? 12;
  const x = frame.x + ins[0], y = frame.y + ins[1];
  const w = Math.max(1, frame.w - ins[0] - ins[2]), h = Math.max(1, frame.h - ins[1] - ins[3]);
  const cw = (w - gutter * (cols - 1)) / cols;
  const excl = frame.ignoreWrap ? [] : wrapExclusions(frame, owner, pub);
  const out: FlowBox[] = [];
  for (let c = 0; c < cols; c++) out.push({ frame: frame.id, col: c, x: x + c * (cw + gutter), y, w: cw, h, excl, page: pageIndex, ...(frame.firstBaseline ? { firstBaseline: frame.firstBaseline } : {}) });
  return out;
}

/** Rectangles that text in `frame` must flow around: objects above it in z-order with a wrap mode. */
export function wrapExclusions(frame: TextFrame, owner: { items: Item[] }, pub: Pub): Rect[] {
  const out: Rect[] = [];
  if (frame.ignoreWrap) return out;
  const all = owner.items;
  const fi = all.findIndex((e) => e.id === frame.id || (e.kind === 'group' && !!pub.findItem({ items: e.children }, frame.id)));
  const page = pub.pageOfItem(frame.id);
  const pw = pub.size.w;
  const walk = (items: Item[], above: boolean) => {
    items.forEach((e, i) => {
      if (!above && i <= fi) return;
      if (e.kind === 'group') { walk(e.children, true); return; }
      const wm = e.wrap?.mode;
      if (!wm || wm === 'none' || wm === 'behind' || e.hidden) return;
      const layer = pub.layer(e.layer);
      if (layer?.hidden) return;
      const off = e.wrap?.offset ?? 6;
      const b = rotatedBounds(e);
      if (wm === 'topBottom') out.push({ x: -1e5, y: b.y - off, w: 2e5 + pw, h: b.h + off * 2 });
      else out.push({ x: b.x - off, y: b.y - off, w: b.w + off * 2, h: b.h + off * 2 });
    });
  };
  walk(all, false);
  // Master items with wrap also apply to page frames.
  if (page) { const m = pub.masterOf(page); if (!page.hideMasterItems) for (const e of m.items) { const wm = e.wrap?.mode; if (wm && wm !== 'none' && wm !== 'behind' && !e.hidden) { const off = e.wrap?.offset ?? 6; const b = rotatedBounds(e); out.push({ x: b.x - off, y: b.y - off, w: b.w + off * 2, h: b.h + off * 2 }); } } }
  return out;
}

export function rotatedBounds(e: Item): Rect {
  if (!e.rot) return { x: e.x, y: e.y, w: e.w, h: e.h };
  const a = (e.rot * Math.PI) / 180;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const hw = Math.abs(Math.cos(a) * e.w / 2) + Math.abs(Math.sin(a) * e.h / 2);
  const hh = Math.abs(Math.sin(a) * e.w / 2) + Math.abs(Math.cos(a) * e.h / 2);
  return { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2 };
}

function fieldText(pub: Pub, field: string, box: FlowBox, varName?: string): string {
  const idx = box.page ?? -1;
  switch (field) {
    case 'pagenum': return idx >= 0 ? pub.pageLabel(idx) : '#';
    case 'pagecount': return String(pub.pages.length);
    case 'nextpage': return idx >= 0 && idx + 1 < pub.pages.length ? pub.pageLabel(idx + 1) : '';
    case 'prevpage': return idx > 0 ? pub.pageLabel(idx - 1) : '';
    case 'date': return new Date().toLocaleDateString();
    case 'time': return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    case 'title': return pub.data.props.title || '';
    case 'section': { const secs = [...pub.data.sections].sort((a, b) => a.start - b.start).filter((s) => s.start <= idx); return secs.pop()?.name || ''; }
    case 'variable': return pub.data.variables.find((v) => v.name === varName)?.value || '';
    default: return '';
  }
}

export function layoutOptions(pub: Pub, boxes: FlowBox[], extra: Partial<Parameters<typeof layoutStory>[1]> = {}) {
  const d = pub.data;
  return {
    boxes,
    resolve: (p: Paragraph) => resolvePara(d, p),
    resolveRun: (base: RunProps, r: RunProps) => resolveRun(d, base, r),
    font: (f: string | undefined) => f || 'Tinos',
    fields: (field: string, box: FlowBox, varName?: string) => fieldText(pub, field, box, varName),
    grid: d.baselineGrid.step > 0 ? { start: d.baselineGrid.start, step: d.baselineGrid.step } : undefined,
    footnoteOptions: d.footnoteOptions || DEFAULT_FOOTNOTE_OPTIONS,
    opticalMarginSize: d.opticalMarginSize || 12,
    ...extra,
  };
}

/** Layout options for one story: its anchored items and footnotes resolve by id. */
export function storyOptions(pub: Pub, story: Story, boxes: FlowBox[], extra: Partial<Parameters<typeof layoutStory>[1]> = {}) {
  const anchored = anchoredItems(pub, story.id);
  return layoutOptions(pub, boxes, {
    anchoredItem: (id: string): AnchoredInfo | undefined => { const e = anchored.get(id); return e && e.anchored ? { w: e.w, h: e.h, mode: e.anchored.mode, dx: e.anchored.dx, dy: e.anchored.dy, align: e.anchored.align, valign: e.anchored.valign } : undefined; },
    footnote: (id: string) => story.footnotes?.find((f) => f.id === id)?.paras,
    opticalMargin: story.opticalMargin,
    ...extra,
  });
}

/** Items anchored to a story, wherever they sit (pages and masters, inside groups too). */
export function anchoredItems(pub: Pub, storyId: string): Map<string, Item> {
  const out = new Map<string, Item>();
  const walk = (items: Item[]) => { for (const e of items) { if (e.anchored?.story === storyId) out.set(e.id, e); if (e.kind === 'group') walk(e.children); } };
  for (const p of pub.pages) walk(p.items);
  for (const m of pub.data.masters) walk(m.items);
  return out;
}

/**
 * Writes the positions the layout computed into the anchored items of a story, and moves an item to
 * the page its line landed on. Returns true when an item with text wrap moved (the wrap exclusions
 * of the next layout pass change).
 */
function applyAnchors(pub: Pub, storyId: string, r: LayoutResult, boxes: FlowBox[]): boolean {
  const items = anchoredItems(pub, storyId);
  if (!items.size) return false;
  let pts = anchorPoints.get(pub);
  if (!pts) { pts = new Map(); anchorPoints.set(pub, pts); }
  let wrapMoved = false;
  const placed = new Set<string>();
  for (const l of r.lines) {
    if (!l.anchors) continue;
    for (const a of l.anchors) {
      const e = items.get(a.id);
      if (!e || placed.has(a.id)) continue;
      placed.add(a.id);
      pts.set(a.id, { x: a.ax, y: a.ay });
      const nx = Math.round(a.x * 100) / 100, ny = Math.round(a.y * 100) / 100;
      const moved = Math.abs(nx - e.x) > 0.01 || Math.abs(ny - e.y) > 0.01;
      if (moved) {
        if (e.kind === 'group') { const dx = nx - e.x, dy = ny - e.y; const walk = (els: Item[]) => { for (const c of els) { c.x += dx; c.y += dy; if (c.kind === 'group') walk(c.children); } }; walk(e.children); }
        e.x = nx; e.y = ny;
        if (e.wrap && e.wrap.mode !== 'none' && e.wrap.mode !== 'behind') wrapMoved = true;
      }
      // The page of the box the line landed on.
      const box = boxes[l.box];
      const pageIdx = box?.page ?? -1;
      if (pageIdx >= 0) {
        const target = pub.pages[pageIdx];
        const from = pub.ownerOfItem(e.id);
        if (target && from && from !== target && from.items.includes(e)) {
          from.items.splice(from.items.indexOf(e), 1);
          const fi = target.items.findIndex((x) => x.id === box.frame);
          target.items.splice(fi >= 0 ? fi + 1 : target.items.length, 0, e);
        }
      }
    }
  }
  return wrapMoved;
}

/** Re-lays every story with anchored objects so their items sit where the text puts them (cached per version). */
export function syncAnchors(pub: Pub): void {
  for (const s of pub.data.stories) if (anchoredItems(pub, s.id).size) storyLayout(pub, s.id);
}

/** Where an anchored item hangs on its line (page coordinates), after the last layout. */
export function anchorPointOf(pub: Pub, id: string): { x: number; y: number } | undefined { return anchorPoints.get(pub)?.get(id); }

/** The boxes of every frame of a story in chain order (page frames with their page index). */
export function storyBoxes(pub: Pub, story: Story): FlowBox[] {
  const chain = pub.chainOf(story.id);
  const boxes: FlowBox[] = [];
  for (const f of chain) {
    const page = pub.pageOfItem(f.id);
    const owner: Page | Master | undefined = page || pub.data.masters.find((m) => !!pub.findItem(m, f.id));
    if (!owner) continue;
    boxes.push(...frameBoxes(f, owner, page ? pub.pageIndex(page.id) : -1, pub));
  }
  return boxes;
}

/** Lays out a story (cached per publication version). */
export function storyLayout(pub: Pub, storyId: string): { r: LayoutResult; boxes: FlowBox[] } | null {
  const story = pub.story(storyId);
  if (!story) return null;
  let m = cache.get(pub);
  if (!m) { m = new Map(); cache.set(pub, m); }
  const hit = m.get(storyId);
  if (hit && hit.v === pub.version) return hit;
  const chain = pub.chainOf(storyId);
  const single = chain.length === 1 && (chain[0].columns || 1) === 1;
  const lay = () => { const boxes = storyBoxes(pub, story); return { boxes, r: layoutStory(story.paras, storyOptions(pub, story, boxes, { anchor: single ? chain[0].anchor : undefined, unbounded: single && chain[0].autosize === 'height' })) }; };
  let { r, boxes } = lay();
  // Anchored objects: write their positions; when one with text wrap moved, lay out once more.
  if (applyAnchors(pub, storyId, r, boxes)) { ({ r, boxes } = lay()); applyAnchors(pub, storyId, r, boxes); }
  if (r.footnoteLabels) for (const p of story.paras) for (const run of p.runs) if (run.footnote && r.footnoteLabels[run.footnote] && run.text !== r.footnoteLabels[run.footnote]) run.text = r.footnoteLabels[run.footnote];
  const entry = { v: pub.version, r, boxes };
  m.set(storyId, entry);
  return entry;
}

/** Lines shown by one frame. */
export function frameLines(pub: Pub, frame: TextFrame): FrameLayout {
  const l = storyLayout(pub, frame.story);
  if (!l) return { frame, lines: [], boxes: [], overset: false, separators: [], rules: [] };
  const idx = new Set(l.boxes.map((b, i) => (b.frame === frame.id ? i : -1)).filter((i) => i >= 0));
  const lines = l.r.lines.filter((ln) => idx.has(ln.box));
  const lastBox = Math.max(...l.boxes.map((b, i) => (b.frame === frame.id ? i : -1)));
  const overset = !!l.r.overset && lastBox === l.boxes.length - 1;
  return { frame, lines, boxes: l.boxes.filter((b) => b.frame === frame.id), overset, separators: l.r.separators.filter((sp) => idx.has(sp.box)), rules: l.r.rules.filter((ru) => idx.has(ru.box)) };
}

/** Frames whose story does not fit (overset text), with the number of characters that did not fit. */
export function oversetFrames(pub: Pub): { frame: TextFrame; chars: number }[] {
  const out: { frame: TextFrame; chars: number }[] = [];
  for (const s of pub.data.stories) {
    const l = storyLayout(pub, s.id);
    if (!l || !l.r.overset) continue;
    const chain = pub.chainOf(s.id);
    const last = chain[chain.length - 1];
    if (!last) continue;
    let chars = 0;
    s.paras.forEach((p, i) => { const t = p.runs.map((r) => (r.br ? '\n' : r.text)).join(''); if (i > l.r.overset!.para) chars += t.length + 1; else if (i === l.r.overset!.para) chars += Math.max(0, t.length - l.r.overset!.off); });
    out.push({ frame: last, chars });
  }
  return out;
}

/**
 * Height the renderer and the PDF writer clip a text frame to: the stored height, or for a frame that
 * grows with its text (autosize 'height', laid out unbounded) the height its laid lines reach.
 */
export function frameClipHeight(f: TextFrame, lines: LaidLine[]): number {
  if (f.autosize !== 'height') return f.h;
  const ins = f.insets || [4, 4, 4, 4];
  let bottom = f.y + f.h - ins[3];
  for (const l of lines) bottom = Math.max(bottom, l.y + Math.max(0, l.height - l.ascent) + Math.max(0, ...l.segs.map((sg) => -baselineShift(sg.style.baseline, sg.size))));
  return Math.max(f.h, bottom - f.y + ins[3]);
}

/** Height the text of a single-column frame needs (for autosize). */
export function neededHeight(pub: Pub, frame: TextFrame): number {
  const story = pub.story(frame.story);
  if (!story) return frame.h;
  const ins = frame.insets || [4, 4, 4, 4];
  const box: FlowBox = { frame: frame.id, col: 0, x: frame.x + ins[0], y: frame.y + ins[1], w: Math.max(1, frame.w - ins[0] - ins[2]), h: 1e6 };
  const r = layoutStory(story.paras, storyOptions(pub, story, [box], { unbounded: true }));
  return Math.max(12, r.used + ins[1] + ins[3]);
}

export const cssFamily = (name: string | undefined) => fontFamilyCss(name || 'Tinos');
