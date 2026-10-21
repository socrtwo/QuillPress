/**
 * Pages and objects of a QuarkXPress 3.1–4.1 document chain. After the document records come the
 * master pages, then the document pages; each page has its geometry (one or two page offsets when
 * facing pages are on), an object count and the objects: lines, boxes (empty, text or picture),
 * text paths (4.x) and groups. Object headers are obfuscated with a running key (see blocks.ts).
 *
 * Coordinates are 16.16 points in a spread space; the page offsets say where each page sits in it.
 */
import { Reader, Deobfuscator } from './blocks';
import { QXP_33, type QxpHeader } from './header';
import { QxpTables, type Rect, type Pt, type LineStyle } from './records';

export type ShapeKind = 'line' | 'orthoLine' | 'bezierLine' | 'rect' | 'roundRect' | 'concaveRect' | 'beveledRect' | 'oval' | 'bezier' | 'polygon';
export type ContentKind = 'none' | 'text' | 'picture' | 'objects';

export interface Gradient { kind: 'linear' | 'midLinear' | 'rectangular' | 'diamond' | 'circular' | 'fullCircular'; color1: string; color2: string; angle: number }
export interface Frame { width: number; color: string; gapColor?: string; dash?: LineStyle; /** 0 none, 1 end, 2 start, 3/4 both (mixed), 5 both. */ arrow: number }
export interface TextSettings { gutter: number; insets: { top: number; left: number; right: number; bottom: number }; columns: number; vAlign: 't' | 'ctr' | 'b' | 'just'; rotation: number; skew: number }
export interface LinkSettings { linkId: number; offsetIntoText: number; nextLinkedIndex: number; contentIndex: number }
export interface PictureSettings { rotation: number; skew: number; offsetLeft: number; offsetTop: number; scaleH: number; scaleV: number; data?: Uint8Array; /** Path of the linked picture file, when the file records it. */ file?: string }
export interface CurveComponent { bbox: Rect; points: Pt[] }

export interface QxpObject {
  content: ContentKind;
  shape: ShapeKind;
  bbox: Rect;
  rotation: number;
  skew: number;
  hflip: boolean;
  vflip: boolean;
  fill?: string | Gradient;
  frame?: Frame;
  runaround: boolean;
  cornerRadius: number;
  /** Polygon corners (3.x) in spread coordinates. */
  polygon?: Pt[];
  /** Bezier components (4.x): points in triples (control in, anchor, control out). */
  curves?: CurveComponent[];
  text?: TextSettings;
  link?: LinkSettings;
  textPath?: { alignment: number; lineAlignment: number; skew: boolean; rotate: boolean };
  picture?: PictureSettings;
  /** Indexes (into the page's objects) of a group's members. */
  members?: number[];
}

export interface QxpPage {
  /** One rectangle per page of the spread (two when facing pages are on). */
  offsets: Rect[];
  objects: QxpObject[];
  master: boolean;
  /** The page's name as stored (master pages carry their names here). */
  name: string;
  /** Set when an object of the page could not be read; the objects before it are kept. */
  error?: string;
}

class ObjectError extends Error {}

/** Reads the pages after the document records; stops at the first page it cannot read. */
export function readPages(r: Reader, header: QxpHeader, tables: QxpTables, warnings: string[]): QxpPage[] {
  const p = new PageReader(r, header, tables);
  const pages: QxpPage[] = [];
  const total = header.pagesCount + header.masterPagesCount;
  for (let i = 0; i < total; i++) {
    const master = i < header.masterPagesCount;
    const page = p.readPage(master);
    if (page) pages.push(page);
    if (!page || page.error) {
      const n = i - header.masterPagesCount + 1;
      const where = page ? `after ${page.objects.length} of its objects` : 'at its start';
      warnings.push(`${master ? `Master page ${i + 1}` : `Page ${n} of ${header.pagesCount}`} could not be read in full (${(page?.error ?? 'the page record is damaged')} ${where}); ${n < header.pagesCount ? 'the pages after it were not recovered' : 'what was read is kept'}.`);
      break;
    }
  }
  return pages;
}

