/**
 * The Office Art drawing layer of Publisher 2002 and later ("Escher/EscherStm" and the pictures in
 * "Escher/EscherDelayStm"), read from the public [MS-ODRAW] record layout: a drawing group
 * container with the picture store, then one drawing container per page holding a tree of shape
 * groups and shapes. Each shape carries its property table (FOPT), its anchor (page coordinates in
 * EMU relative to the page center, or group-relative child coordinates) and client data naming the
 * Contents chunk it belongs to.
 */
import { Reader, fixed16 } from './cfbStreams';

export interface EscherRecord { ver: number; inst: number; type: number; start: number; end: number }

export interface EscherShape {
  /** Sequence number of the Contents shape chunk. */
  seq: number;
  /** Office Art shape type number (1 rectangle, 3 ellipse, 20 line, 202 text box…). */
  type: number;
  flipH: boolean;
  flipV: boolean;
  /** Bounds in EMU relative to the page center (groups: the group's bounds). */
  box?: { xs: number; ys: number; xe: number; ye: number };
  props: Map<number, number>;
  complex: Map<number, Uint8Array>;
  tertiary: Map<number, number>;
  children?: EscherShape[];
}

export interface EscherInfo {
  /** Top-level shapes in drawing order (groups hold their children). */
  shapes: EscherShape[];
  /** Picture-store index (1-based) → delay stream picture number (1-based), -1 when the slot is empty. */
  delayIndex: number[];
}

export function readRecord(r: Reader): EscherRecord {
  const initial = r.u16(), type = r.u16(), len = r.u32();
  return { ver: initial & 0xf, inst: initial >> 4, type, start: r.pos, end: Math.min(r.length, r.pos + len) };
}

const TAIL = (type: number) => (type === 0xf000 || type === 0xf002 ? 4 : 0);

/** Records directly inside `parent`. */
function* records(r: Reader, parent: { start: number; end: number }): Generator<EscherRecord> {
  r.seek(parent.start);
  while (r.pos + 8 <= parent.end) {
    const rec = readRecord(r);
    yield rec;
    r.seek(rec.end + TAIL(rec.type));
  }
}

function readValues(r: Reader, rec: EscherRecord, extraHeader: number): Map<number, number> {
  const m = new Map<number, number>();
  r.seek(rec.start + extraHeader);
  while (r.pos + 6 <= rec.end) { const id = r.u16(); const v = r.u32(); m.set(id, v); }
  return m;
}

function readFopt(r: Reader, rec: EscherRecord): { props: Map<number, number>; complex: Map<number, Uint8Array> } {
  const props = new Map<number, number>();
  const complex = new Map<number, Uint8Array>();
  r.seek(rec.start);
  const complexIds: number[] = [];
  for (let i = 0; i < rec.inst && r.pos + 6 <= rec.end; i++) {
    const id = r.u16(), v = r.u32();
    props.set(id, v);
    if (id & 0x8000) complexIds.push(id);
  }
  for (const id of complexIds) {
    const len = props.get(id) || 0;
    if (!len || r.pos >= rec.end) continue;
    const n = r.u16At(r.pos);
    let entry = r.u16At(r.pos + 4);
    if (entry === 0xfff0) entry = 4;
    // Arrays carry a 6-byte header (count, allocated, element size); the property value is the byte
    // length of the data in current files. Strings (WordArt text and font names) have no header, so
    // the slice always covers at least the declared length.
    const total = Math.min(Math.max(6 + entry * n, len), rec.end - r.pos);
    complex.set(id, r.b.slice(r.pos, r.pos + total));
    r.seek(r.pos + total);
  }
  return { props, complex };
}

interface Coord { xs: number; ys: number; xe: number; ye: number }

