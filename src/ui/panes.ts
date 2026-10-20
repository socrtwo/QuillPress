/**
 * Side panes (task panes). On phones they appear as bottom sheets. Command modules register their own
 * panes with registerPane(); the core ones (Navigator, Layers, Styles, Swatches, Text Threads,
 * Version History) are defined here.
 */
import type { App } from '../app';
import type { Item, Page } from '../model/types';
import { Pub, newId } from '../model/pub';
import { h, icon, clear } from './dom';
import { toast, confirmDialog, promptDialog, showMenu } from './dialog';
import { kvKeys, kvGet, kvDel } from '../util/store';
import { pageTitle } from '../render/page';
import { colorHex } from '../model/styles';
import { oversetFrames } from '../render/flow';

export interface PaneDef {
  id: string;
  title: string;
  render: (app: App, el: HTMLElement, opts: any) => void;
  update?: (app: App, el: HTMLElement, opts: any) => void;
  onOpen?: (app: App, el: HTMLElement, opts: any) => void;
  onClose?: (app: App) => void;
}

export const PANES: Record<string, PaneDef> = {};

export function registerPane(def: PaneDef): void { PANES[def.id] = def; }

/** True while the user is typing in a field of the pane (redrawing would destroy the field). */
export const typingIn = (el: HTMLElement) => { const a = document.activeElement as HTMLElement | null; return !!a && el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };

export const sigOf = (el: HTMLElement, sig: string) => { if (el.dataset.sig === sig) return false; el.dataset.sig = sig; return true; };

export const KIND_ICON: Record<string, string> = { text: 'text_fields', picture: 'image', shape: 'shapes', line: 'horizontal_rule', table: 'table', group: 'join', pathText: 'gesture' };

export function itemLabel(e: Item): string {
  if (e.name) return e.name;
  return ({ text: 'Text frame', picture: 'Picture', shape: 'Shape', line: 'Line', table: 'Table', group: 'Group', pathText: 'Text on a path' } as Record<string, string>)[e.kind] || e.kind;
}

// ------------------------------------------------------------------------------------------
// Navigator

registerPane({
  id: 'navigator', title: 'Navigator',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const pub = app.pub;
    const sig = JSON.stringify([pub.version, app.tab.id, app.tab.current, app.tab.masterTarget]);
    if (!sigOf(el, sig) || typingIn(el)) return;
    clear(el);
    const filter = h('input', { class: 'ql-input', placeholder: 'Filter pages and objects…', 'aria-label': 'Filter' }) as HTMLInputElement;
    const list = h('div', { class: 'ql-nav-list' });
    const draw = () => {
      clear(list);
      const q = filter.value.trim().toLowerCase();
      pub.pages.forEach((p, i) => {
        const title = pageTitle(pub, p) || '(empty page)';
        const objs = p.items.filter((e) => !q || itemLabel(e).toLowerCase().includes(q));
        if (q && !title.toLowerCase().includes(q) && !objs.length) return;
        list.appendChild(h('button', { class: 'ql-nav-item' + (p.id === app.tab.current && !app.tab.masterTarget ? ' ql-on' : ''), onclick: () => app.goToPage(p.id) }, icon('crop_portrait'), h('span', null, `${pub.pageLabel(i) || i + 1}. ${title}`)));
        if (p.id === app.tab.current || q) for (const e of objs) list.appendChild(h('button', { class: 'ql-nav-item ql-nav-sub', onclick: () => { app.goToPage(p.id); app.tab.ui.select([e.id]); } }, icon(KIND_ICON[e.kind] || 'category'), h('span', null, itemLabel(e))));
      });
      list.appendChild(h('h3', { class: 'ql-pane-h' }, icon('dashboard_customize'), ' Masters'));
      for (const m of pub.data.masters) list.appendChild(h('button', { class: 'ql-nav-item' + (m.id === app.tab.masterTarget ? ' ql-on' : ''), onclick: () => app.exec('page.editMaster', m.id) }, icon('dashboard'), h('span', null, m.name), h('span', { class: 'ql-help' }, `${pub.pages.filter((p) => p.master === m.id).length} pages`)));
      const stories = pub.data.stories;
      if (stories.length) {
        list.appendChild(h('h3', { class: 'ql-pane-h' }, icon('article'), ' Stories'));
        for (const s of stories) {
          const frames = pub.chainOf(s.id);
          const first = frames[0];
          const t = s.paras.map((p) => p.runs.map((r) => r.text).join('')).find((x) => x.trim()) || '(empty story)';
          if (q && !t.toLowerCase().includes(q)) continue;
          list.appendChild(h('button', { class: 'ql-nav-item', onclick: () => { const pg = first && pub.pageOfItem(first.id); if (pg) { app.goToPage(pg.id); app.tab.ui.select([first.id]); } } }, icon('article'), h('span', null, t.slice(0, 50)), h('span', { class: 'ql-help' }, `${frames.length} frame${frames.length === 1 ? '' : 's'}`)));
        }
      }
    };
    filter.addEventListener('input', draw);
    el.append(filter, list);
    draw();
  },
});

