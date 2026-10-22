/**
 * Enhanced Metafile (EMF) player: 32-bit records (type, size, fields) drawn into the SVG drawing
 * context with GDI's page transform onto the reference device the header describes, world
 * transforms, path brackets and clipping. EMF+ (GDI+ records in comments) is not interpreted: the
 * EMF records that dual files carry alongside are drawn instead.
 */
import { SvgDc, type Mat, type Pt } from './dc';
import { brushOf, colorRef, decodeText, penOf, readLogFont, ropKind, type GdiObject, type MetafileHints, type Pen, type Region } from './objects';
import { dibDataUri } from './dib';

const MAX_RECORDS = 2_000_000;

const STOCK: Record<number, GdiObject> = {
  0: { kind: 'brush', brush: { style: 'solid', color: '#ffffff' } },
  1: { kind: 'brush', brush: { style: 'solid', color: '#c0c0c0' } },
  2: { kind: 'brush', brush: { style: 'solid', color: '#808080' } },
  3: { kind: 'brush', brush: { style: 'solid', color: '#404040' } },
  4: { kind: 'brush', brush: { style: 'solid', color: '#000000' } },
  5: { kind: 'brush', brush: { style: 'null', color: '#000000' } },
  6: { kind: 'pen', pen: { style: 0, width: 0, color: '#ffffff', cosmetic: true, cap: 'round', join: 'round' } },
  7: { kind: 'pen', pen: { style: 0, width: 0, color: '#000000', cosmetic: true, cap: 'round', join: 'round' } },
  8: { kind: 'pen', pen: { style: 5, width: 0, color: '#000000', cosmetic: true, cap: 'round', join: 'round' } },
  18: { kind: 'brush', brush: { style: 'solid', color: '#ffffff' } },
  19: { kind: 'pen', pen: { style: 0, width: 0, color: '#000000', cosmetic: true, cap: 'round', join: 'round' } },
};

const mul = (A: Mat, B: Mat): Mat => [
  A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3],
  A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3],
  A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5],
];

export function isEmf(d: Uint8Array): boolean {
  return d.length >= 88 && d[0] === 1 && d[1] === 0 && d[2] === 0 && d[3] === 0 && d[40] === 0x20 && d[41] === 0x45 && d[42] === 0x4d && d[43] === 0x46;
}

