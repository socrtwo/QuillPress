/**
 * Windows Metafile (WMF) player: the 16-bit record stream (optionally behind the "placeable"
 * header) drawn into the SVG drawing context.
 *
 * Records are 16-bit words: size in words (32-bit), function number, then parameters, most of them
 * stored in reverse order (y before x, bottom-right before top-left). Objects live in a table where
 * each creation takes the lowest free slot. A WMF that was converted from an EMF may carry the EMF
 * in comment escapes ("WMFC" chunks); when it is complete it is played instead, which keeps curves,
 * transforms and Unicode text the WMF lost.
 */
import { SvgDc, type Pt } from './dc';
import { brushOf, colorRef, decodeText, penOf, readLogFont, ropKind, type Font, type GdiObject, type MetafileHints, type Region } from './objects';
import { dibDataUri } from './dib';
import { encodePng } from './png';
import { b64 } from '../xml';
import { playEmf } from './emf';

const MAX_RECORDS = 2_000_000;

export function playWmf(d: Uint8Array, hints: MetafileHints = {}): { svg: string; w: number; h: number } | null {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const s16 = (o: number) => (o + 2 <= d.length ? dv.getInt16(o, true) : 0);
  const u16 = (o: number) => (o + 2 <= d.length ? dv.getUint16(o, true) : 0);
  const u32 = (o: number) => (o + 4 <= d.length ? dv.getUint32(o, true) : 0);
  let p = 0;
  let bounds = hints.bounds, sizePt = hints.sizePt;
  if (u32(0) === 0x9ac6cdd7) {
    const l = s16(6), t = s16(8), r = s16(10), b = s16(12), inch = u16(14) || 1440;
    bounds = { left: l, top: t, right: r, bottom: b };
    if (!sizePt) sizePt = { w: (Math.abs(r - l) / inch) * 72, h: (Math.abs(b - t) / inch) * 72 };
    p = 22;
  }
  const type = u16(p), headerWords = u16(p + 2);
  if ((type !== 1 && type !== 2) || headerWords !== 9) return null;
  const nObjects = Math.min(u16(p + 12), 65535);
  p += 18;
  const dc = new SvgDc({ mode: 'wmf', bounds, sizePt });
  const objects: (GdiObject | null)[] = new Array(nObjects).fill(null);
  const add = (o: GdiObject) => { let i = objects.indexOf(null); if (i < 0) { i = objects.length; objects.push(null); } objects[i] = o; };
  let palette: string[] = [];
  const col = (o: number) => colorRef(u32(o), palette);
  const emfChunks: Uint8Array[] = [];
  let emfSize = 0;
  let count = 0;
  while (p + 6 <= d.length && count++ < MAX_RECORDS) {
    const size = u32(p) * 2, fn = u16(p + 4);
    if (size < 6) break;
    const end = Math.min(d.length, p + size);
    const a = p + 6; // parameters
    const w = (i: number) => s16(a + i * 2); // i-th 16-bit parameter
    const pts = (o: number, n: number): Pt[] => { const out: Pt[] = []; for (let i = 0; i < n && o + 4 <= end; i++, o += 4) out.push([s16(o), s16(o + 2)]); return out; };
    try {
      switch (fn) {
        case 0x0000: p = d.length; continue; // EOF
        // --- state
        case 0x0103: dc.st.mapMode = w(0); break;
        case 0x0102: dc.st.bkMode = w(0); break;
        case 0x0201: dc.st.bkColor = col(a); break;
        case 0x0209: dc.st.textColor = col(a); break;
        case 0x012e: dc.st.textAlign = u16(a); break;
        case 0x0106: dc.st.polyFill = w(0); break;
        case 0x0104: dc.st.rop2 = w(0); break;
        case 0x0108: dc.st.charExtra = w(0); break;
        case 0x020b: dc.st.wOrg = [w(1), w(0)]; break;
        case 0x020c: dc.st.wExt = [w(1), w(0)]; break;
        case 0x020f: dc.st.wOrg = [dc.st.wOrg[0] + w(1), dc.st.wOrg[1] + w(0)]; break;
        case 0x0410: { const e = dc.st.wExt; if (e && w(0) && w(2)) dc.st.wExt = [(e[0] * w(3)) / w(2), (e[1] * w(1)) / w(0)]; break; }
        case 0x020d: dc.st.vOrg = [w(1), w(0)]; break;
        case 0x020e: dc.st.vExt = [w(1), w(0)]; break;
        case 0x001e: dc.save(); break;
        case 0x0127: dc.restore(w(0)); break;
        // --- objects
        case 0x012d: { const o = objects[u16(a)]; if (o) select(dc, o); break; }
        case 0x01f0: { const i = u16(a); if (i < objects.length) objects[i] = null; break; }
        case 0x02fa: add({ kind: 'pen', pen: penOf(u16(a), Math.abs(w(1)), col(a + 6)) }); break;
        case 0x02fc: add({ kind: 'brush', brush: brushOf(u16(a), col(a + 2), u16(a + 6)) }); break;
        case 0x02fb: add({ kind: 'font', font: readLogFont(d, a, end) }); break;
        case 0x00f7: {
          const n = u16(a + 2); palette = [];
          for (let i = 0; i < n && a + 4 + i * 4 + 3 <= end; i++) { const o = a + 4 + i * 4; palette.push(colorRef(d[o] | (d[o + 1] << 8) | (d[o + 2] << 16))); }
          add({ kind: 'palette', colors: palette }); break;
        }
        case 0x06ff: add({ kind: 'region', region: readRegion16(d, a, end) }); break;
        case 0x0142: { // DIBCreatePatternBrush
          const style = u16(a);
          const img = style === 3 ? bitmap16Uri(d, a + 4, end, 32) : dibDataUri(d.subarray(a + 4, end));
          add({ kind: 'brush', brush: img ? { style: 'pattern', color: '#000000', image: { href: img.href, w: img.w, h: img.h } } : { style: 'solid', color: '#808080' } });
          break;
        }
        case 0x01f9: { const img = bitmap16Uri(d, a, end, 32); add({ kind: 'brush', brush: img ? { style: 'pattern', color: '#000000', image: { href: img.href, w: img.w, h: img.h } } : { style: 'solid', color: '#808080' } }); break; }
        case 0x0234: case 0x0035: case 0x0037: case 0x0139: case 0x0436: break; // palettes in effect: colours are resolved at creation
        // --- drawing
        case 0x0214: dc.moveTo(w(1), w(0)); break;
        case 0x0213: dc.lineTo(w(1), w(0)); break;
        case 0x0324: dc.polygon(pts(a + 2, u16(a))); break;
        case 0x0325: dc.polyline(pts(a + 2, u16(a))); break;
        case 0x0538: {
          const n = u16(a); const counts: number[] = []; for (let i = 0; i < n; i++) counts.push(u16(a + 2 + i * 2));
          let o = a + 2 + n * 2; const polys: Pt[][] = [];
          for (const c of counts) { polys.push(pts(o, c)); o += c * 4; }
          dc.polyPolygon(polys); break;
        }
        case 0x041b: dc.rect(w(3), w(2), w(1), w(0)); break;
        case 0x061c: dc.roundRect(w(5), w(4), w(3), w(2), w(1), w(0)); break;
        case 0x0418: dc.ellipse(w(3), w(2), w(1), w(0)); break;
        case 0x0817: case 0x081a: case 0x0830:
          dc.arc(fn === 0x0817 ? 'arc' : fn === 0x081a ? 'pie' : 'chord', w(7), w(6), w(5), w(4), w(3), w(2), w(1), w(0)); break;
        case 0x041f: { const c = col(a); const x = w(3), y = w(2); dc.fillRect(x, y, 1, 1, c); break; }
        case 0x061d: blitFill(dc, u32(a), w(5), w(4), w(3), w(2)); break; // PatBlt: rop, height, width, y, x
        case 0x0521: { // TextOut: count, string, y, x
          const n = u16(a), sb = d.subarray(a + 2, Math.min(end, a + 2 + n));
          const o = a + 2 + n + (n & 1);
          dc.text(s16(o + 2), s16(o), decodeText(sb, dc.st.font.charset), null); break;
        }
        case 0x0a32: { // ExtTextOut: y, x, count, options, [rect], string, [dx]
          const y = w(0), x = w(1), n = u16(a + 4), opt = u16(a + 6);
          let o = a + 8; let rect: [number, number, number, number] | undefined;
          if (opt & 6 && o + 8 <= end) { rect = [s16(o), s16(o + 2), s16(o + 4), s16(o + 6)]; o += 8; }
          const sb = d.subarray(o, Math.min(end, o + n));
          o += n + (n & 1);
          const raw: number[] = []; for (let i = 0; i < n && o + 2 <= end; i++, o += 2) raw.push(s16(o));
          const text = decodeText(sb, dc.st.font.charset);
          dc.text(x, y, text, raw.length === n ? perChar(raw, sb, text, dc.st.font) : null, opt, rect); break;
        }
        case 0x0416: dc.intersectClip(w(3), w(2), w(1), w(0)); break;
        case 0x0415: dc.excludeClip(w(3), w(2), w(1), w(0)); break;
        case 0x012c: { const o = objects[u16(a)]; dc.clipRegion(o && o.kind === 'region' ? o.region : null, 5); break; }
        case 0x0228: { const r = objects[u16(a)], b = objects[u16(a + 2)]; if (r?.kind === 'region' && b?.kind === 'brush') dc.fillRegion(r.region, b.brush); break; }
        case 0x0429: { const r = objects[u16(a)], b = objects[u16(a + 2)]; if (r?.kind === 'region' && b?.kind === 'brush') dc.frameRegion(r.region, b.brush, w(4), w(3)); break; }
        case 0x012b: { const r = objects[u16(a)]; if (r?.kind === 'region') dc.fillRegion(r.region, dc.st.brush); break; }
        // --- bitmaps
        case 0x0940: case 0x0b41: case 0x0f43: case 0x0d33: case 0x0922: case 0x0b23:
          blit(dc, d, fn, size, a, end, s16, u16, u32); break;
        case 0x0626: { // Escape: an embedded EMF travels in MFCOMMENT chunks
          const func = u16(a), bytes = u16(a + 2), o = a + 4;
          if (func === 0x000f && bytes >= 34 && u32(o) === 0x43464d57 && u32(o + 4) === 1) {
            const chunkSize = u32(o + 22); emfSize = u32(o + 30);
            if (chunkSize && o + 34 + chunkSize <= end) emfChunks.push(d.slice(o + 34, o + 34 + chunkSize));
          }
          break;
        }
        default: break; // flood fills, palette animation, page/document records: nothing to draw
      }
    } catch { /* a damaged record: skip it */ }
    p += size;
  }
  if (emfChunks.length && emfSize) {
    const total = emfChunks.reduce((n, c) => n + c.length, 0);
    if (total >= emfSize) {
      const emf = new Uint8Array(total); let o = 0; for (const c of emfChunks) { emf.set(c, o); o += c.length; }
      const r = playEmf(emf.subarray(0, emfSize), { sizePt });
      if (r) return r;
    }
  }
  return dc.finish();
}