// ------------------------------------------------------------------------------------------
// Layers (objects of the current page, front first; and the publication's layers)

registerPane({
  id: 'layers', title: 'Layers',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const o = app.owner;
    const sel = app.tab.ui.selection;
    const pub = app.pub;
    const sig = JSON.stringify([pub.version, o?.id, sel]);
    if (!sigOf(el, sig) || typingIn(el)) return;
    clear(el);
    if (!o) return;
    const scope = 'master' in o ? [o.id] : undefined;
    el.appendChild(h('h3', { class: 'ql-pane-h' }, icon('layers'), ' Layers'));
    for (const l of [...pub.data.layers].reverse()) {
      const row = h('div', { class: 'ql-nav-item' },
        h('span', { class: 'qp-layer-swatch', style: `background:${l.color || '#5b3c9e'}` }), h('span', { class: 'ql-sel-name' }, l.name),
        h('button', { class: 'ql-iconbtn ql-sm', title: l.hidden ? 'Show layer' : 'Hide layer', onclick: (ev: Event) => { ev.stopPropagation(); pub.transact(l.hidden ? 'Show Layer' : 'Hide Layer', () => { l.hidden = !l.hidden || undefined; }); } }, icon(l.hidden ? 'visibility_off' : 'visibility')),
        h('button', { class: 'ql-iconbtn ql-sm', title: l.locked ? 'Unlock layer' : 'Lock layer', onclick: (ev: Event) => { ev.stopPropagation(); pub.transact(l.locked ? 'Unlock Layer' : 'Lock Layer', () => { l.locked = !l.locked || undefined; }); } }, icon(l.locked ? 'lock' : 'lock_open')),
        h('button', { class: 'ql-iconbtn ql-sm', title: 'Layer options', onclick: (ev: MouseEvent) => { ev.stopPropagation(); showMenu([
          { id: 'rename', label: 'Rename…', icon: 'edit' }, { id: 'color', label: 'Color…', icon: 'palette' }, { id: 'up', label: 'Move Up', icon: 'arrow_upward' }, { id: 'down', label: 'Move Down', icon: 'arrow_downward' }, { id: 'select', label: 'Select Objects on Layer', icon: 'select_all' }, { separator: true }, { id: 'delete', label: 'Delete Layer', icon: 'delete' },
        ], { anchor: ev.currentTarget as HTMLElement, onPick: async (e) => {
          if (e.id === 'rename') { const n = await promptDialog('Rename Layer', 'Name', l.name); if (n) pub.transact('Rename Layer', () => { l.name = n; }); }
          if (e.id === 'color') { const { colorMenu } = await import('./dialog'); const c = await colorMenu(ev.currentTarget as HTMLElement); if (c) pub.transact('Layer Color', () => { l.color = c; }); }
          if (e.id === 'up' || e.id === 'down') pub.transact('Move Layer', () => { const i = pub.data.layers.indexOf(l); const j = e.id === 'up' ? i + 1 : i - 1; if (j >= 0 && j < pub.data.layers.length) { pub.data.layers.splice(i, 1); pub.data.layers.splice(j, 0, l); } });
          if (e.id === 'select') app.tab.ui.select(o.items.filter((x) => (x.layer || 'default') === l.id).map((x) => x.id));
          if (e.id === 'delete') app.exec('arrange.deleteLayer', l.id);
        } }); } }, icon('more_vert')));
      el.appendChild(row);
    }
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('arrange.newLayer') }, icon('add'), ' New Layer'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('arrange.moveToLayer') }, 'Move Selection to Layer…')));
    el.appendChild(h('h3', { class: 'ql-pane-h' }, icon('category'), ' Objects on this page'));
    if (!o.items.length) el.appendChild(h('p', { class: 'ql-help' }, 'This page has no objects.'));
    el.appendChild(h('p', { class: 'ql-help' }, 'Top of the list is in front. Double-click a name to rename it.'));
    [...o.items].reverse().forEach((e) => {
      const name = h('span', { class: 'ql-sel-name' }, itemLabel(e));
      name.addEventListener('dblclick', () => {
        const inp = h('input', { class: 'ql-input', value: itemLabel(e) }) as HTMLInputElement;
        name.replaceWith(inp);
        inp.focus(); inp.select();
        const done = () => { const v = inp.value.trim(); if (v && v !== e.name) pub.transact('Rename', () => { e.name = v; }, scope); else app.refresh(); };
        inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = itemLabel(e); inp.blur(); } });
        inp.addEventListener('blur', done);
      });
      const layer = pub.layer(e.layer);
      const row = h('div', { class: 'ql-nav-item' + (sel.includes(e.id) ? ' ql-on' : '') },
        h('span', { class: 'qp-layer-swatch', style: `background:${layer?.color || '#5b3c9e'}`, title: layer?.name || '' }), icon(KIND_ICON[e.kind] || 'category'), name,
        h('button', { class: 'ql-iconbtn ql-sm', title: e.hidden ? 'Show' : 'Hide', 'aria-label': e.hidden ? 'Show' : 'Hide', onclick: (ev: Event) => { ev.stopPropagation(); pub.transact(e.hidden ? 'Show' : 'Hide', () => { e.hidden = e.hidden ? undefined : true; }, scope); } }, icon(e.hidden ? 'visibility_off' : 'visibility')),
        h('button', { class: 'ql-iconbtn ql-sm', title: e.locked ? 'Unlock' : 'Lock', 'aria-label': e.locked ? 'Unlock' : 'Lock', onclick: (ev: Event) => { ev.stopPropagation(); pub.transact(e.locked ? 'Unlock' : 'Lock', () => { e.locked = e.locked ? undefined : true; }, scope); } }, icon(e.locked ? 'lock' : 'lock_open')),
        h('button', { class: 'ql-iconbtn ql-sm', title: 'Bring Forward', 'aria-label': 'Bring forward', onclick: (ev: Event) => { ev.stopPropagation(); app.tab.ui.select([e.id]); app.exec('arrange.bringForward'); } }, icon('arrow_upward')),
        h('button', { class: 'ql-iconbtn ql-sm', title: 'Send Backward', 'aria-label': 'Send backward', onclick: (ev: Event) => { ev.stopPropagation(); app.tab.ui.select([e.id]); app.exec('arrange.sendBackward'); } }, icon('arrow_downward')));
      row.addEventListener('click', (ev) => { const add = (ev as MouseEvent).ctrlKey || (ev as MouseEvent).shiftKey; app.tab.ui.select(add ? (sel.includes(e.id) ? sel.filter((x) => x !== e.id) : [...sel, e.id]) : [e.id]); });
      el.appendChild(row);
    });
  },
});

