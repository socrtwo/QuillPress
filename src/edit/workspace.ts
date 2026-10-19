/**
 * The views of one publication tab: the Pages rail (page thumbnails with drag-to-reorder and the
 * master pages), the page canvas (single page or the facing spread) with rulers, and the preview mode.
 */
import type { App, PubTab, TabView } from '../app';
import type { Page, Master } from '../model/types';
import { pageSvg, pageTitle } from '../render/page';
import { Canvas } from './canvas';
import { h, clear, icon } from '../ui/dom';
import { showMenu } from '../ui/dialog';
import { UNITS } from '../model/types';

export class Workspace implements TabView {
  el: HTMLElement;
  canvas: Canvas;
  setTool(t: any): void { this.canvas.setTool(t); }
  /** The second page of a spread (read-only companion canvas). */
  spreadCanvas: Canvas;
  private rail: HTMLElement;
  private center: HTMLElement;
  private rulerH: HTMLCanvasElement;
  private rulerV: HTMLCanvasElement;
  private spreadWrap: HTMLElement;
  private thumbCache = new Map<string, { key: string; svg: string }>();
  private railKey = '';
  private dragId: string | null = null;

  constructor(public app: App, public tab: PubTab) {
    this.canvas = new Canvas(app, () => this.ownerNow());
    this.spreadCanvas = new Canvas(app, () => this.spreadOwner());
    this.spreadCanvas.el.classList.add('qp-canvas-spread');
    this.rail = h('nav', { class: 'qp-pages-rail', 'aria-label': 'Pages', tabindex: '0' });
    this.rulerH = h('canvas', { class: 'qp-ruler qp-ruler-h' }) as HTMLCanvasElement;
    this.rulerV = h('canvas', { class: 'qp-ruler qp-ruler-v' }) as HTMLCanvasElement;
    this.spreadWrap = h('div', { class: 'qp-spread' }, this.canvas.el, this.spreadCanvas.el);
    this.center = h('div', { class: 'qp-center' }, this.rulerH, h('div', { class: 'qp-center-row' }, this.rulerV, this.spreadWrap));
    this.el = h('div', { class: 'qp-workspace' }, this.rail, this.center);
    this.rail.addEventListener('keydown', (e) => this.railKeys(e));
    new ResizeObserver(() => { this.canvas.layout(); this.spreadCanvas.layout(); this.drawRulers(); }).observe(this.spreadWrap);
    this.canvas.el.addEventListener('scroll', () => this.drawRulers());
  }

  private ownerNow(): Page | Master | undefined {
    const t = this.tab;
    if (t.masterTarget) return t.pub.data.masters.find((m) => m.id === t.masterTarget) || t.pub.data.masters[0];
    return t.pub.page(t.current) || t.pub.pages[0];
  }

  /** In spread view: the page facing the current one. */
  private spreadOwner(): Page | undefined {
    const t = this.tab;
    if (t.view !== 'spread' || t.masterTarget || !t.pub.data.facing) return undefined;
    const i = t.pub.pageIndex(t.current);
    if (i < 0) return undefined;
    const side = t.pub.pageSide(i);
    const j = side === 'right' ? i - 1 : i + 1;
    return t.pub.pages[j];
  }

  // TabView
  get selection(): string[] { return this.canvas.selection; }
  set selection(v: string[]) { this.canvas.selection = v; }
  get editingText(): boolean { return this.canvas.editingText; }
  get editing(): string | null { return this.canvas.editor?.frame.id || null; }
  get zoom(): number { return this.canvas.zoom; }
  commitText(): void { this.canvas.commitText(); }
  select(ids: string[]): void { this.canvas.select(ids); }
  editText(id: string, selectAll?: boolean): void { this.canvas.editText(id, selectAll); }
  setZoom(z: number | 'fit' | 'width'): void { this.canvas.setZoom(z); this.spreadCanvas.fit = null; this.spreadCanvas.zoom = this.canvas.zoom; this.spreadCanvas.layout(); this.drawRulers(); }
  showPage(id: string): void { const el = this.rail.querySelector<HTMLElement>(`[data-page="${id}"]`); el?.scrollIntoView({ block: 'nearest' }); }
  focus(): void { this.canvas.focus(); }
  destroy(): void { this.canvas.destroy(); this.spreadCanvas.destroy(); this.el.remove(); }

