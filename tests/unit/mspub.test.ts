/**
 * Microsoft Publisher layout reader. No real .pub files are available offline, so a test-only
 * writer builds minimal publications in the documented structure: a compound file with the
 * Contents, Quill, Escher and EscherDelay streams of a 2002-era file (and a small 2000-era one).
 */
import { describe, it, expect } from 'vitest';
import { importMsPub, isMsPub } from '../../src/io/mspub';
import { sniffFormat, importPublication } from '../../src/io';
import { textOf } from '../../src/model/pub';
import type { TextFrame, PictureFrame, ShapeItem, LineItem, GroupItem, TableItem } from '../../src/model/types';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEKGBkYGP4DADL+A/0oGQ5nAAAAAElFTkSuQmCC';
const png = () => Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));

// ------------------------------------------------------------------------------------------
// Byte helpers

class Buf {
  parts: Uint8Array[] = [];
  len = 0;
  u8(v: number): this { this.parts.push(Uint8Array.of(v & 255)); this.len++; return this; }
  u16(v: number): this { this.parts.push(Uint8Array.of(v & 255, (v >> 8) & 255)); this.len += 2; return this; }
  u32(v: number): this { this.parts.push(Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255)); this.len += 4; return this; }
  i32(v: number): this { return this.u32(v >>> 0); }
  bytes(b: Uint8Array): this { this.parts.push(b); this.len += b.length; return this; }
  ascii(s: string): this { return this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0))); }
  utf16(s: string): this { for (const ch of s) this.u16(ch.charCodeAt(0)); return this; }
  pad(n: number): this { return this.bytes(new Uint8Array(n)); }
  out(): Uint8Array { const o = new Uint8Array(this.len); let p = 0; for (const x of this.parts) { o.set(x, p); p += x.length; } return o; }
}
const cat = (...bs: Uint8Array[]) => new Buf().bytes(bs.reduce((a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }, new Uint8Array(0))).out();

// Contents blocks: id, type, data.
const blk4 = (id: number, v: number) => new Buf().u8(id).u8(0x20).u32(v).out();
const blkSeq = (v: number) => new Buf().u8(0).u8(0x70).u32(v).out();
const dummy = () => new Buf().u8(0).u8(0x78).out();
const str = (id: number, s: string) => { const b = new Buf().utf16(s).u16(0).out(); return new Buf().u8(id).u8(0xc0).u32(b.length + 4).bytes(b).out(); };
const cont = (id: number, type: number, ...kids: Uint8Array[]) => { const b = cat(...kids); return new Buf().u8(id).u8(type).u32(b.length + 4).bytes(b).out(); };
const chunk = (...kids: Uint8Array[]) => { const b = cat(...kids); return new Buf().u32(b.length + 4).bytes(b).out(); };

const EMU_IN = 914400;
const PAL = (i: number) => (0x08000000 | i) >>> 0;

// ------------------------------------------------------------------------------------------
// Compound file writer with storages (every stream in regular sectors; the mini cutoff is 1 byte).

interface Node { name: string; data?: Uint8Array; children?: Node[] }

function cfbFile(tree: Node[]): Uint8Array {
  const SEC = 512;
  const entries: { name: string; type: number; data?: Uint8Array; child: number; right: number; start: number }[] = [];
  const add = (nodes: Node[]): number => {
    let first = -1, prev = -1;
    for (const n of nodes) {
      const idx = entries.length;
      entries.push({ name: n.name, type: n.data ? 2 : 1, data: n.data, child: -1, right: -1, start: 0xfffffffe });
      if (n.children) entries[idx].child = add(n.children);
      if (prev >= 0) entries[prev].right = idx; else first = idx;
      prev = idx;
    }
    return first;
  };
  entries.push({ name: 'Root Entry', type: 5, child: -1, right: -1, start: 0xfffffffe });
  entries[0].child = add(tree);
  const dirSectors = Math.ceil((entries.length * 128) / SEC);
  const streams = entries.filter((e) => e.data);
  const dataSectors = streams.reduce((a, s) => a + Math.ceil(s.data!.length / SEC), 0);
  const total = 1 + dirSectors + dataSectors;
  const fatSectors = Math.ceil((total + 1) / (SEC / 4));
  const out = new Uint8Array((1 + fatSectors + dirSectors + dataSectors + 1) * SEC);
  const u16 = (o: number, v: number) => { out[o] = v & 255; out[o + 1] = (v >> 8) & 255; };
  const u32 = (o: number, v: number) => { u16(o, v & 0xffff); u16(o + 2, (v >>> 16) & 0xffff); };
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  u16(0x18, 0x3e); u16(0x1a, 3); u16(0x1c, 0xfffe); u16(0x1e, 9); u16(0x20, 6);
  u32(0x2c, fatSectors); u32(0x30, fatSectors); u32(0x38, 1); u32(0x3c, 0xfffffffe); u32(0x40, 0); u32(0x44, 0xfffffffe); u32(0x48, 0);
  for (let k = 0; k < 109; k++) u32(0x4c + k * 4, k < fatSectors ? k : 0xffffffff);
  const fat = (sid: number, v: number) => u32((Math.floor(sid / (SEC / 4)) + 1) * SEC + (sid % (SEC / 4)) * 4, v);
  for (let k = 0; k < fatSectors * (SEC / 4); k++) fat(k, 0xffffffff);
  for (let k = 0; k < fatSectors; k++) fat(k, 0xfffffffd);
  let sid = fatSectors;
  for (let k = 0; k < dirSectors; k++) fat(sid + k, k === dirSectors - 1 ? 0xfffffffe : sid + k + 1);
  const dirStart = sid;
  sid += dirSectors;
  for (const s of streams) {
    const n = Math.ceil(s.data!.length / SEC);
    s.start = sid;
    for (let k = 0; k < n; k++) fat(sid + k, k === n - 1 ? 0xfffffffe : sid + k + 1);
    out.set(s.data!, (sid + 1) * SEC);
    sid += n;
  }
  const dir = (dirStart + 1) * SEC;
  entries.forEach((e, i) => {
    const o = dir + i * 128;
    for (let k = 0; k < e.name.length; k++) u16(o + k * 2, e.name.charCodeAt(k));
    u16(o + 0x40, (e.name.length + 1) * 2); out[o + 0x42] = e.type; out[o + 0x43] = 1;
    u32(o + 0x44, 0xffffffff); u32(o + 0x48, e.right < 0 ? 0xffffffff : e.right); u32(o + 0x4c, e.child < 0 ? 0xffffffff : e.child);
    u32(o + 0x74, e.data ? e.start : 0xfffffffe); u32(o + 0x78, e.data ? e.data.length : 0);
  });
  return out;
}