// ------------------------------------------------------------------------------------------
// Styles

registerPane({
  id: 'styles', title: 'Styles',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const pub = app.pub;
    const sig = JSON.stringify([pub.version, app.tab.ui.selection, (window as any).__qpCaretStyle]);
    if (!sigOf(el, sig) || typingIn(el)) return;
    clear(el);
    const d = pub.data;
    const section = (title: string, kind: 'para' | 'char' | 'object') => {
      el.appendChild(h('h3', { class: 'ql-pane-h' }, icon(kind === 'para' ? 'format_paragraph' : kind === 'char' ? 'text_format' : 'crop_square'), ` ${title}`, h('span', { class: 'ql-spacer' }),
        h('button', { class: 'ql-iconbtn ql-sm', title: `New ${title.replace(/ styles$/i, '')} style`, onclick: () => app.exec(kind === 'para' ? 'fmt.newParaStyle' : kind === 'char' ? 'fmt.newCharStyle' : 'shape.newObjectStyle') }, icon('add'))));
      const list = kind === 'para' ? d.styles.para : kind === 'char' ? d.styles.char : d.styles.object;
      for (const st of list) {
        const row = h('div', { class: 'ql-style-row' },
          h('button', { class: 'ql-style-name', style: kind === 'para' ? `font-family:"${(st as any).run?.font || ''}";${(st as any).run?.b ? 'font-weight:bold;' : ''}` : kind === 'char' ? `${(st as any).b ? 'font-weight:bold;' : ''}${(st as any).i ? 'font-style:italic;' : ''}` : '', onclick: () => app.exec(kind === 'para' ? 'fmt.paraStyle' : kind === 'char' ? 'fmt.charStyle' : 'shape.objectStyle', st.name) }, st.name),
          h('button', { class: 'ql-iconbtn ql-sm', title: 'Style options', onclick: (ev: MouseEvent) => showMenu([
            { id: 'edit', label: 'Modify…', icon: 'edit' }, { id: 'redefine', label: 'Redefine from Selection', icon: 'sync' }, { id: 'dup', label: 'Duplicate', icon: 'content_copy' }, { id: 'select', label: 'Select All Using This Style', icon: 'select_all' }, { separator: true }, { id: 'delete', label: 'Delete…', icon: 'delete' },
          ], { anchor: ev.currentTarget as HTMLElement, onPick: (e) => {
            const cmd = kind === 'para' ? 'fmt.' : kind === 'char' ? 'fmt.' : 'shape.';
            if (e.id === 'edit') app.exec(kind === 'para' ? 'fmt.modifyParaStyle' : kind === 'char' ? 'fmt.modifyCharStyle' : 'shape.modifyObjectStyle', st.name);
            if (e.id === 'redefine') app.exec(kind === 'para' ? 'fmt.redefineStyle' : kind === 'char' ? 'fmt.redefineCharStyle' : 'shape.redefineObjectStyle', st.name);
            if (e.id === 'dup') app.exec(kind === 'para' ? 'fmt.duplicateStyle' : kind === 'char' ? 'fmt.duplicateCharStyle' : 'shape.duplicateObjectStyle', st.name);
            if (e.id === 'select') app.exec('fmt.selectByStyle', { kind, name: st.name });
            if (e.id === 'delete') app.exec(kind === 'para' ? 'fmt.deleteStyle' : kind === 'char' ? 'fmt.deleteCharStyle' : 'shape.deleteObjectStyle', st.name);
            void cmd;
          } }) }, icon('more_vert')));
        el.appendChild(row);
      }
    };
    section('Paragraph styles', 'para');
    section('Character styles', 'char');
    section('Object styles', 'object');
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('fmt.importStyles') }, icon('upload'), ' Load Styles…'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('tools.unusedStyles') }, 'Remove Unused')));
  },
});