function select(dc: SvgDc, o: GdiObject): void {
  if (o.kind === 'pen') dc.st.pen = o.pen;
  else if (o.kind === 'brush') dc.st.brush = o.brush;
  else if (o.kind === 'font') dc.st.font = o.font;
  else if (o.kind === 'region') dc.clipRegion(o.region, 5);
}

/** Advances per character from per-byte advances (double-byte character sets give two per character). */
function perChar(dx: number[], bytes: Uint8Array, text: string, f: Font): number[] {
  if (text.length === dx.length) return dx;
  const dbcs = [128, 129, 130, 134, 136].includes(f.charset);
  if (!dbcs) return dx.slice(0, text.length);
  const out: number[] = [];
  for (let i = 0; i < bytes.length && out.length < text.length; i++) {
    const lead = bytes[i] >= 0x81 && (f.charset !== 128 || bytes[i] <= 0x9f || bytes[i] >= 0xe0);
    if (lead && i + 1 < bytes.length) { out.push((dx[i] || 0) + (dx[i + 1] || 0)); i++; } else out.push(dx[i] || 0);
  }
  return out;
}

/** WMF Region object: header, bounds, then scans (count, top, bottom, left/right pairs, count). */
function readRegion16(d: Uint8Array, a: number, end: number): Region {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const s = (o: number) => (o + 2 <= end ? dv.getInt16(o, true) : 0);
  const scans = s(a + 12);
  const rects: Region['rects'] = [];
  let o = a + 22;
  for (let i = 0; i < scans && o + 6 <= end; i++) {
    const n = dv.getUint16(o, true), top = s(o + 2), bottom = s(o + 4);
    o += 6;
    for (let k = 0; k + 1 < n && o + 4 <= end; k += 2, o += 4) rects.push([s(o), top, s(o + 2), bottom]);
    o += 2;
  }
  if (!rects.length && scans === 0) { const l = s(a + 14), t = s(a + 16), r = s(a + 18), b = s(a + 20); if (r > l && b > t) rects.push([l, t, r, b]); }
  return { rects };
}