class PageReader {
  private readonly v4: boolean;
  private readonly be: boolean;
  private deob: Deobfuscator;
  private grouped = new Set<number>();
  private lastName = '';

  constructor(private r: Reader, private header: QxpHeader, private t: QxpTables) {
    this.v4 = t.v4;
    this.be = header.bigEndian;
    this.deob = new Deobfuscator(header.seed, header.increment);
  }

  /** The next page; null when its settings cannot be read, a page with `error` set when an object cannot. */
  readPage(master: boolean): QxpPage | null {
    let offsets: Rect[];
    let count: number;
    try {
      offsets = this.readPageSettings();
      const raw = this.r.u32();
      count = this.v4 ? this.deob.value(raw & 0xffff) : raw;
      if (count > 100000) throw new ObjectError('object count is not plausible');
    } catch { return null; }
    if (this.v4) this.deob.nextRev();
    const objects: QxpObject[] = [];
    const page: QxpPage = { offsets, objects, master, name: this.lastName };
    this.grouped.clear();
    for (let i = 0; i < count; i++) {
      try { objects.push(this.readObject(count, i)); } catch (e) { page.error = (e as Error).message; break; }
    }
    return page;
  }

  private readPageSettings(): Rect[] {
    const r = this.r;
    r.skip(6);
    const count = r.u16();
    if (count === 0 || count > 2) throw new ObjectError('page record is not plausible');
    r.skip(2);
    const out: Rect[] = [];
    for (let i = 0; i < count; i++) {
      const top = r.fraction(), left = r.fraction(), bottom = r.fraction(), right = r.fraction();
      out.push({ top, left, bottom, right });
      r.skip(36);
      r.skip(this.v4 ? 12 : 8);
    }
    for (let i = 0; i <= count; i++) { const len = r.u32(); r.skip(len + 4); }
    if (!this.be) r.skip(4);
    const nameLen = r.u32();
    if (nameLen > r.remaining) throw new ObjectError('page name runs past the end');
    const nameBytes = r.bytes(nameLen);
    let name = '';
    for (const c of nameBytes) { if (c === 0) break; if (c >= 32) name += String.fromCharCode(c); }
    this.lastName = name.trim();
    return out;
  }

  private readObject(objectsCount: number, index: number): QxpObject {
    return this.v4 ? this.readObject4(objectsCount, index) : this.readObject3(objectsCount, index);
  }

  // ------------------------------------------------------------------------------------------
  // Shared pieces

  private bbox(): Rect { const r = this.r; return { top: r.fraction(), left: r.fraction(), bottom: r.fraction(), right: r.fraction() }; }
  private yx(): Pt { const y = this.r.fraction(); const x = this.r.fraction(); return { x, y }; }

  private gradient(color1: string): Gradient {
    const r = this.r;
    r.skip(this.v4 ? 20 : 14);
    const type = r.u16() & 0xff;
    const kind = ({ 0x10: 'linear', 0x18: 'midLinear', 0x19: 'rectangular', 0x1a: 'diamond', 0x1b: 'circular', 0x1c: 'fullCircular' } as Record<number, Gradient['kind']>)[type] || 'linear';
    r.skip(4);
    let colorId: number;
    if (this.v4) colorId = r.u16(); else { colorId = r.u8(); r.skip(1); }
    const shade = r.fraction();
    const color2 = this.t.color(colorId, shade);
    const angle = r.fraction();
    r.skip(4);
    return { kind, color1, color2, angle };
  }

