import { describe, it, expect } from 'vitest';
import { importPublication, sniffFormat } from '../../src/io';
import { importLegacyLayout } from '../../src/io/legacyLayout';
import { importQxp, isMacBinaryQxp, unwrapMacBinary, readQxpHeader } from '../../src/io/qxp/index';
import { Deobfuscator, getChain, shiftBits } from '../../src/io/qxp/blocks';
import { importPageMaker } from '../../src/io/pagemaker/index';
import { openPageMaker } from '../../src/io/pagemaker/records';
import { textOf } from '../../src/model/pub';
import type { TextFrame, PictureFrame, ShapeItem, LineItem, GroupItem } from '../../src/model/types';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const pngBytes = () => Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));

/** A growable little-endian byte writer used by the test-only file builders. */
class W {
  bytes: number[] = [];
  get length(): number { return this.bytes.length; }
  u8(v: number): this { this.bytes.push(v & 0xff); return this; }
  u16(v: number): this { return this.u8(v).u8(v >> 8); }
  u32(v: number): this { return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff); }
  i16(v: number): this { return this.u16(v < 0 ? v + 0x10000 : v); }
  i32(v: number): this { return this.u32(v < 0 ? v + 0x100000000 : v); }
  fraction(v: number): this { return this.i32(Math.round(v * 65536)); }
  zeros(n: number): this { for (let i = 0; i < n; i++) this.bytes.push(0); return this; }
  str(s: string): this { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  cstr(s: string): this { return this.str(s).u8(0); }
  raw(b: Uint8Array | number[]): this { for (const v of b) this.u8(v); return this; }
  padTo(n: number): this { while (this.bytes.length < n) this.bytes.push(0); return this; }
  set(at: number, w: W): this { for (let i = 0; i < w.bytes.length; i++) this.bytes[at + i] = w.bytes[i]; return this; }
  out(): Uint8Array { return Uint8Array.from(this.bytes); }
}

// ------------------------------------------------------------------------------------------
// QuarkXPress 4 (Windows) file built in code. The obfuscation is an XOR with a running key, so the
// reader's key class produces the stored values when driven through the same steps.

const SEED = 0x3c5a, INCREMENT = 0x0123;
const TEXT_INFO_BLOCK = 20, TEXT_BLOCK = 21, PICTURE_INDEX = 7;
const STORY = 'Hello QuillPress\rSecond paragraph caf\xe9 here.\rThird one.\r';

function record(body: (w: W) => void): W { const b = new W(); body(b); const w = new W(); w.u32(b.length).raw(b.bytes); return w; }
const emptyRecord = () => record(() => {});

