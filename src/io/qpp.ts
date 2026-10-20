/**
 * Native QuillPress formats.
 *   .qpp   ZIP package: `mimetype` (stored first), `publication.json` (the model), `media/<id>` binaries,
 *          and, when the Fonts dialog's "Package fonts" option is on, the user's fonts the publication
 *          uses under `fonts/` with an index in `fonts.json` (fonts whose license forbids embedding are
 *          left out). Packaged fonts register for the session when the file opens; the Fonts dialog
 *          can keep them.
 *   .qppe  the same JSON (media inline) encrypted with AES-256-GCM under a password-derived key.
 *   .json  the model as plain JSON (media inline, base64).
 */
import JSZip from 'jszip';
import { Pub } from '../model/pub';
import { fontsUsed } from '../model/styles';
import { encryptJson, decryptJson } from '../util/crypto';
import { b64, dec, enc, unb64 } from './xml';
import { QPP_MIME } from './index';
import { packageFontsEnabled, userFontsFor, userFontBytes, registerPackagedFonts, type PackagedFontEntry, type UserFontFormat } from '../fonts';

export interface PackagedFontIndexEntry { id: string; family: string; subfamily?: string; psName?: string; weight: number; style: 'normal' | 'italic'; format: UserFontFormat; file: string; fsType?: number }

/** The user's fonts that would be packaged with the publication (embeddable ones the publication uses). */
export function fontsToPackage(pub: Pub): { entry: PackagedFontIndexEntry; bytes: Uint8Array }[] {
  if (!packageFontsEnabled()) return [];
  const out: { entry: PackagedFontIndexEntry; bytes: Uint8Array }[] = [];
  for (const f of userFontsFor(fontsUsed(pub.data))) {
    if (!f.embeddable) continue;
    const bytes = userFontBytes(f.id);
    if (!bytes) continue;
    const ext = f.format === 'woff' ? 'ttf' : f.format;
    out.push({ entry: { id: f.id, family: f.family, subfamily: f.subfamily, psName: f.psName, weight: f.weight, style: f.style, format: f.format === 'woff' ? 'ttf' : f.format, file: `${f.id}.${ext}`, fsType: f.fsType }, bytes });
  }
  return out;
}

export async function exportQpp(pub: Pub, opts: { fonts?: boolean } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', QPP_MIME, { compression: 'STORE' });
  const j = pub.toJSON();
  const mediaIndex: Record<string, { mime: string; name?: string; w?: number; h?: number; dpi?: number }> = {};
  for (const [id, m] of Object.entries(j.media)) {
    zip.file(`media/${id}`, unb64(m.b64));
    mediaIndex[id] = { mime: m.mime, ...(m.name ? { name: m.name } : {}), ...(m.w ? { w: m.w, h: m.h } : {}), ...(m.dpi ? { dpi: m.dpi } : {}) };
  }
  zip.file('publication.json', JSON.stringify({ format: j.format, version: j.version, data: j.data, mediaIndex }));
  if (opts.fonts !== false) {
    const fonts = fontsToPackage(pub);
    if (fonts.length) {
      for (const f of fonts) zip.file(`fonts/${f.entry.file}`, f.bytes);
      zip.file('fonts.json', JSON.stringify(fonts.map((f) => f.entry)));
    }
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: QPP_MIME });
}

/** The fonts a package carries (index and bytes), without registering them. */
export async function packagedFonts(zip: JSZip): Promise<PackagedFontEntry[]> {
  const idx = zip.file('fonts.json');
  if (!idx) return [];
  let list: PackagedFontIndexEntry[] = [];
  try { list = JSON.parse(await idx.async('string')); } catch { return []; }
  const out: PackagedFontEntry[] = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.file !== 'string' || typeof e.family !== 'string') continue;
    const f = zip.file(`fonts/${e.file.replace(/^.*[\\/]/, '')}`);
    if (!f) continue;
    out.push({ id: e.id, family: e.family, weight: Number(e.weight) || 400, style: e.style === 'italic' ? 'italic' : 'normal', format: e.format, file: e.file, psName: e.psName, bytes: await f.async('uint8array') });
  }
  return out;
}

export async function importQpp(data: Uint8Array, opts: { fonts?: boolean } = {}): Promise<Pub> {
  const zip = await JSZip.loadAsync(data);
  const f = zip.file('publication.json');
  if (!f) throw new Error('This QuillPress package has no publication.json.');
  const j = JSON.parse(await f.async('string'));
  const media: Record<string, any> = {};
  for (const [id, info] of Object.entries<any>(j.mediaIndex || {})) {
    const mf = zip.file(`media/${id}`);
    if (mf) media[id] = { mime: info.mime, b64: b64(await mf.async('uint8array')), ...(info.name ? { name: info.name } : {}), ...(info.w ? { w: info.w, h: info.h } : {}), ...(info.dpi ? { dpi: info.dpi } : {}) };
  }
  if (opts.fonts !== false) {
    const fonts = await packagedFonts(zip);
    if (fonts.length) await registerPackagedFonts(fonts);
  }
  return Pub.fromJSON({ format: 'quillpress', version: j.version || 1, data: j.data, media: { ...(j.media || {}), ...media } });
}

export function exportJson(pub: Pub): Uint8Array {
  return enc(JSON.stringify(pub.toJSON()));
}

export function importJson(data: Uint8Array): Pub {
  return Pub.fromJSON(JSON.parse(dec(data).replace(/^﻿/, '')));
}

export async function exportQppe(pub: Pub, password: string): Promise<Uint8Array> {
  return encryptJson(pub.toJSON(), password);
}

export async function importQppe(data: Uint8Array, password: string): Promise<Pub> {
  let j: any;
  try {
    j = await decryptJson(data.slice().buffer, password);
  } catch (e: any) {
    if (/Not an encrypted/.test(e?.message || '')) throw e;
    throw new Error('The password is incorrect, or the file is damaged.');
  }
  return Pub.fromJSON(j);
}

export const QPPE_MAGIC = 'QFDE1';
