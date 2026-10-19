/**
 * Recovery of damaged publications (docs/RECOVERY.md). Methods run in order; the candidate with
 * the most recovered content wins. Descends from the author's Immortal Zip (byte-level ZIP salvage
 * and ImmortalInflate), XML Truncator-Fixer and Word Recovery tools.
 */
import { Pub, newId } from '../../model/pub';
import type { Paragraph, Page, Item } from '../../model/types';
import { analyze, type FileIdReport, type Segment, type S2Program } from './fileid';
import { scanZipBytes, balanceXml, stringsScan, textQuality, extractTextFromRtf } from './salvage';
import { b64, dec } from '../xml';

export type MethodStatus = 'success' | 'partial' | 'failed' | 'skipped';
export type MethodId = 'identify' | 'open' | 'zip' | 'json' | 'sla' | 'media' | 'text' | 'strings';

export interface MethodResult { id: MethodId; name: string; desc: string; status: MethodStatus; detail?: string; pages?: number; words?: number; pictures?: number }

export type PublicationKind = 'qpp' | 'qppe' | 'json' | 'sla' | 'zip' | 'text' | 'other' | 'unknown';

export interface RepairedPackage { kind: 'qpp' | 'sla'; blob: Blob; name: string; repairedParts: string[]; salvagedParts: string[]; lostParts: string[] }

export interface RecoveryStats { pages: number; items: number; pictures: number; words: number }

export interface RecoveryReport {
  fileName: string;
  kind: PublicationKind;
  identification: { description: string; confidence: string; ext: string };
  methods: MethodResult[];
  bestMethod: MethodId | null;
  pub: Pub | null;
  summary: string;
  notes: string[];
  unverified: boolean;
  textOnly: boolean;
  foreign: Segment[];
  recommended: S2Program[];
  repaired: RepairedPackage | null;
  stats: RecoveryStats;
}

export interface RecoverOptions { forceRepair?: boolean; password?: string }

const METHODS: Record<MethodId, [string, string]> = {
  identify: ['File identification', 'Identifies the bytes and separates concatenated or embedded data.'],
  open: ['Normal open', 'The regular reader; damaged parts are skipped.'],
  zip: ['ZIP salvage', 'Reads every entry from its local header and inflates damaged data with ImmortalInflate.'],
  json: ['JSON repair', 'Cuts the publication data at the last complete object and closes what is open.'],
  sla: ['Scribus XML repair', 'Heals the XML, cuts it at the last complete object, and reads it again.'],
  media: ['Picture harvest', 'Pictures that survive in the file but belong to no recovered frame.'],
  text: ['Text scan', 'Text fragments of the stories, placed in plain frames.'],
  strings: ['Strings scan', 'Readable text runs from the raw bytes (last resort).'],
};

export function pubStats(pub: Pub | null): RecoveryStats {
  if (!pub) return { pages: 0, items: 0, pictures: 0, words: 0 };
  let items = 0, pictures = 0;
  const walk = (els: Item[]) => { for (const e of els) { items++; if (e.kind === 'picture' && e.media) pictures++; if (e.kind === 'group') walk(e.children); } };
  for (const p of pub.pages) walk(p.items);
  const words = pub.data.stories.reduce((a, s) => a + s.paras.map((p) => p.runs.map((r) => r.text).join('')).join(' ').split(/\s+/).filter(Boolean).length, 0);
  return { pages: pub.pages.length, items, pictures, words };
}

const score = (s: RecoveryStats, weight: number) => (s.pages * 10 + s.items * 5 + s.pictures * 8 + s.words) * weight;

