/**
 * Microsoft Publisher (.pub): an OLE2 compound file ([MS-CFB]) whose "Contents" stream holds the
 * layout, "Quill/QuillSub/CONTENTS" the text and "Escher/EscherStm" the Office Art drawing layer
 * with the pictures in "Escher/EscherDelayStm". The layout reader (src/io/mspub/*) recovers pages,
 * master pages, shapes, text boxes with their stories and chains, pictures, lines, groups and
 * tables for Publisher 2002–2016 files, and as far as the format is described for 2000 and 97/98.
 * When the layout cannot be read, the text and the pictures are harvested from the bytes and
 * flowed onto blank pages instead; the warnings say which path was taken.
 *
 * Written from the published [MS-CFB] and [MS-ODRAW] specifications and from the format description
 * of the Document Liberation Project's Publisher reader (no code shared).
 */
import { openCfb, isCfb } from './cfb';
import { utf16Runs, paragraphsFrom, picturesFrom, buildPublication, type LegacyImport } from './legacyLayout';
import type { Paragraph } from '../model/types';
import { openPubStreams, type PubStreams } from './mspub/cfbStreams';
import { dibToBmp, parseEscher, parseDelayStream } from './mspub/escher';
import { parseContents } from './mspub/contents';
import { parseQuill } from './mspub/quill';
import { buildLayout } from './mspub/shapes';
import { collectPub } from './mspub/collect';
import { parse2k } from './mspub/pub2k';

/** A compound file with Publisher's "Quill" text stream. */
export function isMsPub(b: Uint8Array): boolean {
  if (!isCfb(b)) return false;
  const cfb = openCfb(b);
  return !!cfb && (!!cfb.find('Quill') || cfb.entries.some((e) => /^quill$/i.test(e.name)));
}

const BLIP_TYPES = new Set([0xf01a, 0xf01b, 0xf01c, 0xf01d, 0xf01e, 0xf01f, 0xf029]);

/** Picture payloads of Office Art BLIP records in a stream (JPEG, PNG, TIFF; DIB is wrapped as BMP). */
export function escherBlips(s: Uint8Array): { mime: string; data: Uint8Array }[] {
  const out: { mime: string; data: Uint8Array }[] = [];
  const u16 = (o: number) => s[o] | (s[o + 1] << 8);
  const u32 = (o: number) => (s[o] | (s[o + 1] << 8) | (s[o + 2] << 16) | (s[o + 3] << 24)) >>> 0;
  for (let i = 0; i + 8 < s.length; i++) {
    const type = u16(i + 2);
    if (!BLIP_TYPES.has(type)) continue;
    const len = u32(i + 4);
    if (len < 40 || i + 8 + len > s.length) continue;
    const payload = s.subarray(i + 8, i + 8 + len);
    // One or two 16-byte UIDs, then a tag byte, then the picture.
    let found = false;
    for (const skip of [17, 33, 16, 32]) {
      if (skip >= payload.length) continue;
      const d = payload.subarray(skip);
      if (type === 0xf01d && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) { out.push({ mime: 'image/jpeg', data: d.slice() }); found = true; break; }
      if (type === 0xf01e && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) { out.push({ mime: 'image/png', data: d.slice() }); found = true; break; }
      if (type === 0xf029 && ((d[0] === 0x49 && d[1] === 0x49 && d[2] === 0x2a) || (d[0] === 0x4d && d[1] === 0x4d && d[2] === 0 && d[3] === 0x2a))) { out.push({ mime: 'image/tiff', data: d.slice() }); found = true; break; }
      if (type === 0xf01f && (d[0] === 40 || d[0] === 108 || d[0] === 124) && d[1] === 0 && d[2] === 0 && d[3] === 0) { out.push({ mime: 'image/bmp', data: dibToBmp(d) }); found = true; break; }
    }
    if (found) i += 8 + len - 1;
  }
  return out;
}

/** Paragraphs of the Quill stream's text (UTF-16, returns end paragraphs). */
export function quillText(quill: Uint8Array): Paragraph[] {
  const runs = utf16Runs(quill, 4);
  // Publisher keeps every story's text in one stream; stories end with a paragraph mark, so runs map to paragraphs.
  return paragraphsFrom(runs, 0.45);
}

