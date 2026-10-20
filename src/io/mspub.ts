/**
 * Microsoft Publisher (.pub): an OLE2 compound file ([MS-CFB]) whose "Quill" stream holds the
 * publication's text as UTF-16 and whose "Contents" and "Escher" streams hold the layout and the
 * pictures as Office Art ([MS-ODRAW]) BLIP records. Publisher's own structures are not publicly
 * documented, so this reader recovers the text and the pictures and leaves the layout to be redone;
 * the warnings say what was and was not read.
 */
import { openCfb, isCfb } from './cfb';
import { utf16Runs, paragraphsFrom, picturesFrom, buildPublication, type LegacyImport } from './legacyLayout';
import type { Paragraph } from '../model/types';

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

/** Wraps a device-independent bitmap (BITMAPINFOHEADER + pixels) in a BMP file header. */
function dibToBmp(d: Uint8Array): Uint8Array {
  const u32 = (o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const hdr = u32(0), bits = d[14] | (d[15] << 8), used = u32(32);
  const palette = bits <= 8 ? (used || 1 << bits) * 4 : u32(16) === 3 && hdr === 40 ? 12 : 0;
  const offset = 14 + hdr + palette;
  const out = new Uint8Array(14 + d.length);
  out[0] = 0x42; out[1] = 0x4d;
  const put = (o: number, v: number) => { out[o] = v & 255; out[o + 1] = (v >>> 8) & 255; out[o + 2] = (v >>> 16) & 255; out[o + 3] = (v >>> 24) & 255; };
  put(2, out.length); put(10, offset);
  out.set(d, 14);
  return out;
}

/** Paragraphs of the Quill stream's text (UTF-16, returns end paragraphs). */
export function quillText(quill: Uint8Array): Paragraph[] {
  const runs = utf16Runs(quill, 4);
  // Publisher keeps every story's text in one stream; stories end with a paragraph mark, so runs map to paragraphs.
  return paragraphsFrom(runs, 0.45);
}

export async function importMsPub(data: Uint8Array, name: string): Promise<LegacyImport> {
  const warnings: string[] = [];
  const cfb = openCfb(data);
  if (!cfb) throw new Error('Not a Publisher file (the compound file could not be read).');
  const quill = cfb.read('Quill') || cfb.entries.filter((e) => /^quill$/i.test(e.name)).map((e) => cfb.read(e))[0];
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
  if (!paras.length && !pics.length) throw new Error('No readable text or pictures were found in this Publisher file.');
  const pub = await buildPublication(name, paras, pics, warnings);
  if (cfb.damaged.length) warnings.push(`Parts of the compound file were damaged (${cfb.damaged.slice(0, 3).join(', ')}); what could be read was used.`);
  warnings.unshift(`Microsoft Publisher: the text (${paras.reduce((a, p) => a + p.runs[0].text.split(/\s+/).length, 0)} words${quill ? ', from the Quill stream' : ''}) and ${pics.length} picture${pics.length === 1 ? '' : 's'} were recovered and placed on new pages. Publisher's page layout, frames and styles are not publicly documented and were not read; redo the layout here or save the result as .qpp.`);
  return { pub, warnings, textOnly: true };
}
