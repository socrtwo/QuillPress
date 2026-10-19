/**
 * A small PNG decoder for exports that run where no canvas is available (tests, workers, Node):
 * 8-bit non-interlaced images of every color type. Returns RGB bytes and, when present, alpha.
 */
import { immortalInflate } from './recover/inflate';

export interface DecodedPng { w: number; h: number; rgb: Uint8Array; alpha?: Uint8Array }

export function decodePng(d: Uint8Array): DecodedPng | null {
  if (d.length < 33 || d[0] !== 0x89 || d[1] !== 0x50 || d[2] !== 0x4e || d[3] !== 0x47) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const w = dv.getUint32(16), h = dv.getUint32(20), depth = d[24], ctype = d[25], interlace = d[28];
  if (depth !== 8 || interlace !== 0 || !w || !h || w * h > 50e6) return null;
  const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : ctype === 6 ? 4 : 0;
  if (!channels) return null;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let i = 8;
  while (i + 8 <= d.length) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    const body = d.subarray(i + 8, Math.min(d.length, i + 8 + len));
    if (type === 'PLTE') palette = body; else if (type === 'tRNS') trns = body; else if (type === 'IDAT') idat.push(body); else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!idat.length) return null;
  const total = idat.reduce((a, b) => a + b.length, 0);
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) { z.set(c, o); o += c.length; }
  // zlib wrapper: 2-byte header, raw deflate, 4-byte adler.
  const raw = immortalInflate(z.subarray(2)).data;
  const stride = w * channels;
  if (raw.length < (stride + 1) * h) return null;
  const px = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  const rgb = new Uint8Array(w * h * 3);
  let alpha: Uint8Array | undefined;
  for (let p = 0, q = 0; p < w * h; p++, q += 3) {
    const s = p * channels;
    if (ctype === 0) { rgb[q] = rgb[q + 1] = rgb[q + 2] = px[s]; }
    else if (ctype === 2) { rgb[q] = px[s]; rgb[q + 1] = px[s + 1]; rgb[q + 2] = px[s + 2]; }
    else if (ctype === 3) { const k = px[s] * 3; rgb[q] = palette?.[k] ?? 0; rgb[q + 1] = palette?.[k + 1] ?? 0; rgb[q + 2] = palette?.[k + 2] ?? 0; if (trns && px[s] < trns.length) { (alpha ||= new Uint8Array(w * h).fill(255))[p] = trns[px[s]]; } }
    else if (ctype === 4) { rgb[q] = rgb[q + 1] = rgb[q + 2] = px[s]; (alpha ||= new Uint8Array(w * h))[p] = px[s + 1]; }
    else { rgb[q] = px[s]; rgb[q + 1] = px[s + 1]; rgb[q + 2] = px[s + 2]; (alpha ||= new Uint8Array(w * h))[p] = px[s + 3]; }
  }
  if (alpha && alpha.every((v) => v === 255)) alpha = undefined;
  return { w, h, rgb, alpha };
}
