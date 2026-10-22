/**
 * Picture XObjects for the PDF writer. JPEG files go in as they are (DCTDecode) when nothing has to
 * change them; everything else, and JPEGs that need an EXIF rotation or a picture adjustment
 * (brightness, contrast, saturation, grayscale), is decoded by the browser and written as a new JPEG
 * or, with transparency, as deflated RGB with a soft mask.
 */
import type { Pub } from '../model/pub';
import type { PictureFrame } from '../model/types';
import { unb64 } from '../io/xml';
import { decodePng } from '../io/png';

export interface ImageEntry { obj: number; w: number; h: number; res: string }

export interface ImageWriter { stream(dict: string, data: Uint8Array): number }

export interface ImageCtx {
  pub: Pub;
  w: ImageWriter;
  images: Map<string, ImageEntry>;
  imgRes: string[];
  opts: { quality?: number; maxImagePx?: number };
}

export interface JpegInfo { w: number; h: number; comps: number; adobe: boolean; orientation: number }

/** Reads a JPEG's frame size, component count, Adobe marker and EXIF orientation. */
export function jpegInfo(d: Uint8Array): JpegInfo | null {
  if (d[0] !== 0xff || d[1] !== 0xd8) return null;
  let i = 2, adobe = false, orientation = 1;
  while (i + 4 <= d.length) {
    if (d[i] !== 0xff) { i++; continue; }
    const marker = d[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = (d[i + 2] << 8) | d[i + 3];
    if (marker === 0xee && d[i + 4] === 0x41 && d[i + 5] === 0x64 && d[i + 6] === 0x6f && d[i + 7] === 0x62 && d[i + 8] === 0x65) adobe = true;
    if (marker === 0xe1 && d[i + 4] === 0x45 && d[i + 5] === 0x78 && d[i + 6] === 0x69 && d[i + 7] === 0x66) orientation = exifOrientation(d, i + 10, i + 2 + len);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = (d[i + 5] << 8) | d[i + 6], w = (d[i + 7] << 8) | d[i + 8];
      return { w, h, comps: d[i + 9], adobe, orientation };
    }
    i += 2 + len;
  }
  return null;
}

/** The orientation tag (0x0112) of the first IFD of an EXIF block (TIFF header at `t`). */
function exifOrientation(d: Uint8Array, t: number, end: number): number {
  if (t + 8 > end) return 1;
  const le = d[t] === 0x49;
  const u16 = (o: number) => (le ? d[o] | (d[o + 1] << 8) : (d[o] << 8) | d[o + 1]);
  const u32 = (o: number) => (le ? (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0 : ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0);
  const ifd = t + u32(t + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

/** CSS filter for a picture's adjustments ('' when it has none). */
export function pictureFilter(p: Pick<PictureFrame, 'brightness' | 'contrast' | 'saturation' | 'grayscale'>): string {
  const f: string[] = [];
  if (p.brightness) f.push(`brightness(${1 + p.brightness / 100})`);
  if (p.contrast) f.push(`contrast(${1 + p.contrast / 100})`);
  if (p.saturation != null && p.saturation !== 0) f.push(`saturate(${1 + p.saturation / 100})`);
  if (p.grayscale) f.push('grayscale(1)');
  return f.join(' ');
}

export async function deflate(data: Uint8Array): Promise<{ data: Uint8Array; filter: string }> {
  try {
    if (typeof CompressionStream === 'undefined') return { data, filter: '' };
    const cs = new CompressionStream('deflate');
    const w = cs.writable.getWriter();
    void w.write(data as BufferSource); void w.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return { data: new Uint8Array(buf), filter: ' /Filter /FlateDecode' };
  } catch { return { data, filter: '' }; }
}

/** The image XObject for a media item (cached per media and adjustment). */
export async function imageObj(ctx: ImageCtx, mediaId: string, filter = ''): Promise<ImageEntry | null> {
  const key = filter ? `${mediaId}|${filter}` : mediaId;
  const hit = ctx.images.get(key);
  if (hit) return hit;
  const m = ctx.pub.media[mediaId];
  if (!m) return null;
  const bytes = unb64(m.b64);
  let entry: Omit<ImageEntry, 'res'> | null = null;
  const info = m.mime === 'image/jpeg' ? jpegInfo(bytes) : null;
  if (info && info.w && info.h && info.orientation === 1 && !filter && (info.comps === 1 || info.comps === 3 || info.comps === 4)) {
    const cs = info.comps === 1 ? '/DeviceGray' : info.comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    // Photoshop writes CMYK JPEGs inverted and marks them with the Adobe segment.
    const decode = info.comps === 4 && info.adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    const obj = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${decode}`, bytes);
    entry = { obj, w: info.w, h: info.h };
  } else {
    const raster = await rasterize(m.mime, bytes, ctx.opts.maxImagePx || 2400, ctx.opts.quality ?? 0.9, filter);
    if (raster) {
      if (raster.jpeg) {
        const obj = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${raster.w} /Height ${raster.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, raster.jpeg);
        entry = { obj, w: raster.w, h: raster.h };
      } else if (raster.rgb) {
        let smask = '';
        if (raster.alpha) { const a = await deflate(raster.alpha); const so = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${raster.w} /Height ${raster.h} /ColorSpace /DeviceGray /BitsPerComponent 8${a.filter}`, a.data); smask = ` /SMask ${so} 0 R`; }
        const z = await deflate(raster.rgb);
        const obj = ctx.w.stream(`/Type /XObject /Subtype /Image /Width ${raster.w} /Height ${raster.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${z.filter}${smask}`, z.data);
        entry = { obj, w: raster.w, h: raster.h };
      }
    }
  }
  if (!entry) return null;
  const res = `/Im${ctx.images.size + 1}`;
  const full = { ...entry, res };
  ctx.images.set(key, full);
  ctx.imgRes.push(`${res} ${entry.obj} 0 R`);
  return full;
}