function qxp4Document(): Uint8Array {
  const d = new W();
  for (let i = 0; i < 5; i++) d.raw(emptyRecord().bytes);
  d.raw(record((w) => { w.u16(2).i16(0).u16(0).cstr('Times New Roman').cstr('TimesNewRoman').i16(1).u16(0).cstr('Arial').cstr('Arial'); }).bytes); // fonts
  d.raw(emptyRecord().bytes);
  // Colors: a block table with one color record (id 9) pointing at an RGB block.
  d.raw(record((w) => {
    const blocks = 3;
    const specsAt = 14 + 2 + 20;
    const off2 = specsAt + 4 * blocks, off3 = off2 + 2 + 2 + 30 + 2 + 70 + 2;
    w.zeros(14).u16(blocks).zeros(20);
    w.u32(0).u32(off2).u32(off3);
    w.u16(4).u16(2).zeros(30).u16(9).zeros(70).u16(3);
    w.zeros(16).u16(Math.round(0.2 * 65536)).u16(Math.round(0.4 * 65536)).u16(Math.round(0.8 * 65536));
  }).bytes);
  d.raw(emptyRecord().bytes); // paragraph style sheets
  d.raw(emptyRecord().bytes);
  d.raw(record((w) => { w.zeros(4).u8(0).u8(3).u8(2).u8(2).zeros(4).u8(0).u8(0).u8(1).zeros(33).zeros(64); }).bytes); // one H&J, hyphenating
  d.raw(emptyRecord().bytes); // line styles (defaults)
  d.raw(emptyRecord().bytes);
  d.raw(record((w) => { w.u32(0); }).bytes); // templates: none
  d.raw(record((w) => { // character formats
    const cf = (font: number, flags: number, size: number, color: number) => { w.zeros(8).i16(font).u16(flags).fraction(size).zeros(4).u16(color).zeros(2).fraction(1).zeros(8).fraction(0).u8(0).zeros(23); };
    cf(0, 0, 12, 1);
    cf(1, 0x1 | 0x400, 14, 9);
  }).bytes);
  d.raw(record(() => {}).bytes); // tab stops: none
  d.raw(record((w) => { // paragraph formats
    const pf = (align: number, marL: number, leading: number) => { w.zeros(8).u8(0).zeros(2).u8(align).zeros(4).u16(0).zeros(2).fraction(marL).fraction(0).fraction(0).fraction(leading).fraction(0).fraction(6).zeros(4).zeros(24).zeros(24).u16(0xffff).zeros(2); };
    pf(0, 0, 0);
    pf(1, 10, 16);
  }).bytes);
  d.raw(emptyRecord().bytes);

  // Pages: one master page (no objects) then one document page with five objects.
  const key = new Deobfuscator(SEED, INCREMENT);
  const pageSettings = (w: W) => { w.zeros(6).u16(1).zeros(2).fraction(0).fraction(0).fraction(792).fraction(612).zeros(36).zeros(12).u32(0).zeros(4).u32(0).zeros(4).zeros(4).u32(0); };
  const objectHeader = (w: W, o: { content: number; shape: number; contentIndex: number; linkId: number; color?: number; noColor?: boolean; rotation?: number }) => {
    const ctObf = key.value(o.content) & 0xff;
    key.nextShift(o.content);
    const ciObf = key.value(o.contentIndex);
    const stObf = key.value(o.shape) & 0xff;
    w.u8(o.noColor ? 1 : 0).u8(0).u16(o.color ?? 1).fraction(1).zeros(4).u32(ciObf).fraction(o.rotation || 0).fraction(0).u32(o.linkId).u32(0).u32(0).zeros(4).u8(0).u8(0).u8(ctObf).u8(stObf);
  };
  const frame = (w: W, width: number, arrow = 0) => { w.fraction(width).fraction(1).u16(1).u16(0).fraction(1).u8(arrow << 2).u8(0).u16(0); };
  const runaround = (w: W, on: boolean) => { w.u8(on ? 1 : 0).zeros(39); };
  const bbox = (w: W, top: number, left: number, bottom: number, right: number) => { w.fraction(top).fraction(left).fraction(bottom).fraction(right); };

  // master page
  pageSettings(d);
  d.u32(key.value(0));
  key.nextRev();
  // document page
  pageSettings(d);
  const objects: ((w: W) => void)[] = [];
  objects.push((w) => { // 0: text box starting the chain
    objectHeader(w, { content: 3, shape: 5, contentIndex: TEXT_INFO_BLOCK, linkId: 1, noColor: true });
    frame(w, 0); w.zeros(4); runaround(w, false); w.zeros(4); bbox(w, 72, 36, 300, 400); w.fraction(0).zeros(20);
    w.u32(0).zeros(2).zeros(2).fraction(12).fraction(3).fraction(4).fraction(5).fraction(6).fraction(0).fraction(0).u8(2).u8(1).zeros(10).u32(0).zeros(4).zeros(12);
    w.zeros(4).u32(0).zeros(4);
    key.next4(TEXT_INFO_BLOCK);
  });
  objects.push((w) => { // 1: picture box with an embedded PNG preview
    objectHeader(w, { content: 4, shape: 5, contentIndex: PICTURE_INDEX, linkId: 0, noColor: true });
    frame(w, 1); w.zeros(4); runaround(w, true); w.zeros(4); bbox(w, 320, 36, 420, 136); w.fraction(0).zeros(16); w.u32(0);
    w.zeros(24).fraction(0).fraction(0).fraction(0).fraction(0).fraction(1).fraction(1).zeros(76);
    const png = pngBytes(); w.u32(png.length).raw(png);
    key.next4(PICTURE_INDEX);
  });
  objects.push((w) => { // 2: line with an arrow head
    objectHeader(w, { content: 0, shape: 2, contentIndex: 0, linkId: 0, color: 1 });
    frame(w, 2, 1); w.zeros(4); runaround(w, false); w.zeros(4); bbox(w, 500, 36, 500, 400); w.zeros(24);
    key.next4(0);
  });
  objects.push((w) => { // 3: second text box of the chain
    objectHeader(w, { content: 3, shape: 5, contentIndex: TEXT_INFO_BLOCK, linkId: 1, noColor: true });
    frame(w, 0); w.zeros(4); runaround(w, false); w.zeros(4); bbox(w, 520, 36, 700, 400); w.fraction(0).zeros(20);
    w.u32(40).zeros(2).zeros(2).fraction(12).fraction(0).fraction(0).fraction(0).fraction(0).fraction(0).fraction(0).u8(1).u8(0).zeros(10).u32(0).zeros(4).zeros(12);
    key.next4(TEXT_INFO_BLOCK);
  });
  objects.push((w) => { // 4: red oval, rotated
    objectHeader(w, { content: 0, shape: 9, contentIndex: 0, linkId: 0, color: 2, rotation: 15 });
    frame(w, 0.5); w.zeros(4); runaround(w, false); w.zeros(4); bbox(w, 320, 300, 420, 500); w.fraction(0).zeros(20);
    key.next4(0);
  });
  d.u32(key.value(objects.length));
  key.nextRev();
  for (const o of objects) o(d);
  return d.out();
}

