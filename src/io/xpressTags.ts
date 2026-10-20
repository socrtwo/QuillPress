/**
 * XPress Tags (.xtg): QuarkXPress's documented tagged-text export. A header names the version and
 * encoding (<v6.00><e0>), `@name=…` lines define paragraph style sheets, `@name:` applies one to a
 * paragraph, and <…> tags carry character and paragraph attributes. Imported: style definitions
 * (alignment, indents, leading, space before/after, size, font), paragraphs with their styles, and
 * runs with bold, italic, underline, strike, caps, superscript/subscript, size, font and color.
 */
import { Pub, newId } from '../model/pub';
import type { ParaStyle, Paragraph, Run, RunProps, ParaProps } from '../model/types';

export interface XtgImport { pub: Pub; warnings: string[] }

/** Decodes the bytes in the encoding the header names (Mac Roman by default). */
export function decodeXtg(data: Uint8Array): string {
  const head = String.fromCharCode(...data.subarray(0, 64));
  const enc = /<e(\d)>/.exec(head)?.[1];
  const utf8 = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf || enc === '8' || enc === '9';
  let label = utf8 ? 'utf-8' : enc === '1' ? 'windows-1252' : enc === '2' ? 'iso-8859-1' : 'macintosh';
  if (!enc && !utf8) {
    // No header: valid UTF-8 with multibyte sequences is more likely than Mac Roman with the same bytes.
    try { const t = new TextDecoder('utf-8', { fatal: true }).decode(data); if (/[\u0080-￿]/.test(t)) return t; } catch { /* not UTF-8 */ }
    label = /[\x80-\xff]/.test(head) ? 'macintosh' : 'utf-8';
  }
  try { return new TextDecoder(label).decode(data); } catch { return new TextDecoder().decode(data); }
}

interface State extends RunProps { }

/** Parses one tag body ("BI", "z12f\"Times\"", "*C", "\\n") against the run and paragraph state. */
function applyTag(body: string, run: State, base: State, para: ParaProps, out: Run[], paraEnd: () => void): void {
  let i = 0;
  const readQuoted = (): string => { if (body[i] !== '"') return ''; const j = body.indexOf('"', i + 1); const s = body.slice(i + 1, j < 0 ? body.length : j); i = j < 0 ? body.length : j + 1; return s; };
  const readNum = (): number => { const m = /^[-+]?\d*\.?\d+/.exec(body.slice(i)); if (!m) return NaN; i += m[0].length; return parseFloat(m[0]); };
  while (i < body.length) {
    const c = body[i++];
    switch (c) {
      case 'B': run.b = !run.b; break;
      case 'I': run.i = !run.i; break;
      case 'U': case 'W': run.u = !run.u; break;
      case '/': run.strike = !run.strike; break;
      case 'K': run.caps = run.caps === 'all' ? 'none' : 'all'; break;
      case 'H': run.caps = run.caps === 'small' ? 'none' : 'small'; break;
      case '+': run.baseline = run.baseline === 33 ? 0 : 33; break;
      case '-': run.baseline = run.baseline === -33 ? 0 : -33; break;
      case 'P': for (const k of Object.keys(run)) delete (run as any)[k]; Object.assign(run, base); break;
      case '$': for (const k of Object.keys(run)) delete (run as any)[k]; break;
      case 'O': case 'S': break; // outline, shadow: no equivalent
      case 'z': { const n = readNum(); if (n > 0) run.size = n; break; }
      case 'f': { const f = readQuoted(); if (f) run.font = f; break; }
      case 'c': { const col = readQuoted(); if (col) run.color = col === 'Paper' ? 'White' : col; break; }
      case 'k': readNum(); break;
      case 't': { const n = readNum(); if (!Number.isNaN(n)) run.spc = Math.round(((run.size || 10) * n) / 200 * 100) / 100; break; }
      case 's': case 'y': case 'h': case 'b': case 'x': readNum(); break;
      case 'a': readQuoted(); break;
      case 'G': case 'L': case 'g': readNum(); break;
      case 'n': readNum(); break;
      case 'p': case 'o': readNum(); break;
      case 'e': readNum(); break;
      case 'v': readNum(); break;
      case '*': {
        const d = body[i++];
        if (d === 'L') para.align = 'l'; else if (d === 'C') para.align = 'ctr'; else if (d === 'R') para.align = 'r'; else if (d === 'J') para.align = 'just'; else if (d === 'F') para.align = 'justAll';
        else if (d === 'p' && body[i] === '(') {
          const j = body.indexOf(')', i);
          const v = body.slice(i + 1, j < 0 ? body.length : j).split(',').map((s) => parseFloat(s));
          i = j < 0 ? body.length : j + 1;
          if (v[0]) para.marL = v[0];
          if (v[1]) para.indent = v[1];
          if (v[2]) para.marR = v[2];
          if (v[3]) { para.lineSpacing = v[3]; para.lineSpacingPt = true; }
          if (v[4]) para.spaceBefore = v[4];
          if (v[5]) para.spaceAfter = v[5];
        } else if (d === 'h') { readQuoted(); para.hyphenate = true; }
        else if (d === 'd' || d === 't' || d === 'r') { if (body[i] === '(') { const j = body.indexOf(')', i); i = j < 0 ? body.length : j + 1; } else { readNum(); } }
        else if (d === 'k' || d === 'n') { readNum(); }
        else if (d === 'a' || d === 'b') { if (body[i] === '(') { const j = body.indexOf(')', i); i = j < 0 ? body.length : j + 1; } }
        break;
      }
      case '\\': {
        const d = body[i++];
        if (d === 'n') out.push({ text: '', br: true });
        else if (d === 't') out.push({ ...run, text: '\t' });
        else if (d === '#') { const n = readNum(); if (!Number.isNaN(n)) out.push({ ...run, text: String.fromCharCode(n) }); }
        else if (d === '<' || d === '@' || d === '\\') out.push({ ...run, text: d });
        else if (d === 'c' || d === 'b' || d === 'p') paraEnd();
        else if (d === 'q') out.push({ ...run, text: '“' }); else if (d === 'Q') out.push({ ...run, text: '”' }); else if (d === "'") out.push({ ...run, text: '’' });
        else if (d === 'd') out.push({ ...run, text: '–' }); else if (d === 'm') out.push({ ...run, text: '—' });
        else if (d === 'z') out.push({ ...run, text: '⁠' }); else if (d === 'i') out.push({ ...run, text: '­' });
        else if (d === 'r') out.push({ text: '', br: true });
        break;
      }
      default: break;
    }
  }
}

