/**
 * Import of page layout files whose formats have no public specification: InDesign binary (.indd),
 * QuarkXPress (.qxp/.qxd/.qxt) and PageMaker (.pmd/.p65/.pm6/.pmt), plus the shared helpers that
 * Microsoft Publisher (src/io/mspub.ts) uses. QuarkXPress 3.1–4.1 and PageMaker 6–7 have layout
 * readers (src/io/qxp, src/io/pagemaker) that this file dispatches to. Everything else, and any file
 * those readers cannot handle, goes through the harvest: the text is recovered from the bytes
 * (UTF-16 or 8-bit runs in the encoding the format uses) and placed in flowing frames, and every
 * picture that survives in the file is placed on its own page. The result is a starting point for
 * re-laying the document out, and the warnings say so.
 *
 * Written from observation of the formats and from the published [MS-CFB] specification; the
 * open-source readers of the Document Liberation Project were consulted as references only.
 */
import { Pub, newId } from '../model/pub';
import type { Page, Paragraph } from '../model/types';
import { textQuality } from './recover/salvage';
import { harvestMediaBytes } from './recover/index';
import { b64 } from './xml';

export type LegacyKind = 'indd' | 'qxp' | 'pmd' | 'pub';
export interface LegacyImport { pub: Pub; warnings: string[]; textOnly: boolean }

export const LEGACY_LABELS: Record<LegacyKind, string> = { indd: 'InDesign document', qxp: 'QuarkXPress document', pmd: 'PageMaker publication', pub: 'Microsoft Publisher publication' };

/** QuarkXPress files carry "MMXPR3"/"IIXPR3" (3.x/4.x, Mac/Windows) at offset 2. */
export function isQxp(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  const s = String.fromCharCode(b[2], b[3], b[4], b[5], b[6], b[7]);
  return /^(MM|II)XPR[0-9]$/.test(s);
}

/** InDesign documents start with the GUID 0606EDF5-D81D-46E5-BD31-EFE7FE74B71D. */
export function isIndd(b: Uint8Array): boolean {
  const sig = [0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7, 0xfe, 0x74, 0xb7, 0x1d];
  return b.length >= 16 && sig.every((v, i) => b[i] === v);
}

/** PageMaker 6–7 publications: a 4-byte endianness mark then the product name within the first kilobytes. */
export function isPageMaker(b: Uint8Array): boolean {
  if (b.length < 64) return false;
  const mark = (b[0] === 0 && b[1] === 0 && b[2] === 0xff && b[3] === 0xff) || (b[0] === 0xff && b[1] === 0xff && b[2] === 0 && b[3] === 0);
  if (b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0 && ((b[6] === 0x99 && b[7] === 0xff) || (b[6] === 0xff && b[7] === 0x99)) && (b[0x2a] === 0x32 || b[0x2a] === 0x33)) return true;
  const cfb = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  if (cfb) { let s = ''; for (let i = 0; i + 1 < Math.min(b.length, 65536); i += 2) s += b[i + 1] === 0 && b[i] >= 32 && b[i] < 127 ? String.fromCharCode(b[i]) : '.'; return /PageMaker/.test(s); }
  if (!mark) return false;
  const head = asciiOf(b, 0, Math.min(b.length, 8192));
  return /PageMaker|Aldus|Adobe PageMaker/.test(head);
}

function asciiOf(b: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let i = from; i < to; i++) { const c = b[i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : '.'; }
  return s;
}

const isTextChar = (c: number) => c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && !(c >= 0xd800 && c <= 0xdfff) && c !== 0xfffe && c !== 0xffff && !(c >= 0xe000 && c <= 0xf8ff));

/** UTF-16 runs of printable characters (little- or big-endian), split into paragraphs at returns. */
export function utf16Runs(b: Uint8Array, minLen = 6, bigEndian = false): string[] {
  const out: string[] = [];
  let cur = '';
  const flush = () => { if (cur.length >= minLen) out.push(...splitParas(cur)); cur = ''; };
  for (let i = 0; i + 1 < b.length; i += 2) {
    const c = bigEndian ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8);
    if (isTextChar(c)) cur += String.fromCharCode(c);
    else flush();
  }
  flush();
  return out;
}