// ------------------------------------------------------------------------------------------
// Swatches

registerPane({
  id: 'swatches', title: 'Swatches',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const pub = app.pub;
    const sig = JSON.stringify([pub.version, app.tab.ui.selection]);
    if (!sigOf(el, sig) || typingIn(el)) return;
    clear(el);
    el.appendChild(h('p', { class: 'ql-help' }, 'Click a swatch to fill the selection (or color the text being edited); Shift+click sets the outline.'));
    for (const sw of pub.data.swatches) {
      const row = h('div', { class: 'ql-nav-item' },
        h('span', { class: 'qp-swatch', style: sw.color === 'none' ? 'background:repeating-linear-gradient(45deg,#fff 0 4px,#d32f2f 4px 6px)' : `background:${colorHex(pub.data, sw.color)}` }),
        h('span', { class: 'ql-sel-name' }, sw.name),
        h('span', { class: 'ql-help' }, sw.cmyk ? `C${sw.cmyk[0]} M${sw.cmyk[1]} Y${sw.cmyk[2]} K${sw.cmyk[3]}` : sw.color),
        h('button', { class: 'ql-iconbtn ql-sm', title: 'Swatch options', onclick: (ev: MouseEvent) => { ev.stopPropagation(); showMenu([
          { id: 'edit', label: 'Edit Swatch…', icon: 'edit' }, { id: 'dup', label: 'Duplicate', icon: 'content_copy' }, { id: 'delete', label: 'Delete…', icon: 'delete' },
        ], { anchor: ev.currentTarget as HTMLElement, onPick: (e) => { if (e.id === 'edit') app.exec('page.editSwatch', sw.name); if (e.id === 'dup') app.exec('page.duplicateSwatch', sw.name); if (e.id === 'delete') app.exec('page.deleteSwatch', sw.name); } }); } }, icon('more_vert')));
      row.addEventListener('click', (ev) => app.exec((ev as MouseEvent).shiftKey ? 'shape.outlineColor' : 'shape.applySwatch', sw.name));
      el.appendChild(row);
    }
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('page.newSwatch') }, icon('add'), ' New Swatch…'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('page.colorScheme') }, 'Color Scheme…'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('tools.unusedSwatches') }, 'Remove Unused')));
  },
});

// ------------------------------------------------------------------------------------------
// Text threads (stories, their frames and overset)

