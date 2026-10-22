import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { metafileToSvg, isMetafile } from '../../src/io/metafile/index';
import { encodePng, zlibCompress } from '../../src/io/metafile/png';
import { decodeDib } from '../../src/io/metafile/dib';
import { decodePng } from '../../src/io/png';
import { immortalInflate } from '../../src/io/recover/inflate';
import { parseDelayStream } from '../../src/io/mspub/escher';
import { mediaFromBytes } from '../../src/io/images';

// ------------------------------------------------------------------------------------------
// Writers for small metafiles

class Bytes {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 255); return this; }
  u16(v: number) { this.b.push(v & 255, (v >> 8) & 255); return this; }
  i16(v: number) { return this.u16(v & 0xffff); }
  u32(v: number) { this.b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); return this; }
  i32(v: number) { return this.u32(v >>> 0); }
  f32(v: number) { const a = new DataView(new ArrayBuffer(4)); a.setFloat32(0, v, true); for (let i = 0; i < 4; i++) this.b.push(a.getUint8(i)); return this; }
  raw(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.b.push(a[i]); return this; }
  pad(n: number) { while (this.b.length < n) this.b.push(0); return this; }
  get length() { return this.b.length; }
  out() { return new Uint8Array(this.b); }
}

/** A WMF: placeable header (inch = 1440) then records given as [function, 16-bit words or byte arrays]. */
function wmf(bbox: [number, number, number, number], records: [number, (number | number[])[]][]): Uint8Array {
  const body = new Bytes();
  for (const [fn, params] of records) {
    const p = new Bytes();
    for (const v of params) { if (Array.isArray(v)) { p.raw(v); if (v.length & 1) p.u8(0); } else p.i16(v); }
    body.u32(3 + p.length / 2).u16(fn).raw(p.b);
  }
  body.u32(3).u16(0);
  const f = new Bytes();
  f.u32(0x9ac6cdd7).u16(0).i16(bbox[0]).i16(bbox[1]).i16(bbox[2]).i16(bbox[3]).u16(1440).u32(0).u16(0);
  f.u16(1).u16(9).u16(0x300).u32(9 + body.length / 2).u16(8).u32(64).u16(0);
  f.raw(body.b);
  return f.out();
}
const colour = (r: number, g: number, b: number): number[] => [r | (g << 8), b];
const str = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
function dib24(w: number, h: number, px: [number, number, number][]): number[] {
  const d = new Bytes();
  d.u32(40).i32(w).i32(h).u16(1).u16(24).u32(0).u32(0).u32(0).u32(0).u32(0).u32(0);
  const stride = Math.floor((w * 24 + 31) / 32) * 4;
  for (let row = 0; row < h; row++) { const start = d.length; for (let x = 0; x < w; x++) { const [r, g, b] = px[(h - 1 - row) * w + x]; d.u8(b).u8(g).u8(r); } d.pad(start + stride); }
  return d.b;
}

/** An EMF: header (bounds in pixels, frame in 0.01 mm, a 96-dpi device) then records [type, body]. */
function emf(frame: [number, number, number, number], records: [number, Bytes][]): Uint8Array {
  const recs: Uint8Array[] = records.map(([type, body]) => { const r = new Bytes(); r.u32(type).u32(8 + body.length).raw(body.b); return r.out(); });
  const eof = new Bytes(); eof.u32(14).u32(20).u32(0).u32(0).u32(20);
  recs.push(eof.out());
  const h = new Bytes();
  const devPx = [1000, 1000], devMm = [264.58, 264.58]; // 96 dpi
  h.u32(1).u32(108).i32(0).i32(0).i32(200).i32(100).i32(frame[0]).i32(frame[1]).i32(frame[2]).i32(frame[3]).u32(0x464d4520).u32(0x10000);
  const total = 108 + recs.reduce((n, r) => n + r.length, 0);
  h.u32(total).u32(recs.length + 1).u16(4).u16(0).u32(0).u32(0).u32(0).i32(devPx[0]).i32(devPx[1]).i32(Math.round(devMm[0])).i32(Math.round(devMm[1]));
  h.u32(0).u32(0).u32(0).i32(Math.round(devMm[0] * 1000)).i32(Math.round(devMm[1] * 1000));
  const out = new Bytes(); out.raw(h.b); for (const r of recs) out.raw(r);
  return out.out();
}
const B = () => new Bytes();
const rect16 = (b: Bytes) => b.i32(0).i32(0).i32(0).i32(0);

// ------------------------------------------------------------------------------------------