function parseSp(r: Reader, sp: EscherRecord, parentCoords: Coord, groupAbs: Coord, delay: number[]): { shape: EscherShape | null; coords: Coord; groupAbs: Coord } {
  let coords = parentCoords, abs = groupAbs, definesCoords = false;
  let type = 1, flags = 0, seq: number | undefined;
  let anchor: EscherRecord | undefined;
  let fopt: { props: Map<number, number>; complex: Map<number, Uint8Array> } = { props: new Map(), complex: new Map() };
  let tertiary = new Map<number, number>();
  for (const rec of records(r, sp)) {
    switch (rec.type) {
      case 0xf009: { r.seek(rec.start); const xs = r.i32(), ys = r.i32(), xe = r.i32(), ye = r.i32(); coords = { xs: Math.min(xs, xe), ys: Math.min(ys, ye), xe: Math.max(xs, xe), ye: Math.max(ys, ye) }; definesCoords = true; break; }
      case 0xf00a: type = rec.inst; flags = r.u32At(rec.start + 4); break;
      case 0xf011: { const v = readValues(r, rec, 4); const s = v.get(0x6801); if (s != null) seq = s; break; }
      case 0xf010: case 0xf00f: if (!anchor) anchor = rec; break;
      case 0xf00b: fopt = readFopt(r, rec); break;
      case 0xf122: tertiary = readFopt(r, rec).props; break;
    }
  }
  if (seq == null) return { shape: null, coords, groupAbs: abs };
  const isGroup = !!(flags & 1);
  const shape: EscherShape = { seq, type, flipH: !!(flags & (1 << 6)), flipV: !!(flags & (1 << 7)), props: fopt.props, complex: fopt.complex, tertiary };
  if (isGroup) shape.children = [];
  if (anchor) {
    let box: Coord;
    if (anchor.type === 0xf010) {
      const v = readValues(r, anchor, 4);
      box = { xs: (v.get(0x2001) ?? 0) | 0, ys: (v.get(0x2002) ?? 0) | 0, xe: (v.get(0x2003) ?? 0) | 0, ye: (v.get(0x2004) ?? 0) | 0 };
    } else {
      r.seek(anchor.start);
      const cw = parentCoords.xe - parentCoords.xs || 1, ch = parentCoords.ye - parentCoords.ys || 1;
      const sx = (groupAbs.xe - groupAbs.xs) / cw, sy = (groupAbs.ye - groupAbs.ys) / ch;
      const cx = r.i32(), cy = r.i32(), cxe = r.i32(), cye = r.i32();
      box = { xs: Math.round((cx - parentCoords.xs) * sx + groupAbs.xs), ys: Math.round((cy - parentCoords.ys) * sy + groupAbs.ys), xe: Math.round((cxe - parentCoords.xs) * sx + groupAbs.xs), ye: Math.round((cye - parentCoords.ys) * sy + groupAbs.ys) };
    }
    const rotRaw = fopt.props.get(0x0004);
    if (rotRaw != null) {
      const rot = ((fixed16(rotRaw) % 360) + 360) % 360;
      if ((rot >= 45 && rot < 135) || (rot >= 225 && rot < 315)) {
        const w = box.xe - box.xs, h = box.ye - box.ys, cx = box.xs + w / 2, cy = box.ys + h / 2;
        box = { xs: Math.round(cx - h / 2), ys: Math.round(cy - w / 2), xe: Math.round(cx - h / 2 + h), ye: Math.round(cy - w / 2 + w) };
      }
    }
    shape.box = box;
    if (definesCoords) abs = box;
  }
  void delay;
  return { shape, coords, groupAbs: abs };
}

function parseSpgr(r: Reader, spgr: EscherRecord, coords: Coord, groupAbs: Coord, delay: number[], depth: number): { leader: EscherShape | null; items: EscherShape[] } {
  const items: EscherShape[] = [];
  let leader: EscherShape | null = null;
  if (depth > 64) return { leader, items };
  let c = coords, g = groupAbs;
  for (const rec of records(r, spgr)) {
    if (rec.type === 0xf003) {
      const sub = parseSpgr(r, rec, c, g, delay, depth + 1);
      if (sub.leader) { sub.leader.children = sub.items; items.push(sub.leader); }
      else items.push(...sub.items);
    } else if (rec.type === 0xf004) {
      const res = parseSp(r, rec, c, g, delay);
      c = res.coords; g = res.groupAbs;
      if (!res.shape) continue;
      // The first shape of a group container describes the group itself; the rest are its members.
      if (res.shape.children && !leader) leader = res.shape;
      else { delete res.shape.children; items.push(res.shape); }
    }
  }
  return { leader, items };
}

