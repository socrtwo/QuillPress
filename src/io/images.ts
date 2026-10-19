/**
 * Pictures: loading files into media items (with their natural size), TIFF conversion, and opening
 * a picture or an SVG as a one-page publication.
 */
import { Pub, newId } from '../model/pub';
import type { MediaItem, PictureFrame } from '../model/types';
import { b64 } from './xml';
import { tiffToBmp } from './tiff';

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.tif,.tiff';
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/tiff'];

export function mimeOf(name: string, data?: Uint8Array): string {
  if (data) {
    const h = String.fromCharCode(...data.subarray(0, 4));
    if (h.startsWith('\x89PNG')) return 'image/png';
    if (h.startsWith('\xff\xd8')) return 'image/jpeg';
    if (h.startsWith('GIF8')) return 'image/gif';
    if (h.startsWith('BM')) return 'image/bmp';
    if (h.startsWith('II*\x00') || h.startsWith('MM\x00*')) return 'image/tiff';
    if (h.startsWith('RIFF')) return 'image/webp';
    if (/^\s*</.test(new TextDecoder().decode(data.subarray(0, 64)))) return 'image/svg+xml';
  }
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' }[ext] || 'application/octet-stream';
}

/** Natural size of a picture in pixels (SVG: its viewBox or width/height; 0 when unknown). */
export function imageSize(mime: string, data: Uint8Array): Promise<{ w: number; h: number }> {
  if (mime === 'image/svg+xml') {
    const t = new TextDecoder().decode(data.subarray(0, 4096));
    const vb = /viewBox="([^"]+)"/.exec(t)?.[1]?.trim().split(/[\s,]+/).map(Number);
    const w = parseFloat(/\swidth="([\d.]+)/.exec(t)?.[1] || ''), h = parseFloat(/\sheight="([\d.]+)/.exec(t)?.[1] || '');
    if (w && h) return Promise.resolve({ w, h });
    if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return Promise.resolve({ w: vb[2], h: vb[3] });
    return Promise.resolve({ w: 300, h: 150 });
  }
  // The header is enough for the common formats; decoding is only needed for the rest (WebP, TIFF).
  const hs = headerSize(mime, data);
  if (hs.w && hs.h) return Promise.resolve(hs);
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return Promise.resolve(hs);
  return new Promise((res) => {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    let done = false;
    const finish = (v: { w: number; h: number }) => { if (done) return; done = true; res(v); URL.revokeObjectURL(url); };
    const img = new Image();
    img.onload = () => finish({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => finish(hs);
    setTimeout(() => finish(hs), 3000);
    img.src = url;
  });
}

/** Size from the file header (PNG, GIF, BMP, JPEG), for tests and failures. */
export function headerSize(mime: string, d: Uint8Array): { w: number; h: number } {
  const u32 = (o: number) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
  const u16le = (o: number) => d[o] | (d[o + 1] << 8);
  try {
    if (mime === 'image/png' && d.length > 24) return { w: u32(16), h: u32(20) };
    if (mime === 'image/gif' && d.length > 10) return { w: u16le(6), h: u16le(8) };
    if (mime === 'image/bmp' && d.length > 26) return { w: u16le(18) | (u16le(20) << 16), h: Math.abs(u16le(22) | (u16le(24) << 16)) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < d.length) {
        if (d[i] !== 0xff) { i++; continue; }
        const marker = d[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: (d[i + 7] << 8) | d[i + 8], h: (d[i + 5] << 8) | d[i + 6] };
        const len = (d[i + 2] << 8) | d[i + 3];
        i += 2 + len;
      }
    }
  } catch { /* */ }
  return { w: 0, h: 0 };
}

/** Builds a media item from picture bytes; TIFF is converted to BMP so browsers can show it. */
export async function mediaFromBytes(data: Uint8Array, name: string): Promise<MediaItem> {
  let mime = mimeOf(name, data);
  let bytes = data;
  if (mime === 'image/tiff') {
    const bmp = tiffToBmp(data);
    if (!bmp) throw new Error('This TIFF uses a compression or color mode QuillPress cannot read yet.');
    bytes = bmp; mime = 'image/bmp';
  }
  const size = await imageSize(mime, bytes);
  const dpi = mime === 'image/jpeg' ? jpegDpi(bytes) : mime === 'image/png' ? pngDpi(bytes) : undefined;
  return { mime, b64: b64(bytes), name, w: size.w, h: size.h, ...(dpi ? { dpi } : {}) };
}

function jpegDpi(d: Uint8Array): number | undefined {
  // JFIF APP0: units at offset 13 after the marker, density at 14..17.
  if (d[2] === 0xff && d[3] === 0xe0 && String.fromCharCode(d[6], d[7], d[8], d[9]) === 'JFIF') {
    const units = d[13], x = (d[14] << 8) | d[15];
    if (units === 1 && x) return x;
    if (units === 2 && x) return Math.round(x * 2.54);
  }
  return undefined;
}

function pngDpi(d: Uint8Array): number | undefined {
  let i = 8;
  while (i + 8 < d.length) {
    const len = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
    const type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    if (type === 'pHYs') { const ppm = ((d[i + 8] << 24) | (d[i + 9] << 16) | (d[i + 10] << 8) | d[i + 11]) >>> 0; if (d[i + 16] === 1 && ppm) return Math.round(ppm * 0.0254); return undefined; }
    if (type === 'IDAT') return undefined;
    i += 12 + len;
  }
  return undefined;
}

/** A picture frame sized to the picture at 72 dpi (or its own dpi), fitted inside the given bounds. */
export function frameForMedia(id: string, m: MediaItem, bounds: { x: number; y: number; w: number; h: number }): PictureFrame {
  const dpi = m.dpi || 72;
  let w = (m.w || 300) * (72 / dpi), h = (m.h || 200) * (72 / dpi);
  if (m.mime === 'image/svg+xml') { w = m.w || 300; h = m.h || 150; }
  const k = Math.min(1, bounds.w / w, bounds.h / h);
  w *= k; h *= k;
  return { id: newId('pic'), kind: 'picture', media: id, name: m.name?.replace(/\.[^.]+$/, '') || 'Picture', x: bounds.x, y: bounds.y, w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, fit: 'fill', src: m.name };
}

export async function publicationFromImage(data: Uint8Array, name: string): Promise<Pub> {
  const pub = Pub.blank();
  const m = await mediaFromBytes(data, name);
  const id = pub.addMedia(m);
  const [mt, mr, mb, ml] = pub.data.masters[0].margins;
  pub.pages[0].items.push(frameForMedia(id, m, { x: ml, y: mt, w: pub.size.w - ml - mr, h: pub.size.h - mt - mb }));
  return pub;
}

/** An SVG file becomes a page of its size with the drawing as a picture (editable as a frame). */
export async function publicationFromSvg(data: Uint8Array, name: string): Promise<Pub> {
  const m = await mediaFromBytes(data, name);
  const w = m.w || 612, h = m.h || 792;
  const pub = Pub.blank({ w, h }, { margins: [0, 0, 0, 0] });
  const id = pub.addMedia(m);
  pub.pages[0].items.push({ id: newId('pic'), kind: 'picture', media: id, name: name.replace(/\.[^.]+$/, ''), x: 0, y: 0, w, h, fit: 'stretch' });
  return pub;
}
