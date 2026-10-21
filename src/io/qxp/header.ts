/**
 * QuarkXPress file header: byte order, version, page counts and the obfuscation key.
 *
 * Bytes 2–7 hold "IIXPR3" (Windows, little-endian) or "MMXPR3" (Mac, big-endian); the version
 * follows at offset 8. Versions 3.1, 3.3 and 4.x are read; 5 and later changed the layout and are
 * not. Mac files that went through a MacBinary transfer carry a 128-byte wrapper, which is removed.
 */
import { Reader, Deobfuscator } from './blocks';

export const QXP_31_MAC = 0x39;
export const QXP_31 = 0x3e;
export const QXP_33 = 0x3f;
export const QXP_4 = 0x41;

export interface QxpHeader {
  bigEndian: boolean;
  version: number;
  /** "QuarkXPress 3.3" and the like. */
  label: string;
  encoding: 'windows-1252' | 'macintosh';
  /** Document type of 4.x files: DC document, TP template, BK book, LB library. */
  type?: string;
  pagesCount: number;
  masterPagesCount: number;
  seed: number;
  increment: number;
  /** Auto leading as a fraction of the font size (0.2 = 120%). */
  autoLeading: number;
}

export function versionLabel(version: number): string {
  if (version === QXP_31_MAC || version === QXP_31) return 'QuarkXPress 3.1';
  if (version === QXP_33) return 'QuarkXPress 3.3';
  if (version === QXP_4) return 'QuarkXPress 4';
  if (version > QXP_4) return `QuarkXPress 5 or later (version code ${version})`;
  return `QuarkXPress 3.0 or earlier (version code ${version})`;
}

/** True when a MacBinary header wraps a QuarkXPress data fork. */
export function isMacBinaryQxp(b: Uint8Array): boolean {
  if (b.length < 136 || b[0] !== 0 || b[1] < 1 || b[1] > 63 || b[74] !== 0 || b[82] !== 0) return false;
  const s = String.fromCharCode(b[130], b[131], b[132], b[133], b[134], b[135]);
  return /^(MM|II)XPR[0-9]$/.test(s);
}

/** The data fork of a MacBinary-wrapped file, or the bytes unchanged. */
export function unwrapMacBinary(b: Uint8Array): Uint8Array {
  if (!isMacBinaryQxp(b)) return b;
  const len = ((b[83] << 24) | (b[84] << 16) | (b[85] << 8) | b[86]) >>> 0;
  const end = len > 0 && 128 + len <= b.length ? 128 + len : b.length;
  return b.subarray(128, end);
}

/** Reads the header; throws when the file is not a QuarkXPress document of a readable version. */
export function readQxpHeader(b: Uint8Array): QxpHeader {
  if (b.length < 512) throw new Error('The file is too short to be a QuarkXPress document.');
  const proc = String.fromCharCode(b[2]);
  if (proc !== 'I' && proc !== 'M') throw new Error('Not a QuarkXPress document (no II/MM mark).');
  const be = proc === 'M';
  if (String.fromCharCode(b[4], b[5], b[6]) !== 'XPR') throw new Error('Not a QuarkXPress document (no XPR signature).');
  const r = new Reader(b, be);
  r.seek(8);
  const version = r.u16();
  const label = versionLabel(version);
  if (version < QXP_31_MAC || version > QXP_4) throw new Error(`${label} files are not supported; QuillPress reads QuarkXPress 3.1–4.1.`);
  const h: QxpHeader = { bigEndian: be, version, label, encoding: be ? 'macintosh' : 'windows-1252', pagesCount: 0, masterPagesCount: 0, seed: 0, increment: 0, autoLeading: 0.2 };
  if (version >= QXP_4) {
    r.seek(12);
    h.type = String.fromCharCode(...r.bytes(2));
    r.skip(20);
    const pagesObf = r.u16();
    r.skip(41);
    h.masterPagesCount = r.u8();
    r.seek(0x52);
    h.increment = r.u16();
    r.seek(0x58);
    h.autoLeading = r.fraction();
    r.seek(0x80);
    h.seed = r.u16();
    const pages = new Deobfuscator(h.seed, h.increment).value(pagesObf);
    h.pagesCount = (pages & 0xfffc) | ((pages & 0x3) ^ 0x3);
  } else {
    r.seek(0x40);
    h.pagesCount = r.u16();
    r.skip(51);
    h.masterPagesCount = r.u8();
    r.skip(6);
    h.autoLeading = r.fraction();
    r.skip(84);
    r.skip(32); // superscript/subscript/superior offsets and scales
    r.skip(28);
    h.seed = r.u16();
    h.increment = r.u16();
  }
  if (h.pagesCount > 10000) throw new Error('The page count in the header is not plausible; the file is damaged.');
  return h;
}