/** A device-dependent Bitmap16 (monochrome as WMF pattern brushes use it) as a PNG data URI. */
function bitmap16Uri(d: Uint8Array, a: number, end: number, headerSize: number): { href: string; w: number; h: number } | null {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (a + 10 > end) return null;
  const width = dv.getInt16(a + 2, true), height = dv.getInt16(a + 4, true), stride = dv.getInt16(a + 6, true), bits = d[a + 9];
  if (width <= 0 || height <= 0 || stride <= 0 || width * height > 4_000_000) return null;
  const px = a + headerSize;
  if (px + stride * height > end) return null;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v = 0;
    if (bits === 1) v = (d[px + y * stride + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    else if (bits === 8) v = d[px + y * stride + x];
    else if (bits === 24) { const q = px + y * stride + x * 3; const o = (y * width + x) * 4; rgba[o] = d[q + 2]; rgba[o + 1] = d[q + 1]; rgba[o + 2] = d[q]; rgba[o + 3] = 255; continue; }
    else return null;
    const o = (y * width + x) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
  }
  return { href: `data:image/png;base64,${b64(encodePng(width, height, rgba))}`, w: width, h: height };
}

function blitFill(dc: SvgDc, rop: number, h: number, w: number, y: number, x: number): void {
  const k = ropKind(rop);
  if (k.kind === 'skip') return;
  dc.fillRect(x, y, w, h, k.kind === 'black' ? '#000000' : k.kind === 'white' ? '#ffffff' : undefined);
}

function blit(dc: SvgDc, d: Uint8Array, fn: number, size: number, a: number, end: number, s16: (o: number) => number, u16: (o: number) => number, u32: (o: number) => number): void {
  const rop = u32(a);
  const noBitmap = fn !== 0x0f43 && fn !== 0x0d33 && size / 2 === (fn >> 8) + 3;
  let o = a + 4;
  let srcW = 0, srcH = 0;
  if (fn === 0x0f43) o += 2; // colour usage
  if (fn === 0x0d33) { // SetDIBitsToDevice: colour usage, scan count, start scan, ySrc, xSrc, height, width, yDest, xDest, DIB
    const ySrc = s16(a + 6), xSrc = s16(a + 8), hh = s16(a + 10), ww = s16(a + 12), yD = s16(a + 14), xD = s16(a + 16);
    const img = dibDataUri(d.subarray(a + 18, end));
    if (img) dc.image(img.href, img.w, img.h, { x: xSrc, y: ySrc, w: ww, h: hh }, xD, yD, ww, hh);
    return;
  }
  if (fn === 0x0b41 || fn === 0x0f43 || fn === 0x0b23) { srcH = s16(o); srcW = s16(o + 2); o += 4; }
  const ySrc = s16(o), xSrc = s16(o + 2); o += 4;
  if (noBitmap) o += 2;
  const dh = s16(o), dw = s16(o + 2), yD = s16(o + 4), xD = s16(o + 6); o += 8;
  if (fn === 0x0940 || fn === 0x0922) { srcW = dw; srcH = dh; }
  const k = ropKind(rop);
  if (k.kind === 'skip') return;
  if (noBitmap || k.kind !== 'copy') {
    dc.fillRect(xD, yD, dw, dh, k.kind === 'black' ? '#000000' : k.kind === 'white' ? '#ffffff' : undefined);
    return;
  }
  const img = fn === 0x0922 || fn === 0x0b23 ? bitmap16Uri(d, o, end, 10) : dibDataUri(d.subarray(o, end));
  if (!img) return;
  // Source offsets count from the bitmap's top row, as LibreOffice's player reads them.
  dc.image(img.href, img.w, img.h, { x: xSrc, y: ySrc, w: srcW || img.w, h: srcH || img.h }, xD, yD, dw, dh, { blend: k.blend });
}