/** The story chain: block list, character spans, paragraph spans. */
function qxp4TextInfo(): Uint8Array {
  const w = new W();
  w.zeros(4);
  w.u32(8).u32(TEXT_BLOCK).u32(STORY.length);
  w.u32(16).u32(1).u32(5).u32(0).u32(STORY.length - 5);
  const p1 = STORY.indexOf('\r') + 1, p2 = STORY.indexOf('\r', p1) + 1;
  w.u32(24).u32(0).u32(p1).u32(1).u32(p2 - p1).u32(0).u32(STORY.length - p2);
  return w.out();
}

function qxp4File(): Uint8Array {
  const f = new W();
  // Header (two blocks).
  f.zeros(2).str('IIXPR3').u16(0x41).zeros(2).str('DC');
  f.padTo(34);
  const pagesStored = (1 & 0xfffc) | ((1 & 3) ^ 3);
  f.u16(pagesStored ^ SEED);
  f.padTo(77).u8(1);
  f.padTo(0x52).u16(INCREMENT);
  f.padTo(0x58).fraction(0.2);
  f.padTo(0x80).u16(SEED);
  f.padTo(512);
  // Document chain: block 3 (252 bytes, pointer to a big block at 4), then the big block.
  const doc = qxp4Document();
  const first = doc.subarray(0, 252), rest = doc.subarray(252);
  f.raw(first).padTo(3 * 256 - 4).i32(-4);
  const bigCount = Math.ceil((rest.length + 6) / 256);
  f.u16(bigCount).raw(rest).padTo((3 + bigCount) * 256 - 4).i32(0);
  // Text chains.
  f.padTo((TEXT_INFO_BLOCK - 1) * 256).raw(qxp4TextInfo()).padTo(TEXT_INFO_BLOCK * 256 - 4).i32(0);
  f.padTo((TEXT_BLOCK - 1) * 256).str(STORY).padTo(TEXT_BLOCK * 256);
  return f.out();
}

function macBinary(data: Uint8Array): Uint8Array {
  const w = new W();
  w.u8(0).u8(8).str('test.qxp').padTo(65).str('XDOCXPR3');
  w.padTo(83).u8(data.length >>> 24).u8((data.length >> 16) & 0xff).u8((data.length >> 8) & 0xff).u8(data.length & 0xff);
  w.padTo(128).raw(data);
  return w.out();
}