/** A style definition line: @Name=[S"","Based"]<attrs> → ParaStyle. */
function defineStyle(name: string, def: string): ParaStyle {
  const st: ParaStyle = { name };
  const m = /^\[S"([^"]*)"(?:,"([^"]*)")?(?:,"([^"]*)")?\]/.exec(def);
  let rest = def;
  if (m) { if (m[1]) st.basedOn = m[1]; if (m[2] && m[2] !== name) st.next = m[2]; rest = def.slice(m[0].length); }
  const run: RunProps = {}, para: ParaProps = {};
  const tag = /^<(.*)>$/s.exec(rest.trim());
  if (tag) applyTag(tag[1], run as State, {}, para, [], () => undefined);
  Object.assign(st, para);
  if (Object.keys(run).length) st.run = run;
  return st;
}

export function importXpressTags(data: Uint8Array, name: string): XtgImport {
  const warnings: string[] = [];
  const text = decodeXtg(data).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const pub = Pub.blank();
  const P = pub.data;
  const paras: Paragraph[] = [];
  const styles = new Map<string, ParaStyle>();
  let curStyle = 'Body';
  for (const rawLine of text.split('\n')) {
    let line = rawLine.replace(/^<v\d+(\.\d+)?><e\d>/, '');
    if (line !== rawLine && !line.trim()) continue; // the version header on its own line
    if (!line.trim() && !rawLine.trim()) { paras.push({ style: curStyle, runs: [] }); continue; }
    // Style definition
    const def = /^@([^=:]+)=(.*)$/.exec(line);
    if (def && /^\[S|^<|^\[/.test(def[2].trim())) {
      const nm = def[1] === '$' ? 'Normal' : def[1];
      const st = defineStyle(nm, def[2].trim());
      styles.set(nm, st);
      const ex = P.styles.para.find((s) => s.name === nm);
      if (ex) Object.assign(ex, st); else P.styles.para.push(st);
      continue;
    }
    // Style application
    const app = /^@([^:<]*):/.exec(line);
    if (app) { curStyle = app[1] === '$' || app[1] === '$p' || app[1] === '' ? 'Body' : app[1]; line = line.slice(app[0].length); }
    const para: Paragraph = { style: styles.has(curStyle) || P.styles.para.some((s) => s.name === curStyle) ? curStyle : 'Body', runs: [] };
    const base: State = {};
    const run: State = {};
    const pp: ParaProps = {};
    let i = 0;
    const flushPara = () => { Object.assign(para, pp); paras.push({ ...para, runs: [...para.runs] }); para.runs = []; };
    while (i < line.length) {
      const c = line[i];
      if (c === '<') {
        // A tag runs to the first '>' outside quotes.
        let j = i + 1, q = false;
        while (j < line.length && (q || line[j] !== '>')) { if (line[j] === '"') q = !q; if (line[j] === '\\' && !q) j++; j++; }
        const body = line.slice(i + 1, j);
        applyTag(body, run, base, pp, para.runs, flushPara);
        i = j + 1;
        continue;
      }
      let k = i;
      while (k < line.length && line[k] !== '<') k++;
      const t = line.slice(i, k);
      if (t) { const last = para.runs[para.runs.length - 1]; const r: Run = { ...run, text: t }; if (last && !last.br && last.text && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ ...r, text: '' })) last.text += t; else para.runs.push(r); }
      i = k;
    }
    for (const r of para.runs) for (const kk of Object.keys(r)) if ((r as any)[kk] === undefined || (r as any)[kk] === false || (r as any)[kk] === 0) delete (r as any)[kk];
    Object.assign(para, pp);
    for (const kk of Object.keys(para)) if ((para as any)[kk] === undefined) delete (para as any)[kk];
    paras.push(para);
  }
  // Drop a trailing empty paragraph left by a final newline.
  while (paras.length > 1 && !paras[paras.length - 1].runs.length) paras.pop();
  if (!paras.length) throw new Error('The XPress Tags file has no text.');
  const [mt, mr, mb, ml] = P.masters[0].margins;
  const f = pub.newTextFrame({ x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb }, paras);
  f.name = name.replace(/\.[^.]+$/, '');
  pub.pages[0].items.push(f);
  P.props.title = f.name;
  const ver = /<v(\d+(?:\.\d+)?)>/.exec(text.slice(0, 32))?.[1];
  warnings.push(`XPress Tags${ver ? ` (version ${ver})` : ''}: ${paras.length} paragraph${paras.length > 1 ? 's' : ''} and ${styles.size} style sheet${styles.size === 1 ? '' : 's'} placed in a frame that flows onto new pages; QuarkXPress's page geometry is not part of the format.`);
  return { pub, warnings };
}
