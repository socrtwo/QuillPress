/**
 * Device-independent bitmaps as metafiles carry them (a BITMAPINFO header, an optional colour table,
 * then the pixels): decoded to RGBA and re-encoded as PNG data URIs for the SVG output.
 *
 * Handles the 12-byte core header and the 40/52/56/108/124-byte info headers; 1, 4, 8, 16, 24 and
 * 32 bits per pixel; BI_RGB, BI_BITFIELDS and the run-length encodings BI_RLE8/BI_RLE4; bottom-up
 * and top-down rows. JPEG and PNG payloads (BI_JPEG/BI_PNG) are passed through unchanged.
 */
import { encodePng } from './png';
import { b64 } from '../xml';

export interface DecodedDib { w: number; h: number; rgba: Uint8Array; /** Rows were stored bottom-up. */ bottomUp: boolean }

/** Bytes a DIB's header and colour table take before the pixels (for records that store them apart). */
export function dibHeaderSize(d: Uint8Array): number {
  if (d.length < 12) return d.length;
  const hs = u32(d, 0);
  if (hs === 12) { const bits = u16(d, 10); return 12 + (bits <= 8 ? (1 << bits) * 3 : 0); }
  const bits = u16(d, 14), comp = u32(d, 16), used = hs >= 36 ? u32(d, 32) : 0;
  const masks = comp === 3 && hs === 40 ? 12 : comp === 6 && hs === 40 ? 16 : 0;
  const colours = bits <= 8 ? (used || 1 << bits) : used;
  return hs + masks + colours * 4;
}

