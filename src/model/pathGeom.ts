/**
 * Path geometry shared by the renderer, the PDF writer and text on a path: parsing SVG path data
 * (M, L, H, V, C, S, Q, T, A, Z and their relative forms) into absolute move/line/cubic segments,
 * converting elliptical arcs to cubic Béziers, flattening paths to polylines, and walking a polyline by
 * arc length. Coordinates are whatever the path uses (points for item geometry).
 */

export type PathSeg =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'line'; x: number; y: number }
  | { kind: 'cubic'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { kind: 'close' };

export interface Pt { x: number; y: number }

/** Cubic Bézier control points equivalent to an SVG elliptical arc from (x1, y1) to (x2, y2). */
export function arcToCubics(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): [number, number, number, number, number, number][] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  let Rx = Math.abs(rx), Ry = Math.abs(ry);
  const lam = (x1p * x1p) / (Rx * Rx) + (y1p * y1p) / (Ry * Ry);
  if (lam > 1) { Rx *= Math.sqrt(lam); Ry *= Math.sqrt(lam); }
  const sign = large === sweep ? -1 : 1;
  const num = Math.max(0, Rx * Rx * Ry * Ry - Rx * Rx * y1p * y1p - Ry * Ry * x1p * x1p);
  const den = Rx * Rx * y1p * y1p + Ry * Ry * x1p * x1p;
  const co = sign * Math.sqrt(den ? num / den : 0);
  const cxp = (co * Rx * y1p) / Ry, cyp = (-co * Ry * x1p) / Rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const d = ux * vx + uy * vy, l = Math.hypot(ux, uy) * Math.hypot(vx, vy); let a = Math.acos(Math.max(-1, Math.min(1, d / l))); if (ux * vy - uy * vx < 0) a = -a; return a; };
  const t1 = ang(1, 0, (x1p - cxp) / Rx, (y1p - cyp) / Ry);
  let dt = ang((x1p - cxp) / Rx, (y1p - cyp) / Ry, (-x1p - cxp) / Rx, (-y1p - cyp) / Ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out: [number, number, number, number, number, number][] = [];
  const delta = dt / segs;
  let t = t1;
  for (let s = 0; s < segs; s++) {
    const t2 = t + delta;
    const k = (4 / 3) * Math.tan((t2 - t) / 4);
    const p = (a: number) => [cx + Rx * Math.cos(a) * cos - Ry * Math.sin(a) * sin, cy + Rx * Math.cos(a) * sin + Ry * Math.sin(a) * cos];
    const dp = (a: number) => [-Rx * Math.sin(a) * cos - Ry * Math.cos(a) * sin, -Rx * Math.sin(a) * sin + Ry * Math.cos(a) * cos];
    const [p1x, p1y] = p(t), [p2x, p2y] = p(t2), [d1x, d1y] = dp(t), [d2x, d2y] = dp(t2);
    out.push([p1x + k * d1x, p1y + k * d1y, p2x - k * d2x, p2y - k * d2y, p2x, p2y]);
    t = t2;
  }
  return out;
}