export function playEmf(d: Uint8Array, hints: MetafileHints = {}): { svg: string; w: number; h: number } | null {
  if (!isEmf(d)) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const i32 = (o: number) => (o + 4 <= d.length ? dv.getInt32(o, true) : 0);
  const u32 = (o: number) => (o + 4 <= d.length ? dv.getUint32(o, true) : 0);
  const i16 = (o: number) => (o + 2 <= d.length ? dv.getInt16(o, true) : 0);
  const f32 = (o: number) => (o + 4 <= d.length ? dv.getFloat32(o, true) : 0);
  const bounds = [i32(8), i32(12), i32(16), i32(20)];
  const frame = [i32(24), i32(28), i32(32), i32(36)]; // 0.01 mm, inclusive
  const devPx = [i32(72), i32(76)], devMm = [i32(80), i32(84)];
  const headerSize = u32(4);
  let pxPerMm: [number, number] = devMm[0] > 0 && devMm[1] > 0 ? [devPx[0] / devMm[0], devPx[1] / devMm[1]] : [96 / 25.4, 96 / 25.4];
  if (headerSize >= 108) { const um = [i32(100), i32(104)]; if (um[0] > 0 && um[1] > 0) pxPerMm = [devPx[0] / (um[0] / 1000), devPx[1] / (um[1] / 1000)]; }
  const fw = (frame[2] - frame[0]) / 100, fh = (frame[3] - frame[1]) / 100;
  let fr = fw > 0 && fh > 0 ? { x: (frame[0] / 100) * pxPerMm[0], y: (frame[1] / 100) * pxPerMm[1], w: fw * pxPerMm[0], h: fh * pxPerMm[1] } : null;
  if (!fr && bounds[2] > bounds[0] && bounds[3] > bounds[1]) fr = { x: bounds[0], y: bounds[1], w: bounds[2] - bounds[0] + 1, h: bounds[3] - bounds[1] + 1 };
  const sizePt = hints.sizePt ?? (fw > 0 && fh > 0 ? { w: (fw / 25.4) * 72, h: (fh / 25.4) * 72 } : fr ? { w: fr.w * 0.75, h: fr.h * 0.75 } : undefined);
  const dc = new SvgDc({ mode: 'emf', frame: fr ?? undefined, pxPerMm, sizePt });
  const objects = new Map<number, GdiObject>();
  const select = (h: number) => {
    const o = h & 0x80000000 ? STOCK[h & 0x7fffffff] : objects.get(h);
    if (!o) return;
    if (o.kind === 'pen') dc.st.pen = o.pen; else if (o.kind === 'brush') dc.st.brush = o.brush; else if (o.kind === 'font') dc.st.font = o.font;
  };
  const rgn = (o: number, end: number): Region => {
    const n = u32(o + 8); const rects: Region['rects'] = [];
    for (let k = 0, q = o + 32; k < n && q + 16 <= end; k++, q += 16) rects.push([i32(q), i32(q + 4), i32(q + 8), i32(q + 12)]);
    return { rects };
  };
  let p = headerSize > 0 && headerSize < d.length ? headerSize : u32(4);
  let count = 0;
  while (p + 8 <= d.length && count++ < MAX_RECORDS) {
    const type = u32(p), size = u32(p + 4);
    if (size < 8 || size % 4) break;
    const end = Math.min(d.length, p + size);
    const a = p + 8;
    const pts32 = (o: number, n: number): Pt[] => { const out: Pt[] = []; for (let k = 0; k < n && o + 8 <= end; k++, o += 8) out.push([i32(o), i32(o + 4)]); return out; };
    const pts16 = (o: number, n: number): Pt[] => { const out: Pt[] = []; for (let k = 0; k < n && o + 4 <= end; k++, o += 4) out.push([i16(o), i16(o + 2)]); return out; };
    try {
      switch (type) {
        case 14: p = d.length; continue; // EOF
        // --- polygons and lines (bounds first, then the count)
        case 2: case 3: case 4: case 5: case 6: case 85: case 86: case 87: case 88: case 89: {
          const n = u32(a + 16); const pt = type >= 85 ? pts16(a + 20, n) : pts32(a + 20, n);
          const t = type >= 85 ? type - 83 : type;
          if (t === 2) dc.bezier(pt, false); else if (t === 3) dc.polygon(pt); else if (t === 4) dc.polyline(pt); else if (t === 5) dc.bezier(pt, true); else dc.polyline(pt, true);
          break;
        }
        case 7: case 8: case 90: case 91: {
          const n = u32(a + 16); const counts: number[] = []; for (let k = 0; k < n; k++) counts.push(u32(a + 24 + k * 4));
          let o = a + 24 + n * 4; const small = type >= 90; const polys: Pt[][] = [];
          for (const c of counts) { polys.push(small ? pts16(o, c) : pts32(o, c)); o += c * (small ? 4 : 8); }
          if (type === 8 || type === 91) dc.polyPolygon(polys); else dc.polyPolyline(polys);
          break;
        }
        case 56: case 92: {
          const n = u32(a + 16); const small = type === 92; const pt = small ? pts16(a + 20, n) : pts32(a + 20, n);
          const to = a + 20 + n * (small ? 4 : 8); dc.polyDraw(pt, Array.from(d.subarray(to, to + n)));
          break;
        }
        case 27: dc.moveTo(i32(a), i32(a + 4)); break;
        case 54: dc.lineTo(i32(a), i32(a + 4)); break;
        case 42: dc.ellipse(i32(a), i32(a + 4), i32(a + 8), i32(a + 12)); break;
        case 43: dc.rect(i32(a), i32(a + 4), i32(a + 8), i32(a + 12)); break;
        case 44: dc.roundRect(i32(a), i32(a + 4), i32(a + 8), i32(a + 12), i32(a + 16), i32(a + 20)); break;
        case 45: case 46: case 47: case 55:
          dc.arc(type === 45 ? 'arc' : type === 46 ? 'chord' : type === 47 ? 'pie' : 'arcto', i32(a), i32(a + 4), i32(a + 8), i32(a + 12), i32(a + 16), i32(a + 20), i32(a + 24), i32(a + 28)); break;
        case 41: { // AngleArc: centre, radius, start and sweep (degrees, counterclockwise)
          const cx = i32(a), cy = i32(a + 4), r = u32(a + 8), s0 = (f32(a + 12) * Math.PI) / 180, sw = (f32(a + 16) * Math.PI) / 180;
          const p0: Pt = [cx + r * Math.cos(s0), cy - r * Math.sin(s0)], p1: Pt = [cx + r * Math.cos(s0 + sw), cy - r * Math.sin(s0 + sw)];
          const dir = dc.st.arcDir; dc.st.arcDir = sw >= 0 ? 1 : 2;
          dc.lineTo(p0[0], p0[1]); dc.arc('arcto', cx - r, cy - r, cx + r, cy + r, p0[0], p0[1], p1[0], p1[1]); dc.st.arcDir = dir;
          break;
        }
        case 15: dc.fillRect(i32(a), i32(a + 4), 1, 1, colorRef(u32(a + 8))); break;
        // --- state
        case 9: dc.st.wExt = [i32(a), i32(a + 4)]; break;
        case 10: dc.st.wOrg = [i32(a), i32(a + 4)]; break;
        case 11: dc.st.vExt = [i32(a), i32(a + 4)]; break;
        case 12: dc.st.vOrg = [i32(a), i32(a + 4)]; break;
        case 31: { const e = dc.st.vExt; if (e && i32(a + 4) && i32(a + 12)) dc.st.vExt = [(e[0] * i32(a)) / i32(a + 4), (e[1] * i32(a + 8)) / i32(a + 12)]; break; }
        case 32: { const e = dc.st.wExt; if (e && i32(a + 4) && i32(a + 12)) dc.st.wExt = [(e[0] * i32(a)) / i32(a + 4), (e[1] * i32(a + 8)) / i32(a + 12)]; break; }
        case 17: dc.st.mapMode = u32(a); break;
        case 18: dc.st.bkMode = u32(a); break;
        case 19: dc.st.polyFill = u32(a); break;
        case 20: dc.st.rop2 = u32(a); break;
        case 22: dc.st.textAlign = u32(a); break;
        case 24: dc.st.textColor = colorRef(u32(a)); break;
        case 25: dc.st.bkColor = colorRef(u32(a)); break;
        case 57: dc.st.arcDir = u32(a); break;
        case 58: dc.st.miterLimit = u32(a) || f32(a); break;
        case 33: dc.save(); break;
        case 34: dc.restore(i32(a)); break;
        case 35: dc.st.world = [f32(a), f32(a + 4), f32(a + 8), f32(a + 12), f32(a + 16), f32(a + 20)]; break;
        case 36: {
          const x: Mat = [f32(a), f32(a + 4), f32(a + 8), f32(a + 12), f32(a + 16), f32(a + 20)], mode = u32(a + 24);
          if (mode === 1) dc.st.world = [1, 0, 0, 1, 0, 0];
          else if (mode === 2) dc.st.world = mul(x, dc.st.world);
          else if (mode === 3) dc.st.world = mul(dc.st.world, x);
          else if (mode === 4) dc.st.world = x;
          break;
        }
        // --- objects
        case 37: select(u32(a)); break;
        case 40: objects.delete(u32(a)); break;
        case 38: objects.set(u32(a), { kind: 'pen', pen: penOf(u32(a + 4), Math.abs(i32(a + 8)), colorRef(u32(a + 16))) }); break;
        case 95: { // ExtCreatePen: handle, bitmap offsets, then LOGPENEX
          const style = u32(a + 20), width = u32(a + 24), color = colorRef(u32(a + 32)), nDash = u32(a + 40);
          const pen: Pen = penOf(style, width, color);
          if ((style & 0x0f) === 7 && nDash) { pen.dash = []; for (let k = 0; k < Math.min(nDash, 16); k++) pen.dash.push(u32(a + 44 + k * 4)); }
          if (u32(a + 28) === 1) pen.style = 5; // BS_NULL brush: an invisible pen
          objects.set(u32(a), { kind: 'pen', pen });
          break;
        }
        case 39: objects.set(u32(a), { kind: 'brush', brush: brushOf(u32(a + 4), colorRef(u32(a + 8)), u32(a + 12)) }); break;
        case 93: case 94: { // CreateMonoBrush / CreateDIBPatternBrushPt
          const offBmi = u32(a + 8), cbBmi = u32(a + 12), offBits = u32(a + 16), cbBits = u32(a + 20);
          const img = cbBmi ? dibDataUri(d.subarray(p + offBmi, p + offBmi + cbBmi), cbBits ? d.subarray(p + offBits, p + offBits + cbBits) : undefined) : null;
          objects.set(u32(a), { kind: 'brush', brush: img ? { style: 'pattern', color: '#000000', image: { href: img.href, w: img.w, h: img.h } } : { style: 'solid', color: '#808080' } });
          break;
        }
        case 82: objects.set(u32(a), { kind: 'font', font: readLogFont(d, a + 4, end, true) }); break;
        case 49: case 48: case 50: case 51: case 52: break; // palettes
        // --- text
        case 83: case 84: textRecord(dc, d, p, a + 28, end, type === 84, i32, u32, i16); break;
        case 96: case 97: { // PolyTextOut: several EMRTEXT structures
          const n = u32(a + 28);
          for (let k = 0; k < n; k++) textRecord(dc, d, p, a + 32 + k * 40, end, type === 97, i32, u32, i16);
          break;
        }
        case 108: { // SmallTextOut
          const x = i32(a), y = i32(a + 4), n = u32(a + 8), opt = u32(a + 12);
          let o = a + 28; let rect: [number, number, number, number] | undefined;
          if (!(opt & 0x100)) { rect = [i32(o), i32(o + 4), i32(o + 8), i32(o + 12)]; o += 16; }
          let s = '';
          if (opt & 0x200) for (let k = 0; k < n; k++) s += String.fromCharCode(d[o + k]);
          else for (let k = 0; k < n; k++) s += String.fromCharCode(d[o + k * 2] | (d[o + k * 2 + 1] << 8));
          if (!(opt & 0x10)) dc.text(x, y, s, null, opt, rect);
          break;
        }
        // --- clipping
        case 30: dc.intersectClip(i32(a), i32(a + 4), i32(a + 8), i32(a + 12)); break;
        case 29: dc.excludeClip(i32(a), i32(a + 4), i32(a + 8), i32(a + 12)); break;
        case 75: { const cb = u32(a), mode = u32(a + 4); dc.clipRegion(cb ? rgn(a + 8, end) : null, mode, true); break; }
        case 67: dc.clipPath(u32(a)); break;
        case 71: { const b = objects.get(u32(a + 20)); if (b?.kind === 'brush') dc.fillRegion(rgn(a + 24, end), b.brush); break; }
        case 72: { const b = objects.get(u32(a + 20)); if (b?.kind === 'brush') dc.frameRegion(rgn(a + 32, end), b.brush, i32(a + 24), i32(a + 28)); break; }
        case 74: dc.fillRegion(rgn(a + 20, end), dc.st.brush); break;
        // --- paths
        case 59: dc.beginPath(); break;
        case 60: dc.endPath(); break;
        case 61: dc.closeFigure(); break;
        case 62: dc.drawPath(true, false); break;
        case 63: dc.drawPath(true, true); break;
        case 64: dc.drawPath(false, true); break;
        case 68: dc.abortPath(); break;
        case 65: case 66: break; // flatten/widen: the path is kept as is
        // --- bitmaps
        case 76: case 77: case 114: case 116: { // BitBlt, StretchBlt, AlphaBlend, TransparentBlt
          const xD = i32(a + 16), yD = i32(a + 20), cxD = i32(a + 24), cyD = i32(a + 28);
          const fifth = u32(a + 32); // raster operation, blend function or transparent colour
          const xS = i32(a + 36), yS = i32(a + 40);
          const offBmi = u32(a + 72), cbBmi = u32(a + 76), offBits = u32(a + 80), cbBits = u32(a + 84);
          const cxS = type === 76 ? cxD : i32(a + 88), cyS = type === 76 ? cyD : i32(a + 92);
          if (!cbBmi) {
            const k = ropKind(type === 76 || type === 77 ? fifth : 0x00cc0020);
            if (k.kind !== 'skip') dc.fillRect(xD, yD, cxD, cyD, k.kind === 'black' ? '#000000' : k.kind === 'white' ? '#ffffff' : undefined);
            break;
          }
          const opts = type === 114 ? { premultiplied: !!((fifth >>> 24) & 1) } : type === 116 ? { transparent: [fifth & 255, (fifth >>> 8) & 255, (fifth >>> 16) & 255] as [number, number, number] } : {};
          const img = dibDataUri(d.subarray(p + offBmi, p + offBmi + cbBmi), d.subarray(p + offBits, p + offBits + cbBits), opts);
          if (!img) break;
          const k = type === 76 || type === 77 ? ropKind(fifth) : { kind: 'copy' as const, blend: undefined };
          if (k.kind === 'skip') break;
          if (k.kind !== 'copy') { dc.fillRect(xD, yD, cxD, cyD, k.kind === 'black' ? '#000000' : k.kind === 'white' ? '#ffffff' : undefined); break; }
          const opacity = type === 114 ? ((fifth >>> 16) & 255) / 255 : undefined;
          dc.image(img.href, img.w, img.h, { x: xS, y: yS, w: cxS || img.w, h: cyS || img.h }, xD, yD, cxD, cyD, { opacity, blend: k.blend });
          break;
        }
        case 80: case 81: { // SetDIBitsToDevice / StretchDIBits
          const xD = i32(a + 16), yD = i32(a + 20), xS = i32(a + 24), yS = i32(a + 28), cxS = i32(a + 32), cyS = i32(a + 36);
          const offBmi = u32(a + 40), cbBmi = u32(a + 44), offBits = u32(a + 48), cbBits = u32(a + 52);
          const rop = type === 81 ? u32(a + 60) : 0x00cc0020;
          const cxD = type === 81 ? i32(a + 64) : cxS, cyD = type === 81 ? i32(a + 68) : cyS;
          const k = ropKind(rop);
          if (k.kind === 'skip') break;
          if (k.kind !== 'copy' || !cbBmi) { dc.fillRect(xD, yD, cxD, cyD, k.kind === 'black' ? '#000000' : k.kind === 'white' ? '#ffffff' : undefined); break; }
          const img = dibDataUri(d.subarray(p + offBmi, p + offBmi + cbBmi), d.subarray(p + offBits, p + offBits + cbBits));
          if (img) dc.image(img.href, img.w, img.h, { x: xS, y: yS, w: cxS || img.w, h: cyS || img.h }, xD, yD, cxD, cyD, { blend: k.blend });
          break;
        }
        case 118: { // GradientFill: rectangles as linear gradients, triangles as their average colour
          const nV = u32(a + 16), nT = u32(a + 20), mode = u32(a + 24);
          const vs: { x: number; y: number; c: string }[] = [];
          for (let k = 0; k < nV; k++) { const o = a + 28 + k * 16; vs.push({ x: i32(o), y: i32(o + 4), c: rgb16(dv, o + 8) }); }
          let o = a + 28 + nV * 16;
          for (let k = 0; k < nT && o < end; k++) {
            if (mode === 2) {
              const t = [u32(o), u32(o + 4), u32(o + 8)].map((i) => vs[i]).filter(Boolean); o += 12;
              if (t.length === 3) { const save = dc.st.brush, pen = dc.st.pen; dc.st.brush = { style: 'solid', color: t[0].c }; dc.st.pen = { ...pen, style: 5 }; dc.polygon(t.map((v) => [v.x, v.y] as Pt)); dc.st.brush = save; dc.st.pen = pen; }
            } else {
              const v0 = vs[u32(o)], v1 = vs[u32(o + 4)]; o += 8;
              if (v0 && v1) dc.gradientRect(v0.x, v0.y, v1.x, v1.y, v0.c, v1.c, mode === 1);
            }
          }
          break;
        }
        default: break; // comments (EMF+), ICM, layout, colour adjustment: nothing to draw
      }
    } catch { /* a damaged record: skip it */ }
    p += size;
  }
  return dc.finish();
}