  layout(): void {
    const t = this.tab;
    const p = this.app.prefs;
    this.el.dataset.view = t.view;
    this.rail.style.display = p.showPagesPane && t.view !== 'preview' ? '' : 'none';
    const spread = t.view === 'spread' && t.pub.data.facing && !t.masterTarget && !!this.spreadOwner();
    this.spreadCanvas.el.style.display = spread ? '' : 'none';
    this.spreadWrap.classList.toggle('qp-spread-on', spread);
    const i = t.pub.pageIndex(t.current);
    const curIsRight = t.pub.pageSide(i) === 'right';
    this.spreadWrap.style.flexDirection = spread && curIsRight ? 'row-reverse' : 'row';
    this.rulerH.style.display = this.rulerV.style.display = p.showRulers && t.view !== 'preview' ? '' : 'none';
    this.railKey = '';
    this.invalidate();
    requestAnimationFrame(() => { this.canvas.layout(); if (spread) { this.spreadCanvas.fit = null; this.spreadCanvas.zoom = this.canvas.zoom; this.spreadCanvas.layout(); } this.drawRulers(); });
  }

  invalidate(): void {
    this.canvas.invalidate();
    if (this.spreadCanvas.el.style.display !== 'none') this.spreadCanvas.invalidate();
    this.renderRail();
    this.drawRulers();
  }

  // ------------------------------------------------------------------------------------------
  // Rulers