export function parseEscher(escher: Uint8Array): EscherInfo {
  const r = new Reader(escher);
  const info: EscherInfo = { shapes: [], delayIndex: [] };
  const root = { start: 0, end: r.length };
  for (const rec of records(r, root)) {
    if (rec.type === 0xf000) {
      // Picture store: 44-byte entries; an entry whose identifier bytes are all zero has no picture.
      for (const sub of records(r, rec)) {
        if (sub.type !== 0xf001) continue;
        let next = 1;
        for (let p = sub.start; p + 44 <= sub.end; p += 44) {
          const empty = r.u32At(p + 10) === 0 && r.u32At(p + 14) === 0 && r.u32At(p + 18) === 0 && r.u32At(p + 22) === 0;
          info.delayIndex.push(empty ? -1 : next++);
        }
      }
    } else if (rec.type === 0xf002) {
      for (const sub of records(r, rec)) if (sub.type === 0xf003) info.shapes.push(...parseSpgr(r, sub, { xs: 0, ys: 0, xe: 0, ye: 0 }, { xs: 0, ys: 0, xe: 0, ye: 0 }, info.delayIndex, 0).items);
    }
  }
  return info;
}

// ------------------------------------------------------------------------------------------
// Pictures

export interface DelayPicture {
  mime: string;
  data: Uint8Array;
  kind: 'png' | 'jpeg' | 'dib' | 'tiff' | 'wmf' | 'emf' | 'pict' | 'unknown';
  /**
   * Metafile BLIPs: whether `data` is deflated (the zlib header already skipped), the picture's
   * logical bounds and its size in points, from the BLIP's metafile header.
   */
  meta?: { compressed: boolean; bounds: { left: number; top: number; right: number; bottom: number }; sizePt: { w: number; h: number } };
}

const BLIP: Record<number, { kind: DelayPicture['kind']; mime: string; offset: number; oneUid: number[] }> = {
  0xf01e: { kind: 'png', mime: 'image/png', offset: 0x11, oneUid: [0x6e0] },
  0xf01d: { kind: 'jpeg', mime: 'image/jpeg', offset: 0x11, oneUid: [0x46a, 0x6e2] },
  0xf02a: { kind: 'jpeg', mime: 'image/jpeg', offset: 33, oneUid: [0x46b, 0x6e3] },
  0xf01f: { kind: 'dib', mime: 'image/bmp', offset: 0x11, oneUid: [0x7a8] },
  0xf029: { kind: 'tiff', mime: 'image/tiff', offset: 0x11, oneUid: [0x6e4] },
  0xf01b: { kind: 'wmf', mime: 'image/wmf', offset: 0x34, oneUid: [0x216] },
  0xf01a: { kind: 'emf', mime: 'image/emf', offset: 0x34, oneUid: [0x3d4] },
  0xf01c: { kind: 'pict', mime: 'image/x-pict', offset: 0x34, oneUid: [0x542] },
};

