/**
 * Shape records of a PageMaker page: lines, rectangles, ellipses, polygons, text blocks and placed
 * pictures. Positions are in shape units (1/1440 inch) around the page center (single-sided) or the
 * spine (double-sided); rotation and skew come from a separate transform record.
 */
import { REC, recordAt, readPoint, withSeq, bytesOf, IDENTITY, type PmFile, type PmRecord, type PmXform, type Pt } from './records';
import { readTextBlock, type PmText } from './text';

export interface PmStroke { type: number; width: number; color: number; tint: number }
export interface PmFill { type: number; color: number; tint: number }

export interface PmShape {
  kind: 'line' | 'rect' | 'ellipse' | 'polygon' | 'text' | 'picture';
  tl: Pt; br: Pt;
  xform: PmXform;
  stroke?: PmStroke;
  fill?: PmFill;
  /** A line drawn from the bottom-left to the top-right corner. */
  mirrored?: boolean;
  points?: Pt[];
  closed?: boolean;
  text?: PmText;
  picture?: Uint8Array;
  pictureKind?: 'bitmap' | 'metafile';
}

export interface PmPage { shapes: PmShape[] }

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
    for (const c of withSeq(file, shapesSeq)) {
      if (c.type !== REC.SHAPE) continue;
      for (let k = 0; k < c.count; k++) {
        try {
          const s = readShape(file, c, k, xforms);
          if (s) page.shapes.push(s);
        } catch (e) {
          warnings.push(`An object on page ${i + 1} could not be read (${(e as Error).message}).`);
        }
      }
    }
    pages.push(page);
  }
  return pages;
}

function xformOf(xforms: Map<number, PmXform>, id: number): PmXform {
  if (id !== 0 && id !== 0xffffffff) { const x = xforms.get(id); if (x) return x; }
  return IDENTITY;
}

function readShape(file: PmFile, c: PmRecord, k: number, xforms: Map<number, PmXform>): PmShape | null {
  const r = recordAt(file, c, k);
  const type = r.u8();
  switch (type) {
    case 0x03: { // line
      r.skip(3);
      const color = r.u8();
      r.skip(1);
      const tl = readPoint(r), br = readPoint(r);
      r.skip(0x18);
      const m = r.u16();
      const mirrored = m !== 257 && m !== 0;
      r.skip(6);
      const strokeType = r.u8();
      r.skip(1);
      const width = r.u16();
      r.skip(1);
      const tint = r.u8();
      return { kind: 'line', tl, br, xform: IDENTITY, mirrored, stroke: { type: strokeType, width, color, tint } };
    }
    case 0x04: case 0x05: case 0x0c: { // rectangle, ellipse, polygon
      r.skip(1);
      r.skip(1); // fill overprint
      r.skip(1);
      const fillColor = r.u8();
      r.skip(1);
      const tl = readPoint(r), br = readPoint(r);
      r.skip(14);
      const xformId = r.u32();
      const strokeType = r.u8();
      r.skip(2);
      const width = r.u16();
      r.skip(1);
      const fillType = r.u8();
      r.skip(1);
      const strokeColor = r.u8();
      r.skip(1);
      r.skip(1); // stroke overprint
      r.skip(1);
      const strokeTint = r.u8();
      const s: PmShape = { kind: type === 0x04 ? 'rect' : type === 0x05 ? 'ellipse' : 'polygon', tl, br, xform: xformOf(xforms, xformId), stroke: { type: strokeType, width, color: strokeColor, tint: strokeTint }, fill: { type: fillType, color: fillColor, tint: 100 } };
      if (type === 0x0c) {
        r.skip(1);
        const lineSetSeq = r.u16();
        r.skip(8);
        const closedMarker = r.u8();
        r.skip(0xa7);
        s.fill!.tint = r.u8();
        s.closed = closedMarker !== 0x01;
        s.points = [];
        for (const ls of withSeq(file, lineSetSeq)) {
          if (ls.type !== REC.LINE_SET) continue;
          for (let i = 0; i < ls.count; i++) s.points.push(readPoint(recordAt(file, ls, i)));
        }
      } else {
        r.skip(0xb3);
        s.fill!.tint = r.u8();
      }
      return s;
    }
    case 0x01: { // text block
      r.skip(5);
      const tl = readPoint(r), br = readPoint(r);
      r.skip(0xe);
      const xformId = r.u32();
      const textBlockId = r.u32();
      const text = readTextBlock(file, textBlockId);
      return { kind: 'text', tl, br, xform: xformOf(xforms, xformId), text };
    }
    case 0x06: case 0x0a: { // bitmap, metafile
      r.skip(5);
      const tl = readPoint(r), br = readPoint(r);
      r.skip(14);
      const xformId = r.u32();
      r.skip(16);
      const seq = r.u16();
      const parts: Uint8Array[] = [];
      for (const rec of withSeq(file, seq)) parts.push(bytesOf(file, rec));
      for (const rec of withSeq(file, seq + 1)) parts.push(bytesOf(file, rec));
      const total = parts.reduce((a, p) => a + p.length, 0);
      const picture = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { picture.set(p, o); o += p.length; }
      return { kind: 'picture', tl, br, xform: xformOf(xforms, xformId), picture, pictureKind: type === 0x06 ? 'bitmap' : 'metafile' };
    }
    default:
      return null;
  }
}