/** Decodes a PNG in plain JavaScript (where no canvas exists, or when the browser cannot decode it). */
function pngFallback(mime: string, bytes: Uint8Array, maxPx: number): { w: number; h: number; rgb: Uint8Array; alpha?: Uint8Array } | null {
  if (mime !== 'image/png') return null;
  const png = decodePng(bytes);
  if (!png) return null;
  const k = Math.min(1, maxPx / Math.max(1, png.w, png.h));
  if (k >= 1) return png;
  // Nearest-neighbor downsample (only for very large pictures without a canvas).
  const w = Math.max(1, Math.round(png.w * k)), h = Math.max(1, Math.round(png.h * k));
  const rgb = new Uint8Array(w * h * 3), alpha = png.alpha ? new Uint8Array(w * h) : undefined;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = Math.min(png.w - 1, Math.floor(x / k)), sy = Math.min(png.h - 1, Math.floor(y / k)); const si = sy * png.w + sx, di = y * w + x; rgb[di * 3] = png.rgb[si * 3]; rgb[di * 3 + 1] = png.rgb[si * 3 + 1]; rgb[di * 3 + 2] = png.rgb[si * 3 + 2]; if (alpha) alpha[di] = png.alpha![si]; }
  return { w, h, rgb, alpha };
}

/** Decodes a picture with the browser (EXIF orientation applied, optional CSS filter); JPEG output when it has no transparency. */
async function rasterize(mime: string, bytes: Uint8Array, maxPx: number, quality: number, filter: string): Promise<{ w: number; h: number; jpeg?: Uint8Array; rgb?: Uint8Array; alpha?: Uint8Array } | null> {
  const canvasOk = typeof document !== 'undefined' && typeof Image !== 'undefined' && typeof URL !== 'undefined' && !!URL.createObjectURL && !!document.createElement('canvas').getContext?.('2d');
  if (!canvasOk) return pngFallback(mime, bytes, maxPx);
  try {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); const t = setTimeout(() => rej(new Error('timeout')), 15000); im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); rej(new Error('decode')); }; im.src = url; });
    URL.revokeObjectURL(url);
    const k = Math.min(1, maxPx / Math.max(1, img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width || 300) * k)), h = Math.max(1, Math.round((img.naturalHeight || img.height || 150) * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    if (filter && 'filter' in g) g.filter = filter;
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { hasAlpha = true; break; }
    if (!hasAlpha) {
      const dataUrl = c.toDataURL('image/jpeg', quality);
      return { w, h, jpeg: unb64(dataUrl.split(',')[1]) };
    }
    const rgbA = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
    for (let i = 0, j = 0, k2 = 0; i < data.length; i += 4, j += 3, k2++) { rgbA[j] = data[i]; rgbA[j + 1] = data[i + 1]; rgbA[j + 2] = data[i + 2]; alpha[k2] = data[i + 3]; }
    return { w, h, rgb: rgbA, alpha };
  } catch { return pngFallback(mime, bytes, maxPx); }
}
