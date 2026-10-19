/** File backstage: Home, New, Open, Info, Save As, Export, Print, Share, Options. */
import type { App } from '../app';
import { h, icon, clear } from './dom';
import { TEMPLATES } from '../templates';
import { FORMATS } from '../io';
import { kvKeys, kvGet, kvDel } from '../util/store';
import { Pub } from '../model/pub';
import { pageSvg } from '../render/page';
import { fontsUsed } from '../model/styles';
import { oversetFrames } from '../render/flow';
import { UNITS } from '../model/types';

const PAGES: [string, string, string][] = [
  ['home', 'Home', 'home'], ['new', 'New', 'note_add'], ['open', 'Open', 'folder_open'], ['info', 'Info', 'info'],
  ['save', 'Save', 'save'], ['saveas', 'Save As', 'save_as'], ['export', 'Export', 'ios_share'], ['print', 'Print', 'print'],
  ['share', 'Share', 'share'], ['close', 'Close', 'close'], ['options', 'Options', 'settings'],
];

export function renderBackstage(app: App, root: HTMLElement, page: string): void {
  clear(root);
  const nav = h('nav', { class: 'ql-bs-nav' }, h('button', { class: 'ql-bs-back', onclick: () => app.ui.hideBackstage(), 'aria-label': 'Back to publication' }, icon('arrow_back'), ' Back'));
  for (const [id, label, ic] of PAGES) {
    nav.appendChild(h('button', { class: 'ql-bs-item' + (id === page ? ' ql-on' : ''), onclick: () => {
      if (id === 'save') { app.ui.hideBackstage(); app.exec('file.save'); return; }
      if (id === 'close') { app.exec('file.close'); return; }
      if (id === 'options') { app.exec('file.options'); return; }
      renderBackstage(app, root, id);
    } }, icon(ic), ' ', label));
  }
  const body = h('div', { class: 'ql-bs-body' });
  root.append(nav, body);
  const card = (title: string, sub: string, ic: string, onclick: () => void) => h('button', { class: 'ql-bs-card', onclick }, icon(ic, 'ql-bs-card-icon'), h('div', null, h('b', null, title), h('div', { class: 'ql-help' }, sub)));
  const pub = app.pub;
  switch (page) {
    case 'home':
    case 'new': {
      const hr = new Date().getHours();
      body.appendChild(h('h1', null, page === 'home' ? 'Good ' + (hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening') : 'New'));
      const grid = h('div', { class: 'ql-bs-templates' });
      const thumb = (build: () => Pub) => { const el = h('div', { class: 'ql-template-thumb qp-template-thumb' }); try { const d = build(); if (d.pages[0]) el.innerHTML = pageSvg(d, d.pages[0], { mode: 'thumb' }); } catch { /* */ } return el; };
      const list = page === 'home' ? TEMPLATES.slice(0, 6) : TEMPLATES;
      for (const t of list) grid.appendChild(h('button', { class: 'ql-template', onclick: () => { app.ui.hideBackstage(); app.exec('file.new', t.id); } }, thumb(t.build), h('b', null, t.name), h('div', { class: 'ql-help' }, t.description)));
      body.appendChild(grid);
      if (page === 'new') {
        const mine = h('div', { class: 'ql-bs-templates' });
        body.append(h('h2', null, 'My Templates'), mine);
        kvKeys('tpl:').then(async (keys) => {
          if (!keys.length) mine.appendChild(h('p', { class: 'ql-help' }, 'Use File ▸ Save As ▸ Template to add your own.'));
          for (const k of keys) {
            const t = await kvGet(k);
            mine.appendChild(h('div', { class: 'ql-template' }, h('button', { class: 'ql-link', onclick: () => { app.ui.hideBackstage(); const d = Pub.fromJSON(t.json); d.clearHistory(); app.createTab(d, { title: t.name }); } }, h('b', null, t.name)), h('button', { class: 'ql-iconbtn ql-sm', title: 'Delete template', onclick: async () => { await kvDel(k); renderBackstage(app, root, 'new'); } }, icon('delete'))));
          }
        });
      }
      if (page === 'home') { body.appendChild(h('h2', null, 'Recent')); recentList(app, body); }
      break;
    }
    case 'open': {
      body.append(h('h1', null, 'Open'),
        card('Browse…', 'Open a file from this device, Drive, or any document provider', 'folder_open', () => app.exec('file.open')),
        card('Encrypted publication…', 'Open a password-protected .qppe file', 'lock_open', () => app.exec('file.openEncrypted')),
        card('Open and Repair…', 'Rebuild a damaged .qpp or .sla and show what was recovered', 'healing', () => app.exec('file.openRepair')),
        card('Recover Data from Any File…', 'Pull readable text and pictures out of any file, however damaged', 'text_snippet', () => app.exec('file.recoverAny')),
        card('Place text…', 'Flow a text, Markdown, RTF or Word file into a new text frame', 'notes', () => app.exec('insert.textFile')),
        card('Recover unsaved publications', 'Drafts saved automatically before a crash or close', 'restore_page', () => app.exec('file.recoverUnsaved')),
        h('h2', null, 'Recent'));
      recentList(app, body, true);
      break;
    }
    case 'info': {
      const tab = app.tab;
      let words = 0, pics = 0, frames = 0;
      const walk = (els: any[]) => { for (const e of els) { if (e.kind === 'picture') pics++; if (e.kind === 'text') frames++; if (e.children) walk(e.children); } };
      for (const s of pub.pages) walk(s.items);
      for (const st of pub.data.stories) words += st.paras.map((p) => p.runs.map((r) => r.text).join('')).join(' ').split(/\s+/).filter(Boolean).length;
      const p = pub.data.props;
      const u = UNITS[pub.data.unit] || UNITS.in;
      const over = oversetFrames(pub).length;
      body.append(h('h1', null, 'Info'), h('h2', null, tab.displayName),
        h('div', { class: 'ql-bs-cards' },
          card('Protect Publication', pub.data.finalMarked ? 'Marked as final' : 'Encrypt with a password or mark as final', 'shield_lock', () => app.exec('file.encrypt')),
          card('Mark as Final', pub.data.finalMarked ? 'The publication is read-only' : 'Make the publication read-only', 'verified', () => app.exec('file.markFinal')),
          card('Preflight', over ? `${over} frame(s) with overset text` : 'Check overset text, missing pictures, fonts and more', 'checklist', () => { app.ui.hideBackstage(); app.exec('review.preflight'); }),
          card('Check Accessibility', 'Find content people with disabilities might have trouble reading', 'accessibility_new', () => { app.ui.hideBackstage(); app.exec('review.checkAccessibility'); }),
          card('Package for Print', 'A ZIP with the publication, PDF, pictures and a report', 'inventory_2', () => app.exec('file.package')),
          card('Version History', 'Browse and restore snapshots', 'history', () => app.exec('file.versions')),
          card('Revert to Saved', 'Discard changes since the last save', 'settings_backup_restore', () => app.exec('file.revert'))),
        h('h3', null, 'Properties'),
        h('table', { class: 'ql-stats' },
          ...[['Title', p.title || '—'], ['Author', p.author || app.prefs.author], ['Pages', String(pub.pages.length)], ['Masters', String(pub.data.masters.length)], ['Words', String(words)], ['Text frames', String(frames)], ['Pictures', String(pics)], ['Fonts', fontsUsed(pub.data).join(', ') || '—'], ['Page size', `${(pub.size.w / u.pt).toFixed(u.digits)} × ${(pub.size.h / u.pt).toFixed(u.digits)} ${u.label}${pub.data.facing ? ', facing pages' : ''}`], ['Format', tab.format.toUpperCase()], ['Location', tab.uri ? 'Device storage' : 'Not saved yet'], ['Created', new Date(p.created || tab.created).toLocaleString()], ['Last saved', tab.saved ? new Date(tab.saved).toLocaleString() : '—']].map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v)))),
        h('button', { class: 'ql-btn', onclick: () => app.exec('file.properties') }, 'All Properties…'));
      break;
    }
    case 'saveas':
    case 'export': {
      body.append(h('h1', null, page === 'saveas' ? 'Save As' : 'Export'), h('p', { class: 'ql-help' }, page === 'saveas' ? 'Choose a format. The system file dialog lets you pick the folder (device, SD card, Drive, Dropbox…).' : 'Save a copy in another format; the current publication keeps its file.'));
      const grid = h('div', { class: 'ql-bs-cards' });
      for (const f of FORMATS.filter((x) => x.canExport)) grid.appendChild(card(f.label, `.${f.ext[0]}`, 'description', () => (page === 'saveas' ? app.exec('file.saveAsFormat', f.id) : app.exec('file.exportAs', f.id))));
      grid.appendChild(card('PDF', 'Print-ready pages with vector text and shapes', 'picture_as_pdf', () => app.exec('file.export.pdf')));
      grid.appendChild(card('Pictures', 'PNG, JPEG or SVG of each page', 'image', () => app.exec('file.export.images')));
      grid.appendChild(card('HTML', 'A responsive web page per publication page', 'html', () => app.exec('file.export.html')));
      grid.appendChild(card('Text', 'All stories as plain text or Markdown', 'notes', () => app.exec('file.export.text')));
      grid.appendChild(card('Package', 'A ZIP with .qpp, PDF, HTML and the pictures', 'inventory_2', () => app.exec('file.package')));
      grid.appendChild(card('Encrypted QuillPress (.qppe)', 'AES-256 password protected', 'enhanced_encryption', () => app.exec('file.encrypt')));
      grid.appendChild(card('Template', 'Reuse this design as a starting point', 'bookmark_add', () => app.exec('file.saveTemplate')));
      body.appendChild(grid);
      break;
    }
    case 'print': {
      body.append(h('h1', null, 'Print'),
        card('Print…', 'Pages, spreads or booklet, with a preview', 'print', () => app.exec('file.print')),
        card('Quick Print', 'All pages with the current settings', 'print', () => app.exec('file.quickPrint')),
        card('Export as PDF', 'A PDF file for the printer', 'picture_as_pdf', () => app.exec('file.export.pdf')),
        card('Printer Marks', 'Crop marks, bleed marks and page information', 'crop', () => app.exec('tools.printerMarks')));
      break;
    }
    case 'share': {
      body.append(h('h1', null, 'Share'),
        card('Share a copy…', 'Send as .qpp, PDF…', 'share', () => app.exec('file.share')),
        card('Email', 'Attach to an email', 'mail', () => app.exec('file.email')),
        card('Email as PDF', 'Attach a PDF of the pages', 'forward_to_inbox', () => app.exec('file.emailPdf')),
        card('Export HTML', 'A web page anyone can open', 'html', () => app.exec('file.export.html')));
      break;
    }
  }
}

