/**
 * FrameMaker Maker Interchange Format (.mif): a documented text format of nested statements,
 * `<Name args…>`, with strings in backtick-quote marks. Imported: page size, body pages with their
 * text rectangles (frames) and columns, text flows as stories chained through the rectangles they
 * run through, paragraph formats from the catalog (alignment, indents, spacing, leading, font) and
 * inline font changes (family, size, weight, angle, underline).
 */
import { Pub, newId } from '../model/pub';
import type { Page, ParaStyle, Paragraph, Run, RunProps, TextFrame } from '../model/types';

export interface MifImport { pub: Pub; warnings: string[] }

interface Node { name: string; args: (string | number | Node)[] }

/** Parses MIF text into a list of top-level statements. */
export function parseMif(text: string): Node[] {
  const src = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^\s*&/, ' ')).join('\n');
  let i = 0;
  const n = src.length;
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      break;
    }
  };
  const readString = (): string => {
    // `text' with \' \` \\ \xNN escapes and FrameMaker's \t \n \q \Q
    i++; // opening backtick
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === "'") { i++; break; }
      if (c === '\\') {
        const d = src[i + 1];
        if (d === 'x') { const hex = src.slice(i + 2, i + 4); const code = parseInt(hex, 16); if (!Number.isNaN(code)) s += String.fromCharCode(code); i += 4; if (src[i] === ' ') i++; continue; }
        s += d === 't' ? '\t' : d === 'n' ? '\n' : d === 'q' ? "'" : d === 'Q' ? '`' : d === '>' ? '>' : d || '';
        i += 2;
        continue;
      }
      s += c; i++;
    }
    return s;
  };
  const readNode = (): Node | null => {
    if (src[i] !== '<') return null;
    i++;
    let name = '';
    while (i < n && /[A-Za-z0-9_]/.test(src[i])) name += src[i++];
    const node: Node = { name, args: [] };
    for (;;) {
      skip();
      if (i >= n) break;
      const c = src[i];
      if (c === '>') { i++; break; }
      if (c === '<') { const child = readNode(); if (child) node.args.push(child); continue; }
      if (c === '`') { node.args.push(readString()); continue; }
      let tok = '';
      while (i < n && !/[\s<>]/.test(src[i])) tok += src[i++];
      if (!tok) { i++; continue; }
      const num = /^[-+]?\d*\.?\d+$/.test(tok) ? parseFloat(tok) : NaN;
      node.args.push(Number.isNaN(num) ? tok : num);
    }
    return node;
  };
  const out: Node[] = [];
  for (;;) {
    skip();
    if (i >= n) break;
    if (src[i] === '<') { const nd = readNode(); if (nd) out.push(nd); } else i++;
  }
  return out;
}

const child = (n: Node, name: string): Node | undefined => n.args.find((a): a is Node => typeof a === 'object' && a.name === name);
const children = (n: Node, name: string): Node[] => n.args.filter((a): a is Node => typeof a === 'object' && a.name === name);
const str = (n: Node | undefined, idx = 0): string => { const v = n?.args[idx]; return typeof v === 'string' ? v : v == null ? '' : String(typeof v === 'object' ? '' : v); };

