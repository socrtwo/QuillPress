/**
 * Native QuillPress formats.
 *   .qpp   ZIP package: `mimetype` (stored first), `publication.json` (the model) and `media/<id>` binaries.
 *   .qppe  the same JSON (media inline) encrypted with AES-256-GCM under a password-derived key.
 *   .json  the model as plain JSON (media inline, base64).
 */
import JSZip from 'jszip';
import { Pub } from '../model/pub';
import { encryptJson, decryptJson } from '../util/crypto';
import { b64, dec, enc, unb64 } from './xml';
import { QPP_MIME } from './index';

export async function exportQpp(pub: Pub): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', QPP_MIME, { compression: 'STORE' });
  const j = pub.toJSON();
  const mediaIndex: Record<string, { mime: string; name?: string; w?: number; h?: number; dpi?: number }> = {};
  for (const [id, m] of Object.entries(j.media)) {
    zip.file(`media/${id}`, unb64(m.b64));
    mediaIndex[id] = { mime: m.mime, ...(m.name ? { name: m.name } : {}), ...(m.w ? { w: m.w, h: m.h } : {}), ...(m.dpi ? { dpi: m.dpi } : {}) };
  }
  zip.file('publication.json', JSON.stringify({ format: j.format, version: j.version, data: j.data, mediaIndex }));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: QPP_MIME });
}

export async function importQpp(data: Uint8Array): Promise<Pub> {
  const zip = await JSZip.loadAsync(data);
  const f = zip.file('publication.json');
  if (!f) throw new Error('This QuillPress package has no publication.json.');
  const j = JSON.parse(await f.async('string'));
  const media: Record<string, any> = {};
  for (const [id, info] of Object.entries<any>(j.mediaIndex || {})) {
    const mf = zip.file(`media/${id}`);
    if (mf) media[id] = { mime: info.mime, b64: b64(await mf.async('uint8array')), ...(info.name ? { name: info.name } : {}), ...(info.w ? { w: info.w, h: info.h } : {}), ...(info.dpi ? { dpi: info.dpi } : {}) };
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