// ------------------------------------------------------------------------------------------
// Quill stream

interface QChunk { name: string; id: number; data: Uint8Array }

function quillStream(chunks: QChunk[]): Uint8Array {
  const headerLen = 0x18 + 8 + chunks.length * 24;
  let off = headerLen;
  const placed = chunks.map((c) => { const o = off; off += c.data.length; return { ...c, offset: o }; });
  const b = new Buf().ascii('CHNK').pad(0x18 - 4).u16(0x18).u16(chunks.length).u32(0xffffffff);
  for (const c of placed) b.u16(0x18).ascii(c.name).u16(c.id).u32(0x01000000).ascii(c.name).u32(c.offset).u32(c.data.length);
  for (const c of placed) b.bytes(c.data);
  return b.out();
}

const styleBlock = (...kids: Uint8Array[]) => chunk(...kids);

/** FDPC/FDPP: run ends (stream positions) and the style blocks. */
function runsChunk(runs: { end: number; style: Uint8Array }[]): Uint8Array {
  const n = runs.length;
  const head = 2 + 6 + 4 * n + 2 * n;
  let off = head;
  const offs = runs.map((r) => { const o = off; off += r.style.length; return o; });
  const b = new Buf().u16(n).pad(6);
  for (const r of runs) b.u32(r.end);
  for (const o of offs) b.u16(o);
  for (const r of runs) b.bytes(r.style);
  return b.out();
}

const QUILL_HEADER = 0x18 + 8 + 11 * 24;
const STORY1 = 'Welcome to the newsletter\rSecond paragraph of the story here\r';
const STORY2 = 'Caption under the picture\r';
const STORY3 = 'A1\rB1\rA2\rB2\r';
const TEXT = STORY1 + STORY2 + STORY3;