/** Repairs damaged JSON text: strips garbage, cuts at the last complete value, balances brackets. */
export function repairJsonText(text: string): string | null {
  let t = text.replace(/^﻿/, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  t = t.slice(start);
  for (let attempt = 0; attempt < 400; attempt++) {
    const fixed = closeJson(t);
    try { JSON.parse(fixed); return fixed; } catch { /* cut further back */ }
    // Cut back to the previous comma at depth > 0 or the previous closing bracket.
    const cut = Math.max(t.lastIndexOf(','), t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (cut <= 0) return null;
    t = t.slice(0, cut);
  }
  return null;
}

function closeJson(t: string): string {
  // Remove an unterminated string, then close open brackets.
  let inStr = false, esc = false;
  const stack: string[] = [];
  let lastGood = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') { inStr = false; lastGood = i + 1; } continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); lastGood = i + 1; }
    else if (!/\s/.test(c)) lastGood = i + 1;
  }
  let out = inStr ? t.slice(0, t.lastIndexOf('"')) : t;
  out = out.replace(/[,:\s]+$/, '');
  // A dangling key ("name":) at the end: drop it.
  out = out.replace(/,?\s*"[^"]*"\s*:?\s*$/, '');
  // Recount brackets after trimming.
  const st: string[] = [];
  inStr = false; esc = false;
  for (const c of out) {
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') st.push('}'); else if (c === '[') st.push(']'); else if (c === '}' || c === ']') st.pop();
  }
  void lastGood;
  return out + st.reverse().join('');
}

/** Picture bytes found by signature scanning the raw file. */
export function harvestMediaBytes(u8: Uint8Array, max = 200): { mime: string; data: Uint8Array }[] {
  const out: { mime: string; data: Uint8Array }[] = [];
  const at = (i: number, sig: number[]) => sig.every((b, k) => u8[i + k] === b);
  for (let i = 0; i < u8.length - 8 && out.length < max; i++) {
    if (at(i, [0x89, 0x50, 0x4e, 0x47])) {
      const end = indexOf(u8, [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], i);
      if (end > 0) { out.push({ mime: 'image/png', data: u8.slice(i, end + 8) }); i = end + 7; }
    } else if (at(i, [0xff, 0xd8, 0xff])) {
      const end = indexOf(u8, [0xff, 0xd9], i + 3);
      if (end > 0 && end - i > 200) { out.push({ mime: 'image/jpeg', data: u8.slice(i, end + 2) }); i = end + 1; }
    } else if (at(i, [0x47, 0x49, 0x46, 0x38])) {
      const end = indexOf(u8, [0x00, 0x3b], i + 6);
      if (end > 0) { out.push({ mime: 'image/gif', data: u8.slice(i, end + 2) }); i = end + 1; }
    }
  }
  return out;
}

function indexOf(u8: Uint8Array, sig: number[], from: number): number {
  outer: for (let i = from; i <= u8.length - sig.length; i++) { for (let k = 0; k < sig.length; k++) if (u8[i + k] !== sig[k]) continue outer; return i; }
  return -1;
}

/** A publication of plain pages holding the given paragraphs (text-only recovery). */
export function pubFromText(text: string, title: string): Pub {
  const pub = Pub.blank();
  const paras: Paragraph[] = text.replace(/\r\n?/g, '\n').split('\n').map((l) => ({ style: 'Body', runs: l.trim() ? [{ text: l }] : [] }));
  const [mt, mr, mb, ml] = pub.data.masters[0].margins;
  const f = pub.newTextFrame({ x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb }, paras);
  f.name = title;
  pub.pages[0].items.push(f);
  return pub;
}

async function tryOpen(data: Uint8Array, name: string, password?: string): Promise<Pub> {
  const { importPublication } = await import('../index');
  return (await importPublication(data, name, { noRecovery: true, password })).pub;
}

