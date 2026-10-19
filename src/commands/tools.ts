/** Tools tab: fonts, pictures, clean-up, text fixes, packaging helpers. */
import { def } from './registry';
import type { App } from '../app';
import type { Item, Paragraph, PictureFrame, TextFrame } from '../model/types';
import { clone, newId } from '../model/pub';
import { fontsUsed, resolvePara, resolveRun } from '../model/styles';
import { forEachText, edit, selection, flatItems, textTargets, insertItem, placeNew } from '../edit/ops';
import { paraText } from '../edit/textEdit';
import { openDialog, toast, confirmDialog } from '../ui/dialog';
import { pickFile } from '../ui/dom';
import { FONT_LIST } from '../fonts';
import { IMAGE_ACCEPT, mediaFromBytes } from '../io/images';
import { unb64 } from '../io/xml';
import { effectiveDpi } from './picture';
import { LOREM } from '../templates/lorem';

function framesUsingFont(app: App, font: string): { page?: string; id: string }[] {
  const pub = app.pub;
  const out: { page?: string; id: string }[] = [];
  const uses = (paras: Paragraph[]) => paras.some((p) => { const rp = resolvePara(pub.data, p); return p.runs.some((r) => resolveRun(pub.data, rp.run, r).font === font) || rp.run.font === font; });
  for (const p of pub.pages) for (const e of flatItems(p)) {
    if (e.kind === 'text') { const s = pub.story(e.story); if (s && uses(s.paras)) out.push({ page: p.id, id: e.id }); }
    if (e.kind === 'table' && e.rows.some((r) => r.cells.some((c) => uses(c.text)))) out.push({ page: p.id, id: e.id });
  }
  return out;
}