function quill2002(): Uint8Array {
  const base = QUILL_HEADER; // TEXT is the first chunk
  const pos = (chars: number) => base + chars * 2;
  const text = new Buf().utf16(TEXT).out();
  const strs = new Buf().u32(3).u32(4).u32(STORY1.length).u32(STORY2.length).u32(STORY3.length).out();
  const syid = new Buf().u32(0).u32(3).u32(1).u32(2).u32(3).out();
  const colors = new Buf().u32(2).pad(8).u32(10).bytes(blk4(1, PAL(1))).u32(10).bytes(blk4(1, 0x000000ff)).out(); // palette 1, then red
  const bold = styleBlock(blk4(0x02, 1), blk4(0x0c, 24 * 12700), cont(0x24, 0x88, cont(0, 0x88, blk4(0, 1))), blk4(0x2e, 0));
  const plain = styleBlock(blk4(0x0c, 11 * 12700), cont(0x24, 0x88, cont(0, 0x88, blk4(0, 0))));
  const italic = styleBlock(blk4(0x03, 1), blk4(0x0c, 9 * 12700), cont(0x24, 0x88, cont(0, 0x88, blk4(0, 1))), cont(0x44, 0x88, blk4(0, 1)), blk4(0x1e, 1));
  const s1 = STORY1.length, s2 = s1 + STORY2.length, s3 = s2 + STORY3.length;
  const fdpc = runsChunk([{ end: pos(7), style: bold }, { end: pos(s1), style: plain }, { end: pos(s2), style: italic }, { end: pos(s3), style: plain }]);
  const centered = styleBlock(blk4(0x04, 2), blk4(0x13, 6 * 12700), blk4(0x34, 2 + Math.round(1.5 * EMU_IN * 96 / 72)));
  const left = styleBlock(blk4(0x04, 0), blk4(0x0d, 18 * 12700), blk4(0x0c, (-9 * 12700) >>> 0));
  const listed = styleBlock(blk4(0x04, 0), cont(0x57, 0x88, blk4(1, 0x2022)));
  const p1 = 'Welcome to the newsletter\r'.length;
  const fdpp = runsChunk([
    { end: pos(p1), style: centered }, { end: pos(s1), style: left }, { end: pos(s2), style: listed },
    { end: pos(s2 + 3), style: left }, { end: pos(s2 + 6), style: left }, { end: pos(s2 + 9), style: left }, { end: pos(s3), style: left },
  ]);
  const defChar = styleBlock(blk4(0x0c, 10 * 12700));
  const defPara = styleBlock(blk4(0x04, 0));
  const stsh2 = new Buf().u32(0).u32(2).pad(12).u32(8).u32(8 + 2 + defChar.length).u16(0).bytes(defChar).u16(0).bytes(defPara).out();
  const font = new Buf().u32(0).u32(2).pad(12 + 8).u16('Georgia'.length).utf16('Georgia').u32(0).u16('Verdana'.length).utf16('Verdana').u32(0).out();
  // Table cell ends: byte offsets of the end of each cell's text inside story 3.
  const tcd = new Buf().u32(3).pad(8).u32(4).u32(10).u32(16).u32(24).out();
  const chunks: QChunk[] = [
    { name: 'TEXT', id: 0, data: text }, { name: 'STRS', id: 0, data: strs }, { name: 'SYID', id: 0, data: syid }, { name: 'PL  ', id: 0, data: colors },
    { name: 'FDPC', id: 0, data: fdpc }, { name: 'FDPP', id: 0, data: fdpp }, { name: 'STSH', id: 0, data: new Uint8Array(8) }, { name: 'STSH', id: 1, data: stsh2 },
    { name: 'FONT', id: 0, data: font }, { name: 'TCD ', id: 2, data: tcd }, { name: 'MCLD', id: 0, data: new Uint8Array(4) },
  ];
  expect(chunks.length).toBe(11);
  return quillStream(chunks);
}

// ------------------------------------------------------------------------------------------
// Contents stream (2002)

const SEQ = { doc: 0, page: 1, textA: 2, textB: 3, pic: 4, rect: 5, line: 6, caption: 7, group: 8, ellipse: 9, small: 10, table: 11, cells: 12, master: 13, bar: 14, palette: 15 };

function contents2002(): Uint8Array {
  const W = 8.5 * EMU_IN, H = 11 * EMU_IN;
  const shape = (textId?: number, valign?: number) => chunk(blk4(0xaa, EMU_IN), blk4(0xab, EMU_IN), ...(textId != null ? [blk4(0x27, textId)] : []), ...(valign != null ? [blk4(0x35, valign)] : []));
  const items: { seq: number; type: number; data: Uint8Array; parent: number }[] = [
    { seq: SEQ.doc, type: 0x44, parent: 0, data: chunk(cont(0x12, 0x88, blk4(1, W), blk4(2, H)), cont(0x02, 0x88, blk4(0, SEQ.page))) },
    { seq: SEQ.page, type: 0x43, parent: 0, data: chunk(cont(0x02, 0x88, ...[SEQ.textA, SEQ.textB, SEQ.pic, SEQ.rect, SEQ.line, SEQ.caption, SEQ.group, SEQ.table].map(blkSeq)), str(0x0e, ''), blk4(0x0d, SEQ.master)) },
    { seq: SEQ.textA, type: 0x01, parent: SEQ.page, data: shape(1) },
    { seq: SEQ.textB, type: 0x01, parent: SEQ.page, data: shape(1) },
    { seq: SEQ.pic, type: 0x01, parent: SEQ.page, data: shape() },
    { seq: SEQ.rect, type: 0x01, parent: SEQ.page, data: shape() },
    { seq: SEQ.line, type: 0x01, parent: SEQ.page, data: shape() },
    { seq: SEQ.caption, type: 0x01, parent: SEQ.page, data: shape(2, 2) },
    { seq: SEQ.group, type: 0x30, parent: SEQ.page, data: chunk() },
    { seq: SEQ.ellipse, type: 0x01, parent: SEQ.group, data: shape() },
    { seq: SEQ.small, type: 0x01, parent: SEQ.group, data: shape() },
    { seq: SEQ.table, type: 0x10, parent: SEQ.page, data: chunk(blk4(0x6b, SEQ.cells), blk4(0x66, 2), blk4(0x67, 2), blk4(0x27, 3), cont(0x6d, 0x88, cont(0, 0x88, blk4(2, 1.5 * EMU_IN)), cont(0, 0x88, blk4(2, 1.5 * EMU_IN)), cont(0, 0x88, blk4(2, 0.5 * EMU_IN)), cont(0, 0x88, blk4(2, 0.5 * EMU_IN)))) },
    { seq: SEQ.cells, type: 0x63, parent: SEQ.table, data: chunk(blk4(1, 4), cont(2, 0x88, ...[[0, 0], [0, 1], [1, 0], [1, 1]].map(([r, c]) => cont(0, 0x88, blk4(1, r), blk4(2, r), blk4(3, c), blk4(4, c))))) },
    { seq: SEQ.master, type: 0x43, parent: 0, data: chunk(cont(0x02, 0x88, blkSeq(SEQ.bar)), str(0x0e, 'Master A')) },
    { seq: SEQ.bar, type: 0x01, parent: SEQ.master, data: shape() },
    { seq: SEQ.palette, type: 0x5c, parent: 0, data: chunk(cont(0, 0xa0, dummy(), cont(0, 0x88, blk4(1, 0x003366)), cont(0, 0x88, blk4(1, 0x0000cc)), dummy(), dummy(), dummy(), dummy(), dummy())) },
  ];
  // Layout: header, chunks in sequence order, trailer.
  const header = new Buf().u8(0xe8).u8(0xac).u8(0x2c).u8(0x00).pad(0x1a - 4).u32(0).pad(0x40 - 0x1e).out();
  let off = header.length;
  const placed = items.map((it) => { const o = off; off += it.data.length; return { ...it, offset: o }; });
  const trailerOffset = off;
  const refs = placed.map((it) => cont(0, 0x88, blk4(0x02, it.type), blk4(0x04, it.offset), blk4(0x05, it.parent)));
  const directory = cont(0, 0x90, ...refs);
  const trailer = new Buf().u32(directory.length + 4).bytes(directory).out();
  const out = cat(header, ...placed.map((p) => p.data), trailer);
  out[0x1a] = trailerOffset & 255; out[0x1b] = (trailerOffset >> 8) & 255; out[0x1c] = (trailerOffset >> 16) & 255; out[0x1d] = (trailerOffset >>> 24) & 255;
  // The palette entries as written: blue-ish (BGR 0x003366 → r 0x66 g 0x33 b 0x00) and (0x0000cc → r 0xcc).
  return out;
}