  private frame(): Frame {
    const r = this.r;
    const width = r.fraction();
    const shade = r.fraction();
    if (this.v4) {
      const colorId = r.u16();
      const gapColorId = r.u16();
      const gapShade = r.fraction();
      const arrowType = r.u8();
      const bitmap = r.u8() === 1;
      const styleIndex = r.u16();
      return { width, color: this.t.color(colorId, shade), gapColor: this.t.color(gapColorId, gapShade), arrow: (arrowType >> 2) & 0xf, dash: bitmap ? undefined : this.t.lineStyles.get(styleIndex) };
    }
    const colorId = r.u8();
    r.skip(1);
    return { width, color: this.t.color(colorId, shade), arrow: 0 };
  }

  private vAlign(): TextSettings['vAlign'] { return (['t', 'ctr', 'b', 'just'] as const)[this.r.u8()] || 't'; }

  private textSettingsBody(): TextSettings {
    const r = this.r;
    const gutter = r.fraction();
    const top = r.fraction(), left = r.fraction(), right = r.fraction(), bottom = r.fraction();
    const rotation = r.fraction(), skew = r.fraction();
    const columns = r.u8();
    const vAlign = this.vAlign();
    return { gutter, insets: { top, left, right, bottom }, columns: Math.max(1, columns), vAlign, rotation, skew };
  }