function recentList(app: App, body: HTMLElement, full = false) {
  const list = h('div', { class: 'ql-recent' });
  const rec = app.prefs.recent;
  if (!rec.length) list.appendChild(h('p', { class: 'ql-help' }, 'Publications you open or save appear here.'));
  for (const r of rec.slice(0, full ? 40 : 8)) {
    list.appendChild(h('div', { class: 'ql-recent-row' },
      h('button', { class: 'ql-recent-open', onclick: () => app.exec('file.openRecent', r.key) }, icon('auto_stories'), h('div', null, h('b', null, r.name), h('div', { class: 'ql-help' }, new Date(r.when).toLocaleString()))),
      h('button', { class: 'ql-iconbtn', title: r.pinned ? 'Unpin' : 'Pin', onclick: () => { r.pinned = !r.pinned; app.savePrefs(); renderBackstage(app, body.parentElement!, full ? 'open' : 'home'); } }, icon(r.pinned ? 'keep_off' : 'keep')),
      h('button', { class: 'ql-iconbtn', title: 'Remove from list', onclick: () => { app.prefs.recent = app.prefs.recent.filter((x) => x !== r); app.savePrefs(); renderBackstage(app, body.parentElement!, full ? 'open' : 'home'); } }, icon('close'))));
  }
  if (full && rec.length) list.appendChild(h('button', { class: 'ql-btn', onclick: () => app.exec('file.clearRecent') }, 'Clear unpinned'));
  body.appendChild(list);
}