// ------------------------------------------------------------------------------------------
// Escher streams

const rec = (type: number, inst: number, body: Uint8Array, ver = 0) => new Buf().u16((inst << 4) | ver).u16(type).u32(body.length).bytes(body).out();
const container = (type: number, inst: number, ...kids: Uint8Array[]) => rec(type, inst, cat(...kids), 0xf);
const prop = (id: number, v: number) => new Buf().u16(id).u32(v >>> 0).out();
const fopt = (props: [number, number][], complex: Uint8Array[] = []) => rec(0xf00b, props.length, cat(...props.map(([i, v]) => prop(i, v)), ...complex), 3);
const anchor = (xs: number, ys: number, xe: number, ye: number) => rec(0xf010, 0, new Buf().u32(0).bytes(prop(0x2001, xs)).bytes(prop(0x2002, ys)).bytes(prop(0x2003, xe)).bytes(prop(0x2004, ye)).out());
const childAnchor = (xs: number, ys: number, xe: number, ye: number) => rec(0xf00f, 0, new Buf().i32(xs).i32(ys).i32(xe).i32(ye).out());
const clientData = (seq: number) => rec(0xf011, 0, new Buf().u32(0).bytes(prop(0x6801, seq)).out());
const fsp = (type: number, spid: number, flags: number) => rec(0xf00a, type, new Buf().u32(spid).u32(flags).out(), 2);
const fspgr = (xs: number, ys: number, xe: number, ye: number) => rec(0xf009, 0, new Buf().i32(xs).i32(ys).i32(xe).i32(ye).out(), 1);
const sp = (...kids: Uint8Array[]) => container(0xf004, 0, ...kids);
const inch = (v: number) => Math.round(v * EMU_IN);

