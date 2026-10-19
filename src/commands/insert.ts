/** Insert tab: text frames, placed text, pictures, shapes, lines, tables, fields, symbols, links, comments. */
import { def, type MenuEntry } from './registry';
import type { App } from '../app';
import type { Item, Paragraph, PictureFrame, Run, ShapeItem, TableItem, TextFrame, Variable } from '../model/types';
import { newId, parasFromText } from '../model/pub';
import { GEOMETRY, SHAPE_GROUPS } from '../model/geometry';
import { insertItem, newTextFrame, placeNew, selection, textTargets, edit, applyRun, currentRun } from '../edit/ops';
import { activeTextEditor } from '../edit/textEdit';
import { openDialog, toast, promptDialog, showMenu } from '../ui/dialog';
import { pickFile, h } from '../ui/dom';
import { IMAGE_ACCEPT, mediaFromBytes, frameForMedia } from '../io/images';
import { LOREM } from '../templates/lorem';

/** Arms a drag-to-create tool; a second argument of 'place' drops the object at a default position instead. */
function tool(app: App, label: string, make: (b: { x: number; y: number; w: number; h: number }) => Item, opts: { w?: number; h?: number; line?: boolean; place?: boolean } = {}): void {
  if (opts.place || app.prefs.touchMode) { const b = placeNew(app, opts.w || 300, opts.h || 120); insertItem(app, make(b), label); return; }
  app.tab.ui.setTool({ kind: 'frame', make, label, line: opts.line, minW: 4, minH: 4 });
  toast(`Drag on the page to draw the ${label.toLowerCase()} (click for a default size, Esc cancels).`, { ms: 3500 });
}

function textFrameTool(app: App, opts: { text?: string; style?: string; ostyle?: string; place?: boolean; w?: number; h?: number; after?: (f: TextFrame) => void } = {}): void {
  tool(app, 'Text Frame', (b) => { const f = newTextFrame(app, opts.text, b, opts.style); if (opts.ostyle) f.ostyle = opts.ostyle; opts.after?.(f); return f; }, { w: opts.w || 300, h: opts.h || 120, place: opts.place });
}

/** Inserts text at the caret, into the selected frame's story, or as a new frame. */
export function insertTextAtCaret(app: App, text: string, run?: Partial<Run>): void {
  const ed = activeTextEditor();
  if (ed) { if (run) ed.insertRun({ ...run, text } as Run); else ed.insertText(text); return; }
  const f = textTargets(app)[0];
  if (f) {
    app.pub.transact('Insert', () => { const s = app.pub.story(f.story); if (!s) return; const last = s.paras[s.paras.length - 1]; last.runs.push({ ...(run || {}), text } as Run); });
    return;
  }
  insertItem(app, newTextFrame(app, run ? undefined : text), 'Insert Text');
  if (run) { const nf = selection(app)[0] as TextFrame; app.pub.transact('Insert Field', () => { const s = app.pub.story(nf.story); if (s) s.paras[0].runs.push({ ...run, text } as Run); }); }
}

/** Fields are runs whose text is refreshed by the layout engine. */
function field(app: App, kind: Run['field'], text: string, varName?: string): void {
  insertTextAtCaret(app, text, { field: kind, varName });
}

export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines.some((l) => l.includes(';')) ? ';' : ',';
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
}

export function makeTable(app: App, rows: number, cols: number, box: { x: number; y: number; w: number; h: number }, data?: string[][]): TableItem {
  const cw = box.w / cols, rh = Math.max(18, box.h / rows);
  return {
    id: newId('tbl'), kind: 'table', name: 'Table', x: box.x, y: box.y, w: box.w, h: rh * rows,
    cols: Array.from({ length: cols }, () => Math.round(cw * 100) / 100),
    rows: Array.from({ length: rows }, (_, r) => ({ h: rh, header: r === 0, cells: Array.from({ length: cols }, (_, c) => ({ text: [{ style: r === 0 ? 'Table Header' : 'Table Text', runs: data?.[r]?.[c] ? [{ text: data[r][c] }] : [] }] })) })),
    border: { fill: { type: 'solid', color: 'Black' }, width: 0.5 }, innerBorder: { fill: { type: 'solid', color: 'Gray' }, width: 0.5 },
    style: { firstRow: true, bandedRows: true, headerFill: { type: 'solid', color: 'Light Gray' } },
  };
}