/** Straight quotes and apostrophes → typographer's quotes in a text. */
export function smartQuotes(t: string): string {
  return t.replace(/(^|[\s(\[{<—–-])"/g, '$1“').replace(/"/g, '”').replace(/(^|[\s(\[{<—–-])'/g, '$1‘').replace(/'/g, '’').replace(/(\d)”/g, '$1″').replace(/(\d)’/g, '$1′');
}

/** Fixes common OCR and pasted-text faults in a run of paragraphs. */
export function cleanupParas(paras: Paragraph[], opts: { joinLines: boolean; dehyphenate: boolean; spaces: boolean; quotes: boolean; ligatures: boolean }): Paragraph[] {
  let out = paras.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) }));
  if (opts.joinLines) {
    // Lines broken by hard returns inside a paragraph: join when a line does not end a sentence and the next starts lowercase.
    const joined: Paragraph[] = [];
    for (const p of out) {
      const prev = joined[joined.length - 1];
      const t = paraText(p), pt = prev ? paraText(prev) : '';
      if (prev && pt && t && !/[.!?:”"’)]\s*$/.test(pt) && /^[a-z]/.test(t) && (prev.style || 'Body') === (p.style || 'Body')) {
        const endsHyphen = opts.dehyphenate && /[a-z]-$/.test(pt);
        if (endsHyphen) { const last = prev.runs[prev.runs.length - 1]; last.text = last.text.replace(/-$/, ''); } else prev.runs.push({ text: ' ' });
        prev.runs.push(...p.runs);
      } else joined.push(p);
    }
    out = joined;
  }
  for (const p of out) for (const r of p.runs) {
    if (r.br || r.field) continue;
    let t = r.text;
    if (opts.spaces) t = t.replace(/[ \t ]{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([,.;:!?])(?=[A-Za-z])/g, '$1 ');
    if (opts.ligatures) t = t.replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl');
    if (opts.dehyphenate) t = t.replace(/([a-z])- ([a-z])/g, '$1$2');
    if (opts.quotes) t = smartQuotes(t);
    r.text = t;
  }
  return out;
}

def([
  {
    id: 'tools.findFont', label: 'Find Font…', icon: 'manage_search', tab: 'Tools', group: 'Fonts', noRecord: true, origin: 'Find Font (page layout programs)',
    tip: 'Every font in use, where it is used, and whether it is available; select the frames or replace the font',
    run: async (app) => {
      const fonts = fontsUsed(app.pub.data);
      if (!fonts.length) { toast('Only the default fonts are in use.'); return; }
      const avail = new Set(FONT_LIST.map((f) => f.toLowerCase()));
      const r = await openDialog({ title: 'Find Font', fields: [{ key: 'f', label: 'Fonts in this publication', type: 'list', rows: 8, options: fonts.map((f) => ({ value: f, label: `${f} — ${framesUsingFont(app, f).length} frame(s)${avail.has(f.toLowerCase()) ? '' : ' — not bundled'}` })), value: fonts[0] }], ok: 'Select Frames', buttons: [{ label: 'Replace Font…', onClick: (_v, ctl) => { ctl.close(); app.exec('edit.replaceFonts'); } }] });
      if (!r) return;
      const uses = framesUsingFont(app, r.f);
      if (!uses.length) { toast(`${r.f} is used only in style definitions.`); return; }
      const first = uses[0];
      if (first.page) { app.goToPage(first.page); app.tab.ui.select(uses.filter((x) => x.page === first.page).map((x) => x.id)); }
    },
  },
  {
    id: 'tools.relink', label: 'Relink Picture…', icon: 'link', tab: 'Tools', group: 'Pictures', edits: true,
    tip: 'Replace a picture with a new file everywhere it is used (for example a higher-resolution version)',
    run: async (app) => {
      const pub = app.pub;
      const sel = selection(app).find((e): e is PictureFrame => e.kind === 'picture' && !!e.media);
      const ids = Object.keys(pub.media);
      if (!ids.length) { toast('There are no pictures to relink.'); return; }
      let id = sel?.media;
      if (!id) { const r = await openDialog({ title: 'Relink Picture', fields: [{ key: 'm', label: 'Picture', type: 'list', rows: 8, options: ids.map((k) => ({ value: k, label: pub.media[k].name || k })), value: ids[0] }] }); if (!r) return; id = r.m; }
      const f = (await pickFile(IMAGE_ACCEPT))[0]; if (!f) return;
      const m = await mediaFromBytes(new Uint8Array(await f.arrayBuffer()), f.name);
      pub.transact('Relink Picture', () => { pub.media[id!] = m; for (const o of [...pub.pages, ...pub.data.masters]) for (const e of flatItems(o)) if (e.kind === 'picture' && e.media === id) e.src = m.name; });
      app.tab.ui.invalidate();
      toast(`Relinked to ${f.name}`);
    },
  },
  {
    id: 'tools.lowResReport', label: 'Low-Resolution Pictures', icon: 'broken_image', tab: 'Tools', group: 'Pictures', noRecord: true,
    run: async (app) => {
      const pub = app.pub;
      const rows: { page: string; e: PictureFrame; dpi: number }[] = [];
      for (const p of pub.pages) for (const e of flatItems(p)) if (e.kind === 'picture' && e.media) { const dpi = effectiveDpi(app, e); if (dpi != null && dpi < 200) rows.push({ page: p.id, e, dpi }); }
      if (!rows.length) { toast('Every picture is at least 200 ppi as placed.'); return; }
      const r = await openDialog({ title: 'Low-Resolution Pictures', fields: [{ key: 'p', label: `${rows.length} picture(s) below 200 ppi`, type: 'list', rows: 8, options: rows.map((x, i) => ({ value: String(i), label: `Page ${pub.pageIndex(x.page) + 1}: ${x.e.name || 'picture'} — ${Math.round(x.dpi)} ppi` })), value: '0' }], ok: 'Go To' });
      if (!r) return;
      const x = rows[+r.p]; app.goToPage(x.page); app.tab.ui.select([x.e.id]);
    },
  },
  { id: 'tools.compressPictures', label: 'Compress Pictures…', icon: 'compress', tab: 'Tools', group: 'Pictures', edits: true, run: (app) => app.exec('picture.compress') },
  {
    id: 'tools.extractMedia', label: 'Extract Pictures…', icon: 'folder_zip', tab: 'Tools', group: 'Pictures', noRecord: true,
    tip: 'Save every picture of the publication in one ZIP file',
    run: async (app) => {
      const pub = app.pub;
      const ids = Object.keys(pub.media);
      if (!ids.length) { toast('There are no pictures.'); return; }
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const id of ids) { const m = pub.media[id]; const ext = (m.mime.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg'); zip.file(m.name && /\.[a-z0-9]+$/i.test(m.name) ? m.name : `${id}.${ext}`, unb64(m.b64)); }
      const { saveBytes, baseName } = await import('./file');
      await saveBytes(await zip.generateAsync({ type: 'uint8array' }), `${baseName(app)} pictures.zip`, 'application/zip');
    },
  },
  {
    id: 'tools.unusedStyles', label: 'Remove Unused Styles', icon: 'cleaning_services', tab: 'Tools', group: 'Clean Up', edits: true,
    run: async (app) => {
      const pub = app.pub;
      const paraUsed = new Set<string>(), charUsed = new Set<string>(), objUsed = new Set<string>();
      forEachText(app, (ps) => { for (const p of ps) { paraUsed.add(p.style || 'Body'); for (const r of p.runs) if (r.cstyle) charUsed.add(r.cstyle); if (p.end?.cstyle) charUsed.add(p.end.cstyle); } });
      for (const o of [...pub.pages, ...pub.data.masters]) for (const e of flatItems(o)) if (e.ostyle) objUsed.add(e.ostyle);
      const closure = (names: Set<string>, list: { name: string; basedOn?: string; next?: string }[]) => { let grew = true; while (grew) { grew = false; for (const s of list) if (names.has(s.name)) { for (const n of [s.basedOn, s.next]) if (n && !names.has(n)) { names.add(n); grew = true; } } } };
      closure(paraUsed, pub.data.styles.para); closure(charUsed, pub.data.styles.char);
      const keepPara = new Set(['Body', 'Heading 1', 'Caption', 'Table Text', 'Table Header']);
      const dp = pub.data.styles.para.filter((s) => !paraUsed.has(s.name) && !keepPara.has(s.name));
      const dc = pub.data.styles.char.filter((s) => !charUsed.has(s.name));
      const dobj = pub.data.styles.object.filter((s) => !objUsed.has(s.name));
      const n = dp.length + dc.length + dobj.length;
      if (!n) { toast('Every style is in use.'); return; }
      if (!(await confirmDialog('Remove Unused Styles', `Remove ${dp.length} paragraph, ${dc.length} character and ${dobj.length} object style(s) that nothing uses?`, 'Remove'))) return;
      pub.transact('Remove Unused Styles', () => { pub.data.styles.para = pub.data.styles.para.filter((s) => !dp.includes(s)); pub.data.styles.char = pub.data.styles.char.filter((s) => !dc.includes(s)); pub.data.styles.object = pub.data.styles.object.filter((s) => !dobj.includes(s)); });
      toast(`Removed ${n} style(s).`);
    },
  },
  {
    id: 'tools.unusedSwatches', label: 'Remove Unused Swatches', icon: 'cleaning_services', tab: 'Tools', group: 'Clean Up', edits: true,
    run: async (app) => {
      const pub = app.pub;
      const json = JSON.stringify([pub.data.pages, pub.data.masters, pub.data.stories, pub.data.styles]);
      const keep = new Set(['None', 'Black', 'White', 'Primary', 'Secondary', 'Accent']);
      const unused = pub.data.swatches.filter((s) => !keep.has(s.name) && !json.includes(`"${s.name}"`));
      if (!unused.length) { toast('Every swatch is in use (the base swatches are always kept).'); return; }
      if (!(await confirmDialog('Remove Unused Swatches', `Remove ${unused.length} swatch(es): ${unused.map((s) => s.name).join(', ')}?`, 'Remove'))) return;
      pub.transact('Remove Unused Swatches', () => { pub.data.swatches = pub.data.swatches.filter((s) => !unused.includes(s)); });
    },
  },
  {
    id: 'tools.emptyFrames', label: 'Empty Frames', icon: 'check_box_outline_blank', tab: 'Tools', group: 'Clean Up', kind: 'menu', edits: true,
    menu: () => [{ id: 'tools.emptyFrames', arg: 'select', label: 'Select Empty Frames on This Page' }, { id: 'tools.emptyFrames', arg: 'delete', label: 'Delete Empty Frames Everywhere' }],
    run: async (app, how = 'select') => {
      const pub = app.pub;
      const isEmpty = (e: Item) => (e.kind === 'text' && !e.prev && !e.next && !pub.story(e.story)?.paras.some((p) => p.runs.some((r) => r.text))) || (e.kind === 'picture' && !e.media);
      if (how === 'select') { const o = app.owner; if (!o) return; const ids = o.items.filter(isEmpty).map((e) => e.id); if (!ids.length) { toast('No empty frames on this page.'); return; } app.tab.ui.select(ids); return; }
      let n = 0;
      for (const p of pub.pages) n += p.items.filter(isEmpty).length;
      if (!n) { toast('No empty frames.'); return; }
      if (!(await confirmDialog('Delete Empty Frames', `Delete ${n} empty text and picture frame(s) on the pages?`, 'Delete'))) return;
      pub.transact('Delete Empty Frames', () => { for (const p of pub.pages) p.items = p.items.filter((e) => !isEmpty(e)); pub.pruneStories(); });
    },
  },
  {
    id: 'tools.offPage', label: 'Objects Off the Page', icon: 'open_in_full', tab: 'Tools', group: 'Clean Up', kind: 'menu', edits: true,
    menu: () => [{ id: 'tools.offPage', arg: 'select', label: 'Select on This Page' }, { id: 'tools.offPage', arg: 'move', label: 'Move Them onto the Page' }, { id: 'tools.offPage', arg: 'delete', label: 'Delete Everywhere' }],
    run: async (app, how = 'select') => {
      const pub = app.pub;
      const { w, h } = pub.size; const b = pub.data.bleed;
      const off = (e: Item) => e.x + e.w < -b || e.y + e.h < -b || e.x > w + b || e.y > h + b;
      if (how === 'select') { const o = app.owner; if (!o) return; const ids = o.items.filter(off).map((e) => e.id); if (!ids.length) { toast('Nothing is off this page.'); return; } app.tab.ui.select(ids); return; }
      if (how === 'move') { let n = 0; pub.transact('Move onto Page', () => { for (const p of pub.pages) for (const e of p.items) if (off(e)) { e.x = Math.max(0, Math.min(w - e.w, e.x)); e.y = Math.max(0, Math.min(h - e.h, e.y)); n++; } }); toast(`Moved ${n} object(s).`); return; }
      let n = 0; for (const p of pub.pages) n += p.items.filter(off).length;
      if (!n) { toast('Nothing is off the pages.'); return; }
      if (!(await confirmDialog('Delete Off-Page Objects', `Delete ${n} object(s) that lie entirely outside the pages?`, 'Delete'))) return;
      pub.transact('Delete Off-Page Objects', () => { for (const p of pub.pages) p.items = p.items.filter((e) => !off(e)); pub.pruneStories(); });
    },
  },
  {
    id: 'tools.resetMasterItems', label: 'Reset Master Items', icon: 'settings_backup_restore', tab: 'Tools', group: 'Clean Up', edits: true,
    tip: 'Remove this page\'s overrides of master page items so the master shows through again',
    run: (app) => { const p = app.page; if (!p) return; const n = p.items.filter((e) => e.masterOf).length; if (!n) { toast('This page has no overridden master items.'); return; } app.pub.transact('Reset Master Items', () => { p.items = p.items.filter((e) => !e.masterOf); p.hideMasterItems = undefined; app.pub.pruneStories(); }, [p.id]); toast(`Removed ${n} override(s).`); },
  },
  {
    id: 'tools.convertQuotes', label: 'Typographer\'s Quotes', icon: 'format_quote', tab: 'Tools', group: 'Text', edits: true, origin: 'Convert Quotes (Ventura, PageMaker)',
    tip: 'Turn straight quotes and apostrophes into curly ones in the selected frames (or everywhere)',
    run: (app) => { const frames = textTargets(app); let n = 0; const fix = (paras: Paragraph[]) => { for (const p of paras) for (const r of p.runs) { if (r.field || r.br) continue; const t = smartQuotes(r.text); if (t !== r.text) { n++; r.text = t; } } }; app.pub.transact('Typographer\'s Quotes', () => { if (frames.length) { for (const sid of new Set(frames.map((f) => f.story))) { const s = app.pub.story(sid); if (s) fix(s.paras); } } else forEachText(app, fix); }); toast(n ? `Converted quotes in ${n} run(s).` : 'No straight quotes found.'); },
  },
  {
    id: 'tools.ocrCleanup', label: 'Clean Up Pasted Text…', icon: 'cleaning_services', tab: 'Tools', group: 'Text', edits: true,
    tip: 'Fix text pasted from PDFs, scans or email: joined lines, end-of-line hyphens, double spaces, ligature characters, straight quotes',
    run: async (app) => {
      const frames = textTargets(app);
      const r = await openDialog({ title: 'Clean Up Text', fields: [
        { key: 'joinLines', label: 'Join lines broken inside paragraphs', type: 'checkbox', value: true },
        { key: 'dehyphenate', label: 'Remove end-of-line hyphenation', type: 'checkbox', value: true },
        { key: 'spaces', label: 'Collapse double spaces; fix spaces around punctuation', type: 'checkbox', value: true },
        { key: 'ligatures', label: 'Replace ligature characters (ﬁ ﬂ) with letters', type: 'checkbox', value: true },
        { key: 'quotes', label: 'Typographer\'s quotes', type: 'checkbox', value: true },
        { key: 'where', label: 'Apply to', type: 'radio', options: [{ value: 'sel', label: `Selected frames (${frames.length})` }, { value: 'all', label: 'Every story' }], value: frames.length ? 'sel' : 'all' },
      ] });
      if (!r) return;
      app.pub.transact('Clean Up Text', () => {
        const targets = r.where === 'sel' ? [...new Set(frames.map((f) => f.story))].map((id) => app.pub.story(id)!).filter(Boolean) : app.pub.data.stories;
        for (const s of targets) s.paras = cleanupParas(s.paras, r as any);
      });
    },
  },
  {
    id: 'tools.textToFrames', label: 'Split Story into Frames', icon: 'splitscreen', tab: 'Tools', group: 'Text', edits: true,
    tip: 'Make each paragraph of the selected frame its own frame (for headlines, decks and bylines laid out separately)',
    run: (app) => {
      const f = textTargets(app)[0];
      if (!f) { toast('Select a text frame first.'); return; }
      const s = app.pub.story(f.story);
      if (!s || s.paras.length < 2) { toast('The story has only one paragraph.'); return; }
      const ids: string[] = [];
      edit(app, 'Split Story into Frames', (o) => {
        const n = s.paras.length;
        const hEach = Math.max(24, f.h / n);
        s.paras.slice(1).forEach((p, i) => { const nf = app.pub.newTextFrame({ x: f.x, y: f.y + hEach * (i + 1), w: f.w, h: hEach }, [clone(p)]); nf.insets = f.insets; o.items.push(nf); ids.push(nf.id); });
        s.paras = [s.paras[0]];
        f.h = hEach; f.autosize = 'height';
      });
      app.tab.ui.select([f.id, ...ids]);
    },
  },
  {
    id: 'tools.fillWithPlaceholder', label: 'Fill Empty Frames with Placeholder', icon: 'notes', tab: 'Tools', group: 'Text', edits: true,
    run: (app) => { const pub = app.pub; let n = 0; pub.transact('Fill with Placeholder', () => { for (const p of pub.pages) for (const e of flatItems(p)) { if (e.kind !== 'text' || e.prev) continue; const s = pub.story(e.story); if (!s || s.paras.some((x) => x.runs.some((r) => r.text))) continue; s.paras = LOREM.slice(0, 3).map((t) => ({ style: s.paras[0]?.style || 'Body', runs: [{ text: t }] })); n++; } }); toast(n ? `Filled ${n} frame(s).` : 'No empty text frames.'); },
  },
  {
    id: 'tools.packageChecklist', label: 'Print Checklist', icon: 'checklist', tab: 'Tools', group: 'Package', noRecord: true,
    tip: 'What to check before sending a publication to a printer',
    run: async (app) => {
      const pub = app.pub;
      const { preflightIssues } = await import('./review');
      const issues = preflightIssues(app);
      const items = [
        [pub.data.bleed > 0, 'Bleed set (Page Design ▸ Bleed), usually 0.125 in / 3 mm'],
        [!issues.some((i) => i.kind === 'error'), 'Preflight shows no errors'],
        [!issues.some((i) => /low resolution/.test(i.text)), 'Every picture at 300 ppi as placed'],
        [fontsUsed(pub.data).every((f) => FONT_LIST.map((x) => x.toLowerCase()).includes(f.toLowerCase())), 'Every font is bundled (or outlined by the printer)'],
        [!!pub.data.props.title, 'Title set in File ▸ Properties'],
        [pub.pages.length % (pub.data.facing ? 4 : 1) === 0, pub.data.facing ? 'Page count is a multiple of 4 (for a folded booklet)' : 'Page count is right'],
        [pub.data.swatches.every((s) => !s.spot || s.cmyk), 'Spot colors named and intentional'],
        [true, 'Export with File ▸ Export ▸ PDF (bleed and crop marks on) or Package Publication for the printer'],
      ] as [boolean, string][];
      await openDialog({ title: 'Print Checklist', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<ul class="ql-checklist">${items.map(([ok, t]) => `<li>${ok ? '✅' : '⬜'} ${t}</li>`).join('')}</ul>` }], buttons: [{ label: 'Package…', onClick: (_v, ctl) => { ctl.close(); app.exec('file.package'); } }] });
    },
  },
  {
    id: 'tools.printerMarks', label: 'Printer\'s Marks…', icon: 'crop', tab: 'Tools', group: 'Package', edits: true,
    tip: 'Default marks for PDF export and printing: crop marks, bleed, slug notes',
    run: async (app) => {
      const pub = app.pub;
      const c = pub.data.props.custom || {};
      const r = await openDialog({ title: 'Printer\'s Marks', fields: [{ key: 'marks', label: 'Crop marks by default in PDF export', type: 'checkbox', value: c['quillpress:marks'] === '1' }, { key: 'bleed', label: 'Include the bleed by default', type: 'checkbox', value: c['quillpress:bleed'] !== '0' }, { key: 'slug', label: 'Slug note (job name, date; printed outside the trim when marks are on)', type: 'text', value: c['quillpress:slug'] || '' }] });
      if (!r) return;
      pub.transact('Printer\'s Marks', () => { const cc = (pub.data.props.custom ||= {}); cc['quillpress:marks'] = r.marks ? '1' : '0'; cc['quillpress:bleed'] = r.bleed ? '1' : '0'; if (r.slug) cc['quillpress:slug'] = r.slug; else delete cc['quillpress:slug']; });
    },
  },
  {
    id: 'tools.imposition', label: 'Booklet Order', icon: 'menu_book', tab: 'Tools', group: 'Package', noRecord: true, origin: 'Imposition (prepress)',
    tip: 'The printer\'s spread order for a folded booklet of these pages',
    run: async (app) => {
      const n = app.pub.pages.length;
      const total = Math.ceil(n / 4) * 4;
      const sheets: string[] = [];
      for (let i = 0; i < total / 2; i++) { const a = total - i, b = i + 1; const [l, r] = i % 2 === 0 ? [a, b] : [b, a]; sheets.push(`${l > n ? 'blank' : l} | ${r > n ? 'blank' : r}`); }
      await openDialog({ title: 'Booklet Order', ok: 'Close', cancel: false, fields: [{ key: 'i', type: 'info', html: `<p>${n} pages → ${total} with blanks, ${total / 4} sheet(s) folded in half. Print the pairs below as spreads (left | right), fronts then backs:</p><ol>${sheets.map((s) => `<li>${s}</li>`).join('')}</ol><p class="ql-help">Use File ▸ Print with Spreads on, or export the PDF and let the printer impose it.</p>` }] });
    },
  },
  {
    id: 'tools.newFrameFromText', label: 'Text Frame from Clipboard', icon: 'content_paste', tab: 'Tools', group: 'Text', internal: true, edits: true,
    run: (app, text: string) => { if (!text) return; const f = app.pub.newTextFrame(placeNew(app, 300, 120), text.split('\n').map((l) => ({ style: 'Body', runs: l ? [{ text: l }] : [] }))); insertItem(app, f, 'Paste'); },
  },
]);