/** 8-bit runs decoded in a legacy encoding (Mac Roman or Windows Latin). */
export function byteRuns(b: Uint8Array, encoding: 'macintosh' | 'windows-1252' | 'iso-8859-1', minLen = 16): string[] {
  const out: string[] = [];
  let start = -1;
  let dec: TextDecoder | null = null;
  try { dec = new TextDecoder(encoding); } catch { dec = null; }
  const flush = (end: number) => {
    if (start >= 0 && end - start >= minLen) {
      const slice = b.subarray(start, end);
      const s = dec ? dec.decode(slice) : String.fromCharCode(...slice);
      out.push(...splitParas(s));
    }
    start = -1;
  };
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    const ok = c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && c !== 0xff);
    if (ok) { if (start < 0) start = i; }
    else flush(i);
  }
  flush(b.length);
  return out;
}

function splitParas(s: string): string[] {
  return s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Keeps runs that read as text, drops duplicates, and turns them into Body paragraphs. */
export function paragraphsFrom(runs: string[], minQuality = 0.55): Paragraph[] {
  const seen = new Set<string>();
  const out: Paragraph[] = [];
  for (const r of runs) {
    const t = r.trim();
    if (t.length < 2) continue;
    if (!/\p{L}{2}/u.test(t)) continue;
    if (t.length < 12 && !/^[\p{L}\p{N}\s.,;:!?'"()-]+$/u.test(t)) continue;
    if (textQuality(t) < minQuality) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ style: 'Body', runs: [{ text: t }] });
  }
  return out;
}

/** Pictures found in the bytes, decoded to confirm they are pictures. */
export async function picturesFrom(bytes: Uint8Array[]): Promise<{ mime: string; data: Uint8Array }[]> {
  const out: { mime: string; data: Uint8Array }[] = [];
  const seen = new Set<string>();
  const { imageSize } = await import('./images');
  for (const b of bytes) {
    for (const hv of harvestMediaBytes(b, 60)) {
      const key = `${hv.mime}:${hv.data.length}:${hv.data[20]}:${hv.data[hv.data.length >> 1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try { const s = await imageSize(hv.mime, hv.data); if (s.w > 8 && s.h > 8) out.push(hv); } catch { /* not a picture */ }
    }
  }
  return out;
}

/** Adds pages holding the pictures (as many as fit per page), after the text. */
export async function addPicturePages(pub: Pub, pics: { mime: string; data: Uint8Array; name?: string }[]): Promise<number> {
  if (!pics.length) return 0;
  const { frameForMedia, imageSize } = await import('./images');
  const [mt, mr, mb, ml] = pub.data.masters[0].margins;
  let page: Page = { id: newId('pg'), master: pub.data.masters[0].id, items: [] };
  pub.data.pages.push(page);
  let y = mt;
  let n = 0;
  for (const hv of pics.slice(0, 80)) {
    const size = await imageSize(hv.mime, hv.data).catch(() => ({ w: 300, h: 200 }));
    const id = pub.addMedia({ mime: hv.mime, b64: b64(hv.data), name: hv.name || `Picture ${n + 1}`, w: size.w, h: size.h });
    const f = frameForMedia(id, pub.media[id], { x: ml, y, w: pub.size.w - ml - mr, h: Math.max(72, pub.size.h - mb - y) });
    if (y > mt && y + f.h > pub.size.h - mb) { page = { id: newId('pg'), master: pub.data.masters[0].id, items: [] }; pub.data.pages.push(page); y = mt; f.y = y; }
    page.items.push(f);
    y += f.h + 12;
    n++;
  }
  return n;
}

/** A publication holding the paragraphs in flowing frames, then the pictures. */
export async function buildPublication(name: string, paras: Paragraph[], pics: { mime: string; data: Uint8Array }[], warnings: string[], size?: { w: number; h: number }): Promise<Pub> {
  const pub = Pub.blank(size);
  pub.data.props.title = name.replace(/\.[^.]+$/, '');
  const [mt, mr, mb, ml] = pub.data.masters[0].margins;
  if (paras.length) {
    const f = pub.newTextFrame({ x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb }, paras);
    f.name = 'Recovered text';
    pub.pages[0].items.push(f);
    const { autoflowStory } = await import('../edit/flowOps');
    autoflowStory(pub, f);
  }
  const n = await addPicturePages(pub, pics);
  if (n) warnings.push(`${n} picture${n > 1 ? 's were' : ' was'} placed on ${n > 1 ? 'pages' : 'a page'} after the text.`);
  pub.pruneStories();
  return pub;
}

function bestRuns(candidates: string[][]): string[] {
  let best: string[] = [];
  let bestScore = -1;
  for (const c of candidates) {
    const text = c.join('\n');
    const score = text.length ? textQuality(text) * Math.min(1, text.length / 2000) + text.length / 1e6 : 0;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/**
 * Reads an .indd, .qxp or .pmd file. QuarkXPress 3.1–4.1 and PageMaker 6–7 files go to the layout
 * readers in src/io/qxp and src/io/pagemaker; InDesign binaries and anything those readers cannot
 * handle go to the text-and-pictures harvest below.
 */
export async function importLegacyLayout(data: Uint8Array, name: string, kind: Exclude<LegacyKind, 'pub'>): Promise<LegacyImport> {
  if (kind === 'qxp') {
    try { return await (await import('./qxp/index')).importQxp(data, name); } catch (e) { return harvestLayout(data, name, kind, (e as Error).message); }
  }
  if (kind === 'pmd') {
    try { return await (await import('./pagemaker/index')).importPageMaker(data, name); } catch (e) { return harvestLayout(data, name, kind, (e as Error).message); }
  }
  return harvestLayout(data, name, kind);
}

/**
 * The fallback for every legacy format: text runs and pictures recovered from the raw bytes, flowed
 * into frames and placed on pages. `reason` says why the layout reader did not run (shown first).
 */
export async function harvestLayout(data: Uint8Array, name: string, kind: Exclude<LegacyKind, 'pub'>, reason?: string): Promise<LegacyImport> {
  const warnings: string[] = [];
  let runs: string[] = [];
  if (kind === 'indd') {
    runs = bestRuns([utf16Runs(data, 8, false), utf16Runs(data, 8, true)]);
  } else if (kind === 'qxp') {
    const mac = String.fromCharCode(data[2], data[3]) === 'MM';
    runs = byteRuns(data, mac ? 'macintosh' : 'windows-1252', 12);
  } else {
    runs = bestRuns([byteRuns(data, 'windows-1252', 12), byteRuns(data, 'macintosh', 12)]);
  }
  const paras = paragraphsFrom(runs);
  const pics = await picturesFrom([data]);
  const label = LEGACY_LABELS[kind];
  const pub = await buildPublication(name, paras, pics, warnings);
  if (!paras.length && !pics.length) throw new Error(`No readable text or pictures were found in this ${label}.${reason ? ` ${reason}` : ''}`);
  const why = kind === 'indd' ? 'QuillPress has no reader for this format\'s layout (it is not publicly documented).' : reason || 'The layout could not be read.';
  const advice = kind === 'indd' ? 'an IDML export from InDesign' : kind === 'qxp' ? 'an XPress Tags export from QuarkXPress, or a 3.1–4.1 copy of the file' : 'a PageMaker 6–7 copy of the file';
  warnings.unshift(`${label}: ${why} ${paras.length ? `The text (${paras.reduce((a, p) => a + p.runs[0].text.split(/\s+/).length, 0)} words) was recovered and flowed into frames` : 'No text was found'}; frames, styles and page geometry were not. Save the result as .qpp or ask for ${advice}.`);
  return { pub, warnings, textOnly: true };
}
