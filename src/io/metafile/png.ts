/**
 * A small synchronous PNG encoder for the bitmaps found in metafiles (they become data URIs inside
 * the SVG the converter writes). Deflate uses fixed Huffman codes with a hash-chain match finder:
 * not the smallest output, but compact for the flat colours and patterns metafile bitmaps hold, and
 * it needs neither a canvas nor CompressionStream, so it works in workers and tests alike.
 */
import { crc32 } from '../recover/inflate';

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

class BitWriter {
  buf: Uint8Array;
  pos = 0;
  bit = 0;
  cur = 0;
  constructor(size: number) { this.buf = new Uint8Array(Math.max(64, size)); }
  private grow(): void { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
  /** Writes `n` bits of `v`, least significant first (deflate's order for non-Huffman fields). */
  bits(v: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.cur |= ((v >>> i) & 1) << this.bit;
      if (++this.bit === 8) { if (this.pos >= this.buf.length) this.grow(); this.buf[this.pos++] = this.cur; this.cur = 0; this.bit = 0; }
    }
  }
  /** Writes a Huffman code, most significant bit first. */
  code(c: number, n: number): void { for (let i = n - 1; i >= 0; i--) this.bits((c >>> i) & 1, 1); }
  bytes(): Uint8Array { if (this.bit) { if (this.pos >= this.buf.length) this.grow(); this.buf[this.pos++] = this.cur; this.cur = 0; this.bit = 0; } return this.buf.subarray(0, this.pos); }
}

/** Fixed-code literal/length symbol. */
function litLen(w: BitWriter, sym: number): void {
  if (sym < 144) w.code(0x30 + sym, 8);
  else if (sym < 256) w.code(0x190 + sym - 144, 9);
  else if (sym < 280) w.code(sym - 256, 7);
  else w.code(0xc0 + sym - 280, 8);
}

function findIndex(base: number[], v: number): number { let i = base.length - 1; while (base[i] > v) i--; return i; }

/** zlib stream (header, fixed-Huffman deflate blocks, Adler-32). */
export function zlibCompress(data: Uint8Array): Uint8Array {
  const w = new BitWriter(data.length / 2 + 64);
  w.bits(0x78, 8); w.bits(0x01, 8);
  w.bits(1, 1); w.bits(1, 2); // one final block, fixed codes
  const HASH = 1 << 15, WINDOW = 32768, MAXCHAIN = 32;
  const head = new Int32Array(HASH).fill(-1);
  const prev = new Int32Array(WINDOW).fill(-1);
  const hash = (i: number) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH - 1);
  const insert = (i: number) => { if (i + 2 >= data.length) return; const h = hash(i); prev[i & (WINDOW - 1)] = head[h]; head[h] = i; };
  let i = 0;
  while (i < data.length) {
    let bestLen = 0, bestDist = 0;
    if (i + 2 < data.length) {
      let cand = head[hash(i)], chain = 0;
      const max = Math.min(258, data.length - i);
      while (cand >= 0 && i - cand <= WINDOW && chain++ < MAXCHAIN) {
        if (data[cand + bestLen] === data[i + bestLen]) {
          let l = 0;
          while (l < max && data[cand + l] === data[i + l]) l++;
          if (l > bestLen) { bestLen = l; bestDist = i - cand; if (l === max) break; }
        }
        cand = prev[cand & (WINDOW - 1)];
      }
    }
    if (bestLen >= 3) {
      const li = findIndex(LEN_BASE, bestLen);
      litLen(w, 257 + li);
      if (LEN_EXTRA[li]) w.bits(bestLen - LEN_BASE[li], LEN_EXTRA[li]);
      const di = findIndex(DIST_BASE, bestDist);
      w.code(di, 5);
      if (DIST_EXTRA[di]) w.bits(bestDist - DIST_BASE[di], DIST_EXTRA[di]);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      litLen(w, data[i]);
      insert(i);
      i++;
    }
  }
  litLen(w, 256);
  const body = w.bytes();
  let a = 1, b = 0;
  for (let k = 0; k < data.length; k++) { a = (a + data[k]) % 65521; b = (b + a) % 65521; }
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  const ad = ((b << 16) | a) >>> 0;
  out[body.length] = ad >>> 24; out[body.length + 1] = (ad >>> 16) & 255; out[body.length + 2] = (ad >>> 8) & 255; out[body.length + 3] = ad & 255;
  return out;
}

/** PNG (8-bit RGBA, or RGB when every pixel is opaque) from RGBA pixels, top row first. */
export function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const ch = opaque ? 3 : 4;
  const stride = w * ch + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const o = y * stride;
    raw[o] = 1; // Sub filter: flat areas become runs of zeros, which the match finder likes
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = o + 1 + x * ch;
      for (let c = 0; c < ch; c++) raw[d + c] = (rgba[s + c] - (x ? rgba[s - 4 + c] : 0)) & 255;
    }
  }
  const idat = zlibCompress(raw);
  const chunks: Uint8Array[] = [];
  const chunk = (type: string, body: Uint8Array) => {
    const c = new Uint8Array(12 + body.length);
    const n = body.length;
    c[0] = n >>> 24; c[1] = (n >>> 16) & 255; c[2] = (n >>> 8) & 255; c[3] = n & 255;
    for (let k = 0; k < 4; k++) c[4 + k] = type.charCodeAt(k);
    c.set(body, 8);
    const crc = crc32(c.subarray(4, 8 + n));
    c[8 + n] = crc >>> 24; c[9 + n] = (crc >>> 16) & 255; c[10 + n] = (crc >>> 8) & 255; c[11 + n] = crc & 255;
    chunks.push(c);
  };
  const ihdr = new Uint8Array(13);
  ihdr[0] = w >>> 24; ihdr[1] = (w >>> 16) & 255; ihdr[2] = (w >>> 8) & 255; ihdr[3] = w & 255;
  ihdr[4] = h >>> 24; ihdr[5] = (h >>> 16) & 255; ihdr[6] = (h >>> 8) & 255; ihdr[7] = h & 255;
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const total = 8 + chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  out.set(sig);
  let p = 8;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