export async function recoverPublication(data: Uint8Array | ArrayBuffer, name: string, opts: RecoverOptions = {}): Promise<RecoveryReport> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const methods: MethodResult[] = [];
  const notes: string[] = [];
  const add = (id: MethodId, status: MethodStatus, detail?: string, extra: Partial<MethodResult> = {}) => { const m: MethodResult = { id, name: METHODS[id][0], desc: METHODS[id][1], status, detail, ...extra }; methods.push(m); return m; };
  const candidates: { id: MethodId; pub: Pub; weight: number; textOnly?: boolean; unverified?: boolean }[] = [];

  // a. Identification
  let ident: FileIdReport;
  try { ident = analyze(bytes, name); } catch (e: any) { ident = { fileName: name, primary: { ext: 'bin', description: 'Unreadable', confidence: 'low' }, segments: [], matching: [], foreign: [], multiple: false, mismatch: true, proceedBytes: bytes } as any; }
  const ext = ident.primary?.ext || 'bin';
  const kind: PublicationKind = ext === 'qpp' ? 'qpp' : ext === 'sla' ? 'sla' : ext === 'json' ? 'json' : ext === 'zip' ? 'zip' : ['txt', 'rtf', 'html', 'docx', 'xml'].includes(ext) ? 'text' : ext === 'bin' ? 'unknown' : 'other';
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head === 'QFDE1') {
    add('identify', 'success', 'Encrypted QuillPress publication (.qppe). Encrypted data cannot be repaired without the password; try opening it with the password first.');
    return finish('qppe', null);
  }
  add('identify', ident.multiple ? 'partial' : 'success', `${ident.primary.description} (${ident.primary.confidence} confidence)${ident.multiple ? `; ${ident.segments.length} pieces found inside the file` : ''}`);
  if (ident.mismatch && ident.foreign.length && !ident.matching.length) notes.push(`The file is ${ident.primary.description}, which QuillPress does not open; its pieces can be saved below.`);
  const work = ident.proceedBytes || bytes;

  // b. Normal open
  if (!opts.forceRepair) {
    try { const pub = await tryOpen(work, name, opts.password); const st = pubStats(pub); add('open', 'success', `${st.pages} pages, ${st.words} words`, st as any); candidates.push({ id: 'open', pub, weight: 1.2 }); }
    catch (e: any) { add('open', 'failed', e?.message || String(e)); }
  } else {
    try { const pub = await tryOpen(work, name, opts.password); const st = pubStats(pub); add('open', 'success', `${st.pages} pages, ${st.words} words (opened normally; every method still ran)`, st as any); candidates.push({ id: 'open', pub, weight: 1.2 }); }
    catch (e: any) { add('open', 'failed', e?.message || String(e)); }
  }

  // c. ZIP salvage (.qpp)
  let repaired: RepairedPackage | null = null;
  if (kind === 'qpp' || kind === 'zip' || (work[0] === 0x50 && work[1] === 0x4b)) {
    try {
      const entries = scanZipBytes(work);
      const pj = entries.get('publication.json');
      if (!pj) add('zip', 'failed', `${entries.size} entries found, but no publication.json`);
      else {
        let text = dec(pj.data);
        let json: any = null;
        let repairedJson = false;
        try { json = JSON.parse(text); } catch { const fixed = repairJsonText(text); if (fixed) { json = JSON.parse(fixed); repairedJson = true; } }
        if (!json) add('zip', 'failed', 'publication.json could not be repaired');
        else {
          const media: Record<string, any> = {};
          const lost: string[] = [], salvaged: string[] = [];
          for (const [id, info] of Object.entries<any>(json.mediaIndex || {})) {
            const e = entries.get(`media/${id}`);
            if (e) { media[id] = { mime: info.mime, b64: b64(e.data), name: info.name, w: info.w, h: info.h }; if (e.isCorrupt) salvaged.push(`media/${id}`); }
            else lost.push(`media/${id}`);
          }
          const pub = Pub.fromJSON({ format: 'quillpress', version: 1, data: json.data, media });
          const st = pubStats(pub);
          add('zip', pj.isCorrupt || repairedJson || lost.length ? 'partial' : 'success', `${entries.size} entries; publication.json ${pj.isCorrupt ? 'inflated from damaged data' : 'read'}${repairedJson ? ' and repaired' : ''}; ${lost.length ? `${lost.length} picture(s) lost` : 'all pictures found'}`, st as any);
          candidates.push({ id: 'zip', pub, weight: 1, unverified: pj.isCorrupt || repairedJson });
          const { exportQpp } = await import('../qpp');
          const out = await exportQpp(pub);
          repaired = { kind: 'qpp', blob: new Blob([out as BlobPart], { type: 'application/x-quillpress' }), name: name.replace(/\.[^.]+$/, '') + ' (repaired).qpp', repairedParts: repairedJson ? ['publication.json'] : [], salvagedParts: salvaged, lostParts: lost };
        }
      }
    } catch (e: any) { add('zip', 'failed', e?.message || String(e)); }
  } else add('zip', 'skipped', 'Not a ZIP package');

  // d. JSON repair (.json)
  if (kind === 'json' || /^\s*\{/.test(dec(work.subarray(0, 64)))) {
    try {
      const fixed = repairJsonText(dec(work));
      if (!fixed) add('json', 'failed', 'No complete JSON object could be rebuilt');
      else {
        const j = JSON.parse(fixed);
        const pub = Pub.fromJSON(j.data ? j : { format: 'quillpress', version: 1, data: j, media: {} });
        const st = pubStats(pub);
        add('json', fixed.length < dec(work).trim().length ? 'partial' : 'success', `Rebuilt ${st.pages} pages, ${st.words} words`, st as any);
        candidates.push({ id: 'json', pub, weight: 0.95, unverified: fixed.length < dec(work).trim().length });
      }
    } catch (e: any) { add('json', 'failed', e?.message || String(e)); }
  } else add('json', 'skipped', 'Not a JSON file');

  // e. Scribus XML repair
  if (kind === 'sla' || /<SCRIBUS/i.test(dec(work.subarray(0, 2048)))) {
    try {
      let xml = dec(work);
      // Cut at the last complete object and close the document.
      const lastObj = Math.max(xml.lastIndexOf('</PAGEOBJECT>'), xml.lastIndexOf('<PAGEOBJECT'), xml.lastIndexOf('</MASTEROBJECT>'), xml.lastIndexOf('<PAGE '), xml.lastIndexOf('<MASTERPAGE '));
      let cut = false;
      if (!/<\/SCRIBUSUTF8NEW>\s*$/.test(xml) && lastObj > 0) {
        const endTag = xml.indexOf('/>', lastObj) >= 0 ? xml.indexOf('/>', lastObj) + 2 : -1;
        const endObj = xml.indexOf('</PAGEOBJECT>', lastObj) >= 0 ? xml.indexOf('</PAGEOBJECT>', lastObj) + 13 : -1;
        const stop = Math.max(endTag, endObj);
        xml = (stop > 0 ? xml.slice(0, stop) : xml.slice(0, lastObj)) + '\n</DOCUMENT></SCRIBUSUTF8NEW>';
        cut = true;
      }
      xml = balanceXml(xml);
      const { importSla } = await import('../sla');
      const r = await importSla(new TextEncoder().encode(xml));
      const st = pubStats(r.pub);
      add('sla', cut ? 'partial' : 'success', `${cut ? 'Truncated document cut at the last complete object; ' : ''}${st.pages} pages, ${st.words} words`, st as any);
      candidates.push({ id: 'sla', pub: r.pub, weight: 1, unverified: cut });
      const { exportSla } = await import('../sla');
      repaired = repaired || { kind: 'sla', blob: new Blob([exportSla(r.pub) as BlobPart], { type: 'application/x-scribus' }), name: name.replace(/\.[^.]+$/, '') + ' (repaired).sla', repairedParts: cut ? ['document'] : [], salvagedParts: [], lostParts: [] };
    } catch (e: any) { add('sla', 'failed', e?.message || String(e)); }
  } else add('sla', 'skipped', 'Not a Scribus document');

  // f. Picture harvest
  let harvested: { mime: string; data: Uint8Array }[] = [];
  try {
    harvested = harvestMediaBytes(work);
    add('media', harvested.length ? 'success' : 'failed', harvested.length ? `${harvested.length} picture(s) found in the raw bytes` : 'No pictures found');
  } catch (e: any) { add('media', 'failed', e?.message || String(e)); }

  // g. Text scan: ITEXT CH="…" (Scribus) or "text":"…" (JSON) fragments.
  try {
    const text = dec(work);
    const frags: string[] = [];
    for (const m of text.matchAll(/<ITEXT[^>]*\bCH="([^"]*)"/g)) frags.push(unescapeXml(m[1]));
    for (const m of text.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) { try { frags.push(JSON.parse(`"${m[1]}"`)); } catch { frags.push(m[1]); } }
    if (ext === 'rtf') frags.push(extractTextFromRtf(work));
    const joined = frags.join(ext === 'sla' ? '' : '\n').trim();
    if (joined.length > 20) {
      const pub = pubFromText(joined, 'Recovered text');
      const st = pubStats(pub);
      add('text', 'partial', `${st.words} words of text recovered`, st as any);
      candidates.push({ id: 'text', pub, weight: 0.4, textOnly: true, unverified: true });
    } else add('text', 'failed', 'No text fragments found');
  } catch (e: any) { add('text', 'failed', e?.message || String(e)); }

  // h. Strings scan
  try {
    const t = stringsScan(work).replace(/[^\S\n]+/g, ' ').trim();
    if (t.length > 40 && textQuality(t) > 0.3) {
      const pub = pubFromText(t, 'Recovered text');
      const st = pubStats(pub);
      add('strings', 'partial', `${st.words} words of readable text`, st as any);
      candidates.push({ id: 'strings', pub, weight: 0.2, textOnly: true, unverified: true });
    } else add('strings', 'failed', 'No readable text');
  } catch (e: any) { add('strings', 'failed', e?.message || String(e)); }

  // Pick the best candidate; add harvested pictures that no frame uses.
  let best = candidates.sort((a, b) => score(pubStats(b.pub), b.weight) - score(pubStats(a.pub), a.weight))[0] || null;
  if (best && harvested.length) {
    const have = new Set(Object.values(best.pub.media).map((m) => m.b64));
    const extra = harvested.filter((hv) => !have.has(b64(hv.data)));
    if (extra.length) {
      const { frameForMedia, imageSize } = await import('../images');
      let page: Page = { id: newId('pg'), master: best.pub.data.masters[0].id, items: [] };
      best.pub.data.pages.push(page);
      let y = 36;
      for (const hv of extra.slice(0, 40)) {
        const size = await imageSize(hv.mime, hv.data).catch(() => ({ w: 300, h: 200 }));
        const id = best.pub.addMedia({ mime: hv.mime, b64: b64(hv.data), name: 'Recovered picture', w: size.w, h: size.h });
        const f = frameForMedia(id, best.pub.media[id], { x: 36, y, w: best.pub.size.w - 72, h: 240 });
        if (y + f.h > best.pub.size.h - 36) { page = { id: newId('pg'), master: best.pub.data.masters[0].id, items: [] }; best.pub.data.pages.push(page); y = 36; f.y = y; }
        page.items.push(f);
        y += f.h + 12;
      }
      const tf = best.pub.newTextFrame({ x: 36, y: 8, w: 300, h: 20 }, [{ style: 'Caption', runs: [{ text: `Recovered pictures (${extra.length})` }] }]);
      best.pub.data.pages[best.pub.data.pages.length - 1].items.unshift(tf);
      notes.push(`${extra.length} picture(s) from the damaged file were placed on recovered-pictures pages.`);
    }
  }
  return finish(kind, best);

  function finish(k: PublicationKind, chosen: typeof best | null): RecoveryReport {
    const stats = pubStats(chosen?.pub || null);
    const summary = !chosen ? 'Nothing could be recovered from this file.' : chosen.textOnly ? `Only text was recovered (${stats.words} words); layout and formatting were lost.` : `Recovered ${stats.pages} page${stats.pages === 1 ? '' : 's'}, ${stats.items} object${stats.items === 1 ? '' : 's'} and ${stats.words} words with ${METHODS[chosen.id][0].toLowerCase()}.`;
    return {
      fileName: name, kind: k, identification: { description: ident.primary?.description || 'Unknown', confidence: ident.primary?.confidence || 'low', ext }, methods, bestMethod: chosen?.id || null,
      pub: chosen?.pub || null, summary, notes, unverified: !!chosen?.unverified, textOnly: !!chosen?.textOnly, foreign: ident.foreign || [], recommended: (ident.foreign || []).flatMap((f) => f.recommended || []).slice(0, 4), repaired, stats,
    };
  }
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
}

export async function recoverPub(data: Uint8Array, name: string, opts: RecoverOptions = {}): Promise<{ pub: Pub; report: RecoveryReport } | null> {
  const report = await recoverPublication(data, name, opts);
  return report.pub ? { pub: report.pub, report } : null;
}

export function reportText(r: RecoveryReport): string {
  const lines = [`QuillPress recovery report: ${r.fileName}`, r.summary, `Identified as: ${r.identification.description} (${r.identification.confidence})`, ''];
  for (const m of r.methods) lines.push(`${m.status.toUpperCase().padEnd(8)} ${m.name}${r.bestMethod === m.id ? ' (used)' : ''}: ${m.detail || ''}`);
  if (r.notes.length) lines.push('', ...r.notes);
  return lines.join('\n');
}