function escher2002(): Uint8Array {
  // Picture store with one slot that has a picture (non-zero identifier bytes).
  const fbse = new Buf().u16(0x0006 << 4 | 2).u16(0xf007).u32(36).pad(2).bytes(new Uint8Array(16).fill(0xab)).pad(18).out();
  const dgg = cat(container(0xf000, 0, container(0xf001, 1, fbse)), new Uint8Array(4));
  const pageAnchor = (x0: number, y0: number, x1: number, y1: number) => anchor(inch(x0 - 4.25), inch(y0 - 5.5), inch(x1 - 4.25), inch(y1 - 5.5));
  const shapes = [
    // Group leader of the page (ignored).
    sp(fspgr(0, 0, 0, 0), fsp(0, 1024, 5)),
    sp(fsp(202, 1025, 0xa00), fopt([[0x0180, 0], [0x0181, PAL(2)], [0x01c0, PAL(1)], [0x01cb, 12700], [0x0081, inch(0.1)], [0x0082, inch(0.1)], [0x0083, inch(0.1)], [0x0084, inch(0.1)]]), pageAnchor(1, 1, 4, 5), clientData(SEQ.textA)),
    sp(fsp(202, 1026, 0xa00), fopt([[0x01ff, 1 << 19]]), pageAnchor(4.5, 1, 7.5, 5), clientData(SEQ.textB)),
    sp(fsp(75, 1027, 0xa00), fopt([[0x4104, 1], [0x01ff, 1 << 19]]), pageAnchor(1, 6, 3, 8), clientData(SEQ.pic)),
    sp(fsp(1, 1028, 0xa00), fopt([[0x0004, 30 << 16], [0x0180, 0], [0x0181, 0x0088ff], [0x01c0, 0x000000], [0x01cb, 25400], [0x01ce, 6]]), pageAnchor(4, 6, 6, 7), clientData(SEQ.rect)),
    sp(fsp(20, 1029, 0xa00 | (1 << 7)), fopt([[0x01c0, 0x000000], [0x01cb, 19050], [0x01d1, 1]]), pageAnchor(1, 9, 7, 10), clientData(SEQ.line)),
    sp(fsp(202, 1030, 0xa00), fopt([[0x01ff, 1 << 19]]), pageAnchor(1, 8, 3, 8.5), clientData(SEQ.caption)),
    container(0xf003, 0,
      sp(fspgr(0, 0, 1000, 1000), fsp(0, 1031, 1), fopt([[0x01ff, 1 << 19]]), pageAnchor(6, 8, 8, 10), clientData(SEQ.group)),
      sp(fsp(3, 1032, 0xa00), fopt([[0x0180, 0], [0x0181, PAL(1)], [0x01ff, 1 << 19]]), childAnchor(0, 0, 500, 500), clientData(SEQ.ellipse)),
      sp(fsp(100, 1033, 0xa00), fopt([[0x0180, 0], [0x0181, 0x00ff00], [0x01ff, 1 << 19], [0x0142, 21600], [0x0143, 21600], [0xc145, 6 + 4 * 3], [0xc146, 6 + 2 * 4]],
        [new Buf().u16(3).u16(3).u16(4).u16(0).u16(0).u16(21600).u16(0).u16(10800).u16(21600).out(), new Buf().u16(4).u16(4).u16(2).u16(0x4000).u16(0x0002).u16(0x6001).u16(0x8000).out()]),
        childAnchor(500, 500, 1000, 1000), clientData(SEQ.small)),
    ),
    sp(fsp(1, 1034, 0xa00), fopt([[0x01c0, 0x000000], [0x01cb, 6350]]), pageAnchor(4, 7.5, 7, 8.5), clientData(SEQ.table)),
  ];
  const dgPage = cat(container(0xf002, 1, container(0xf003, 0, ...shapes)), new Uint8Array(4));
  const dgMaster = cat(container(0xf002, 2, container(0xf003, 0,
    sp(fspgr(0, 0, 0, 0), fsp(0, 2048, 5)),
    sp(fsp(1, 2049, 0xa00), fopt([[0x0180, 0], [0x0181, PAL(1)], [0x01ff, 1 << 19]]), pageAnchor(0.5, 0.25, 8, 0.75), clientData(SEQ.bar)),
  )), new Uint8Array(4));
  return cat(dgg, dgPage, dgMaster);
}

function delay2002(): Uint8Array {
  const p = png();
  const body = new Buf().bytes(new Uint8Array(16).fill(0xab)).u8(0xff).bytes(p).out();
  return rec(0xf01e, 0x6e0, body);
}

const pubFile = (over: Partial<Record<'contents' | 'quill' | 'escher' | 'delay', Uint8Array>> = {}) => cfbFile([
  { name: 'Contents', data: over.contents || contents2002() },
  { name: 'Quill', children: [{ name: 'QuillSub', children: [{ name: 'CONTENTS', data: over.quill || quill2002() }] }] },
  { name: 'Escher', children: [{ name: 'EscherStm', data: over.escher || escher2002() }, { name: 'EscherDelayStm', data: over.delay || delay2002() }] },
]);

// ------------------------------------------------------------------------------------------

