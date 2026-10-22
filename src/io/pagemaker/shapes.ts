/**
 * Shape records of a PageMaker page: lines, rectangles, ellipses, polygons, text blocks, placed
 * pictures and group markers. Positions are in shape units (1/1440 inch) around the page center
 * (single-sided) or the spine (double-sided); rotation and skew come from a separate transform
 * record. The layout below was checked against files saved by PageMaker 6.0, 6.5 and 7 on Windows
 * and Mac: color indexes and tints are 16-bit fields in the file's byte order, the stroke width is a
 * 24.8 fixed-point number of fifths of a point, and a line record carries its two end points after
 * the bounding box.
 */
import { REC, recordAt, readPoint, withSeq, bytesOf, IDENTITY, type PmFile, type PmRecord, type PmXform, type Pt } from './records';
import { readTextBlock, type PmText } from './text';
import type { Reader } from '../qxp/blocks';

export interface PmStroke { type: number; width: number; color: number; tint: number }
export interface PmFill { type: number; color: number; tint: number }

export interface PmShape {
  kind: 'line' | 'rect' | 'ellipse' | 'polygon' | 'text' | 'picture' | 'group';
  tl: Pt; br: Pt;
  xform: PmXform;
  stroke?: PmStroke;
  fill?: PmFill;
  /** Line end points (lines only). */
  from?: Pt; to?: Pt;
  points?: Pt[];
  closed?: boolean;
  text?: PmText;
  picture?: Uint8Array;
  pictureKind?: 'bitmap' | 'metafile';
  /** Members of a group, in drawing order. */
  children?: PmShape[];
  /** PageMaker's "Non-Printing" attribute (shown on screen, left out of print). */
  nonPrinting?: boolean;
}

/**
 * Bytes 2–3 of every shape record are a flag word in the file's byte order. Bit 0x0004 marks the
 * object non-printing: in the corpus it is set exactly on a template's instruction block (its text
 * and frame) and on fold lines that run past the page edges, the objects a template designer keeps
 * out of print. Bit 0x0040 is set on group members.
 */
const NON_PRINTING = 0x0004;

export interface PmPage { shapes: PmShape[] }

/** Group marker records open (2) and close (1) a run of member shapes. */
type Marker = { marker: 'open' | 'close'; tl: Pt; br: Pt };

/** The pages with their shapes; a shape that cannot be read is skipped with a warning. */
export function readPages(file: PmFile, xforms: Map<number, PmXform>, warnings: string[]): PmPage[] {
  const rec = (file.byType.get(REC.PAGE) || [])[0];
  if (!rec) throw new Error('no page records');
  const pages: PmPage[] = [];
  for (let i = 0; i < rec.count; i++) {
    const r = recordAt(file, rec, i);
    r.skip(2);
    const shapesSeq = r.u16();
    const page: PmPage = { shapes: [] };
    // Open groups collect the shapes that follow until their closing marker.
    const stack: PmShape[] = [];
    const sink = () => (stack.length ? stack[stack.length - 1].children! : page.shapes);
    for (const c of withSeq(file, shapesSeq)) {
      if (c.type !== REC.SHAPE) continue;
      for (let k = 0; k < c.count; k++) {
        try {
          const s = readShape(file, c, k, xforms);
          if (!s) continue;
          if ('marker' in s) {
            if (s.marker === 'open') stack.push({ kind: 'group', tl: s.tl, br: s.br, xform: IDENTITY, children: [] });
            else if (stack.length) { const g = stack.pop()!; if (g.children!.length) sink().push(g); }
            continue;
          }
          sink().push(s);
        } catch (e) {
          warnings.push(`An object on page ${i + 1} could not be read (${(e as Error).message}).`);
        }
      }
    }
    // A group left open by a damaged file keeps its members as plain shapes.
    while (stack.length) { const g = stack.pop()!; sink().push(...g.children!); }
    pages.push(page);
  }
  return pages;
}

function xformOf(xforms: Map<number, PmXform>, id: number): PmXform {
  if (id !== 0 && id !== 0xffffffff) { const x = xforms.get(id); if (x) return x; }
  return IDENTITY;
}

/** Stroke width in fifths of a point: a 24.8 fixed-point number at offset 34. */
function strokeWidth(r: { u32: () => number }): number { return r.u32() / 256; }