describe('PNG encoder and DIB decoder', () => {
  it('round-trips pixels through the PNG encoder and the app PNG decoder', () => {
    const w = 37, h = 11, px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { px[i * 4] = (i * 7) & 255; px[i * 4 + 1] = (i * 3) & 255; px[i * 4 + 2] = i % 2 ? 255 : 0; px[i * 4 + 3] = i % 5 ? 255 : 128; }
    const png = encodePng(w, h, px);
    const back = decodePng(png)!;
    expect([back.w, back.h]).toEqual([w, h]);
    for (let i = 0; i < w * h; i++) {
      expect([back.rgb[i * 3], back.rgb[i * 3 + 1], back.rgb[i * 3 + 2]]).toEqual([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
      expect(back.alpha![i]).toBe(px[i * 4 + 3]);
    }
  });
  it('compresses repetitive data and inflates back', () => {
    const data = new Uint8Array(20000).map((_, i) => (i % 300 < 150 ? 65 : i & 255));
    const z = zlibCompress(data);
    expect(z.length).toBeLessThan(data.length / 2);
    expect(Array.from(immortalInflate(z.subarray(2, z.length - 4)).data)).toEqual(Array.from(data));
  });
  it('decodes 1-, 8-, 16-, 24- and 32-bit DIBs and RLE8', () => {
    const one = new Bytes().u32(40).i32(8).i32(-1).u16(1).u16(1).u32(0).u32(0).u32(0).u32(0).u32(2).u32(0).u32(0x0000ff).u32(0x00ff00).u8(0b10100000).pad(40 + 8 + 4);
    const d1 = decodeDib(one.out())!;
    expect(Array.from(d1.rgba.subarray(0, 8))).toEqual([0, 255, 0, 255, 0, 0, 255, 255]); // colour table entries are blue, green, red
    const d24 = decodeDib(new Uint8Array(dib24(2, 2, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]])))!;
    expect(Array.from(d24.rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(d24.rgba.subarray(12, 16))).toEqual([9, 9, 9, 255]);
    const d16 = decodeDib(new Bytes().u32(40).i32(1).i32(1).u16(1).u16(16).u32(0).pad(40).u16(0x7c00).pad(44).out())!;
    expect(d16.rgba[0]).toBe(255);
    const d32 = decodeDib(new Bytes().u32(40).i32(1).i32(1).u16(1).u16(32).u32(3).pad(40).u32(0xff0000).u32(0xff00).u32(0xff).u32(0x80102030).out())!;
    expect(Array.from(d32.rgba)).toEqual([0x10, 0x20, 0x30, 255]);
    const rle = new Bytes().u32(40).i32(4).i32(1).u16(1).u16(8).u32(1).u32(0).u32(0).u32(0).u32(2).u32(0).u32(0x000000).u32(0xffffff).u8(4).u8(1).u8(0).u8(1);
    const dr = decodeDib(rle.out())!;
    expect(Array.from(dr.rgba.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  });
});

describe('WMF to SVG', () => {
  const drawing = () => wmf([0, 0, 1440, 720], [
    [0x020b, [0, 0]], // SetWindowOrg (y, x)
    [0x020c, [720, 1440]], // SetWindowExt (y, x)
    [0x02fa, [0, 30, 0, ...colour(255, 0, 0)]], // CreatePenIndirect: solid, width 30, red → object 0
    [0x02fc, [0, ...colour(0, 0, 255), 0]], // CreateBrushIndirect: solid blue → 1
    [0x012d, [0]], [0x012d, [1]],
    [0x041b, [400, 600, 100, 100]], // Rectangle (bottom, right, top, left)
    [0x0418, [700, 1400, 500, 1000]], // Ellipse
    [0x0324, [3, 0, 0, 100, 0, 50, 80]], // Polygon
    [0x0538, [2, 3, 3, 0, 0, 10, 0, 5, 5, 20, 20, 30, 20, 25, 25]], // PolyPolygon
    [0x081a, [100, 800, 100, 1000, 300, 1000, 0, 800]], // Pie
    [0x02fc, [2, ...colour(0, 128, 0), 4]], // hatched cross brush → 2
    [0x012d, [2]],
    [0x061c, [40, 40, 700, 400, 500, 100]], // RoundRect
    [0x001e, []], // SaveDC
    [0x0416, [300, 300, 0, 0]], // IntersectClipRect
    [0x0209, [...colour(0, 0, 0)]],
    [0x02fb, [-200, 0, 0, 0, 700, [0, 0, 0, 0, 0, 0, 0, 0x22], str('Arial\0')]],
    [0x012d, [3]],
    [0x0a32, [50, 60, 4, 0, [0x80, 0x41, 0x42, 0x43], 100, 100, 100, 100]], // ExtTextOut "€ABC" with dx
    [0x0127, [-1]], // RestoreDC
    [0x0940, [...[0x0021, 0x00f0], 0, 0, 0, 50, 50, 600, 1300]], // DIBBitBlt, no bitmap: PATCOPY
    [0x0f43, [...[0x0020, 0x00cc], 0, 2, 2, 0, 0, 100, 100, 600, 0, dib24(2, 2, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]])]] as any, // StretchDIB
  ]);

  it('maps the window onto the picture and keeps the placeable size', () => {
    const r = metafileToSvg(drawing())!;
    expect(r).toBeTruthy();
    expect(r.w).toBeCloseTo(72, 3);
    expect(r.h).toBeCloseTo(36, 3);
    expect(r.svg).toMatch(/viewBox="0 0 1440 720"/);
    expect(r.svg).toContain('d="M100 100L600 100L600 400L100 400Z" fill="#0000ff"');
    expect(r.svg).toContain('stroke="#ff0000" stroke-width="30"');
  });
  it('draws ellipses, polygons, pies, hatches, clipped text and bitmaps', () => {
    const svg = metafileToSvg(drawing())!.svg;
    if (process.env.XDUMP) writeFileSync(process.env.XDUMP + '/t-wmf.svg', svg);
    expect(svg).toMatch(/<path d="M1400 600C/); // ellipse starts at its right end
    expect(svg).toContain('d="M0 0L100 0L50 80Z"');
    expect(svg).toMatch(/fill-rule="evenodd"/); // PolyPolygon with the alternate fill mode
    expect(svg).toMatch(/L900 150Z/); // the pie closes at the centre
    expect(svg).toMatch(/<pattern id="mp\d+"[^>]*>(<rect[^>]*fill="#ffffff"\/>)?<path d="M0 [\d.]+H[\d.]+M[\d.]+ 0V[^"]*" stroke="#008000"/); // cross hatch on the opaque background
    expect(svg).toMatch(/<text[^>]*x="0 100 200 300"[^>]*font-size="200"[^>]*font-weight="700"[^>]*clip-path="url\(#mc\d+\)">€ABC<\/text>/);
    expect(svg).toContain(`font-family="'Arial', 'Arimo', sans-serif"`);
    expect(svg).toMatch(/d="M1300 600L1350 600L1350 650L1300 650Z" fill="url\(#mp\d+\)"/); // PATCOPY with the brush RestoreDC brought back (the hatch)
    expect(svg).toMatch(/<image transform="matrix\(50 0 0 50 0 600\)" width="2" height="2"[^>]*href="data:image\/png;base64,/);
  });
  it('uses the BLIP bounds when the file has no placeable header, and sniffs metafiles', () => {
    const placeable = drawing();
    const plain = placeable.subarray(22);
    expect(isMetafile(plain)).toBe(true);
    expect(isMetafile(placeable)).toBe(true);
    const r = metafileToSvg(plain, { bounds: { left: 0, top: 0, right: 1440, bottom: 720 }, sizePt: { w: 100, h: 50 } })!;
    expect([r.w, r.h]).toEqual([100, 50]);
    expect(r.svg).toContain('d="M100 100L600 100L600 400L100 400Z"');
  });
  it('flips a window with a negative extent and rescales when the window changes', () => {
    const r = metafileToSvg(wmf([0, 0, 100, 100], [
      [0x020b, [100, 0]], [0x020c, [-100, 100]], // y-up window: origin at the top-left, y grows upwards
      [0x041b, [80, 30, 90, 10]], // Rectangle top 90 → device y 10
      [0x020c, [-200, 200]], // a larger window shrinks what follows by half
      [0x041b, [80, 30, 90, 10]],
    ]))!;
    expect(r.svg).toContain('d="M10 10L30 10L30 20L10 20Z"');
    expect(r.svg).toContain('d="M5 5L15 5L15 10L5 10Z"');
  });
  it('never throws on damaged input', () => {
    const good = drawing();
    for (let cut = 30; cut < good.length; cut += 37) expect(() => metafileToSvg(good.subarray(0, cut))).not.toThrow();
    const noisy = good.slice(); for (let i = 40; i < noisy.length; i += 13) noisy[i] ^= 0x5a;
    expect(() => metafileToSvg(noisy)).not.toThrow();
    expect(metafileToSvg(new Uint8Array(64))).toBeNull();
    const loop = new Bytes().u16(1).u16(9).u16(0x300).u32(20).u16(1).u32(3).u16(0).u32(0).u16(0x41b).out(); // a zero-size record
    expect(() => metafileToSvg(loop)).not.toThrow();
  });
  it('converts a placed .wmf file into SVG media', async () => {
    const m = await mediaFromBytes(drawing(), 'logo.wmf');
    expect(m.mime).toBe('image/svg+xml');
    expect(m.name).toBe('logo.svg');
    expect([m.w, m.h]).toEqual([72, 36]);
  });
});

describe('EMF to SVG', () => {
  const sample = () => emf([0, 0, 5292, 2646], [ // 200 × 100 px at 96 dpi
    [39, B().u32(1).u32(0).u32(0x00ffff).u32(0)], // CreateBrushIndirect yellow → 1
    [38, B().u32(2).u32(0).i32(4).i32(0).u32(0x0000ff)], // CreatePen solid width 4 red → 2
    [37, B().u32(1)], [37, B().u32(2)],
    [43, B().i32(10).i32(10).i32(60).i32(40)], // Rectangle
    [59, B()], // BeginPath
    [27, B().i32(100).i32(10)], // MoveToEx
    [54, B().i32(150).i32(10)], // LineTo
    [88, rect16(B()).u32(3).i16(150).i16(50).i16(120).i16(60).i16(100).i16(50)], // PolyBezierTo16
    [61, B()], [60, B()], [63, B()], // CloseFigure, EndPath, StrokeAndFillPath
    [37, B().u32(0x80000005)], [37, B().u32(0x80000007)], // NULL_BRUSH, BLACK_PEN
    [35, B().f32(0).f32(1).f32(-1).f32(0).f32(100).f32(0)], // SetWorldTransform: 90° rotation, then x + 100
    [43, B().i32(0).i32(0).i32(20).i32(10)], // Rectangle under the transform
    [36, B().f32(1).f32(0).f32(0).f32(1).f32(0).f32(0).u32(1)], // ModifyWorldTransform identity
    [82, (() => { const b = B().u32(3).i32(-20).i32(0).i32(0).i32(0).i32(400).u8(1).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0); for (const c of 'Times New Roman') b.u16(c.charCodeAt(0)); return b.pad(4 + 92); })()],
    [37, B().u32(3)],
    [24, B().u32(0x008000)], // SetTextColor green
    [84, (() => { // ExtTextOutW "Hé€" at (20, 80) with advances
      const b = rect16(B()).u32(1).f32(1).f32(1);
      const text = 'Hé€'; const offStr = 8 + 16 + 12 + 40, offDx = offStr + 8;
      b.i32(20).i32(80).u32(text.length).u32(offStr).u32(0).i32(0).i32(0).i32(0).i32(0).u32(offDx);
      for (const c of text) b.u16(c.charCodeAt(0)); b.u16(0);
      b.i32(12).i32(10).i32(11);
      return b;
    })()],
    [118, (() => { const b = rect16(B()).u32(2).u32(1).u32(0); b.i32(150).i32(70).u16(0).u16(0xff00).u16(0).u16(0); b.i32(190).i32(95).u16(0xff00).u16(0).u16(0).u16(0); b.u32(0).u32(1); return b; })()], // GradientFill rect, horizontal
    [75, (() => { const b = B().u32(48).u32(5); b.u32(32).u32(1).u32(1).u32(16).i32(0).i32(0).i32(50).i32(50); b.i32(0).i32(0).i32(50).i32(50); return b; })()], // ExtSelectClipRgn copy
    [81, (() => { // StretchDIBits a 2×2 bitmap into (0, 50)-(40, 90)
      const bmi = dib24(2, 2, [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0]]);
      const header = bmi.slice(0, 40), bits = bmi.slice(40);
      const b = rect16(B()).i32(0).i32(50).i32(0).i32(0).i32(2).i32(2);
      const offBmi = 8 + 72, offBits = offBmi + 40;
      b.u32(offBmi).u32(40).u32(offBits).u32(bits.length).u32(0).u32(0x00cc0020).i32(40).i32(40);
      b.raw(header).raw(bits);
      return b;
    })()],
  ]);

  it('reads the frame and draws in device pixels', () => {
    const r = metafileToSvg(sample())!;
    expect(r).toBeTruthy();
    expect(r.w).toBeCloseTo(150, 0);
    expect(r.h).toBeCloseTo(75, 0);
    expect(r.svg).toMatch(/viewBox="0 0 200(\.\d+)? 100(\.\d+)?"/);
    expect(r.svg).toContain('d="M10 10L60 10L60 40L10 40Z" fill="#ffff00"');
  });
  it('fills and strokes a path bracket with Bézier segments', () => {
    const svg = metafileToSvg(sample())!.svg;
    expect(svg).toMatch(/<path d="M100 10L150 10C150 50 120 60 100 50Z" fill="#ffff00"[^>]*stroke="#ff0000"/);
  });
  it('applies the world transform to geometry', () => {
    const svg = metafileToSvg(sample())!.svg;
    expect(svg).toContain('d="M100 0L100 20L90 20L90 0Z" fill="none"'); // (x,y) → (100 − y, x)
  });
  it('writes Unicode text with its advances, gradients, clipping and bitmaps', () => {
    const svg = metafileToSvg(sample())!.svg;
    if (process.env.XDUMP) writeFileSync(process.env.XDUMP + '/t-emf.svg', svg);
    expect(svg).toMatch(/<text transform="translate\(20 80\)" x="0 12 22"[^>]*font-family="'Times New Roman', 'Tinos', serif"[^>]*font-size="20"[^>]*font-style="italic"[^>]*fill="#008000"[^>]*>Hé€<\/text>/);
    expect(svg).toMatch(/<linearGradient id="mg\d+" gradientUnits="userSpaceOnUse" x1="150" y1="70" x2="190" y2="70"><stop offset="0" stop-color="#00ff00"\/><stop offset="1" stop-color="#ff0000"\/>/);
    expect(svg).toMatch(/<clipPath id="mc\d+"><path d="M0 0L50 0L50 50L0 50Z"/);
    expect(svg).toMatch(/<image transform="matrix\(20 0 0 20 0 50\)" width="2" height="2"/);
  });
  it('never throws on damaged input', () => {
    const good = sample();
    for (let cut = 90; cut < good.length; cut += 29) expect(() => metafileToSvg(good.subarray(0, cut))).not.toThrow();
    const noisy = good.slice(); for (let i = 120; i < noisy.length; i += 11) noisy[i] ^= 0xa5;
    expect(() => metafileToSvg(noisy)).not.toThrow();
  });
});

describe('Publisher metafile pictures', () => {
  it('reads the BLIP metafile header and keeps the deflated data', () => {
    const meta = wmf([0, 0, 1440, 720], [[0x020c, [720, 1440]], [0x041b, [400, 600, 100, 100]]]).subarray(22);
    const z = zlibCompress(meta);
    const rec = new Bytes();
    const body = new Bytes();
    body.raw(new Array(16).fill(7)); // one UID
    body.u32(meta.length).i32(0).i32(0).i32(1440).i32(720).i32(12700 * 100).i32(12700 * 50).u32(z.length).u8(0).u8(0xfe).raw(z);
    rec.u16((0x216 << 4) | 0).u16(0xf01b).u32(body.length).raw(body.b);
    const pics = parseDelayStream(rec.out());
    expect(pics).toHaveLength(1);
    expect(pics[0].kind).toBe('wmf');
    expect(pics[0].meta).toEqual({ compressed: true, bounds: { left: 0, top: 0, right: 1440, bottom: 720 }, sizePt: { w: 100, h: 50 } });
    const raw = immortalInflate(pics[0].data).data;
    expect(Array.from(raw)).toEqual(Array.from(meta));
  });

  const dir = '/home/user/samples/pub2/pub';
  const has = existsSync(dir);
  (has ? it : it.skip)('converts the clip art and WordArt pictures of the corpus', async () => {
    const { importMsPub } = await import('../../src/io/mspub');
    const svgMedia = async (f: string) => {
      const r = await importMsPub(new Uint8Array(readFileSync(`${dir}/${f}`)), f);
      return { r, svgs: Object.values(r.pub.media).filter((m) => m.mime === 'image/svg+xml').map((m) => Buffer.from(m.b64, 'base64').toString('utf8')) };
    };
    const reg = await svgMedia('REG-TST2-pub2010.pub');
    expect(reg.svgs).toHaveLength(13);
    expect(reg.r.warnings.some((w) => /13 Windows metafile pictures were converted/.test(w))).toBe(true);
    expect(reg.svgs.every((s) => s.startsWith('<svg') && s.includes('<path'))).toBe(true);
    const news = await svgMedia('923566.pub');
    expect(news.svgs).toHaveLength(3);
    const table = await svgMedia('fdo60556-1.pub');
    expect(table.svgs.some((s) => s.includes('>Total in € (EUR)<') && s.includes('>Hotel (Full Board)<'))).toBe(true);
    const empty = await svgMedia('tdf78739-3.pub');
    expect(empty.svgs).toHaveLength(0);
    expect(empty.r.warnings.some((w) => /2 pictures are metafiles that could not be converted/.test(w))).toBe(true);
  });
});