/** Reads the layout; throws when the file's version is unsupported or its structures are damaged. */
async function readLayout(st: PubStreams, name: string): Promise<LegacyImport> {
  if (st.version === 'unknown') throw new Error('unsupported version');
  if (st.version === '2002') {
    if (!st.contents || !st.escher) throw new Error('the Contents or Escher stream is missing');
    const contents = parseContents(st.contents);
    const quill = st.quill ? parseQuill(st.quill) : null;
    const escher = parseEscher(st.escher);
    const pictures = st.escherDelay ? parseDelayStream(st.escherDelay) : [];
    if (!contents.pages.size) throw new Error('no pages');
    const doc = buildLayout(contents, quill, escher, pictures, '2002–2016');
    const r = collectPub(doc, name);
    return { pub: r.pub, warnings: r.warnings, textOnly: false };
  }
  if (!st.contents) throw new Error('the Contents stream is missing');
  const quill = st.version === '2000' && st.quill ? parseQuill(st.quill) : null;
  const doc = parse2k(st.contents, quill, st.version);
  if (!doc.pages.length) throw new Error('no pages');
  const r = collectPub(doc, name);
  r.warnings.push(st.version === '2000'
    ? 'Publisher 2000 files describe fewer properties than later versions: fills are solid colors, pictures are Windows metafiles (converted to vector drawings), and no master pages are applied beyond the background page.'
    : 'Publisher 97/98 files were read as far as the format is known: shapes, solid fills, outlines and plain text with bold, italic, underline, size and color.');
  return { pub: r.pub, warnings: r.warnings, textOnly: false };
}

/** The previous reader: text and pictures harvested from the bytes and flowed onto new pages. */
async function harvest(data: Uint8Array, name: string, why: string | null): Promise<LegacyImport> {
  const warnings: string[] = [];
  const cfb = openCfb(data);
  if (!cfb) throw new Error('Not a Publisher file (the compound file could not be read).');
  const quill = cfb.read('Quill/QuillSub/CONTENTS') || cfb.read('Quill') || cfb.entries.filter((e) => /^(quill|contents)$/i.test(e.name) && /quill/i.test(e.path)).map((e) => cfb.read(e))[0];
  const paras = quill ? quillText(quill) : [];
  const pics: { mime: string; data: Uint8Array }[] = [];
  const seen = new Set<string>();
  const push = (p: { mime: string; data: Uint8Array }) => { const k = `${p.mime}:${p.data.length}:${p.data[p.data.length >> 1]}`; if (!seen.has(k)) { seen.add(k); pics.push(p); } };
  for (const e of cfb.entries) {
    if (e.type !== 'stream' || e.size < 64) continue;
    const bytes = cfb.read(e);
    if (!bytes) continue;
    for (const p of escherBlips(bytes)) push(p);
  }
  if (!pics.length) for (const p of await picturesFrom(cfb.entries.filter((e) => e.type === 'stream').map((e) => cfb.read(e)!).filter(Boolean))) push(p);
  const pub = await buildPublication(name, paras, pics, warnings);
  if (!paras.length && !pics.length) warnings.push('No readable text or pictures were found in this Publisher file.');
  if (cfb.damaged.length) warnings.push(`Parts of the compound file were damaged (${cfb.damaged.slice(0, 3).join(', ')}); what could be read was used.`);
  warnings.unshift(`Microsoft Publisher: the text (${paras.reduce((a, p) => a + p.runs[0].text.split(/\s+/).length, 0)} words${quill ? ', from the Quill stream' : ''}) and ${pics.length} picture${pics.length === 1 ? '' : 's'} were recovered and placed on new pages${why ? ` because the layout could not be read (${why})` : ''}; redo the layout here or save the result as .qpp.`);
  return { pub, warnings, textOnly: true };
}

/** A file whose compound-file structure is unreadable: text runs and pictures from the raw bytes. */
async function harvestRaw(data: Uint8Array, name: string): Promise<LegacyImport> {
  const warnings: string[] = [];
  const paras = paragraphsFrom(utf16Runs(data, 6), 0.55);
  const pics = await picturesFrom([data]);
  const pub = await buildPublication(name, paras, pics, warnings);
  warnings.unshift(`Microsoft Publisher: the file's compound-file structure could not be read (it is damaged or not a Publisher file); ${paras.length ? `${paras.length} text passage${paras.length === 1 ? '' : 's'}` : 'no text'} and ${pics.length} picture${pics.length === 1 ? '' : 's'} were recovered from the raw bytes.`);
  return { pub, warnings, textOnly: true };
}

export async function importMsPub(data: Uint8Array, name: string): Promise<LegacyImport> {
  const st = openPubStreams(data);
  if (!st) return harvestRaw(data, name);
  let why: string | null = null;
  if (st.version !== 'unknown') {
    try {
      const r = await readLayout(st, name);
      if (st.cfb.damaged.length) r.warnings.push(`Parts of the compound file were damaged (${st.cfb.damaged.slice(0, 3).join(', ')}); what could be read was used.`);
      return r;
    } catch (e) {
      why = (e as Error)?.message || String(e);
    }
  } else why = st.contents ? 'unrecognized Publisher version' : 'the Contents stream is missing';
  return harvest(data, name, why);
}