function readShape(file: PmFile, c: PmRecord, k: number, xforms: Map<number, PmXform>): PmShape | Marker | null {
  const r = recordAt(file, c, k);
  const base = r.pos;
  const at = (o: number) => { r.seek(base + o); return r; };
  const type = r.u8();
  const nonPrinting = !!(at(2).u16() & NON_PRINTING);
  const s = readShapeBody(file, type, at, r, xforms);
  if (s && !('marker' in s) && nonPrinting) s.nonPrinting = true;
  return s;
}

function readShapeBody(file: PmFile, type: number, at: (o: number) => Reader, r: Reader, xforms: Map<number, PmXform>): PmShape | Marker | null {
  switch (type) {
    case 0x03: { // line
      const color = at(4).u16();
      const tl = readPoint(at(6)), br = readPoint(r);
      const strokeType = at(32).u8();
      const width = strokeWidth(at(34));
      const m = at(38).u16();
      const mirrored = m !== 257 && m !== 0;
      let from = readPoint(at(40)), to = readPoint(r);
      const inBox = (p: Pt) => p.x >= Math.min(tl.x, br.x) - 2 && p.x <= Math.max(tl.x, br.x) + 2 && p.y >= Math.min(tl.y, br.y) - 2 && p.y <= Math.max(tl.y, br.y) + 2;
      if (!inBox(from) || !inBox(to)) {
        // No end points stored: the line runs across its box, bottom-left to top-right when mirrored.
        from = { x: Math.min(tl.x, br.x), y: mirrored ? Math.max(tl.y, br.y) : Math.min(tl.y, br.y) };
        to = { x: Math.max(tl.x, br.x), y: mirrored ? Math.min(tl.y, br.y) : Math.max(tl.y, br.y) };
      }
      return { kind: 'line', tl, br, from, to, xform: IDENTITY, stroke: { type: strokeType, width, color, tint: 100 } };
    }
    case 0x04: case 0x05: case 0x0c: { // rectangle, ellipse, polygon
      const fillColor = at(4).u16();
      const tl = readPoint(at(6)), br = readPoint(r);
      const xformId = at(28).u32();
      const strokeType = at(32).u8();
      const width = strokeWidth(at(34));
      const fillType = at(38).u8();
      const strokeColor = at(40).u16();
      const strokeTint = at(44).u16();
      const fillTint = at(file.v60 ? 123 : 224).u8();
      const s: PmShape = { kind: type === 0x04 ? 'rect' : type === 0x05 ? 'ellipse' : 'polygon', tl, br, xform: xformOf(xforms, xformId), stroke: { type: strokeType, width, color: strokeColor, tint: strokeTint || 100 }, fill: { type: fillType, color: fillColor, tint: fillTint || 100 } };
      if (type === 0x0c) {
        const lineSetSeq = at(46).u16();
        const closedMarker = at(56).u8();
        s.closed = closedMarker !== 0x01;
        s.points = [];
        for (const ls of withSeq(file, lineSetSeq)) {
          if (ls.type !== REC.LINE_SET) continue;
          for (let i = 0; i < ls.count; i++) s.points.push(readPoint(recordAt(file, ls, i)));
        }
      }
      return s;
    }
    case 0x01: { // text block
      const tl = readPoint(at(6)), br = readPoint(r);
      const xformId = at(28).u32();
      const textBlockId = at(32).u32();
      const text = readTextBlock(file, textBlockId);
      return { kind: 'text', tl, br, xform: xformOf(xforms, xformId), text };
    }
    case 0x06: case 0x0a: { // bitmap, metafile
      const tl = readPoint(at(6)), br = readPoint(r);
      const xformId = at(28).u32();
      const seq = at(48).u16();
      const parts: Uint8Array[] = [];
      for (const rec of withSeq(file, seq)) parts.push(bytesOf(file, rec));
      for (const rec of withSeq(file, seq + 1)) parts.push(bytesOf(file, rec));
      const total = parts.reduce((a, p) => a + p.length, 0);
      const picture = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { picture.set(p, o); o += p.length; }
      return { kind: 'picture', tl, br, xform: xformOf(xforms, xformId), picture, pictureKind: type === 0x06 ? 'bitmap' : 'metafile' };
    }
    case 0x0e: { // group marker: 2 opens a group, 1 closes it
      const tl = readPoint(at(6)), br = readPoint(r);
      const code = at(40).u16();
      if (code === 2) return { marker: 'open', tl, br };
      if (code === 1) return { marker: 'close', tl, br };
      return null;
    }
    default:
      return null;
  }
}