describe('QuarkXPress 4 layout reader', () => {
  it('rotates and fills bits the way the 4.x key does', () => {
    expect(shiftBits(0x1234, 0)).toBe(0x1234);
    expect(shiftBits(0x0001, 1)).toBe(0x8000);
    const k = new Deobfuscator(0x00ff, 0x0001);
    expect(k.value(0x0f0f)).toBe(0x0ff0);
    expect(k.byte(0xff)).toBe(0);
  });

  it('follows block chains with small and big blocks and stops at cycles', () => {
    const f = qxp4File();
    const doc = getChain(f, 3, false);
    expect(doc.length).toBeGreaterThan(600);
    expect(Array.from(doc.subarray(0, 20))).toEqual(Array.from(qxp4Document().subarray(0, 20)));
    const looped = Uint8Array.from(f);
    new DataView(looped.buffer).setInt32(3 * 256 - 4, 3, true); // block 3 points at itself
    expect(getChain(looped, 3, false).length).toBe(252);
  });

  it('reads the header, pages, boxes, chains, formats and colors of a 4.x file', async () => {
    const f = qxp4File();
    const h = readQxpHeader(f);
    expect(h.version).toBe(0x41);
    expect(h.pagesCount).toBe(1);
    expect(h.masterPagesCount).toBe(1);
    expect(sniffFormat(f, 'x.qxp')).toBe('qxp');
    const r = await importQxp(f, 'spring.qxp');
    expect(r.textOnly).toBe(false);
    expect(r.warnings[0]).toMatch(/QuarkXPress 4 document "spring.qxp": 1 page read with 2 text boxes, 1 text chain, 1 picture box, 1 line, 1 box/);
    const pub = r.pub;
    expect(pub.size).toEqual({ w: 612, h: 792 });
    expect(pub.pages).toHaveLength(1);
    const items = pub.pages[0].items;
    expect(items).toHaveLength(5);
    // Objects are stored top-first, so the file order is reversed on the page.
    const oval = items[0] as ShapeItem, second = items[1] as TextFrame, line = items[2] as LineItem, pic = items[3] as PictureFrame, first = items[4] as TextFrame;
    expect(first.kind).toBe('text');
    expect([first.x, first.y, first.w, first.h]).toEqual([36, 72, 364, 228]);
    expect(first.columns).toBe(2);
    expect(first.gutter).toBe(12);
    expect(first.insets).toEqual([3, 5, 6, 4]);
    expect(first.anchor).toBe('ctr');
    expect(second.story).toBe(first.story);
    expect(first.next).toBe(second.id);
    expect(second.prev).toBe(first.id);
    expect(second.columns).toBeUndefined();
    const story = pub.story(first.story)!;
    expect(story.paras).toHaveLength(3);
    expect(textOf(story.paras)).toContain('Second paragraph café here.');
    expect(story.paras[0].runs[0]).toMatchObject({ text: 'Hello', b: true, caps: 'all', font: 'Arial', size: 14, color: '#3366cc' });
    expect(story.paras[0].runs[1]).toMatchObject({ text: ' QuillPress', font: 'Times New Roman', size: 12 });
    expect(story.paras[1]).toMatchObject({ align: 'ctr', marL: 10, lineSpacing: 16, lineSpacingPt: true, spaceAfter: 6, hyphenate: true });
    expect(story.paras[0].align).toBeUndefined();
    expect(pic.kind).toBe('picture');
    expect(pic.media).toBeTruthy();
    expect(pub.media[pic.media!].mime).toBe('image/png');
    expect(pic.wrap?.mode).toBe('square');
    expect([pic.x, pic.y, pic.w, pic.h]).toEqual([36, 320, 100, 100]);
    expect(line.kind).toBe('line');
    expect(line.line?.width).toBe(2);
    expect(line.line?.head).toBe('triangle');
    expect([line.x, line.y, line.w, line.h]).toEqual([36, 500, 364, 0]);
    expect(oval.kind).toBe('shape');
    expect(oval.geom).toBe('ellipse');
    expect(oval.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(oval.rot).toBe(-15);
    expect(oval.line?.width).toBe(0.5);
  });

  it('is wired into importPublication', async () => {
    const { pub } = await importPublication(qxp4File(), 'spring.qxp');
    expect(pub.pages).toHaveLength(1);
    expect(pub.data.stories.some((s) => textOf(s.paras).includes('Hello QuillPress'))).toBe(true);
  });

  it('unwraps a MacBinary transfer wrapper', async () => {
    const wrapped = macBinary(qxp4File());
    expect(isMacBinaryQxp(wrapped)).toBe(true);
    expect(unwrapMacBinary(wrapped).length).toBe(qxp4File().length);
    const r = await importLegacyLayout(wrapped, 'spring.qxp', 'qxp');
    expect(r.textOnly).toBe(false);
    expect(r.pub.pages[0].items).toHaveLength(5);
  });

  it('falls back to the text harvest when the document chain is damaged', async () => {
    const f = Uint8Array.from(qxp4File());
    new DataView(f.buffer).setInt32(3 * 256 - 4, 9999, true); // the chain runs into nothing
    const r = await importLegacyLayout(f, 'broken.qxp', 'qxp');
    expect(r.textOnly).toBe(true);
    expect(r.warnings[0]).toMatch(/QuarkXPress 4: the layout could not be read/);
    expect(textOf(r.pub.data.stories[0].paras)).toContain('Hello QuillPress');
  });

  it('falls back for versions it does not read (5 and later)', async () => {
    const f = Uint8Array.from(qxp4File());
    f[8] = 0x43;
    const r = await importQxp(f, 'later.qxp');
    expect(r.textOnly).toBe(true);
    expect(r.warnings[0]).toMatch(/QuarkXPress 5 or later/);
  });
});

// ------------------------------------------------------------------------------------------
// PageMaker 6.5 (Windows) file built in code.

function tinyTiff(): Uint8Array {
  const w = new W();
  w.str('II').u16(42).u32(8);
  const entries: [number, number, number, number][] = [[256, 3, 1, 2], [257, 3, 1, 2], [258, 3, 3, 0], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, 2], [279, 4, 1, 12], [284, 3, 1, 1]];
  const ifdLen = 2 + entries.length * 12 + 4;
  const bpsAt = 8 + ifdLen, dataAt = bpsAt + 6;
  w.u16(entries.length);
  for (const [tag, type, count, value] of entries) {
    w.u16(tag).u16(type).u32(count);
    if (tag === 258) w.u32(bpsAt);
    else if (tag === 273) w.u32(dataAt);
    else if (type === 3) w.u16(value).u16(0);
    else w.u32(value);
  }
  w.u32(0);
  w.u16(8).u16(8).u16(8);
  w.raw([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  return w.out();
}

const PM_TEXT = 'Garden club news\rSpring meeting at noon.\r';

function pmFile(opts: { doubleSided?: boolean } = {}): Uint8Array {
  const f = new W();
  f.raw([0, 0, 0, 0, 0, 0, 0xff, 0x99]);
  f.padTo(0x2a).u8(0x33); // version byte: 6.5/7
  f.padTo(0x40).str('Adobe PageMaker 6.5');
  f.padTo(0x200);
  // Containers in table order; the table entry index is the sequence number.
  type C = { type: number; body: W; count: number };
  const cs: C[] = [];
  const add = (type: number, count: number, body: W) => { cs.push({ type, count, body }); return cs.length - 1; };
  const SHAPE_SEQ = 2, TEXT_SEQ = 7, CHARS_SEQ = 8, PARA_SEQ = 9, TIFF_SEQ = 10;
  // 0 global info
  const gi = new W(); gi.u8(opts.doubleSided ? 0x2 : 0).padTo(0x36).i16(-6120).i16(-7920).i16(6120).i16(7920).padTo(2496);
  add(0x18, 1, gi);
  // 1 page
  const pg = new W(); pg.zeros(2).u16(SHAPE_SEQ).padTo(472);
  add(0x05, 1, pg);
  // 2 shapes
  const sh = new W();
  const shape = (body: (w: W) => void) => { const s = new W(); body(s); s.padTo(258); sh.raw(s.bytes); };
  shape((w) => { w.u8(1).padTo(6).i16(-5400).i16(-6480).i16(5400).i16(-3600).padTo(28).u32(0).u32(42); }); // text block
  shape((w) => { w.u8(4).padTo(4).u8(1).padTo(6).i16(-5400).i16(-3000).i16(-3000).i16(-1000).padTo(28).u32(0).u8(0).padTo(35).u16(10).padTo(38).u8(2).padTo(40).u8(0).padTo(44).u8(100).padTo(224).u8(100); }); // rectangle
  shape((w) => { w.u8(3).padTo(4).u16(0).i16(-5400).i16(0).i16(5400).i16(0).padTo(32).u8(5).padTo(34).u32(5 * 256).padTo(38).u16(257).padTo(40).i16(-5400).i16(0).i16(5400).i16(0); }); // dashed line: stroke type, 24.8 width in fifths of a point, end points
  shape((w) => { w.u8(6).padTo(6).i16(0).i16(-3000).i16(2000).i16(-1000).padTo(28).u32(0).padTo(48).u16(TIFF_SEQ); }); // bitmap
  shape((w) => { w.u8(5).padTo(4).u8(0).padTo(6).i16(2000).i16(1000).i16(4000).i16(2000).padTo(28).u32(7).u8(0).padTo(35).u16(5).padTo(38).u8(0).padTo(40).u8(1).padTo(44).u8(100).padTo(224).u8(100); }); // rotated ellipse
  add(0x19, 5, sh);
  // 3 fonts, 4 colors, 5 xforms, 6 text block
  const fonts = new W(); fonts.cstr('Times New Roman').padTo(94).cstr('Arial').padTo(188);
  add(0x13, 2, fonts);
  const colors = new W(); colors.padTo(0x22).u8(0x18).zeros(3).raw([0, 0, 0]).padTo(210).padTo(210 + 0x22).u8(0x18).zeros(3).raw([0, 128, 255]).padTo(420);
  add(0x15, 2, colors);
  const xf = new W(); xf.i32(-30000).i32(0).zeros(2).i16(1000).i16(2000).i16(2000).i16(4000).i16(1000).i16(2000).u32(7);
  add(0x28, 1, xf);
  const tb = new W(); tb.u16(0).u16(0).u16(TEXT_SEQ).u16(CHARS_SEQ).u16(PARA_SEQ).u16(0).padTo(0x20).u32(42).padTo(36);
  add(0x1a, 1, tb);
  // 7 text bytes, 8 chars, 9 paras, 10/11 tiff halves
  const tx = new W(); tx.str(PM_TEXT);
  add(0x03, PM_TEXT.length, tx);
  const ch = new W();
  const chars = (len: number, font: number, size: number, color: number, flags: number) => { ch.u16(len).u16(font).u16(size).u16(0).u16(color).u16(flags).zeros(4).i16(0).zeros(2).u16(583).u16(333).u16(333).zeros(2).u16(100); };
  chars(6, 1, 240, 1, 1);
  chars(PM_TEXT.length - 6, 0, 120, 0, 0);
  add(0x1c, 2, ch);
  const pa = new W();
  const para = (len: number, flags: number, align: number, left: number, after: number) => { pa.u16(len).u8(flags).u8(align).zeros(6).u16(left).u16(0).u16(0).u16(0).u16(after).zeros(18).u8(0).u8(0).u16(0).zeros(2).u16(0).zeros(16).u16(0).zeros(16); };
  const p1 = PM_TEXT.indexOf('\r') + 1;
  para(p1, 0, 2, 0, 0);
  para(PM_TEXT.length - p1, 0x8, 0, 720, 240);
  add(0x0b, 2, pa);
  const tiff = tinyTiff();
  const half = Math.floor(tiff.length / 2);
  add(0x0e, half, new W().raw(tiff.subarray(0, half)));
  add(0x0e, tiff.length - half, new W().raw(tiff.subarray(half)));
  // Lay the bodies out after the table and write the table.
  const tocAt = 0x200;
  const toc = new W();
  let at = tocAt + cs.length * 16;
  for (const c of cs) {
    toc.u8(0).u8(c.type).u16(c.count).u32(at).u16(0).u8(0).u8(0).u32(0);
    at += c.body.length;
  }
  f.raw(toc.bytes);
  for (const c of cs) f.raw(c.body.bytes);
  f.set(0x2e, new W().u16(cs.length));
  f.set(0x30, new W().u32(tocAt));
  return f.out();
}

describe('PageMaker 6–7 layout reader', () => {
  it('reads the table of contents', () => {
    const file = openPageMaker(pmFile());
    expect(file.be).toBe(false);
    expect(file.records.length).toBe(12);
    expect(file.byType.get(0x19)?.[0]).toMatchObject({ seq: 2, count: 5 });
  });

  it('reads pages, shapes, text with formats, fonts, colors and placed pictures', async () => {
    const f = pmFile();
    expect(sniffFormat(f, 'x.pmd')).toBe('pmd');
    const r = await importPageMaker(f, 'garden.pmd');
    expect(r.textOnly).toBe(false);
    expect(r.warnings[0]).toMatch(/PageMaker publication "garden.pmd": 1 page read with 1 text block, 1 picture, 1 line, 2 shapes/);
    const pub = r.pub;
    expect(pub.size).toEqual({ w: 612, h: 792 });
    const items = pub.pages[0].items;
    expect(items).toHaveLength(5);
    const [text, rect, line, pic, oval] = items as [TextFrame, ShapeItem, LineItem, PictureFrame, ShapeItem];
    expect(text.kind).toBe('text');
    expect([text.x, text.y, text.w, text.h]).toEqual([36, 72, 540, 144]);
    const story = pub.story(text.story)!;
    expect(story.paras).toHaveLength(2);
    expect(textOf(story.paras)).toBe('Garden club news\nSpring meeting at noon.');
    expect(story.paras[0].align).toBe('ctr');
    expect(story.paras[0].runs[0]).toMatchObject({ text: 'Garden', b: true, font: 'Arial', size: 24, color: '#0080ff' });
    expect(story.paras[0].runs[1]).toMatchObject({ text: ' club news', font: 'Times New Roman', size: 12 });
    expect(story.paras[1]).toMatchObject({ marL: 36, spaceAfter: 12, hyphenate: true });
    expect(rect.kind).toBe('shape');
    expect(rect.fill).toEqual({ type: 'solid', color: '#0080ff' });
    expect(rect.line?.width).toBe(2);
    expect([rect.x, rect.y, rect.w, rect.h]).toEqual([36, 246, 120, 100]);
    expect(line.kind).toBe('line');
    expect(line.line?.dash).toBe('dash');
    expect(line.line?.width).toBe(1);
    expect([line.x, line.y, line.w, line.h]).toEqual([36, 396, 540, 0]);
    expect(pic.kind).toBe('picture');
    expect(pic.media).toBeTruthy();
    expect(pub.media[pic.media!]).toMatchObject({ mime: 'image/bmp', w: 2, h: 2 });
    expect(oval.geom).toBe('ellipse');
    expect(oval.rot).toBe(30);
    expect([oval.w, oval.h]).toEqual([50, 100]);
  });

  it('is wired into importPublication', async () => {
    const { pub } = await importPublication(pmFile(), 'garden.pmd');
    expect(pub.pages).toHaveLength(1);
    expect(pub.pages[0].items).toHaveLength(5);
  });

  it('falls back to the text harvest for files without the 6–7 structure', async () => {
    const f = Uint8Array.from(pmFile());
    f[6] = 0; f[7] = 0; // no byte-order mark: PageMaker 5 or damaged
    const r = await importLegacyLayout(f, 'old.pmd', 'pmd');
    expect(r.textOnly).toBe(true);
    expect(r.warnings[0]).toMatch(/PageMaker 5 and earlier/);
    expect(textOf(r.pub.data.stories[0].paras)).toContain('Spring meeting at noon');
  });

  it('falls back when the table of contents is unreadable', async () => {
    const f = Uint8Array.from(pmFile());
    new DataView(f.buffer).setUint32(0x30, 0x7fffff00, true);
    const r = await importLegacyLayout(f, 'bad.pmd', 'pmd');
    expect(r.textOnly).toBe(true);
    expect(r.warnings[0]).toMatch(/table of contents/);
  });
});