/** Parses SVG path data into absolute segments (arcs become cubics, quadratics become cubics). */
export function parsePath(d: string): PathSeg[] {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out: PathSeg[] = [];
  let i = 0;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const last: { c: Pt | null; q: Pt | null } = { c: null, q: null };
  const next = () => parseFloat(tok[i++]);
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => { out.push({ kind: 'cubic', x1, y1, x2, y2, x, y }); last.c = { x: x2, y: y2 }; last.q = null; cx = x; cy = y; };
  const lineTo = (x: number, y: number) => { out.push({ kind: 'line', x, y }); cx = x; cy = y; last.c = last.q = null; };
  while (i < tok.length) {
    const t = tok[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t; i++;
      if (cmd === 'Z' || cmd === 'z') { out.push({ kind: 'close' }); cx = sx; cy = sy; last.c = last.q = null; }
      continue;
    }
    if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': { const x = ox + next(), y = oy + next(); out.push({ kind: 'move', x, y }); cx = sx = x; cy = sy = y; last.c = last.q = null; cmd = rel ? 'l' : 'L'; break; }
      case 'L': lineTo(ox + next(), oy + next()); break;
      case 'H': lineTo(ox + next(), cy); break;
      case 'V': lineTo(cx, oy + next()); break;
      case 'C': { const x1 = ox + next(), y1 = oy + next(), x2 = ox + next(), y2 = oy + next(), x = ox + next(), y = oy + next(); cubic(x1, y1, x2, y2, x, y); break; }
      case 'S': { const x2 = ox + next(), y2 = oy + next(), x = ox + next(), y = oy + next(); const x1 = last.c ? 2 * cx - last.c.x : cx, y1 = last.c ? 2 * cy - last.c.y : cy; cubic(x1, y1, x2, y2, x, y); break; }
      case 'Q': { const qx = ox + next(), qy = oy + next(), x = ox + next(), y = oy + next(); quad(qx, qy, x, y); break; }
      case 'T': { const x = ox + next(), y = oy + next(); const qx = last.q ? 2 * cx - last.q.x : cx, qy = last.q ? 2 * cy - last.q.y : cy; quad(qx, qy, x, y); break; }
      case 'A': {
        const rx = next(), ry = next(), rot = next(), large = next(), sweep = next();
        const x = ox + next(), y = oy + next();
        for (const c of arcToCubics(cx, cy, rx, ry, rot, !!large, !!sweep, x, y)) out.push({ kind: 'cubic', x1: c[0], y1: c[1], x2: c[2], y2: c[3], x: c[4], y: c[5] });
        cx = x; cy = y; last.c = last.q = null;
        break;
      }
      default: i++;
    }
  }
  return out;
  function quad(qx: number, qy: number, x: number, y: number) {
    const x1 = cx + (2 / 3) * (qx - cx), y1 = cy + (2 / 3) * (qy - cy), x2 = x + (2 / 3) * (qx - x), y2 = y + (2 / 3) * (qy - y);
    out.push({ kind: 'cubic', x1, y1, x2, y2, x, y }); cx = x; cy = y; last.q = { x: qx, y: qy }; last.c = null;
  }
}

/** Flattens a path into polylines (one per subpath), with cubics split into `steps` chords. */
export function flattenPath(d: string, steps = 16): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const end = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (const s of parsePath(d)) {
    if (s.kind === 'move') { end(); cx = sx = s.x; cy = sy = s.y; cur.push({ x: cx, y: cy }); }
    else if (s.kind === 'line') { if (!cur.length) cur.push({ x: cx, y: cy }); cx = s.x; cy = s.y; cur.push({ x: cx, y: cy }); }
    else if (s.kind === 'cubic') {
      if (!cur.length) cur.push({ x: cx, y: cy });
      const x0 = cx, y0 = cy;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t;
        cur.push({ x: u * u * u * x0 + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x, y: u * u * u * y0 + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y });
      }
      cx = s.x; cy = s.y;
    } else { if (cur.length && (cur[0].x !== cx || cur[0].y !== cy)) cur.push({ x: sx, y: sy }); cx = sx; cy = sy; end(); }
  }
  end();
  return out;
}

/** A polyline with cumulative lengths, for walking by arc length. */
export interface Polyline { pts: Pt[]; cum: number[]; length: number }

export function polyline(pts: Pt[]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, length: cum[cum.length - 1] || 0 };
}

/** Point and tangent angle (radians, y down) at distance s along the polyline (clamped to its ends). */
export function pointAt(pl: Polyline, s: number): { x: number; y: number; angle: number } {
  const { pts, cum } = pl;
  if (pts.length < 2) return { x: pts[0]?.x || 0, y: pts[0]?.y || 0, angle: 0 };
  const d = Math.max(0, Math.min(pl.length, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1], b = pts[i];
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / segLen));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Reverses a polyline (text on the other side runs the other way). */
export function reversed(pts: Pt[]): Pt[] { return [...pts].reverse(); }
