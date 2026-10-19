/**
 * Editing surface for one page (or master page): renders the page, draws selection handles, and
 * handles selection, moving, resizing, rotating, smart guides, snapping to guides and the grid,
 * inserting frames and shapes by dragging, placing pictures, and starting in-place text editing.
 * Touch gestures: drag to move, pinch to zoom, long-press for the context menu.
 */
import type { App } from '../app';
import type { Item, TextFrame } from '../model/types';
import { clone } from '../model/pub';
import { pageSvg, type Owner } from '../render/page';
import { edit, setBox, boxOf, deleteSelection, nudge, isPage, type Box, linkFrames, fitFrameHeight } from './ops';
import { TextEditor, activeTextEditor } from './textEdit';
import { h } from '../ui/dom';
import { keyName } from '../util/keys';
import { toast } from '../ui/dialog';

export type InsertTool =
  | { kind: 'frame'; make: (box: { x: number; y: number; w: number; h: number }) => Item; label: string; line?: boolean; minW?: number; minH?: number }
  | { kind: 'link'; from: TextFrame }
  | { kind: 'guide' };

type Drag =
  | { kind: 'move'; start: { x: number; y: number }; boxes: Map<string, Box>; moved: boolean }
  | { kind: 'resize'; handle: string; start: { x: number; y: number }; id: string; box: Box }
  | { kind: 'rotate'; id: string; box: Box; center: { x: number; y: number } }
  | { kind: 'marquee'; start: { x: number; y: number }; cur: { x: number; y: number }; add: boolean }
  | { kind: 'insert'; start: { x: number; y: number }; cur: { x: number; y: number } }
  | { kind: 'guide'; dir: 'h' | 'v'; pos: number };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class Canvas {
  el: HTMLElement;
  stage: HTMLElement;
  private pageHost: HTMLElement;
  private overlay: HTMLElement;
  private guidesEl: SVGSVGElement;
  selection: string[] = [];
  zoom = 1;
  fit: 'fit' | 'width' | null = 'fit';
  private drag: Drag | null = null;
  private preview: Map<string, Partial<Box>> | null = null;
  editor: TextEditor | null = null;
  tool: InsertTool | null = null;
  private renderedKey = '';
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number } | null = null;
  private longPress: any = null;
  private lastDown: { t: number; x: number; y: number; target: EventTarget | null } | null = null;
  onSelect: (() => void) | null = null;
  /** Bleed padding drawn around the page (points). */
  private pad = 0;

  constructor(public app: App, private ownerFn: () => Owner | undefined) {
    this.pageHost = h('div', { class: 'qp-page-host' });
    this.overlay = h('div', { class: 'qp-edit-overlay' });
    this.guidesEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.guidesEl.setAttribute('class', 'qp-guides');
    this.stage = h('div', { class: 'qp-edit-stage' }, this.pageHost, this.guidesEl as any, this.overlay);
    this.el = h('div', { class: 'qp-canvas', tabindex: '0', 'aria-label': 'Page editing area' }, this.stage);
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', (e) => this.up(e));
    this.el.addEventListener('pointercancel', (e) => this.up(e));
    this.el.addEventListener('dblclick', (e) => this.dbl(e));
    this.el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.contextMenu(e.clientX, e.clientY, e.target); });
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
    this.el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    this.el.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      const p = this.pt(e);
      this.app.exec('insert.pictureFiles', { files, at: p });
    });
  }

  get owner(): Owner | undefined { return this.ownerFn(); }

  // ------------------------------------------------------------------------------------------
  // Rendering

  layout(): void {
    const { w, h: hh } = this.app.pub.size;
    this.pad = this.app.prefs.showGuides ? this.app.pub.data.bleed : 0;
    const W = w + this.pad * 2, H = hh + this.pad * 2;
    if (this.fit) {
      const pw = this.el.clientWidth - 40, ph = this.el.clientHeight - 40;
      if (pw > 20 && ph > 20) this.zoom = this.fit === 'width' ? Math.max(0.05, pw / W) : Math.max(0.05, Math.min(pw / W, ph / H));
    }
    this.stage.style.width = `${W * this.zoom}px`;
    this.stage.style.height = `${H * this.zoom}px`;
    this.pageHost.style.width = this.overlay.style.width = `${W}px`;
    this.pageHost.style.height = this.overlay.style.height = `${H}px`;
    this.pageHost.style.transform = this.overlay.style.transform = `scale(${this.zoom})`;
    this.overlay.style.setProperty('--qp-pad', `${this.pad}px`);
    this.guidesEl.setAttribute('viewBox', `${-this.pad} ${-this.pad} ${W} ${H}`);
    this.renderedKey = '';
    this.render();
  }

  setZoom(z: number | 'fit' | 'width'): void {
    if (z === 'fit' || z === 'width') { this.fit = z; this.layout(); this.app.refresh(); return; }
    this.fit = null;
    this.zoom = Math.max(0.05, Math.min(8, z));
    this.layout();
    this.app.refresh();
  }

  render(): void {
    const o = this.owner;
    if (!o) { this.pageHost.innerHTML = ''; this.overlay.textContent = ''; return; }
    let items: Item[] | undefined;
    if (this.preview) {
      items = clone(o.items);
      for (const [id, b] of this.preview) {
        const e = this.app.pub.findItem({ items }, id);
        if (e) applyBoxShallow(e, boxOf(this.app.pub.findItem(o, id)!), b);
      }
    }
    const hide = new Set<string>();
    if (this.editor) hide.add(this.editor.frame.id);
    const p = this.app.prefs;
    const t = this.app.tab;
    const preview = t.view === 'preview';
    const key = `${this.app.pub.version}:${o.id}:${JSON.stringify([...(this.preview || [])])}:${[...hide]}:${p.showGrid}:${p.showGuides}:${p.showBaselineGrid}:${p.showFrameEdges}:${t.view}:${t.colorMode}:${this.pad}:${p.showTextThreads && this.selection.join()}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      const sel = this.selection.map((id) => this.app.pub.findItem(o, id)).find((e) => e?.kind === 'text') as TextFrame | undefined;
      this.pageHost.innerHTML = pageSvg(this.app.pub, o, {
        mode: preview ? 'print' : 'edit', ids: true, hide, items, bleed: this.pad > 0, guides: p.showGuides && !preview, grid: p.showGrid && !preview ? p.gridSize : 0,
        baselineGrid: p.showBaselineGrid && !preview, frameEdges: p.showFrameEdges && !preview, grayscale: t.colorMode === 'grayscale', threads: p.showTextThreads && sel ? sel.story : null,
      });
      const svg = this.pageHost.firstElementChild as SVGElement | null;
      if (svg) { svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); }
    }
    this.drawSelection(o);
  }

  invalidate(): void { this.renderedKey = ''; this.render(); }

  private drawSelection(o: Owner): void {
    for (const c of [...this.overlay.children]) if (!c.classList.contains('qp-textedit')) c.remove();
    this.selection = this.selection.filter((id) => o.items.some((e) => e.id === id));
    const single = this.selection.length === 1;
    for (const id of this.selection) {
      const e = o.items.find((x) => x.id === id)!;
      const b = boxOf(e);
      const frame = h('div', { class: 'qp-sel' + (this.editor?.frame.id === id ? ' qp-sel-editing' : '') + (e.locked ? ' qp-sel-locked' : ''), 'data-sel': id });
      Object.assign(frame.style, { left: `${b.x + this.pad}px`, top: `${b.y + this.pad}px`, width: `${b.w}px`, height: `${b.h}px`, transform: b.rot ? `rotate(${b.rot}deg)` : '' });
      frame.style.setProperty('--qp-inv', String(1 / this.zoom));
      if (single && !e.locked && !this.editor) {
        const isLine = e.kind === 'line';
        for (const hd of isLine ? ['nw', 'se'] : HANDLES) frame.appendChild(h('div', { class: `qp-handle qp-h-${hd}`, 'data-handle': hd }));
        if (!isLine) frame.appendChild(h('div', { class: 'qp-handle qp-rot', 'data-handle': 'rot', title: 'Rotate' }));
        if (e.kind === 'text') {
          frame.appendChild(h('div', { class: 'qp-port qp-port-in' + (e.prev ? ' qp-port-linked' : ''), title: e.prev ? 'Linked from the previous frame' : 'Start of the story' }));
          frame.appendChild(h('div', { class: 'qp-port qp-port-out' + (e.next ? ' qp-port-linked' : ''), 'data-handle': 'link', title: e.next ? 'Linked to the next frame' : 'Drag to another frame to link the text' }));
        }
      }
      this.overlay.appendChild(frame);
    }
    this.onSelect?.();
  }

  select(ids: string[]): void {
    if (this.editor && !ids.includes(this.editor.frame.id)) this.commitText();
    this.selection = [...new Set(ids)];
    this.render();
    this.app.refresh();
  }

  // ------------------------------------------------------------------------------------------
  // Pointer

  /** Page coordinates of a client point. */
  pt(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom - this.pad, y: (e.clientY - r.top) / this.zoom - this.pad };
  }

  private hit(target: EventTarget | null, p?: { x: number; y: number }): Item | undefined {
    const o = this.owner;
    if (!o) return undefined;
    let n = target as HTMLElement | null;
    const frame = n?.closest?.('[data-sel]') as HTMLElement | null;
    if (frame) return o.items.find((e) => e.id === frame.dataset.sel);
    while (n && n !== this.el) {
      const id = n.getAttribute?.('data-id');
      if (id) {
        const top = o.items.find((e) => e.id === id) || o.items.find((e) => e.kind === 'group' && !!this.app.pub.findItem({ items: e.children }, id));
        if (top && !lockedLayer(this.app, top)) return top;
      }
      n = n.parentElement || (n.parentNode as HTMLElement | null);
    }
    if (p) for (let i = o.items.length - 1; i >= 0; i--) {
      const e = o.items[i];
      if (lockedLayer(this.app, e) || e.hidden) continue;
      if (p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h && (e.kind === 'text' || e.kind === 'picture')) return e;
    }
    return undefined;
  }

  private down(e: PointerEvent): void {
    if (this.editor && this.editor.root.contains(e.target as Node)) return;
    // The selection overlay is rebuilt between the two clicks of a double-click, so the browser never
    // fires dblclick for it: detect the second press here.
    const last = this.lastDown;
    this.lastDown = { t: e.timeStamp, x: e.clientX, y: e.clientY, target: e.target };
    if (last && e.button === 0 && e.timeStamp - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) {
      this.lastDown = null;
      this.pointers.clear(); this.drag = null; this.preview = null;
      this.dbl(e);
      return;
    }
    this.el.focus({ preventScroll: true });
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      this.drag = null; this.preview = null;
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.pt(e);
    const o = this.owner;
    if (!o) return;
    if (this.app.tab.view === 'preview') return;
    if (this.editor) this.commitText();
    if (this.tool?.kind === 'frame') { this.drag = { kind: 'insert', start: p, cur: p }; this.el.setPointerCapture(e.pointerId); return; }
    if (this.tool?.kind === 'guide') {
      const { w, h: hh } = this.app.pub.size;
      const dir = Math.min(p.y, hh - p.y) < Math.min(p.x, w - p.x) ? 'h' : 'v';
      this.drag = { kind: 'guide', dir, pos: dir === 'h' ? p.y : p.x }; this.el.setPointerCapture(e.pointerId); return;
    }
    if (this.tool?.kind === 'link') {
      const hit = this.hit(e.target, p);
      if (hit?.kind === 'text') { linkFrames(this.app, this.tool.from, hit); this.setTool(null); this.select([hit.id]); } else { toast('Click a text frame to link the text into it.'); }
      return;
    }
    const handle = (e.target as HTMLElement).dataset?.handle;
    if (handle === 'link' && this.selection.length === 1) {
      const el = o.items.find((x) => x.id === this.selection[0]);
      if (el?.kind === 'text') { this.setTool({ kind: 'link', from: el }); toast('Click the text frame the story should continue in (Esc cancels).'); }
      return;
    }
    if (handle && this.selection.length === 1) {
      const el = o.items.find((x) => x.id === this.selection[0])!;
      const box = boxOf(el);
      if (handle === 'rot') this.drag = { kind: 'rotate', id: el.id, box, center: { x: box.x + box.w / 2, y: box.y + box.h / 2 } };
      else this.drag = { kind: 'resize', handle, start: p, id: el.id, box };
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    const hit = this.hit(e.target, p);
    if (hit) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) this.select(this.selection.includes(hit.id) ? this.selection.filter((x) => x !== hit.id) : [...this.selection, hit.id]);
      else if (!this.selection.includes(hit.id)) this.select([hit.id]);
      const boxes = new Map<string, Box>();
      for (const id of this.selection) { const x = o.items.find((q) => q.id === id); if (x && !x.locked) boxes.set(id, boxOf(x)); }
      this.drag = { kind: 'move', start: p, boxes, moved: false };
      if (e.pointerType === 'touch') this.longPress = setTimeout(() => { this.drag = null; this.contextMenu(e.clientX, e.clientY, e.target as any); }, 600);
    } else {
      if (!e.shiftKey) this.select([]);
      this.drag = { kind: 'marquee', start: p, cur: p, add: e.shiftKey };
      if (e.pointerType === 'touch') this.longPress = setTimeout(() => { this.drag = null; this.contextMenu(e.clientX, e.clientY, e.target as any); }, 600);
    }
    this.el.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.setZoom(this.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.d));
      return;
    }
    const d = this.drag;
    if (!d) return;
    const p = this.pt(e);
    if (this.longPress && (d.kind === 'move' || d.kind === 'marquee') && Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.zoom > 6) { clearTimeout(this.longPress); this.longPress = null; }
    const prefs = this.app.prefs;
    const snapG = (v: number) => (prefs.snapToGrid && !e.altKey ? Math.round(v / prefs.gridSize) * prefs.gridSize : v);
    if (d.kind === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
      d.moved = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const first = [...d.boxes.values()][0];
      const guides: string[] = [];
      if (first && (prefs.smartGuides || prefs.snapToGuides) && !e.altKey) {
        const g = this.smartSnap({ ...first, x: first.x + dx, y: first.y + dy }, new Set(d.boxes.keys()));
        dx += g.dx; dy += g.dy; guides.push(...g.lines);
      } else if (first && prefs.snapToGrid && !e.altKey) { dx = snapG(first.x + dx) - first.x; dy = snapG(first.y + dy) - first.y; }
      this.preview = new Map([...d.boxes].map(([id, b]) => [id, { x: b.x + dx, y: b.y + dy }]));
      this.showGuides(guides);
      this.render();
    } else if (d.kind === 'resize') {
      const b = d.box;
      const rad = (-(b.rot || 0) * Math.PI) / 180;
      const vx = p.x - d.start.x, vy = p.y - d.start.y;
      const dx = vx * Math.cos(rad) - vy * Math.sin(rad), dy = vx * Math.sin(rad) + vy * Math.cos(rad);
      let { x, y, w, h: hh } = b;
      const hd = d.handle;
      if (hd.includes('e')) w = b.w + dx;
      if (hd.includes('s')) hh = b.h + dy;
      if (hd.includes('w')) { w = b.w - dx; x = b.x + dx; }
      if (hd.includes('n')) { hh = b.h - dy; y = b.y + dy; }
      const el = this.owner?.items.find((q) => q.id === d.id);
      const keepRatio = e.shiftKey || (el?.kind === 'picture' && !!el.media && !e.altKey && hd.length === 2);
      if (keepRatio && b.w && b.h && hd.length === 2) {
        const r = b.w / b.h;
        if (Math.abs(w / r) > Math.abs(hh)) hh = w / r; else w = hh * r;
        if (hd.includes('w')) x = b.x + b.w - w;
        if (hd.includes('n')) y = b.y + b.h - hh;
      }
      if (e.ctrlKey) { x = b.x - (w - b.w) / 2; y = b.y - (hh - b.h) / 2; }
      const isLine = el?.kind === 'line';
      if (!isLine) { if (w < 1) w = 1; if (hh < 1) hh = 1; }
      if (!isLine && !b.rot && !keepRatio && prefs.snapToGrid && !e.altKey) {
        if (hd.includes('w')) { const nx = snapG(x); w += x - nx; x = nx; }
        if (hd.includes('e')) w = Math.max(1, snapG(x + w) - x);
        if (hd.includes('n')) { const ny = snapG(y); hh += y - ny; y = ny; }
        if (hd.includes('s')) hh = Math.max(1, snapG(y + hh) - y);
      }
      this.preview = new Map([[d.id, { x, y, w, h: hh }]]);
      this.render();
    } else if (d.kind === 'rotate') {
      let ang = (Math.atan2(p.y - d.center.y, p.x - d.center.x) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      this.preview = new Map([[d.id, { rot: ((ang % 360) + 360) % 360 }]]);
      this.render();
    } else if (d.kind === 'marquee' || d.kind === 'insert') {
      d.cur = p;
      const x = Math.min(d.start.x, p.x), y = Math.min(d.start.y, p.y), w = Math.abs(p.x - d.start.x), hh = Math.abs(p.y - d.start.y);
      this.guidesEl.innerHTML = `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="rgba(91,60,158,0.08)" stroke="#5b3c9e" stroke-width="${1 / this.zoom}" stroke-dasharray="${4 / this.zoom}"/>`;
    } else if (d.kind === 'guide') {
      d.pos = d.dir === 'h' ? p.y : p.x;
      const { w, h: hh } = this.app.pub.size;
      this.guidesEl.innerHTML = d.dir === 'h' ? `<path d="M${-this.pad} ${d.pos} H${w + this.pad}" stroke="#00b8d9" stroke-width="${1 / this.zoom}"/>` : `<path d="M${d.pos} ${-this.pad} V${hh + this.pad}" stroke="#00b8d9" stroke-width="${1 / this.zoom}"/>`;
    }
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    clearTimeout(this.longPress); this.longPress = null;
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const o = this.owner;
    if (!o) return;
    if ((d.kind === 'move' || d.kind === 'resize' || d.kind === 'rotate') && this.preview) {
      const pv = this.preview;
      this.preview = null;
      this.showGuides([]);
      edit(this.app, d.kind === 'move' ? 'Move' : d.kind === 'resize' ? 'Resize' : 'Rotate', (own) => {
        for (const [id, b] of pv) { const el = own.items.find((q) => q.id === id); if (el) setBox(el, b); }
      });
      return;
    }
    if (d.kind === 'move' || d.kind === 'resize' || d.kind === 'rotate') { this.preview = null; this.showGuides([]); this.render(); return; }
    if (d.kind === 'marquee') {
      this.guidesEl.innerHTML = '';
      const x1 = Math.min(d.start.x, d.cur.x), y1 = Math.min(d.start.y, d.cur.y), x2 = Math.max(d.start.x, d.cur.x), y2 = Math.max(d.start.y, d.cur.y);
      if (x2 - x1 < 2 && y2 - y1 < 2) return;
      const ids = o.items.filter((el) => !el.hidden && !lockedLayer(this.app, el) && el.x >= x1 && el.y >= y1 && el.x + el.w <= x2 && el.y + el.h <= y2).map((el) => el.id);
      this.select(d.add ? [...this.selection, ...ids] : ids);
      return;
    }
    if (d.kind === 'insert' && this.tool?.kind === 'frame') {
      this.guidesEl.innerHTML = '';
      const t = this.tool;
      let x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y), w = Math.abs(d.cur.x - d.start.x), hh = Math.abs(d.cur.y - d.start.y);
      let flipV = false;
      if (t.line) { flipV = (d.cur.x < d.start.x) !== (d.cur.y < d.start.y); }
      if (w < 4 && hh < 4) { w = t.minW ?? (t.line ? 200 : 216); hh = t.minH ?? (t.line ? 0 : 120); x = d.start.x - w / 2; y = d.start.y - hh / 2; }
      const el = t.make({ x, y, w, h: hh });
      if (flipV) el.flipV = true;
      this.tool = null;
      this.el.classList.remove('qp-tool-active');
      edit(this.app, `Insert ${t.label}`, (own) => { own.items.push(el); });
      this.select([el.id]);
      if (el.kind === 'text') this.editText(el.id);
      return;
    }
    if (d.kind === 'guide') {
      this.guidesEl.innerHTML = '';
      const pos = Math.round(d.pos * 100) / 100;
      this.setTool(null);
      edit(this.app, 'Add Guide', (own) => { (own.guides ||= []).push({ dir: d.dir, pos }); });
    }
  }

  private smartSnap(b: Box, skip: Set<string>): { dx: number; dy: number; lines: string[] } {
    const o = this.owner!;
    const pub = this.app.pub;
    const { w: SW, h: SH } = pub.size;
    const tol = 5 / this.zoom;
    const xs: number[] = [0, SW / 2, SW], ys: number[] = [0, SH / 2, SH];
    const prefs = this.app.prefs;
    if (prefs.snapToGuides) {
      const g = isPage(o) ? pub.geometry(o) : { margins: o.margins, columns: o.columns, gutter: o.gutter };
      let [mt, mr, mb, ml] = g.margins;
      if (isPage(o) && pub.pageSide(pub.pageIndex(o.id)) === 'left') [ml, mr] = [mr, ml];
      xs.push(ml, SW - mr); ys.push(mt, SH - mb);
      const cols = Math.max(1, g.columns);
      if (cols > 1) { const cw = (SW - ml - mr - g.gutter * (cols - 1)) / cols; for (let c = 1; c < cols; c++) { xs.push(ml + c * cw + (c - 1) * g.gutter, ml + c * (cw + g.gutter)); } }
      for (const gd of [...(isPage(o) ? pub.masterOf(o).guides || [] : []), ...(o.guides || [])]) (gd.dir === 'h' ? ys : xs).push(gd.pos);
    }
    if (prefs.smartGuides) for (const e of o.items) {
      if (skip.has(e.id) || e.hidden) continue;
      xs.push(e.x, e.x + e.w / 2, e.x + e.w); ys.push(e.y, e.y + e.h / 2, e.y + e.h);
    }
    let dx = 0, dy = 0, bestX = tol, bestY = tol, gx: number | null = null, gy: number | null = null;
    for (const mine of [b.x, b.x + b.w / 2, b.x + b.w]) for (const t of xs) { const dd = t - mine; if (Math.abs(dd) < bestX) { bestX = Math.abs(dd); dx = dd; gx = t; } }
    for (const mine of [b.y, b.y + b.h / 2, b.y + b.h]) for (const t of ys) { const dd = t - mine; if (Math.abs(dd) < bestY) { bestY = Math.abs(dd); dy = dd; gy = t; } }
    const lines: string[] = [];
    if (gx != null) lines.push(`M${gx} ${-this.pad} V${SH + this.pad}`);
    if (gy != null) lines.push(`M${-this.pad} ${gy} H${SW + this.pad}`);
    return { dx, dy, lines };
  }

  private showGuides(lines: string[]): void {
    this.guidesEl.innerHTML = lines.length ? `<path d="${lines.join(' ')}" stroke="#e8710a" stroke-width="${1 / this.zoom}" stroke-dasharray="${4 / this.zoom} ${3 / this.zoom}" fill="none"/>` : '';
  }

  private dbl(e: MouseEvent): void {
    if (this.editor && this.editor.root.contains(e.target as Node)) return;
    const hit = this.hit(e.target, this.pt(e));
    if (!hit) return;
    if (hit.kind === 'text') this.editText(hit.id);
    else if (hit.kind === 'table') this.app.exec('table.editCells');
    else if (hit.kind === 'picture') this.app.exec(hit.media ? 'picture.fitting' : 'picture.place');
    else if (hit.kind === 'group') this.app.exec('arrange.ungroup');
    else if (hit.kind === 'shape') this.app.exec('shape.convertToText');
  }

  // ------------------------------------------------------------------------------------------
  // Text editing

  editText(id: string, selectAll = false): void {
    const o = this.owner;
    if (!o) return;
    const el = o.items.find((e) => e.id === id);
    if (!el || el.kind !== 'text' || this.app.isReadOnly()) return;
    const story = this.app.pub.story(el.story);
    if (!story) return;
    if (this.editor) this.commitText();
    const b = boxOf(el);
    this.selection = [id];
    this.editor = new TextEditor(this.app, el, story, this.overlay, { ...b, x: b.x + this.pad, y: b.y + this.pad }, selectAll);
    this.editor.onDone = (commit) => { if (commit) this.commitText(); else this.cancelText(); this.el.focus(); };
    this.renderedKey = '';
    this.render();
    this.app.refresh();
  }

  get editingText(): boolean { return !!this.editor; }

  commitText(): void {
    const ed = this.editor;
    if (!ed) return;
    this.editor = null;
    const paras = ed.read();
    ed.destroy();
    const pub = this.app.pub;
    const story = pub.story(ed.story.id);
    const before = JSON.stringify(story?.paras || []);
    if (story && JSON.stringify(paras) !== before) {
      const frames = pub.chainOf(story.id);
      const pages = [...new Set(frames.map((f) => pub.pageOfItem(f.id)?.id).filter(Boolean))] as string[];
      pub.transact('Typing', () => {
        const s = pub.story(story.id);
        if (s) s.paras = paras;
        for (const f of frames) if (f.autosize === 'height') fitFrameHeight(this.app, f);
      }, pages.length && !this.app.tab.masterTarget ? pages : undefined);
    } else { this.renderedKey = ''; this.render(); }
    this.app.refresh();
  }

  cancelText(): void {
    const ed = this.editor;
    if (!ed) return;
    this.editor = null;
    ed.destroy();
    this.renderedKey = '';
    this.render();
  }

  // ------------------------------------------------------------------------------------------
  // Keyboard

  private key(e: KeyboardEvent): void {
    if (this.editor) return;
    const app = this.app;
    const k = e.key;
    if (k === 'Escape') { if (this.tool) { this.setTool(null); return; } if (this.selection.length) { this.select([]); return; } }
    if (this.selection.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const step = e.shiftKey ? 10 : 1;
      if (k === 'ArrowLeft') { e.preventDefault(); nudge(app, -step, 0); return; }
      if (k === 'ArrowRight') { e.preventDefault(); nudge(app, step, 0); return; }
      if (k === 'ArrowUp') { e.preventDefault(); nudge(app, 0, -step); return; }
      if (k === 'ArrowDown') { e.preventDefault(); nudge(app, 0, step); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelection(app); return; }
      if (k === 'Enter' || k === 'F2') { e.preventDefault(); const el = app.selected[0]; if (el?.kind === 'text') this.editText(el.id, true); return; }
      if (k === 'Tab') { e.preventDefault(); this.cycle(e.shiftKey ? -1 : 1); return; }
      if (k.length === 1 && this.selection.length === 1 && !/\s/.test(k)) {
        const el = app.selected[0];
        if (el?.kind === 'text') { e.preventDefault(); this.editText(el.id); requestAnimationFrame(() => document.execCommand('insertText', false, k)); return; }
      }
    } else if (!this.selection.length && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (k === 'Tab') { e.preventDefault(); this.cycle(e.shiftKey ? -1 : 1); return; }
      if (k === 'PageDown') { e.preventDefault(); app.exec('page.next'); return; }
      if (k === 'PageUp') { e.preventDefault(); app.exec('page.prev'); return; }
      if (k === 'Home') { e.preventDefault(); app.exec('page.first'); return; }
      if (k === 'End') { e.preventDefault(); app.exec('page.last'); return; }
    }
    const kn = keyName(e);
    if (kn && app.handleKey(kn)) e.preventDefault();
  }

  private cycle(dir: number): void {
    const o = this.owner;
    if (!o || !o.items.length) return;
    const i = this.selection.length ? o.items.findIndex((e) => e.id === this.selection[0]) : -1;
    const n = o.items.length;
    this.select([o.items[(i + dir + n) % n].id]);
  }

  setTool(t: InsertTool | null): void {
    this.tool = t;
    this.el.classList.toggle('qp-tool-active', !!t);
    this.el.classList.toggle('qp-tool-link', t?.kind === 'link');
    if (t && t.kind !== 'link') this.select([]);
    this.app.refresh();
  }

  private contextMenu(x: number, y: number, target: EventTarget | null): void {
    const hit = this.hit(target, this.pt({ clientX: x, clientY: y }));
    if (hit && !this.selection.includes(hit.id)) this.select([hit.id]);
    if (!hit) this.select([]);
    this.app.ui.canvasContextMenu(x, y, hit);
  }

  focus(): void { if (this.editor) this.editor.root.focus(); else this.el.focus({ preventScroll: true }); }
  destroy(): void { this.editor?.destroy(); this.el.remove(); }
}

function lockedLayer(app: App, e: Item): boolean {
  const l = app.pub.layer(e.layer);
  return !!(l?.locked || l?.hidden);
}

function applyBoxShallow(e: Item, cur: Box, b: Partial<Box>): void {
  const nb = { ...cur, ...b };
  if (e.kind === 'group') {
    const sx = cur.w ? nb.w / cur.w : 1, sy = cur.h ? nb.h / cur.h : 1;
    const walk = (els: Item[]) => { for (const c of els) { c.x = nb.x + (c.x - cur.x) * sx; c.y = nb.y + (c.y - cur.y) * sy; c.w = c.w * sx; c.h = c.h * sy; if (c.kind === 'group') walk(c.children); } };
    walk(e.children);
  }
  e.x = nb.x; e.y = nb.y; e.w = nb.w; e.h = nb.h; e.rot = nb.rot;
}

// ops imports canvas indirectly through textEdit; the autosize helper is loaded lazily to avoid a cycle at module init.

export { activeTextEditor, boxOf };