function rgb16(dv: DataView, o: number): string {
  const c = (k: number) => (o + k + 2 <= dv.byteLength ? dv.getUint16(o + k, true) >> 8 : 0);
  return `#${((1 << 24) | (c(0) << 16) | (c(2) << 8) | c(4)).toString(16).slice(1)}`;
}

/** EMRTEXT at `t` (offsets in it are relative to the record start `rec`). */
function textRecord(dc: SvgDc, d: Uint8Array, rec: number, t: number, end: number, wide: boolean, i32: (o: number) => number, u32: (o: number) => number, i16: (o: number) => number): void {
  const x = i32(t), y = i32(t + 4), n = Math.min(u32(t + 8), 65535), offStr = u32(t + 12), opt = u32(t + 16);
  const rect: [number, number, number, number] = [i32(t + 20), i32(t + 24), i32(t + 28), i32(t + 32)];
  const offDx = u32(t + 36);
  if (opt & 0x10) return; // glyph indices: no characters to show
  const so = rec + offStr;
  let s = '';
  if (wide) for (let k = 0; k < n && so + k * 2 + 1 < end; k++) s += String.fromCharCode(d[so + k * 2] | (d[so + k * 2 + 1] << 8));
  else s = decodeText(d.subarray(so, Math.min(end, so + n)), dc.st.font.charset);
  let dx: number[] | null = null;
  if (offDx) {
    const step = opt & 0x2000 ? 8 : 4;
    dx = [];
    for (let k = 0; k < n && rec + offDx + k * step + 4 <= end; k++) dx.push(i32(rec + offDx + k * step));
    if (dx.length !== n) dx = null;
  }
  void i16;
  dc.text(x, y, s, dx, opt, opt & 6 ? rect : undefined);
}