  private members(count: number, objectsCount: number, index: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const ind = this.r.u32();
      if (ind >= objectsCount || ind === index) continue;
      if (!this.grouped.has(ind)) { this.grouped.add(ind); out.push(ind); }
    }
    return out;
  }

  private skipLengthRecord(): void { const len = this.r.u32(); this.r.skip(len); }

  // ------------------------------------------------------------------------------------------
  // QuarkXPress 3.1 / 3.3

  private readObject3(objectsCount: number, index: number): QxpObject {
    const r = this.r;
    const typeByte = this.deob.byte(r.u8());
    let shape: ShapeKind = 'rect';
    let content: ContentKind = 'none';
    if (this.header.version < QXP_33) {
      const m: Record<number, [ShapeKind, ContentKind]> = { 0: ['line', 'none'], 1: ['orthoLine', 'none'], 3: ['rect', 'text'], 11: ['rect', 'objects'], 12: ['rect', 'picture'], 13: ['roundRect', 'picture'], 14: ['oval', 'picture'], 15: ['polygon', 'picture'] };
      const e = m[typeByte];
      if (!e) throw new ObjectError(`unknown object type ${typeByte}`);
      [shape, content] = e;
    }
    const colorId = r.u8();
    const shade = r.fraction();
    const color = this.t.color(colorId, shade);
    const contentIndex = this.deob.value(r.u32() & 0xffff);
    const flags = r.u8();
    const noColor = !!(flags & (this.be ? 0x80 : 0x1));
    const noRunaround = !!(flags & (this.be ? 0x02 : 0x20));
    r.skip(1);
    const rotation = r.fraction();
    const skew = r.fraction();
    const linkId = r.u32();
    const gradientId = r.u32();
    r.skip(4);
    const f1 = r.u8(), f2 = r.u8();
    const hflip = !!(f1 & (this.be ? 0x80 : 0x1));
    const vflip = !!(f2 & (this.be ? 0x80 : 0x1));
    const beveled = !!(f2 & (this.be ? 0x20 : 0x2));
    const concave = !!(f2 & (this.be ? 0x40 : 0x4));
    if (this.header.version === QXP_33) {
      const ct = r.u8();
      content = ({ 1: 'objects', 2: 'none', 4: 'none', 3: 'text', 5: 'picture' } as Record<number, ContentKind>)[ct];
      if (!content) throw new ObjectError(`unknown content type ${ct}`);
      const st = r.u8();
      const sh = (['line', 'orthoLine', 'rect', 'roundRect', 'oval', 'polygon'] as ShapeKind[])[st];
      if (!sh) throw new ObjectError(`unknown shape type ${st}`);
      shape = sh;
    }
    if (shape === 'roundRect') shape = concave ? 'concaveRect' : beveled ? 'beveledRect' : 'roundRect';
    const o: QxpObject = { content, shape, bbox: { top: 0, left: 0, bottom: 0, right: 0 }, rotation, skew, hflip, vflip, runaround: !noRunaround, cornerRadius: 0 };
    if (!noColor) o.fill = color;
    if (this.header.version === QXP_33) o.cornerRadius = r.fraction();
    if (gradientId !== 0) o.fill = this.gradient(color);
    o.bbox = this.bbox();
    o.link = { linkId, offsetIntoText: 0, nextLinkedIndex: 0, contentIndex };

    if (content === 'none') {
      if (shape === 'line' || shape === 'orthoLine') {
        const width = r.fraction();
        const styleIndex = r.u8();
        const stripe = (styleIndex >> 7) === 1;
        const arrow = r.u8();
        o.frame = { width, color: typeof o.fill === 'string' ? o.fill : this.t.color(1), dash: stripe ? undefined : this.t.lineStyles.get(styleIndex), arrow };
        delete o.fill;
      } else {
        o.frame = this.frame();
        r.skip(4);
        const runaroundId = r.u32();
        r.skip(74);
        if (shape === 'polygon') o.polygon = this.polygon3();
        if (runaroundId !== 0) this.skipLengthRecord();
      }
      this.deob.next33();
      return o;
    }
    if (content === 'picture') {
      const frame = this.frame();
      r.skip(4);
      let runaroundId = 0, clipId = 0;
      // 3.1 and 3.3 picture boxes have the same 92-byte body: the ids of the runaround and
      // clipping paths, then the picture settings. 3.1 keeps the corner radius of cornered boxes
      // where 3.3 has the clipping id (3.3 stores the radius in the object header instead).
      runaroundId = r.u32();
      if (this.header.version < QXP_33 && (shape === 'roundRect' || shape === 'beveledRect' || shape === 'concaveRect')) {
        o.cornerRadius = r.fraction();
        r.skip(16);
      } else {
        r.skip(2);
        clipId = r.u32();
        r.skip(14);
      }
      o.frame = frame;
      o.picture = { rotation: r.fraction(), skew: r.fraction(), offsetLeft: r.fraction(), offsetTop: r.fraction(), scaleH: r.fraction(), scaleV: r.fraction() };
      r.skip(30);
      if (shape === 'polygon') o.polygon = this.polygon3();
      // A box whose picture is linked to a file carries the file's description (type and path)
      // as a length-prefixed record; the link field of the header is non-zero for those.
      if (linkId !== 0) o.picture.file = this.fileInfo3();
      if (runaroundId !== 0) { this.skipLengthRecord(); if (clipId !== 0) this.skipLengthRecord(); }
      this.deob.next33();
      return o;
    }
    if (content === 'text') {
      o.frame = this.frame();
      r.skip(4);
      const runaroundId = r.u32();
      o.link.offsetIntoText = r.u32();
      r.skip(4);
      o.text = this.textSettingsBody();
      r.skip(8);
      o.link.nextLinkedIndex = r.u32();
      r.skip(8);
      if (shape === 'polygon') o.polygon = this.polygon3();
      if (contentIndex === 0 || o.link.offsetIntoText === 0) {
        r.skip(4);
        const fileInfoId = r.u32();
        r.skip(4);
        if (fileInfoId !== 0) this.skipLengthRecord();
        if (contentIndex === 0) r.skip(12);
      }
      if (runaroundId !== 0) this.skipLengthRecord();
      this.deob.next33();
      return o;
    }
    // objects: a group
    r.skip(10);
    const count = r.u16();
    if (count > objectsCount - 1) throw new ObjectError('group member count is not plausible');
    r.skip(6);
    o.members = this.members(count, objectsCount, index);
    this.deob.next33();
    return o;
  }

  /** The linked file record of a 3.x picture box: a 4-byte type tag ("PCX", "TIFF", "EPSF"...) then the path. */
  private fileInfo3(): string {
    const r = this.r;
    const len = r.u32();
    if (len > r.remaining) throw new ObjectError('file record runs past the end');
    const b = r.bytes(len);
    // The path is the last run of printable characters in the record.
    let s = '', last = '';
    for (let i = 4; i < b.length; i++) {
      const c = b[i];
      if (c >= 32 && c < 127) s += String.fromCharCode(c);
      else { if (s.length >= 3) last = s; s = ''; }
    }
    return s.length >= 3 ? s : last;
  }

  private polygon3(): Pt[] {
    const r = this.r;
    const len = r.u32();
    if (len < 18 || len > r.remaining) throw new ObjectError('polygon data runs past the end');
    const end = r.pos + len;
    r.skip(18);
    const n = Math.floor((len - 18) / 8);
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) pts.push(this.yx());
    r.seek(end);
    return pts;
  }

  // ------------------------------------------------------------------------------------------
  // QuarkXPress 4

  private readObject4(objectsCount: number, index: number): QxpObject {
    const r = this.r;
    const flags = r.u8();
    const noColor = !!(flags & (this.be ? 0x80 : 0x1));
    r.skip(1);
    const colorId = r.u16();
    const shade = r.fraction();
    const color = this.t.color(colorId, shade);
    r.skip(4);
    const contentIndexObf = r.u32() & 0xffff;
    const rotation = r.fraction();
    const skew = r.fraction();
    const linkId = r.u32();
    const oleId = r.u32();
    const gradientId = r.u32();
    r.skip(4);
    const f1 = r.u8(), f2 = r.u8();
    const hflip = !!(f1 & (this.be ? 0x80 : 0x1));
    const vflip = !!(f2 & (this.be ? 0x80 : 0x1));
    const ct = this.deob.byte(r.u8());
    this.deob.nextShift(ct);
    const contentIndex = this.deob.value(contentIndexObf);
    const st = this.deob.byte(r.u8());
    const content = ({ 0: 'none', 2: 'objects', 3: 'text', 4: 'picture' } as Record<number, ContentKind>)[ct];
    if (!content) throw new ObjectError(`unknown content type ${ct}`);
    const shape = ({ 1: 'line', 2: 'orthoLine', 4: 'bezierLine', 5: 'rect', 6: 'roundRect', 7: 'concaveRect', 8: 'beveledRect', 9: 'oval', 11: 'bezier' } as Record<number, ShapeKind>)[st];
    if (!shape) throw new ObjectError(`unknown shape type ${st}`);
    const o: QxpObject = { content, shape, bbox: { top: 0, left: 0, bottom: 0, right: 0 }, rotation, skew, hflip, vflip, runaround: false, cornerRadius: 0 };
    if (!noColor) o.fill = color;
    o.link = { linkId, offsetIntoText: 0, nextLinkedIndex: 0, contentIndex };
    const isLine = shape === 'line' || shape === 'orthoLine';
    const isBezierLine = shape === 'bezierLine';
    const isBezierBox = shape === 'bezier';

    const runaround = () => { o.runaround = r.u8() === 1; r.skip(39); };
    const bezierData = () => this.bezier4(o);
    const linked = () => { o.link!.nextLinkedIndex = r.u32(); r.skip(4); };
    const textEnd = () => {
      if (contentIndex === 0 || o.link!.offsetIntoText === 0) {
        r.skip(4);
        const fileInfoId = r.u32();
        r.skip(4);
        if (fileInfoId !== 0) this.skipLengthRecord();
        if (contentIndex === 0) r.skip(16);
      }
    };
    const pathSettings = () => {
      o.textPath = { skew: r.u8() === 1, rotate: r.u8() === 1, alignment: r.u8(), lineAlignment: r.u8() };
    };

    if (content === 'none') {
      o.frame = this.frame();
      r.skip(4);
      runaround();
      if (isLine) { r.skip(4); o.bbox = this.bbox(); r.skip(24); }
      else if (isBezierLine) { r.skip(44); bezierData(); }
      else if (isBezierBox) { r.skip(44); if (gradientId !== 0) o.fill = this.gradient(color); bezierData(); }
      else { r.skip(4); o.bbox = this.bbox(); o.cornerRadius = r.fraction(); r.skip(20); if (gradientId !== 0) o.fill = this.gradient(color); }
      // 4.x lines take their color from the frame record (the header color is the box background).
      if (isLine || isBezierLine) delete o.fill;
    } else if (content === 'picture') {
      if (isLine || isBezierLine) throw new ObjectError('a line cannot hold a picture');
      o.frame = this.frame();
      r.skip(4);
      runaround();
      if (isBezierBox) { r.skip(40); }
      else { r.skip(4); o.bbox = this.bbox(); o.cornerRadius = r.fraction(); r.skip(16); }
      this.skipLengthRecord(); // OLE object
      if (gradientId !== 0) o.fill = this.gradient(color);
      r.skip(24);
      o.picture = { rotation: r.fraction(), skew: r.fraction(), offsetLeft: r.fraction(), offsetTop: r.fraction(), scaleH: r.fraction(), scaleV: r.fraction() };
      r.skip(76);
      if (contentIndex !== 0 && oleId === 0) {
        const len = r.u32();
        if (len > r.remaining) throw new ObjectError('picture data runs past the end');
        if (len > 0) o.picture.data = r.bytes(len);
      }
      if (isBezierBox) bezierData();
    } else if (content === 'text') {
      o.frame = this.frame();
      r.skip(4);
      runaround();
      if (isLine || isBezierLine) {
        if (isLine) { r.skip(4); o.bbox = this.bbox(); r.skip(24); } else r.skip(44);
        o.link.offsetIntoText = r.u32();
        r.skip(44);
        linked();
        r.skip(4);
        pathSettings();
        r.skip(4);
        if (isBezierLine) bezierData();
        textEnd();
        delete o.fill;
      } else {
        if (isBezierBox) r.skip(44);
        else { r.skip(4); o.bbox = this.bbox(); o.cornerRadius = r.fraction(); r.skip(20); }
        if (gradientId !== 0) o.fill = this.gradient(color);
        o.link.offsetIntoText = r.u32();
        r.skip(2);
        r.skip(2);
        o.text = this.textSettingsBody();
        r.skip(10);
        linked();
        r.skip(12);
        if (isBezierBox) bezierData();
        textEnd();
      }
    } else {
      r.skip(68);
      o.bbox = this.bbox();
      r.skip(24);
      const count = r.u16();
      if (count > objectsCount - 1) throw new ObjectError('group member count is not plausible');
      r.skip(10);
      o.members = this.members(count, objectsCount, index);
    }
    this.deob.next4(contentIndex);
    return o;
  }

  private bezier4(o: QxpObject): void {
    const r = this.r;
    const len = r.u32();
    if (len > r.remaining) throw new ObjectError('bezier data runs past the end');
    const start = r.pos;
    const end = start + len;
    try {
      r.skip(2);
      const n = r.u16();
      if (n > len / 24) throw new ObjectError('too many bezier components');
      o.bbox = this.bbox();
      const offsets: number[] = [];
      for (let i = 0; i < n; i++) offsets.push(start + r.u32());
      o.curves = [];
      for (const off of offsets) {
        r.seek(off);
        r.skip(2);
        const pn = r.u16();
        if (pn > len / 8) throw new ObjectError('too many bezier points');
        const bbox = this.bbox();
        const points: Pt[] = [];
        for (let i = 0; i < pn; i++) points.push(this.yx());
        o.curves.push({ bbox, points });
      }
    } catch { /* keep the components read so far */ }
    r.seek(end);
  }
}