/** Wraps a device-independent bitmap (BITMAPINFOHEADER + pixels) in a BMP file header. */
export function dibToBmp(d: Uint8Array): Uint8Array {
  const u32 = (o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const hdr = u32(0) || 40, bits = d[14] | (d[15] << 8), used = u32(32);
  const palette = bits <= 8 ? (used || 1 << bits) * 4 : u32(16) === 3 && hdr === 40 ? 12 : 0;
  const offset = 14 + hdr + palette;
  const out = new Uint8Array(14 + d.length);
  out[0] = 0x42; out[1] = 0x4d;
  const put = (o: number, v: number) => { out[o] = v & 255; out[o + 1] = (v >>> 8) & 255; out[o + 2] = (v >>> 16) & 255; out[o + 3] = (v >>> 24) & 255; };
  put(2, out.length); put(10, offset);
  out.set(d, 14);
  return out;
}

/** The pictures of the delay stream in order (1-based numbering matches the picture store). Metafiles stay compressed. */
export function parseDelayStream(delay: Uint8Array): DelayPicture[] {
  const r = new Reader(delay);
  const out: DelayPicture[] = [];
  while (r.pos + 8 <= r.length) {
    const rec = readRecord(r);
    const def = BLIP[rec.type];
    if (!def) { out.push({ kind: 'unknown', mime: 'application/octet-stream', data: new Uint8Array(0) }); r.seek(rec.end); continue; }
    const start = rec.start + def.offset + (def.oneUid.includes(rec.inst) ? 0 : 0x10);
    if (def.kind === 'wmf' || def.kind === 'emf' || def.kind === 'pict') {
      // UIDs, then the metafile header: uncompressed size, bounds (4 × int32), size in EMU (2 × int32),
      // saved size, compression (0 deflate, 0xFE none) and filter; the zlib stream's 2-byte header is
      // skipped so `data` is raw deflate when compressed.
      const h = start - 0x34 + 0x10;
      const dv = new DataView(delay.buffer, delay.byteOffset, delay.byteLength);
      const ok = h + 34 <= rec.end;
      const i = (o: number) => (ok ? dv.getInt32(h + o, true) : 0);
      const compressed = ok ? delay[h + 32] === 0 : true;
      const saved = ok ? dv.getUint32(h + 28, true) : 0;
      const from = compressed ? start : start - 2;
      const to = saved ? Math.min(rec.end, h + 34 + saved) : rec.end;
      out.push({
        kind: def.kind, mime: def.mime, data: delay.slice(Math.min(from, rec.end), to),
        meta: ok ? { compressed, bounds: { left: i(4), top: i(8), right: i(12), bottom: i(16) }, sizePt: { w: i(20) / 12700, h: i(24) / 12700 } } : undefined,
      });
      r.seek(rec.end);
      continue;
    }
    let data: Uint8Array = delay.slice(Math.min(start, rec.end), rec.end);
    if (def.kind === 'dib' && data.length >= 0x2e + 4) data = dibToBmp(data);
    out.push({ kind: def.kind, mime: def.mime, data });
    r.seek(rec.end);
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Custom geometry

/** Vertices of a pVertices property (x, y pairs in the shape's geometry space). */
export function parseVertices(d: Uint8Array): { x: number; y: number; calc: boolean }[] {
  if (d.length < 6) return [];
  const n = d[0] | (d[1] << 8);
  let size = d[4] | (d[5] << 8);
  if (size === 0xfff0) size = 4;
  if (size !== 2 && size !== 4 && size !== 8) return [];
  const out: { x: number; y: number; calc: boolean }[] = [];
  for (let i = 0, o = 6; i < n && o + size <= d.length; i++, o += size) {
    let x: number, y: number;
    if (size === 2) { x = d[o]; y = d[o + 1]; }
    else if (size === 4) { x = (d[o] | (d[o + 1] << 8)) << 16 >> 16; y = (d[o + 2] | (d[o + 3] << 8)) << 16 >> 16; }
    else { x = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24); y = d[o + 4] | (d[o + 5] << 8) | (d[o + 6] << 16) | (d[o + 7] << 24); }
    const calc = size === 8 && (!!(x & 0x80000000) || !!(y & 0x80000000));
    out.push({ x: calc ? 0 : x, y: calc ? 0 : y, calc });
  }
  return out;
}

export function parseSegments(d: Uint8Array): number[] {
  if (d.length < 6) return [];
  const n = d[0] | (d[1] << 8);
  const out: number[] = [];
  for (let i = 0, o = 6; i < n && o + 2 <= d.length; i++, o += 2) out.push(d[o] | (d[o + 1] << 8));
  return out;
}

const K = 0.5523;

/**
 * Builds an SVG path from Office Art vertices and segment commands. Arcs and elliptical quadrants
 * are approximated with cubic curves; a shape with no segments is a closed polygon.
 */
export function customPath(verts: { x: number; y: number }[], segs: number[]): { d: string; calcVertices: boolean } {
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  let d = '';
  let vi = 0;
  let cx = 0, cy = 0;
  let open = false;
  const V = () => verts[vi++] || { x: cx, y: cy };
  if (!segs.length) {
    if (!verts.length) return { d: '', calcVertices: false };
    d = `M ${f(verts[0].x)} ${f(verts[0].y)}` + verts.slice(1).map((v) => ` L ${f(v.x)} ${f(v.y)}`).join('') + ' Z';
    return { d, calcVertices: false };
  }
  for (const s of segs) {
    const op = s >> 8, n = s & 0xff;
    if (vi >= verts.length && op !== 0x60 && op !== 0x80) break;
    switch (op) {
      case 0x40: { for (let i = 0; i < Math.max(1, n); i++) { const v = V(); cx = v.x; cy = v.y; d += ` M ${f(cx)} ${f(cy)}`; open = true; } break; }
      case 0x00: case 0xac: case 0xae: { for (let i = 0; i < n; i++) { const v = V(); cx = v.x; cy = v.y; d += ` L ${f(cx)} ${f(cy)}`; } break; }
      case 0x20: case 0xad: case 0xaf: case 0xb3: { for (let i = 0; i < n; i++) { const a = V(), b = V(), c = V(); cx = c.x; cy = c.y; d += ` C ${f(a.x)} ${f(a.y)} ${f(b.x)} ${f(b.y)} ${f(c.x)} ${f(c.y)}`; } break; }
      case 0xa7: case 0xa8: {
        // Quarter ellipse to the next vertex, starting along x (a7) or y (a8).
        for (let i = 0; i < n; i++) {
          const v = V();
          const alongX = op === 0xa7 ? i % 2 === 0 : i % 2 === 1;
          const c1 = alongX ? { x: cx + K * (v.x - cx), y: cy } : { x: cx, y: cy + K * (v.y - cy) };
          const c2 = alongX ? { x: v.x, y: v.y - K * (v.y - cy) } : { x: v.x - K * (v.x - cx), y: v.y };
          d += ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(v.x)} ${f(v.y)}`;
          cx = v.x; cy = v.y;
        }
        break;
      }
      case 0xa2: {
        // Angle ellipse: center, radii, angles (degrees in 16.16 when wide). Drawn as a full ellipse.
        for (let i = 0; i < Math.floor(n / 3); i++) {
          const c = V(), rr = V(); V();
          const rx = rr.x / 2, ry = rr.y / 2;
          d += ` M ${f(c.x - rx)} ${f(c.y)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(c.x + rx)} ${f(c.y)} A ${f(rx)} ${f(ry)} 0 1 0 ${f(c.x - rx)} ${f(c.y)}`;
          cx = c.x - rx; cy = c.y;
        }
        break;
      }
      case 0xa3: case 0xa4: case 0xa5: case 0xa6: {
        // Arc inside a bounding box from a start point to an end point (angles from the box center).
        const clockwise = op === 0xa5 || op === 0xa6;
        const arcTo = op === 0xa3 || op === 0xa5;
        for (let i = 0; i < Math.floor(n / 4); i++) {
          const b0 = V(), b1 = V(), p0 = V(), p1 = V();
          const rx = Math.abs(b1.x - b0.x) / 2, ry = Math.abs(b1.y - b0.y) / 2, mx = (b0.x + b1.x) / 2, my = (b0.y + b1.y) / 2;
          const ang = (p: { x: number; y: number }) => Math.atan2((p.y - my) / (ry || 1), (p.x - mx) / (rx || 1));
          const a0 = ang(p0), a1 = ang(p1);
          const s = { x: mx + rx * Math.cos(a0), y: my + ry * Math.sin(a0) }, e = { x: mx + rx * Math.cos(a1), y: my + ry * Math.sin(a1) };
          let sweep = clockwise ? a1 - a0 : a0 - a1;
          sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const large = sweep > Math.PI ? 1 : 0;
          d += (arcTo && open ? ` L ${f(s.x)} ${f(s.y)}` : ` M ${f(s.x)} ${f(s.y)}`) + ` A ${f(rx)} ${f(ry)} 0 ${large} ${clockwise ? 1 : 0} ${f(e.x)} ${f(e.y)}`;
          cx = e.x; cy = e.y; open = true;
        }
        break;
      }
      case 0x60: if (open) { d += ' Z'; } break;
      case 0x80: open = false; break;
      case 0xaa: case 0xab: break;
      default: { const v = V(); cx = v.x; cy = v.y; d += ` M ${f(cx)} ${f(cy)}`; open = true; }
    }
  }
  return { d: d.trim(), calcVertices: false };
}