  private drawRulers(): void {
    if (this.rulerH.style.display === 'none') return;
    const z = this.canvas.zoom;
    const unit = UNITS[this.tab.pub.data.unit] || UNITS.in;
    const stage = this.canvas.stage.getBoundingClientRect();
    const wrap = this.spreadWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const draw = (c: HTMLCanvasElement, horizontal: boolean) => {
      const W = horizontal ? wrap.width : 20, H = horizontal ? 20 : wrap.height;
      if (!W || !H) return;
      c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = getComputedStyle(c).getPropertyValue('--surface2') || '#f6f7f9';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#9aa0a6'; ctx.fillStyle = '#5b6475'; ctx.font = '9px system-ui, sans-serif'; ctx.lineWidth = 1;
      const origin = (horizontal ? stage.left - wrap.left : stage.top - wrap.top) + this.canvasPad() * z;
      const step = unit.pt * (unit.label === 'mm' ? 10 : unit.label === 'pt' ? 36 : unit.label === 'px' ? 50 : unit.label === 'cm' ? 1 : 1);
      const px = step * z;
      const minor = px > 60 ? 4 : px > 30 ? 2 : 1;
      const len = horizontal ? W : H;
      for (let k = Math.floor(-origin / px) - 1; k * px + origin < len; k++) {
        const pos = origin + k * px;
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(pos + 0.5, 20); ctx.lineTo(pos + 0.5, 8); } else { ctx.moveTo(20, pos + 0.5); ctx.lineTo(8, pos + 0.5); }
        ctx.stroke();
        const label = unit.label === 'mm' ? String(k * 10) : unit.label === 'pt' ? String(k * 36) : unit.label === 'px' ? String(k * 50) : String(k);
        if (horizontal) ctx.fillText(label, pos + 2, 8); else { ctx.save(); ctx.translate(8, pos + 2); ctx.rotate(-Math.PI / 2); ctx.fillText(label, -ctx.measureText(label).width, 0); ctx.restore(); }
        for (let m = 1; m < minor; m++) { const mp = pos + (px * m) / minor; ctx.beginPath(); if (horizontal) { ctx.moveTo(mp + 0.5, 20); ctx.lineTo(mp + 0.5, 15); } else { ctx.moveTo(20, mp + 0.5); ctx.lineTo(15, mp + 0.5); } ctx.stroke(); }
      }
    };
    draw(this.rulerH, true);
    draw(this.rulerV, false);
  }

  private canvasPad(): number { return this.app.prefs.showGuides ? this.tab.pub.data.bleed : 0; }

  // ------------------------------------------------------------------------------------------
  // Pages rail

  thumb(owner: Page | Master, index: number): string {
    const pub = this.tab.pub;
    const key = `${pub.version}:${owner.id}:${index}`;
    const hit = this.thumbCache.get(owner.id);
    if (hit && hit.key === key) return hit.svg;
    const svg = pageSvg(pub, owner, { mode: 'thumb', pageIndex: 'master' in owner ? index : -1 });
    this.thumbCache.set(owner.id, { key, svg });
    if (this.thumbCache.size > 400) this.thumbCache.clear();
    return svg;
  }

  renderRail(): void {
    const t = this.tab;
    const pub = t.pub;
    const key = JSON.stringify([pub.version, t.current, t.pageSel, t.masterTarget, pub.pages.length, pub.data.facing]);
    if (key === this.railKey) return;
    this.railKey = key;
    clear(this.rail);
    this.rail.appendChild(h('div', { class: 'qp-rail-head' }, icon('auto_stories'), ' Pages'));
    const grid = h('div', { class: 'qp-rail-pages' + (pub.data.facing ? ' qp-facing' : '') });
    pub.pages.forEach((p, i) => {
      const side = pub.pageSide(i);
      const el = h('div', { class: 'qp-thumb' + (p.id === t.current && !t.masterTarget ? ' qp-current' : '') + (t.pageSel.includes(p.id) ? ' qp-selected' : '') + (side === 'left' ? ' qp-left' : side === 'right' ? ' qp-right' : ''), 'data-page': p.id, draggable: 'true', title: pageTitle(pub, p) || `Page ${pub.pageLabel(i)}` },
        h('div', { class: 'qp-thumb-img', html: this.thumb(p, i) }),
        h('div', { class: 'qp-thumb-num' }, pub.pageLabel(i) || String(i + 1), pub.masterOf(p).name[0] ? h('span', { class: 'qp-thumb-master' }, pub.masterOf(p).name.split('-')[0]) : null));
      el.addEventListener('click', (e) => this.app.goToPage(p.id, { extend: e.shiftKey, toggle: e.ctrlKey || e.metaKey }));
      el.addEventListener('dblclick', () => { this.app.goToPage(p.id); this.canvas.setZoom('fit'); });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!t.pageSel.includes(p.id)) this.app.goToPage(p.id); this.app.ui.pageContextMenu(e.clientX, e.clientY); });
      el.addEventListener('dragstart', (e) => { this.dragId = p.id; e.dataTransfer?.setData('text/plain', p.id); });
      el.addEventListener('dragover', (e) => { if (!this.dragId) return; e.preventDefault(); const r = el.getBoundingClientRect(); el.classList.toggle('qp-drop-before', e.clientY < r.top + r.height / 2); el.classList.toggle('qp-drop-after', e.clientY >= r.top + r.height / 2); });
      el.addEventListener('dragleave', () => el.classList.remove('qp-drop-before', 'qp-drop-after'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('qp-drop-before', 'qp-drop-after');
        const from = this.dragId; this.dragId = null;
        if (!from || from === p.id) return;
        const r = el.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        this.app.exec('page.moveTo', { id: from, target: p.id, before });
      });
      grid.appendChild(el);
    });
    this.rail.appendChild(grid);
    this.rail.appendChild(h('button', { class: 'qp-rail-add', onclick: () => this.app.exec('page.insert') }, icon('add'), ' New Page'));
    this.rail.appendChild(h('div', { class: 'qp-rail-head' }, icon('dashboard_customize'), ' Masters'));
    const masters = h('div', { class: 'qp-rail-pages' });
    pub.data.masters.forEach((m) => {
      const el = h('div', { class: 'qp-thumb qp-master-thumb' + (m.id === t.masterTarget ? ' qp-current' : ''), title: m.name },
        h('div', { class: 'qp-thumb-img', html: this.thumb(m, -1) }), h('div', { class: 'qp-thumb-num' }, m.name));
      el.addEventListener('click', () => this.app.exec('page.editMaster', m.id));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.app.exec('page.editMaster', m.id); showMenu([
        { id: 'page.newMaster', label: 'New Master', icon: 'add' }, { id: 'page.duplicateMaster', label: 'Duplicate Master', icon: 'content_copy' }, { id: 'page.renameMaster', label: 'Rename Master…', icon: 'edit' },
        { id: 'page.applyMaster', arg: m.id, label: 'Apply to Selected Pages', icon: 'done_all' }, { separator: true }, { id: 'page.deleteMaster', label: 'Delete Master', icon: 'delete' },
      ], { x: e.clientX, y: e.clientY, onPick: (en) => en.id && this.app.exec(en.id, en.arg) }); });
      masters.appendChild(el);
    });
    this.rail.appendChild(masters);
    if (t.masterTarget) this.rail.appendChild(h('button', { class: 'qp-rail-add', onclick: () => this.app.exec('page.closeMaster') }, icon('close'), ' Close Master'));
  }

  private railKeys(e: KeyboardEvent): void {
    const t = this.tab;
    const i = t.pub.pageIndex(t.current);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); const p = t.pub.pages[i + 1]; if (p) this.app.goToPage(p.id, { extend: e.shiftKey }); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); const p = t.pub.pages[i - 1]; if (p) this.app.goToPage(p.id, { extend: e.shiftKey }); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.app.exec('page.delete'); }
    else if (e.key === 'Enter') { e.preventDefault(); this.canvas.focus(); }
  }
}
