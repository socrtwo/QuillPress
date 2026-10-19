/**
 * Text placed into frames: plain text, Markdown (headings and lists become styles), RTF (text and
 * basic bold/italic), Word .docx (paragraphs with heading styles) and HTML (block structure).
 */
import type { Paragraph, Run } from '../model/types';
import { decodeXml, parseXml, desc, kids } from './xml';
import { extractTextFromRtf } from './recover/salvage';

export interface TextImport { paras: Paragraph[]; warnings: string[] }

const para = (text: string, style = 'Body', runs?: Run[]): Paragraph => ({ style, runs: runs || (text ? [{ text }] : []) });

export function textToParas(text: string): Paragraph[] {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').map((l) => para(l.trimEnd()));
}

/** Markdown: # headings, lists, quotes, emphasis. */
export function markdownToParas(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let inCode = false;
  for (const raw of lines) {
    if (/^```/.test(raw)) { inCode = !inCode; continue; }
    if (inCode) { out.push({ style: 'Body', runs: [{ text: raw, font: 'Cousine', size: 9 }] }); continue; }
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { out.push(para('')); continue; }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { const n = m[1].length; out.push(para('', n === 1 ? 'Heading 1' : n === 2 ? 'Heading 2' : 'Heading 3', inlineRuns(m[2]))); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) { out.push(para('', 'Bullet List', inlineRuns(m[1]))); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { out.push(para('', 'Numbered List', inlineRuns(m[1]))); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { out.push(para('', 'Pull Quote', inlineRuns(m[1]))); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) continue;
    out.push(para('', 'Body', inlineRuns(line)));
  }
  return out;
}

/** Inline Markdown: **bold**, *italic*, `code`, [text](url). */
export function inlineRuns(s: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[2] != null) runs.push({ text: m[2], b: true });
    else if (m[4] != null) runs.push({ text: m[4], i: true });
    else if (m[5] != null) runs.push({ text: m[5], font: 'Cousine' });
    else if (m[6] != null) runs.push({ text: m[6], link: m[7] });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.filter((r) => r.text);
}

/** RTF: paragraphs with bold and italic. */
export function rtfToParas(rtf: string): Paragraph[] {
  const out: Paragraph[] = [];
  let cur: Paragraph = para('');
  let b = false, i = false;
  let text = '';
  const stack: { b: boolean; i: boolean }[] = [];
  const flushRun = () => { if (text) { cur.runs.push({ text, ...(b ? { b: true } : {}), ...(i ? { i: true } : {}) }); text = ''; } };
  const flushPara = () => { flushRun(); out.push(cur); cur = para(''); };
  let k = 0;
  let skipGroup = 0;
  while (k < rtf.length) {
    const ch = rtf[k];
    if (ch === '{') { stack.push({ b, i }); if (skipGroup) skipGroup++; k++; continue; }
    if (ch === '}') { const s = stack.pop(); if (s) { flushRun(); b = s.b; i = s.i; } if (skipGroup) skipGroup--; k++; continue; }
    if (ch === '\\') {
      const m = /^\\([a-z]+)(-?\d+)?[ ]?|^\\'([0-9a-f]{2})|^\\([^a-z])/i.exec(rtf.slice(k, k + 40));
      if (!m) { k++; continue; }
      k += m[0].length;
      if (skipGroup) continue;
      if (m[3]) { text += String.fromCharCode(parseInt(m[3], 16)); continue; }
      if (m[4]) { if (m[4] === '\\' || m[4] === '{' || m[4] === '}') text += m[4]; else if (m[4] === '~') text += ' '; else if (m[4] === '*') { skipGroup = 1; } continue; }
      const w = m[1], n = m[2];
      if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'object', 'listtable', 'listoverridetable'].includes(w)) { skipGroup = 1; continue; }
      if (w === 'par' || w === 'line') { if (w === 'line') { flushRun(); cur.runs.push({ text: '', br: true }); } else flushPara(); continue; }
      if (w === 'b') { flushRun(); b = n !== '0'; continue; }
      if (w === 'i') { flushRun(); i = n !== '0'; continue; }
      if (w === 'u' && n) { text += String.fromCharCode(+n < 0 ? +n + 65536 : +n); if (rtf[k] === '?') k++; continue; }
      if (w === 'tab') { text += '\t'; continue; }
      continue;
    }
    if (ch === '\r' || ch === '\n') { k++; continue; }
    if (!skipGroup) text += ch;
    k++;
  }
  flushPara();
  while (out.length > 1 && !out[out.length - 1].runs.length) out.pop();
  return out.length ? out : [para('')];
}

/** Word .docx: paragraphs, heading styles, bold/italic runs, list paragraphs. */
export async function docxToParas(data: Uint8Array): Promise<TextImport> {
  const JSZip = (await import('jszip')).default;
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(data);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('The document has no word/document.xml.');
  const doc = parseXml(decodeXml(await f.async('uint8array')));
  if (!doc) throw new Error('The document XML could not be read.');
  const out: Paragraph[] = [];
  for (const p of desc(doc, 'p')) {
    const styleEl = desc(p, 'pStyle')[0];
    const sid = (styleEl?.getAttribute('w:val') || '').toLowerCase();
    const style = /^heading1|^title/.test(sid) ? 'Heading 1' : /^heading2|^subtitle/.test(sid) ? 'Heading 2' : /^heading[3-9]/.test(sid) ? 'Heading 3' : desc(p, 'numPr').length ? 'Bullet List' : /quote/.test(sid) ? 'Pull Quote' : 'Body';
    const runs: Run[] = [];
    for (const r of desc(p, 'r')) {
      const rPr = kids(r).find((k) => k.localName === 'rPr');
      const b = !!rPr && kids(rPr).some((k) => k.localName === 'b' && k.getAttribute('w:val') !== '0' && k.getAttribute('w:val') !== 'false');
      const i = !!rPr && kids(rPr).some((k) => k.localName === 'i' && k.getAttribute('w:val') !== '0' && k.getAttribute('w:val') !== 'false');
      for (const c of kids(r)) {
        if (c.localName === 't') { const t = c.textContent || ''; if (t) runs.push({ text: t, ...(b ? { b: true } : {}), ...(i ? { i: true } : {}) }); }
        else if (c.localName === 'tab') runs.push({ text: '\t' });
        else if (c.localName === 'br') runs.push({ text: '', br: true });
      }
    }
    out.push({ style, runs });
  }
  if (desc(doc, 'tbl').length) warnings.push('Tables in the document were imported as plain paragraphs.');
  if (zip.file(/word\/media\//).length) warnings.push('Pictures in the document were not placed; insert them with Insert ▸ Picture.');
  return { paras: out.length ? out : [para('')], warnings };
}

/** HTML: block elements become paragraphs with heading and list styles. */
export function htmlToParas(html: string): Paragraph[] {
  const out: Paragraph[] = [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (el: Element, style: string) => {
    for (const c of el.children) {
      const t = c.tagName.toLowerCase();
      if (['script', 'style', 'head', 'nav', 'noscript'].includes(t)) continue;
      if (/^h[1-6]$/.test(t)) { out.push(para('', t === 'h1' ? 'Heading 1' : t === 'h2' ? 'Heading 2' : 'Heading 3', inlineRunsHtml(c))); continue; }
      if (t === 'p' || t === 'blockquote' || t === 'pre') { out.push(para('', t === 'blockquote' ? 'Pull Quote' : style, inlineRunsHtml(c))); continue; }
      if (t === 'li') { out.push(para('', el.tagName.toLowerCase() === 'ol' ? 'Numbered List' : 'Bullet List', inlineRunsHtml(c))); continue; }
      if (t === 'br') continue;
      if (c.children.length) walk(c, style);
      else if (c.textContent?.trim()) out.push(para('', style, inlineRunsHtml(c)));
    }
  };
  walk(doc.body, 'Body');
  return out.length ? out : textToParas(doc.body.textContent || '');
}

function inlineRunsHtml(el: Element): Run[] {
  const runs: Run[] = [];
  const walk = (n: Node, props: Partial<Run>) => {
    if (n.nodeType === 3) { const t = (n.nodeValue || '').replace(/\s+/g, ' '); if (t) runs.push({ ...props, text: t }); return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === 'br') { runs.push({ text: '', br: true }); return; }
    const np = { ...props };
    if (tag === 'b' || tag === 'strong') np.b = true;
    if (tag === 'i' || tag === 'em') np.i = true;
    if (tag === 'u') np.u = true;
    if (tag === 'code') np.font = 'Cousine';
    if (tag === 'a' && e.getAttribute('href')) np.link = e.getAttribute('href')!;
    if (tag === 'li' || tag === 'p' || /^h\d$/.test(tag)) { if (runs.length) runs.push({ text: '', br: true }); }
    for (const c of e.childNodes) walk(c, np);
  };
  for (const c of el.childNodes) walk(c, {});
  // Trim leading/trailing spaces.
  if (runs[0]?.text) runs[0].text = runs[0].text.replace(/^\s+/, '');
  const last = runs[runs.length - 1];
  if (last?.text) last.text = last.text.replace(/\s+$/, '');
  return runs.filter((r) => r.text || r.br);
}

export async function importTextFile(data: Uint8Array, name: string, format?: string): Promise<TextImport> {
  const fmt = format || (/\.docx$/i.test(name) ? 'docx' : /\.rtf$/i.test(name) ? 'rtf' : /\.(md|markdown)$/i.test(name) ? 'md' : /\.html?$/i.test(name) ? 'html' : 'txt');
  if (fmt === 'docx') return docxToParas(data);
  const text = decodeXml(data);
  if (fmt === 'rtf') {
    try { return { paras: rtfToParas(text), warnings: [] }; }
    catch { return { paras: textToParas(extractTextFromRtf(data)), warnings: ['The RTF could not be read fully; its plain text was placed.'] }; }
  }
  if (fmt === 'md') return { paras: markdownToParas(text), warnings: [] };
  if (fmt === 'html') return { paras: htmlToParas(text), warnings: [] };
  return { paras: textToParas(text), warnings: [] };
}
