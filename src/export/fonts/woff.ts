/**
 * WOFF 1.0 → TrueType (sfnt). A WOFF file is an sfnt whose tables are zlib-compressed one by one;
 * rebuilding the font is a matter of inflating each table and writing a fresh table directory with
 * recomputed checksums. Damaged tables fall back to the repository's own inflater.
 */
import { immortalInflate } from '../../io/recover/inflate';

const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'

export interface SfntTable { tag: string; data: Uint8Array }

async function inflateZlib(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate');
      const w = ds.writable.getWriter();
      void w.write(data as BufferSource); void w.close();
      const out = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      if (out.length === expected) return out;
    } catch { /* fall through to the resilient inflater */ }
  }
  // Raw deflate follows the 2-byte zlib header; the trailing Adler-32 is ignored.
  const r = immortalInflate(data.subarray(2), { resync: true });
  return r.data.length === expected ? r.data : r.data.subarray(0, expected);
}

/** Parses a WOFF file into its tables (inflated). Throws when the bytes are not WOFF. */
export async function woffTables(bytes: Uint8Array): Promise<{ flavor: number; tables: SfntTable[] }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || dv.getUint32(0) !== WOFF_SIGNATURE) throw new Error('Not a WOFF font');
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const offset = dv.getUint32(o + 4), compLength = dv.getUint32(o + 8), origLength = dv.getUint32(o + 12);
    const chunk = bytes.subarray(offset, offset + compLength);
    const data = compLength < origLength ? await inflateZlib(chunk, origLength) : chunk.slice();
    tables.push({ tag, data });
  }
  return { flavor, tables };
}

/** OpenType table checksum: the sum of the big-endian 32-bit words of the padded table. */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const n = Math.ceil(data.length / 4) * 4;
  for (let i = 0; i < n; i += 4) {
    const w = ((data[i] || 0) << 24) | ((data[i + 1] || 0) << 16) | ((data[i + 2] || 0) << 8) | (data[i + 3] || 0);
    sum = (sum + (w >>> 0)) >>> 0;
  }
  return sum;
}

/** Writes an sfnt (TrueType) file from tables; the directory is sorted by tag as the format requires. */
export function buildSfnt(tables: SfntTable[], flavor = 0x00010000): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const numTables = sorted.length;
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  const rangeShift = numTables * 16 - searchRange;
  const headerLen = 12 + numTables * 16;
  let total = headerLen;
  for (const t of sorted) total += Math.ceil(t.data.length / 4) * 4;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, flavor); dv.setUint16(4, numTables); dv.setUint16(6, searchRange); dv.setUint16(8, entrySelector); dv.setUint16(10, rangeShift);
  let pos = headerLen;
  sorted.forEach((t, i) => {
    const o = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[o + k] = t.tag.charCodeAt(k) & 0xff;
    dv.setUint32(o + 4, tableChecksum(t.data));
    dv.setUint32(o + 8, pos);
    dv.setUint32(o + 12, t.data.length);
    out.set(t.data, pos);
    pos += Math.ceil(t.data.length / 4) * 4;
  });
  // head.checkSumAdjustment = 0xB1B0AFBA - checksum of the whole font (with the field zeroed).
  const head = sorted.findIndex((t) => t.tag === 'head');
  if (head >= 0) {
    const headOff = dv.getUint32(12 + head * 16 + 8);
    dv.setUint32(headOff + 8, 0);
    const adj = (0xb1b0afba - tableChecksum(out)) >>> 0;
    dv.setUint32(headOff + 8, adj);
  }
  return out;
}

/** The TrueType bytes of a WOFF font. */
export async function woffToSfnt(bytes: Uint8Array): Promise<Uint8Array> {
  const { flavor, tables } = await woffTables(bytes);
  return buildSfnt(tables, flavor);
}
