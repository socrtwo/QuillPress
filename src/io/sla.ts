/**
 * Scribus documents (.sla, versions 1.4 and 1.5): an open XML format. Imported: document size and
 * margins, master pages, pages, text frames with their chains and paragraph/character styles,
 * picture frames (embedded data or a recorded file name), shapes, lines, colors. Exported: the same,
 * written so Scribus 1.5 opens it. Coordinates are points in both models.
 */
import { Pub, newId } from '../model/pub';
import type { Item, Paragraph, Run, Page, Master, Publication, TextFrame } from '../model/types';
import { decodeXml, parseXml, kids, enc } from './xml';
import { escHtml } from '../util/sanitize';
import { hexToCmyk, cmykToHex } from '../model/styles';

export interface SlaImport { pub: Pub; warnings: string[] }

const num = (el: Element, name: string, def = 0): number => { const v = el.getAttribute(name); const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : def; };

export async function importSla(data: Uint8Array): Promise<SlaImport> {
  const warnings: string[] = [];
  const doc = parseXml(decodeXml(data));
  if (!doc) throw new Error('The Scribus file is not well-formed XML.');
  const root = doc.documentElement;
  const d = kids(root).find((k) => k.localName === 'DOCUMENT') || root;
  const pub = Pub.blank({ w: num(d, 'PAGEWIDTH', 612), h: num(d, 'PAGEHEIGHT', 792) });
  const P = pub.data;
  P.facing = num(d, 'BOOK', 0) === 1;
  P.bleed = num(d, 'BleedTop', 0);
  P.unit = ({ 0: 'pt', 1: 'mm', 2: 'in', 3: 'pica', 4: 'cm' } as Record<number, Publication['unit']>)[num(d, 'UNITS', 2)] || 'in';
  if (d.getAttribute('TITLE')) P.props.title = d.getAttribute('TITLE')!;
  if (d.getAttribute('AUTHOR')) P.props.author = d.getAttribute('AUTHOR')!;
  // Colors
  for (const c of kids(d).filter((k) => k.localName === 'COLOR')) {
    const name = c.getAttribute('NAME') || '';
    if (!name) continue;
    let hex = c.getAttribute('RGB') || '';
    const cmyk = c.getAttribute('CMYK');
    if (!hex && cmyk && /^#[0-9a-f]{8}$/i.test(cmyk)) { const v = [1, 3, 5, 7].map((i) => Math.round((parseInt(cmyk.slice(i, i + 2), 16) / 255) * 100)); hex = cmykToHex(v[0], v[1], v[2], v[3]); }
    if (!hex) continue;
    const sw = P.swatches.find((s) => s.name === name);
    if (sw) { sw.color = hex; sw.cmyk = hexToCmyk(hex); } else P.swatches.push({ name, color: hex, cmyk: hexToCmyk(hex) });
  }
  // Styles
  for (const s of kids(d).filter((k) => k.localName === 'STYLE')) {
    const name = s.getAttribute('NAME') || '';
    if (!name) continue;
    const cs = kids(s).find((k) => k.localName === 'CHARSTYLE');
    const run = { ...(s.getAttribute('FONT') ? { font: fontName(s.getAttribute('FONT')!) } : {}), ...(s.getAttribute('FONTSIZE') ? { size: num(s, 'FONTSIZE', 10) } : {}), ...(s.getAttribute('FCOLOR') ? { color: s.getAttribute('FCOLOR')! } : {}), ...(cs?.getAttribute('FONT') ? { font: fontName(cs.getAttribute('FONT')!) } : {}), ...(cs?.getAttribute('FONTSIZE') ? { size: num(cs, 'FONTSIZE', 10) } : {}), ...(cs?.getAttribute('FCOLOR') ? { color: cs.getAttribute('FCOLOR')! } : {}) };
    if (run.font && /bold/i.test(s.getAttribute('FONT') || cs?.getAttribute('FONT') || '')) (run as any).b = true;
    if (/italic/i.test(s.getAttribute('FONT') || cs?.getAttribute('FONT') || '')) (run as any).i = true;
    const align = ({ 0: 'l', 1: 'ctr', 2: 'r', 3: 'just', 4: 'justAll' } as any)[num(s, 'ALIGN', 0)];
    const ex = P.styles.para.find((x) => x.name === name);
    const st = { name, align, marL: num(s, 'INDENT', 0) || undefined, indent: num(s, 'FIRST', 0) || undefined, spaceBefore: num(s, 'VOR', 0) || undefined, spaceAfter: num(s, 'NACH', 0) || undefined, lineSpacing: s.getAttribute('LINESP') ? num(s, 'LINESP', 12) : undefined, lineSpacingPt: !!s.getAttribute('LINESP'), run, basedOn: s.getAttribute('PARENT') || undefined } as any;
    for (const k of Object.keys(st)) if (st[k] === undefined) delete st[k];
    if (ex) Object.assign(ex, st); else P.styles.para.push(st);
  }
  for (const s of kids(d).filter((k) => k.localName === 'CHARSTYLE')) {
    const name = s.getAttribute('CNAME') || s.getAttribute('NAME') || '';
    if (!name) continue;
    const f = s.getAttribute('FONT') || '';
    P.styles.char.push({ name, ...(f ? { font: fontName(f) } : {}), ...(s.getAttribute('FONTSIZE') ? { size: num(s, 'FONTSIZE', 10) } : {}), ...(s.getAttribute('FCOLOR') ? { color: s.getAttribute('FCOLOR')! } : {}), ...(/bold/i.test(f) ? { b: true } : {}), ...(/italic/i.test(f) ? { i: true } : {}) });
  }
  // Masters and pages
  const masters = new Map<string, Master>();
  const mEls = kids(d).filter((k) => k.localName === 'MASTERPAGE');
  if (mEls.length) P.masters = [];
  for (const m of mEls) {
    const name = m.getAttribute('NAM') || 'A-Master';
    const master: Master = { id: newId('mst'), name, items: [], margins: [num(m, 'BORDERTOP', 36), num(m, 'BORDERRIGHT', 36), num(m, 'BORDERBOTTOM', 36), num(m, 'BORDERLEFT', 36)], columns: Math.max(1, num(m, 'AGverticalAutoCount', 1) || 1), gutter: num(m, 'AGverticalAutoGap', 12), side: num(m, 'LEFT', 0) ? 'left' : 'single' };
    const guides: Master['guides'] = [];
    for (const g of (m.getAttribute('HorizontalGuides') || '').split(/\s+/).filter(Boolean)) guides.push({ dir: 'h', pos: +g });
    for (const g of (m.getAttribute('VerticalGuides') || '').split(/\s+/).filter(Boolean)) guides.push({ dir: 'v', pos: +g });
    if (guides.length) master.guides = guides;
    masters.set(name, master);
    P.masters.push(master);
  }
  if (!P.masters.length) P.masters.push({ id: newId('mst'), name: 'A-Master', items: [], margins: [num(d, 'BORDERTOP', 36), num(d, 'BORDERRIGHT', 36), num(d, 'BORDERBOTTOM', 36), num(d, 'BORDERLEFT', 36)], columns: 1, gutter: 12, side: 'single' });
  const pageEls = kids(d).filter((k) => k.localName === 'PAGE');
  P.pages = [];
  const pageByNum = new Map<number, Page>();
  const pageOffsets = new Map<number, { x: number; y: number }>();
  const masterOffsets = new Map<string, { x: number; y: number }>();
  for (const m of mEls) masterOffsets.set(m.getAttribute('NAM') || 'A-Master', { x: num(m, 'PAGEXPOS', 0), y: num(m, 'PAGEYPOS', 0) });
  pageEls.sort((a, b) => num(a, 'NUM', 0) - num(b, 'NUM', 0));
  for (const p of pageEls) {
    const mname = p.getAttribute('MNAM') || '';
    const master = masters.get(mname) || P.masters[0];
    const page: Page = { id: newId('pg'), master: master.id, items: [] };
    const bt = num(p, 'BORDERTOP', NaN);
    if (Number.isFinite(bt)) page.margins = [bt, num(p, 'BORDERRIGHT', 36), num(p, 'BORDERBOTTOM', 36), num(p, 'BORDERLEFT', 36)];
    P.pages.push(page);
    pageByNum.set(num(p, 'NUM', P.pages.length - 1), page);
    pageOffsets.set(num(p, 'NUM', P.pages.length - 1), { x: num(p, 'PAGEXPOS', 0), y: num(p, 'PAGEYPOS', 0) });
  }
  if (!P.pages.length) P.pages.push({ id: newId('pg'), master: P.masters[0].id, items: [] });
  // Objects
  const objEls = kids(d).filter((k) => k.localName === 'PAGEOBJECT' || k.localName === 'MASTEROBJECT');
  const frameById = new Map<string, TextFrame>();
  const links: { frame: TextFrame; next: string }[] = [];
  const groups = new Map<number, Item[]>();
  let pictures = 0, missingPics = 0;
  const missingNames: string[] = [];
  let objectIndex = -1;
  for (const o of objEls) {
    objectIndex++;
    const onMaster = o.localName === 'MASTEROBJECT';
    const ownPage = num(o, 'OwnPage', -1);
    const owner: { items: Item[] } | undefined = onMaster ? masters.get(o.getAttribute('OnMasterPage') || '') || P.masters[0] : pageByNum.get(ownPage) || P.pages[Math.max(0, Math.min(P.pages.length - 1, ownPage))];
    if (!owner) continue;
    const off = onMaster ? masterOffsets.get(o.getAttribute('OnMasterPage') || '') || { x: 0, y: 0 } : pageOffsets.get(ownPage) || { x: 0, y: 0 };
    const x = num(o, 'XPOS', 0) - off.x, y = num(o, 'YPOS', 0) - off.y, w = num(o, 'WIDTH', 100), h = num(o, 'HEIGHT', 100);
    const ptype = num(o, 'PTYPE', 4);
    const rot = num(o, 'ROT', 0) || undefined;
    const base = { x, y, w, h, ...(rot ? { rot } : {}), ...(num(o, 'LOCK', 0) ? { locked: true } : {}), ...(o.getAttribute('ANNAME') ? { name: o.getAttribute('ANNAME')! } : {}) };
    const pcolor = o.getAttribute('PCOLOR'), pcolor2 = o.getAttribute('PCOLOR2');
    const pwidth = num(o, 'PWIDTH', 1);
    const fill = pcolor && pcolor !== 'None' ? { type: 'solid' as const, color: pcolor } : undefined;
    const line = pcolor2 && pcolor2 !== 'None' ? { fill: { type: 'solid' as const, color: pcolor2 }, width: pwidth } : undefined;
    const wrapMode = num(o, 'TEXTFLOWMODE', 0);
    const wrap = wrapMode ? { mode: (wrapMode === 1 ? 'square' : wrapMode === 2 ? 'tight' : 'square') as 'square' | 'tight' } : undefined;
    let item: Item | null = null;
    if (ptype === 4 || ptype === 8) {
      // Text frame (8 = text on path, treated as a text frame)
      const story = pub.newStory(readSlaText(o, pub));
      const f: TextFrame = { id: newId('tf'), kind: 'text', story: story.id, ...base, columns: Math.max(1, num(o, 'COLUMNS', 1)), gutter: num(o, 'COLGAP', 12), insets: [num(o, 'EXTRA', 1), num(o, 'TEXTRA', 1), num(o, 'REXTRA', 1), num(o, 'BEXTRA', 1)], ...(fill ? { fill } : {}), ...(line ? { line } : {}), ...(wrap ? { wrap } : {}) };
      const va = num(o, 'VAlign', 0);
      if (va === 1) f.anchor = 'ctr'; else if (va === 2) f.anchor = 'b';
      // Chains refer to frames by ItemID (1.5), NUMPO, or the object's position in the document (1.4).
      for (const key of [o.getAttribute('ItemID'), o.getAttribute('NUMPO'), String(objectIndex)]) if (key) frameById.set(key, f);
      const next = o.getAttribute('NEXTITEM');
      if (next && next !== '-1') links.push({ frame: f, next });
      item = f;
    } else if (ptype === 2) {
      pictures++;
      const pf: Item = { id: newId('pic'), kind: 'picture', ...base, fit: num(o, 'SCALETYPE', 1) === 0 ? 'fit' : 'stretch', ...(line ? { line } : {}), ...(wrap ? { wrap } : {}) };
      const file = o.getAttribute('PFILE') || '';
      const embedded = o.getAttribute('ImageData');
      if (embedded) {
        try {
          const bytes = Uint8Array.from(atob(embedded.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
          const { mediaFromBytes } = await import('./images');
          const m = await mediaFromBytes(bytes, file || 'picture');
          pf.media = pub.addMedia(m);
        } catch { missingPics++; }
      } else if (file) { pf.src = file; missingPics++; if (missingNames.length < 8) missingNames.push(file.split(/[\\/]/).pop() || file); }
      if (file) pf.src = file;
      item = pf;
    } else if (ptype === 5) {
      item = { id: newId('ln'), kind: 'line', ...base, line: line || { fill: { type: 'solid', color: 'Black' }, width: pwidth } };
    } else if (ptype === 6 || ptype === 7 || ptype === 3) {
      // Polygon / polyline / ellipse-like: use the path when there is one, else a rectangle.
      const pts = (o.getAttribute('path') || '').trim();
      const geom = pts ? 'custom' : (o.getAttribute('ANNAME') || '').toLowerCase().includes('ellipse') ? 'ellipse' : 'rect';
      item = { id: newId('sh'), kind: 'shape', geom, ...base, ...(fill ? { fill } : { fill: { type: 'none' } }), ...(line ? { line } : {}), ...(wrap ? { wrap } : {}), ...(pts ? { path: [{ d: pts, w, h }] } : {}) };
      if (ptype === 7 && item.kind === 'shape') item.fill = { type: 'none' };
    } else if (ptype === 12) {
      // Group: children follow with their own OwnPage; we approximate by a group frame later.
      item = { id: newId('grp'), kind: 'group', ...base, children: [] };
      groups.set(num(o, 'NUMPO', -1), (item as any).children);
    } else if (ptype === 16) {
      const rows = num(o, 'Rows', 1), cols = num(o, 'Columns', 1);
      item = { id: newId('tbl'), kind: 'table', ...base, cols: Array.from({ length: cols }, () => w / cols), rows: Array.from({ length: rows }, () => ({ h: h / rows, cells: Array.from({ length: cols }, () => ({ text: [{ style: 'Table Text', runs: [] }] })) })) };
      warnings.push('Table contents are not imported from Scribus files yet; the table grid was kept.');
    }
    if (!item) continue;
    owner.items.push(item);
  }
  for (const l of links) { const n = frameById.get(l.next); if (n && n !== l.frame) { l.frame.next = n.id; n.prev = l.frame.id; if (n.story !== l.frame.story) { const dead = n.story; for (const f of pub.textFrames()) if (f.story === dead) f.story = l.frame.story; } } }
  // Linked frames shared one story in Scribus (the text is stored on the first): keep the head's text.
  pub.pruneStories();
  if (missingPics) warnings.push(`${missingPics} picture${missingPics > 1 ? 's are' : ' is'} linked to files outside the document (Scribus does not embed them); the frames were kept with the file names (${missingNames.join(', ')}${missingPics > missingNames.length ? ', …' : ''}). Use Tools ▸ Relink Picture.`);
  if (pictures && !missingPics) warnings.push(`${pictures} embedded picture${pictures > 1 ? 's' : ''} imported.`);
  return { pub, warnings };
}

function fontName(f: string): string {
  return f.replace(/\s+(Regular|Bold|Italic|Oblique|Bold Italic|Bold Oblique|Light|Medium|Semibold|Book)$/i, '').trim();
}

/** Paragraphs from a text frame's StoryText (ITEXT runs, para breaks, trail). */
function readSlaText(o: Element, pub: Pub): Paragraph[] {
  const story = kids(o).find((k) => k.localName === 'StoryText');
  const out: Paragraph[] = [];
  let cur: Paragraph = { style: 'Body', runs: [] };
  const defStyle = kids(story || o).find((k) => k.localName === 'DefaultStyle');
  if (defStyle?.getAttribute('PARENT') && pub.paraStyle(defStyle.getAttribute('PARENT')!)) cur.style = defStyle.getAttribute('PARENT')!;
  const defaultStyle = cur.style;
  const nodes = story ? kids(story) : kids(o).filter((k) => k.localName === 'ITEXT' || k.localName === 'para' || k.localName === 'trail' || k.localName === 'breakline' || k.localName === 'tab');
  for (const n of nodes) {
    if (n.localName === 'ITEXT') {
      const text = n.getAttribute('CH') || '';
      const f = n.getAttribute('FONT') || '';
      const run: Run = { text, ...(n.getAttribute('FONTSIZE') ? { size: num(n, 'FONTSIZE', 10) } : {}), ...(f ? { font: fontName(f) } : {}), ...(/bold/i.test(f) ? { b: true } : {}), ...(/italic|oblique/i.test(f) ? { i: true } : {}), ...(n.getAttribute('FCOLOR') ? { color: n.getAttribute('FCOLOR')! } : {}), ...(n.getAttribute('CPARENT') ? { cstyle: n.getAttribute('CPARENT')! } : {}) };
      const feat = n.getAttribute('FEATURES') || '';
      if (/underline/.test(feat)) run.u = true;
      if (/strike/.test(feat)) run.strike = true;
      if (/superscript/.test(feat)) run.baseline = 30;
      if (/subscript/.test(feat)) run.baseline = -25;
      if (/allcaps/.test(feat)) run.caps = 'all';
      if (/smallcaps/.test(feat)) run.caps = 'small';
      if (text) cur.runs.push(run);
    } else if (n.localName === 'para' || n.localName === 'trail') {
      const parent = n.getAttribute('PARENT');
      if (parent && pub.paraStyle(parent)) cur.style = parent;
      const al = n.getAttribute('ALIGN');
      if (al != null) cur.align = ({ 0: 'l', 1: 'ctr', 2: 'r', 3: 'just', 4: 'justAll' } as any)[+al];
      if (n.localName === 'para') { out.push(cur); cur = { style: defaultStyle, runs: [] }; }
    } else if (n.localName === 'breakline') cur.runs.push({ text: '', br: true });
    else if (n.localName === 'tab') cur.runs.push({ text: '\t' });
  }
  if (cur.runs.length || !out.length) out.push(cur);
  return out;
}

// ------------------------------------------------------------------------------------------
// Export

export function exportSla(pub: Pub): Uint8Array {
  const P = pub.data;
  const a = (v: string | number | undefined) => escHtml(String(v ?? ''));
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<SCRIBUSUTF8NEW Version="1.5.8">');
  const m0 = P.masters[0];
  out.push(`<DOCUMENT ANZPAGES="${P.pages.length}" PAGEWIDTH="${P.size.w}" PAGEHEIGHT="${P.size.h}" BORDERLEFT="${m0.margins[3]}" BORDERRIGHT="${m0.margins[1]}" BORDERTOP="${m0.margins[0]}" BORDERBOTTOM="${m0.margins[2]}" ORIENTATION="${P.size.w > P.size.h ? 1 : 0}" PAGESIZE="Custom" FIRSTNUM="1" BOOK="${P.facing ? 1 : 0}" UNITS="${({ pt: 0, mm: 1, in: 2, pica: 3, cm: 4, px: 0 } as any)[P.unit] ?? 2}" BleedTop="${P.bleed}" BleedLeft="${P.bleed}" BleedRight="${P.bleed}" BleedBottom="${P.bleed}" TITLE="${a(P.props.title)}" AUTHOR="${a(P.props.author)}" COMMENTS="${a(P.props.description)}" KEYWORDS="${a(P.props.keywords)}">`);
  for (const sw of P.swatches) if (sw.color !== 'none') out.push(`<COLOR NAME="${a(sw.name)}" RGB="${sw.color}" Spot="${sw.spot ? 1 : 0}" Register="0"/>`);
  for (const st of P.styles.para) {
    const font = st.run?.font ? `${st.run.font} ${st.run.b && st.run.i ? 'Bold Italic' : st.run.b ? 'Bold' : st.run.i ? 'Italic' : 'Regular'}` : '';
    const align = ({ l: 0, ctr: 1, r: 2, just: 3, justAll: 4 } as any)[st.align || 'l'];
    out.push(`<STYLE NAME="${a(st.name)}"${st.basedOn ? ` PARENT="${a(st.basedOn)}"` : ''} ALIGN="${align}" INDENT="${st.marL ?? 0}" FIRST="${st.indent ?? 0}" VOR="${st.spaceBefore ?? 0}" NACH="${st.spaceAfter ?? 0}"${st.lineSpacingPt ? ` LINESPMode="0" LINESP="${st.lineSpacing}"` : ' LINESPMode="1"'}${font ? ` FONT="${a(font)}"` : ''}${st.run?.size ? ` FONTSIZE="${st.run.size}"` : ''}${st.run?.color ? ` FCOLOR="${a(st.run.color)}"` : ''}/>`);
  }
  for (const cs of P.styles.char) out.push(`<CHARSTYLE CNAME="${a(cs.name)}"${cs.font ? ` FONT="${a(cs.font + (cs.b ? ' Bold' : cs.i ? ' Italic' : ' Regular'))}"` : ''}${cs.size ? ` FONTSIZE="${cs.size}"` : ''}${cs.color ? ` FCOLOR="${a(cs.color)}"` : ''}/>`);
  // Scribus places pages in a vertical strip in its canvas space.
  const gap = 40;
  const masterY = new Map<string, number>();
  P.masters.forEach((m, i) => masterY.set(m.id, i * (P.size.h + gap)));
  for (const m of P.masters) {
    const hg = (m.guides || []).filter((g) => g.dir === 'h').map((g) => g.pos).join(' ');
    const vg = (m.guides || []).filter((g) => g.dir === 'v').map((g) => g.pos).join(' ');
    out.push(`<MASTERPAGE PAGEXPOS="0" PAGEYPOS="${masterY.get(m.id)}" PAGEWIDTH="${P.size.w}" PAGEHEIGHT="${P.size.h}" BORDERLEFT="${m.margins[3]}" BORDERRIGHT="${m.margins[1]}" BORDERTOP="${m.margins[0]}" BORDERBOTTOM="${m.margins[2]}" NUM="${P.masters.indexOf(m)}" NAM="${a(m.name)}" MNAM="" Size="Custom" Orientation="${P.size.w > P.size.h ? 1 : 0}" LEFT="${m.side === 'left' ? 1 : 0}" AGverticalAutoCount="${m.columns}" AGverticalAutoGap="${m.gutter}" HorizontalGuides="${hg}" VerticalGuides="${vg}"/>`);
  }
  const pageY = (i: number) => P.masters.length * (P.size.h + gap) + i * (P.size.h + gap);
  P.pages.forEach((p, i) => {
    const m = pub.masterOf(p);
    const g = pub.geometry(p);
    out.push(`<PAGE PAGEXPOS="0" PAGEYPOS="${pageY(i)}" PAGEWIDTH="${P.size.w}" PAGEHEIGHT="${P.size.h}" BORDERLEFT="${g.margins[3]}" BORDERRIGHT="${g.margins[1]}" BORDERTOP="${g.margins[0]}" BORDERBOTTOM="${g.margins[2]}" NUM="${i}" NAM="" MNAM="${a(m.name)}" Size="Custom" Orientation="${P.size.w > P.size.h ? 1 : 0}" LEFT="${pub.pageSide(i) === 'left' ? 1 : 0}" AGverticalAutoCount="${g.columns}" AGverticalAutoGap="${g.gutter}"/>`);
  });
  let numpo = 0;
  const frameNum = new Map<string, number>();
  const all: { item: Item; tag: string; page: number; master?: string; ox: number; oy: number }[] = [];
  P.masters.forEach((m) => { const walk = (items: Item[]) => { for (const e of items) { if (e.kind === 'group') { walk(e.children); continue; } all.push({ item: e, tag: 'MASTEROBJECT', page: -1, master: m.name, ox: 0, oy: masterY.get(m.id)! }); } }; walk(m.items); });
  P.pages.forEach((p, i) => { const walk = (items: Item[]) => { for (const e of items) { if (e.kind === 'group') { walk(e.children); continue; } all.push({ item: e, tag: 'PAGEOBJECT', page: i, ox: 0, oy: pageY(i) }); } }; walk(p.items); });
  for (const o of all) { frameNum.set(o.item.id, numpo++); }
  for (const o of all) {
    const e = o.item;
    const id = frameNum.get(e.id)!;
    const ptype = e.kind === 'text' ? 4 : e.kind === 'picture' ? 2 : e.kind === 'line' ? 5 : e.kind === 'table' ? 16 : 6;
    const fill = e.fill && e.fill.type === 'solid' ? e.fill.color : 'None';
    const lineFill = e.line?.fill && e.line.fill.type === 'solid' ? e.line.fill.color : e.kind === 'line' ? 'Black' : 'None';
    const common = `XPOS="${e.x + o.ox}" YPOS="${e.y + o.oy}" WIDTH="${e.w}" HEIGHT="${e.h}" ROT="${e.rot || 0}" PTYPE="${ptype}" OwnPage="${o.page}"${o.master ? ` OnMasterPage="${a(o.master)}"` : ''} ItemID="${id}" NUMPO="${id}" PCOLOR="${a(fill)}" PCOLOR2="${a(lineFill)}" PWIDTH="${e.line?.width ?? (e.kind === 'line' ? 1 : 0)}" LOCK="${e.locked ? 1 : 0}" ANNAME="${a(e.name)}" TEXTFLOWMODE="${e.wrap?.mode === 'square' ? 1 : e.wrap?.mode === 'tight' ? 2 : 0}"`;
    if (e.kind === 'text') {
      const ins = e.insets || [4, 4, 4, 4];
      const next = e.next ? frameNum.get(e.next) ?? -1 : -1, prev = e.prev ? frameNum.get(e.prev) ?? -1 : -1;
      out.push(`<${o.tag} ${common} COLUMNS="${e.columns || 1}" COLGAP="${e.gutter ?? 12}" EXTRA="${ins[0]}" TEXTRA="${ins[1]}" REXTRA="${ins[2]}" BEXTRA="${ins[3]}" VAlign="${e.anchor === 'ctr' ? 1 : e.anchor === 'b' ? 2 : 0}" NEXTITEM="${next}" BACKITEM="${prev}">`);
      // Only the first frame of a chain carries the text.
      if (!e.prev) {
        const s = pub.story(e.story);
        out.push('<StoryText>');
        out.push(`<DefaultStyle PARENT="${a(s?.paras[0]?.style || 'Body')}"/>`);
        (s?.paras || []).forEach((p, pi, arr) => {
          for (const r of p.runs) {
            if (r.br) { out.push('<breakline/>'); continue; }
            if (r.text === '\t') { out.push('<tab/>'); continue; }
            const feat = [r.u ? 'underline' : '', r.strike ? 'strike' : '', r.baseline && r.baseline > 0 ? 'superscript' : r.baseline && r.baseline < 0 ? 'subscript' : '', r.caps === 'all' ? 'allcaps' : r.caps === 'small' ? 'smallcaps' : ''].filter(Boolean).join(' ');
            out.push(`<ITEXT CH="${a(r.text)}"${r.font ? ` FONT="${a(r.font + (r.b && r.i ? ' Bold Italic' : r.b ? ' Bold' : r.i ? ' Italic' : ' Regular'))}"` : r.b || r.i ? ` FONT="${a((p.style && pub.paraStyle(p.style)?.run?.font) || 'Tinos')} ${r.b && r.i ? 'Bold Italic' : r.b ? 'Bold' : 'Italic'}"` : ''}${r.size ? ` FONTSIZE="${r.size}"` : ''}${r.color ? ` FCOLOR="${a(r.color)}"` : ''}${r.cstyle ? ` CPARENT="${a(r.cstyle)}"` : ''}${feat ? ` FEATURES="${feat}"` : ''}/>`);
          }
          const align = p.align ? ` ALIGN="${({ l: 0, ctr: 1, r: 2, just: 3, justAll: 4 } as any)[p.align]}"` : '';
          out.push(pi < arr.length - 1 ? `<para PARENT="${a(p.style || 'Body')}"${align}/>` : `<trail PARENT="${a(p.style || 'Body')}"${align}/>`);
        });
        out.push('</StoryText>');
      }
      out.push(`</${o.tag}>`);
    } else if (e.kind === 'picture') {
      const m = e.media ? pub.media[e.media] : undefined;
      const fit = e.fit === 'fit' ? 0 : 1;
      out.push(`<${o.tag} ${common} PFILE="${a(e.src || m?.name || '')}" SCALETYPE="${fit}" RATIO="1"${m ? ` ImageData="${m.b64}" inlineImageExt="${a((m.mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg'))}" isInlineImage="1"` : ''}/>`);
    } else if (e.kind === 'shape') {
      const path = e.geom === 'custom' && e.path?.[0] ? e.path[0].d : '';
      out.push(`<${o.tag} ${common}${path ? ` path="${a(path)}"` : ''}/>`);
    } else {
      out.push(`<${o.tag} ${common}/>`);
    }
  }
  out.push('</DOCUMENT>');
  out.push('</SCRIBUSUTF8NEW>');
  return enc(out.join('\n'));
}