describe('Publisher 2002+ layout reader', () => {
  it('is identified as before and reads the page size, master page and palette', async () => {
    const b = pubFile();
    expect(isMsPub(b)).toBe(true);
    expect(sniffFormat(b, 'flyer.pub')).toBe('pub');
    const { pub, warnings, textOnly } = await importMsPub(b, 'flyer.pub');
    expect(textOnly).toBe(false);
    expect(pub.size).toEqual({ w: 612, h: 792 });
    expect(pub.pages).toHaveLength(1);
    expect(pub.data.masters).toHaveLength(1);
    expect(pub.data.masters[0].items).toHaveLength(1);
    expect(pub.pages[0].master).toBe(pub.data.masters[0].id);
    expect(pub.data.swatches.find((s) => s.name === 'Scheme Color 1')?.color).toBe('#000000');
    expect(pub.data.swatches.find((s) => s.name === 'Scheme Color 2')?.color).toBe('#663300');
    expect(pub.data.swatches.find((s) => s.name === 'Scheme Color 3')?.color).toBe('#CC0000');
    expect(warnings[0]).toMatch(/Publisher 2002.*1 page and 1 master page/);
  });

  it('places text boxes with formatted stories and links the boxes of one story', async () => {
    const { pub } = await importMsPub(pubFile(), 'flyer.pub');
    const frames = pub.pages[0].items.filter((i): i is TextFrame => i.kind === 'text');
    expect(frames).toHaveLength(3);
    const [a, b2, cap] = frames;
    expect(a).toMatchObject({ x: 72, y: 72, w: 216, h: 288, insets: [7.2, 7.2, 7.2, 7.2] });
    expect(a.fill).toEqual({ type: 'solid', color: 'Scheme Color 3' });
    expect(a.line).toMatchObject({ fill: { type: 'solid', color: 'Scheme Color 2' }, width: 1 });
    expect(a.next).toBe(b2.id);
    expect(b2.prev).toBe(a.id);
    expect(b2.story).toBe(a.story);
    expect(b2.line).toBeUndefined();
    const story = pub.data.stories.find((s) => s.id === a.story)!;
    expect(story.paras).toHaveLength(2);
    expect(story.paras[0]).toMatchObject({ align: 'ctr', spaceAfter: 6, lineSpacing: 150 });
    expect(story.paras[0].runs[0]).toMatchObject({ text: 'Welcome', b: true, size: 24, font: 'Verdana', color: 'Scheme Color 2' });
    expect(story.paras[0].runs[1]).toMatchObject({ text: ' to the newsletter', size: 11, font: 'Georgia' });
    expect(story.paras[0].runs[1].b).toBeUndefined();
    expect(story.paras[1]).toMatchObject({ align: 'l', marL: 18, indent: -9 });
    expect(textOf(story.paras)).toBe('Welcome to the newsletter\nSecond paragraph of the story here');
    expect(cap.anchor).toBe('b');
    const capStory = pub.data.stories.find((s) => s.id === cap.story)!;
    expect(capStory.paras[0].bullet).toEqual({ kind: 'char', char: '•' });
    expect(capStory.paras[0].runs[0]).toMatchObject({ text: 'Caption under the picture', i: true, u: true, size: 9, color: '#ff0000' });
  });

  it('places the picture, the rectangle, the line, the group and the table', async () => {
    const { pub } = await importMsPub(pubFile(), 'flyer.pub');
    const items = pub.pages[0].items;
    const pic = items.find((i): i is PictureFrame => i.kind === 'picture')!;
    expect(pic).toMatchObject({ x: 72, y: 432, w: 144, h: 144 });
    expect(pic.media && pub.media[pic.media].mime).toBe('image/png');
    const rect = items.find((i): i is ShapeItem => i.kind === 'shape')!;
    expect(rect).toMatchObject({ geom: 'rect', rot: 30, fill: { type: 'solid', color: '#ff8800' }, line: { fill: { type: 'solid', color: '#000000' }, width: 2, dash: 'dash' } });
    const line = items.find((i): i is LineItem => i.kind === 'line')!;
    expect(line).toMatchObject({ x: 72, y: 648, w: 432, h: 72, flipV: true, line: { width: 1.5, tail: 'triangle' } });
    const group = items.find((i): i is GroupItem => i.kind === 'group')!;
    expect(group).toMatchObject({ x: 432, y: 576, w: 144, h: 144 });
    expect(group.children).toHaveLength(2);
    expect(group.children[0]).toMatchObject({ kind: 'shape', geom: 'ellipse', x: 0, y: 0, w: 72, h: 72, fill: { type: 'solid', color: 'Scheme Color 2' } });
    const custom = group.children[1] as ShapeItem;
    expect(custom).toMatchObject({ kind: 'shape', geom: 'custom', x: 72, y: 72, w: 72, h: 72 });
    expect(custom.path![0].d).toBe('M 0 0 L 21600 0 L 10800 21600 Z');
    const table = items.find((i): i is TableItem => i.kind === 'table')!;
    expect(table.cols).toEqual([108, 108]);
    expect(table.rows.map((r) => r.h)).toEqual([36, 36]);
    expect(table.rows.map((r) => r.cells.map((c) => textOf(c.text)))).toEqual([['A1', 'B1'], ['A2', 'B2']]);
    expect(table.border?.width).toBe(0.5);
    // Drawing order is kept.
    expect(items.map((i) => i.kind)).toEqual(['text', 'text', 'picture', 'shape', 'line', 'text', 'group', 'table']);
    const r = await importPublication(pubFile(), 'flyer.pub');
    expect(r.format).toBe('pub');
    expect(r.pub.pages[0].items).toHaveLength(8);
  });

  it('falls back to the text and picture harvest when the Contents stream is broken', async () => {
    const broken = contents2002();
    broken[0x1a] = 0xff; broken[0x1b] = 0xff; broken[0x1c] = 0; broken[0x1d] = 0; // trailer offset past the end
    const { pub, warnings, textOnly } = await importMsPub(pubFile({ contents: broken }), 'flyer.pub');
    expect(textOnly).toBe(true);
    expect(warnings[0]).toMatch(/recovered and placed on new pages because the layout could not be read/);
    const text = pub.data.stories.map((s) => textOf(s.paras)).join('\n');
    expect(text).toContain('Welcome to the newsletter');
    expect(Object.keys(pub.media)).toHaveLength(1);
  });

  it('falls back when the version is unknown', async () => {
    const odd = contents2002();
    odd[2] = 0x30;
    const r = await importMsPub(pubFile({ contents: odd }), 'flyer.pub');
    expect(r.textOnly).toBe(true);
    expect(r.warnings[0]).toMatch(/unrecognized Publisher version/);
  });
});