/** A measurement with its unit ("8.5\"", "72 pt", "2.0 cm", "1 in", bare numbers are points). */
export function mifPoints(args: (string | number | Node)[], idx: number): number {
  const v = args[idx];
  const unitTok = args[idx + 1];
  const num = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (Number.isNaN(num)) return 0;
  const u = typeof v === 'string' ? v.replace(/^[-+\d.]+/, '') : typeof unitTok === 'string' && /^(pt|in|cm|mm|pc|dd|cc|")$/.test(unitTok) ? unitTok : '';
  switch (u) {
    case '"': case 'in': return num * 72;
    case 'cm': return num * 72 / 2.54;
    case 'mm': return num * 72 / 25.4;
    case 'pc': return num * 12;
    case 'dd': return num * 1.07;
    case 'cc': return num * 12.84;
    default: return num;
  }
}
/** The index of the next value when a value carries a separate unit token. */
function stepOf(args: (string | number | Node)[], idx: number): number {
  const v = args[idx], u = args[idx + 1];
  return typeof v === 'number' && typeof u === 'string' && /^(pt|in|cm|mm|pc|dd|cc)$/.test(u) ? 2 : 1;
}

function fontProps(f: Node | undefined): RunProps {
  const r: RunProps = {};
  if (!f) return r;
  const fam = str(child(f, 'FFamily'));
  if (fam) r.font = fam;
  const size = child(f, 'FSize');
  if (size) { const s = mifPoints(size.args, 0); if (s > 0) r.size = s; }
  const weight = str(child(f, 'FWeight'));
  if (weight) r.b = /bold|black|heavy|semibold|demi/i.test(weight);
  const angle = str(child(f, 'FAngle'));
  if (angle) r.i = /italic|oblique/i.test(angle);
  const ul = str(child(f, 'FUnderlining'));
  if (ul) r.u = ul !== 'FNoUnderlining';
  const strike = str(child(f, 'FStrike'));
  if (strike) r.strike = strike === 'Yes';
  const caps = str(child(f, 'FCase'));
  if (caps === 'FAsTyped') r.caps = 'none'; else if (caps === 'FUppercase') r.caps = 'all'; else if (caps === 'FSmallCaps') r.caps = 'small';
  const pos = str(child(f, 'FPosition'));
  if (pos === 'FSuperscript') r.baseline = 33; else if (pos === 'FSubscript') r.baseline = -33;
  const color = str(child(f, 'FColor'));
  if (color) r.color = color;
  return r;
}

function pgfStyle(p: Node, name: string): ParaStyle {
  const st: ParaStyle = { name };
  const al = str(child(p, 'PgfAlignment'));
  if (al) st.align = al === 'Center' ? 'ctr' : al === 'Right' ? 'r' : al === 'LeftRight' ? 'just' : 'l';
  const li = child(p, 'PgfLIndent'); if (li) st.marL = mifPoints(li.args, 0) || undefined;
  const ri = child(p, 'PgfRIndent'); if (ri) st.marR = mifPoints(ri.args, 0) || undefined;
  const fi = child(p, 'PgfFIndent'); if (fi) { const v = mifPoints(fi.args, 0); st.indent = v - (st.marL || 0) || undefined; }
  const sb = child(p, 'PgfSpBefore'); if (sb) st.spaceBefore = mifPoints(sb.args, 0) || undefined;
  const sa = child(p, 'PgfSpAfter'); if (sa) st.spaceAfter = mifPoints(sa.args, 0) || undefined;
  const font = fontProps(child(p, 'PgfFont'));
  if (Object.keys(font).length) st.run = font;
  const lead = child(p, 'PgfLeading');
  if (lead && font.size) { st.lineSpacing = font.size + mifPoints(lead.args, 0); st.lineSpacingPt = true; }
  const hyph = str(child(p, 'PgfHyphenate'));
  if (hyph) st.hyphenate = hyph === 'Yes';
  const next = str(child(p, 'PgfNextTag'));
  if (next) st.next = next;
  const num = str(child(p, 'PgfNumString'));
  if (num && /^[•·-]/.test(num)) st.bullet = { kind: 'char', char: num.trim().charAt(0) };
  for (const k of Object.keys(st)) if ((st as any)[k] === undefined) delete (st as any)[k];
  return st;
}

export function importMif(text: string, name: string): MifImport {
  const warnings: string[] = [];
  const nodes = parseMif(text);
  if (!nodes.some((n) => n.name === 'MIFFile')) throw new Error('Not a MIF file (no <MIFFile> statement).');
  const docNode = nodes.find((n) => n.name === 'Document');
  const sizeNode = docNode && child(docNode, 'DPageSize');
  const size = sizeNode ? { w: mifPoints(sizeNode.args, 0) || 612, h: mifPoints(sizeNode.args, stepOf(sizeNode.args, 0)) || 792 } : { w: 612, h: 792 };
  const pub = Pub.blank(size, { pages: 1 });
  const P = pub.data;
  // Paragraph catalog
  const cat = nodes.find((n) => n.name === 'PgfCatalog');
  const styleNames = new Set<string>();
  for (const p of cat ? children(cat, 'Pgf') : []) {
    const tag = str(child(p, 'PgfTag'));
    if (!tag) continue;
    styleNames.add(tag);
    const st = pgfStyle(p, tag);
    const ex = P.styles.para.find((s) => s.name === tag);
    if (ex) Object.assign(ex, st); else P.styles.para.push(st);
  }
  // Body pages and their text rectangles
  const rects = new Map<number, { frame: TextFrame; page: Page }>();
  P.pages = [];
  for (const pg of nodes.filter((n) => n.name === 'Page')) {
    const type = str(child(pg, 'PageType'));
    if (type && type !== 'BodyPage') continue;
    const page: Page = { id: newId('pg'), master: P.masters[0].id, items: [] };
    P.pages.push(page);
    for (const tr of children(pg, 'TextRect')) {
      const id = Number(str(child(tr, 'ID')) || child(tr, 'ID')?.args[0]);
      const sr = child(tr, 'ShapeRect');
      if (!sr) continue;
      let k = 0;
      const vals: number[] = [];
      for (let q = 0; q < 4; q++) { vals.push(mifPoints(sr.args, k)); k += stepOf(sr.args, k); }
      const story = pub.newStory([]);
      const f: TextFrame = { id: newId('tf'), kind: 'text', story: story.id, x: vals[0], y: vals[1], w: Math.max(12, vals[2]), h: Math.max(12, vals[3]), insets: [0, 0, 0, 0] };
      const cols = child(tr, 'TRColumns'); if (cols && typeof cols.args[0] === 'number' && cols.args[0] > 1) { f.columns = cols.args[0]; const gap = child(tr, 'TRColumnGap'); if (gap) f.gutter = mifPoints(gap.args, 0); }
      page.items.push(f);
      if (Number.isFinite(id)) rects.set(id, { frame: f, page });
    }
  }
  if (!P.pages.length) P.pages.push({ id: newId('pg'), master: P.masters[0].id, items: [] });
  // Text flows
  let flows = 0, looseParas: Paragraph[] = [];
  for (const tf of nodes.filter((n) => n.name === 'TextFlow')) {
    const paras: Paragraph[] = [];
    const chain: number[] = [];
    for (const pa of children(tf, 'Para')) {
      const tag = str(child(pa, 'PgfTag'));
      const local = child(pa, 'Pgf');
      const para: Paragraph = { style: tag && styleNames.has(tag) ? tag : 'Body', runs: [] };
      if (local) { const st = pgfStyle(local, tag || 'Body'); delete (st as any).name; delete (st as any).run; Object.assign(para, st); }
      let run: RunProps = {};
      for (const line of children(pa, 'ParaLine')) {
        const rid = child(line, 'TextRectID');
        if (rid && typeof rid.args[0] === 'number' && !chain.includes(rid.args[0])) chain.push(rid.args[0]);
        for (const a of line.args) {
          if (typeof a !== 'object') continue;
          if (a.name === 'String') { const t = str(a); if (t) para.runs.push({ ...run, text: t } as Run); }
          else if (a.name === 'Font') { const fp = fontProps(a); run = str(child(a, 'FTag')) === '' && !Object.keys(fp).length ? {} : { ...run, ...fp }; if (str(child(a, 'FTag')) && !Object.keys(fp).length) run = {}; }
          else if (a.name === 'Char') { const c = str(a); if (c === 'Tab') para.runs.push({ ...run, text: '\t' }); else if (c === 'HardReturn') para.runs.push({ text: '', br: true }); else if (c === 'HardSpace') para.runs.push({ ...run, text: ' ' }); else if (c === 'Bullet') para.runs.push({ ...run, text: '•' }); else if (c === 'EmDash') para.runs.push({ ...run, text: '—' }); else if (c === 'EnDash') para.runs.push({ ...run, text: '–' }); }
          else if (a.name === 'Variable' || a.name === 'XRef') { const t = str(child(a, 'VariableName')) || str(child(a, 'XRefName')); if (t) para.runs.push({ ...run, text: `[${t}]` }); }
        }
      }
      paras.push(para);
    }
    if (!paras.length) continue;
    flows++;
    const frames = chain.map((id) => rects.get(id)).filter((r): r is { frame: TextFrame; page: Page } => !!r);
    if (!frames.length) { looseParas.push(...paras); continue; }
    const story = pub.newStory(paras, str(child(tf, 'TFTag')) || undefined);
    frames.forEach((r, i) => {
      // The rectangle's placeholder story is replaced by the flow's story.
      r.frame.story = story.id;
      if (i > 0) { r.frame.prev = frames[i - 1].frame.id; frames[i - 1].frame.next = r.frame.id; }
    });
  }
  if (looseParas.length) {
    const [mt, mr, mb, ml] = P.masters[0].margins;
    const f = pub.newTextFrame({ x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb }, looseParas);
    const page: Page = { id: newId('pg'), master: P.masters[0].id, items: [f] };
    P.pages.push(page);
    warnings.push('A text flow was not tied to a text rectangle; its paragraphs were placed on a new page.');
  }
  pub.pruneStories();
  if (!flows) warnings.push('The MIF file has no text flows; only its pages and frames were read.');
  else warnings.push(`${flows} text flow${flows > 1 ? 's' : ''} imported. Tables, anchored frames, graphics and master pages are not read from MIF yet.`);
  P.props.title = name.replace(/\.[^.]+$/, '');
  return { pub, warnings };
}