async function placeFiles(app: App, files: File[], at?: { x: number; y: number }): Promise<void> {
  const pub = app.pub;
  const o = app.owner;
  if (!o) return;
  const g = 'master' in o ? pub.geometry(o) : { margins: o.margins };
  const [mt, mr, mb, ml] = g.margins;
  const ids: string[] = [];
  const sel = selection(app).filter((e) => e.kind === 'picture' && !e.media) as PictureFrame[];
  let k = 0;
  for (const f of files) {
    let m;
    try { m = await mediaFromBytes(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e: any) { toast(`${f.name}: ${e?.message || e}`); continue; }
    const id = pub.addMedia(m);
    const empty = sel.shift();
    if (empty) {
      pub.transact('Place Picture', () => { empty.media = id; empty.src = m.name; if (!empty.fit) empty.fit = 'fill'; });
      ids.push(empty.id);
      continue;
    }
    const bounds = at ? { x: at.x + k * 12, y: at.y + k * 12, w: pub.size.w - mr - at.x, h: pub.size.h - mb - at.y } : { x: ml + k * 12, y: mt + k * 12, w: pub.size.w - ml - mr - k * 12, h: pub.size.h - mt - mb - k * 12 };
    const frame = frameForMedia(id, m, { ...bounds, w: Math.max(40, bounds.w), h: Math.max(40, bounds.h) });
    insertItem(app, frame, 'Place Picture', false);
    ids.push(frame.id);
    k++;
  }
  if (ids.length) app.tab.ui.select(ids);
}

const shapeEntries = (): MenuEntry[] => {
  const out: MenuEntry[] = [];
  for (const g of SHAPE_GROUPS) {
    const items = Object.entries(GEOMETRY).filter(([, d]) => d.group === g);
    if (!items.length) continue;
    out.push({ heading: g });
    for (const [id, d] of items) out.push({ id: 'insert.shape', arg: id, label: d.label, icon: g === 'Lines' ? 'horizontal_rule' : g === 'Block Arrows' ? 'arrow_forward' : g === 'Stars and Banners' ? 'star' : g === 'Callouts' ? 'chat_bubble' : g === 'Flowchart' ? 'account_tree' : 'crop_square' });
  }
  return out;
};

export function makeShape(geom: string, b: { x: number; y: number; w: number; h: number }): ShapeItem {
  const d = GEOMETRY[geom];
  return { id: newId('sh'), kind: 'shape', geom, name: d?.label || 'Shape', x: b.x, y: b.y, w: b.w, h: b.h, fill: d?.open ? { type: 'none' } : { type: 'solid', color: 'Primary' }, line: { fill: { type: 'solid', color: 'Black' }, width: d?.open ? 1 : 0.5 } };
}

const SYMBOLS = ['©', '®', '™', '°', '±', '×', '÷', '≈', '≠', '≤', '≥', '∞', '√', '∑', 'π', 'Ω', 'µ', '€', '£', '¥', '¢', '§', '¶', '†', '‡', '•', '◦', '▪', '►', '→', '←', '↑', '↓', '↔', '⇒', '⇔', '★', '☆', '✓', '✗', '♠', '♣', '♥', '♦', '½', '¼', '¾', '⅓', '⅔', 'á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', 'ß', 'ç', 'ø', 'å', 'æ', 'œ', 'Á', 'É', 'Ñ', 'Ü', '¿', '¡', '«', '»', '‹', '›', '…', '–', '—', '‘', '’', '“', '”', '„'];
const EMOJI = ['😀', '😃', '😊', '😉', '😍', '🤔', '😎', '🙂', '😢', '😡', '👍', '👎', '👏', '🙏', '💪', '👋', '❤️', '💔', '⭐', '🔥', '✨', '🎉', '🎁', '🎂', '🏆', '🚀', '✈️', '🚗', '🏠', '🌍', '☀️', '🌙', '🌧️', '⚡', '🌈', '🌸', '🌳', '🍎', '☕', '🍕', '📚', '📅', '📌', '📎', '✏️', '📞', '💡', '🔔', '🔒', '⚠️', '✅', '❌', '➡️', '⬅️', '⬆️', '⬇️', '🔍', '💰', '📈', '📉', '🧭', '🎵', '🎨', '🏛️', '⚽', '🎓', '🛒', '🧾'];
const SPECIALS: { label: string; ch: string }[] = [
  { label: 'Em dash —', ch: '—' }, { label: 'En dash –', ch: '–' }, { label: 'Ellipsis …', ch: '…' }, { label: 'Nonbreaking space', ch: ' ' }, { label: 'Nonbreaking hyphen', ch: '‑' },
  { label: 'Soft hyphen (break point)', ch: '­' }, { label: 'Thin space', ch: ' ' }, { label: 'Hair space', ch: ' ' }, { label: 'Em space', ch: ' ' }, { label: 'En space', ch: ' ' },
  { label: 'Bullet •', ch: '•' }, { label: 'Section §', ch: '§' }, { label: 'Pilcrow ¶', ch: '¶' }, { label: 'Copyright ©', ch: '©' }, { label: 'Registered ®', ch: '®' }, { label: 'Trademark ™', ch: '™' },
  { label: 'Left double quote “', ch: '“' }, { label: 'Right double quote ”', ch: '”' }, { label: 'Left single quote ‘', ch: '‘' }, { label: 'Right single quote ’', ch: '’' }, { label: 'Guillemets « »', ch: '«»' },
  { label: 'Line break', ch: '\n' },
];

const DATE_FORMATS: { label: string; fmt: (d: Date) => string }[] = [
  { label: 'October 19, 2026', fmt: (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
  { label: '10/19/2026', fmt: (d) => d.toLocaleDateString('en-US') },
  { label: '2026-10-19', fmt: (d) => d.toISOString().slice(0, 10) },
  { label: 'Monday, October 19, 2026', fmt: (d) => d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
  { label: '19 October 2026', fmt: (d) => d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) },
  { label: 'October 2026', fmt: (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }) },
  { label: '9:41 AM', fmt: (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) },
];

/** Headings (Heading 1–3 / Headline styles) across the pages, for a table of contents. */
export function headingsOf(app: App): { level: number; text: string; page: number }[] {
  const pub = app.pub;
  const out: { level: number; text: string; page: number }[] = [];
  for (const [pi, pg] of pub.pages.entries()) {
    for (const e of pg.items) {
      if (e.kind !== 'text' || e.prev) continue;
      const s = pub.story(e.story);
      if (!s) continue;
      for (const p of s.paras) {
        const st = p.style || '';
        const m = /^Heading (\d)$/.exec(st);
        const level = m ? +m[1] : st === 'Headline' ? 1 : st === 'Subhead' ? 2 : 0;
        if (!level) continue;
        const t = p.runs.map((r) => r.text).join('').trim();
        if (t) out.push({ level, text: t, page: pi });
      }
    }
  }
  return out;
}

def([
  {
    id: 'insert.textFrame', label: 'Text Frame', icon: 'text_fields', tab: 'Insert', group: 'Text', keys: ['Mod-Shift-t', 't'], popular: true, edits: true,
    tip: 'Drag to draw a text frame; type into it, or link it to another frame so text flows between them',
    run: (app, text?: string) => textFrameTool(app, typeof text === 'string' ? { text, place: true } : {}),
  },
  {
    id: 'insert.placeholderText', label: 'Placeholder Text', icon: 'notes', tab: 'Insert', group: 'Text', edits: true, origin: 'Lorem ipsum fill (page layout programs)',
    tip: 'Fill the selected frame (or a new one) with placeholder text to see how the layout reads',
    run: (app, paras?: number) => {
      const n = typeof paras === 'number' ? paras : 3;
      const text = LOREM.slice(0, n).join('\n');
      const frames = textTargets(app);
      if (frames.length) {
        app.pub.transact('Placeholder Text', () => { for (const f of frames) { const s = app.pub.story(f.story); if (!s) continue; const style = s.paras[0]?.style; const empty = !s.paras.some((p) => p.runs.some((r) => r.text)); if (empty) s.paras = parasFromText(text, style); else s.paras.push(...parasFromText(text, style)); } });
        return;
      }
      textFrameTool(app, { text, place: true, w: 320, h: 240 });
    },
  },
  {
    id: 'insert.textFile', label: 'Place Text File…', icon: 'upload_file', tab: 'Insert', group: 'Text', keys: ['Mod-Shift-d'], edits: true, origin: 'Place (PageMaker), Get Text (QuarkXPress)',
    tip: 'Flow a .txt, .md, .rtf, .docx or .html file into the selected text frame, or a new frame chain through the pages',
    run: async (app, file?: File) => {
      const f = file || (await pickFile('.txt,.md,.markdown,.rtf,.docx,.html,.htm'))[0];
      if (!f) return;
      const { importTextFile } = await import('../io/textImport');
      let res;
      try { res = await importTextFile(new Uint8Array(await f.arrayBuffer()), f.name); } catch (e: any) { toast(`Could not read ${f.name}: ${e?.message || e}`); return; }
      if (!res.paras.length) { toast(`${f.name} has no text.`); return; }
      const target = textTargets(app)[0];
      const pub = app.pub;
      if (target) {
        pub.transact('Place Text', () => { const s = pub.story(target.story); if (!s) return; const empty = !s.paras.some((p) => p.runs.some((r) => r.text)); if (empty) s.paras = res.paras; else s.paras.push(...res.paras); });
      } else {
        const o = app.owner; if (!o) return;
        const g = 'master' in o ? pub.geometry(o) : { margins: o.margins, columns: o.columns, gutter: o.gutter };
        const [mt, mr, mb, ml] = g.margins;
        const frame = pub.newTextFrame({ x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb }, res.paras);
        frame.columns = g.columns; frame.gutter = g.gutter; frame.name = f.name.replace(/\.[^.]+$/, '');
        const s = pub.story(frame.story); if (s) s.name = frame.name;
        insertItem(app, frame, 'Place Text');
        const { oversetFrames } = await import('../render/flow');
        if (oversetFrames(pub).some((x) => x.frame.id === frame.id)) {
          toast('The text does not fit on this page.', { action: 'Autoflow', onAction: () => app.exec('text.autoflow'), ms: 8000 });
        }
      }
      if (res.warnings.length) toast(`Placed ${f.name} (${res.warnings.length} note(s)): ${res.warnings[0]}`, { ms: 6000 });
      else toast(`Placed ${f.name}: ${res.paras.length} paragraph(s)`);
    },
  },
  {
    id: 'insert.caption', label: 'Caption', icon: 'subtitles', tab: 'Insert', group: 'Text', edits: true,
    tip: 'A caption frame under the selected picture or object',
    run: (app) => {
      const e = selection(app)[0];
      if (!e) { textFrameTool(app, { style: 'Caption', text: 'Caption', place: true, w: 200, h: 24 }); return; }
      const f = app.pub.newTextFrame({ x: e.x, y: e.y + e.h + 4, w: e.w, h: 24 }, parasFromText(`Figure: ${e.name || 'Picture'}`, 'Caption'));
      f.name = 'Caption'; f.autosize = 'height';
      insertItem(app, f, 'Caption');
    },
  },
  {
    id: 'insert.pullQuote', label: 'Pull Quote', icon: 'format_quote', tab: 'Insert', group: 'Text', edits: true, origin: 'Pull quotes (magazine layout)',
    tip: 'A quotation frame with rules above and below, that body text wraps around',
    run: (app) => {
      const ed = activeTextEditor();
      const text = ed?.selectedText() || '“A pull quote draws the reader into the story.”';
      textFrameTool(app, { text, style: 'Pull Quote', w: 220, h: 120, place: !!ed, after: (f) => { f.name = 'Pull Quote'; f.wrap = { mode: 'square', offset: 9 }; f.insets = [6, 0, 6, 0]; f.line = { fill: { type: 'none' } }; const s = app.pub.story(f.story); if (s) for (const p of s.paras) { p.ruleAbove = { width: 2, color: 'Primary' }; p.ruleBelow = { width: 2, color: 'Primary' }; } } });
    },
  },
  {
    id: 'insert.sidebar', label: 'Sidebar', icon: 'view_sidebar', tab: 'Insert', group: 'Text', edits: true,
    tip: 'A tinted box with its own text, that body text wraps around',
    run: (app) => textFrameTool(app, { text: 'Sidebar\nRelated information goes here.', style: 'Body', w: 200, h: 160, after: (f) => { f.name = 'Sidebar'; f.ostyle = 'Sidebar'; f.wrap = { mode: 'square', offset: 9 }; f.insets = [9, 9, 9, 9]; const s = app.pub.story(f.story); if (s && s.paras[0]) s.paras[0].style = 'Subhead'; } }),
  },
  {
    id: 'insert.toc', label: 'Table of Contents', icon: 'toc', tab: 'Insert', group: 'Text', edits: true, origin: 'Generated contents (Ventura Publisher, FrameMaker)',
    tip: 'A contents frame built from the Heading 1–3 paragraphs across the pages, with page numbers',
    run: async (app) => {
      const hs = headingsOf(app);
      if (!hs.length) { toast('No headings found. Use the Heading 1, Heading 2 or Heading 3 paragraph styles for the titles you want listed.'); return; }
      const r = await openDialog({ title: 'Table of Contents', fields: [{ key: 'levels', label: 'Include levels', type: 'select', options: ['1', '2', '3'], value: '2' }, { key: 'title', label: 'Title', type: 'text', value: 'Contents' }, { key: 'leader', label: 'Dot leaders before page numbers', type: 'checkbox', value: true }] });
      if (!r) return;
      const pub = app.pub;
      const paras: Paragraph[] = [];
      if (r.title) paras.push({ style: 'Heading 1', runs: [{ text: r.title }] });
      const o = app.owner; const width = o ? pub.size.w - ('master' in o ? pub.geometry(o).margins[1] + pub.geometry(o).margins[3] : o.margins[1] + o.margins[3]) : 400;
      for (const hh of hs.filter((x) => x.level <= +r.levels)) paras.push({ style: 'Body No Indent', marL: (hh.level - 1) * 14, tabs: [{ pos: width - 2, align: 'r', leader: r.leader ? '.' : undefined }], runs: [{ text: hh.text }, { text: '\t' }, { text: pub.pageLabel(hh.page) || String(hh.page + 1) }] });
      const b = placeNew(app, width, Math.min(pub.size.h * 0.6, 20 * paras.length + 40));
      const f = pub.newTextFrame(b, paras);
      f.name = 'Contents';
      insertItem(app, f, 'Table of Contents');
    },
  },
  // Pictures
  {
    id: 'insert.picture', label: 'Picture', icon: 'image', tab: 'Insert', group: 'Pictures', keys: ['Mod-Shift-i'], popular: true, edits: true,
    tip: 'Place one or more pictures (PNG, JPEG, GIF, WebP, BMP, TIFF, SVG); an empty picture frame that is selected receives the first',
    run: async (app) => { const files = await pickFile(IMAGE_ACCEPT, true); if (files.length) await placeFiles(app, files); },
  },
  { id: 'insert.pictureFiles', label: 'Place Picture Files', icon: 'image', tab: 'Insert', group: 'Pictures', internal: true, edits: true, run: (app, arg: { files: File[]; at?: { x: number; y: number } } | File[]) => placeFiles(app, Array.isArray(arg) ? arg : arg.files, Array.isArray(arg) ? undefined : arg.at) },
  {
    id: 'insert.pictureFrame', label: 'Picture Frame', icon: 'crop_original', tab: 'Insert', group: 'Pictures', keys: ['f'], edits: true, origin: 'Picture boxes (QuarkXPress)',
    tip: 'Draw an empty picture frame to hold a picture later (double-click it to place one)',
    run: (app) => tool(app, 'Picture Frame', (b) => ({ id: newId('pic'), kind: 'picture', name: 'Picture Frame', x: b.x, y: b.y, w: b.w, h: b.h, fit: 'fill', line: { fill: { type: 'solid', color: 'Gray' }, width: 0.5, dash: 'dash' } }), { w: 200, h: 150 }),
  },
  {
    id: 'insert.pictureFromUrl', label: 'Picture from Web Address…', icon: 'add_link', tab: 'Insert', group: 'Pictures', edits: true,
    run: async (app) => {
      const url = await promptDialog('Picture from Web Address', 'Address (https://…)', 'https://');
      if (!url || !/^https?:\/\//i.test(url)) return;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const name = url.split('/').pop()?.split('?')[0] || 'picture';
        await placeFiles(app, [new File([blob], name, { type: blob.type })]);
      } catch (e: any) { toast(`Could not fetch the picture: ${e?.message || e}. Download it and use Insert ▸ Picture.`, { ms: 7000 }); }
    },
  },
  {
    id: 'insert.screenshot', label: 'Screenshot', icon: 'screenshot_monitor', tab: 'Insert', group: 'Pictures', edits: true,
    tip: 'Capture a window or screen (the browser asks which) and place it as a picture',
    run: async (app) => {
      const md: any = navigator.mediaDevices;
      if (!md?.getDisplayMedia) { toast('Screen capture is not available here. Take a screenshot with the system and paste it.'); return; }
      let stream: MediaStream | null = null;
      try {
        stream = await md.getDisplayMedia({ video: true });
        const video = document.createElement('video');
        video.srcObject = stream; await video.play();
        await new Promise((r) => setTimeout(r, 300));
        const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d')!.drawImage(video, 0, 0);
        const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
        if (blob) await placeFiles(app, [new File([blob], 'Screenshot.png', { type: 'image/png' })]);
      } catch (e: any) { if (e?.name !== 'NotAllowedError') toast(`Screenshot: ${e?.message || e}`); }
      finally { stream?.getTracks().forEach((t) => t.stop()); }
    },
  },
  // Illustrations
  {
    id: 'insert.shape', label: 'Shapes', icon: 'shapes', tab: 'Insert', group: 'Illustrations', kind: 'gallery', popular: true, edits: true,
    menu: () => shapeEntries(),
    run: (app, geom?: string) => {
      if (!geom || !GEOMETRY[geom]) { showMenu(shapeEntries(), { anchor: app.ui.anchorFor('insert.shape'), onPick: (e) => app.exec('insert.shape', e.arg) }); return; }
      const d = GEOMETRY[geom];
      tool(app, d.label, (b) => makeShape(geom, b), { w: 120, h: 120, line: d.group === 'Lines' });
    },
  },
  { id: 'insert.line', label: 'Line', icon: 'horizontal_rule', tab: 'Insert', group: 'Illustrations', keys: ['\\'], edits: true, run: (app) => tool(app, 'Line', (b) => ({ id: newId('ln'), kind: 'line', name: 'Line', x: b.x, y: b.y, w: b.w, h: b.h, line: { fill: { type: 'solid', color: 'Black' }, width: 1 } }), { w: 200, h: 0, line: true }) },
  { id: 'insert.rectangle', label: 'Rectangle', icon: 'rectangle', tab: 'Insert', group: 'Illustrations', keys: ['m'], edits: true, run: (app) => app.exec('insert.shape', 'rect') },
  { id: 'insert.ellipse', label: 'Ellipse', icon: 'circle', tab: 'Insert', group: 'Illustrations', keys: ['l'], edits: true, run: (app) => app.exec('insert.shape', 'ellipse') },
  { id: 'insert.polygon', label: 'Polygon', icon: 'hexagon', tab: 'Insert', group: 'Illustrations', edits: true, kind: 'menu', menu: () => ['triangle', 'diamond', 'pentagon', 'hexagon', 'heptagon', 'octagon'].filter((g) => GEOMETRY[g]).map((g) => ({ id: 'insert.shape', arg: g, label: GEOMETRY[g].label })), run: (app) => app.exec('insert.shape', GEOMETRY.hexagon ? 'hexagon' : 'pentagon') },
  { id: 'insert.star', label: 'Star', icon: 'star', tab: 'Insert', group: 'Illustrations', edits: true, kind: 'menu', menu: () => Object.keys(GEOMETRY).filter((g) => GEOMETRY[g].group === 'Stars and Banners').map((g) => ({ id: 'insert.shape', arg: g, label: GEOMETRY[g].label })), run: (app) => app.exec('insert.shape', GEOMETRY.star5 ? 'star5' : Object.keys(GEOMETRY).find((g) => GEOMETRY[g].group === 'Stars and Banners')) },
  { id: 'insert.arrow', label: 'Arrow', icon: 'arrow_forward', tab: 'Insert', group: 'Illustrations', edits: true, kind: 'menu', menu: () => Object.keys(GEOMETRY).filter((g) => GEOMETRY[g].group === 'Block Arrows').map((g) => ({ id: 'insert.shape', arg: g, label: GEOMETRY[g].label })), run: (app) => app.exec('insert.shape', GEOMETRY.rightArrow ? 'rightArrow' : Object.keys(GEOMETRY).find((g) => GEOMETRY[g].group === 'Block Arrows')) },
  {
    id: 'insert.arrowLine', label: 'Arrow Line', icon: 'north_east', tab: 'Insert', group: 'Illustrations', edits: true,
    run: (app) => tool(app, 'Arrow', (b) => ({ id: newId('ln'), kind: 'line', name: 'Arrow', x: b.x, y: b.y, w: b.w, h: b.h, line: { fill: { type: 'solid', color: 'Black' }, width: 1.5, head: 'triangle' } }), { w: 200, h: 0, line: true }),
  },
  // Tables
  {
    id: 'insert.table', label: 'Table', icon: 'table', tab: 'Insert', group: 'Tables', popular: true, edits: true,
    run: async (app, arg?: { rows: number; cols: number }) => {
      const r = arg || await openDialog({ title: 'Insert Table', fields: [{ key: 'cols', label: 'Columns', type: 'number', min: 1, max: 30, value: 3, half: true }, { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 200, value: 4, half: true }] });
      if (!r) return;
      const b = placeNew(app, 400, 22 * Math.max(1, +r.rows));
      insertItem(app, makeTable(app, Math.max(1, +r.rows), Math.max(1, +r.cols), b), 'Insert Table');
    },
  },
  { id: 'insert.drawTable', label: 'Draw Table', icon: 'table_view', tab: 'Insert', group: 'Tables', edits: true, tip: 'Drag the table\'s outline; it gets 3 columns and 4 rows to start', run: (app) => tool(app, 'Table', (b) => makeTable(app, 4, 3, b), { w: 400, h: 88 }) },
  {
    id: 'insert.tableFromText', label: 'Table from Text…', icon: 'table_rows', tab: 'Insert', group: 'Tables', edits: true,
    tip: 'Paste tab-, comma- or semicolon-separated text (from a spreadsheet, for example)',
    run: async (app) => {
      const r = await openDialog({ title: 'Table from Text', wide: true, fields: [{ key: 't', label: 'Rows (one per line; cells separated by tabs, commas or semicolons)', type: 'textarea', rows: 10, value: '' }, { key: 'header', label: 'First row is a header', type: 'checkbox', value: true }] });
      if (!r?.t?.trim()) return;
      const data = parseTsv(r.t);
      const cols = Math.max(...data.map((x) => x.length));
      const b = placeNew(app, 400, 22 * data.length);
      const t = makeTable(app, data.length, cols, b, data);
      if (!r.header) { t.rows[0].header = false; t.style!.firstRow = false; for (const c of t.rows[0].cells) c.text[0].style = 'Table Text'; }
      insertItem(app, t, 'Table from Text');
    },
  },
  // Fields
  { id: 'insert.pageNumber', label: 'Page Number', icon: 'pin', tab: 'Insert', group: 'Pages', keys: ['Mod-Alt-Shift-n'], popular: true, edits: true, tip: 'The current page\'s number (on a master page: the number of each page that uses it)', run: (app) => field(app, 'pagenum', app.page ? app.pub.pageLabel(app.pub.pageIndex(app.page.id)) || '1' : '1') },
  { id: 'insert.pageCount', label: 'Page Count', icon: 'tag', tab: 'Insert', group: 'Pages', edits: true, run: (app) => field(app, 'pagecount', String(app.pub.pages.length)) },
  { id: 'insert.sectionMarker', label: 'Section Name', icon: 'bookmark', tab: 'Insert', group: 'Pages', edits: true, tip: 'The name of the section the page is in (Page Design ▸ Sections)', run: (app) => field(app, 'section', app.pub.data.sections[0]?.name || 'Section') },
  { id: 'insert.nextPage', label: 'Next Page Number', icon: 'last_page', tab: 'Insert', group: 'Fields', edits: true, tip: '"Continued on page N": the page the story continues on', run: (app) => field(app, 'nextpage', '2') },
  { id: 'insert.prevPage', label: 'Previous Page Number', icon: 'first_page', tab: 'Insert', group: 'Fields', edits: true, tip: '"Continued from page N"', run: (app) => field(app, 'prevpage', '1') },
  { id: 'insert.titleField', label: 'Publication Title', icon: 'title', tab: 'Insert', group: 'Fields', edits: true, tip: 'The title from File ▸ Properties, kept up to date', run: (app) => field(app, 'title', app.pub.data.props.title || app.tab.title || 'Title') },
  {
    id: 'insert.dateTime', label: 'Date and Time', icon: 'event', tab: 'Insert', group: 'Fields', kind: 'menu', edits: true,
    menu: () => { const d = new Date(); return [...DATE_FORMATS.map((f, i) => ({ id: 'insert.dateTime', arg: i, label: f.fmt(d) })), { separator: true }, { id: 'insert.dateTime', arg: 'static', label: 'Today as plain text' }]; },
    run: (app, which?: number | string) => {
      const d = new Date();
      if (which === 'static') { insertTextAtCaret(app, DATE_FORMATS[0].fmt(d)); return; }
      const f = DATE_FORMATS[typeof which === 'number' ? which : 0] || DATE_FORMATS[0];
      field(app, f.label.includes('AM') ? 'time' : 'date', f.fmt(d), String(DATE_FORMATS.indexOf(f)));
    },
  },
  {
    id: 'insert.variable', label: 'Text Variable', icon: 'data_object', tab: 'Insert', group: 'Fields', kind: 'menu', edits: true, origin: 'Text variables (FrameMaker)',
    tip: 'Text that is defined once and used in many places (a product name, an issue date…)',
    menu: (app) => [...app.pub.data.variables.map((v) => ({ id: 'insert.variable', arg: v.name, label: `${v.name} = ${v.value}` })), ...(app.pub.data.variables.length ? [{ separator: true }] : []), { id: 'page.variables', label: 'Define Variables…' }],
    run: async (app, name?: string) => {
      let v: Variable | undefined = app.pub.data.variables.find((x) => x.name === name);
      if (!v) {
        const r = await openDialog({ title: 'Text Variable', fields: [{ key: 'name', label: 'Name', type: 'combo', options: app.pub.data.variables.map((x) => x.name), value: name || '' }, { key: 'value', label: 'Value', type: 'text', value: '' }] });
        if (!r?.name) return;
        v = app.pub.data.variables.find((x) => x.name === r.name);
        if (!v) { v = { name: r.name, value: r.value || '' }; app.pub.transact('Define Variable', () => app.pub.data.variables.push(v!)); }
      }
      field(app, 'variable', v.value, v.name);
    },
  },
  // Symbols
  {
    id: 'insert.symbol', label: 'Symbol', icon: 'special_character', tab: 'Insert', group: 'Symbols', edits: true,
    run: async (app, ch?: string) => {
      if (ch) { insertTextAtCaret(app, ch); return; }
      let picked: string | null = null;
      const grid = h('div', { class: 'ql-symbol-grid' });
      for (const s of SYMBOLS) grid.appendChild(h('button', { class: 'ql-symbol', type: 'button', onclick: () => { picked = s; (grid.closest('.ql-dialog')?.querySelector('.ql-dialog-ok') as HTMLButtonElement | null)?.click(); } }, s));
      const r = await openDialog({ title: 'Symbol', content: grid, fields: [{ key: 'code', label: 'Or a Unicode code point (hex), e.g. 2318', type: 'text', value: '' }], ok: 'Insert' });
      if (!r) return;
      const code = String(r.code || '').trim();
      const text = picked || (code ? String.fromCodePoint(parseInt(code.replace(/^u\+?/i, ''), 16)) : '');
      if (text) insertTextAtCaret(app, text);
    },
  },
  {
    id: 'insert.emoji', label: 'Emoji', icon: 'mood', tab: 'Insert', group: 'Symbols', edits: true,
    run: async (app, ch?: string) => {
      if (ch) { insertTextAtCaret(app, ch); return; }
      let picked: string | null = null;
      const grid = h('div', { class: 'ql-symbol-grid' });
      for (const s of EMOJI) grid.appendChild(h('button', { class: 'ql-symbol', type: 'button', onclick: () => { picked = s; (grid.closest('.ql-dialog')?.querySelector('.ql-dialog-ok') as HTMLButtonElement | null)?.click(); } }, s));
      const r = await openDialog({ title: 'Emoji', content: grid, ok: 'Insert' });
      if (r && picked) insertTextAtCaret(app, picked);
    },
  },
  {
    id: 'insert.specialChar', label: 'Special Characters', icon: 'keyboard_option_key', tab: 'Insert', group: 'Symbols', kind: 'menu', edits: true,
    menu: () => SPECIALS.map((s, i) => ({ id: 'insert.specialChar', arg: i, label: s.label })),
    run: (app, i?: number) => { const s = SPECIALS[typeof i === 'number' ? i : 0]; if (!s) return; if (s.ch === '\n') { const ed = activeTextEditor(); if (ed) ed.insertRun({ text: '', br: true }); else insertTextAtCaret(app, '\n'); return; } insertTextAtCaret(app, s.ch); },
  },
  {
    id: 'insert.equation', label: 'Equation', icon: 'function', tab: 'Insert', group: 'Symbols', edits: true,
    tip: 'Type an equation in plain notation (x^2, a/b, sqrt(x), alpha, <=, !=, inf, sum, int); it is set with Unicode math characters',
    run: async (app) => {
      const r = await openDialog({ title: 'Equation', fields: [{ key: 'e', label: 'Equation', type: 'text', value: 'E = m c^2' }], help: 'Supported: ^ for superscripts, _ for subscripts, Greek letter names, sqrt(), <=, >=, !=, ->, inf, sum, prod, int, +-, * for ×, / stays a slash.' });
      if (!r?.e) return;
      const sup: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', 'n': 'ⁿ', 'i': 'ⁱ', '(': '⁽', ')': '⁾' };
      const sub: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', 'n': 'ₙ', 'i': 'ᵢ', 'x': 'ₓ', 'a': 'ₐ', 'e': 'ₑ', '(': '₍', ')': '₎' };
      const greek: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', Pi: 'Π', Theta: 'Θ', inf: '∞', sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇', deg: '°' };
      let t = String(r.e);
      t = t.replace(/sqrt\(([^)]*)\)/g, (_m, x) => `√(${x})`).replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠').replace(/->/g, '→').replace(/\+-/g, '±').replace(/\*/g, '×').replace(/~=/g, '≈');
      t = t.replace(/\b([A-Za-z]+)\b/g, (m) => greek[m] || m);
      t = t.replace(/\^\(([^)]*)\)|\^(\S)/g, (_m, a, b) => [...(a ?? b)].map((c: string) => sup[c] || c).join(''));
      t = t.replace(/_\(([^)]*)\)|_(\S)/g, (_m, a, b) => [...(a ?? b)].map((c: string) => sub[c] || c).join(''));
      insertTextAtCaret(app, t, { font: 'Tinos', i: true });
    },
  },
  {
    id: 'insert.codeBlock', label: 'Code Block', icon: 'code', tab: 'Insert', group: 'Symbols', edits: true,
    run: async (app) => {
      const ed = activeTextEditor();
      const text = ed?.selectedText() || 'console.log("hello");';
      if (ed && ed.selectedText()) { applyRun(app, 'Code', { cstyle: 'Code' }); return; }
      textFrameTool(app, { text, style: 'Body No Indent', w: 300, h: 80, place: true, after: (f) => { f.ostyle = 'Accent Box'; f.insets = [8, 8, 8, 8]; const s = app.pub.story(f.story); if (s) for (const p of s.paras) { p.align = 'l'; p.hyphenate = false; for (const rr of p.runs) rr.cstyle = 'Code'; } } });
    },
  },
  // Links
  {
    id: 'insert.link', label: 'Link', icon: 'link', tab: 'Insert', group: 'Links', keys: ['Mod-k'], popular: true, edits: true,
    tip: 'A web address on the selected text or object (kept in PDF and web exports)',
    run: async (app) => {
      const ed = activeTextEditor();
      const sel = selection(app);
      const cur = ed ? currentRun(app).link : sel[0]?.link;
      const r = await openDialog({ title: 'Link', fields: [{ key: 'url', label: 'Address (https://…, mailto:…, or #page-3 for a page)', type: 'text', value: cur || 'https://' }] });
      if (!r) return;
      const url = String(r.url).trim();
      if (ed) { applyRun(app, 'Link', { link: url || undefined, u: url ? true : undefined, color: url ? 'Primary' : undefined }); return; }
      if (!sel.length) { toast('Select text or an object first.'); return; }
      edit(app, 'Link', () => { for (const e of sel) e.link = url || undefined; });
    },
  },
  { id: 'insert.removeLink', label: 'Remove Link', icon: 'link_off', tab: 'Insert', group: 'Links', edits: true, run: (app) => { if (activeTextEditor()) { applyRun(app, 'Remove Link', { link: undefined, u: undefined, color: undefined }); return; } const sel = selection(app); edit(app, 'Remove Link', () => { for (const e of sel) delete e.link; }); } },
  {
    id: 'insert.bookmark', label: 'Bookmark', icon: 'bookmark_add', tab: 'Insert', group: 'Links', edits: true,
    tip: 'Name the selected object so links (#name) and the Navigator can jump to it',
    run: async (app) => { const e = selection(app)[0]; if (!e) { toast('Select an object first.'); return; } const n = await promptDialog('Bookmark', 'Name', e.name || ''); if (n == null) return; edit(app, 'Bookmark', () => { e.name = n; e.tags = { ...(e.tags || {}), bookmark: n }; }); },
  },
  { id: 'insert.comment', label: 'Comment', icon: 'add_comment', tab: 'Insert', group: 'Links', edits: true, run: (app) => app.exec('review.newComment') },
  {
    id: 'insert.indexMarker', label: 'Index Entry', icon: 'format_list_numbered_rtl', tab: 'Insert', group: 'Links', edits: true, origin: 'Index markers (Ventura Publisher, FrameMaker)',
    tip: 'Mark the caret position with an index term; Insert ▸ Generate Index lists every term with its page',
    run: async (app) => {
      const ed = activeTextEditor();
      const term = await promptDialog('Index Entry', 'Term (use "Topic: subtopic" for a second level)', ed?.selectedText() || '');
      if (!term?.trim()) return;
      if (ed) { ed.insertRun({ text: '', field: 'variable', varName: `index:${term.trim()}` }); return; }
      field(app, 'variable', '', `index:${term.trim()}`);
    },
  },
  {
    id: 'insert.index', label: 'Generate Index', icon: 'manage_search', tab: 'Insert', group: 'Links', edits: true,
    tip: 'A frame listing every index entry alphabetically with its page numbers',
    run: (app) => {
      const pub = app.pub;
      const entries = new Map<string, Set<string>>();
      for (const [pi, pg] of pub.pages.entries()) for (const e of pg.items) {
        if (e.kind !== 'text') continue;
        const s = pub.story(e.story);
        if (!s) continue;
        for (const p of s.paras) for (const r of p.runs) if (r.field === 'variable' && r.varName?.startsWith('index:')) { const t = r.varName.slice(6); if (!entries.has(t)) entries.set(t, new Set()); entries.get(t)!.add(pub.pageLabel(pi) || String(pi + 1)); }
      }
      if (!entries.size) { toast('No index entries yet. Use Insert ▸ Index Entry to mark terms.'); return; }
      const paras: Paragraph[] = [{ style: 'Heading 1', runs: [{ text: 'Index' }] }];
      for (const [t, pages] of [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) paras.push({ style: 'Body No Indent', marL: t.includes(':') ? 14 : 0, runs: [{ text: `${t.split(':').pop()!.trim()}, ${[...pages].join(', ')}` }] });
      const f = pub.newTextFrame(placeNew(app, 300, Math.min(pub.size.h * 0.7, 18 * paras.length + 30)), paras);
      f.name = 'Index'; f.columns = 2;
      insertItem(app, f, 'Generate Index');
    },
  },
]);