registerPane({
  id: 'threads', title: 'Text Threads',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const pub = app.pub;
    const sig = JSON.stringify([pub.version, app.tab.ui.selection]);
    if (!sigOf(el, sig)) return;
    clear(el);
    const over = new Map(oversetFrames(pub).map((o) => [o.frame.id, o.chars]));
    el.appendChild(h('p', { class: 'ql-help' }, 'Each story and the frames it flows through, in order. Overset text is marked in red.'));
    for (const s of pub.data.stories) {
      const chain = pub.chainOf(s.id);
      if (!chain.length) continue;
      const t = s.paras.map((p) => p.runs.map((r) => r.text).join('')).find((x) => x.trim()) || '(empty story)';
      const words = s.paras.map((p) => p.runs.map((r) => r.text).join('')).join(' ').split(/\s+/).filter(Boolean).length;
      el.appendChild(h('h3', { class: 'ql-pane-h' }, icon('article'), ` ${t.slice(0, 40)}`, h('span', { class: 'ql-help' }, ` ${words} words`)));
      chain.forEach((f, i) => {
        const pg = pub.pageOfItem(f.id);
        const pi = pg ? pub.pageIndex(pg.id) : -1;
        const ov = over.get(f.id);
        el.appendChild(h('button', { class: 'ql-nav-item' + (app.tab.ui.selection.includes(f.id) ? ' ql-on' : ''), onclick: () => { if (pg) { app.goToPage(pg.id); app.tab.ui.select([f.id]); } } },
          icon(ov ? 'error' : 'text_fields'), h('span', { style: ov ? 'color:#d32f2f' : '' }, `${i + 1}. ${f.name || 'Frame'} — ${pg ? `page ${pub.pageLabel(pi) || pi + 1}` : 'master'}${ov ? ` (+${ov} characters overset)` : ''}`)));
      });
    }
    if (!pub.data.stories.length) el.appendChild(h('p', { class: 'ql-help' }, 'No text frames yet.'));
    el.appendChild(h('div', { class: 'ql-row' }, h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.autoflow') }, icon('playlist_add'), ' Autoflow Overset'), h('button', { class: 'ql-btn ql-sm', onclick: () => app.exec('text.oversetReport') }, 'Overset Report')));
  },
});

// ------------------------------------------------------------------------------------------
// Version history

registerPane({
  id: 'versions', title: 'Version History',
  render(app, el) { this.update!(app, el, {}); },
  update(app, el) {
    const sig = `${app.tab.id}:${app.tab.saved}`;
    if (!sigOf(el, sig)) return;
    clear(el);
    el.appendChild(h('p', { class: 'ql-help' }, 'Snapshots are kept on this device each time you save, and when you choose File ▸ Info ▸ Take Snapshot.'));
    el.appendChild(h('button', { class: 'ql-btn', onclick: async () => { await app.exec('file.snapshot'); el.dataset.sig = ''; } }, icon('add_a_photo'), ' Take Snapshot'));
    const list = h('div', { class: 'ql-nav-list' });
    el.appendChild(list);
    void (async () => {
      const { docKey } = await import('../commands/file');
      const keys = (await kvKeys(`snap:${docKey(app.tab)}:`)).sort().reverse();
      if (!keys.length) list.appendChild(h('p', { class: 'ql-help' }, 'No snapshots yet.'));
      for (const k of keys) {
        const v = await kvGet(k);
        if (!v) continue;
        list.appendChild(h('div', { class: 'ql-nav-item' },
          icon('history'), h('span', null, v.label), h('span', { class: 'ql-help' }, new Date(v.when).toLocaleString()),
          h('button', { class: 'ql-iconbtn ql-sm', title: 'Open as a copy', 'aria-label': 'Open as a copy', onclick: () => { try { const d = Pub.fromJSON(v.json); d.clearHistory(); app.createTab(d, { title: `${v.name} (${new Date(v.when).toLocaleString()})` }); } catch (e: any) { toast(`Could not open the snapshot: ${e?.message || e}`); } } }, icon('open_in_new')),
          h('button', { class: 'ql-iconbtn ql-sm', title: 'Restore into this publication', 'aria-label': 'Restore', onclick: async () => {
            if (!(await confirmDialog('Restore Snapshot', `Replace the current publication with "${v.label}"? You can undo this.`, 'Restore'))) return;
            const d = Pub.fromJSON(v.json);
            app.pub.transact('Restore Snapshot', () => { app.pub.data = d.data; Object.assign(app.pub.media, d.media); });
          } }, icon('settings_backup_restore')),
          h('button', { class: 'ql-iconbtn ql-sm', title: 'Delete', 'aria-label': 'Delete snapshot', onclick: async () => { await kvDel(k); el.dataset.sig = ''; this.update!(app, el, {}); } }, icon('delete'))));
      }
    })();
  },
});

export function pageLabelOf(app: App, p: Page): string { const i = app.pub.pageIndex(p.id); return app.pub.pageLabel(i) || String(i + 1); }
export { newId };