const u16 = (d: Uint8Array, o: number) => (o + 2 <= d.length ? d[o] | (d[o + 1] << 8) : 0);
const u32 = (d: Uint8Array, o: number) => (o + 4 <= d.length ? (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0 : 0);
const i32 = (d: Uint8Array, o: number) => u32(d, o) | 0;

/** Decodes a DIB (header + colour table + pixels in one buffer, or the pixels given separately). */
export function decodeDib(header: Uint8Array, pixels?: Uint8Array): DecodedDib | null {
  try {
    if (header.length < 12) return null;
    const hs = u32(header, 0);
    let w: number, h: number, bits: number, comp = 0, used = 0;
    if (hs === 12) { w = u16(header, 4); h = (u16(header, 6) << 16) >> 16; bits = u16(header, 10); }
    else if (hs >= 40 && hs <= 124) { w = i32(header, 4); h = i32(header, 8); bits = u16(header, 14); comp = u32(header, 16); used = u32(header, 32); }
    else return null;
    if (comp === 4 || comp === 5) return null; // embedded JPEG/PNG: handled by dibPayload
    const bottomUp = h > 0;
    h = Math.abs(h);
    if (w <= 0 || h <= 0 || w * h > 40_000_000 || ![1, 2, 4, 8, 16, 24, 32].includes(bits)) return null;
    // Colour table.
    const entry = hs === 12 ? 3 : 4;
    const nColours = bits <= 8 ? (used && used <= 1 << bits ? used : 1 << bits) : 0;
    let p = hs;
    let masks: [number, number, number, number] | null = null;
    if (hs >= 40 && (comp === 3 || comp === 6)) {
      const mo = hs === 40 ? hs : 40;
      masks = [u32(header, mo), u32(header, mo + 4), u32(header, mo + 8), comp === 6 || hs >= 56 ? u32(header, mo + 12) : 0];
      if (hs === 40) p += comp === 6 ? 16 : 12;
    }
    const palette: number[][] = [];
    for (let i = 0; i < nColours; i++) { const o = p + i * entry; palette.push([header[o + 2] ?? 0, header[o + 1] ?? 0, header[o] ?? 0]); }
    p += (bits <= 8 ? nColours : hs >= 40 ? used : 0) * entry;
    const px = pixels ?? header.subarray(p);
    const rgba = new Uint8Array(w * h * 4);
    const put = (x: number, row: number, r: number, g: number, b: number, a = 255) => {
      const y = bottomUp ? h - 1 - row : row;
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const o = (y * w + x) * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    };
    const pal = (i: number) => palette[i] || [0, 0, 0];
    if (comp === 1 || comp === 2) { decodeRle(px, w, h, comp === 1 ? 8 : 4, (x, row, i) => { const c = pal(i); put(x, row, c[0], c[1], c[2]); }); return { w, h, rgba, bottomUp }; }
    const stride = Math.floor((w * bits + 31) / 32) * 4;
    const fromMask = (v: number, m: number) => { if (!m) return 0; let s = 0; while (!((m >>> s) & 1)) s++; const width = Math.clz32(0) - Math.clz32(m >>> s); const raw = (v & m) >>> s; return width >= 8 ? raw >>> (width - 8) : Math.round((raw * 255) / ((1 << width) - 1)); };
    let anyAlpha = false;
    for (let row = 0; row < h; row++) {
      const o = row * stride;
      if (o >= px.length) break;
      for (let x = 0; x < w; x++) {
        if (bits <= 8) {
          const bitPos = x * bits, byte = px[o + (bitPos >> 3)] ?? 0;
          const i = (byte >> (8 - bits - (bitPos & 7))) & ((1 << bits) - 1);
          const c = pal(i); put(x, row, c[0], c[1], c[2]);
        } else if (bits === 16) {
          const v = u16(px, o + x * 2);
          if (masks) put(x, row, fromMask(v, masks[0]), fromMask(v, masks[1]), fromMask(v, masks[2]));
          else put(x, row, ((v >> 10) & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, (v & 31) * 255 / 31 | 0);
        } else if (bits === 24) {
          const q = o + x * 3; put(x, row, px[q + 2] ?? 0, px[q + 1] ?? 0, px[q] ?? 0);
        } else {
          const v = u32(px, o + x * 4);
          if (masks) { const a = masks[3] ? fromMask(v, masks[3]) : 255; if (masks[3] && a !== 255) anyAlpha = true; put(x, row, fromMask(v, masks[0]), fromMask(v, masks[1]), fromMask(v, masks[2]), a); }
          else { const a = (v >>> 24) & 255; if (a) anyAlpha = true; put(x, row, (v >> 16) & 255, (v >> 8) & 255, v & 255, a); }
        }
      }
    }
    // A 32-bit BI_RGB bitmap whose fourth bytes are all zero is opaque (the byte is unused).
    if (bits === 32 && !masks && !anyAlpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    return { w, h, rgba, bottomUp };
  } catch { return null; }
}

function decodeRle(d: Uint8Array, w: number, h: number, bits: 4 | 8, set: (x: number, row: number, i: number) => void): void {
  let x = 0, row = 0, p = 0;
  const pix = (v: number, k: number) => (bits === 8 ? v : k % 2 === 0 ? v >> 4 : v & 15);
  while (p + 1 < d.length && row < h) {
    const n = d[p], v = d[p + 1];
    p += 2;
    if (n > 0) { for (let k = 0; k < n; k++) set(x++, row, pix(v, k)); continue; }
    if (v === 0) { x = 0; row++; continue; }
    if (v === 1) break;
    if (v === 2) { x += d[p] ?? 0; row += d[p + 1] ?? 0; p += 2; continue; }
    // Absolute run of v pixels, padded to a 16-bit boundary.
    const bytes = bits === 8 ? v : Math.ceil(v / 2);
    for (let k = 0; k < v; k++) { const b = d[p + (bits === 8 ? k : k >> 1)] ?? 0; set(x++, row, bits === 8 ? b : k % 2 === 0 ? b >> 4 : b & 15); }
    p += bytes + (bytes & 1);
  }
}

/** A data URI for the bitmap: PNG for decoded pixels, or the embedded JPEG/PNG stream as is. */
export function dibDataUri(header: Uint8Array, pixels?: Uint8Array, opts: { premultiplied?: boolean; transparent?: [number, number, number] } = {}): { href: string; w: number; h: number; bottomUp: boolean } | null {
  if (header.length >= 40) {
    const hs = u32(header, 0), comp = u32(header, 16);
    if (hs >= 40 && (comp === 4 || comp === 5)) {
      const data = pixels ?? header.subarray(dibHeaderSize(header));
      return { href: `data:${comp === 4 ? 'image/jpeg' : 'image/png'};base64,${b64(data)}`, w: Math.abs(i32(header, 4)), h: Math.abs(i32(header, 8)), bottomUp: i32(header, 8) > 0 };
    }
  }
  const dib = decodeDib(header, pixels);
  if (!dib) return null;
  const px = dib.rgba;
  if (opts.premultiplied) for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]; if (a && a < 255) for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, Math.round((px[i + c] * 255) / a)); }
  if (opts.transparent) { const [r, g, b] = opts.transparent; for (let i = 0; i < px.length; i += 4) if (px[i] === r && px[i + 1] === g && px[i + 2] === b) px[i + 3] = 0; }
  return { href: `data:image/png;base64,${b64(encodePng(dib.w, dib.h, dib.rgba))}`, w: dib.w, h: dib.h, bottomUp: dib.bottomUp };
}