// ------------------------------------------------------------------------------------------
// Publisher 2000

function contents2000(): Uint8Array {
  const header = new Buf().u8(0xe8).u8(0xac).u8(0x22).u8(0x00).pad(0x16 - 4).u32(0).pad(0x40 - 0x1a).out();
  const doc = new Buf().u16(0x0015).pad(0x14 - 2).u32(inch(8.5)).u32(inch(11)).pad(16).out();
  const page = new Buf().u16(0x0014).pad(0x40).out();
  // Text box: marker 0x0008, rotation at +4 (tenths of a degree, counter-clockwise), coordinates at +6, fill type at +0x2a (2 = solid) with color at +0x22, left line at +0x2c, text id at +0x58.
  const textBox = new Buf().u16(0x0008).u16(0).u16(0).i32(inch(-3)).i32(inch(-4)).i32(inch(3)).i32(inch(-1)).pad(0x22 - 0x16).u32(0xc0000001).pad(0x2a - 0x26).u8(2).u8(0).u8(1).u32(0x20ff0000).pad(0x58 - 0x31).u16(1).pad(8).out();
  // Ellipse: marker 0x0007, no fill, left line 2pt green.
  const ellipse = new Buf().u16(0x0007).u16(0).u16(450).i32(inch(-1)).i32(inch(1)).i32(inch(1)).i32(inch(3)).pad(0x2a - 0x16).u8(0).u8(0).u8(2).u32(0x80000003).pad(0x58 - 0x31).u16(0).pad(8).out();
  const palette = new Buf().u16(0x0047).pad(0xa0 - 2).u32(0x90123456).u32(0x80000002).pad(24).out();
  const items = [{ seq: 1, parent: 0, data: doc }, { seq: 2, parent: 0, data: page }, { seq: 3, parent: 2, data: textBox }, { seq: 4, parent: 2, data: ellipse }, { seq: 5, parent: 0, data: palette }];
  let off = header.length;
  const placed = items.map((it) => { const o = off; off += it.data.length; return { ...it, offset: o }; });
  const trailer = new Buf().u16(placed.length);
  for (const p of placed) trailer.u16(0).u16(p.seq).u16(p.parent).u32(p.offset);
  const out = cat(header, ...placed.map((p) => p.data), trailer.out());
  out[0x16] = off & 255; out[0x17] = (off >> 8) & 255; out[0x18] = (off >> 16) & 255; out[0x19] = (off >>> 24) & 255;
  return out;
}

describe('Publisher 2000 layout reader', () => {
  it('reads pages, a text box with its story, an ellipse, fills and outlines', async () => {
    const b = cfbFile([
      { name: 'Contents', data: contents2000() },
      { name: 'Quill', children: [{ name: 'QuillSub', children: [{ name: 'CONTENTS', data: quill2002() }] }] },
    ]);
    const { pub, warnings, textOnly } = await importMsPub(b, 'old.pub');
    expect(textOnly).toBe(false);
    expect(pub.size).toEqual({ w: 612, h: 792 });
    expect(pub.pages).toHaveLength(1);
    const tf = pub.pages[0].items.find((i): i is TextFrame => i.kind === 'text')!;
    expect(tf).toMatchObject({ x: 90, y: 108, w: 432, h: 216, fill: { type: 'solid', color: 'Scheme Color 2' }, line: { width: 1 } });
    expect(tf.line?.fill).toEqual({ type: 'solid', color: '#0000ff' });
    const story = pub.data.stories.find((s) => s.id === tf.story)!;
    expect(textOf(story.paras)).toBe('Welcome to the newsletter\nSecond paragraph of the story here');
    expect(story.paras[0].runs[0]).toMatchObject({ text: 'Welcome', b: true, size: 24 });
    const el = pub.pages[0].items.find((i): i is ShapeItem => i.kind === 'shape')!;
    expect(el).toMatchObject({ geom: 'ellipse', x: 234, y: 468, w: 144, h: 144, rot: 315, fill: { type: 'none' }, line: { width: 2, fill: { type: 'solid', color: '#00ff00' } } });
    expect(pub.data.swatches.find((s) => s.name === 'Scheme Color 1')?.color).toBe('#563412');
    expect(warnings.some((w) => /Publisher 2000 files/.test(w))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------
// Real files (Publisher 2007-era weekly ads and a menu), only where the sample folder exists.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
const SAMPLES = '/home/user/samples/pub';
const sample = (prefix: string) => `${SAMPLES}/${(existsSync(SAMPLES) ? readdirSync(SAMPLES) : []).find((n) => n.startsWith(prefix)) || ''}`;

describe.skipIf(!existsSync(SAMPLES))('Publisher real files', () => {
  it('reads the Crawford weekly ad: 3 landscape pages, the menu columns and the table', async () => {
    const { pub, warnings, textOnly } = await importMsPub(new Uint8Array(readFileSync(sample('2a488d82'))), 'crawford.pub');
    expect(textOnly).toBe(false);
    expect(pub.size).toEqual({ w: 1008, h: 612 });
    expect(pub.pages).toHaveLength(3);
    expect(pub.data.masters).toHaveLength(1);
    const items = pub.pages[0].items;
    expect(items).toHaveLength(10);
    expect(items.map((i) => i.kind)).toEqual(['group', 'table', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text']);
    const cols = items.filter((i): i is TextFrame => i.kind === 'text');
    const texts = cols.map((f) => textOf(pub.data.stories.find((s) => s.id === f.story)!.paras));
    expect(texts.some((t) => t.includes('Coconut Corn'))).toBe(true);
    expect(texts.some((t) => t.includes('Chicken & Corn Chowder'))).toBe(true);
    expect(cols[1]).toMatchObject({ x: 70.67, y: 88.25, w: 132.21, line: { width: 0.75 } });
    const table = items.find((i): i is TableItem => i.kind === 'table')!;
    expect(textOf(table.rows[0].cells[0].text)).toMatch(/RESIDENTIAL\s+LIVING\s+Week 2/);
    expect(table.rows[0].cells[0].text[0].runs[0]).toMatchObject({ font: 'Elephant', b: true });
    const group = items[0] as GroupItem;
    expect(group.children.map((c) => c.kind)).toEqual(['text', 'picture']);
    expect(Object.values(pub.media).map((m) => m.mime)).toEqual(['image/jpeg']);
    expect((group.children[1] as PictureFrame).src).toMatch(/image004\.jpg/);
    expect(pub.data.stories).toHaveLength(9);
    expect(pub.data.swatches.find((s) => s.name === 'Scheme Color 2')?.color).toBe('#0000FF');
    expect(warnings[0]).toMatch(/3 pages and 1 master page with 10 objects and 9 stories/);
  });

  it('reads the Park View ad with its pictures, legend and chains intact', async () => {
    const { pub } = await importMsPub(new Uint8Array(readFileSync(sample('49d55a1d'))), 'pv.pub');
    expect(pub.pages).toHaveLength(3);
    const items = pub.pages[0].items;
    expect(items).toHaveLength(28);
    expect(items.filter((i) => i.kind === 'picture')).toHaveLength(10);
    expect(items.filter((i) => i.kind === 'group')).toHaveLength(4);
    expect(Object.keys(pub.media)).toHaveLength(7);
    const note = items.find((i): i is TextFrame => i.kind === 'text' && textOf(pub.data.stories.find((s) => s.id === i.story)!.paras).includes('subject to change'))!;
    expect(note).toMatchObject({ x: 11.24, y: 582.41, w: 999.06 });
    const run = pub.data.stories.find((s) => s.id === note.story)!.paras[0].runs.find((r) => r.text.includes('subject'))!;
    expect(run).toMatchObject({ font: 'Times New Roman', i: true, color: '#c00000' });
  });

  it('reads the Blue Note menu: Letter pages in document order, picture frames with source names, decorated borders as groups', async () => {
    const { pub } = await importMsPub(new Uint8Array(readFileSync(sample('53eeea52'))), 'menu.pub');
    expect(pub.size).toEqual({ w: 612, h: 792 });
    expect(pub.pages).toHaveLength(3);
    expect(pub.pages.map((p) => p.items.length)).toEqual([9, 6, 9]);
    const first = pub.pages[0].items;
    const title = first.find((i): i is TextFrame => i.kind === 'text' && textOf(pub.data.stories.find((s) => s.id === i.story)!.paras).startsWith('Blue Note Bistro'))!;
    expect(title).toBeTruthy();
    const titleRun = pub.data.stories.find((s) => s.id === title.story)!.paras[0].runs[0];
    expect(titleRun).toMatchObject({ font: 'Calibri', color: 'Scheme Color 6', size: 24, b: true });
    expect(pub.data.swatches.find((s) => s.name === 'Scheme Color 6')?.color).toBe('#0000FF');
    const border = first.find((i): i is GroupItem => i.kind === 'group')!;
    expect(border.children.length).toBeGreaterThan(50);
    expect(border.children[1]).toMatchObject({ kind: 'shape', geom: 'triangle', fill: { type: 'solid', color: 'Scheme Color 2' } });
    const pics = pub.pages[1].items.filter((i): i is PictureFrame => i.kind === 'picture');
    expect(pics.length).toBe(2);
    expect(pics.map((p) => p.src)).toContain('cold-beverages-e1421417320930[1].jpg');
    expect(pics.every((p) => p.media && pub.media[p.media].mime === 'image/jpeg')).toBe(true);
    expect(pub.data.stories.some((s) => textOf(s.paras).includes('Specialty Martini'))).toBe(true);
  });
});
